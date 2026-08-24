namespace TheBha.Domain.Bookings;

public sealed class InventoryHoldItemNight
{
    private InventoryHoldItemNight()
    {
    }

    internal InventoryHoldItemNight(
        Guid inventoryHoldItemId,
        Guid propertyId,
        NightlyCommitmentSnapshot snapshot)
    {
        InventoryHoldItemId = inventoryHoldItemId;
        PropertyId = propertyId;
        StayDate = snapshot.StayDate;
        RatePlanId = snapshot.RatePlanId;
        UnitAmount = snapshot.UnitAmount;
    }

    public Guid InventoryHoldItemId { get; private set; }
    public Guid PropertyId { get; private set; }
    public DateOnly StayDate { get; private set; }
    public Guid RatePlanId { get; private set; }
    public decimal UnitAmount { get; private set; }
}
