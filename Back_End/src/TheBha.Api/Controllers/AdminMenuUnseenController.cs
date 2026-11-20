using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Activity;

namespace TheBha.Api.Controllers;

/// <summary>The watermark is a JSON STRING (a number would pass through a JavaScript double); it is handed back exactly as a list answered it. <c>PropertyId</c> only for a Property-scoped menu.</summary>
public sealed record MarkAdminMenuSeenRequest
{
    [JsonRequired] public string ViewWatermark { get; init; } = string.Empty;
    public string? PropertyId { get; init; }
}

/// <summary>
/// BHA-ADMIN-BADGE-001-PR03 (ADR 0011 §B): the shared per-Staff unseen routes and the activity history. Every action is <see cref="StaffSessionAttribute"/> (HTTPS, Staff session, request
/// boundary, no-store, closed in LocalGate); the permission of each menu and Property is read from the database by the service on every request. A menu that is unknown or that the Staff
/// member may not read, and a Property outside their memberships, answer the same 404. Reads never write; only <c>seen</c> moves a cursor, and only to the watermark the client sent.
/// </summary>
[Route("api/admin/v1")]
public sealed class AdminMenuUnseenController(IAdminMenuUnseen unseen) : AdminWebsiteControllerBase
{
    [HttpGet("menu-unseen")]
    [StaffSession]
    public async Task<ActionResult<MenuUnseenSummary>> Summary(CancellationToken cancellationToken) =>
        Ok(await unseen.GetSummaryAsync(ActorStaffId, cancellationToken));

    [HttpGet("menu-unseen/{menu}/changes")]
    [StaffSession]
    public async Task<ActionResult> Changes(string menu, [FromQuery] string? propertyId, CancellationToken cancellationToken) =>
        Respond(await unseen.GetChangesAsync(ActorStaffId, menu, propertyId, cancellationToken));

    [HttpPost("menu-unseen/{menu}/seen")]
    [StaffSession]
    public async Task<ActionResult> Seen(string menu, [FromBody] MarkAdminMenuSeenRequest request, CancellationToken cancellationToken) =>
        Respond(await unseen.MarkSeenAsync(ActorStaffId, menu, request.PropertyId, request.ViewWatermark, cancellationToken));

    [HttpGet("activity")]
    [StaffSession]
    public async Task<ActionResult> Activity(
        [FromQuery] string? menu, [FromQuery] string? propertyId, [FromQuery] string? actorStaffId, [FromQuery] string? from, [FromQuery] string? to,
        [FromQuery] string? limit, [FromQuery] string? cursor, CancellationToken cancellationToken) =>
        Respond(await unseen.GetActivityAsync(ActorStaffId, new ActivityQuery(menu, propertyId, actorStaffId, from, to, limit, cursor), cancellationToken));

    private ActionResult Respond<T>(AdminMenuResult<T> result)
    {
        Response.Headers.CacheControl = "no-store";
        return result.Status switch
        {
            AdminMenuStatus.Succeeded => Ok(result.Value),
            AdminMenuStatus.UnknownMenu => Fail(StatusCodes.Status404NotFound, "Unknown menu", "menu-unseen-unknown-menu", null, "That menu has no unseen counter."),
            AdminMenuStatus.InvalidWatermark => Fail(StatusCodes.Status400BadRequest, "Invalid watermark", "menu-unseen-watermark-invalid", "viewWatermark", "viewWatermark must be the decimal string a list answered with, and not above the newest number the server has recorded."),
            AdminMenuStatus.InvalidProperty => Fail(StatusCodes.Status400BadRequest, "Invalid property", "menu-unseen-property-invalid", "propertyId", "propertyId is required for a Property-scoped menu, refused for a global one, and must be a Property id."),
            AdminMenuStatus.UseEntitySeen => Fail(StatusCodes.Status400BadRequest, "Acknowledge the object", "menu-unseen-use-entity-seen", null, "The Calendar is acknowledged per object, not by opening the page."),
            _ => Fail(StatusCodes.Status400BadRequest, "Invalid activity query", "activity-query-invalid", result.Field, "menu is required; limit is 1-100; from and to are instants (from inclusive, to exclusive); cursor is one this same query returned.")
        };
    }
}
