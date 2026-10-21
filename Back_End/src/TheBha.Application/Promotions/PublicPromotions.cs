namespace TheBha.Application.Promotions;

/// <summary>The conditions the guest needs to read. The discount's size is stated here, never typed into the text, so words and price cannot differ.</summary>
public sealed record PublicPromotionTermsDto(
    string Kind,
    decimal Value,
    string? CurrencyCode,
    DateOnly? BookingFrom,
    DateOnly? BookingTo,
    DateOnly? StayFrom,
    DateOnly? StayTo,
    int MinNights);

public sealed record PublicPromotionCardDto(
    Guid Id,
    string Slug,
    string Title,
    string Summary,
    string? CoverImageUrl,
    string? CoverAltText,
    PublicPromotionTermsDto Terms);

public sealed record PublicPromotionPropertyDto(Guid Id, string Name, string Slug);

public sealed record PublicPromotionRoomTypeDto(Guid Id, string Name);

/// <summary>Public promotions for a language. Only promotions that are public today (Active, on the homepage, inside the display window, booking not over).</summary>
public sealed record PublicPromotionListDto(string Revision, string Locale, DateTimeOffset GeneratedAtUtc, IReadOnlyList<PublicPromotionCardDto> Items);

public sealed record PublicPromotionDetailDto(
    string Revision,
    string Locale,
    DateTimeOffset GeneratedAtUtc,
    PublicPromotionCardDto Promotion,
    IReadOnlyList<string> Body,
    PublicPromotionPropertyDto Property,
    bool AllRoomTypes,
    IReadOnlyList<PublicPromotionRoomTypeDto> RoomTypes);

public interface IWebsitePromotions
{
    Task<PublicPromotionListDto> ListAsync(string? locale, CancellationToken cancellationToken);

    /// <summary><c>null</c> when there is no public promotion with this slug today (a draft, a disabled or an out-of-window one looks the same as none).</summary>
    Task<PublicPromotionDetailDto?> GetAsync(string slug, string? locale, CancellationToken cancellationToken);

    /// <summary>A cover picture, only while a promotion that is public today uses it.</summary>
    Task<PromotionMediaFile?> OpenMediaAsync(Guid mediaId, CancellationToken cancellationToken);
}
