using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>
/// The rules every path that touches a subscription's mail shares (the public form, a confirmation, an unsubscribe link, Staff in Admin). They all run inside the
/// caller's transaction and in ONE lock order: the subscription row first, then its mails. Taken the other way round, a Staff edit and a worker deadlock.
/// </summary>
internal static class NewsletterLifecycle
{
    /// <summary>Locks the subscription (<c>FOR UPDATE</c>); false when it does not exist (any more).</summary>
    public static async Task<bool> LockAsync(TheBhaDbContext database, Guid subscriptionId, CancellationToken ct) =>
        (await NewsletterSql.ReturningIdsAsync(database, """SELECT "Id" FROM "NewsletterSubscriptions" WHERE "Id" = @id FOR UPDATE""", [("id", subscriptionId)], ct)).Count == 1;

    /// <summary>
    /// Withdraws every mail of the subscription that has not gone out: waiting ones and ones a worker holds right now. The worker's claim and lease are cleared, so its
    /// last look before sending (and every later write of its own) finds nothing it owns. A mail already sent stays as history. The link of a mail that was
    /// sent still works unless <paramref name="revokeTokens"/> says the address itself changed.
    /// </summary>
    public static async Task WithdrawMailsAsync(TheBhaDbContext database, Guid subscriptionId, string outcome, bool revokeTokens, DateTimeOffset now, CancellationToken ct)
    {
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE "NewsletterVerificationRequests" SET "Status" = 'Cancelled', "LastOutcome" = {outcome}, "ProtectedToken" = NULL, "LeaseUntilUtc" = NULL, "ClaimId" = NULL
            WHERE "SubscriptionId" = {subscriptionId} AND "Status" IN ('Pending', 'Sending')
            """,
            ct);
        if (revokeTokens)
        {
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""UPDATE "NewsletterVerificationRequests" SET "RevokedAtUtc" = {now} WHERE "SubscriptionId" = {subscriptionId} AND "RevokedAtUtc" IS NULL""", ct);
        }
    }

    /// <summary>
    /// Queues ONE confirmation mail for a pending, not archived address if the resend cooldown allows. The cooldown is claimed by one conditional UPDATE: two concurrent
    /// requests both see the old stamp, the row lock lets one through, the other finds the new stamp and queues nothing. Returns whether this call queued the mail.
    /// </summary>
    public static async Task<bool> TryQueueVerificationAsync(
        TheBhaDbContext database, NewsletterOptions options, NewsletterSecretProtector protector, Guid subscriptionId, string language, DateTimeOffset now, CancellationToken ct)
    {
        var cutoff = now - TimeSpan.FromSeconds(options.ResendCooldownSeconds);
        var claimed = await NewsletterSql.ReturningIdsAsync(database,
            """
            UPDATE "NewsletterSubscriptions" SET "LastVerificationRequestedAtUtc" = @now
            WHERE "Id" = @id AND "Status" = 'PendingVerification' AND "ArchivedAtUtc" IS NULL
              AND ("LastVerificationRequestedAtUtc" IS NULL OR "LastVerificationRequestedAtUtc" <= @cutoff)
            RETURNING "Id"
            """,
            [("now", now), ("id", subscriptionId), ("cutoff", cutoff)], ct);
        if (claimed.Count != 1) return false;

        // Only the newest confirmation mail matters: an older one that has not gone out yet is withdrawn (its link, if it was sent, still works). A Welcome is not touched.
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE "NewsletterVerificationRequests" SET "Status" = 'Cancelled', "LastOutcome" = 'superseded', "ProtectedToken" = NULL, "ClaimId" = NULL
            WHERE "SubscriptionId" = {subscriptionId} AND "Purpose" = 'Verification' AND "Status" = 'Pending'
            """,
            ct);

        var token = NewsletterTokens.NewToken();
        database.NewsletterVerificationRequests.Add(new NewsletterVerificationRequest
        {
            Id = Guid.NewGuid(),
            SubscriptionId = subscriptionId,
            Purpose = NewsletterVerificationRequest.PurposeVerification,
            TokenHash = NewsletterTokens.Hash(token),
            ProtectedToken = protector.Protect(token),
            Language = NewsletterRules.NormalizeLanguage(language),
            Status = NewsletterVerificationRequest.StatusPending,
            CreatedAtUtc = now,
            ExpiresAtUtc = now.AddHours(options.TokenLifetimeHours),
            NextAttemptAtUtc = now
        });
        await database.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Queues the Welcome for a verification that has JUST happened. Only the caller that really moved the row from pending to verified may call it, inside that
    /// transaction; the unique index on (subscription, verification instant) refuses a second one whatever the code does. The token it carries only unsubscribes.
    /// </summary>
    public static async Task QueueWelcomeAsync(
        TheBhaDbContext database, NewsletterOptions options, NewsletterSecretProtector protector, Guid subscriptionId, string language, DateTimeOffset verifiedAt, CancellationToken ct)
    {
        var token = NewsletterTokens.NewToken();
        database.NewsletterVerificationRequests.Add(new NewsletterVerificationRequest
        {
            Id = Guid.NewGuid(),
            SubscriptionId = subscriptionId,
            Purpose = NewsletterVerificationRequest.PurposeWelcome,
            ForVerifiedAtUtc = verifiedAt,
            TokenHash = NewsletterTokens.Hash(token),
            ProtectedToken = protector.Protect(token),
            Language = NewsletterRules.NormalizeLanguage(language),
            Status = NewsletterVerificationRequest.StatusPending,
            CreatedAtUtc = verifiedAt,
            // The deadline for SENDING it; the unsubscribe link inside stays valid after it.
            ExpiresAtUtc = verifiedAt.AddHours(options.WelcomeLifetimeHours),
            NextAttemptAtUtc = verifiedAt
        });
        await database.SaveChangesAsync(ct);
    }

    public static void Audit(TheBhaDbContext database, Guid subscriptionId, string action, Guid actorStaffId, DateTimeOffset now, string? detail = null) =>
        database.NewsletterSubscriptionAudits.Add(new NewsletterSubscriptionAudit
        {
            Id = Guid.NewGuid(), SubscriptionId = subscriptionId, Action = action, ActorStaffId = actorStaffId, OccurredAtUtc = now, Detail = detail
        });

    /// <summary>The subscription as Staff see it, read inside the caller's transaction or after it. Null when it does not exist.</summary>
    public static Task<NewsletterSubscriptionDto?> ReadAsync(TheBhaDbContext database, Guid subscriptionId, CancellationToken ct) =>
        Project(database.NewsletterSubscriptions.AsNoTracking().Where(s => s.Id == subscriptionId), database).SingleOrDefaultAsync(ct);

    public static IQueryable<NewsletterSubscriptionDto> Project(IQueryable<NewsletterSubscription> rows, TheBhaDbContext database) =>
        rows.Select(s => new NewsletterSubscriptionDto(
            s.Id, s.Email, s.ReceivedAtUtc, s.Source, s.Status, s.VerifiedAtUtc, s.Language, s.Version, s.UnsubscribedAtUtc, s.ArchivedAtUtc,
            database.NewsletterVerificationRequests.Where(r => r.SubscriptionId == s.Id && r.Purpose == NewsletterVerificationRequest.PurposeVerification)
                .OrderByDescending(r => r.CreatedAtUtc).Select(r => r.Status).FirstOrDefault()));
}
