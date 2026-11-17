using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>
/// Sends the confirmation mails that are due. At-least-once by design: a mail whose outcome is unknown (no answer from Google, a crash
/// after the call) is tried again with the SAME link, so a second copy is harmless (confirming twice is one change). A request is held by
/// a lease taken with <c>FOR UPDATE SKIP LOCKED</c>, so two workers never send one request at the same time.
/// </summary>
internal sealed class NewsletterVerificationDispatcher(
    TheBhaDbContext database, TimeProvider timeProvider, NewsletterOptions options, NewsletterSecretProtector protector,
    IGoogleMailGateway google, ILogger<NewsletterVerificationDispatcher> logger) : INewsletterVerificationDispatcher
{
    /// <summary>One request this worker took: <see cref="ClaimId"/> is the proof of it, and every write of the worker must present it.</summary>
    private readonly record struct Held(Guid Id, Guid ClaimId, Guid SubscriptionId);

    public async Task<int> ProcessBatchAsync(int maxMessages, CancellationToken cancellationToken)
    {
        var processed = 0;
        string? accessToken = null;
        int? tokenEpoch = null;
        while (processed < maxMessages && !cancellationToken.IsCancellationRequested)
        {
            // Not connected, needs reconnecting, or no https origin for the link: nothing is attempted and no attempt is used up.
            if (!await NewsletterReadiness.CanSendAsync(database, options, cancellationToken)) return processed;

            var held = await ClaimAsync(cancellationToken);
            if (held is null) return processed;
            var claim = held.Value;
            processed++;
            database.ChangeTracker.Clear();

            var request = await database.NewsletterVerificationRequests.AsNoTracking().SingleAsync(r => r.Id == claim.Id, cancellationToken);
            var (settings, subscriptionEmail) = (await database.NewsletterSenderSettings.AsNoTracking().SingleAsync(cancellationToken),
                await database.NewsletterSubscriptions.AsNoTracking().Where(s => s.Id == request.SubscriptionId).Select(s => s.Email).SingleAsync(cancellationToken));

            // The identity is pinned at the first attempt. A request already tried under another generation is not sent under this one.
            if (request.SenderGeneration is { } pinned && pinned != settings.SenderGeneration)
            {
                await FinishAsync(claim, NewsletterVerificationRequest.StatusCancelled, "sender-changed", null, releaseCooldown: true, cancellationToken);
                continue;
            }

            // A request whose link was already used (the visitor confirmed while it was held by a worker that died) or whose token can
            // no longer be read is finished HERE. It is never a sender problem: it must not flip the whole site to "connect again".
            if (request.UsedAtUtc is not null)
            {
                await FinishAsync(claim, NewsletterVerificationRequest.StatusCancelled, "verified", null, releaseCooldown: false, cancellationToken);
                continue;
            }

            if (!protector.TryUnprotect(request.ProtectedToken, out var token))
            {
                await FinishAsync(claim, NewsletterVerificationRequest.StatusCancelled, "token-unavailable", null, releaseCooldown: true, cancellationToken);
                continue;
            }

            if (request.SenderGeneration is null)
            {
                // Pinned only while the claim is still ours; a worker that lost it must neither pin nor send.
                if (!await PinIdentityAsync(claim, settings, cancellationToken)) continue;
                request.SenderGeneration = settings.SenderGeneration;
                request.FromEmail = settings.ConnectedEmail;
                request.FromName = settings.SenderName;
                request.ReplyTo = settings.ReplyTo;
            }

            if (!protector.TryUnprotect(settings.ProtectedRefreshToken, out var refreshToken) ||
                !protector.TryUnprotect(settings.ProtectedClientSecret, out var clientSecret))
            {
                // A secret that cannot be read (a lost key ring) is the connection's problem: reconnect, and this request waits.
                await NeedsReconnectAsync(claim, settings.ConnectionEpoch, cancellationToken);
                return processed;
            }

            // The access token belongs to the connection it was made with: any new connection (the same Gmail address included) gets its own.
            if (accessToken is null || tokenEpoch != settings.ConnectionEpoch)
            {
                var refreshed = await google.RefreshAccessTokenAsync(settings.ClientId!, clientSecret, refreshToken, cancellationToken);
                if (refreshed.Failure == GoogleFailure.InvalidGrant || refreshed.Failure == GoogleFailure.Rejected)
                {
                    await NeedsReconnectAsync(claim, settings.ConnectionEpoch, cancellationToken);
                    return processed;
                }

                if (refreshed.Failure == GoogleFailure.Transient || refreshed.AccessToken is null)
                {
                    await RetryLaterAsync(claim, request.Attempts, "token-unavailable", cancellationToken);
                    continue;
                }

                accessToken = refreshed.AccessToken;
                tokenEpoch = settings.ConnectionEpoch;
            }

            // The last look before the mail leaves: after every await above (Google's token answer included) the request must still be this
            // worker's and the connection still the one whose credentials were used. Otherwise nothing is sent; the request is given back.
            if (!await StillCurrentAsync(claim, settings.ConnectionEpoch, cancellationToken))
            {
                await GiveBackAsync(claim, "connection-changed", cancellationToken);
                continue;
            }

            var link = options.CustomerOrigin!.TrimEnd('/') + "/newsletter/confirm#t=" + token;
            var host = new Uri(options.CustomerOrigin!).Host;
            var raw = NewsletterMailMessage.Build(request.FromEmail!, request.FromName ?? "The BHA", request.ReplyTo, subscriptionEmail, request.Language, link, options.TokenLifetimeHours, host);
            var outcome = await google.SendAsync(accessToken, raw, cancellationToken);
            switch (outcome)
            {
                case GoogleSendOutcome.Sent:
                    await FinishAsync(claim, NewsletterVerificationRequest.StatusSent, null, timeProvider.GetUtcNow(), releaseCooldown: false, cancellationToken);
                    break;
                case GoogleSendOutcome.Rejected:
                    await FinishAsync(claim, NewsletterVerificationRequest.StatusFailed, "rejected", null, releaseCooldown: false, cancellationToken);
                    break;
                case GoogleSendOutcome.AuthRevoked:
                    await NeedsReconnectAsync(claim, settings.ConnectionEpoch, cancellationToken);
                    return processed;
                default:
                    await RetryLaterAsync(claim, request.Attempts, "unknown", cancellationToken);
                    break;
            }
        }

        return processed;
    }

    /// <summary>The request as THIS worker holds it: still Sending, and under this worker's claim. Every write of the worker is restricted to it.</summary>
    private IQueryable<NewsletterVerificationRequest> Owned(Held held) =>
        database.NewsletterVerificationRequests.Where(r => r.Id == held.Id && r.Status == NewsletterVerificationRequest.StatusSending && r.ClaimId == held.ClaimId);

    /// <summary>
    /// Read from the database NOW (never from what the worker read earlier): the request is still Sending under this worker's claim with a lease
    /// that has not run out, the sender is Connected, and its <see cref="NewsletterSenderSettings.ConnectionEpoch"/> is the one the credentials came from.
    /// </summary>
    private async Task<bool> StillCurrentAsync(Held held, int connectionEpoch, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        return await Owned(held).Where(r => r.LeaseUntilUtc > now)
            .AnyAsync(r => database.NewsletterSenderSettings.Any(s => s.Status == NewsletterSenderSettings.StatusConnected && s.ConnectionEpoch == connectionEpoch), cancellationToken);
    }

    /// <summary>Nothing was sent: the request goes back to waiting with its attempt returned (a no-op when the claim is no longer ours).</summary>
    private async Task GiveBackAsync(Held held, string outcome, CancellationToken cancellationToken)
    {
        database.ChangeTracker.Clear();
        await Owned(held)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.Status, NewsletterVerificationRequest.StatusPending).SetProperty(r => r.Attempts, r => r.Attempts - 1)
                .SetProperty(r => r.LastOutcome, outcome).SetProperty(r => r.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(r => r.ClaimId, (Guid?)null), cancellationToken);
    }

    /// <summary>Takes one due request (pending, or a lease that ran out) under a lease and a new claim, and counts the attempt. Null when nothing is due.</summary>
    private async Task<Held?> ClaimAsync(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var claimId = Guid.NewGuid();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var ids = await NewsletterSql.ReturningIdsAsync(database,
            """
            UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "Attempts" = "Attempts" + 1, "LeaseUntilUtc" = @lease, "ClaimId" = @claim
            WHERE "Id" = (
                SELECT "Id" FROM "NewsletterVerificationRequests"
                WHERE ("Status" = 'Pending' AND "NextAttemptAtUtc" <= @now) OR ("Status" = 'Sending' AND "LeaseUntilUtc" < @now)
                ORDER BY "NextAttemptAtUtc", "Id" LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING "Id"
            """,
            [("now", now), ("lease", now.AddSeconds(options.LeaseSeconds)), ("claim", claimId)], cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        if (ids.Count == 0) return null;

        // An expired link is not worth a mail; and a request out of attempts is a failure that says it was uncertain.
        var request = await database.NewsletterVerificationRequests.AsNoTracking().SingleAsync(r => r.Id == ids[0], cancellationToken);
        var held = new Held(request.Id, claimId, request.SubscriptionId);
        if (request.ExpiresAtUtc <= now)
        {
            await FinishAsync(held, NewsletterVerificationRequest.StatusCancelled, "expired", null, releaseCooldown: false, cancellationToken);
            return await ClaimAsync(cancellationToken);
        }

        if (request.Attempts > options.MaxAttempts)
        {
            await FinishAsync(held, NewsletterVerificationRequest.StatusFailed, "gave-up", null, releaseCooldown: false, cancellationToken);
            return await ClaimAsync(cancellationToken);
        }

        return held;
    }

    /// <summary>Pins the sender identity on the request; false when the claim is no longer this worker's.</summary>
    private async Task<bool> PinIdentityAsync(Held held, NewsletterSenderSettings settings, CancellationToken cancellationToken) =>
        await Owned(held).ExecuteUpdateAsync(set => set.SetProperty(r => r.SenderGeneration, settings.SenderGeneration).SetProperty(r => r.FromEmail, settings.ConnectedEmail)
            .SetProperty(r => r.FromName, settings.SenderName).SetProperty(r => r.ReplyTo, settings.ReplyTo), cancellationToken) == 1;

    private async Task FinishAsync(Held held, string status, string? outcome, DateTimeOffset? sentAt, bool releaseCooldown, CancellationToken cancellationToken)
    {
        // Only while the claim is ours: a request cancelled meanwhile (a new account, a verification) is not brought back to life, and a
        // request another worker holds now is not finished by this one. Without the claim, nothing that goes with it (the cooldown) happens either.
        var finished = await Owned(held)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.Status, status).SetProperty(r => r.LastOutcome, outcome).SetProperty(r => r.SentAtUtc, sentAt)
                .SetProperty(r => r.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(r => r.ClaimId, (Guid?)null).SetProperty(r => r.ProtectedToken, (string?)null), cancellationToken);
        // The two statements are separate on purpose: no lock is held across them, so this path cannot take part in a lock cycle.
        if (finished == 1 && releaseCooldown)
        {
            await database.NewsletterSubscriptions.Where(s => s.Id == held.SubscriptionId && s.Status == NewsletterSubscription.StatusPendingVerification)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.LastVerificationRequestedAtUtc, (DateTimeOffset?)null), cancellationToken);
        }
    }

    private async Task RetryLaterAsync(Held held, int attempts, string outcome, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        if (attempts >= options.MaxAttempts)
        {
            // Out of attempts with the outcome still unknown: stop (the visitor can ask again after the cooldown).
            await FinishAsync(held, NewsletterVerificationRequest.StatusFailed, outcome == "unknown" ? "uncertain" : "gave-up", null, false, cancellationToken);
            return;
        }

        var delay = TimeSpan.FromMinutes(Math.Min(60, Math.Pow(2, attempts - 1)));
        database.ChangeTracker.Clear();
        await Owned(held)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.Status, NewsletterVerificationRequest.StatusPending).SetProperty(r => r.LastOutcome, outcome)
                .SetProperty(r => r.NextAttemptAtUtc, now + delay).SetProperty(r => r.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(r => r.ClaimId, (Guid?)null), cancellationToken);
    }

    /// <summary>
    /// The connection the worker used failed. The request goes back to waiting and the attempt it used is given back, but the SENDER is marked
    /// only while this worker still holds the request AND the stored connection is still the one it read (same <see cref="NewsletterSenderSettings.ConnectionEpoch"/>):
    /// a late failure of an old connection, the same Gmail address included, must not break the new one.
    /// </summary>
    private async Task NeedsReconnectAsync(Held held, int connectionEpoch, CancellationToken cancellationToken)
    {
        database.ChangeTracker.Clear();
        var released = await Owned(held)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.Status, NewsletterVerificationRequest.StatusPending).SetProperty(r => r.Attempts, r => r.Attempts - 1)
                .SetProperty(r => r.LastOutcome, "needs-reconnect").SetProperty(r => r.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(r => r.ClaimId, (Guid?)null), cancellationToken);
        if (released != 1) return;

        var marked = await database.NewsletterSenderSettings.Where(s => s.Status == NewsletterSenderSettings.StatusConnected && s.ConnectionEpoch == connectionEpoch)
            .ExecuteUpdateAsync(set => set.SetProperty(s => s.Status, NewsletterSenderSettings.StatusNeedsReconnect).SetProperty(s => s.UpdatedAtUtc, timeProvider.GetUtcNow()).SetProperty(s => s.Version, s => s.Version + 1), cancellationToken);
        if (marked == 1) logger.LogWarning("The newsletter sender needs to be connected again.");
    }
}

/// <summary>The host's timer for the dispatcher. Off when <c>Website:Newsletter:WorkerEnabled</c> is false (every test host starts with it off).</summary>
internal sealed class NewsletterVerificationWorker(IServiceScopeFactory scopes, NewsletterOptions options, ILogger<NewsletterVerificationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.WorkerEnabled) return;
        var delay = TimeSpan.FromSeconds(Math.Max(1, options.WorkerPollSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<INewsletterVerificationDispatcher>().ProcessBatchAsync(20, stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // The next tick tries again; the row's lease protects against a half-done send.
                logger.LogWarning(exception.GetType().Name + " in the newsletter worker.");
            }

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { }
        }
    }
}
