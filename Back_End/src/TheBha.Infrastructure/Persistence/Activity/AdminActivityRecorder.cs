using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using TheBha.Application.Activity;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Activity;

/// <summary>
/// ADR 0011 §A, §D (BHA-ADMIN-BADGE-001-PR02). Scoped on purpose: it shares the caller's <see cref="TheBhaDbContext"/> and therefore the caller's transaction. Statement one takes the next number
/// of the menu with <c>UPDATE … RETURNING</c>, which blocks behind any transaction that already holds the counter row and keeps it locked until COMMIT; statement two appends the row. The
/// correlation decision is made INSIDE statement two, which starts after statement one returned: under READ COMMITTED it therefore sees every row the previous holder committed, so two
/// requests carrying one id are serialised and the second can never trip the partial unique index and fail the business write.
/// </summary>
internal sealed class AdminActivityRecorder(TheBhaDbContext database, TimeProvider timeProvider) : IAdminActivityRecorder
{
    private const int MaxMenuKey = 40, MaxAction = 40, MaxEntityKind = 40, MaxEntityKey = 80, MaxTitle = 200;

    public async Task RecordAsync(AdminActivityEntry entry, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entry);
        var transaction = database.Database.CurrentTransaction
            ?? throw new InvalidOperationException("An admin activity must be recorded inside the business transaction; there is none.");

        Validate(entry);
        var entityKey = NormalizeEntityKey(entry.EntityKey);
        var title = NormalizeTitle(entry.TitleSnapshot);

        var sequence = await TakeNextSequenceAsync(transaction, entry.MenuKey, cancellationToken);
        var now = timeProvider.GetUtcNow();
        var kind = entry.ActorKind.ToString();
        var blog = AdminMenuKeys.BlogPosts;
        // The explicit ::uuid casts keep a null parameter typed. A row keeps its CorrelationId only for a valid Blog chain: (1) the id is unused in the menu and the action starts a chain
        // (Created, DraftSaved); (2) Published, when the chain start has the same actor and entity and no Published has taken the id yet. Everything else stores NULL and is still appended.
        var written = await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "AdminActivities" ("MenuKey", "Sequence", "Id", "PropertyId", "ActorKind", "ActorStaffId", "Action", "EntityKind", "EntityKey", "TitleSnapshot", "ItemCount", "CorrelationId", "OccurredAtUtc")
            VALUES ({entry.MenuKey}, {sequence}, {Guid.NewGuid()}, {entry.PropertyId}::uuid, {kind}, {entry.ActorStaffId}::uuid, {entry.Action}, {entry.EntityKind}, {entityKey}, {title}, {entry.ItemCount},
              CASE
                WHEN {entry.CorrelationId}::uuid IS NULL OR {entry.MenuKey} <> {blog} THEN NULL
                WHEN NOT EXISTS (SELECT 1 FROM "AdminActivities" u WHERE u."MenuKey" = {entry.MenuKey} AND u."CorrelationId" = {entry.CorrelationId}::uuid)
                  THEN CASE WHEN {entry.Action} IN ({AdminActivityActions.Created}, {AdminActivityActions.DraftSaved}) THEN {entry.CorrelationId}::uuid END
                WHEN {entry.Action} = {AdminActivityActions.Published}
                  AND EXISTS (SELECT 1 FROM "AdminActivities" s WHERE s."MenuKey" = {entry.MenuKey} AND s."CorrelationId" = {entry.CorrelationId}::uuid
                              AND s."Action" IN ({AdminActivityActions.Created}, {AdminActivityActions.DraftSaved})
                              AND s."ActorKind" = {kind} AND s."ActorStaffId" IS NOT DISTINCT FROM {entry.ActorStaffId}::uuid
                              AND s."EntityKind" = {entry.EntityKind} AND s."EntityKey" = {entityKey})
                  AND NOT EXISTS (SELECT 1 FROM "AdminActivities" p WHERE p."MenuKey" = {entry.MenuKey} AND p."CorrelationId" = {entry.CorrelationId}::uuid AND p."Action" = {AdminActivityActions.Published})
                  THEN {entry.CorrelationId}::uuid
              END,
              {now})
            """,
            cancellationToken);
        if (written != 1) throw new InvalidOperationException("The admin activity was not appended.");
    }

    // A plain command: EF wraps raw queries in a sub-select, which UPDATE … RETURNING cannot be (the same reason as NewsletterSql.ReturningIdsAsync).
    private async Task<long> TakeNextSequenceAsync(IDbContextTransaction transaction, string menuKey, CancellationToken cancellationToken)
    {
        var connection = (NpgsqlConnection)database.Database.GetDbConnection();
        await using var command = new NpgsqlCommand(
            """UPDATE "MenuActivityStreams" SET "LastSequence" = "LastSequence" + 1 WHERE "MenuKey" = @menu RETURNING "LastSequence" """,
            connection, (NpgsqlTransaction)transaction.GetDbTransaction());
        command.Parameters.AddWithValue("menu", menuKey);
        // No counter row, no number: the caller's transaction rolls back rather than commit something that cannot be counted.
        return await command.ExecuteScalarAsync(cancellationToken) is long next
            ? next
            : throw new InvalidOperationException($"The activity stream '{menuKey}' has no counter row.");
    }

    private static void Validate(AdminActivityEntry entry)
    {
        RequireText(entry.MenuKey, MaxMenuKey, nameof(entry.MenuKey));
        RequireText(entry.Action, MaxAction, nameof(entry.Action));
        RequireText(entry.EntityKind, MaxEntityKind, nameof(entry.EntityKind));
        if (!Enum.IsDefined(entry.ActorKind)) throw new ArgumentException("Unknown actor kind.", nameof(entry));
        if (entry.ActorStaffId == Guid.Empty || (entry.ActorKind == AdminActorKind.Staff) != entry.ActorStaffId.HasValue)
            throw new ArgumentException("A Staff id is required exactly for a Staff actor.", nameof(entry));
        if (entry.PropertyId == Guid.Empty || AdminMenuKeys.IsPropertyScoped(entry.MenuKey) != entry.PropertyId.HasValue)
            throw new ArgumentException("A Property id is required exactly for a Property-scoped menu.", nameof(entry));
        if (entry.ItemCount < 1) throw new ArgumentOutOfRangeException(nameof(entry), "ItemCount must be at least 1.");
    }

    private static void RequireText(string? value, int max, string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > max || value.Any(char.IsControl))
            throw new ArgumentException($"{name} must be 1 to {max} characters without control characters.", name);
    }

    /// <summary>A canonical lower-case GUID, or a fixed lower-case token (a singleton such as the Blog settings). Never truncated: a cut key could collide with another object.</summary>
    internal static string NormalizeEntityKey(string? key)
    {
        var trimmed = key?.Trim();
        if (string.IsNullOrEmpty(trimmed)) throw new ArgumentException("EntityKey is required.", nameof(key));
        if (Guid.TryParse(trimmed, out var guid)) return guid.ToString("D");
        if (trimmed.Length > MaxEntityKey || trimmed.Any(char.IsControl)) throw new ArgumentException($"EntityKey must be at most {MaxEntityKey} characters without control characters.", nameof(key));
        return trimmed.ToLowerInvariant();
    }

    /// <summary>Control characters removed, trimmed, capped at 200 characters without splitting a surrogate pair; an unpaired surrogate becomes U+FFFD (it cannot be written to PostgreSQL as is).</summary>
    internal static string NormalizeTitle(string? title)
    {
        if (string.IsNullOrEmpty(title)) return string.Empty;
        var clean = new StringBuilder(title.Length);
        foreach (var rune in title.EnumerateRunes()) if (!Rune.IsControl(rune)) clean.Append(rune.ToString());
        var text = clean.ToString().Trim();
        var capped = new StringBuilder(Math.Min(text.Length, MaxTitle * 2));
        var count = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            if (count++ == MaxTitle) break;
            capped.Append(rune.ToString());
        }
        return capped.ToString().TrimEnd();
    }
}
