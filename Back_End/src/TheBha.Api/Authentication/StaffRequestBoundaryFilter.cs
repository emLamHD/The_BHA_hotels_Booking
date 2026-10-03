using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP03 (D4): the CSRF boundary of every Staff session route. Staff use
/// no antiforgery token: the cookie is <c>SameSite=Strict</c>, and every Staff request other
/// than a read must carry exactly one approved Admin <c>Origin</c> (else 403) and a JSON body
/// type (else 415), checked at the server with the rules the local Calendar write gate uses
/// (<see cref="AdminRequestBoundary"/>). CORS only tells a browser what it may attempt; this
/// filter decides, for <c>curl</c> and server-to-server callers too.
///
/// <para>
/// A resource filter, so it runs before model binding: a malformed body never gets past a
/// bad <c>Origin</c>. No <c>[Consumes]</c>, which would answer at action selection, ahead of
/// this filter. Cleartext is refused (404, as the local gate does) as defence in depth behind
/// the HTTPS guard in <c>Program.cs</c>. A route that requires a Staff session is
/// authenticated by the authorization middleware first, so without a session it answers 401
/// before this filter runs. Every response, the refusals included, is <c>no-store</c>.
/// </para>
///
/// <para>
/// The allowlist is the startup-validated <c>Cors:AdminOrigins</c> snapshot, captured once
/// like the local gate's, so a later configuration change cannot widen it. An empty list
/// refuses every Staff write: the boundary fails closed.
/// </para>
/// </summary>
public sealed class StaffRequestBoundaryFilter(string[] allowedAdminOrigins) : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        context.HttpContext.Response.Headers.CacheControl = "no-store";
        var request = context.HttpContext.Request;

        if (!request.IsHttps)
        {
            context.Result = new NotFoundResult();
            return;
        }

        if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method))
        {
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

    private static ObjectResult Problem(int statusCode, string title, string detail) =>
        new(new ProblemDetails { Status = statusCode, Title = title, Detail = detail })
        {
            StatusCode = statusCode,
            ContentTypes = { "application/problem+json" }
        };
}
