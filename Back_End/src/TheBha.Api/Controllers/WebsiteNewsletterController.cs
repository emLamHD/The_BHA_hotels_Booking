using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Api.Controllers;

public sealed record SubscribeNewsletterRequest(string? Email);

public sealed record NewsletterReceivedDto(string Status);

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

        await subscriptions.SubscribeAsync(email, NewsletterSubscription.SourceHomepage, cancellationToken);
        return Accepted(new NewsletterReceivedDto("received"));
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
