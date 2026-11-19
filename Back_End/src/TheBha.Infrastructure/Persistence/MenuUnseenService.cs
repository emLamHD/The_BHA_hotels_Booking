using Microsoft.EntityFrameworkCore;
using System.Globalization;
using TheBha.Application.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: the per-Staff "seen" cursor of a menu's activity stream. It never locks a subscription (so it cannot be part of a cycle with a verification, whose lock order is
/// subscription → mails → stream counter) and holds no transaction over a network call.
/// </summary>
internal sealed class MenuUnseenService(TheBhaDbContext database, TimeProvider timeProvider) : IMenuUnseen
{
    private sealed record UnseenRow(long Current, long LastSeen, long Count);

    public async Task<MenuUnseenDto> GetAsync(Guid staffId, CancellationToken cancellationToken)
    {
        // ONE statement, so one snapshot: the counter, the cursor and the count agree. No cursor row = 0 (the stream's beginning), with no row written here.
        var row = await database.Database.SqlQuery<UnseenRow>(
            $"""
            SELECT s."LastSequence" AS "Current",
                   COALESCE(c."LastSeenSequence", 0) AS "LastSeen",
                   (SELECT count(*) FROM "NewsletterVerificationActivities" a WHERE a."Sequence" > COALESCE(c."LastSeenSequence", 0)) AS "Count"
            FROM "MenuActivityStreams" s
            LEFT JOIN "StaffMenuSeen" c ON c."StaffAccountId" = {staffId} AND c."MenuKey" = s."MenuKey"
            WHERE s."MenuKey" = {MenuUnseenKeys.Newsletter}
            """).SingleAsync(cancellationToken);
        return new MenuUnseenDto(new MenuUnseenEntryDto(
            (int)Math.Min(row.Count, int.MaxValue), row.LastSeen.ToString(CultureInfo.InvariantCulture), row.Current.ToString(CultureInfo.InvariantCulture)));
    }

    public async Task<MenuSeenResult> MarkSeenAsync(Guid staffId, string menuKey, long viewWatermark, CancellationToken cancellationToken)
    {
        if (!MenuUnseenKeys.IsKnown(menuKey)) return new MenuSeenResult(MenuSeenStatus.UnknownMenu, null);
        if (viewWatermark < 0) return new MenuSeenResult(MenuSeenStatus.InvalidWatermark, null);

        var now = timeProvider.GetUtcNow();
        // One atomic statement. The row is written only while the watermark is not above the newest committed number (the SELECT is empty otherwise: nothing is clamped to "everything so far");
        // the counter only grows, so a number that was valid when it was read stays valid. A first call by two tabs at once is decided by ON CONFLICT, never a duplicate-key error, and
        // GREATEST keeps the higher of the stored and the incoming number, so acknowledgements that arrive out of order cannot pull the cursor back.
        var written = await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "StaffMenuSeen" ("StaffAccountId", "MenuKey", "LastSeenSequence", "UpdatedAtUtc")
            SELECT {staffId}, s."MenuKey", {viewWatermark}, {now} FROM "MenuActivityStreams" s WHERE s."MenuKey" = {menuKey} AND s."LastSequence" >= {viewWatermark}
            ON CONFLICT ("StaffAccountId", "MenuKey") DO UPDATE SET
              "LastSeenSequence" = GREATEST("StaffMenuSeen"."LastSeenSequence", EXCLUDED."LastSeenSequence"),
              "UpdatedAtUtc" = CASE WHEN EXCLUDED."LastSeenSequence" > "StaffMenuSeen"."LastSeenSequence" THEN EXCLUDED."UpdatedAtUtc" ELSE "StaffMenuSeen"."UpdatedAtUtc" END
            """,
            cancellationToken);
        if (written == 0) return new MenuSeenResult(MenuSeenStatus.InvalidWatermark, null);
        return new MenuSeenResult(MenuSeenStatus.Succeeded, await GetAsync(staffId, cancellationToken));
    }
}
