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
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);

        // One statement, decided by the unique index: concurrent requests for one address insert once and the others do nothing.
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id", "Email", "Source", "Status", "ReceivedAtUtc")
            VALUES ({Guid.NewGuid()}, {normalizedEmail}, {source}, {NewsletterSubscription.StatusPendingVerification}, {now})
            ON CONFLICT ("Email") DO NOTHING
            """,
            cancellationToken);

        var canSend = await NewsletterReadiness.CanSendAsync(database, options, cancellationToken);
        if (canSend)
        {
            // The cooldown is claimed by this one conditional UPDATE: two concurrent requests both see the old stamp, the row lock
            // lets one through, the other finds the new stamp and queues nothing. A verified address is never queued.
            var cutoff = now - TimeSpan.FromSeconds(options.ResendCooldownSeconds);
            var claimed = await NewsletterSql.ReturningIdsAsync(database,
                """
                UPDATE "NewsletterSubscriptions" SET "LastVerificationRequestedAtUtc" = @now
                WHERE "Email" = @email AND "Status" = 'PendingVerification'
                  AND ("LastVerificationRequestedAtUtc" IS NULL OR "LastVerificationRequestedAtUtc" <= @cutoff)
                RETURNING "Id"
                """,
                [("now", now), ("email", normalizedEmail), ("cutoff", cutoff)], cancellationToken);

            if (claimed.Count == 1)
            {
                var subscriptionId = claimed[0];
                // Only the newest mail matters: an older one that has not gone out yet is withdrawn (its link, if it was sent, still works).
                await database.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    UPDATE "NewsletterVerificationRequests" SET "Status" = 'Cancelled', "LastOutcome" = 'superseded', "ProtectedToken" = NULL, "ClaimId" = NULL
                    WHERE "SubscriptionId" = {subscriptionId} AND "Status" = 'Pending'
                    """,
                    cancellationToken);

                var token = NewsletterTokens.NewToken();
                database.NewsletterVerificationRequests.Add(new NewsletterVerificationRequest
                {
                    Id = Guid.NewGuid(),
                    SubscriptionId = subscriptionId,
                    TokenHash = NewsletterTokens.Hash(token),
                    ProtectedToken = protector.Protect(token),
                    Language = NewsletterRules.NormalizeLanguage(language),
                    Status = NewsletterVerificationRequest.StatusPending,
                    CreatedAtUtc = now,
                    ExpiresAtUtc = now.AddHours(options.TokenLifetimeHours),
                    NextAttemptAtUtc = now
                });
                await database.SaveChangesAsync(cancellationToken);
            }
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
        var subscriptionId = await database.NewsletterVerificationRequests.AsNoTracking().Where(request => request.TokenHash == hash)
            .Select(request => (Guid?)request.SubscriptionId).SingleOrDefaultAsync(cancellationToken);
        if (subscriptionId is null) return NewsletterConfirmOutcome.Invalid;
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await NewsletterSql.ReturningIdsAsync(database, """SELECT "Id" FROM "NewsletterSubscriptions" WHERE "Id" = @id FOR UPDATE""", [("id", subscriptionId.Value)], cancellationToken);

        // The token is spent by one conditional UPDATE: of two concurrent confirmations one gets the row, the other nothing.
        var spent = await NewsletterSql.ReturningIdsAsync(database,
            """
            UPDATE "NewsletterVerificationRequests" SET "UsedAtUtc" = @now, "ProtectedToken" = NULL
            WHERE "TokenHash" = @hash AND "UsedAtUtc" IS NULL AND "ExpiresAtUtc" > @now
            RETURNING "SubscriptionId"
            """,
            [("now", now), ("hash", hash)], cancellationToken);

        NewsletterConfirmOutcome outcome;
        if (spent.Count == 1)
        {
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "NewsletterSubscriptions" SET "Status" = 'Verified', "VerifiedAtUtc" = {now}
                WHERE "Id" = {subscriptionId.Value} AND "Status" = 'PendingVerification'
                """,
                cancellationToken);
            // Nothing left to ask this address: a mail that has not gone out yet (or is held by a worker right now) is withdrawn.
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "NewsletterVerificationRequests" SET "Status" = 'Cancelled', "LastOutcome" = 'verified', "ProtectedToken" = NULL, "LeaseUntilUtc" = NULL, "ClaimId" = NULL
                WHERE "SubscriptionId" = {subscriptionId.Value} AND "Status" IN ('Pending', 'Sending')
                """,
                cancellationToken);
            outcome = NewsletterConfirmOutcome.Verified;
        }
        else
        {
            var known = await (from request in database.NewsletterVerificationRequests.AsNoTracking()
                               join subscription in database.NewsletterSubscriptions.AsNoTracking() on request.SubscriptionId equals subscription.Id
                               where request.TokenHash == hash
                               select new { request.UsedAtUtc, subscription.Status })
                .SingleOrDefaultAsync(cancellationToken);
            // A used token, or an expired one whose address is verified already, has nothing left to do: "already confirmed".
            outcome = known switch
            {
                null => NewsletterConfirmOutcome.Invalid,
                { UsedAtUtc: not null } or { Status: NewsletterSubscription.StatusVerified } => NewsletterConfirmOutcome.AlreadyVerified,
                _ => NewsletterConfirmOutcome.Expired
            };
        }

        await transaction.CommitAsync(cancellationToken);
        return outcome;
    }

    public async Task<NewsletterSubscriptionPageDto> ListAsync(string? search, int page, int pageSize, CancellationToken cancellationToken)
    {
        var query = database.NewsletterSubscriptions.AsNoTracking();
        var term = search?.Trim();
        if (!string.IsNullOrEmpty(term))
        {
            // The term is data, not a pattern: % _ and \ are escaped.
            var pattern = "%" + term.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal) + "%";
            query = query.Where(row => EF.Functions.ILike(row.Email, pattern, "\\"));
        }

        var total = await query.CountAsync(cancellationToken);
        // The offset is 64-bit: page 2147483647 of 100 would overflow an int and become a negative OFFSET. Past the end is an empty page.
        if ((long)(page - 1) * pageSize >= total)
        {
            return new NewsletterSubscriptionPageDto([], page, pageSize, total);
        }

        var rows = await query.OrderByDescending(row => row.ReceivedAtUtc).ThenByDescending(row => row.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(row => new NewsletterSubscriptionDto(row.Id, row.Email, row.ReceivedAtUtc, row.Source, row.Status, row.VerifiedAtUtc))
            .ToListAsync(cancellationToken);
        return new NewsletterSubscriptionPageDto(rows, page, pageSize, total);
    }
}
