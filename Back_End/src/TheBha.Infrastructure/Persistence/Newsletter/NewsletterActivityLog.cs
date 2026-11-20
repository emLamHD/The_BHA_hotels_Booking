using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: records one verification in the stream. Called INSIDE the verification's transaction, as its last statement before the commit: the number is taken from the
/// counter row, which stays locked until that commit, so numbers commit in the order they were given. Lock order of the whole verification: the subscription, its mails, then this row.
/// </summary>
internal static class NewsletterActivityLog
{
    public static async Task RecordVerifiedAsync(TheBhaDbContext database, Guid subscriptionId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var written = await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            WITH next AS (UPDATE "MenuActivityStreams" SET "LastSequence" = "LastSequence" + 1 WHERE "MenuKey" = {MenuActivityStream.Newsletter} RETURNING "LastSequence")
            INSERT INTO "NewsletterVerificationActivities" ("Sequence", "SubscriptionId", "OccurredAtUtc") SELECT "LastSequence", {subscriptionId}, {now} FROM next
            """,
            cancellationToken);
        // The counter row is seeded by the migration. Without it nothing would be counted, and a verification that cannot be counted must not commit: the transaction rolls back.
        if (written != 1) throw new InvalidOperationException("The newsletter activity stream has no counter row.");
    }
}
