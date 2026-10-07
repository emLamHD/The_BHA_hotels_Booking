using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class PhysicalRoom
{
    private PhysicalRoom()
    {
    }

    public PhysicalRoom(
        Guid id,
        Guid propertyId,
        RoomType roomType,
        string roomNumber,
        int floor,
        OperationalStatus operationalStatus,
        DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(roomType);

        if (propertyId != roomType.PropertyId)
        {
            throw new DomainException("A physical room and its room type must belong to the same property.");
        }

        if (!Enum.IsDefined(operationalStatus))
        {
            throw new DomainException("Operational status is invalid.");
        }

        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        RoomTypeId = roomType.Id;
        RoomNumber = DomainGuard.Required(roomNumber, nameof(roomNumber), 50);
        Floor = floor;
        OperationalStatus = operationalStatus;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid RoomTypeId { get; private set; }
    public string RoomNumber { get; private set; } = string.Empty;
    public int Floor { get; private set; }
    public OperationalStatus OperationalStatus { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
}
