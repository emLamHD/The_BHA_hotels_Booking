using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class RoomTypeMedia
{
    private RoomTypeMedia()
    {
    }

    public RoomTypeMedia(Guid roomTypeId, Guid mediaId, int sortOrder, bool isCover, string? altTextOverride = null)
    {
        if (sortOrder < 0)
        {
            throw new DomainException("Media sort order cannot be negative.");
        }

        RoomTypeId = DomainGuard.RequiredId(roomTypeId, nameof(roomTypeId));
        MediaId = DomainGuard.RequiredId(mediaId, nameof(mediaId));
        SortOrder = sortOrder;
        IsCover = isCover;
        AltTextOverride = altTextOverride is null ? null : DomainGuard.Optional(altTextOverride, nameof(altTextOverride), 500) ?? string.Empty;
    }

    public Guid RoomTypeId { get; private set; }
    public Guid MediaId { get; private set; }
    public int SortOrder { get; private set; }
    public bool IsCover { get; private set; }
    public string? AltTextOverride { get; private set; }
    public RoomType RoomType { get; private set; } = null!;
    public Media Media { get; private set; } = null!;
}
