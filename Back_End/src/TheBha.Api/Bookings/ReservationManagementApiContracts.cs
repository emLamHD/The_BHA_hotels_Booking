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

    /// <summary>
    /// The cookie path: the request's own path up to and including the <c>manage</c> segment, exactly as the client wrote it. Browsers match cookie paths case-sensitively, so a path re-formatted by the server
    /// (the route accepts an upper-case or 32-digit id) would not be sent back on the very URL the guest used. Sliced from the original text, never split and re-joined.
    /// </summary>
    public static string PathFor(PathString requestPath)
    {
        var text = requestPath.Value ?? string.Empty;
        var end = 0;
        for (var segment = 0; segment < 5; segment++)
        {
            var slash = text.IndexOf('/', end + 1);
            end = slash < 0 ? text.Length : slash;
        }

        return text[..end];
    }
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
