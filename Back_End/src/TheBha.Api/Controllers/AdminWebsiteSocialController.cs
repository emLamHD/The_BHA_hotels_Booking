using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

[Route("api/admin/v1/website/social-media")]
public sealed class AdminWebsiteSocialController(IWebsiteSocialSettings settings) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<WebsiteSocialAdminDto>> Get(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await settings.GetAdminAsync(cancellationToken));
    }

    [HttpPost("save")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Save([FromBody] SaveWebsiteSocialRequest request, CancellationToken cancellationToken) =>
        Respond(await settings.SaveAsync(new(request.ExpectedRevision, request.PhoneEnabled, request.PhoneNumber,
            request.MessengerEnabled, request.MessengerUrl, request.ZaloEnabled, request.ZaloNumber,
            request.BackToTopEnabled, ActorStaffId), cancellationToken), value => Ok(value));
}
