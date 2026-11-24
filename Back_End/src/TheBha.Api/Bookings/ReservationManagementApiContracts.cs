using System.Text.Json.Serialization;

namespace TheBha.Api.Bookings;

/// <summary>BHA-CHECKOUT-001-PR06: the body of <c>POST /api/v1/reservations/{id}/manage/exchange</c>. The secret travels in the body (the guest page reads it from the URL fragment), never in the URL.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ExchangeReservationManagementLinkApiRequest(string? Token);

/// <summary>What an exchange answers: which reservation the new session manages and until when. The session secret is only ever in the cookie.</summary>
public sealed record ReservationManagementSessionApiResponse(Guid ReservationId, DateTimeOffset ExpiresAtUtc);

/// <summary>The estimated arrival, as the Property's wall clock: <c>arrivalDate</c> <c>yyyy-MM-dd</c> and <c>arrivalTime</c> <c>HH:mm</c>, no offset.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UpdateEstimatedArrivalApiRequest(string? ArrivalDate, string? ArrivalTime);

/// <summary>BHA-CHECKOUT-001-PR06: the limit on the exchange route, per client address. Bound from <c>Booking:ReservationManagement:RateLimiting</c>.</summary>
public sealed class ReservationManagementRateLimitOptions
{
    public const string SectionName = "Booking:ReservationManagement:RateLimiting";
    public const string PolicyName = "reservation-manage-exchange";
    public int PermitLimit { get; init; } = 10;
    public int WindowSeconds { get; init; } = 60;
}

/// <summary>The guest management session cookie: host-only (no Domain), HttpOnly, always Secure, the same SameSite as the other session cookies, and scoped to one reservation's management path.</summary>
public sealed class ReservationManagementCookie(Microsoft.AspNetCore.Http.SameSiteMode sameSite)
{
    public const string Name = ".TheBha.ReservationManagement";
    public Microsoft.AspNetCore.Http.SameSiteMode SameSite { get; } = sameSite;

    /// <summary>The lower-case GUID: cookie paths are case-sensitive, so a client must request this exact spelling for the browser to send the cookie.</summary>
    public static string PathFor(Guid reservationId) => $"/api/v1/reservations/{reservationId:D}/manage";
}

public static class ReservationManagementRoutes
{
    /// <summary>True for <c>/api/v1/reservations/{guid}/manage</c> and everything under it.</summary>
    public static bool IsManagePath(PathString path)
    {
        var segments = (path.Value ?? string.Empty).Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length >= 5 &&
               segments[0].Equals("api", StringComparison.OrdinalIgnoreCase) &&
               segments[1].Equals("v1", StringComparison.OrdinalIgnoreCase) &&
               segments[2].Equals("reservations", StringComparison.OrdinalIgnoreCase) &&
               Guid.TryParse(segments[3], out _) &&
               segments[4].Equals("manage", StringComparison.OrdinalIgnoreCase);
    }
}
