namespace TheBha.Domain.Bookings;

public sealed class ReservationUnitNight
{
    private ReservationUnitNight()
    {
    }

    internal ReservationUnitNight(
        Guid reservationUnitId,
        Guid propertyId,
        NightlyCommitmentSnapshot snapshot)
    {
        ReservationUnitId = reservationUnitId;
        PropertyId = propertyId;
        StayDate = snapshot.StayDate;
        RatePlanId = snapshot.RatePlanId;
        UnitAmount = snapshot.UnitAmount;
    }

    public Guid ReservationUnitId { get; private set; }
    public Guid PropertyId { get; private set; }
    public DateOnly StayDate { get; private set; }
    public Guid RatePlanId { get; private set; }
    public decimal UnitAmount { get; private set; }
}
