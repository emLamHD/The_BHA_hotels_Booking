using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace TheBha.Api.Controllers;

/// <summary>
/// PMS-CAL-001.1 correction C2: enforces <see cref="AdminCalendarOptions.EnableUnauthenticatedRead"/>
/// as a resource filter, which runs before model binding and <c>[ApiController]</c>'s
/// automatic validation — not inside the action body. Checking it in the action
/// body let a missing/malformed <c>from</c>/<c>to</c> reach automatic model
/// validation before the gate ever ran, so a disabled deployment returned 400
/// for a malformed request but 404 for a valid one, making the "unavailable"
/// endpoint distinguishable from a genuinely absent route. Applied only to
/// <see cref="AdminReservationBoardController"/> via <c>[ServiceFilter]</c> —
/// never registered globally — so no other route is affected.
///
/// <para>
/// Correction C3: <c>Cache-Control: no-store</c> is now set unconditionally as
/// the first statement here, before the gate check — not only on the
/// disabled-gate path. This runs ahead of model binding too, so a
/// gate-enabled request whose <c>from</c>/<c>to</c> fails <c>[ApiController]</c>'s
/// automatic validation (which short-circuits before <c>GetBoard</c>'s own
/// <c>Response.Headers.CacheControl</c> line ever executes) still carries the
/// header. The action keeps its own <c>no-store</c> assignment too, as
/// harmless defense-in-depth for its own response paths.
/// </para>
///
/// <para>
/// Correction C5: the gate is now <em>environment-first</em> and fails closed.
/// <c>Program.cs</c>'s startup guard binds one configuration snapshot and
/// refuses to start a Production host with the flag already on, but
/// <see cref="IOptions{TOptions}"/> materializes its value lazily, on first
/// access — here, on the first Reservation Board request. A reloadable
/// configuration source (for example <c>appsettings.json</c> with
/// <c>reloadOnChange</c>) could therefore be changed to <c>true</c> after the
/// startup check had already passed, and the first materialization would bind
/// that later value and open the endpoint. Because this endpoint returns guest
/// names, confirmation numbers and stay dates, and CORS restricts only
/// browsers — never curl or a server-to-server client — that is a real
/// exposure boundary. The environment is fixed for the life of the process, so
/// testing it first (and short-circuiting before the reloadable option is read
/// at all outside Development) makes it impossible for any configuration
/// change to open this endpoint in Production or any other non-Development
/// host. The startup guard remains, as defense in depth.
/// </para>
///
/// <para>
/// Correction C7: the gate is also <em>transport-first</em>. <c>Program.cs</c>'s
/// <c>app.UseHttpsRedirection()</c> does not by itself guarantee that cleartext
/// is refused — when the API runs on the HTTP-only launch profile (or any
/// HTTP-only Kestrel configuration) that middleware cannot discover an HTTPS
/// port, so it logs a warning and passes the request through. Development also
/// enables the unauthenticated read, so a direct HTTP client could read guest
/// names, confirmation numbers and stay dates in the clear; CORS protects
/// browsers only, never curl or a server-to-server caller. Checking
/// <see cref="HttpRequest.IsHttps"/> here closes that hole at the one boundary
/// that already runs before model binding, without touching the global
/// middleware, ports, or Forwarded Headers configuration. <c>IsHttps</c> is the
/// server's own view of the connection, so a spoofed <c>Origin</c> or
/// hand-written <c>X-Forwarded-Proto</c> cannot satisfy it unless trusted
/// forwarded-header infrastructure has legitimately established it.
/// </para>
///
/// <para>
/// Correction C9: the gate is also <em>loopback-only</em>. "Development" is a
/// configuration value, not a location — a process started with
/// <c>ASPNETCORE_ENVIRONMENT=Development</c> on a remote host, listening on a
/// LAN, container or wildcard address, satisfied every condition above, so any
/// HTTPS client able to reach the socket could read guest names, confirmation
/// numbers and stay dates without authenticating. CORS restricts browsers
/// only, never <c>curl</c> or a server-to-server caller. The connection's own
/// addresses are what actually mean "same machine", so both ends must be
/// loopback, and a missing address fails closed rather than being assumed
/// local.
/// </para>
///
/// <para>
/// These come from <see cref="ConnectionInfo"/>, which the server fills in
/// from the accepted socket — not from <c>Host</c>, <c>Origin</c>,
/// <c>Referer</c> or any <c>X-Forwarded-*</c>/<c>Forwarded</c> header, all of
/// which the caller writes. C9 deliberately adds no forwarded-header trust:
/// that would turn a request header back into a location claim, which is the
/// weakness being closed. This is defense in depth, not the whole defense —
/// the Development configuration no longer enables the flag at all, and the
/// local HTTPS launch profile is the only supported opt-in.
/// </para>
/// </summary>
public sealed class AdminReservationBoardReadGateFilter(
    IHostEnvironment hostEnvironment,
    IOptions<AdminCalendarOptions> adminCalendarOptions) : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        context.HttpContext.Response.Headers.CacheControl = "no-store";

        // `||` short-circuits, so the order is deliberate: cleartext is refused
        // without consulting anything else, outside Development nothing further
        // is examined, and a non-local connection is refused before the
        // reloadable option is ever materialized — so nothing it could later
        // bind matters. Only an HTTPS, Development, loopback-to-loopback
        // request reads the option, and only then may the action run.
        var connection = context.HttpContext.Connection;
        if (!context.HttpContext.Request.IsHttps ||
            !hostEnvironment.IsDevelopment() ||
            !IsLoopback(connection.LocalIpAddress) ||
            !IsLoopback(connection.RemoteIpAddress) ||
            !adminCalendarOptions.Value.EnableUnauthenticatedRead)
        {
            context.Result = new NotFoundResult();
        }
    }

    /// <summary>
    /// A null address fails closed: it means the server could not tell us where
    /// the connection came from, which is never a reason to assume it is local.
    /// IPv4-mapped IPv6 (<c>::ffff:127.0.0.1</c>, how a dual-stack listener can
    /// report an IPv4 peer) is unwrapped first so it is judged on the address
    /// it actually carries. <c>0.0.0.0</c> and <c>::</c> are not loopback.
    /// </summary>
    private static bool IsLoopback(IPAddress? address)
    {
        if (address is null)
        {
            return false;
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        return IPAddress.IsLoopback(address);
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
