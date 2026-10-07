namespace TheBha.Api;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP04 (D7): how the Admin Calendar is opened. <see cref="LocalGate"/> is the
/// local Development gates and their opt-in flags, unchanged. <see cref="Staff"/> is a Staff
/// session plus a Property permission read from the database; the local gates and flags are not
/// consulted, and an Admin route without a Staff permission is closed (404).
/// CP07: <see cref="Staff"/> is the default, and <c>Program.cs</c> refuses to start a host that
/// selects <see cref="LocalGate"/> outside Development.
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
    /// A key that no configuration source declares is <see cref="AdminCalendarAccessMode.Staff"/>
    /// (CP07; it was LocalGate in CP04–CP06). A declared key must be a scalar that is exactly <c>LocalGate</c> or
    /// <c>Staff</c> (ordinal), with no child: an empty or null value, an empty JSON object or array,
    /// another spelling, a number or a nested section stops the host instead of falling back.
    ///
    /// <para>
    /// CP04-C1: presence is decided by listing the <c>AdminCalendar</c> children, not by
    /// <c>Exists()</c>. The JSON provider stores <c>"AccessMode": {}</c> or <c>[]</c> as the key
    /// with a <c>null</c> value, which <c>Exists()</c> reports as absent; every provider still lists
    /// it as a child (key names compared case-insensitively, as configuration does). The value and
    /// children read afterwards are the effective ones across providers, so a higher-priority empty
    /// declaration overrides a lower valid one, and a source that does not declare the key leaves
    /// the others' value in place.
    /// </para>
    /// </summary>
    public static AdminCalendarAccess FromConfiguration(IConfiguration configuration)
    {
        var mode = configuration.GetSection(AdminCalendarOptions.SectionName)
            .GetChildren()
            .FirstOrDefault(child => string.Equals(child.Key, ModeName, StringComparison.OrdinalIgnoreCase));
        if (mode is null)
        {
            return new AdminCalendarAccess(AdminCalendarAccessMode.Staff);
        }

        return mode.GetChildren().Any()
            ? throw Invalid()
            : mode.Value switch
            {
                nameof(AdminCalendarAccessMode.LocalGate) => new AdminCalendarAccess(AdminCalendarAccessMode.LocalGate),
                nameof(AdminCalendarAccessMode.Staff) => new AdminCalendarAccess(AdminCalendarAccessMode.Staff),
                _ => throw Invalid()
            };
    }

    private const string ModeName = "AccessMode";

    private static InvalidOperationException Invalid() =>
        new($"{ModeKey} must be exactly LocalGate or Staff.");
}

/// <summary>
/// PMS-CAL-001.1: gates the unauthenticated Admin Reservation Board read
/// endpoint of <c>AccessMode=LocalGate</c>. Defaults to <c>false</c>
/// everywhere, <em>including</em> Development (correction C9): the only
/// supported way to turn it on is an explicit local environment variable,
/// <c>AdminCalendar__EnableUnauthenticatedRead=true</c>, together with
/// <c>AdminCalendar__AccessMode=LocalGate</c> on a Development host bound to
/// <c>localhost</c> (CP07: no launch profile sets it any more, and in the
/// default <c>Staff</c> mode it is not consulted). <c>Program.cs</c> makes it startup-fatal to run
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
/// The LocalGate read has no authentication/RBAC, so it is never production
/// readiness; Staff authentication/RBAC is <c>AccessMode=Staff</c> (CP03–CP07).
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
    /// Scope: same-machine development only, and the flag itself creates no
    /// endpoint. The LocalGate writes have no authentication/RBAC, so this is
    /// never production readiness; Staff authorization of the writes is
    /// <c>AccessMode=Staff</c> (CP05–CP07).
    /// </para>
    /// </summary>
    public bool EnableUnauthenticatedWrite { get; set; }
}
