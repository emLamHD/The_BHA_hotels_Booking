using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Persistence.Newsletter;

namespace TheBha.Infrastructure.Persistence;

internal sealed class NewsletterSubscriptionService(
    TheBhaDbContext database, TimeProvider timeProvider, NewsletterOptions options, NewsletterSecretProtector protector) : INewsletterSubscriptions
{
    public async Task<NewsletterSubscribeResult> SubscribeAsync(string normalizedEmail, string source, string language, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var lang = NewsletterRules.NormalizeLanguage(language);
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);

        // One statement, decided by the unique index: concurrent requests for one address insert once and the others do nothing.
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id", "Email", "Source", "Status", "ReceivedAtUtc", "Language")
            VALUES ({Guid.NewGuid()}, {normalizedEmail}, {source}, {NewsletterSubscription.StatusPendingVerification}, {now}, {lang})
            ON CONFLICT ("Email") DO NOTHING
            """,
            cancellationToken);

        // The visitor's own request is what brings an unsubscribed address back, and only to "pending": the mailbox must confirm again (double opt-in).
        // It also un-hides an archived row. One statement each, so concurrent requests change a row once.
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE "NewsletterSubscriptions" SET "Status" = 'PendingVerification', "VerifiedAtUtc" = NULL, "UnsubscribedAtUtc" = NULL, "ArchivedAtUtc" = NULL,
                "LastVerificationRequestedAtUtc" = NULL, "Language" = {lang}, "Version" = "Version" + 1
            WHERE "Email" = {normalizedEmail} AND "Status" = 'Unsubscribed'
            """,
            cancellationToken);
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""UPDATE "NewsletterSubscriptions" SET "ArchivedAtUtc" = NULL, "Version" = "Version" + 1 WHERE "Email" = {normalizedEmail} AND "ArchivedAtUtc" IS NOT NULL""",
            cancellationToken);

        var canSend = await NewsletterReadiness.CanSendAsync(database, options, cancellationToken);
        if (canSend)
        {
            var subscriptionId = await database.NewsletterSubscriptions.AsNoTracking().Where(s => s.Email == normalizedEmail).Select(s => s.Id).SingleAsync(cancellationToken);
            await NewsletterLifecycle.TryQueueVerificationAsync(database, options, protector, subscriptionId, lang, now, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return new NewsletterSubscribeResult(canSend);
    }

    public async Task<NewsletterConfirmOutcome> ConfirmAsync(string token, CancellationToken cancellationToken)
    {
        if (!NewsletterTokens.LooksLikeToken(token)) return NewsletterConfirmOutcome.Invalid;
        var hash = NewsletterTokens.Hash(token);
        var now = timeProvider.GetUtcNow();

        // Lock order is the SUBSCRIPTION first, then its requests (as in a resend and a change of sender): the address is found by the token's
        // hash, its row is locked, and only then is the token spent. Taken the other way round, a confirmation and a resend deadlock.
        // Only a confirmation's token confirms (a Welcome's token only unsubscribes), and a token whose address was changed is void.
        var subscriptionId = await database.NewsletterVerificationRequests.AsNoTracking()
            .Where(request => request.TokenHash == hash && request.Purpose == NewsletterVerificationRequest.PurposeVerification && request.RevokedAtUtc == null)
            .Select(request => (Guid?)request.SubscriptionId).SingleOrDefaultAsync(cancellationToken);
        if (subscriptionId is null) return NewsletterConfirmOutcome.Invalid;
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        // The address may have been deleted between the lookup and the lock: then the link has nothing left to confirm.
        if (!await NewsletterLifecycle.LockAsync(database, subscriptionId.Value, cancellationToken))
        {
            await transaction.RollbackAsync(cancellationToken);
            return NewsletterConfirmOutcome.Invalid;
        }

        // The token is spent by one conditional UPDATE: of two concurrent confirmations one gets the row, the other nothing.
        var spent = await NewsletterSql.ReturningIdsAsync(database,
            """
            UPDATE "NewsletterVerificationRequests" SET "UsedAtUtc" = @now, "ProtectedToken" = NULL
            WHERE "TokenHash" = @hash AND "Purpose" = 'Verification' AND "RevokedAtUtc" IS NULL AND "UsedAtUtc" IS NULL AND "ExpiresAtUtc" > @now
            RETURNING "SubscriptionId"
            """,
            [("now", now), ("hash", hash)], cancellationToken);

        NewsletterConfirmOutcome outcome;
        if (spent.Count == 1)
        {
            // The Welcome belongs to the ROW that really moves from pending to verified, not to every spent token: a superseded link that was already sent can still be
            // pressed, and so can a second link of one address; they spend a token but move nothing. The number of rows the UPDATE changed says which call moved the row.
            var moved = await database.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "NewsletterSubscriptions" SET "Status" = 'Verified', "VerifiedAtUtc" = {now}, "ArchivedAtUtc" = NULL, "Version" = "Version" + 1
                WHERE "Id" = {subscriptionId.Value} AND "Status" = 'PendingVerification'
                """,
                cancellationToken);
            if (moved == 1)
            {
                // Nothing left to ask this address: a confirmation that has not gone out yet (or is held by a worker right now) is withdrawn. A Welcome is not.
                await database.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    UPDATE "NewsletterVerificationRequests" SET "Status" = 'Cancelled', "LastOutcome" = 'verified', "ProtectedToken" = NULL, "LeaseUntilUtc" = NULL, "ClaimId" = NULL
                    WHERE "SubscriptionId" = {subscriptionId.Value} AND "Purpose" = 'Verification' AND "Status" IN ('Pending', 'Sending')
                    """,
                    cancellationToken);
                var language = await database.NewsletterSubscriptions.AsNoTracking().Where(s => s.Id == subscriptionId.Value).Select(s => s.Language).SingleAsync(cancellationToken);
                await NewsletterLifecycle.QueueWelcomeAsync(database, options, protector, subscriptionId.Value, language, now, cancellationToken);
                outcome = NewsletterConfirmOutcome.Verified;
            }
            else
            {
                var status = await database.NewsletterSubscriptions.AsNoTracking().Where(s => s.Id == subscriptionId.Value).Select(s => s.Status).SingleAsync(cancellationToken);
                // Verified already: nothing to do. Unsubscribed (the mail was stopped after this link was sent): the link no longer confirms anything.
                outcome = status == NewsletterSubscription.StatusVerified ? NewsletterConfirmOutcome.AlreadyVerified : NewsletterConfirmOutcome.Invalid;
            }
        }
        else
        {
            var known = await (from request in database.NewsletterVerificationRequests.AsNoTracking()
                               join subscription in database.NewsletterSubscriptions.AsNoTracking() on request.SubscriptionId equals subscription.Id
                               where request.TokenHash == hash && request.Purpose == NewsletterVerificationRequest.PurposeVerification
                               select new { request.UsedAtUtc, subscription.Status })
                .SingleOrDefaultAsync(cancellationToken);
            // A used token, or an expired one whose address is verified already, has nothing left to do: "already confirmed".
            outcome = known switch
            {
                null => NewsletterConfirmOutcome.Invalid,
                { UsedAtUtc: not null } or { Status: NewsletterSubscription.StatusVerified } => NewsletterConfirmOutcome.AlreadyVerified,
                { Status: NewsletterSubscription.StatusUnsubscribed } => NewsletterConfirmOutcome.Invalid,
                _ => NewsletterConfirmOutcome.Expired
            };
        }

        await transaction.CommitAsync(cancellationToken);
        return outcome;
    }

    public async Task<NewsletterUnsubscribeOutcome> UnsubscribeAsync(string token, CancellationToken cancellationToken)
    {
        if (!NewsletterTokens.LooksLikeToken(token)) return NewsletterUnsubscribeOutcome.Invalid;
        var hash = NewsletterTokens.Hash(token);
        var now = timeProvider.GetUtcNow();

        // Only a Welcome's token unsubscribes, and its deadline is the deadline for SENDING the mail, not for leaving the list.
        var subscriptionId = await database.NewsletterVerificationRequests.AsNoTracking()
            .Where(request => request.TokenHash == hash && request.Purpose == NewsletterVerificationRequest.PurposeWelcome && request.RevokedAtUtc == null)
            .Select(request => (Guid?)request.SubscriptionId).SingleOrDefaultAsync(cancellationToken);
        if (subscriptionId is null) return NewsletterUnsubscribeOutcome.Invalid;

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        if (!await NewsletterLifecycle.LockAsync(database, subscriptionId.Value, cancellationToken))
        {
            await transaction.RollbackAsync(cancellationToken);
            return NewsletterUnsubscribeOutcome.Invalid;
        }

        var moved = await NewsletterSql.ReturningIdsAsync(database,
            """
            UPDATE "NewsletterSubscriptions" SET "Status" = 'Unsubscribed', "UnsubscribedAtUtc" = @now, "LastVerificationRequestedAtUtc" = NULL, "Version" = "Version" + 1
            WHERE "Id" = @id AND "Status" <> 'Unsubscribed'
            RETURNING "Id"
            """,
            [("now", now), ("id", subscriptionId.Value)], cancellationToken);
        if (moved.Count == 1)
        {
            await NewsletterLifecycle.WithdrawMailsAsync(database, subscriptionId.Value, "unsubscribed", revokeTokens: false, now, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return moved.Count == 1 ? NewsletterUnsubscribeOutcome.Unsubscribed : NewsletterUnsubscribeOutcome.AlreadyUnsubscribed;
    }

    public async Task<NewsletterSubscriptionPageDto> ListAsync(string? search, string? status, string scope, int page, int pageSize, CancellationToken cancellationToken)
    {
        var query = database.NewsletterSubscriptions.AsNoTracking();
        var term = search?.Trim();
        if (!string.IsNullOrEmpty(term))
        {
            // The term is data, not a pattern: % _ and \ are escaped.
            var pattern = "%" + term.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal) + "%";
            query = query.Where(row => EF.Functions.ILike(row.Email, pattern, "\\"));
        }

        if (!string.IsNullOrEmpty(status)) query = query.Where(row => row.Status == status);
        if (scope == NewsletterListScope.Active) query = query.Where(row => row.ArchivedAtUtc == null);
        else if (scope == NewsletterListScope.Archived) query = query.Where(row => row.ArchivedAtUtc != null);

        var total = await query.CountAsync(cancellationToken);
        // The offset is 64-bit: page 2147483647 of 100 would overflow an int and become a negative OFFSET. Past the end is an empty page.
        if ((long)(page - 1) * pageSize >= total)
        {
            return new NewsletterSubscriptionPageDto([], page, pageSize, total);
        }

        var rows = await NewsletterLifecycle.Project(query.OrderByDescending(row => row.ReceivedAtUtc).ThenByDescending(row => row.Id).Skip((page - 1) * pageSize).Take(pageSize), database)
            .ToListAsync(cancellationToken);
        return new NewsletterSubscriptionPageDto(rows, page, pageSize, total);
    }
}
