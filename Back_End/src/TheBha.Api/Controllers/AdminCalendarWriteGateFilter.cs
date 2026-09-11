using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace TheBha.Api.Controllers;

/// <summary>
/// PMS-CAL-001.2-CP01: the local Admin Calendar <em>write</em> boundary.
///
/// <para>
/// This is the foundation a later checkpoint's assignment/move/block endpoints
/// will opt into; CP01 deliberately exposes no business mutation endpoint, so
/// nothing in <c>TheBha.Api</c> applies this filter yet. It is a resource
/// filter, not middleware and not a policy framework: it is registered in DI,
/// never added globally, and never attached to the read board or any Customer
/// route.
/// </para>
///
/// <para>
/// A resource filter is the right stage because it runs <em>before</em> model
/// binding and <c>[ApiController]</c>'s automatic validation. A closed gate
/// therefore answers a valid body and a malformed one identically, and no
/// action, mutation store or database call is reached in either case — the
/// same property <see cref="AdminReservationBoardReadGateFilter"/> establishes
/// for the read side (correction C2). The gate deliberately does not use
/// <c>[Consumes]</c> or an MVC action constraint for its JSON requirement:
/// those run at selection time and would leak a 415 before the environmental
/// conditions were ever examined, making a closed deployment distinguishable
/// from an absent route.
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
///   <item><description><see cref="AdminCalendarOptions.EnableUnauthenticatedWrite"/> — else 404.</description></item>
///   <item><description>Exactly one <c>Origin</c>, exactly matching a configured Admin origin — else 403.</description></item>
///   <item><description><c>Content-Type: application/json</c> — else 415.</description></item>
/// </list>
/// <para>
/// Everything that describes <em>whether this boundary exists at all</em>
/// answers 404, in the read gate's shape, so a closed deployment is
/// indistinguishable from an absent route. Only once the boundary is
/// established as present and local does it answer with a diagnosable 403/415,
/// and those bodies describe the rule, never the configuration. The 403 is an
/// explicit result rather than <c>Forbid()</c>, which would invoke the
/// Customer cookie scheme's access-denied handler and answer an Admin request
/// with a Customer authentication response.
/// </para>
///
/// <para>
/// The <c>Origin</c> check is performed here, at the server, and is not left
/// to CORS: CORS restricts browsers only, never <c>curl</c> or a
/// server-to-server client. The allowlist is the startup-validated
/// <c>Cors:AdminOrigins</c> snapshot (<c>Program.cs</c> rejects a non-HTTPS or
/// wildcard entry before the host starts), so a later configuration reload
/// cannot widen it past that validation.
/// </para>
/// </summary>
public sealed class AdminCalendarWriteGateFilter(
    IHostEnvironment hostEnvironment,
    IOptions<AdminCalendarOptions> adminCalendarOptions,
    string[] allowedAdminOrigins) : IResourceFilter
{
    private const string JsonMediaType = "application/json";

    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        // Unconditional and first, exactly as on the read side: it must also
        // cover a response written after the gate opens — a model-binding or
        // automatic-validation failure short-circuits before any action body
        // could set it.
        context.HttpContext.Response.Headers.CacheControl = "no-store";

        var request = context.HttpContext.Request;
        var connection = context.HttpContext.Connection;

        // `||` short-circuits, so the order is deliberate: cleartext is refused
        // without consulting anything else, outside Development nothing further
        // is examined, and a non-local or relayed request is refused before the
        // reloadable option is ever materialized — so nothing it could later
        // bind matters.
        if (!request.IsHttps ||
            !hostEnvironment.IsDevelopment() ||
            !IsLoopback(connection.LocalIpAddress) ||
            !IsLoopback(connection.RemoteIpAddress) ||
            HasForwardedHeader(request.Headers) ||
            !adminCalendarOptions.Value.EnableUnauthenticatedWrite)
        {
            context.Result = new NotFoundResult();
            return;
        }

        if (!IsAllowedAdminOrigin(request.Headers.Origin))
        {
            context.Result = Problem(
                StatusCodes.Status403Forbidden,
                "Origin not allowed",
                "The request must carry exactly one Origin header naming an approved Admin origin.");
            return;
        }

        if (!IsJsonContentType(request.ContentType))
        {
            context.Result = Problem(
                StatusCodes.Status415UnsupportedMediaType,
                "Unsupported media type",
                $"The request body must be sent as {JsonMediaType}.");
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

    /// <summary>
    /// Requires exactly one <c>Origin</c> header value that is ordinal-equal to
    /// a configured Admin origin. Exact equality is what defeats a
    /// prefix/suffix lookalike (<c>https://localhost:3001.evil.example</c>,
    /// <c>https://evil.example/?https://localhost:3001</c>); a missing, empty,
    /// literal <c>null</c> or multi-valued header never matches one. The
    /// allowed entries are re-checked for an HTTPS scheme here so this filter
    /// states its own rule rather than depending on a validation that lives in
    /// another file.
    /// </summary>
    private bool IsAllowedAdminOrigin(StringValues origin)
    {
        if (origin.Count != 1)
        {
            return false;
        }

        var value = origin[0];
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        foreach (var allowed in allowedAdminOrigins)
        {
            if (allowed.StartsWith("https://", StringComparison.Ordinal) &&
                string.Equals(allowed, value, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Accepts <c>application/json</c> with an optional, recognized
    /// <c>charset</c> parameter and nothing else — a missing or unparsable
    /// header, a different media type, a <c>+json</c> suffix type, an unknown
    /// charset, or any other parameter is rejected. Checked here rather than
    /// with <c>[Consumes]</c> so it can never run before the environmental
    /// conditions above.
    /// </summary>
    private static bool IsJsonContentType(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out var mediaType) ||
            !mediaType.MediaType.Equals(JsonMediaType, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        foreach (var parameter in mediaType.Parameters)
        {
            if (!parameter.Name.Equals("charset", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var charset = HeaderUtilities.RemoveQuotes(parameter.Value).ToString();
            if (charset.Length == 0)
            {
                return false;
            }

            try
            {
                _ = Encoding.GetEncoding(charset);
            }
            catch (ArgumentException)
            {
                return false;
            }
        }

        return true;
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
