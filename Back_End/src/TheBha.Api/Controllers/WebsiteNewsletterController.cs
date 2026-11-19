using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Api.Controllers;

public sealed record SubscribeNewsletterRequest(string? Email, string? Language);

/// <summary><c>Confirmation</c> is <c>email</c> when the site can send a confirmation mail and <c>none</c> when it cannot (Gmail not connected): a fact about the site, the same for every address.</summary>
public sealed record NewsletterReceivedDto(string Status, string Confirmation);

public sealed record ConfirmNewsletterRequest(string? Token);

public sealed record NewsletterConfirmedDto(string Status);

/// <summary>
/// BHA-NEWSLETTER-001: the home page's "get offers" form. Anonymous, uncredentialed (the <c>website-public</c> CORS policy),
/// rate limited per client address. A valid address is answered with the same <c>202</c> and the same body whether it was
/// new or already there, so the endpoint does not tell anyone which addresses are subscribed. V1 only records the request.
/// <see cref="IgnoreAntiforgeryTokenAttribute"/>: the application-wide antiforgery filter defends a Customer cookie, and this
/// request carries none (CORS here is uncredentialed), so there is no ambient authority for a forged request to borrow; the
/// request can only add an address, and the rate limit bounds how fast.
/// </summary>
[ApiController]
[IgnoreAntiforgeryToken]
[EnableCors("website-public")]
[EnableRateLimiting(NewsletterRateLimit.PolicyName)]
[Route("api/v1/website/newsletter-subscriptions")]
public sealed class WebsiteNewsletterController(INewsletterSubscriptions subscriptions) : ControllerBase
{
    [HttpPost]
    [ProducesResponseType(typeof(NewsletterReceivedDto), StatusCodes.Status202Accepted)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult> Subscribe([FromBody] SubscribeNewsletterRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!NewsletterRules.TryNormalizeEmail(request.Email, out var email))
        {
            var problem = new ProblemDetails { Status = StatusCodes.Status400BadRequest, Title = "Invalid email", Detail = "Enter a valid email address." };
            problem.Extensions["code"] = "newsletter-email-invalid";
            problem.Extensions["field"] = "email";
            return new ObjectResult(problem) { StatusCode = StatusCodes.Status400BadRequest, ContentTypes = { "application/problem+json" } };
        }

        var result = await subscriptions.SubscribeAsync(email, NewsletterSubscription.SourceHomepage, NewsletterRules.NormalizeLanguage(request.Language), cancellationToken);
        return Accepted(new NewsletterReceivedDto("received", result.EmailConfirmation ? "email" : "none"));
    }

    /// <summary>
    /// The visitor pressed "confirm" on the Customer page (the link only opens that page; the token is in its URL fragment, so it never
    /// reaches a server log). The token travels in this body, never in a query.
    /// </summary>
    [HttpPost("confirmations")]
    [ProducesResponseType(typeof(NewsletterConfirmedDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status410Gone)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult> Confirm([FromBody] ConfirmNewsletterRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var outcome = await subscriptions.ConfirmAsync(request.Token ?? string.Empty, cancellationToken);
        return outcome switch
        {
            NewsletterConfirmOutcome.Verified => Ok(new NewsletterConfirmedDto("verified")),
            NewsletterConfirmOutcome.AlreadyVerified => Ok(new NewsletterConfirmedDto("already-verified")),
            NewsletterConfirmOutcome.Expired => Problem(StatusCodes.Status410Gone, "Link expired", "newsletter-confirmation-expired"),
            _ => Problem(StatusCodes.Status400BadRequest, "Invalid link", "newsletter-confirmation-invalid")
        };
    }

    private static ObjectResult Problem(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

public sealed class NewsletterRateLimitOptions
{
    public const string SectionName = "Website:Newsletter:RateLimiting";
    public int PermitLimit { get; init; } = 5;
    public int WindowSeconds { get; init; } = 60;
}

public static class NewsletterRateLimit
{
    public const string PolicyName = "newsletter-subscribe";
    public const string PathPrefix = "/api/v1/website/newsletter-subscriptions";
}
