using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// BHA-NEWSLETTER-001: the Staff list of newsletter requests. Read only in V1 (no edit, delete or export). It holds visitors'
/// e-mail addresses, so it sits behind the site-wide website permission and is never cached.
/// </summary>
[Route("api/admin/v1/website/newsletter-subscriptions")]
public sealed class AdminWebsiteNewsletterController(INewsletterSubscriptions subscriptions) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<NewsletterSubscriptionPageDto>> List(
        [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = NewsletterRules.DefaultPageSize, CancellationToken cancellationToken = default)
    {
        Response.Headers.CacheControl = "no-store";
        if (page < 1 || pageSize < 1 || pageSize > NewsletterRules.MaxPageSize || (search?.Length ?? 0) > NewsletterRules.MaxSearchLength)
        {
            return Fail(StatusCodes.Status400BadRequest, "Invalid list request", "newsletter-list-invalid", null,
                $"page must be at least 1, pageSize 1-{NewsletterRules.MaxPageSize} and search at most {NewsletterRules.MaxSearchLength} characters.");
        }

        return Ok(await subscriptions.ListAsync(search, page, pageSize, cancellationToken));
    }
}
