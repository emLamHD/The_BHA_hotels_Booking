using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Notifications;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// BHA-CHECKOUT-001-PR04: who receives the booking notifications of one Property. Every action carries <see cref="StaffCalendarPermissionAttribute"/> with
/// <see cref="StaffPermission.BookingNotificationManage"/>: an active Staff session that is a Manager of the route's Property, checked on the server on every request (the route does not exist in LocalGate mode).
/// The actor comes from that check, never from the request. The routes change a preference only: they create no Staff, no login, no membership and send no e-mail. The resolver that reads these settings
/// (<see cref="IBookingNotificationRecipients"/>) is internal and has no route.
/// </summary>
[ApiController]
[IgnoreAntiforgeryToken]
[Route("api/admin/v1/properties/{propertyId:guid}/booking-notification-recipients")]
public sealed class AdminBookingNotificationRecipientsController(IAdminBookingNotifications notifications) : ControllerBase
{
    [HttpGet]
    [StaffCalendarPermission(StaffPermission.BookingNotificationManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> Read(Guid propertyId, CancellationToken cancellationToken)
    {
        var roster = await notifications.ReadAsync(propertyId, cancellationToken);
        return roster is null ? Fail(404, "Property not found", null, null, "The property does not exist.") : Ok(roster);
    }

    /// <summary>Saves the notification address of one Staff member, or clears it when <c>email</c> is null or blank.</summary>
    [HttpPost("staff/{staffAccountId:guid}/email")]
    [StaffCalendarPermission(StaffPermission.BookingNotificationManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> SetEmail(Guid propertyId, Guid staffAccountId, [FromBody] SetBookingNotificationEmailRequest request, CancellationToken cancellationToken) =>
        Respond(await notifications.SetStaffEmailAsync(propertyId, staffAccountId, request.ExpectedVersion, request.Email, Actor(propertyId), cancellationToken));

    /// <summary>Switches one Staff member's notifications on or off at this Property. Off is an explicit opt-out that also blocks a chain address.</summary>
    [HttpPost("staff/{staffAccountId:guid}/enabled")]
    [StaffCalendarPermission(StaffPermission.BookingNotificationManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> SetEnabled(Guid propertyId, Guid staffAccountId, [FromBody] SetBookingNotificationEnabledRequest request, CancellationToken cancellationToken) =>
        Respond(await notifications.SetStaffEnabledAsync(propertyId, staffAccountId, request.ExpectedVersion, request.Enabled, Actor(propertyId), cancellationToken));

    [HttpPost("fallback")]
    [StaffCalendarPermission(StaffPermission.BookingNotificationManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> SetFallback(Guid propertyId, [FromBody] SetBookingNotificationEmailRequest request, CancellationToken cancellationToken) =>
        Respond(await notifications.SetFallbackAsync(propertyId, request.ExpectedVersion, request.Email, Actor(propertyId), cancellationToken));

    private Guid Actor(Guid propertyId) =>
        StaffCalendarWriteContext.For(HttpContext, propertyId)?.StaffId
        ?? throw new InvalidOperationException("A booking-notification action ran without its Staff authorization filter.");

    private ActionResult Respond<T>(WebsiteMutationResult<T> result) =>
        result.Status switch
        {
            WebsiteMutationStatus.Succeeded => Ok(result.Value),
            WebsiteMutationStatus.Invalid => Fail(400, "Invalid booking notification request", result.Code, result.Field, result.Message),
            WebsiteMutationStatus.NotFound => Fail(404, "Staff member not found", result.Code, result.Field, result.Message),
            _ => Fail(409, "Booking notification conflict", result.Code, result.Field, result.Message)
        };

    private ObjectResult Fail(int status, string title, string? code, string? field, string? detail)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Detail = detail };
        if (code is not null) problem.Extensions["code"] = code;
        if (field is not null) problem.Extensions["field"] = field;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

// Request bodies. Unknown properties (an `actorStaffId`, a `role`, a `propertyId`) are ignored: the actor, the role and the Property come from the Staff session and the route.

public sealed record SetBookingNotificationEmailRequest
{
    /// <summary>The version the caller read (0 when there was no row yet).</summary>
    [JsonRequired] public int ExpectedVersion { get; init; }

    public string? Email { get; init; }
}

public sealed record SetBookingNotificationEnabledRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public bool Enabled { get; init; }
}
