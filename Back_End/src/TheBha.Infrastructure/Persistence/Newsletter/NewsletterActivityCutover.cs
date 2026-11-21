using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>
/// ADR 0011 §E / BHA-ADMIN-BADGE-001-PR14. Lock order: the legacy activity table (SHARE ROW EXCLUSIVE, under <c>lock_timeout</c>), then the <c>newsletter</c> counter row. The table lock waits for every
/// legacy writer already in flight (insert or cascade delete) and blocks later ones until this transaction ends; plain reads are not blocked. Nothing is read before the lock, and the clock is read
/// only after it was granted, so <c>CutoverAtUtc</c> is a moment no legacy writer can still be before. Every statement goes through EF so a test can park the transaction at a chosen point.
/// </summary>
internal sealed class NewsletterActivityCutover(TheBhaDbContext database, TimeProvider timeProvider) : INewsletterActivityCutover
{
    private const string Key = MenuActivityStream.Newsletter;

    /// <summary>
    /// How much longer the ADO.NET command timeout is than the PostgreSQL <c>lock_timeout</c> asked for, so the SERVER always gives up first and answers 55P03; a client timeout shorter than the lock
    /// wait would cut the connection while the server still waits and the operator would see a transport failure instead of a lock timeout.
    /// </summary>
    internal const int CommandTimeoutBufferSeconds = 30;

    public async Task<NewsletterCutoverResult> RunAsync(TimeSpan lockTimeout, CancellationToken cancellationToken)
    {
        if (lockTimeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(lockTimeout), "The lock timeout must be positive (0 would wait forever).");
        // Scoped to this operation: the application-wide default (30 s) stays what it is, and a context that is used again afterwards gets its own value back.
        var previous = database.Database.GetCommandTimeout();
        database.Database.SetCommandTimeout((int)Math.Ceiling(lockTimeout.TotalSeconds) + CommandTimeoutBufferSeconds);
        try
        {
            return await RunCoreAsync(lockTimeout, cancellationToken);
        }
        finally
        {
            database.Database.SetCommandTimeout(previous);
        }
    }

    private async Task<NewsletterCutoverResult> RunCoreAsync(TimeSpan lockTimeout, CancellationToken cancellationToken)
    {
        // READ COMMITTED: each statement below sees what committed before it started, which is exactly what the table lock guarantees to be final for the legacy table.
        var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var commitRequested = false;
        try
        {
            var milliseconds = (long)Math.Ceiling(lockTimeout.TotalMilliseconds);
            // SET LOCAL takes no bind parameter: the value is a number this method computed (never text from a caller).
#pragma warning disable EF1002
            await database.Database.ExecuteSqlRawAsync($"SET LOCAL lock_timeout = {milliseconds.ToString(CultureInfo.InvariantCulture)}", cancellationToken);
#pragma warning restore EF1002
            await database.Database.ExecuteSqlRawAsync("""LOCK TABLE "NewsletterVerificationActivities" IN SHARE ROW EXCLUSIVE MODE""", cancellationToken);

            var now = timeProvider.GetUtcNow();
            // The counter row, locked until COMMIT: the last number issued is final, even when the row that carried it was deleted by a cascade.
            var legacyMax = await database.Database.SqlQuery<long>(
                $"""SELECT "LastSequence" AS "Value" FROM "MenuActivityStreams" WHERE "MenuKey" = {Key} FOR UPDATE""").ToListAsync(cancellationToken);
            if (legacyMax.Count != 1) throw new InvalidOperationException("The newsletter activity stream has no counter row.");

            var existing = await database.Database.SqlQuery<MarkerRow>(
                $"""SELECT "LegacyMaxSequence", "CutoverAtUtc" FROM "MenuActivityCutovers" WHERE "MenuKey" = {Key}""").ToListAsync(cancellationToken);
            if (existing.Count == 1)
            {
                await transaction.RollbackAsync(cancellationToken);
                return new NewsletterCutoverResult(NewsletterCutoverStatus.AlreadyCutOver, existing[0].LegacyMaxSequence, existing[0].CutoverAtUtc, 0);
            }

            var shared = await database.Database.SqlQuery<bool>(
                $"""SELECT EXISTS (SELECT 1 FROM "AdminActivities" WHERE "MenuKey" = {Key}) AS "Value" """).SingleAsync(cancellationToken);
            if (shared)
            {
                await transaction.RollbackAsync(cancellationToken);
                return new NewsletterCutoverResult(NewsletterCutoverStatus.SharedRowsWithoutMarker, null, null, 0);
            }

            // Exactly the rows that exist now, read under the lock. Legacy rows have no Staff actor: Public, a generic title, the original Sequence and time. No address or token exists in the source.
            var copied = await database.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "AdminActivities" ("MenuKey", "Sequence", "Id", "PropertyId", "ActorKind", "ActorStaffId", "Action", "EntityKind", "EntityKey", "TitleSnapshot", "ItemCount", "CorrelationId", "OccurredAtUtc")
                SELECT {Key}, n."Sequence", gen_random_uuid(), NULL, 'Public', NULL, 'verified', 'subscription', n."SubscriptionId"::text, 'a subscription', 1, NULL, n."OccurredAtUtc"
                FROM "NewsletterVerificationActivities" n
                """,
                cancellationToken);
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""INSERT INTO "MenuActivityCutovers" ("MenuKey", "LegacyMaxSequence", "CutoverAtUtc") VALUES ({Key}, {legacyMax[0]}, {now}) ON CONFLICT ("MenuKey") DO NOTHING""",
                cancellationToken);
            commitRequested = true;
            await transaction.CommitAsync(cancellationToken);
            // Only here has PostgreSQL confirmed the commit.
            return new NewsletterCutoverResult(NewsletterCutoverStatus.Committed, legacyMax[0], now, copied);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.LockNotAvailable)
        {
            // lock_timeout: the server answered 55P03 before any COMMIT was requested, so THIS run wrote nothing. It says nothing about an earlier run, and nothing about which source is in use: the marker was never read.
            return new NewsletterCutoverResult(NewsletterCutoverStatus.LockTimeout, null, null, 0);
        }
        catch (Exception exception) when (commitRequested && exception is not PostgresException)
        {
            // COMMIT was requested and the caller got no answer (a lost connection, a timeout, a cancellation): the server may have committed. A PostgresException is excluded on purpose: an error
            // answer to COMMIT means the server did NOT commit. Nothing is claimed either way; the command is idempotent, so the operator checks the marker or runs it again.
            return new NewsletterCutoverResult(NewsletterCutoverStatus.OutcomeUnknown, null, null, 0);
        }
        finally
        {
            try
            {
                await transaction.DisposeAsync();
            }
            catch (Exception) when (commitRequested)
            {
                // The connection is already gone; the outcome was decided above.
            }
        }
    }

    private sealed record MarkerRow(long LegacyMaxSequence, DateTimeOffset CutoverAtUtc);
}
