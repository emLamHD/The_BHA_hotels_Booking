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
/// </summary>
public sealed class AdminReservationBoardReadGateFilter(IOptions<AdminCalendarOptions> adminCalendarOptions)
    : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        if (adminCalendarOptions.Value.EnableUnauthenticatedRead)
        {
            return;
        }

        context.HttpContext.Response.Headers.CacheControl = "no-store";
        context.Result = new NotFoundResult();
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
