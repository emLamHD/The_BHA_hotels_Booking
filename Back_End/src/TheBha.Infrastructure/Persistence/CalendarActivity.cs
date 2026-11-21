using TheBha.Application.Activity;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR12 (ADR 0011 §D): how a Calendar write names its event. The OBJECT is the identity (a ReservationUnit or a RoomBlock), never a segment; one operation on one object is one
/// event however many segments it replaces. The title is composed here from room numbers and dates only: never a guest name, confirmation number, reason, e-mail or phone.
/// </summary>
internal static class CalendarActivity
{
    public const string Menu = AdminMenuKeys.Calendar;

    /// <summary>Appends one event of a verified Staff member. Call it as the LAST statement before COMMIT (the recorder throws without a transaction).</summary>
    public static Task RecordStaffAsync(
        IAdminActivityRecorder recorder, Guid propertyId, Guid staffId, string action, string kind, Guid key, string title, CancellationToken cancellationToken) =>
        recorder.RecordAsync(new AdminActivityEntry(Menu, propertyId, AdminActorKind.Staff, staffId, action, kind, key.ToString("D"), title), cancellationToken);

    /// <summary>An event no Staff member caused (a guest's cancellation): counted for every Staff member, with no actor id.</summary>
    public static Task RecordPublicAsync(
        IAdminActivityRecorder recorder, Guid propertyId, string action, string kind, Guid key, string title, CancellationToken cancellationToken) =>
        recorder.RecordAsync(new AdminActivityEntry(Menu, propertyId, AdminActorKind.Public, null, action, kind, key.ToString("D"), title), cancellationToken);

    /// <summary>Called only after COMMIT, on no open transaction. Not given the caller's token: the change is already durable, and delivery is bounded and best effort.</summary>
    public static Task HintAsync(IAdminActivityHint hint, Guid propertyId) => hint.PublishAsync(Menu, propertyId, CancellationToken.None);

    public static string Title(string label, DateOnly start, DateOnly end) => $"{label} {start:yyyy-MM-dd} to {end:yyyy-MM-dd}";

    public static string Rooms(IEnumerable<string> roomNumbers) => "Room " + string.Join(" / ", roomNumbers.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));

    public const string Unassigned = "Unassigned";

    /// <summary>One operation on one object: the action is the strongest of its replacements (0 = <paramref name="none"/>, 2 or more = <paramref name="many"/>, else <paramref name="one"/>).</summary>
    public static string ActionOf(IEnumerable<int> replacementCounts, string none, string one, string many)
    {
        var counts = replacementCounts.ToArray();
        return counts.Contains(0) ? none : counts.Any(count => count >= 2) ? many : one;
    }
}
