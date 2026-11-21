using System.Globalization;
using TheBha.Application.Activity;
using TheBha.Application.Website;
using TheBha.Infrastructure.Persistence.Activity;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-NEWSLETTER-BADGE-001, adapter since BHA-ADMIN-BADGE-001-PR14: the legacy <c>/api/admin/v1/website/menu-unseen</c> routes keep their shape and their website-permission boundary for the Admin builds
/// that still call them during the rollout, but they read and write through <see cref="AdminMenuUnseenService"/>, the same code (marker-aware source, cursor, counter check, <c>GREATEST</c>) as the shared
/// routes, so the two can never disagree. It never locks a subscription and holds no transaction over a network call.
/// </summary>
internal sealed class MenuUnseenService(AdminMenuUnseenService shared) : IMenuUnseen
{
    public async Task<MenuUnseenDto> GetAsync(Guid staffId, CancellationToken cancellationToken) =>
        ToDto(await shared.GetEntryAsync(staffId, MenuUnseenKeys.Newsletter, cancellationToken));

    public async Task<MenuSeenResult> MarkSeenAsync(Guid staffId, string menuKey, long viewWatermark, CancellationToken cancellationToken)
    {
        if (!MenuUnseenKeys.IsKnown(menuKey)) return new MenuSeenResult(MenuSeenStatus.UnknownMenu, null);
        if (viewWatermark < 0) return new MenuSeenResult(MenuSeenStatus.InvalidWatermark, null);

        var result = await shared.MarkSeenAsync(staffId, menuKey, null, viewWatermark.ToString(CultureInfo.InvariantCulture), cancellationToken);
        return result.Status switch
        {
            AdminMenuStatus.Succeeded => new MenuSeenResult(MenuSeenStatus.Succeeded, ToDto(result.Value)),
            AdminMenuStatus.UnknownMenu => new MenuSeenResult(MenuSeenStatus.UnknownMenu, null),
            _ => new MenuSeenResult(MenuSeenStatus.InvalidWatermark, null)
        };
    }

    // The route's permission check ran before this; a Staff member who lost the permission in between gets zeros, never another menu's numbers.
    private static MenuUnseenDto ToDto(MenuUnseenEntry? entry) =>
        new(new MenuUnseenEntryDto(entry?.Count ?? 0, entry?.LastSeenWatermark ?? "0", entry?.CurrentWatermark ?? "0"));
}
