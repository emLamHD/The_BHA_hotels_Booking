namespace TheBha.Domain.Bookings;

public sealed class ReservationNight
{
    private ReservationNight()
    {
    }

    internal ReservationNight(Guid reservationId, BookingNightSnapshot snapshot)
    {
        ReservationId = reservationId;
        StayDate = snapshot.StayDate;
        Rooms = snapshot.Rooms;
        UnitAmount = snapshot.UnitAmount;
        NightTotal = snapshot.NightTotal;
    }

    public Guid ReservationId { get; private set; }
    public DateOnly StayDate { get; private set; }
    public int Rooms { get; private set; }
    public decimal UnitAmount { get; private set; }
    public decimal NightTotal { get; private set; }
}
