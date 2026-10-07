using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class DailyInventoryControl
{
    private DailyInventoryControl() { }

    public DailyInventoryControl(Guid id, Guid propertyId, Guid roomTypeId, DateOnly stayDate, int? sellableLimit, bool isStopSell, DateTimeOffset createdAt)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        RoomTypeId = DomainGuard.RequiredId(roomTypeId, nameof(roomTypeId));
        StayDate = stayDate;
        ValidateState(sellableLimit, isStopSell);
        SellableLimit = sellableLimit;
        IsStopSell = isStopSell;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid RoomTypeId { get; private set; }
    public DateOnly StayDate { get; private set; }
    public int? SellableLimit { get; private set; }
    public bool IsStopSell { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public void Update(int? sellableLimit, bool isStopSell, DateTimeOffset updatedAt)
    {
        ValidateState(sellableLimit, isStopSell);
        if (updatedAt < CreatedAt || updatedAt < UpdatedAt) throw new DomainException("updatedAt cannot be earlier than the current timestamp.");
        SellableLimit = sellableLimit;
        IsStopSell = isStopSell;
        UpdatedAt = updatedAt;
    }

    public void SetSellableLimit(int? sellableLimit, DateTimeOffset updatedAt) => Update(sellableLimit, IsStopSell, updatedAt);
    public void SetStopSell(bool isStopSell, DateTimeOffset updatedAt) => Update(SellableLimit, isStopSell, updatedAt);

    private static void ValidateState(int? sellableLimit, bool isStopSell)
    {
        if (sellableLimit < 0) throw new DomainException("sellableLimit cannot be negative.");
        if (sellableLimit is null && !isStopSell) throw new DomainException("An inventory control must have at least one effect.");
    }
}
