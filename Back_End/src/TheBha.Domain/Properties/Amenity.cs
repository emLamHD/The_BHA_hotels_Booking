using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class Amenity
{
    private Amenity()
    {
    }

    public Amenity(Guid id, string code, string name, string category, bool isActive)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        Code = DomainGuard.Required(code, nameof(code), 50).ToUpperInvariant();
        Name = DomainGuard.Required(name, nameof(name), 200);
        Category = DomainGuard.Required(category, nameof(category), 100);
        IsActive = isActive;
    }

    public Guid Id { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string Category { get; private set; } = string.Empty;
    public bool IsActive { get; private set; }
}
