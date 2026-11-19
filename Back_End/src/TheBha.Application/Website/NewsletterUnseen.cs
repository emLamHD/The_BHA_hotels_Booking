namespace TheBha.Application.Website;

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: the menus that carry an "unseen" badge. Only the Newsletter has one; a key that is not here is refused, never stored.
/// </summary>
public static class MenuUnseenKeys
{
    public const string Newsletter = "newsletter";
    public static bool IsKnown(string? key) => key == Newsletter;
}

/// <summary>
/// What one Staff member has not seen of one menu. <see cref="Count"/> is the number of verifications after <see cref="LastSeenWatermark"/> (a verification that was deleted with its
/// subscription no longer counts); <see cref="CurrentWatermark"/> is the newest committed one. The watermarks are decimal strings so a JavaScript client never rounds them; the
/// client treats them as opaque and compares them as integers, never by time. All three come from ONE snapshot of the database.
/// </summary>
public sealed record MenuUnseenEntryDto(int Count, string LastSeenWatermark, string CurrentWatermark);

public sealed record MenuUnseenDto(MenuUnseenEntryDto Newsletter);

public enum MenuSeenStatus { Succeeded, UnknownMenu, InvalidWatermark }

public sealed record MenuSeenResult(MenuSeenStatus Status, MenuUnseenDto? Value);

/// <summary>
/// The per-Staff "seen" state of the menus' activity streams. The Staff id is always the authenticated one; there is no way to read or write another member's cursor.
/// </summary>
public interface IMenuUnseen
{
    /// <summary>Counts without changing anything. A Staff member with no cursor counts from 0.</summary>
    Task<MenuUnseenDto> GetAsync(Guid staffId, CancellationToken cancellationToken);

    /// <summary>
    /// Moves the member's cursor for the menu up to <paramref name="viewWatermark"/> (never down: an older call arriving late changes nothing) and returns the counts after it.
    /// A watermark above the newest committed one is <see cref="MenuSeenStatus.InvalidWatermark"/>; it is never clamped to "everything so far".
    /// </summary>
    Task<MenuSeenResult> MarkSeenAsync(Guid staffId, string menuKey, long viewWatermark, CancellationToken cancellationToken);
}
