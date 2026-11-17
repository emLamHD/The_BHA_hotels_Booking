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
    public async Task<int> ProcessBatchAsync(int maxMessages, CancellationToken cancellationToken)
    {
        var processed = 0;
        string? accessToken = null;
        int? tokenGeneration = null;
        while (processed < maxMessages && !cancellationToken.IsCancellationRequested)
        {
            // Not connected, needs reconnecting, or no https origin for the link: nothing is attempted and no attempt is used up.
            if (!await NewsletterReadiness.CanSendAsync(database, options, cancellationToken)) return processed;

            var claim = await ClaimAsync(cancellationToken);
            if (claim is null) return processed;
            processed++;
            database.ChangeTracker.Clear();

            var request = await database.NewsletterVerificationRequests.SingleAsync(r => r.Id == claim.Value, cancellationToken);
            var (settings, subscriptionEmail) = (await database.NewsletterSenderSettings.AsNoTracking().SingleAsync(cancellationToken),
                await database.NewsletterSubscriptions.AsNoTracking().Where(s => s.Id == request.SubscriptionId).Select(s => s.Email).SingleAsync(cancellationToken));

            // The identity is pinned at the first attempt. A request already tried under another generation is not sent under this one.
            if (request.SenderGeneration is { } pinned && pinned != settings.SenderGeneration)
            {
                await FinishAsync(request, NewsletterVerificationRequest.StatusCancelled, "sender-changed", null, releaseCooldown: true, cancellationToken);
                continue;
            }

            if (request.SenderGeneration is null)
            {
                request.SenderGeneration = settings.SenderGeneration;
                request.FromEmail = settings.ConnectedEmail;
                request.FromName = settings.SenderName;
                request.ReplyTo = settings.ReplyTo;
                await database.SaveChangesAsync(cancellationToken);
            }

            if (!protector.TryUnprotect(settings.ProtectedRefreshToken, out var refreshToken) ||
                !protector.TryUnprotect(settings.ProtectedClientSecret, out var clientSecret) ||
                !protector.TryUnprotect(request.ProtectedToken, out var token))
            {
                // A secret that cannot be read (a lost key ring) is the connection's problem: reconnect, and this request waits.
                await NeedsReconnectAsync(request, cancellationToken);
                return processed;
            }

            if (accessToken is null || tokenGeneration != settings.SenderGeneration)
            {
                var refreshed = await google.RefreshAccessTokenAsync(settings.ClientId!, clientSecret, refreshToken, cancellationToken);
                if (refreshed.Failure == GoogleFailure.InvalidGrant || refreshed.Failure == GoogleFailure.Rejected)
                {
                    await NeedsReconnectAsync(request, cancellationToken);
                    return processed;
                }

                if (refreshed.Failure == GoogleFailure.Transient || refreshed.AccessToken is null)
                {
                    await RetryLaterAsync(request, "token-unavailable", cancellationToken);
                    continue;
                }

                accessToken = refreshed.AccessToken;
                tokenGeneration = settings.SenderGeneration;
            }

            var link = options.CustomerOrigin!.TrimEnd('/') + "/newsletter/confirm#t=" + token;
            var host = new Uri(options.CustomerOrigin!).Host;
            var raw = NewsletterMailMessage.Build(request.FromEmail!, request.FromName ?? "The BHA", request.ReplyTo, subscriptionEmail, request.Language, link, options.TokenLifetimeHours, host);
            var outcome = await google.SendAsync(accessToken, raw, cancellationToken);
            switch (outcome)
            {
                case GoogleSendOutcome.Sent:
                    await FinishAsync(request, NewsletterVerificationRequest.StatusSent, null, timeProvider.GetUtcNow(), releaseCooldown: false, cancellationToken);
                    break;
                case GoogleSendOutcome.Rejected:
                    await FinishAsync(request, NewsletterVerificationRequest.StatusFailed, "rejected", null, releaseCooldown: false, cancellationToken);
                    break;
                case GoogleSendOutcome.AuthRevoked:
                    await NeedsReconnectAsync(request, cancellationToken);
                    return processed;
                default:
                    await RetryLaterAsync(request, "unknown", cancellationToken);
                    break;
            }
        }

        return processed;
    }

    /// <summary>Takes one due request (pending, or a lease that ran out) under a lease and counts the attempt. Null when nothing is due.</summary>
    private async Task<Guid?> ClaimAsync(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var ids = await NewsletterSql.ReturningIdsAsync(database,
            """
            UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "Attempts" = "Attempts" + 1, "LeaseUntilUtc" = @lease
            WHERE "Id" = (
                SELECT "Id" FROM "NewsletterVerificationRequests"
                WHERE ("Status" = 'Pending' AND "NextAttemptAtUtc" <= @now) OR ("Status" = 'Sending' AND "LeaseUntilUtc" < @now)
                ORDER BY "NextAttemptAtUtc", "Id" LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING "Id"
            """,
            [("now", now), ("lease", now.AddSeconds(options.LeaseSeconds))], cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        if (ids.Count == 0) return null;

        // An expired link is not worth a mail; and a request out of attempts is a failure that says it was uncertain.
        var request = await database.NewsletterVerificationRequests.SingleAsync(r => r.Id == ids[0], cancellationToken);
        if (request.ExpiresAtUtc <= now)
        {
            await FinishAsync(request, NewsletterVerificationRequest.StatusCancelled, "expired", null, releaseCooldown: false, cancellationToken);
            database.ChangeTracker.Clear();
            return await ClaimAsync(cancellationToken);
        }

        if (request.Attempts > options.MaxAttempts)
        {
            await FinishAsync(request, NewsletterVerificationRequest.StatusFailed, "gave-up", null, releaseCooldown: false, cancellationToken);
            database.ChangeTracker.Clear();
            return await ClaimAsync(cancellationToken);
        }

        database.ChangeTracker.Clear();
        return ids[0];
    }

    private async Task FinishAsync(NewsletterVerificationRequest request, string status, string? outcome, DateTimeOffset? sentAt, bool releaseCooldown, CancellationToken cancellationToken)
    {
        // Conditional on "still ours": a request cancelled meanwhile (a new account, a verification) is not brought back to life.
        var tracked = database.ChangeTracker.Entries<NewsletterVerificationRequest>().Any(e => e.Entity.Id == request.Id);
        if (tracked) database.Entry(request).State = EntityState.Detached;
        await database.NewsletterVerificationRequests.Where(r => r.Id == request.Id && r.Status == NewsletterVerificationRequest.StatusSending)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.Status, status).SetProperty(r => r.LastOutcome, outcome).SetProperty(r => r.SentAtUtc, sentAt)
                .SetProperty(r => r.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(r => r.ProtectedToken, (string?)null), cancellationToken);
        if (releaseCooldown)
        {
            await database.NewsletterSubscriptions.Where(s => s.Id == request.SubscriptionId && s.Status == NewsletterSubscription.StatusPendingVerification)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.LastVerificationRequestedAtUtc, (DateTimeOffset?)null), cancellationToken);
        }
    }

    private async Task RetryLaterAsync(NewsletterVerificationRequest request, string outcome, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        if (request.Attempts >= options.MaxAttempts)
        {
            // Out of attempts with the outcome still unknown: stop (the visitor can ask again after the cooldown).
            await FinishAsync(request, NewsletterVerificationRequest.StatusFailed, outcome == "unknown" ? "uncertain" : "gave-up", null, false, cancellationToken);
            return;
        }

        var delay = TimeSpan.FromMinutes(Math.Min(60, Math.Pow(2, request.Attempts - 1)));
        database.ChangeTracker.Clear();
        await database.NewsletterVerificationRequests.Where(r => r.Id == request.Id && r.Status == NewsletterVerificationRequest.StatusSending)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.Status, NewsletterVerificationRequest.StatusPending).SetProperty(r => r.LastOutcome, outcome)
                .SetProperty(r => r.NextAttemptAtUtc, now + delay).SetProperty(r => r.LeaseUntilUtc, (DateTimeOffset?)null), cancellationToken);
    }

    private async Task NeedsReconnectAsync(NewsletterVerificationRequest request, CancellationToken cancellationToken)
    {
        // The request goes back to waiting and the attempt it used is given back: the connection failed, not the mail.
        database.ChangeTracker.Clear();
        await database.NewsletterVerificationRequests.Where(r => r.Id == request.Id && r.Status == NewsletterVerificationRequest.StatusSending)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.Status, NewsletterVerificationRequest.StatusPending).SetProperty(r => r.Attempts, r => r.Attempts - 1)
                .SetProperty(r => r.LastOutcome, "needs-reconnect").SetProperty(r => r.LeaseUntilUtc, (DateTimeOffset?)null), cancellationToken);
        await database.NewsletterSenderSettings.Where(s => s.Status == NewsletterSenderSettings.StatusConnected)
            .ExecuteUpdateAsync(set => set.SetProperty(s => s.Status, NewsletterSenderSettings.StatusNeedsReconnect).SetProperty(s => s.UpdatedAtUtc, timeProvider.GetUtcNow()).SetProperty(s => s.Version, s => s.Version + 1), cancellationToken);
        logger.LogWarning("The newsletter sender needs to be connected again.");
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
