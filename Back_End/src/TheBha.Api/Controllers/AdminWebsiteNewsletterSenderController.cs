using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

public sealed record SaveNewsletterSenderProfileRequest([property: JsonRequired] int ExpectedVersion, string? SenderName, string? ReplyTo);

/// <summary><c>ClientSecret</c> is write-only: leave it out to keep the stored one (only with the same Client ID).</summary>
public sealed record ConnectNewsletterSenderRequest(string? ClientId, string? ClientSecret, bool SwitchAccount);

public sealed record NewsletterConnectStartDto(string AuthorizationUrl);

/// <summary>The Admin callback page forwards what Google returned. The code travels in this body, not in an API query string.</summary>
public sealed record CompleteNewsletterConnectRequest(string? State, string? Code, string? Error);

/// <summary>
/// BHA-NEWSLETTER-002: the Gmail account the site sends newsletter mail from. Metadata only on read (never the client secret or a token).
/// It sits behind the site-wide <c>WebsiteSettingsManage</c> permission, like the subscriber list: no new permission, no change to the Staff schema.
/// </summary>
[Route("api/admin/v1/website/newsletter-sender")]
public sealed class AdminWebsiteNewsletterSenderController(INewsletterSender sender) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<NewsletterSenderDto>> Get(CancellationToken cancellationToken) => Ok(await sender.GetAsync(cancellationToken));

    [HttpPost("profile")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<NewsletterSenderDto>> SaveProfile([FromBody] SaveNewsletterSenderProfileRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.SaveProfileAsync(request.SenderName, request.ReplyTo, request.ExpectedVersion, cancellationToken);
        if (result.Succeeded) return Ok(result.Value);
        var status = result.Code == "newsletter-sender-version-conflict" ? StatusCodes.Status409Conflict : StatusCodes.Status400BadRequest;
        return Fail(status, "Sender profile not saved", result.Code, result.Code switch
        {
            "newsletter-sender-name-invalid" => "senderName",
            "newsletter-sender-reply-to-invalid" => "replyTo",
            _ => null
        }, null);
    }

    [HttpPost("connect")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<NewsletterConnectStartDto>> Connect([FromBody] ConnectNewsletterSenderRequest request, CancellationToken cancellationToken)
    {
        var start = await sender.BeginConnectAsync(ActorStaffId, request.ClientId, request.ClientSecret, request.SwitchAccount, cancellationToken);
        return start.AuthorizationUrl is { } url ? Ok(new NewsletterConnectStartDto(url)) : Fail(StatusCodes.Status400BadRequest, "Connection not started", start.Code, start.Field, null);
    }

    [HttpPost("connect/complete")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<NewsletterSenderDto>> CompleteConnect([FromBody] CompleteNewsletterConnectRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.CompleteConnectAsync(ActorStaffId, request.State, request.Code, request.Error, cancellationToken);
        return result.Connected ? Ok(result.Value) : Fail(StatusCodes.Status400BadRequest, "Gmail not connected", result.Code, null, null);
    }

    [HttpPost("disconnect")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<NewsletterSenderDto>> Disconnect(CancellationToken cancellationToken) => Ok(await sender.DisconnectAsync(cancellationToken));
}
