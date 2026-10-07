using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class Property
{
    private Property()
    {
    }

    public Property(
        Guid id,
        string name,
        string slug,
        string? description,
        string address,
        string city,
        string country,
        string timeZone,
        TimeOnly checkInTime,
        TimeOnly checkOutTime,
        bool isActive,
        DateTimeOffset createdAt)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        Name = DomainGuard.Required(name, nameof(name), 200);
        Slug = DomainGuard.Required(slug, nameof(slug), 200).ToLowerInvariant();
        Description = DomainGuard.Optional(description, nameof(description), 4000);
        Address = DomainGuard.Required(address, nameof(address), 500);
        City = DomainGuard.Required(city, nameof(city), 120);
        Country = DomainGuard.Required(country, nameof(country), 120);
        TimeZone = DomainGuard.Required(timeZone, nameof(timeZone), 100);
        CheckInTime = checkInTime;
        CheckOutTime = checkOutTime;
        IsActive = isActive;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public string Address { get; private set; } = string.Empty;
    public string City { get; private set; } = string.Empty;
    public string Country { get; private set; } = string.Empty;
    public string TimeZone { get; private set; } = string.Empty;
    public TimeOnly CheckInTime { get; private set; }
    public TimeOnly CheckOutTime { get; private set; }
    public bool IsActive { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public void Deactivate(DateTimeOffset updatedAt)
    {
        IsActive = false;
        UpdatedAt = updatedAt;
    }
}
