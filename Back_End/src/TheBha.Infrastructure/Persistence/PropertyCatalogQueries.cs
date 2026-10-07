using Microsoft.EntityFrameworkCore;
using TheBha.Application.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class PropertyCatalogQueries(TheBhaDbContext dbContext) : IPropertyCatalogQueries
{
    public async Task<IReadOnlyList<PropertyDto>> GetPropertiesAsync(
        CancellationToken cancellationToken)
    {
        return await dbContext.Properties
            .AsNoTracking()
            .AsSplitQuery()
            .Where(property => property.IsActive)
            .OrderBy(property => property.Name)
            .ThenBy(property => property.Id)
            .Select(property => new PropertyDto(
                property.Id,
                property.Name,
                property.Slug,
                property.Description,
                property.Address,
                property.City,
                property.Country,
                property.TimeZone,
                property.CheckInTime,
                property.CheckOutTime,
                dbContext.PropertyAmenities
                    .Where(link => link.PropertyId == property.Id && link.Amenity.IsActive)
                    .OrderBy(link => link.Amenity.Name)
                    .ThenBy(link => link.AmenityId)
                    .Select(link => new AmenityDto(
                        link.Amenity.Id,
                        link.Amenity.Code,
                        link.Amenity.Name,
                        link.Amenity.Category))
                    .ToList(),
                dbContext.PropertyMedia
                    .Where(link => link.PropertyId == property.Id)
                    .OrderBy(link => link.SortOrder)
                    .ThenBy(link => link.MediaId)
                    .Select(link => new MediaDto(
                        link.Media.Id,
                        link.Media.Url,
                        link.Media.AltText,
                        link.Media.MediaType,
                        link.SortOrder,
                        link.IsCover))
                    .ToList()))
            .ToListAsync(cancellationToken);
    }

    public Task<PropertyDto?> GetPropertyAsync(
        Guid propertyId,
        CancellationToken cancellationToken)
    {
        return dbContext.Properties
            .AsNoTracking()
            .AsSplitQuery()
            .Where(property => property.Id == propertyId && property.IsActive)
            .Select(property => new PropertyDto(
                property.Id,
                property.Name,
                property.Slug,
                property.Description,
                property.Address,
                property.City,
                property.Country,
                property.TimeZone,
                property.CheckInTime,
                property.CheckOutTime,
                dbContext.PropertyAmenities
                    .Where(link => link.PropertyId == property.Id && link.Amenity.IsActive)
                    .OrderBy(link => link.Amenity.Name)
                    .ThenBy(link => link.AmenityId)
                    .Select(link => new AmenityDto(
                        link.Amenity.Id,
                        link.Amenity.Code,
                        link.Amenity.Name,
                        link.Amenity.Category))
                    .ToList(),
                dbContext.PropertyMedia
                    .Where(link => link.PropertyId == property.Id)
                    .OrderBy(link => link.SortOrder)
                    .ThenBy(link => link.MediaId)
                    .Select(link => new MediaDto(
                        link.Media.Id,
                        link.Media.Url,
                        link.Media.AltText,
                        link.Media.MediaType,
                        link.SortOrder,
                        link.IsCover))
                    .ToList()))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<RoomTypeDto>?> GetRoomTypesAsync(
        Guid propertyId,
        CancellationToken cancellationToken)
    {
        var propertyIsPublic = await dbContext.Properties
            .AsNoTracking()
            .AnyAsync(
                property => property.Id == propertyId && property.IsActive,
                cancellationToken);

        if (!propertyIsPublic)
        {
            return null;
        }

        return await dbContext.RoomTypes
            .AsNoTracking()
            .AsSplitQuery()
            .Where(roomType => roomType.PropertyId == propertyId && roomType.IsActive)
            .OrderBy(roomType => roomType.Name)
            .ThenBy(roomType => roomType.Id)
            .Select(roomType => new RoomTypeDto(
                roomType.Id,
                roomType.PropertyId,
                roomType.Code,
                roomType.Name,
                roomType.Slug,
                roomType.Description,
                roomType.BaseOccupancy,
                roomType.MaxOccupancy,
                dbContext.RoomTypeAmenities
                    .Where(link => link.RoomTypeId == roomType.Id && link.Amenity.IsActive)
                    .OrderBy(link => link.Amenity.Name)
                    .ThenBy(link => link.AmenityId)
                    .Select(link => new AmenityDto(
                        link.Amenity.Id,
                        link.Amenity.Code,
                        link.Amenity.Name,
                        link.Amenity.Category))
                    .ToList(),
                dbContext.RoomTypeMedia
                    .Where(link => link.RoomTypeId == roomType.Id)
                    .OrderBy(link => link.SortOrder)
                    .ThenBy(link => link.MediaId)
                    .Select(link => new MediaDto(
                        link.Media.Id,
                        link.Media.Url,
                        link.Media.AltText,
                        link.Media.MediaType,
                        link.SortOrder,
                        link.IsCover))
                    .ToList()))
            .ToListAsync(cancellationToken);
    }

    public Task<RoomTypeDto?> GetRoomTypeAsync(
        Guid roomTypeId,
        CancellationToken cancellationToken)
    {
        return dbContext.RoomTypes
            .AsNoTracking()
            .AsSplitQuery()
            .Where(roomType =>
                roomType.Id == roomTypeId &&
                roomType.IsActive &&
                dbContext.Properties.Any(property =>
                    property.Id == roomType.PropertyId && property.IsActive))
            .Select(roomType => new RoomTypeDto(
                roomType.Id,
                roomType.PropertyId,
                roomType.Code,
                roomType.Name,
                roomType.Slug,
                roomType.Description,
                roomType.BaseOccupancy,
                roomType.MaxOccupancy,
                dbContext.RoomTypeAmenities
                    .Where(link => link.RoomTypeId == roomType.Id && link.Amenity.IsActive)
                    .OrderBy(link => link.Amenity.Name)
                    .ThenBy(link => link.AmenityId)
                    .Select(link => new AmenityDto(
                        link.Amenity.Id,
                        link.Amenity.Code,
                        link.Amenity.Name,
                        link.Amenity.Category))
                    .ToList(),
                dbContext.RoomTypeMedia
                    .Where(link => link.RoomTypeId == roomType.Id)
                    .OrderBy(link => link.SortOrder)
                    .ThenBy(link => link.MediaId)
                    .Select(link => new MediaDto(
                        link.Media.Id,
                        link.Media.Url,
                        link.Media.AltText,
                        link.Media.MediaType,
                        link.SortOrder,
                        link.IsCover))
                    .ToList()))
            .SingleOrDefaultAsync(cancellationToken);
    }
}
