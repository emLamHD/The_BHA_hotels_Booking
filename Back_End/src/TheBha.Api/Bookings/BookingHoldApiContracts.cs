using System.Text.Json.Serialization;

namespace TheBha.Api.Bookings;

public sealed record CreateBookingHoldApiRequest(
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string? FullName,
    string? Email,
    string? Phone,
    decimal? ExpectedTotalAmount = null,
    string? ExpectedCurrencyCode = null);

public sealed record CancelReservationApiRequest(string? Reason);

/// <summary>
/// BHA-CHECKOUT-001-PR05: the body of <c>POST /api/v1/reservations</c>. Its own type, so the Hold request is untouched. A property this type does not define (a deposit, a fee, an amount to collect, anything) fails
/// binding with a 400 <c>request.invalid</c>: nothing in it can set what is collected. <c>paymentMethod</c> stays a string the service validates, so a wrong value gets its own stable code.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateDirectReservationApiRequest(
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string? FullName,
    string? Email,
    string? Phone,
    decimal? ExpectedTotalAmount,
    string? ExpectedCurrencyCode,
    string? PaymentMethod);

/// <summary>BHA-CHECKOUT-001-PR05: the limit on <c>POST /api/v1/reservations</c>, per client address (the one the trusted-proxy settings resolve; never a header, an e-mail or a token the client states). Bound from <c>Booking:DirectCheckout:RateLimiting</c>.</summary>
public sealed class DirectReservationRateLimitOptions
{
    public const string SectionName = "Booking:DirectCheckout:RateLimiting";
    public const string PolicyName = "booking-direct-create";
    public const string PathPrefix = "/api/v1/reservations";
    public int PermitLimit { get; init; } = 10;
    public int WindowSeconds { get; init; } = 60;
}
