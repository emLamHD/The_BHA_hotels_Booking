using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>The watermark is a JSON STRING (a number would pass through a JavaScript double); it is handed back exactly as a list answered it.</summary>
public sealed record MarkMenuSeenRequest
{
    [JsonRequired] public string ViewWatermark { get; init; } = string.Empty;
}

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: what the signed-in Staff member has not seen of a menu, and the way to say they have. The Staff id is the authenticated one (nothing in the request names
/// another), the permission is the site-wide website permission, and nothing is cached. <c>GET</c> never changes the "seen" state; only a <c>POST</c> with a watermark a list answered with does.
/// </summary>
[Route("api/admin/v1/website/menu-unseen")]
public sealed partial class AdminWebsiteMenuUnseenController(IMenuUnseen unseen) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult<MenuUnseenDto>> Get(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await unseen.GetAsync(ActorStaffId, cancellationToken));
    }

    /// <summary>
    /// 200 with the counts after the cursor moved. 400 <c>menu-unseen-watermark-invalid</c> for anything that is not a plain non-negative integer string, or one above the newest committed
    /// verification (it is refused, never turned into "everything so far"). 404 <c>menu-unseen-unknown-menu</c> for a menu with no badge. Repeating the same call is harmless.
    /// </summary>
    [HttpPost("{menuKey}/seen")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Seen(string menuKey, [FromBody] MarkMenuSeenRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!MenuUnseenKeys.IsKnown(menuKey))
        {
            return Fail(StatusCodes.Status404NotFound, "Unknown menu", "menu-unseen-unknown-menu", null, "That menu has no unseen counter.");
        }

        if (!PlainInteger().IsMatch(request.ViewWatermark) || !long.TryParse(request.ViewWatermark, NumberStyles.None, CultureInfo.InvariantCulture, out var watermark))
        {
            return Fail(StatusCodes.Status400BadRequest, "Invalid watermark", "menu-unseen-watermark-invalid", "viewWatermark", "viewWatermark must be the decimal string a list answered with.");
        }

        var result = await unseen.MarkSeenAsync(ActorStaffId, menuKey, watermark, cancellationToken);
        return result.Status switch
        {
            MenuSeenStatus.Succeeded => Ok(result.Value),
            MenuSeenStatus.UnknownMenu => Fail(StatusCodes.Status404NotFound, "Unknown menu", "menu-unseen-unknown-menu", null, "That menu has no unseen counter."),
            _ => Fail(StatusCodes.Status400BadRequest, "Invalid watermark", "menu-unseen-watermark-invalid", "viewWatermark", "viewWatermark is above the newest verification the server has recorded."),
        };
    }

    // "0" or digits without a leading zero: no sign, no space, no exponent, no fraction.
    [GeneratedRegex("^(0|[1-9][0-9]*)$")]
    private static partial Regex PlainInteger();
}
