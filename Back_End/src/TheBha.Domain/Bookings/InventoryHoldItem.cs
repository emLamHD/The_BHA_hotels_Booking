using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

/// <summary>
/// Exactly one held room of one RoomType (ADR 0005 item 1). Never carries a
/// Quantity/Rooms multiplier — a Q-room request line is normalized into Q
/// independent InventoryHoldItem rows at Hold-creation time.
/// </summary>
public sealed class InventoryHoldItem
{
    private readonly List<InventoryHoldItemNight> _nights = [];

    private InventoryHoldItem()
    {
    }

    internal InventoryHoldItem(
        Guid id,
        Guid inventoryHoldId,
        Guid propertyId,
        Guid roomTypeId,
        DateOnly checkIn,
        DateOnly checkOut,
        IEnumerable<NightlyCommitmentSnapshot> nights)
    {
        DomainGuard.RequiredId(id, nameof(id));
        DomainGuard.RequiredId(inventoryHoldId, nameof(inventoryHoldId));
        DomainGuard.RequiredId(propertyId, nameof(propertyId));
        DomainGuard.RequiredId(roomTypeId, nameof(roomTypeId));
        var ordered = BookingGuard.ValidateNightlySnapshots(checkIn, checkOut, nights);

        Id = id;
        InventoryHoldId = inventoryHoldId;
        PropertyId = propertyId;
        RoomTypeId = roomTypeId;
        _nights.AddRange(ordered.Select(snapshot => new InventoryHoldItemNight(Id, propertyId, snapshot)));
    }

    public Guid Id { get; private set; }
    public Guid InventoryHoldId { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid RoomTypeId { get; private set; }
    public IReadOnlyList<InventoryHoldItemNight> Nights => _nights.AsReadOnly();
}
