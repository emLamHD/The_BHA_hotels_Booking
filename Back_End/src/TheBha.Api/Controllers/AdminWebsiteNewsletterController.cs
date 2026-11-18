using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

public sealed record CreateNewsletterSubscriptionRequest(string? Email, string? Language);

/// <summary><c>Email</c> and <c>Language</c> are each left out to keep what is stored. A new <c>Email</c> returns the address to pending.</summary>
public sealed record UpdateNewsletterSubscriptionRequest([property: JsonRequired] int ExpectedVersion, string? Email, string? Language);

public sealed record NewsletterVersionRequest([property: JsonRequired] int ExpectedVersion);

public sealed record NewsletterInviteDto(string Status, int? RetryAfterSeconds, NewsletterSubscriptionDto Subscription);

/// <summary>
/// BHA-NEWSLETTER-001/003: the Staff list of newsletter requests and what Staff can do to them: add, edit, invite, unsubscribe, archive, restore, delete. It holds visitors'
/// e-mail addresses, so every route sits behind the site-wide website permission and nothing is cached. The Admin API is GET and POST only (its CORS policy), so a
/// change is a POST on the row; each one carries the version the screen holds and a stale one is a 409, never a silent overwrite.
/// </summary>
[Route("api/admin/v1/website/newsletter-subscriptions")]
public sealed class AdminWebsiteNewsletterController(INewsletterSubscriptions subscriptions, INewsletterSubscriptionAdmin admin) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<NewsletterSubscriptionPageDto>> List(
        [FromQuery] string? search, [FromQuery] string? status = null, [FromQuery] string scope = NewsletterListScope.Active,
        [FromQuery] int page = 1, [FromQuery] int pageSize = NewsletterRules.DefaultPageSize, CancellationToken cancellationToken = default)
    {
        Response.Headers.CacheControl = "no-store";
        var statusOk = string.IsNullOrEmpty(status) || status is TheBha.Domain.Website.NewsletterSubscription.StatusPendingVerification or TheBha.Domain.Website.NewsletterSubscription.StatusVerified
            or TheBha.Domain.Website.NewsletterSubscription.StatusUnsubscribed;
        if (page < 1 || pageSize < 1 || pageSize > NewsletterRules.MaxPageSize || (search?.Length ?? 0) > NewsletterRules.MaxSearchLength || !statusOk || !NewsletterListScope.IsKnown(scope))
        {
            return Fail(StatusCodes.Status400BadRequest, "Invalid list request", "newsletter-list-invalid", null,
                $"page must be at least 1, pageSize 1-{NewsletterRules.MaxPageSize}, search at most {NewsletterRules.MaxSearchLength} characters, status a known status and scope active, archived or all.");
        }

        return Ok(await subscriptions.ListAsync(search, string.IsNullOrEmpty(status) ? null : status, scope, page, pageSize, cancellationToken));
    }

    [HttpPost]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Create([FromBody] CreateNewsletterSubscriptionRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await admin.CreateAsync(ActorStaffId, request.Email, request.Language, cancellationToken);
        return result.Status == NewsletterAdminStatus.Succeeded ? StatusCode(StatusCodes.Status201Created, result.Value) : Refuse(result);
    }

    [HttpPost("{id:guid}/update")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Update(Guid id, [FromBody] UpdateNewsletterSubscriptionRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await admin.UpdateAsync(ActorStaffId, id, request.ExpectedVersion, request.Email, request.Language, cancellationToken);
        return result.Status == NewsletterAdminStatus.Succeeded ? Ok(result.Value) : Refuse(result);
    }

    /// <summary>
    /// The body carries <c>expectedVersion</c>, the version of the row the Staff member is looking at (required: a body without it is a 400, and nothing fills it in). 200 when the
    /// request was understood: <c>queued</c>, <c>cooldown</c> (with the seconds to wait) or <c>not-connected</c> (no sender; nothing queued). 409 <c>newsletter-version-conflict</c>
    /// when the row has changed since (its address included): nothing is queued, no cooldown is written and no "invited" audit row is made. 409 for a row that is not pending or is hidden.
    /// </summary>
    [HttpPost("{id:guid}/verification-invitations")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Invite(Guid id, [FromBody] NewsletterVersionRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await admin.InviteAsync(ActorStaffId, id, request.ExpectedVersion, cancellationToken);
        if (result.Status != NewsletterAdminStatus.Succeeded) return Refuse(result);
        var invite = result.Value!;
        var label = invite.Outcome switch
        {
            NewsletterInviteOutcome.Queued => "queued",
            NewsletterInviteOutcome.Cooldown => "cooldown",
            _ => "not-connected"
        };
        return Ok(new NewsletterInviteDto(label, invite.RetryAfterSeconds, invite.Subscription));
    }

    [HttpPost("{id:guid}/unsubscribe")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Unsubscribe(Guid id, [FromBody] NewsletterVersionRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await admin.UnsubscribeAsync(ActorStaffId, id, request.ExpectedVersion, cancellationToken);
        return result.Status == NewsletterAdminStatus.Succeeded ? Ok(result.Value) : Refuse(result);
    }

    [HttpPost("{id:guid}/archive")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Archive(Guid id, [FromBody] NewsletterVersionRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await admin.SetArchivedAsync(ActorStaffId, id, request.ExpectedVersion, archived: true, cancellationToken);
        return result.Status == NewsletterAdminStatus.Succeeded ? Ok(result.Value) : Refuse(result);
    }

    [HttpPost("{id:guid}/restore")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Restore(Guid id, [FromBody] NewsletterVersionRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await admin.SetArchivedAsync(ActorStaffId, id, request.ExpectedVersion, archived: false, cancellationToken);
        return result.Status == NewsletterAdminStatus.Succeeded ? Ok(result.Value) : Refuse(result);
    }

    /// <summary>Permanent. 204 when the row, its tokens and its waiting mails are gone.</summary>
    [HttpPost("{id:guid}/delete")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Delete(Guid id, [FromBody] NewsletterVersionRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await admin.DeleteAsync(ActorStaffId, id, request.ExpectedVersion, cancellationToken);
        return result.Status == NewsletterAdminStatus.Succeeded ? NoContent() : Refuse(result);
    }

    private ObjectResult Refuse<T>(NewsletterAdminResult<T> result)
    {
        var status = result.Status switch
        {
            NewsletterAdminStatus.Invalid => StatusCodes.Status400BadRequest,
            NewsletterAdminStatus.NotFound => StatusCodes.Status404NotFound,
            _ => StatusCodes.Status409Conflict
        };
        var problem = Fail(status, "Newsletter subscription not changed", result.Code, result.Field, null);
        if (result.ExistingId is { } existing && problem.Value is Microsoft.AspNetCore.Mvc.ProblemDetails details)
        {
            // Where the address already is, so the screen can take the Staff member to it (and say that it is hidden).
            details.Extensions["existingId"] = existing;
            details.Extensions["existingArchived"] = result.ExistingArchived;
        }

        return problem;
    }
}
