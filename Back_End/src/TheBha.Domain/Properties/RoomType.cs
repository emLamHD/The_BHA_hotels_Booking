using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class RoomType
{
    private RoomType()
    {
    }

    public RoomType(
        Guid id,
        Guid propertyId,
        string code,
        string name,
        string slug,
        string? description,
        int baseOccupancy,
        int maxOccupancy,
        bool isActive,
        DateTimeOffset createdAt,
        decimal? areaSquareMeters = null,
        int? bedrooms = null,
        string? bedDescription = null)
    {
        if (baseOccupancy <= 0)
        {
            throw new DomainException("Base occupancy must be greater than zero.");
        }

        if (maxOccupancy < baseOccupancy)
        {
            throw new DomainException("Maximum occupancy cannot be less than base occupancy.");
        }

        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        Code = DomainGuard.Required(code, nameof(code), 50).ToUpperInvariant();
        Name = DomainGuard.Required(name, nameof(name), 200);
        Slug = DomainGuard.Required(slug, nameof(slug), 200).ToLowerInvariant();
        Description = DomainGuard.Optional(description, nameof(description), 4000);
        BaseOccupancy = baseOccupancy;
        MaxOccupancy = maxOccupancy;
        IsActive = isActive;
        if (areaSquareMeters is <= 0 or > 10000 || bedrooms is < 0 or > 100)
            throw new DomainException("Invalid catalog dimensions.");
        AreaSquareMeters = areaSquareMeters;
        Bedrooms = bedrooms;
        BedDescription = DomainGuard.Optional(bedDescription, nameof(bedDescription), 500);
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public int BaseOccupancy { get; private set; }
    public int MaxOccupancy { get; private set; }
    public bool IsActive { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public int ContentVersion { get; private set; } = 1;
    public Guid? ContentUpdatedByStaffId { get; private set; }
    public decimal? AreaSquareMeters { get; private set; }
    public int? Bedrooms { get; private set; }
    public string? BedDescription { get; private set; }

    public void EditContent(string name, string? description, decimal? area, int? bedrooms, string? beds, Guid actor, DateTimeOffset now)
    {
        if (area is <= 0 or > 10000 || bedrooms is < 0 or > 100)
            throw new DomainException("Invalid catalog dimensions.");
        Name = DomainGuard.Required(name, nameof(name), 200);
        Description = DomainGuard.Optional(description, nameof(description), 4000);
        AreaSquareMeters = area;
        Bedrooms = bedrooms;
        BedDescription = DomainGuard.Optional(beds, nameof(beds), 500);
        ContentVersion++;
        ContentUpdatedByStaffId = DomainGuard.RequiredId(actor, nameof(actor));
        UpdatedAt = now;
    }

    public void Deactivate(DateTimeOffset updatedAt)
    {
        IsActive = false;
        UpdatedAt = updatedAt;
    }
}
