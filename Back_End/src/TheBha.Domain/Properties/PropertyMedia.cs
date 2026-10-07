using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class PropertyMedia
{
    private PropertyMedia()
    {
    }

    public PropertyMedia(Guid propertyId, Guid mediaId, int sortOrder, bool isCover)
    {
        if (sortOrder < 0)
        {
            throw new DomainException("Media sort order cannot be negative.");
        }

        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        MediaId = DomainGuard.RequiredId(mediaId, nameof(mediaId));
        SortOrder = sortOrder;
        IsCover = isCover;
    }

    public Guid PropertyId { get; private set; }
    public Guid MediaId { get; private set; }
    public int SortOrder { get; private set; }
    public bool IsCover { get; private set; }
    public Property Property { get; private set; } = null!;
    public Media Media { get; private set; } = null!;
}
