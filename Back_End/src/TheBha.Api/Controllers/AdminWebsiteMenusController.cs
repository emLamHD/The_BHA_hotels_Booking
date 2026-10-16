using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP04: the header navigation of the website, site-wide. <c>GET</c> reads the tree with every
/// language's label and a revision; <c>save</c> applies the whole tree, links and labels in one transaction or nothing. Same
/// access rules as the other website routes: Staff session, global <c>WebsiteSettingsManage</c> (401 / 403), then Origin and
/// JSON for the write. A stale <c>expectedRevision</c> is a 409 (<c>stale-version</c>); a bad link, label or tree is a 400 with
/// the offending <c>field</c> (<c>items[3].href</c>) and a <c>menu-*</c> code.
/// </summary>
[Route("api/admin/v1/website/menus")]
public sealed class AdminWebsiteMenusController(IWebsiteMenus menus) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(MenuAdminDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<MenuAdminDto>> Get(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await menus.GetAdminAsync(cancellationToken));
    }

    [HttpPost("save")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(MenuAdminDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Save([FromBody] SaveWebsiteMenuRequest request, CancellationToken cancellationToken) =>
        Respond(
            await menus.SaveAsync(
                new SaveMenuCommand(
                    request.ExpectedRevision,
                    [.. request.Items.Select(item => new MenuItemInput(item.Id, item.ParentId, item.Placement, item.IsEnabled, item.Href, item.OpenInNewTab, item.Labels))],
                    ActorStaffId),
                cancellationToken),
            menu => Ok(menu));
}
