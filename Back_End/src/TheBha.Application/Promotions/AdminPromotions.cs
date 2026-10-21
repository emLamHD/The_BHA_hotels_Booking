using TheBha.Application.Website;
using TheBha.Domain.Promotions;

namespace TheBha.Application.Promotions;

public static class PromotionErrorCodes
{
    public const string SlugTaken = "slug-taken";
    public const string IdempotencyKeyRequired = "idempotency-key-required";
    public const string IdempotencyKeyReused = "idempotency-key-reused";
    public const string StorageNotConfigured = "promotion-storage-not-configured";
    public const string ImageTooSmall = "promotion-image-too-small";
    public const string MediaMissing = "promotion-media-missing";
}

/// <summary>The texts of one language (the default language's are the columns of the promotion itself). <c>null</c> removes that text.</summary>
public sealed record PromotionTextsDto(string? Title, string? Summary, string? CoverAltText, IReadOnlyList<string>? Body);

/// <summary>What an Admin sends to create or save a promotion: the rule and content, and the texts of the other languages.</summary>
public sealed record PromotionInput(PromotionDetails Details, IReadOnlyDictionary<string, PromotionTextsDto>? Translations);

public sealed record PromotionRoomTypeChoice(Guid Id, string Code, string Name, bool IsActive);

public sealed record PromotionLanguageChoice(string Code, string DisplayName, bool IsSource);

public sealed record PromotionMediaDto(Guid Id, string ContentType, int Width, int Height);

public sealed record PromotionListQuery(PromotionStatus? Status, string? Search, bool? ShowOnHomepage, bool? PublicNow);

public sealed record PromotionSummaryDto(
    Guid Id,
    Guid PropertyId,
    string Slug,
    string Title,
    string Summary,
    string Status,
    string Kind,
    decimal Value,
    string? CurrencyCode,
    bool AllRoomTypes,
    int RoomTypeCount,
    bool ShowOnHomepage,
    int SortOrder,
    DateOnly? BookingFrom,
    DateOnly? BookingTo,
    DateOnly? StayFrom,
    DateOnly? StayTo,
    DateOnly? DisplayFrom,
    DateOnly? DisplayTo,
    int MinNights,
    bool PublicNow,
    Guid? CoverMediaId,
    int Version,
    DateTimeOffset UpdatedAtUtc);

public sealed record PromotionEditorDto(
    Guid Id,
    Guid PropertyId,
    string Slug,
    string Status,
    string Kind,
    decimal Value,
    string? CurrencyCode,
    bool AllRoomTypes,
    IReadOnlyList<Guid> RoomTypeIds,
    DateOnly? BookingFrom,
    DateOnly? BookingTo,
    DateOnly? StayFrom,
    DateOnly? StayTo,
    int MinNights,
    string Title,
    string Summary,
    IReadOnlyList<string> Body,
    Guid? CoverMediaId,
    string? CoverAltText,
    bool ShowOnHomepage,
    int SortOrder,
    DateOnly? DisplayFrom,
    DateOnly? DisplayTo,
    bool PublicNow,
    IReadOnlyDictionary<string, PromotionTextsDto> Translations,
    IReadOnlyList<PromotionLanguageChoice> Languages,
    int Version,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    Guid UpdatedByStaffId);

public sealed record PromotionMediaFile(Stream Content, string ContentType);

public interface IAdminPromotions
{
    /// <summary><c>null</c> when the Property does not exist.</summary>
    Task<IReadOnlyList<PromotionSummaryDto>?> ListAsync(Guid propertyId, PromotionListQuery query, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<PromotionEditorDto>> GetAsync(Guid propertyId, Guid promotionId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PromotionRoomTypeChoice>?> RoomTypesAsync(Guid propertyId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<PromotionEditorDto>> CreateAsync(Guid propertyId, PromotionInput input, Guid operationId, Guid actorStaffId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<PromotionEditorDto>> SaveAsync(Guid propertyId, Guid promotionId, int expectedVersion, PromotionInput input, Guid actorStaffId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<PromotionEditorDto>> SetStatusAsync(Guid propertyId, Guid promotionId, int expectedVersion, PromotionStatus status, Guid actorStaffId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<PromotionMediaDto>> UploadMediaAsync(Guid propertyId, Stream content, Guid actorStaffId, CancellationToken cancellationToken);

    Task<PromotionMediaFile?> OpenMediaAsync(Guid propertyId, Guid mediaId, CancellationToken cancellationToken);
}
