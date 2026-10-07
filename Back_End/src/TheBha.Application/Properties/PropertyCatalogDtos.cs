using TheBha.Domain.Properties;

namespace TheBha.Application.Properties;

public sealed record AmenityDto(
    Guid Id,
    string Code,
    string Name,
    string Category);

public sealed record MediaDto(
    Guid Id,
    string Url,
    string? AltText,
    MediaType MediaType,
    int SortOrder,
    bool IsCover);

public sealed record PropertyDto(
    Guid Id,
    string Name,
    string Slug,
    string? Description,
    string Address,
    string City,
    string Country,
    string TimeZone,
    TimeOnly CheckInTime,
    TimeOnly CheckOutTime,
    IReadOnlyList<AmenityDto> Amenities,
    IReadOnlyList<MediaDto> Media);

public sealed record RoomTypeDto(
    Guid Id,
    Guid PropertyId,
    string Code,
    string Name,
    string Slug,
    string? Description,
    int BaseOccupancy,
    int MaxOccupancy,
    IReadOnlyList<AmenityDto> Amenities,
    IReadOnlyList<MediaDto> Media);
