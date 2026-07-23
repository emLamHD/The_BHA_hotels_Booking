namespace TheBha.Domain.Bookings;

public sealed record BookingNightSnapshot(
    DateOnly StayDate,
    int Rooms,
    decimal UnitAmount,
    decimal NightTotal);
