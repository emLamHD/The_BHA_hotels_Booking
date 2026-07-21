namespace TheBha.Application.Properties;

public interface IPropertyCatalogQueries
{
    Task<IReadOnlyList<PropertyDto>> GetPropertiesAsync(CancellationToken cancellationToken);

    Task<PropertyDto?> GetPropertyAsync(Guid propertyId, CancellationToken cancellationToken);

    Task<IReadOnlyList<RoomTypeDto>?> GetRoomTypesAsync(
        Guid propertyId,
        CancellationToken cancellationToken);

    Task<RoomTypeDto?> GetRoomTypeAsync(Guid roomTypeId, CancellationToken cancellationToken);
}
