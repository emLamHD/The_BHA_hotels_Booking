using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class RoomTypeAmenity
{
    private RoomTypeAmenity()
    {
    }

    public RoomTypeAmenity(Guid roomTypeId, Guid amenityId)
    {
        RoomTypeId = DomainGuard.RequiredId(roomTypeId, nameof(roomTypeId));
        AmenityId = DomainGuard.RequiredId(amenityId, nameof(amenityId));
    }

    public Guid RoomTypeId { get; private set; }
    public Guid AmenityId { get; private set; }
    public RoomType RoomType { get; private set; } = null!;
    public Amenity Amenity { get; private set; } = null!;
}
