using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class PropertyAmenity
{
    private PropertyAmenity()
    {
    }

    public PropertyAmenity(Guid propertyId, Guid amenityId)
    {
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        AmenityId = DomainGuard.RequiredId(amenityId, nameof(amenityId));
    }

    public Guid PropertyId { get; private set; }
    public Guid AmenityId { get; private set; }
    public Property Property { get; private set; } = null!;
    public Amenity Amenity { get; private set; } = null!;
}
