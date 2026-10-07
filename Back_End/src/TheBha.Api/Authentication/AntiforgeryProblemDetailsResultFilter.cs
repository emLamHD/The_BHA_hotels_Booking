using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Core.Infrastructure;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TheBha.Api.Authentication;

/// <summary>
/// The global <c>AutoValidateAntiforgeryTokenAttribute</c> authorization filter
/// short-circuits a rejected request with <c>AntiforgeryValidationFailedResult</c>
/// before any ordinary result filter would run. This filter implements
/// <see cref="IAlwaysRunResultFilter"/> specifically so it still observes that
/// short-circuited result, and replaces it with a stable, generic RFC 7807
/// Problem Details body. It matches the framework's own
/// <see cref="IAntiforgeryValidationFailedResult"/> marker interface, not a
/// status code or response body, so every other result — including ordinary
/// application/model-validation 400s — passes through unchanged.
///
/// <para>
/// <see cref="Order"/> must run before the built-in, always-run
/// <c>ClientErrorResultFilter</c> (registered by <c>[ApiController]</c> at
/// Order -2000), which otherwise rewrites the same
/// <see cref="IAntiforgeryValidationFailedResult"/> into a generic, untitled
/// Problem Details body first.
/// </para>
/// </summary>
public sealed class AntiforgeryProblemDetailsResultFilter : IAlwaysRunResultFilter, IOrderedFilter
{
    public int Order => int.MinValue;

    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not IAntiforgeryValidationFailedResult)
        {
            return;
        }

        context.Result = new ObjectResult(new ProblemDetails
        {
            Title = "Invalid antiforgery token",
            Status = StatusCodes.Status400BadRequest,
            Detail = "A valid antiforgery token is required for this operation."
        })
        {
            StatusCode = StatusCodes.Status400BadRequest,
            ContentTypes = { "application/problem+json" }
        };
    }

    public void OnResultExecuted(ResultExecutedContext context)
    {
    }
}
