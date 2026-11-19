using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Website;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Persistence.Newsletter;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-NEWSLETTER-003: Staff operations on newsletter subscriptions. Every write is one transaction that takes the subscription's row lock FIRST (then its mails, as every
/// other path does), compares the version the screen holds with the stored one, writes with the new version, withdraws the mails that no longer apply (waiting ones AND
/// ones a worker holds, so the worker's last look finds nothing it owns) and records the action without the address.
/// </summary>
internal sealed class NewsletterSubscriptionAdminService(
    TheBhaDbContext database, TimeProvider timeProvider, NewsletterOptions options, NewsletterSecretProtector protector) : INewsletterSubscriptionAdmin
{
    private const string UniqueAddressIndex = "UX_NewsletterSubscriptions_Email";

    public async Task<NewsletterAdminResult<NewsletterSubscriptionDto>> CreateAsync(Guid actorStaffId, string? email, string? language, CancellationToken cancellationToken)
    {
        if (!NewsletterRules.TryNormalizeEmail(email, out var normalized)) return Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.Invalid, "newsletter-email-invalid", "email");
        if (!TryLanguage(language, out var lang)) return Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.Invalid, "newsletter-language-invalid", "language");

        var now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        // One statement decided by the unique index: of two Staff members adding one address, one row is written and the other is told which row holds it.
        var id = Guid.NewGuid();
        var inserted = await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id", "Email", "Source", "Status", "ReceivedAtUtc", "Language", "CreatedByStaffId")
            VALUES ({id}, {normalized}, 'admin', 'PendingVerification', {now}, {lang}, {actorStaffId})
            ON CONFLICT ("Email") DO NOTHING
            """,
            cancellationToken);
        if (inserted == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return await DuplicateAsync<NewsletterSubscriptionDto>(normalized, cancellationToken);
        }

        NewsletterLifecycle.Audit(database, id, "created", actorStaffId, now);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return NewsletterAdminResult<NewsletterSubscriptionDto>.Ok((await NewsletterLifecycle.ReadAsync(database, id, cancellationToken))!);
    }

    public async Task<NewsletterAdminResult<NewsletterSubscriptionDto>> UpdateAsync(
        Guid actorStaffId, Guid id, int expectedVersion, string? email, string? language, CancellationToken cancellationToken)
    {
        string? newEmail = null;
        if (email is not null)
        {
            if (!NewsletterRules.TryNormalizeEmail(email, out var normalized)) return Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.Invalid, "newsletter-email-invalid", "email");
            newEmail = normalized;
        }

        string? newLanguage = null;
        if (language is not null)
        {
            if (!TryLanguage(language, out var lang)) return Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.Invalid, "newsletter-language-invalid", "language");
            newLanguage = lang;
        }

        var now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var (current, refusal) = await LockAndCheckAsync(id, expectedVersion, transaction, cancellationToken);
        if (refusal is not null) return refusal;

        var emailChanged = newEmail is not null && newEmail != current!.Email;
        var languageChanged = newLanguage is not null && newLanguage != current!.Language;
        if (!emailChanged && !languageChanged)
        {
            await transaction.CommitAsync(cancellationToken);
            return NewsletterAdminResult<NewsletterSubscriptionDto>.Ok(current!);
        }

        try
        {
            var written = emailChanged
                // A new address has confirmed nothing and unsubscribed from nothing: back to pending, its cooldown cleared. The language travels with it.
                ? await database.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    UPDATE "NewsletterSubscriptions" SET "Email" = {newEmail}, "Status" = 'PendingVerification', "VerifiedAtUtc" = NULL, "UnsubscribedAtUtc" = NULL,
                        "LastVerificationRequestedAtUtc" = NULL, "Language" = {newLanguage ?? current!.Language}, "Version" = "Version" + 1
                    WHERE "Id" = {id} AND "Version" = {expectedVersion}
                    """,
                    cancellationToken)
                : await database.Database.ExecuteSqlInterpolatedAsync(
                    $"""UPDATE "NewsletterSubscriptions" SET "Language" = {newLanguage}, "Version" = "Version" + 1 WHERE "Id" = {id} AND "Version" = {expectedVersion}""",
                    cancellationToken);
            if (written != 1)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.Conflict, "newsletter-version-conflict");
            }
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation && exception.ConstraintName == UniqueAddressIndex)
        {
            await transaction.RollbackAsync(cancellationToken);
            return await DuplicateAsync<NewsletterSubscriptionDto>(newEmail!, cancellationToken);
        }

        if (emailChanged)
        {
            // The mails and the links of the OLD address are void: a link already sent to it must not verify (or unsubscribe) the new one.
            await NewsletterLifecycle.WithdrawMailsAsync(database, id, "email-changed", revokeTokens: true, now, cancellationToken);
        }
        else
        {
            // Only a language change: the status stays, and a mail still waiting is written in the new language.
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""UPDATE "NewsletterVerificationRequests" SET "Language" = {newLanguage} WHERE "SubscriptionId" = {id} AND "Status" = 'Pending'""", cancellationToken);
        }

        NewsletterLifecycle.Audit(database, id, "edited", actorStaffId, now, emailChanged && languageChanged ? "email,language" : emailChanged ? "email" : "language");
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return NewsletterAdminResult<NewsletterSubscriptionDto>.Ok((await NewsletterLifecycle.ReadAsync(database, id, cancellationToken))!);
    }

    public async Task<NewsletterAdminResult<NewsletterInviteResult>> InviteAsync(Guid actorStaffId, Guid id, int expectedVersion, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        // The invitation goes to the address the Staff member SAW: the row is locked first, and the version their screen holds is compared with the one stored after any
        // wait for the lock, before anything is decided about readiness, the cooldown or the outbox. A row changed since (its address included) is a 409, not a mail.
        var (_, refusal) = await LockAndCheckAsync(id, expectedVersion, transaction, cancellationToken);
        if (refusal is not null) return Refuse<NewsletterInviteResult>(refusal.Status, refusal.Code!, refusal.Field);

        var row = await database.NewsletterSubscriptions.AsNoTracking().SingleAsync(s => s.Id == id, cancellationToken);
        // Only the owner of the mailbox can verify it: nothing is invited that is already verified, was unsubscribed (the visitor must ask again) or is hidden.
        if (row.Status != NewsletterSubscription.StatusPendingVerification) return await RefuseAsync<NewsletterInviteResult>(transaction, "newsletter-invite-not-pending", cancellationToken);
        if (row.ArchivedAtUtc is not null) return await RefuseAsync<NewsletterInviteResult>(transaction, "newsletter-subscription-archived", cancellationToken);

        NewsletterInviteOutcome outcome;
        int? retryAfter = null;
        if (!await NewsletterReadiness.CanSendAsync(database, options, cancellationToken))
        {
            // No sender: nothing is queued and no cooldown is written, so connecting Gmail later does not make this address wait.
            outcome = NewsletterInviteOutcome.NotConnected;
        }
        else if (await NewsletterLifecycle.TryQueueVerificationAsync(database, options, protector, id, row.Language, now, cancellationToken))
        {
            outcome = NewsletterInviteOutcome.Queued;
            NewsletterLifecycle.Audit(database, id, "invited", actorStaffId, now);
            await database.SaveChangesAsync(cancellationToken);
        }
        else
        {
            outcome = NewsletterInviteOutcome.Cooldown;
            var until = row.LastVerificationRequestedAtUtc!.Value + TimeSpan.FromSeconds(options.ResendCooldownSeconds);
            retryAfter = Math.Max(1, (int)Math.Ceiling((until - now).TotalSeconds));
        }

        await transaction.CommitAsync(cancellationToken);
        var dto = (await NewsletterLifecycle.ReadAsync(database, id, cancellationToken))!;
        return NewsletterAdminResult<NewsletterInviteResult>.Ok(new NewsletterInviteResult(outcome, retryAfter, dto));
    }

    public Task<NewsletterAdminResult<NewsletterSubscriptionDto>> UnsubscribeAsync(Guid actorStaffId, Guid id, int expectedVersion, CancellationToken cancellationToken) =>
        ChangeAsync(actorStaffId, id, expectedVersion, "unsubscribed", "unsubscribed", cancellationToken,
            current => current.Status == NewsletterSubscription.StatusUnsubscribed,
            (now, token) => database.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "NewsletterSubscriptions" SET "Status" = 'Unsubscribed', "UnsubscribedAtUtc" = {now}, "LastVerificationRequestedAtUtc" = NULL, "Version" = "Version" + 1
                WHERE "Id" = {id} AND "Version" = {expectedVersion}
                """,
                token));

    public Task<NewsletterAdminResult<NewsletterSubscriptionDto>> SetArchivedAsync(Guid actorStaffId, Guid id, int expectedVersion, bool archived, CancellationToken cancellationToken) =>
        archived
            ? ChangeAsync(actorStaffId, id, expectedVersion, "archived", "archived", cancellationToken,
                current => current.ArchivedAtUtc is not null,
                (now, token) => database.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    UPDATE "NewsletterSubscriptions" SET "ArchivedAtUtc" = {now}, "LastVerificationRequestedAtUtc" = NULL, "Version" = "Version" + 1
                    WHERE "Id" = {id} AND "Version" = {expectedVersion}
                    """,
                    token))
            : ChangeAsync(actorStaffId, id, expectedVersion, "restored", null, cancellationToken,
                current => current.ArchivedAtUtc is null,
                (_, token) => database.Database.ExecuteSqlInterpolatedAsync(
                    $"""UPDATE "NewsletterSubscriptions" SET "ArchivedAtUtc" = NULL, "Version" = "Version" + 1 WHERE "Id" = {id} AND "Version" = {expectedVersion}""",
                    token));

    public async Task<NewsletterAdminResult<bool>> DeleteAsync(Guid actorStaffId, Guid id, int expectedVersion, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var (_, refusal) = await LockAndCheckAsync(id, expectedVersion, transaction, cancellationToken);
        if (refusal is not null) return NewsletterAdminResult<bool>.Refused(refusal.Status, refusal.Code!, refusal.Field);

        // The mails first (their key to the subscription is Restrict), then the row. A worker that held one of them loses its claim with the row: its writes match nothing.
        await database.Database.ExecuteSqlInterpolatedAsync($"""DELETE FROM "NewsletterVerificationRequests" WHERE "SubscriptionId" = {id}""", cancellationToken);
        var removed = await database.Database.ExecuteSqlInterpolatedAsync($"""DELETE FROM "NewsletterSubscriptions" WHERE "Id" = {id} AND "Version" = {expectedVersion}""", cancellationToken);
        if (removed != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return NewsletterAdminResult<bool>.Refused(NewsletterAdminStatus.Conflict, "newsletter-version-conflict");
        }

        NewsletterLifecycle.Audit(database, id, "deleted", actorStaffId, now);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return NewsletterAdminResult<bool>.Ok(true);
    }

    /// <summary>The shape of unsubscribe, archive and restore: lock, check the version, apply one statement, withdraw the mails when asked, audit, read back.</summary>
    private async Task<NewsletterAdminResult<NewsletterSubscriptionDto>> ChangeAsync(
        Guid actorStaffId, Guid id, int expectedVersion, string action, string? withdrawOutcome, CancellationToken cancellationToken,
        Func<NewsletterSubscriptionDto, bool> alreadyDone, Func<DateTimeOffset, CancellationToken, Task<int>> write)
    {
        var now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var (current, refusal) = await LockAndCheckAsync(id, expectedVersion, transaction, cancellationToken);
        if (refusal is not null) return refusal;
        if (alreadyDone(current!))
        {
            // Repeating an operation that already holds changes nothing (no new version, no audit row).
            await transaction.CommitAsync(cancellationToken);
            return NewsletterAdminResult<NewsletterSubscriptionDto>.Ok(current!);
        }

        if (await write(now, cancellationToken) != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.Conflict, "newsletter-version-conflict");
        }

        if (withdrawOutcome is not null) await NewsletterLifecycle.WithdrawMailsAsync(database, id, withdrawOutcome, revokeTokens: false, now, cancellationToken);
        NewsletterLifecycle.Audit(database, id, action, actorStaffId, now);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return NewsletterAdminResult<NewsletterSubscriptionDto>.Ok((await NewsletterLifecycle.ReadAsync(database, id, cancellationToken))!);
    }

    /// <summary>
    /// Locks the row, then compares the version. The refusal (not found, or a stale version) comes with the transaction already rolled back. The version is checked again in
    /// the writing statement itself, so the rule holds even for a caller that skipped this look.
    /// </summary>
    private async Task<(NewsletterSubscriptionDto? Current, NewsletterAdminResult<NewsletterSubscriptionDto>? Refusal)> LockAndCheckAsync(
        Guid id, int expectedVersion, Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        if (!await NewsletterLifecycle.LockAsync(database, id, cancellationToken))
        {
            await transaction.RollbackAsync(cancellationToken);
            return (null, Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.NotFound, "newsletter-subscription-not-found"));
        }

        var current = (await NewsletterLifecycle.ReadAsync(database, id, cancellationToken))!;
        if (current.Version != expectedVersion)
        {
            await transaction.RollbackAsync(cancellationToken);
            return (null, Refuse<NewsletterSubscriptionDto>(NewsletterAdminStatus.Conflict, "newsletter-version-conflict"));
        }

        return (current, null);
    }

    private async Task<NewsletterAdminResult<T>> DuplicateAsync<T>(string email, CancellationToken cancellationToken)
    {
        var existing = await database.NewsletterSubscriptions.AsNoTracking().Where(s => s.Email == email).Select(s => new { s.Id, Archived = s.ArchivedAtUtc != null }).SingleOrDefaultAsync(cancellationToken);
        return new NewsletterAdminResult<T>(NewsletterAdminStatus.Conflict, "newsletter-subscription-duplicate", "email", default, existing?.Id, existing?.Archived ?? false);
    }

    private static async Task<NewsletterAdminResult<T>> RefuseAsync<T>(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction, string code, CancellationToken cancellationToken)
    {
        await transaction.RollbackAsync(cancellationToken);
        return Refuse<T>(NewsletterAdminStatus.Conflict, code);
    }

    private static NewsletterAdminResult<T> Refuse<T>(NewsletterAdminStatus status, string code, string? field = null) => NewsletterAdminResult<T>.Refused(status, code, field);

    /// <summary>Staff name the language: nothing (the site default) or one of the three; anything else is refused rather than silently replaced.</summary>
    private static bool TryLanguage(string? raw, out string language)
    {
        language = NewsletterRules.DefaultLanguage;
        if (string.IsNullOrWhiteSpace(raw)) return true;
        var match = NewsletterRules.Languages.FirstOrDefault(l => string.Equals(l, raw.Trim(), StringComparison.OrdinalIgnoreCase));
        if (match is null) return false;
        language = match;
        return true;
    }
}
