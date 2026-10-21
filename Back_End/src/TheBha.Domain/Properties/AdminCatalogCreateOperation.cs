namespace TheBha.Domain.Properties;

/// <summary>One Staff create request and its result, committed atomically with the catalog row and audit.</summary>
public sealed class AdminCatalogCreateOperation
{
    private AdminCatalogCreateOperation() { }
    public AdminCatalogCreateOperation(Guid operationId, Guid actorStaffId, string entityType, Guid entityId, Guid propertyId, string requestFingerprint, DateTimeOffset createdAt)
    {
        OperationId = operationId; ActorStaffId = actorStaffId; EntityType = entityType;
        EntityId = entityId; PropertyId = propertyId; RequestFingerprint = requestFingerprint; CreatedAt = createdAt;
    }
    public Guid OperationId { get; private set; }
    public Guid ActorStaffId { get; private set; }
    public string EntityType { get; private set; } = "";
    public Guid EntityId { get; private set; }
    public Guid PropertyId { get; private set; }
    public string RequestFingerprint { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
}
