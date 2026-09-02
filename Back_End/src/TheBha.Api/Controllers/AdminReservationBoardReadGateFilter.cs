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
/// </summary>
public sealed class AdminReservationBoardReadGateFilter(
    IHostEnvironment hostEnvironment,
    IOptions<AdminCalendarOptions> adminCalendarOptions) : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        context.HttpContext.Response.Headers.CacheControl = "no-store";

        // `||` short-circuits: outside Development the reloadable option is
        // never even materialized, so nothing it could later bind matters.
        if (!hostEnvironment.IsDevelopment() ||
            !adminCalendarOptions.Value.EnableUnauthenticatedRead)
        {
            context.Result = new NotFoundResult();
        }
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
