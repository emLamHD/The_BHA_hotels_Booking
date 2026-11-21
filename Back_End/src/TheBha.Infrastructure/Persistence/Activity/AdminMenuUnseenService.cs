using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using TheBha.Application.Activity;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Activity;

/// <summary>
/// ADR 0011 §B–D (BHA-ADMIN-BADGE-001-PR03). Every statement starts from <see cref="Scopes"/>: the (menu, Property) pairs the Staff account may read RIGHT NOW (account flags and memberships
/// read in the statement itself), so permission, Property scope, counter, cursor and the rows that are counted or listed always come from one snapshot, and what the Staff may not read
/// contributes nothing. SQL text is built only from constants in this file; every value is a parameter.
/// </summary>
internal sealed class AdminMenuUnseenService(TheBhaDbContext database, TimeProvider timeProvider, AdminMenuRoles roles, IMenuUnseen legacyNewsletter) : IAdminMenuUnseen, IAdminMenuAccess
{
    private const int GroupWindow = 50, DefaultLimit = 50, MaxLimit = 100;
    private const string Newsletter = MenuActivityStream.Newsletter;

    // me: the active accounts among @staff. scopes: every (account, menu, Property) each may read, with the menu's counter. Global menus have a null Property.
    private const string Scopes = """
        me AS (SELECT a."Id", a."CreatedAtUtc", a."SecurityStamp", a."CanManageWebsite", a."CanEditBlog", a."CanPublishBlog"
               FROM "StaffAccounts" a WHERE a."Id" = ANY(@staff) AND a."IsActive"),
        scopes AS (
          SELECT me."Id" AS "StaffId", me."CreatedAtUtc", s."MenuKey", NULL::uuid AS "PropertyId", s."LastSequence" AS "Current"
          FROM me JOIN "MenuActivityStreams" s ON (s."MenuKey" = ANY(@blog) AND (me."CanEditBlog" OR me."CanPublishBlog")) OR (s."MenuKey" = ANY(@website) AND me."CanManageWebsite")
          UNION ALL
          SELECT me."Id", me."CreatedAtUtc", s."MenuKey", m."PropertyId", s."LastSequence"
          FROM me JOIN "StaffPropertyMemberships" m ON m."StaffAccountId" = me."Id"
          JOIN "MenuActivityStreams" s ON (s."MenuKey" = 'promotions' AND m."Role" = ANY(@promo)) OR (s."MenuKey" = 'calendar' AND m."Role" = ANY(@board)))
        """;

    // The cursor of a scope: the global menu cursor, the Promotions per-Property cursor, or (Calendar, informational only) the highest object cursor of the Property. No row = 0.
    private const string LastSeen = """
        COALESCE(CASE
          WHEN sc."PropertyId" IS NULL THEN (SELECT c."LastSeenSequence" FROM "StaffMenuSeen" c WHERE c."StaffAccountId" = sc."StaffId" AND c."MenuKey" = sc."MenuKey")
          WHEN sc."MenuKey" = 'promotions' THEN (SELECT c."LastSeenSequence" FROM "StaffMenuPropertySeen" c WHERE c."StaffAccountId" = sc."StaffId" AND c."MenuKey" = sc."MenuKey" AND c."PropertyId" = sc."PropertyId")
          ELSE (SELECT max(e."LastSeenSequence") FROM "StaffEntitySeen" e WHERE e."StaffAccountId" = sc."StaffId" AND e."PropertyId" = sc."PropertyId")
        END, 0)
        """;

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private sealed record SummaryRow(string MenuKey, Guid? PropertyId, long Current, long LastSeen, long Count);
    private sealed record ScopeRow(Guid? PropertyId, long Current, long LastSeen, DateTimeOffset CreatedAtUtc);
    private sealed record GroupRow(string EntityKind, string EntityKey, string TitleSnapshot, string Action, long Events, long Items, long Latest, DateTimeOffset OccurredAtUtc, string Actors, long Total, bool? OnBoard);
    private sealed record ActorJson(string Kind, Guid? StaffId);
    private sealed record ItemRow(long Sequence, DateTimeOffset OccurredAtUtc, string ActorKind, Guid? ActorStaffId, string Action, string EntityKind, string EntityKey, string TitleSnapshot, int ItemCount);
    private sealed record HistoryCursor(string M, Guid? P, Guid? A, DateTimeOffset? F, DateTimeOffset? T, long S);
    private sealed record RecipientRow(Guid StaffId, string SecurityStamp, bool CanRead);

    // ------------------------------------------------------------------------------------------------------------- permission and scope

    private object[] Access(IEnumerable<Guid> staff, params NpgsqlParameter[] more) =>
    [
        new NpgsqlParameter("staff", staff.ToArray()),
        new NpgsqlParameter("blog", AdminMenus.KeysOf(AdminMenuPermission.Blog)),
        new NpgsqlParameter("website", AdminMenus.KeysOf(AdminMenuPermission.Website)),
        new NpgsqlParameter("promo", roles.PromotionManage.ToArray()),
        new NpgsqlParameter("board", roles.BoardRead.ToArray()),
        .. more
    ];

    private static NpgsqlParameter Text(string name, string? value) => new(name, NpgsqlDbType.Text) { Value = (object?)value ?? DBNull.Value };
    private static NpgsqlParameter Uuid(string name, Guid? value) => new(name, NpgsqlDbType.Uuid) { Value = (object?)value ?? DBNull.Value };
    private static NpgsqlParameter Big(string name, long? value) => new(name, NpgsqlDbType.Bigint) { Value = (object?)value ?? DBNull.Value };
    private static NpgsqlParameter Time(string name, DateTimeOffset? value) => new(name, NpgsqlDbType.TimestampTz) { Value = (object?)value?.ToUniversalTime() ?? DBNull.Value };

    private static string Watermark(long value) => value.ToString(CultureInfo.InvariantCulture);
    private static int Clamp(long count) => (int)Math.Min(count, int.MaxValue);

    /// <summary>
    /// The scopes of one menu, or an early refusal. Order (anti-disclosure): unknown or not readable → 404 (the same answer); then the shape of <c>propertyId</c> (400); then a Property outside the
    /// Staff member's memberships → 404. A Property-scoped menu with no <c>propertyId</c> returns every readable scope with <c>Chosen</c> null (the caller decides whether that is an error).
    /// </summary>
    private async Task<(AdminMenuStatus Status, IReadOnlyList<ScopeRow> All, ScopeRow? Chosen)> ResolveAsync(Guid staffId, string? menu, string? rawProperty, CancellationToken cancellationToken)
    {
        if (!AdminMenus.IsKnown(menu)) return (AdminMenuStatus.UnknownMenu, [], null);
        var rows = await database.Database.SqlQueryRaw<ScopeRow>(
            $"""
            WITH {Scopes}
            SELECT sc."PropertyId", sc."Current", ls."LastSeen", sc."CreatedAtUtc"
            FROM scopes sc CROSS JOIN LATERAL (SELECT {LastSeen} AS "LastSeen") ls
            WHERE sc."MenuKey" = @menu
            """, Access([staffId], Text("menu", menu))).ToListAsync(cancellationToken);
        if (rows.Count == 0) return (AdminMenuStatus.UnknownMenu, [], null);
        if (rawProperty is null) return (AdminMenuStatus.Succeeded, rows, AdminMenuKeys.IsPropertyScoped(menu!) ? null : rows[0]);
        if (!AdminMenuKeys.IsPropertyScoped(menu!) || !Guid.TryParse(rawProperty, out var propertyId) || propertyId == Guid.Empty) return (AdminMenuStatus.InvalidProperty, rows, null);
        var chosen = rows.FirstOrDefault(row => row.PropertyId == propertyId);
        return chosen is null ? (AdminMenuStatus.UnknownMenu, [], null) : (AdminMenuStatus.Succeeded, rows, chosen);
    }

    /// <summary>Resolves exactly one scope: a Property-scoped menu needs a <c>propertyId</c>, a global one refuses it.</summary>
    private async Task<(AdminMenuResult<T>? Refusal, ScopeRow? Scope)> ResolveOneAsync<T>(Guid staffId, string? menu, string? rawProperty, CancellationToken cancellationToken)
    {
        var (status, _, chosen) = await ResolveAsync(staffId, menu, rawProperty, cancellationToken);
        if (status != AdminMenuStatus.Succeeded) return (new AdminMenuResult<T>(status), null);
        return chosen is null ? (new AdminMenuResult<T>(AdminMenuStatus.InvalidProperty), null) : (null, chosen);
    }

    public async Task<bool> CanReadAnyAsync(Guid staffId, CancellationToken cancellationToken)
    {
        var rows = await database.Database.SqlQueryRaw<ScopeRow>(
            $"""
            WITH {Scopes}
            SELECT sc."PropertyId", sc."Current", 0::bigint AS "LastSeen", sc."CreatedAtUtc" FROM scopes sc LIMIT 1
            """, Access([staffId])).ToListAsync(cancellationToken);
        return rows.Count > 0;
    }

    public async Task<IReadOnlyList<AdminMenuRecipient>> JudgeAsync(string menu, Guid? propertyId, IReadOnlyCollection<Guid> staffIds, CancellationToken cancellationToken)
    {
        if (staffIds.Count == 0) return [];
        var rows = await database.Database.SqlQueryRaw<RecipientRow>(
            $"""
            WITH {Scopes}
            SELECT me."Id" AS "StaffId", me."SecurityStamp",
                   EXISTS (SELECT 1 FROM scopes sc WHERE sc."StaffId" = me."Id" AND sc."MenuKey" = @menu AND (@prop::uuid IS NULL OR sc."PropertyId" = @prop)) AS "CanRead"
            FROM me
            """, Access(staffIds, Text("menu", menu), Uuid("prop", propertyId))).ToListAsync(cancellationToken);
        return [.. rows.Select(row => new AdminMenuRecipient(row.StaffId, row.SecurityStamp, row.CanRead))];
    }

    // ------------------------------------------------------------------------------------------------------------- the aggregate

    public Task<MenuUnseenSummary> GetSummaryAsync(Guid staffId, CancellationToken cancellationToken) => SummaryAsync(staffId, null, cancellationToken);

    private async Task<MenuUnseenSummary> SummaryAsync(Guid staffId, string? onlyMenu, CancellationToken cancellationToken)
    {
        // ONE statement, so one snapshot. The count is by logical event over the rows left after the Staff's scope, own events, the D2 baseline and the cursor (never current − lastSeen).
        // Newsletter keeps its legacy expression exactly (no baseline, no actor filter, no cursor = 0). Calendar counts distinct unread objects against each object's own cursor.
#pragma warning disable EF1002 // the interpolated parts are constants of this class and CalendarUnreadSql; every value is a parameter
        var rows = await database.Database.SqlQueryRaw<SummaryRow>(
            $"""
            WITH {Scopes}
            SELECT sc."MenuKey", sc."PropertyId", sc."Current", ls."LastSeen",
              CASE
                WHEN sc."MenuKey" = 'newsletter' THEN (SELECT count(*) FROM "NewsletterVerificationActivities" n WHERE n."Sequence" > ls."LastSeen")
                WHEN sc."MenuKey" = 'calendar' THEN (SELECT count(*) FROM (
                    SELECT 1 FROM "AdminActivities" a
                    {CalendarUnreadSql.JoinSeen("sc.\"StaffId\"")}
                    WHERE a."MenuKey" = 'calendar' AND a."PropertyId" = sc."PropertyId" AND {CalendarUnreadSql.Unread("sc.\"CreatedAtUtc\"", "sc.\"StaffId\"")}
                    GROUP BY a."EntityKind", a."EntityKey") q)
                ELSE (SELECT count(DISTINCT COALESCE(a."CorrelationId", a."Id")) FROM "AdminActivities" a
                      WHERE a."MenuKey" = sc."MenuKey" AND (sc."PropertyId" IS NULL OR a."PropertyId" = sc."PropertyId") AND a."Sequence" > ls."LastSeen"
                        AND a."OccurredAtUtc" >= sc."CreatedAtUtc" AND a."ActorStaffId" IS DISTINCT FROM sc."StaffId")
              END AS "Count"
            FROM scopes sc CROSS JOIN LATERAL (SELECT {LastSeen} AS "LastSeen") ls
            WHERE @only::text IS NULL OR sc."MenuKey" = @only
            """, Access([staffId], Text("only", onlyMenu))).ToListAsync(cancellationToken);
#pragma warning restore EF1002

        var menus = new Dictionary<string, MenuUnseenEntry>(StringComparer.Ordinal);
        foreach (var menu in rows.GroupBy(row => row.MenuKey, StringComparer.Ordinal))
        {
            var first = menu.First();
            menus[menu.Key] = first.PropertyId is null
                ? new MenuUnseenEntry(Clamp(first.Count), Watermark(first.LastSeen), Watermark(first.Current))
                : new MenuUnseenEntry(
                    Clamp(menu.Sum(row => row.Count)),
                    ByProperty: [.. menu.OrderBy(row => row.PropertyId).Select(row => new MenuUnseenPropertyEntry(row.PropertyId!.Value, Clamp(row.Count), Watermark(row.LastSeen), Watermark(row.Current)))]);
        }

        return new MenuUnseenSummary(menus);
    }

    // ------------------------------------------------------------------------------------------------------------- the unseen list

    public async Task<AdminMenuResult<MenuChanges>> GetChangesAsync(Guid staffId, string menu, string? propertyId, CancellationToken cancellationToken)
    {
        // REPEATABLE READ: the scope, the cursor, the counter and the groups below are one snapshot. Nothing is written.
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        var (refusal, found) = await ResolveOneAsync<MenuChanges>(staffId, menu, propertyId, cancellationToken);
        if (refusal is not null) return refusal;
        var scope = found!;

        var calendar = menu == AdminMenuKeys.Calendar;
        var legacy = menu == Newsletter;
        // f: the physical rows left after the Staff's filters. Newsletter reads its legacy table (Public actor, a generic title, no baseline); Calendar compares each object with its own cursor.
        var source = legacy
            ? """
              SELECT n."Sequence", 'Public' AS "ActorKind", NULL::uuid AS "ActorStaffId", 'subscription' AS "EntityKind", n."SubscriptionId"::text AS "EntityKey", 'verified' AS "Action",
                     'a subscription' AS "TitleSnapshot", 1 AS "ItemCount", n."OccurredAtUtc", n."Sequence"::text AS "EventKey"
              FROM "NewsletterVerificationActivities" n WHERE n."Sequence" > @cursor
              """
            : calendar
                ? $"""
                  SELECT a."Sequence", a."ActorKind", a."ActorStaffId", a."EntityKind", a."EntityKey", a."Action", a."TitleSnapshot", a."ItemCount", a."OccurredAtUtc", COALESCE(a."CorrelationId", a."Id")::text AS "EventKey"
                  FROM "AdminActivities" a
                  {CalendarUnreadSql.JoinSeen("@staff")}
                  WHERE a."MenuKey" = @menu AND a."PropertyId" = @prop AND {CalendarUnreadSql.Unread("@created", "@staff")}
                  """
                : """
                  SELECT a."Sequence", a."ActorKind", a."ActorStaffId", a."EntityKind", a."EntityKey", a."Action", a."TitleSnapshot", a."ItemCount", a."OccurredAtUtc", COALESCE(a."CorrelationId", a."Id")::text AS "EventKey"
                  FROM "AdminActivities" a
                  WHERE a."MenuKey" = @menu AND (@prop::uuid IS NULL OR a."PropertyId" = @prop) AND a."Sequence" > @cursor
                    AND a."OccurredAtUtc" >= @created AND a."ActorStaffId" IS DISTINCT FROM @staff
                  """;
        // Calendar groups by object (several actors); everything else by actor and object. A group is never cut: the window is 50 groups, newest first, and one more is read to know about hasMore.
        var keys = calendar ? """f."EntityKind", f."EntityKey" """ : """f."ActorKind", f."ActorStaffId", f."EntityKind", f."EntityKey" """;
        var total = calendar ? "(SELECT count(*) FROM g)" : """(SELECT count(DISTINCT "EventKey") FROM f)""";
        // Calendar presence is BUSINESS state in this same snapshot (never the date window): a unit is on the board while Committed, a block while one of its segments is Effective. The key is compared
        // as a GUID only after a shape check, so a key that is not one reads as not on the board instead of raising 22P02. No braces in this text: EF formats raw SQL like string.Format.
        var onBoard = calendar
            ? """
              (CASE
                 WHEN NOT (length(t."EntityKey") = 36 AND substr(t."EntityKey", 9, 1) = '-' AND substr(t."EntityKey", 14, 1) = '-' AND substr(t."EntityKey", 19, 1) = '-'
                           AND substr(t."EntityKey", 24, 1) = '-' AND replace(t."EntityKey", '-', '') !~ '[^0-9a-f]') THEN false
                 WHEN t."EntityKind" = 'reservation-unit' THEN EXISTS (SELECT 1 FROM "ReservationUnits" u WHERE u."Id" = t."EntityKey"::uuid AND u."PropertyId" = @prop AND u."CommitmentStatus" = 'Committed')
                 WHEN t."EntityKind" = 'room-block' THEN EXISTS (SELECT 1 FROM "RoomOccupancySegments" b WHERE b."RoomBlockId" = t."EntityKey"::uuid AND b."PropertyId" = @prop AND b."Type" = 'OperationalBlock' AND b."Status" = 'Effective')
                 ELSE false
               END)
              """
            : "NULL::boolean";;
#pragma warning disable EF1002 // the interpolated parts are constants of this method; every value is a parameter
        var rows = await database.Database.SqlQueryRaw<GroupRow>(
            $"""
            WITH f AS ({source}),
            g AS (SELECT {keys}, max(f."Sequence") AS "Latest", count(DISTINCT f."EventKey") AS "Events", sum(f."ItemCount") AS "Items",
                         jsonb_agg(DISTINCT jsonb_build_object('kind', f."ActorKind", 'staffId', f."ActorStaffId")) AS "Actors"
                  FROM f GROUP BY {keys}),
            top AS (SELECT * FROM g ORDER BY g."Latest" DESC LIMIT {GroupWindow + 1})
            SELECT t."EntityKind", t."EntityKey", l."TitleSnapshot", l."Action", t."Events", t."Items", t."Latest", l."OccurredAtUtc", t."Actors"::text AS "Actors", {total} AS "Total", {onBoard} AS "OnBoard"
            FROM top t JOIN f l ON l."Sequence" = t."Latest"
            ORDER BY t."Latest" DESC
            """,
            Uuid("staff", staffId), Text("menu", menu), Uuid("prop", scope.PropertyId), Big("cursor", scope.LastSeen), Time("created", scope.CreatedAtUtc)).ToListAsync(cancellationToken);
#pragma warning restore EF1002
        await transaction.CommitAsync(cancellationToken);

        var groups = rows.Take(GroupWindow).Select(row => new UnseenGroup(
            row.EntityKind, row.EntityKey, row.TitleSnapshot, row.Action, Clamp(row.Events), Clamp(row.Items), Watermark(row.Latest), row.OccurredAtUtc,
            [.. JsonSerializer.Deserialize<List<ActorJson>>(row.Actors, Web)!.Select(actor => new ActivityActor(actor.Kind, actor.StaffId))],
            calendar ? row.EntityKey : null, row.OnBoard is { } present ? (present ? CalendarPresence.OnBoard : CalendarPresence.Removed) : null, calendar ? Watermark(row.Latest) : null)).ToList();
        return new AdminMenuResult<MenuChanges>(AdminMenuStatus.Succeeded, new MenuChanges(
            menu, scope.PropertyId, rows.Count == 0 ? 0 : Clamp(rows[0].Total), rows.Count > GroupWindow, Watermark(scope.LastSeen), Watermark(scope.Current), groups));
    }

    // ------------------------------------------------------------------------------------------------------------- acknowledge

    public async Task<AdminMenuResult<MenuUnseenEntry>> MarkSeenAsync(Guid staffId, string menu, string? propertyId, string viewWatermark, CancellationToken cancellationToken)
    {
        var (status, _, chosen) = await ResolveAsync(staffId, menu, propertyId, cancellationToken);
        if (status != AdminMenuStatus.Succeeded) return new AdminMenuResult<MenuUnseenEntry>(status);
        // Calendar is acknowledged per object, never by opening the page (decision D1 / §D): the menu-level route is closed once permission and Property scope passed.
        if (menu == AdminMenuKeys.Calendar) return new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.UseEntitySeen);
        var propertyScoped = AdminMenuKeys.IsPropertyScoped(menu);
        if (propertyScoped && chosen is null) return new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.InvalidProperty);

        // "0" or digits without a leading zero; no sign, space, exponent or fraction. An overflow is refused, never clamped.
        if (!IsPlainInteger(viewWatermark) || !long.TryParse(viewWatermark, NumberStyles.None, CultureInfo.InvariantCulture, out var watermark))
            return new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.InvalidWatermark);

        if (menu == Newsletter)
        {
            // Same code as the legacy route, so the cursor, the counter check and the refusal are identical by construction.
            var legacy = await legacyNewsletter.MarkSeenAsync(staffId, menu, watermark, cancellationToken);
            return legacy.Status switch
            {
                MenuSeenStatus.Succeeded => new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.Succeeded, new MenuUnseenEntry(legacy.Value!.Newsletter.Count, legacy.Value.Newsletter.LastSeenWatermark, legacy.Value.Newsletter.CurrentWatermark)),
                MenuSeenStatus.UnknownMenu => new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.UnknownMenu),
                _ => new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.InvalidWatermark)
            };
        }

        var now = timeProvider.GetUtcNow();
        // One atomic statement; permission and Property scope are re-read in it. It writes only while the watermark is not above the menu's counter (nothing is clamped), and GREATEST keeps
        // acknowledgements that arrive out of order from pulling the cursor back. Only the watermark the client sent is acknowledged.
        var written = propertyScoped
            ? await database.Database.ExecuteSqlRawAsync(
                $"""
                WITH {Scopes}
                INSERT INTO "StaffMenuPropertySeen" ("StaffAccountId", "MenuKey", "PropertyId", "LastSeenSequence", "UpdatedAtUtc")
                SELECT sc."StaffId", sc."MenuKey", sc."PropertyId", @wm, @now FROM scopes sc WHERE sc."MenuKey" = @menu AND sc."PropertyId" = @prop AND sc."Current" >= @wm
                ON CONFLICT ("StaffAccountId", "MenuKey", "PropertyId") DO UPDATE SET
                  "LastSeenSequence" = GREATEST("StaffMenuPropertySeen"."LastSeenSequence", EXCLUDED."LastSeenSequence"),
                  "UpdatedAtUtc" = CASE WHEN EXCLUDED."LastSeenSequence" > "StaffMenuPropertySeen"."LastSeenSequence" THEN EXCLUDED."UpdatedAtUtc" ELSE "StaffMenuPropertySeen"."UpdatedAtUtc" END
                """, Access([staffId], Text("menu", menu), Uuid("prop", chosen!.PropertyId), Big("wm", watermark), Time("now", now)))
            : await database.Database.ExecuteSqlRawAsync(
                $"""
                WITH {Scopes}
                INSERT INTO "StaffMenuSeen" ("StaffAccountId", "MenuKey", "LastSeenSequence", "UpdatedAtUtc")
                SELECT sc."StaffId", sc."MenuKey", @wm, @now FROM scopes sc WHERE sc."MenuKey" = @menu AND sc."Current" >= @wm
                ON CONFLICT ("StaffAccountId", "MenuKey") DO UPDATE SET
                  "LastSeenSequence" = GREATEST("StaffMenuSeen"."LastSeenSequence", EXCLUDED."LastSeenSequence"),
                  "UpdatedAtUtc" = CASE WHEN EXCLUDED."LastSeenSequence" > "StaffMenuSeen"."LastSeenSequence" THEN EXCLUDED."UpdatedAtUtc" ELSE "StaffMenuSeen"."UpdatedAtUtc" END
                """, Access([staffId], Text("menu", menu), Big("wm", watermark), Time("now", now)));
        if (written == 0)
        {
            // Nothing was written: the watermark is above the counter, or the permission was lost since the check above (then it is the same 404 as any other unreadable menu).
            var again = await ResolveAsync(staffId, menu, propertyId, cancellationToken);
            return new AdminMenuResult<MenuUnseenEntry>(again.Status == AdminMenuStatus.Succeeded ? AdminMenuStatus.InvalidWatermark : again.Status);
        }

        var summary = await SummaryAsync(staffId, menu, cancellationToken);
        return summary.Menus.TryGetValue(menu, out var entry)
            ? new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.Succeeded, entry)
            : new AdminMenuResult<MenuUnseenEntry>(AdminMenuStatus.UnknownMenu);
    }

    // ------------------------------------------------------------------------------------------------------------- acknowledge one Calendar object

    private sealed record EntitySeenRow(long Current, long LastSeen, bool Unread, long Count);

    public async Task<AdminMenuResult<CalendarEntitySeen>> MarkEntitySeenAsync(
        Guid staffId, string? propertyId, string? entityKind, string? entityId, string observedWatermark, CancellationToken cancellationToken)
    {
        // Anti-disclosure order, as every other route: a Calendar the Staff member may not read, or a Property outside their memberships, is the one 404; then the shape of propertyId (400).
        var (refusal, scope) = await ResolveOneAsync<CalendarEntitySeen>(staffId, AdminMenuKeys.Calendar, propertyId, cancellationToken);
        if (refusal is not null) return refusal;
        var property = scope!.PropertyId!.Value;

        // "0" or digits without a leading zero; an overflow is refused, never clamped.
        if (!IsPlainInteger(observedWatermark) || !long.TryParse(observedWatermark, NumberStyles.None, CultureInfo.InvariantCulture, out var watermark))
            return new AdminMenuResult<CalendarEntitySeen>(AdminMenuStatus.InvalidWatermark);

        // An object that cannot have activity (an unknown kind, an id that is not a GUID) is the same 404 as one that has none. The canonical lower-case key stops "ABC…" opening a second cursor row.
        if (!CalendarEntityKinds.IsKnown(entityKind) || !Guid.TryParse(entityId, out var entity) || entity == Guid.Empty)
            return new AdminMenuResult<CalendarEntitySeen>(AdminMenuStatus.UnknownMenu);
        var key = entity.ToString("D");

        var now = timeProvider.GetUtcNow();
        // ONE atomic statement. Permission and Property scope are re-read in it, the object must have activity in THIS Property now, and nothing is written for a watermark above the counter. GREATEST
        // keeps a repeated or out-of-order acknowledgement from moving the cursor back; only this one (Staff, Property, object) row is touched, and only to the watermark the client sent.
        var written = await database.Database.ExecuteSqlRawAsync(
            $"""
            WITH {Scopes}
            INSERT INTO "StaffEntitySeen" ("StaffAccountId", "PropertyId", "EntityKind", "EntityKey", "LastSeenSequence", "UpdatedAtUtc")
            SELECT sc."StaffId", sc."PropertyId", @kind, @key, @wm, @now FROM scopes sc
            WHERE sc."MenuKey" = 'calendar' AND sc."PropertyId" = @prop AND sc."Current" >= @wm
              AND EXISTS (SELECT 1 FROM "AdminActivities" a WHERE a."MenuKey" = 'calendar' AND a."PropertyId" = @prop AND a."EntityKind" = @kind AND a."EntityKey" = @key)
            ON CONFLICT ("StaffAccountId", "PropertyId", "EntityKind", "EntityKey") DO UPDATE SET
              "LastSeenSequence" = GREATEST("StaffEntitySeen"."LastSeenSequence", EXCLUDED."LastSeenSequence"),
              "UpdatedAtUtc" = CASE WHEN EXCLUDED."LastSeenSequence" > "StaffEntitySeen"."LastSeenSequence" THEN EXCLUDED."UpdatedAtUtc" ELSE "StaffEntitySeen"."UpdatedAtUtc" END
            """, Access([staffId], Text("kind", entityKind), Text("key", key), Uuid("prop", property), Big("wm", watermark), Time("now", now)));
        if (written == 0)
        {
            // Nothing was written: the permission was lost since the check above (404), the object has no activity in this Property (404), or the watermark is above the counter (400).
            var again = await ResolveAsync(staffId, AdminMenuKeys.Calendar, propertyId, cancellationToken);
            if (again.Status != AdminMenuStatus.Succeeded) return new AdminMenuResult<CalendarEntitySeen>(again.Status);
            var known = await database.Database.SqlQueryRaw<bool>(
                """SELECT EXISTS (SELECT 1 FROM "AdminActivities" a WHERE a."MenuKey" = 'calendar' AND a."PropertyId" = @prop AND a."EntityKind" = @kind AND a."EntityKey" = @key) AS "Value" """,
                Uuid("prop", property), Text("kind", entityKind), Text("key", key)).SingleAsync(cancellationToken);
            return new AdminMenuResult<CalendarEntitySeen>(known ? AdminMenuStatus.InvalidWatermark : AdminMenuStatus.UnknownMenu);
        }

        // The whole answer from ONE statement, so the object's cursor, whether it is still unread, the Property's unread count and the counter are one snapshot, and the permission that lets the answer
        // out is read in it too. A commit of another Staff member after the upsert can therefore never pair a stale object state with a newer count. No row = the permission was lost: the same 404.
#pragma warning disable EF1002 // the interpolated parts are constants of this class and CalendarUnreadSql; every value is a parameter
        var seen = await database.Database.SqlQueryRaw<EntitySeenRow>(
            $"""
            WITH {Scopes}
            SELECT sc."Current" AS "Current",
                   COALESCE((SELECT e."LastSeenSequence" FROM "StaffEntitySeen" e
                             WHERE e."StaffAccountId" = sc."StaffId" AND e."PropertyId" = @prop AND e."EntityKind" = @kind AND e."EntityKey" = @key), 0) AS "LastSeen",
                   EXISTS (SELECT 1 FROM "AdminActivities" a
                           {CalendarUnreadSql.JoinSeen("sc.\"StaffId\"")}
                           WHERE a."MenuKey" = 'calendar' AND a."PropertyId" = @prop AND a."EntityKind" = @kind AND a."EntityKey" = @key
                             AND {CalendarUnreadSql.Unread("sc.\"CreatedAtUtc\"", "sc.\"StaffId\"")}) AS "Unread",
                   (SELECT count(*) FROM (
                       SELECT 1 FROM "AdminActivities" a
                       {CalendarUnreadSql.JoinSeen("sc.\"StaffId\"")}
                       WHERE a."MenuKey" = 'calendar' AND a."PropertyId" = @prop AND {CalendarUnreadSql.Unread("sc.\"CreatedAtUtc\"", "sc.\"StaffId\"")}
                       GROUP BY a."EntityKind", a."EntityKey") q) AS "Count"
            FROM scopes sc
            WHERE sc."MenuKey" = 'calendar' AND sc."PropertyId" = @prop
            """, Access([staffId], Uuid("prop", property), Text("kind", entityKind), Text("key", key))).ToListAsync(cancellationToken);
#pragma warning restore EF1002

        return seen.Count == 0
            ? new AdminMenuResult<CalendarEntitySeen>(AdminMenuStatus.UnknownMenu)
            : new AdminMenuResult<CalendarEntitySeen>(AdminMenuStatus.Succeeded, new CalendarEntitySeen(property, entityKind!, key, Watermark(seen[0].LastSeen), seen[0].Unread, Clamp(seen[0].Count), Watermark(seen[0].Current)));
    }

    private static bool IsPlainInteger(string value) => value.Length > 0 && value.All(char.IsAsciiDigit) && (value == "0" || value[0] != '0');

    // ------------------------------------------------------------------------------------------------------------- history

    public async Task<AdminMenuResult<ActivityPage>> GetActivityAsync(Guid staffId, ActivityQuery query, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(query.Menu)) return Invalid("menu");
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        var (refusal, scope) = await ResolveOneAsync<ActivityPage>(staffId, query.Menu, query.PropertyId, cancellationToken);
        if (refusal is not null) return refusal;
        var menu = query.Menu!;

        Guid? actor = null;
        DateTimeOffset? from = null, to = null;
        var limit = DefaultLimit;
        if (query.ActorStaffId is not null)
        {
            if (!Guid.TryParse(query.ActorStaffId, out var parsedActor) || parsedActor == Guid.Empty) return Invalid("actorStaffId");
            actor = parsedActor;
        }

        if (query.From is not null && !TryInstant(query.From, out from)) return Invalid("from");
        if (query.To is not null && !TryInstant(query.To, out to)) return Invalid("to");
        if (from > to) return Invalid("to");
        if (query.Limit is not null && (!IsPlainInteger(query.Limit) || !int.TryParse(query.Limit, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit < 1 || limit > MaxLimit)) return Invalid("limit");

        long? after = null;
        if (query.Cursor is not null)
        {
            // Opaque, and bound to the menu, Property and filters it was made for: any other request refuses it. It carries a position only; permission always comes from this request.
            if (!TryReadCursor(query.Cursor, out var cursor) || cursor.M != menu || cursor.P != scope!.PropertyId || cursor.A != actor || cursor.F != from?.ToUniversalTime() || cursor.T != to?.ToUniversalTime() || cursor.S < 1) return Invalid("cursor");
            after = cursor.S;
        }

        // Newest first by Sequence; date and actor are filters, never the order. History keeps the Staff's own events and the ones before the D2 baseline.
        var table = menu == Newsletter
            ? """
              SELECT n."Sequence", n."OccurredAtUtc", 'Public' AS "ActorKind", NULL::uuid AS "ActorStaffId", 'verified' AS "Action", 'subscription' AS "EntityKind", n."SubscriptionId"::text AS "EntityKey",
                     'a subscription' AS "TitleSnapshot", 1 AS "ItemCount"
              FROM "NewsletterVerificationActivities" n WHERE @actor::uuid IS NULL AND (@after::bigint IS NULL OR n."Sequence" < @after)
                AND (@from::timestamptz IS NULL OR n."OccurredAtUtc" >= @from) AND (@to::timestamptz IS NULL OR n."OccurredAtUtc" < @to)
              ORDER BY n."Sequence" DESC LIMIT @take
              """
            : """
              SELECT a."Sequence", a."OccurredAtUtc", a."ActorKind", a."ActorStaffId", a."Action", a."EntityKind", a."EntityKey", a."TitleSnapshot", a."ItemCount"
              FROM "AdminActivities" a WHERE a."MenuKey" = @menu AND (@prop::uuid IS NULL OR a."PropertyId" = @prop) AND (@actor::uuid IS NULL OR a."ActorStaffId" = @actor)
                AND (@after::bigint IS NULL OR a."Sequence" < @after) AND (@from::timestamptz IS NULL OR a."OccurredAtUtc" >= @from) AND (@to::timestamptz IS NULL OR a."OccurredAtUtc" < @to)
              ORDER BY a."Sequence" DESC LIMIT @take
              """;
        var rows = await database.Database.SqlQueryRaw<ItemRow>(
            table, Text("menu", menu), Uuid("prop", scope!.PropertyId), Uuid("actor", actor), Big("after", after), Time("from", from), Time("to", to), new NpgsqlParameter("take", limit + 1)).ToListAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var page = rows.Take(limit).ToList();
        var next = rows.Count > limit ? WriteCursor(new HistoryCursor(menu, scope.PropertyId, actor, from?.ToUniversalTime(), to?.ToUniversalTime(), page[^1].Sequence)) : null;
        return new AdminMenuResult<ActivityPage>(AdminMenuStatus.Succeeded, new ActivityPage(
            menu, scope.PropertyId,
            [.. page.Select(row => new ActivityItem(Watermark(row.Sequence), row.OccurredAtUtc, row.ActorKind, row.ActorStaffId, row.Action, row.EntityKind, row.EntityKey, row.TitleSnapshot, row.ItemCount))], next));
    }

    private static AdminMenuResult<ActivityPage> Invalid(string field) => new(AdminMenuStatus.InvalidQuery, null, field);

    private static bool TryInstant(string text, out DateTimeOffset? value)
    {
        var ok = DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed);
        value = ok ? parsed.ToUniversalTime() : null;
        return ok;
    }

    private static string WriteCursor(HistoryCursor cursor) => Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(cursor, Web)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool TryReadCursor(string text, out HistoryCursor cursor)
    {
        cursor = null!;
        try
        {
            var padded = text.Replace('-', '+').Replace('_', '/');
            padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
            cursor = JsonSerializer.Deserialize<HistoryCursor>(Convert.FromBase64String(padded), Web)!;
            return cursor is not null;
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            return false;
        }
    }
}
