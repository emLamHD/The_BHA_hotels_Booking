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
        var row = await database.NewsletterSenderSettings.SingleOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            if (expectedVersion != 0) return new NewsletterSenderProfileResult(false, "newsletter-sender-version-conflict", null);
            row = new NewsletterSenderSettings { SenderName = name, ReplyTo = reply, UpdatedAtUtc = now };
            database.NewsletterSenderSettings.Add(row);
        }
        else
        {
            if (row.Version != expectedVersion) return new NewsletterSenderProfileResult(false, "newsletter-sender-version-conflict", null);
            row.SenderName = name;
            row.ReplyTo = reply;
            row.Version++;
            row.UpdatedAtUtc = now;
        }

        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two first saves raced for the single row: the loser is told to read again.
            return new NewsletterSenderProfileResult(false, "newsletter-sender-version-conflict", null);
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
        var row = await database.NewsletterSenderSettings.SingleOrDefaultAsync(cancellationToken);
        var isNew = row is null;
        row ??= new NewsletterSenderSettings();
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
        if (changedAccount) row.SenderGeneration++;
        if (isNew) database.NewsletterSenderSettings.Add(row);
        await database.SaveChangesAsync(cancellationToken);

        if (changedAccount)
        {
            // A mail that was already tried under the old identity is not silently sent under the new one: it is withdrawn, and its
            // address may ask again at once (the cooldown is released). A mail never tried simply goes out from the new account.
            var withdrawn = await NewsletterSql.ReturningIdsAsync(database,
                """
                UPDATE "NewsletterVerificationRequests" SET "Status" = 'Cancelled', "LastOutcome" = 'sender-changed', "ProtectedToken" = NULL, "LeaseUntilUtc" = NULL
                WHERE "Status" IN ('Pending', 'Sending') AND "SenderGeneration" IS NOT NULL AND "SenderGeneration" < @generation
                RETURNING "SubscriptionId"
                """,
                [("generation", row.SenderGeneration)], cancellationToken);
            if (withdrawn.Count > 0)
            {
                await database.NewsletterSubscriptions.Where(s => withdrawn.Contains(s.Id) && s.Status == NewsletterSubscription.StatusPendingVerification)
                    .ExecuteUpdateAsync(set => set.SetProperty(s => s.LastVerificationRequestedAtUtc, (DateTimeOffset?)null), cancellationToken);
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return new NewsletterConnectResult(true, null, await GetAsync(cancellationToken));
    }

    public async Task<NewsletterSenderDto> DisconnectAsync(CancellationToken cancellationToken)
    {
        var row = await database.NewsletterSenderSettings.SingleOrDefaultAsync(cancellationToken);
        if (row is { ProtectedRefreshToken: not null })
        {
            // Revoke at Google when we can; our copy goes either way. ConnectedEmail stays, so connecting the same account again is not a new identity.
            if (protector.TryUnprotect(row.ProtectedRefreshToken, out var refreshToken))
            {
                try { await google.RevokeAsync(refreshToken, cancellationToken); }
                catch (Exception exception) when (exception is not OperationCanceledException) { /* best effort */ }
            }

            row.ProtectedRefreshToken = null;
            row.Status = NewsletterSenderSettings.StatusNotConnected;
            row.UpdatedAtUtc = timeProvider.GetUtcNow();
            row.Version++;
            await database.SaveChangesAsync(cancellationToken);
        }

        return await GetAsync(cancellationToken);
    }

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
