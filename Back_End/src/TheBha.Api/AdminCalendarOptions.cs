namespace TheBha.Api;

/// <summary>
/// PMS-CAL-001.1: gates the unauthenticated Admin Reservation Board read
/// endpoint, since Admin authentication/RBAC is explicitly deferred. Defaults
/// to <c>false</c> everywhere; only the local Development configuration
/// enables it. <c>Program.cs</c> makes it startup-fatal to run Production
/// with this set to <c>true</c> — see the comment there.
///
/// <para>
/// Security boundary (correction C5): this flag alone never opens the
/// endpoint. <c>AdminReservationBoardReadGateFilter</c> requires a
/// Development host <em>and</em> this flag, checked per request, so setting
/// it to <c>true</c> in any other environment — including through a
/// configuration reload after startup — leaves the endpoint unavailable.
/// </para>
/// </summary>
public sealed class AdminCalendarOptions
{
    public const string SectionName = "AdminCalendar";

    public bool EnableUnauthenticatedRead { get; set; }
}
