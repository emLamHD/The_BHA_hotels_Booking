using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using TheBha.Application.Activity;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>
/// BHA-NEWSLETTER-BADGE-001 / BHA-ADMIN-BADGE-001-PR14 (ADR 0011 §E): where the Newsletter's activity is written. Until the cutover marker exists the legacy table is the only source; from the marker on,
/// <c>AdminActivities</c> is. Every method is called INSIDE the caller's transaction as its last statement before COMMIT, and every one opens with the SAME two steps in the SAME order:
/// <c>LOCK TABLE "NewsletterVerificationActivities" IN ROW EXCLUSIVE MODE</c> (it does not conflict with other legacy writers, it conflicts with the cutover's SHARE ROW EXCLUSIVE), then a fresh read of
/// the marker. Holding that lock, the answer cannot change before COMMIT: a cutover waits for us, or has already committed and the marker is visible. The counter row is always taken AFTER the table
/// (the cutover's order), so a verification and the cutover cannot deadlock; the rest of the order stays subscription → mails → table → counter.
/// </summary>
internal static class NewsletterActivityLog
{
    /// <summary>The SQLSTATE the fence trigger raises for a legacy insert after the marker exists (migration 27).</summary>
    public const string FenceSqlState = "BH014";

    private const string Key = MenuActivityStream.Newsletter, GenericTitle = "a subscription", EntityKind = "subscription";

    public static bool IsFence(PostgresException exception) => exception.SqlState == FenceSqlState;

    /// <summary>Takes the legacy-table lock, then reads the marker in a new statement (a new snapshot under READ COMMITTED). True: the shared table is the source.</summary>
    private static async Task<bool> LockAndReadMarkerAsync(TheBhaDbContext database, CancellationToken cancellationToken)
    {
        await database.Database.ExecuteSqlRawAsync("""LOCK TABLE "NewsletterVerificationActivities" IN ROW EXCLUSIVE MODE""", cancellationToken);
        return await database.Database.SqlQuery<bool>($"""SELECT EXISTS (SELECT 1 FROM "MenuActivityCutovers" WHERE "MenuKey" = {Key}) AS "Value" """).SingleAsync(cancellationToken);
    }

    /// <summary>One verification by a guest: <c>Public</c>, no Staff id, a generic title (no address). The source is chosen after the table lock, so it is the one the cutover boundary agrees with.</summary>
    public static async Task RecordVerifiedAsync(TheBhaDbContext database, IAdminActivityRecorder recorder, Guid subscriptionId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (await LockAndReadMarkerAsync(database, cancellationToken))
        {
            await recorder.RecordAsync(new AdminActivityEntry(Key, null, AdminActorKind.Public, null, "verified", EntityKind, subscriptionId.ToString("D"), GenericTitle), cancellationToken);
            return;
        }

        // The number is issued in its own statement, AFTER the table lock (a single CTE would issue it first). A plain command: EF wraps a raw query in a sub-select, which UPDATE … RETURNING cannot be.
        var connection = (NpgsqlConnection)database.Database.GetDbConnection();
        await using var command = new NpgsqlCommand(
            """UPDATE "MenuActivityStreams" SET "LastSequence" = "LastSequence" + 1 WHERE "MenuKey" = @menu RETURNING "LastSequence" """,
            connection, (NpgsqlTransaction)database.Database.CurrentTransaction!.GetDbTransaction());
        command.Parameters.AddWithValue("menu", Key);
        // The counter row is seeded by the migration. Without it nothing would be counted, and a verification that cannot be counted must not commit: the transaction rolls back.
        var sequence = await command.ExecuteScalarAsync(cancellationToken) as long? ?? throw new InvalidOperationException("The newsletter activity stream has no counter row.");
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO "NewsletterVerificationActivities" ("Sequence", "SubscriptionId", "OccurredAtUtc") VALUES ({sequence}, {subscriptionId}, {now})""", cancellationToken);
    }

    /// <summary>
    /// One Staff change of a subscription (<c>Created</c>, <c>Updated</c>, <c>Deleted</c>), written only once the marker is visible: before it the legacy table has no column for a Staff actor, and an
    /// <c>AdminActivities</c> row without a marker would make the cutover abort. Returns whether an event was written (the caller then sends the hint after COMMIT).
    /// </summary>
    public static async Task<bool> RecordStaffAsync(TheBhaDbContext database, IAdminActivityRecorder recorder, Guid actorStaffId, string action, Guid subscriptionId, CancellationToken cancellationToken)
    {
        if (!await LockAndReadMarkerAsync(database, cancellationToken)) return false;
        await recorder.RecordAsync(new AdminActivityEntry(Key, null, AdminActorKind.Staff, actorStaffId, action, EntityKind, subscriptionId.ToString("D"), GenericTitle), cancellationToken);
        return true;
    }
}
