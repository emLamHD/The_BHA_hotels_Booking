using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Hosting;
using TheBha.Api.Authentication;

namespace TheBha.Api.Controllers;

/// <summary>
/// PMS-CAL-001.2-CP01: the local Admin Calendar <em>write</em> boundary.
///
/// <para>
/// Five actions apply this filter, all of them thin adapters over an
/// already-accepted mutation command:
/// <see cref="AdminReservationAssignmentsController.Create"/> (CP02),
/// <see cref="AdminReservationAssignmentsController.Move"/> and
/// <see cref="AdminReservationAssignmentsController.Unassign"/> (CP04B),
/// <see cref="AdminOperationalBlocksController.Create"/>
/// (`PMS-CAL-001.3-CP01`) and <see cref="AdminOperationalBlocksController.Cancel"/>
/// (`PMS-CAL-001.3-CP02`). Assignment split/swap/batch and OperationalBlock
/// move/split remain unexposed. This filter is a resource filter, not
/// middleware and not a policy framework: it is registered in DI, never added
/// globally, and never attached to the read board or any Customer route.
/// </para>
///
/// <para>
/// Correction C5: being a resource filter is also this gate's one structural
/// limit — it cannot run before middleware, and on a dual-listener host
/// <c>UseHttpsRedirection</c> answers a cleartext request with a 307 before any
/// filter runs. Since 307 preserves method and body, a redirect-following
/// client would have completed an Admin write that never reached this gate.
/// <c>Program.cs</c> therefore refuses cleartext Admin mutation verbs in a small
/// guard placed ahead of the redirect, with the same detail-free 404 and
/// <c>no-store</c> used here. The <c>IsHttps</c> check below is unchanged and
/// stays as defence in depth: it still refuses cleartext in any pipeline that
/// does not pass through that guard.
/// </para>
///
/// <para>
/// A resource filter is the right stage because it runs <em>before</em> model
/// binding and <c>[ApiController]</c>'s automatic validation. A closed gate
/// therefore answers a valid body and a malformed one identically, and no
/// action, mutation store or database call is reached in either case — the
/// same property <see cref="AdminReservationBoardReadGateFilter"/> establishes
/// for the read side (correction C2). That is the security property: when the
/// gate is closed, nothing behind it runs and nothing about the request is
/// reflected back. The gate deliberately does not use <c>[Consumes]</c> or an
/// MVC action constraint for its JSON requirement: those run at selection time
/// and would answer a 415 before the environmental conditions were examined,
/// which would tell an unauthenticated caller that the route exists and what
/// it accepts before establishing that the caller is local at all.
/// </para>
///
/// <para>
/// The environmental conditions are the read gate's, plus one: no request may
/// carry a <c>Forwarded</c> or <c>X-Forwarded-*</c> header. Those headers are
/// written by the caller, so they are never <em>evidence</em> of anything — but
/// their presence is a reliable signal that the request was relayed rather
/// than made directly, and a write boundary with no authentication should
/// refuse a relayed request rather than reason about it. This is a refusal,
/// never a trust decision: no forwarded header is read, parsed or believed,
/// and no forwarded-header middleware is enabled. It is also not a proxy
/// detector — a local proxy that strips every trace of itself is
/// indistinguishable from a direct client at this layer, which is precisely
/// why "do not put a proxy in front of the local API" remains a condition of
/// running it, not something code can enforce.
/// </para>
///
/// <para>
/// Checks run in a fixed order, and the order is the contract:
/// </para>
/// <list type="number">
///   <item><description>HTTPS transport and a Development host — else 404.</description></item>
///   <item><description>Both connection endpoints loopback — else 404.</description></item>
///   <item><description>No <c>Forwarded</c>/<c>X-Forwarded-*</c> header — else 404.</description></item>
///   <item><description>The startup-frozen <see cref="AdminCalendarOptions.EnableUnauthenticatedWrite"/> — else 404.</description></item>
///   <item><description>Exactly one <c>Origin</c>, exactly matching a configured Admin origin — else 403.</description></item>
///   <item><description><c>Content-Type: application/json</c>, optionally <c>charset=utf-8</c> — else 415.</description></item>
/// </list>
/// <para>
/// Every environmental and opt-in failure answers the one same 404, in the read
/// gate's shape, so no closed request can be told apart from any other closed
/// request: a caller learns nothing about which condition it failed, and
/// nothing about what the route would have accepted. Only once the boundary is
/// established as present and local does it answer with a diagnosable 403/415,
/// and those bodies describe the rule, never the configuration. The 403 is an
/// explicit result rather than <c>Forbid()</c>, which would invoke the
/// Customer cookie scheme's access-denied handler and answer an Admin request
/// with a Customer authentication response.
/// </para>
///
/// <para>
/// Correction C1, finding 2: this uniformity is deliberately <em>not</em> a
/// claim that a closed route is indistinguishable from an absent one. When a
/// future action carries <c>[EnableCors("admin-calendar-write")]</c>, the CORS
/// middleware wraps MVC and stamps <c>Access-Control-Allow-Origin</c> on the
/// response of an approved <c>Origin</c> even when this filter closed it,
/// while an absent route has no endpoint CORS metadata and gets no such
/// header. Route existence is therefore observable to an origin that is
/// already explicitly configured as an Admin origin, and it is not treated as
/// an authorization boundary: that origin knows the API contract anyway. What
/// is guaranteed is what matters — a closed gate reaches no action, no store
/// and no database, and a disallowed origin is granted nothing by CORS.
/// </para>
///
/// <para>
/// Correction C1, finding 1: the write opt-in reaches this filter as a
/// <see cref="bool"/> captured from configuration once at startup, never as
/// <see cref="Microsoft.Extensions.Options.IOptions{TOptions}"/> read per
/// request. <c>IOptions&lt;T&gt;</c> materializes lazily, on first access, so a
/// Development host that started with the opt-in <em>off</em> could have it
/// bound to <c>true</c> by a reloadable configuration source before the first
/// Admin request and open this boundary — environment-first ordering makes that
/// unreachable outside Development, but Development is exactly where this gate
/// operates. A value frozen at startup cannot be changed by anything but a
/// restart, which is what the README already tells a local operator.
/// </para>
///
/// <para>
/// The <c>Origin</c> check is performed here, at the server, and is not left
/// to CORS: CORS restricts browsers only, never <c>curl</c> or a
/// server-to-server client. The allowlist is the startup-validated
/// <c>Cors:AdminOrigins</c> snapshot (<c>Program.cs</c> rejects a non-HTTPS or
/// wildcard entry before the host starts), captured at startup for the same
/// reason as the opt-in above, so a later configuration change cannot widen it
/// past that validation.
/// </para>
///
/// <para>
/// PMS-ADMIN-AUTH-001-CP03: the Origin and content-type predicates live in
/// <see cref="AdminRequestBoundary"/>, shared with the Staff session boundary;
/// their rules, this filter's order and its responses are unchanged.
/// </para>
/// </summary>
public sealed class AdminCalendarWriteGateFilter(
    IHostEnvironment hostEnvironment,
    bool enableUnauthenticatedWrite,
    string[] allowedAdminOrigins) : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        // Unconditional and first, exactly as on the read side: it must also
        // cover a response written after the gate opens — a model-binding or
        // automatic-validation failure short-circuits before any action body
        // could set it.
        context.HttpContext.Response.Headers.CacheControl = "no-store";

        var request = context.HttpContext.Request;
        var connection = context.HttpContext.Connection;

        // `||` short-circuits, and the order is the contract: cleartext is
        // refused without consulting anything else, outside Development nothing
        // further is examined, and a relayed request is refused before the
        // opt-in is considered at all.
        if (!request.IsHttps ||
            !hostEnvironment.IsDevelopment() ||
            !IsLoopback(connection.LocalIpAddress) ||
            !IsLoopback(connection.RemoteIpAddress) ||
            HasForwardedHeader(request.Headers) ||
            !enableUnauthenticatedWrite)
        {
            context.Result = new NotFoundResult();
            return;
        }

        if (!AdminRequestBoundary.IsAllowedOrigin(request.Headers.Origin, allowedAdminOrigins))
        {
            context.Result = Problem(
                StatusCodes.Status403Forbidden,
                "Origin not allowed",
                "The request must carry exactly one Origin header naming an approved Admin origin.");
            return;
        }

        if (!AdminRequestBoundary.IsJsonContentType(request.ContentType))
        {
            context.Result = Problem(
                StatusCodes.Status415UnsupportedMediaType,
                "Unsupported media type",
                $"The request body must be sent as {AdminRequestBoundary.JsonMediaType} encoded as {AdminRequestBoundary.SupportedCharset}.");
        }
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
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

    /// <summary>
    /// Header names are case-insensitive per RFC 9110, and
    /// <see cref="IHeaderDictionary"/> keys compare that way, so both the
    /// exact <c>Forwarded</c> name and the <c>X-Forwarded-</c> family are
    /// matched ignoring case. No value is read: presence alone is the refusal.
    /// </summary>
    private static bool HasForwardedHeader(IHeaderDictionary headers)
    {
        foreach (var name in headers.Keys)
        {
            if (name.Equals("Forwarded", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static ObjectResult Problem(int statusCode, string title, string detail) =>
        new(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Detail = detail
        })
        {
            StatusCode = statusCode,
            ContentTypes = { "application/problem+json" }
        };
}
