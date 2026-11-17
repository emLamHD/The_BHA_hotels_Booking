using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

internal sealed class NewsletterSenderService(
    TheBhaDbContext database, TimeProvider timeProvider, NewsletterOptions options, NewsletterSecretProtector protector, IGoogleMailGateway google) : INewsletterSender
{
    private static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(10);

    private string? RedirectUri => NewsletterReadiness.IsHttpsOrigin(options.AdminOrigin) ? options.AdminOrigin!.TrimEnd('/') + NewsletterSenderRules.CallbackPath : null;

    public async Task<NewsletterSenderDto> GetAsync(CancellationToken cancellationToken)
    {
        var row = await database.NewsletterSenderSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        var pending = await database.NewsletterVerificationRequests.AsNoTracking()
            .CountAsync(request => request.Status == NewsletterVerificationRequest.StatusPending || request.Status == NewsletterVerificationRequest.StatusSending, cancellationToken);
        return ToDto(row, pending);
    }

    public async Task<NewsletterSenderProfileResult> SaveProfileAsync(string? senderName, string? replyTo, int expectedVersion, CancellationToken cancellationToken)
    {
        var name = senderName?.Trim();
        if (string.IsNullOrEmpty(name)) name = null;
        // The name goes into a mail header: a control character (a line break above all) is refused, not trimmed.
        if (name is not null && (name.Length > NewsletterSenderRules.MaxSenderNameLength || name.Any(char.IsControl)))
            return new NewsletterSenderProfileResult(false, "newsletter-sender-name-invalid", null);
        string? reply = null;
        if (!string.IsNullOrWhiteSpace(replyTo))
        {
            if (!NewsletterRules.TryNormalizeEmail(replyTo, out var normalized)) return new NewsletterSenderProfileResult(false, "newsletter-sender-reply-to-invalid", null);
            reply = normalized;
        }

        var now = timeProvider.GetUtcNow();
        // The version is checked INSIDE the write: of two saves that read the same version one UPDATE matches, the other finds it moved.
        var saved = await database.NewsletterSenderSettings.Where(row => row.Version == expectedVersion)
            .ExecuteUpdateAsync(set => set.SetProperty(row => row.SenderName, name).SetProperty(row => row.ReplyTo, reply)
                .SetProperty(row => row.Version, row => row.Version + 1).SetProperty(row => row.UpdatedAtUtc, now), cancellationToken);
        if (saved == 0)
        {
            // No row at that version: only the very first save (version 0, no row yet) goes on, and it creates the row.
            if (expectedVersion != 0 || await database.NewsletterSenderSettings.AnyAsync(cancellationToken))
                return new NewsletterSenderProfileResult(false, "newsletter-sender-version-conflict", null);
            var created = await CreateSingletonAsync(name, reply, now, cancellationToken);
            if (!created) return new NewsletterSenderProfileResult(false, "newsletter-sender-version-conflict", null);   // another first save won the row
        }

        return new NewsletterSenderProfileResult(true, null, await GetAsync(cancellationToken));
    }

    public async Task<NewsletterConnectStart> BeginConnectAsync(Guid staffId, string? clientId, string? clientSecret, bool switchAccount, CancellationToken cancellationToken)
    {
        var redirect = RedirectUri;
        if (redirect is null) return new NewsletterConnectStart(null, "newsletter-sender-redirect-uri-missing", null);
        var id = clientId?.Trim();
        if (string.IsNullOrEmpty(id) || id.Length > NewsletterSenderRules.MaxClientIdLength || id.Any(c => char.IsWhiteSpace(c) || char.IsControl(c)))
            return new NewsletterConnectStart(null, "newsletter-sender-client-id-invalid", "clientId");
        var secret = clientSecret?.Trim();
        if (clientSecret is not null && (string.IsNullOrEmpty(secret) || secret.Length > NewsletterSenderRules.MaxClientSecretLength || secret.Any(char.IsControl)))
            return new NewsletterConnectStart(null, "newsletter-sender-client-secret-invalid", "clientSecret");

        var row = await database.NewsletterSenderSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (string.IsNullOrEmpty(secret))
        {
            // The secret is write-only: leaving it out keeps the stored one, which only fits the same Client ID.
            if (row?.ClientId != id || !protector.TryUnprotect(row.ProtectedClientSecret, out secret))
                return new NewsletterConnectStart(null, "newsletter-sender-client-secret-required", "clientSecret");
        }

        var state = NewsletterTokens.NewToken();
        var verifier = NewsletterTokens.NewToken();
        var challenge = NewsletterTokens.Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var now = timeProvider.GetUtcNow();
        database.NewsletterOAuthStates.Add(new NewsletterOAuthState
        {
            Id = Guid.NewGuid(),
            StateHash = NewsletterTokens.Hash(state),
            StaffId = staffId,
            ProtectedCodeVerifier = protector.Protect(verifier),
            ClientId = id,
            ProtectedClientSecret = protector.Protect(secret),
            CreatedAtUtc = now,
            ExpiresAtUtc = now + StateLifetime
        });
        // Old attempts are noise: dropped here instead of by a job.
        await database.NewsletterOAuthStates.Where(s => s.ExpiresAtUtc < now.AddDays(-1)).ExecuteDeleteAsync(cancellationToken);
        await database.SaveChangesAsync(cancellationToken);
        return new NewsletterConnectStart(google.BuildAuthorizationUrl(id, redirect, state, challenge, switchAccount), null, null);
    }

    public async Task<NewsletterConnectResult> CompleteConnectAsync(Guid staffId, string? state, string? code, string? providerError, CancellationToken cancellationToken)
    {
        const string stateInvalid = "newsletter-connect-state-invalid";
        var redirect = RedirectUri;
        if (redirect is null || !NewsletterTokens.LooksLikeToken(state)) return new NewsletterConnectResult(false, stateInvalid, null);
        var now = timeProvider.GetUtcNow();

        // The state is spent first, whatever comes next: one try per state. It must be this Staff member's, unexpired and unused.
        var spent = await NewsletterSql.ReturningIdsAsync(database,
            """
            UPDATE "NewsletterOAuthStates" SET "ConsumedAtUtc" = @now
            WHERE "StateHash" = @hash AND "StaffId" = @staff AND "ConsumedAtUtc" IS NULL AND "ExpiresAtUtc" > @now
            RETURNING "Id"
            """,
            [("now", now), ("hash", NewsletterTokens.Hash(state!)), ("staff", staffId)], cancellationToken);
        if (spent.Count != 1) return new NewsletterConnectResult(false, stateInvalid, null);

        // The user said no (or Google refused): the current connection stays as it is.
        if (!string.IsNullOrEmpty(providerError)) return new NewsletterConnectResult(false, "newsletter-connect-cancelled", null);
        if (string.IsNullOrEmpty(code) || code.Length > 2048) return new NewsletterConnectResult(false, stateInvalid, null);

        var pendingState = await database.NewsletterOAuthStates.AsNoTracking().SingleAsync(s => s.Id == spent[0], cancellationToken);
        if (!protector.TryUnprotect(pendingState.ProtectedCodeVerifier, out var verifier) || !protector.TryUnprotect(pendingState.ProtectedClientSecret, out var secret))
            return new NewsletterConnectResult(false, stateInvalid, null);

        var tokens = await google.ExchangeCodeAsync(pendingState.ClientId, secret, code, verifier, redirect, cancellationToken);
        if (tokens.Failure != GoogleFailure.None || string.IsNullOrEmpty(tokens.AccessToken)) return new NewsletterConnectResult(false, "newsletter-connect-exchange-failed", null);
        // The user can untick the permission Google lists: without gmail.send there is nothing to send with.
        if (!(tokens.Scope ?? string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains(NewsletterSenderRules.GmailSendScope, StringComparer.Ordinal))
            return new NewsletterConnectResult(false, "newsletter-connect-scope-missing", null);
        // Without a refresh token the mail could only go while an Admin is signed in.
        if (string.IsNullOrEmpty(tokens.RefreshToken)) return new NewsletterConnectResult(false, "newsletter-connect-no-refresh-token", null);

        var info = await google.GetUserInfoAsync(tokens.AccessToken, cancellationToken);
        if (info.Failure is GoogleFailure.Transient) return new NewsletterConnectResult(false, "newsletter-connect-exchange-failed", null);
        if (info.Failure != GoogleFailure.None || !info.EmailVerified || !NewsletterRules.TryNormalizeEmail(info.Email, out var email))
            return new NewsletterConnectResult(false, "newsletter-connect-email-unverified", null);

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        // The sender row is locked BEFORE it is read: two connections that overlap are applied one after the other, each on the other's result,
        // so the epoch, the version and the generation each advance once per connection. (Lock order: settings, then subscriptions, then requests.)
        // The row exists before it is locked: a row that does not exist cannot be locked, so two first connections would both find nothing and
        // both insert. The creation is one INSERT … ON CONFLICT DO NOTHING (inside this transaction: it stays only with a connection that lands).
        await CreateSingletonAsync(null, null, now, cancellationToken);
        var row = (await database.NewsletterSenderSettings.FromSqlInterpolated($"SELECT * FROM \"NewsletterSenderSettings\" WHERE \"Id\" = {NewsletterSenderSettings.SingletonId} FOR UPDATE")
            .ToListAsync(cancellationToken)).Single();
        var changedAccount = row.ConnectedEmail is not null && !string.Equals(row.ConnectedEmail, email, StringComparison.Ordinal);
        row.ClientId = pendingState.ClientId;
        row.ProtectedClientSecret = protector.Protect(secret);
        row.ProtectedRefreshToken = protector.Protect(tokens.RefreshToken);
        row.ConnectedEmail = email;
        row.Status = NewsletterSenderSettings.StatusConnected;
        row.ConnectedAtUtc = now;
        row.ConnectedByStaffId = staffId;
        row.UpdatedAtUtc = now;
        row.Version++;
        row.ConnectionEpoch++;
        if (changedAccount) row.SenderGeneration++;
        await database.SaveChangesAsync(cancellationToken);

        if (changedAccount)
        {
            // A mail that was already tried under the old identity is not silently sent under the new one: it is withdrawn, and its
            // address may ask again at once (the cooldown is released). A mail never tried simply goes out from the new account.
            // Lock order: the SUBSCRIPTIONS first, then their requests (as in a resend and a confirmation), never the other way round.
            var affected = await NewsletterSql.ReturningIdsAsync(database,
                """
                SELECT DISTINCT "SubscriptionId" FROM "NewsletterVerificationRequests"
                WHERE "Status" IN ('Pending', 'Sending') AND "SenderGeneration" IS NOT NULL AND "SenderGeneration" < @generation
                ORDER BY "SubscriptionId"
                """,
                [("generation", row.SenderGeneration)], cancellationToken);
            if (affected.Count > 0)
            {
                var ids = affected.ToArray();
                await NewsletterSql.ReturningIdsAsync(database,
                    """SELECT "Id" FROM "NewsletterSubscriptions" WHERE "Id" = ANY(@ids) ORDER BY "Id" FOR UPDATE""",
                    [("ids", ids)], cancellationToken);
                await NewsletterSql.ReturningIdsAsync(database,
                    """
                    UPDATE "NewsletterVerificationRequests" SET "Status" = 'Cancelled', "LastOutcome" = 'sender-changed', "ProtectedToken" = NULL, "LeaseUntilUtc" = NULL, "ClaimId" = NULL
                    WHERE "Status" IN ('Pending', 'Sending') AND "SenderGeneration" IS NOT NULL AND "SenderGeneration" < @generation AND "SubscriptionId" = ANY(@ids)
                    RETURNING "Id"
                    """,
                    [("generation", row.SenderGeneration), ("ids", ids)], cancellationToken);
                await database.NewsletterSubscriptions.Where(s => ids.Contains(s.Id) && s.Status == NewsletterSubscription.StatusPendingVerification)
                    .ExecuteUpdateAsync(set => set.SetProperty(s => s.LastVerificationRequestedAtUtc, (DateTimeOffset?)null), cancellationToken);
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return new NewsletterConnectResult(true, null, await GetAsync(cancellationToken));
    }

    public async Task<NewsletterSenderDto> DisconnectAsync(CancellationToken cancellationToken)
    {
        var row = await database.NewsletterSenderSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (row is { ProtectedRefreshToken: not null })
        {
            // Revoke at Google when we can; our copy goes either way. ConnectedEmail stays, so connecting the same account again is not a new identity.
            // No row lock is held across the call to Google: the write below is one statement, applied only to the connection that was read.
            if (protector.TryUnprotect(row.ProtectedRefreshToken, out var refreshToken))
            {
                try { await google.RevokeAsync(refreshToken, cancellationToken); }
                catch (Exception exception) when (exception is not OperationCanceledException) { /* best effort */ }
            }

            var epoch = row.ConnectionEpoch;
            var now = timeProvider.GetUtcNow();
            await database.NewsletterSenderSettings.Where(s => s.ConnectionEpoch == epoch)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.ProtectedRefreshToken, (string?)null).SetProperty(s => s.Status, NewsletterSenderSettings.StatusNotConnected)
                    .SetProperty(s => s.UpdatedAtUtc, now).SetProperty(s => s.Version, s => s.Version + 1).SetProperty(s => s.ConnectionEpoch, s => s.ConnectionEpoch + 1), cancellationToken);
        }

        return await GetAsync(cancellationToken);
    }

    /// <summary>Creates the single sender row if it does not exist yet; false when it already did (the one rule for every path that can make it).</summary>
    private async Task<bool> CreateSingletonAsync(string? senderName, string? replyTo, DateTimeOffset now, CancellationToken cancellationToken) =>
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "NewsletterSenderSettings" ("Id", "SenderName", "ReplyTo", "Status", "SenderGeneration", "ConnectionEpoch", "Version", "UpdatedAtUtc")
            VALUES ({NewsletterSenderSettings.SingletonId}, {senderName}, {replyTo}, {NewsletterSenderSettings.StatusNotConnected}, 0, 0, 1, {now})
            ON CONFLICT ("Id") DO NOTHING
            """,
            cancellationToken) == 1;

    private NewsletterSenderDto ToDto(NewsletterSenderSettings? row, int pending) => new(
        row?.Status ?? NewsletterSenderSettings.StatusNotConnected,
        row?.ClientId,
        !string.IsNullOrEmpty(row?.ProtectedClientSecret),
        row?.ConnectedEmail,
        row?.SenderName,
        row?.ReplyTo,
        row?.ConnectedAtUtc,
        RedirectUri,
        NewsletterSenderRules.Scopes,
        NewsletterReadiness.IsHttpsOrigin(options.CustomerOrigin),
        row?.Version ?? 0,
        pending);
}
