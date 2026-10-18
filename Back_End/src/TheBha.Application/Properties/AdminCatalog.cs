using TheBha.Application.Website;

namespace TheBha.Application.Properties;

public sealed record CatalogPropertyChoice(Guid Id, string Name, string Slug);
public sealed record CatalogProductSummary(
    Guid PropertyId, Guid RoomTypeId, string Code, string Name, string? Description,
    int BaseOccupancy, int MaxOccupancy, int PhysicalRoomCount, int GalleryCount,
    Guid? CoverMediaId, string? CoverAltText, bool IsActive);
public sealed record CatalogGalleryItem(Guid MediaId, string Url, string? AltText, bool IsCover);
public sealed record CatalogGalleryInput(Guid MediaId, string? AltText, bool IsCover);
public sealed record CatalogRoomChoice(Guid Id, string Code, string Name);
public sealed record CatalogEditorDto(
    Guid PropertyId, Guid? RoomTypeId, int Version, string SourceLocale, string Name, string? Description,
    string Slug, string? Code, string? Address, string? City, string? Country,
    decimal? AreaSquareMeters, int? Bedrooms, string? BedDescription,
    int? BaseOccupancy, int? MaxOccupancy, int PhysicalRoomCount, bool IsActive,
    string TimeZone, TimeOnly CheckInTime, TimeOnly CheckOutTime,
    DateTimeOffset UpdatedAt, Guid? UpdatedByStaffId,
    IReadOnlyList<CatalogRoomChoice> RoomTypes, IReadOnlyList<CatalogGalleryItem> Gallery,
    IReadOnlyList<Guid> AmenityIds, IReadOnlyList<AmenityDto> Amenities,
    IReadOnlyList<string> TranslationOverrideKeys);
public sealed record SaveCatalogContent(
    int ExpectedVersion, string? Name, string? Description, string? Address, string? City, string? Country,
    decimal? AreaSquareMeters, int? Bedrooms, string? BedDescription,
    IReadOnlyList<CatalogGalleryInput>? Gallery, IReadOnlyList<Guid>? AmenityIds);
public sealed record CreateCatalogAmenity(string? Code, string? Name, string? Category);
public sealed record CatalogMediaFile(Stream Content, string ContentType);
public sealed record CatalogImageInfo(string ContentType, string Extension);
public static class CatalogLimits { public const int MaxUploadBytes = 10 * 1024 * 1024; public const int MaxGallery = 50; }
public interface ICatalogMediaStorage
{
    bool IsConfigured { get; }
    Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken ct);
    Task<Stream?> OpenAsync(string key, CancellationToken ct);
    Task<bool> ExistsAsync(string key, CancellationToken ct);
    Task DeleteUnrecordedAsync(string key, CancellationToken ct);
}
public interface ICatalogImageDecoder { CatalogImageInfo? Inspect(ReadOnlyMemory<byte> bytes); }
public interface IAdminCatalog
{
    Task<IReadOnlyList<CatalogPropertyChoice>> ListAsync(CancellationToken ct);
    Task<IReadOnlyList<CatalogProductSummary>> ListProductsAsync(Guid propertyId, CancellationToken ct);
    Task<CatalogEditorDto?> GetAsync(Guid propertyId, Guid? roomTypeId, CancellationToken ct);
    Task<WebsiteMutationResult<CatalogEditorDto>> SaveAsync(Guid propertyId, Guid? roomTypeId, SaveCatalogContent input, Guid actor, CancellationToken ct);
    Task<WebsiteMutationResult<CatalogGalleryItem>> UploadAsync(Guid propertyId, Guid? roomTypeId, Stream stream, string publicOrigin, Guid actor, CancellationToken ct);
    Task<WebsiteMutationResult<AmenityDto>> AddAmenityAsync(Guid propertyId, CreateCatalogAmenity input, Guid actor, CancellationToken ct);
    Task<CatalogMediaFile?> OpenAsync(Guid propertyId, Guid? roomTypeId, Guid mediaId, CancellationToken ct);
    Task<CatalogMediaFile?> OpenPublicAsync(Guid mediaId, CancellationToken ct);
}
