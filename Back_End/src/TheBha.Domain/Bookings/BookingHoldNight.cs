namespace TheBha.Domain.Bookings;

public sealed class BookingHoldNight
{
    private BookingHoldNight()
    {
    }

    internal BookingHoldNight(Guid bookingHoldId, BookingNightSnapshot snapshot)
    {
        BookingHoldId = bookingHoldId;
        StayDate = snapshot.StayDate;
        Rooms = snapshot.Rooms;
        UnitAmount = snapshot.UnitAmount;
        NightTotal = snapshot.NightTotal;
    }

    public Guid BookingHoldId { get; private set; }
    public DateOnly StayDate { get; private set; }
    public int Rooms { get; private set; }
    public decimal UnitAmount { get; private set; }
    public decimal NightTotal { get; private set; }
}
