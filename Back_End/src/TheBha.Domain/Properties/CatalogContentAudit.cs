namespace TheBha.Domain.Properties;

// An append-only record of a catalog action, using the verified Staff actor, like the schedule audit.
public sealed class CatalogContentAudit
{
    private CatalogContentAudit() { }
    public CatalogContentAudit(Guid propertyId, Guid? roomTypeId, Guid actorStaffId, DateTimeOffset atUtc, string action, string before, string after)
    {
        Id = Guid.NewGuid(); PropertyId = propertyId; RoomTypeId = roomTypeId;
        ActorStaffId = actorStaffId; AtUtc = atUtc; Action = action; Before = before; After = after;
    }
    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid? RoomTypeId { get; private set; }
    public Guid ActorStaffId { get; private set; }
    public DateTimeOffset AtUtc { get; private set; }
    public string Action { get; private set; } = "";
    public string Before { get; private set; } = "";
    public string After { get; private set; } = "";
}

public sealed class CatalogUpload
{
    private CatalogUpload() { }
    public CatalogUpload(Guid mediaId, Guid propertyId, Guid? roomTypeId, string storageKey, string contentType)
    {
        MediaId = mediaId; PropertyId = propertyId; RoomTypeId = roomTypeId; StorageKey = storageKey; ContentType = contentType;
    }
    public Guid MediaId { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid? RoomTypeId { get; private set; }
    public string StorageKey { get; private set; } = "";
    public string ContentType { get; private set; } = "";
}
