using System.Text.Json.Serialization;
using TheBha.Domain.Website;

namespace TheBha.Application.Activity;

/// <summary>ADR 0011 §C: which existing permission opens a menu. No new permission exists; the Calendar/Promotion ones are per Property, the others are global flags of the Staff account.</summary>
public enum AdminMenuPermission { Blog, Website, Promotions, Calendar }

/// <summary>The fixed menu → permission map of ADR 0011 §C. A key that is not here is unknown (404), never stored and never counted.</summary>
public static class AdminMenus
{
    private static readonly IReadOnlyDictionary<string, AdminMenuPermission> Map = new Dictionary<string, AdminMenuPermission>(StringComparer.Ordinal)
    {
        [AdminMenuKeys.BlogPosts] = AdminMenuPermission.Blog,
        [AdminMenuKeys.BlogCategories] = AdminMenuPermission.Blog,
        [AdminMenuKeys.BlogMedia] = AdminMenuPermission.Blog,
        [AdminMenuKeys.BlogSettings] = AdminMenuPermission.Blog,
        [AdminMenuKeys.WebsiteHero] = AdminMenuPermission.Website,
        [AdminMenuKeys.WebsiteMenus] = AdminMenuPermission.Website,
        [AdminMenuKeys.WebsiteLanguages] = AdminMenuPermission.Website,
        [AdminMenuKeys.WebsiteTranslations] = AdminMenuPermission.Website,
        [AdminMenuKeys.WebsiteCurrencies] = AdminMenuPermission.Website,
        [AdminMenuKeys.WebsiteSocial] = AdminMenuPermission.Website,
        [AdminMenuKeys.NewsletterSender] = AdminMenuPermission.Website,
        [MenuActivityStream.Newsletter] = AdminMenuPermission.Website,
        [AdminMenuKeys.Catalog] = AdminMenuPermission.Website,
        [AdminMenuKeys.Promotions] = AdminMenuPermission.Promotions,
        [AdminMenuKeys.Calendar] = AdminMenuPermission.Calendar
    };

    public static bool IsKnown(string? key) => key is not null && Map.ContainsKey(key);

    public static string[] KeysOf(AdminMenuPermission permission) => [.. Map.Where(pair => pair.Value == permission).Select(pair => pair.Key)];
}

/// <summary>
/// The roles that hold the two Property permissions the menus need. Filled by the host from its permission map (<c>BoardRead</c>, <c>PromotionManage</c>), so this layer never
/// repeats the role matrix of ADR 0007/0009.
/// </summary>
public sealed record AdminMenuRoles(IReadOnlyList<string> PromotionManage, IReadOnlyList<string> BoardRead);

/// <summary>
/// One menu of the aggregate. A global menu has <see cref="LastSeenWatermark"/>/<see cref="CurrentWatermark"/>; a Property-scoped one (<c>promotions</c>, <c>calendar</c>) has
/// <see cref="ByProperty"/> and its <see cref="Count"/> is the sum of it. Watermarks are decimal strings (never a JSON number).
/// </summary>
public sealed record MenuUnseenEntry(
    int Count,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? LastSeenWatermark = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? CurrentWatermark = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<MenuUnseenPropertyEntry>? ByProperty = null);

public sealed record MenuUnseenPropertyEntry(Guid PropertyId, int Count, string LastSeenWatermark, string CurrentWatermark);

/// <summary>Only the menus (and Properties) the Staff member may read are present; one that is not allowed is absent, never 0.</summary>
public sealed record MenuUnseenSummary(IReadOnlyDictionary<string, MenuUnseenEntry> Menus);

public sealed record ActivityActor(string Kind, Guid? StaffId);

/// <summary>One group of the unseen list: one actor and one object (Calendar: one object, several actors). <see cref="Events"/> counts logical events, the number the badge uses.</summary>
public sealed record UnseenGroup(
    string EntityKind, string EntityKey, string TitleSnapshot, string Action, int Events, int ItemCount, string LatestWatermark, DateTimeOffset OccurredAtUtc, IReadOnlyList<ActivityActor> Actors);

/// <summary><see cref="UnseenEvents"/> is the exact total after the badge's own filters (unread objects for Calendar), whatever the 50-group window shows. Read from one snapshot; nothing is written.</summary>
public sealed record MenuChanges(string Menu, Guid? PropertyId, int UnseenEvents, bool HasMore, string LastSeenWatermark, string SnapshotWatermark, IReadOnlyList<UnseenGroup> Groups);

public sealed record ActivityItem(
    string Sequence, DateTimeOffset OccurredAtUtc, string ActorKind, Guid? ActorStaffId, string Action, string EntityKind, string EntityKey, string TitleSnapshot, int ItemCount);

public sealed record ActivityPage(string Menu, Guid? PropertyId, IReadOnlyList<ActivityItem> Items, string? NextCursor);

/// <summary>Everything is the raw text of the request: the service validates it AFTER it knows the Staff member may read the menu, so a refusal never tells a forbidden menu from an unknown one.</summary>
public sealed record ActivityQuery(string? Menu, string? PropertyId, string? ActorStaffId, string? From, string? To, string? Limit, string? Cursor);

public enum AdminMenuStatus { Succeeded, UnknownMenu, InvalidWatermark, InvalidProperty, UseEntitySeen, InvalidQuery }

public sealed record AdminMenuResult<T>(AdminMenuStatus Status, T? Value = default, string? Field = null);

/// <summary>
/// ADR 0011 §B. The Staff id is always the authenticated one. Permission and Property scope are read from the database on every call and applied before anything is counted or listed.
/// </summary>
public interface IAdminMenuUnseen
{
    /// <summary>One statement, one snapshot, never writes. Newsletter is served from its legacy tables until PR-14.</summary>
    Task<MenuUnseenSummary> GetSummaryAsync(Guid staffId, CancellationToken cancellationToken);

    Task<AdminMenuResult<MenuChanges>> GetChangesAsync(Guid staffId, string menu, string? propertyId, CancellationToken cancellationToken);

    /// <summary>Moves the cursor up to <paramref name="viewWatermark"/> (never down, never above the counter) and returns the entry after the move. Calendar answers <see cref="AdminMenuStatus.UseEntitySeen"/>.</summary>
    Task<AdminMenuResult<MenuUnseenEntry>> MarkSeenAsync(Guid staffId, string menu, string? propertyId, string viewWatermark, CancellationToken cancellationToken);

    Task<AdminMenuResult<ActivityPage>> GetActivityAsync(Guid staffId, ActivityQuery query, CancellationToken cancellationToken);
}

/// <summary>A connected Staff account, as the database sees it now. <see cref="CanRead"/> says whether it may read the menu (and Property) asked about.</summary>
public sealed record AdminMenuRecipient(Guid StaffId, string SecurityStamp, bool CanRead);

/// <summary>The one permission reader of the live hint: the same rules as the HTTP reads, applied to a list of Staff ids in one statement. An id that is not returned is missing or disabled.</summary>
public interface IAdminMenuAccess
{
    /// <summary>True when the account is active and may read at least one menu (the connect-time check of the hint hub).</summary>
    Task<bool> CanReadAnyAsync(Guid staffId, CancellationToken cancellationToken);

    Task<IReadOnlyList<AdminMenuRecipient>> JudgeAsync(string menu, Guid? propertyId, IReadOnlyCollection<Guid> staffIds, CancellationToken cancellationToken);
}

/// <summary>
/// ADR 0011 §E: tells connected Admin screens that a menu (and Property) changed, so they read the API again. The hint carries only the menu key and the Property id (when the menu is
/// Property-scoped): no title, count or actor. <b>The caller must call it AFTER its transaction committed</b>: an implementation throws <see cref="InvalidOperationException"/> when a
/// transaction is still open on the caller's context, because a hint sent before COMMIT would make a screen read the old state (and a rollback would leave a hint with no change).
/// Delivery is best effort and limited to this API instance; it never throws for a delivery problem. Nothing calls it in production yet (PR-3).
/// </summary>
public interface IAdminActivityHint
{
    Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken);
}
