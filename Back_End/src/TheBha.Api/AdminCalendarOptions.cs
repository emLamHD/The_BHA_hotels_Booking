namespace TheBha.Api;

/// <summary>
/// PMS-CAL-001.1: gates the unauthenticated Admin Reservation Board read
/// endpoint, since Admin authentication/RBAC is explicitly deferred. Defaults
/// to <c>false</c> everywhere, <em>including</em> Development (correction C9):
/// the only supported way to turn it on is the local HTTPS launch profile,
/// which sets <c>AdminCalendar__EnableUnauthenticatedRead=true</c> and binds
/// to <c>localhost</c>. <c>Program.cs</c> makes it startup-fatal to run
/// Production with this set to <c>true</c> — see the comment there.
///
/// <para>
/// Security boundary (corrections C5, C7 and C9): this flag alone never opens
/// the endpoint, and it is the <em>last</em> thing checked.
/// <c>AdminReservationBoardReadGateFilter</c> requires, per request, an HTTPS
/// transport, a Development host, and a loopback-to-loopback connection before
/// it even reads this flag. Setting it to <c>true</c> elsewhere — in another
/// environment, on a LAN/container/wildcard listener, or through a
/// configuration reload after startup — leaves the endpoint unavailable.
/// </para>
///
/// <para>
/// Scope: same-machine development only. This endpoint must never be reachable
/// through a LAN or public listener, or through an external-facing proxy.
/// Admin authentication/RBAC remains deferred, so this is not production
/// readiness.
/// </para>
/// </summary>
public sealed class AdminCalendarOptions
{
    public const string SectionName = "AdminCalendar";

    public bool EnableUnauthenticatedRead { get; set; }
}
