namespace TheBha.Api;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP04 (D7): how the Admin Calendar is opened. <see cref="LocalGate"/> is the
/// local Development gates and their opt-in flags, unchanged. <see cref="Staff"/> is a Staff
/// session plus a Property permission read from the database; the local gates and flags are not
/// consulted, and an Admin route without a Staff permission is closed (404).
/// </summary>
public enum AdminCalendarAccessMode
{
    LocalGate,
    Staff
}

/// <summary>
/// The access mode, validated and captured once at startup (<c>Program.cs</c>) and handed to the
/// filters and middleware as this value — never read per request from configuration or
/// <c>IOptions</c>, so only a restart changes it.
/// </summary>
public sealed record AdminCalendarAccess(AdminCalendarAccessMode Mode)
{
    public const string ModeKey = "AdminCalendar:AccessMode";

    /// <summary>
    /// A missing key is <see cref="AdminCalendarAccessMode.LocalGate"/> (the CP04 default). A key
    /// that is present must be exactly <c>LocalGate</c> or <c>Staff</c> (ordinal): an empty value,
    /// another spelling, a number or a nested section stops the host instead of falling back.
    /// </summary>
    public static AdminCalendarAccess FromConfiguration(IConfiguration configuration)
    {
        var section = configuration.GetSection(ModeKey);
        if (!section.Exists())
        {
            return new AdminCalendarAccess(AdminCalendarAccessMode.LocalGate);
        }

        return section.Value switch
        {
            nameof(AdminCalendarAccessMode.LocalGate) => new AdminCalendarAccess(AdminCalendarAccessMode.LocalGate),
            nameof(AdminCalendarAccessMode.Staff) => new AdminCalendarAccess(AdminCalendarAccessMode.Staff),
            _ => throw new InvalidOperationException($"{ModeKey} must be exactly LocalGate or Staff.")
        };
    }
}

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

    /// <summary>
    /// PMS-CAL-001.2-CP01: the separate opt-in for the local Admin Calendar
    /// <em>write</em> boundary. Defaults to <c>false</c> everywhere, including
    /// Development, and is deliberately not set by any checked-in
    /// <c>appsettings</c> file or launch profile — the only supported way to
    /// turn it on is an explicit local environment variable
    /// (<c>AdminCalendar__EnableUnauthenticatedWrite=true</c>), documented in
    /// the repository README. <c>Program.cs</c> makes it startup-fatal to run
    /// Production with this set to <c>true</c>.
    ///
    /// <para>
    /// It is independent of <see cref="EnableUnauthenticatedRead"/> in both
    /// directions: enabling the read never enables the write, and enabling the
    /// write never changes the read flag. Writing is the strictly more
    /// dangerous capability, so it never inherits an opt-in granted for
    /// reading.
    /// </para>
    ///
    /// <para>
    /// Security boundary: this flag alone never opens anything, and it is the
    /// <em>last</em> environmental condition checked.
    /// <see cref="TheBha.Api.Controllers.AdminCalendarWriteGateFilter"/>
    /// requires, per request, an HTTPS transport, a Development host, a
    /// loopback-to-loopback connection and the absence of any forwarded-header
    /// claim before this flag is consulted at all — so setting it to
    /// <c>true</c> in another environment, on a LAN/container/wildcard
    /// listener, or behind a proxy leaves the write boundary closed.
    /// </para>
    ///
    /// <para>
    /// Correction C1, finding 1: unlike
    /// <see cref="EnableUnauthenticatedRead"/>, this value is read from
    /// configuration <em>once, at startup</em>, and handed to the write gate as
    /// a plain <see cref="bool"/>; the gate never resolves
    /// <see cref="Microsoft.Extensions.Options.IOptions{TOptions}"/> per
    /// request. <c>IOptions&lt;T&gt;</c> materializes lazily, so a Development
    /// host that started with this <c>false</c> could otherwise have it bound
    /// to <c>true</c> by a reloadable configuration source before the first
    /// Admin request, and Development is exactly where this gate operates —
    /// the environment-first ordering that protects every other host would not
    /// have covered it. Changing this flag therefore requires restarting the
    /// API, which is what the repository README tells a local operator.
    /// </para>
    ///
    /// <para>
    /// Scope: same-machine development only, and CP01 exposes no business
    /// mutation endpoint at all — enabling this flag does not create an
    /// assignment, move or block API. Admin authentication/RBAC remains
    /// deferred, so this is not production readiness.
    /// </para>
    /// </summary>
    public bool EnableUnauthenticatedWrite { get; set; }
}
