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

public enum NewsletterCutoverStatus
{
    /// <summary>This run copied the surviving legacy rows and wrote the marker.</summary>
    Committed,
    /// <summary>A marker already existed: nothing was copied and it was not touched.</summary>
    AlreadyCutOver,
    /// <summary><c>AdminActivities</c> already holds Newsletter rows but there is no marker: an inconsistent state, never merged. Nothing was written.</summary>
    SharedRowsWithoutMarker,
    /// <summary>The table lock (or the counter) was not granted within the timeout. Nothing was written; run it again later.</summary>
    LockTimeout,
    /// <summary>
    /// COMMIT was requested but its answer never arrived (connection lost, timeout, cancellation): the cutover may or may not have committed. Neither a commit nor a rollback is claimed; check the marker
    /// on a new connection or run the same, idempotent command again.
    /// </summary>
    OutcomeUnknown
}

/// <summary>The outcome of one cutover run. The marker values are the ones now in the database (new, or the existing ones); both are null when no marker exists.</summary>
public sealed record NewsletterCutoverResult(NewsletterCutoverStatus Status, long? LegacyMaxSequence, DateTimeOffset? CutoverAtUtc, int CopiedRows);

/// <summary>
/// BHA-ADMIN-BADGE-001-PR14 (ADR 0011 §E): the one-time move of the Newsletter's activity to <c>AdminActivities</c>. One transaction takes the legacy-table lock, then the counter, reads the legacy
/// set under them, copies it with its original <c>Sequence</c> and writes the marker; any failure rolls all of it back. Only an operator command runs it, never startup or a migration.
/// </summary>
public interface INewsletterActivityCutover
{
    Task<NewsletterCutoverResult> RunAsync(TimeSpan lockTimeout, CancellationToken cancellationToken);
}
