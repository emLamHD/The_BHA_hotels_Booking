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
    string? Phone);
