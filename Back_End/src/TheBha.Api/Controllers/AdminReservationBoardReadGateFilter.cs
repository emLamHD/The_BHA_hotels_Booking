using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
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
/// </summary>
public sealed class AdminReservationBoardReadGateFilter(IOptions<AdminCalendarOptions> adminCalendarOptions)
    : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        context.HttpContext.Response.Headers.CacheControl = "no-store";

        if (adminCalendarOptions.Value.EnableUnauthenticatedRead)
        {
            return;
        }

        context.Result = new NotFoundResult();
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
