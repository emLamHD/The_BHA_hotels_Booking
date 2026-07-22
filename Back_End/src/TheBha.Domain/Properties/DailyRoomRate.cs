using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class DailyRoomRate
{
    private DailyRoomRate() { }

    public DailyRoomRate(Guid id, Guid propertyId, Guid roomTypeId, Guid ratePlanId, DateOnly stayDate, decimal amount, DateTimeOffset createdAt)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        RoomTypeId = DomainGuard.RequiredId(roomTypeId, nameof(roomTypeId));
        RatePlanId = DomainGuard.RequiredId(ratePlanId, nameof(ratePlanId));
        if (amount <= 0) throw new DomainException("amount must be greater than zero.");
        StayDate = stayDate;
        Amount = amount;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid RoomTypeId { get; private set; }
    public Guid RatePlanId { get; private set; }
    public DateOnly StayDate { get; private set; }
    public decimal Amount { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public void UpdateAmount(decimal amount, DateTimeOffset updatedAt)
    {
        if (amount <= 0) throw new DomainException("amount must be greater than zero.");
        if (updatedAt < CreatedAt || updatedAt < UpdatedAt) throw new DomainException("updatedAt cannot be earlier than the current timestamp.");
        Amount = amount;
        UpdatedAt = updatedAt;
    }
}
