using Microsoft.EntityFrameworkCore;
using TheBha.Application.Promotions;
using TheBha.Application.Website;
using TheBha.Domain.Promotions;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// The public read of promotions. One eligibility rule (<see cref="Promotion.IsPublicOn"/>, with the Property's local date) serves the list, the
/// detail and the picture, so a card, its page and its image can never disagree. Nothing administrative leaves here.
/// </summary>
internal sealed class WebsitePromotionService(TheBhaDbContext db, IHeroMediaStorage storage, TimeProvider clock) : IWebsitePromotions
{
    private const int MaxItems = 50;
    private const string KeyPrefix = "promotion";

    public async Task<PublicPromotionListDto> ListAsync(string? locale, CancellationToken cancellationToken)
    {
        var (resolved, texts) = await TextsAsync(locale, cancellationToken);
        var visible = await VisibleAsync(null, cancellationToken);
        var items = visible.Take(MaxItems).Select(x => Card(x.Promotion, texts)).ToList();
        return new PublicPromotionListDto(Revision(items, resolved.Code), resolved.Code, clock.GetUtcNow(), items);
    }

    public async Task<PublicPromotionDetailDto?> GetAsync(string slug, string? locale, CancellationToken cancellationToken)
    {
        var (resolved, texts) = await TextsAsync(locale, cancellationToken);
        var found = (await VisibleAsync(slug, cancellationToken)).SingleOrDefault();
        if (found is null) return null;

        var p = found.Promotion;
        var roomTypes = await db.RoomTypes.AsNoTracking()
            .Where(x => x.PropertyId == p.PropertyId && x.IsActive && (p.AllRoomTypes || p.RoomTypes.Select(r => r.RoomTypeId).Contains(x.Id)))
            .OrderBy(x => x.Code).Select(x => new PublicPromotionRoomTypeDto(x.Id, x.Name)).ToListAsync(cancellationToken);
        var body = Enumerable.Range(1, PromotionLimits.BodyParagraphs).Select(i => texts.Of(p.Id, $"body{i}", i <= p.BodyParagraphs.Length ? p.BodyParagraphs[i - 1] : null))
            .TakeWhile(x => x is not null).Select(x => x!).ToList();
        var card = Card(p, texts);
        var detail = new PublicPromotionDetailDto(string.Empty, resolved.Code, clock.GetUtcNow(), card, body, new PublicPromotionPropertyDto(p.PropertyId, found.PropertyName, found.PropertySlug), p.AllRoomTypes, roomTypes);
        return detail with { Revision = Revision(detail with { GeneratedAtUtc = default }, resolved.Code) };
    }

    public async Task<PromotionMediaFile?> OpenMediaAsync(Guid mediaId, CancellationToken cancellationToken)
    {
        if (!(await VisibleAsync(null, cancellationToken)).Any(x => x.Promotion.CoverMediaId == mediaId)) return null;
        var row = await db.PromotionMedia.AsNoTracking().SingleOrDefaultAsync(x => x.Id == mediaId, cancellationToken);
        if (row is null) return null;
        var stream = await storage.OpenReadAsync(row.StorageKey, cancellationToken);
        return stream is null ? null : new PromotionMediaFile(stream, row.ContentType);
    }

    private sealed record Visible(Promotion Promotion, string PropertyName, string PropertySlug);

    private async Task<List<Visible>> VisibleAsync(string? slug, CancellationToken cancellationToken)
    {
        var query = db.Promotions.AsNoTracking().Include(x => x.RoomTypes)
            .Where(x => x.Status == PromotionStatus.Active && x.ShowOnHomepage);
        if (slug is not null) query = query.Where(x => x.Slug == slug);
        var promotions = await query.ToListAsync(cancellationToken);
        var propertyIds = promotions.Select(x => x.PropertyId).Distinct().ToList();
        var properties = await db.Properties.AsNoTracking().Where(x => propertyIds.Contains(x.Id) && x.IsActive)
            .Select(x => new { x.Id, x.Name, x.Slug, x.TimeZone }).ToDictionaryAsync(x => x.Id, cancellationToken);
        var now = clock.GetUtcNow();
        return promotions
            .Where(x => properties.TryGetValue(x.PropertyId, out var property) &&
                        x.IsPublicOn(DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(property.TimeZone)).DateTime)))
            .OrderBy(x => x.SortOrder).ThenByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id)
            .Select(x => new Visible(x, properties[x.PropertyId].Name, properties[x.PropertyId].Slug))
            .ToList();
    }

    private static PublicPromotionCardDto Card(Promotion p, PromotionTexts texts) => new(
        p.Id, p.Slug, texts.Of(p.Id, "title", p.Title)!, texts.Of(p.Id, "summary", p.Summary)!,
        p.CoverMediaId is { } cover ? $"/api/v1/website/promotions/media/{cover}" : null,
        p.CoverMediaId is null ? null : texts.Of(p.Id, "altText", p.CoverAltText),
        new PublicPromotionTermsDto(p.Kind.ToString(), p.Value, p.CurrencyCode, p.BookingFrom, p.BookingTo, p.StayFrom, p.StayTo, p.MinNights));

    private static string Revision<T>(T body, string locale) =>
        SourceText.Hash(System.Text.Json.JsonSerializer.Serialize(body) + "|" + locale);

    /// <summary>The visitor's language, else (for a language other than the source) the default language's text, else the source column.</summary>
    private sealed class PromotionTexts(WebsiteLanguage resolved, WebsiteLanguage defaultLanguage, List<WebsiteTranslation> rows)
    {
        public string? Of(Guid id, string field, string? column)
        {
            var key = ContentKey.For(KeyPrefix, id.ToString("D"), field);
            var own = rows.FirstOrDefault(row => row.LanguageId == resolved.Id && row.Key == key)?.Value;
            if (own is not null || resolved.NormalizedCode == ContentSource.Locale) return own ?? column;
            return rows.FirstOrDefault(row => row.LanguageId == defaultLanguage.Id && row.Key == key)?.Value ?? column;
        }
    }

    private async Task<(WebsiteLanguage Resolved, PromotionTexts Texts)> TextsAsync(string? locale, CancellationToken cancellationToken)
    {
        var languages = await db.WebsiteLanguages.AsNoTracking().Where(language => language.IsActive).ToListAsync(cancellationToken);
        var defaultLanguage = languages.SingleOrDefault(language => language.IsDefault)
            ?? throw new InvalidOperationException("The website settings have no active default language.");
        var (_, resolved) = WebsitePublicReader.Resolve(languages, defaultLanguage, locale);
        var ids = new[] { defaultLanguage.Id, resolved.Id };
        var rows = await db.WebsiteTranslations.AsNoTracking().Where(row => ids.Contains(row.LanguageId) && row.Key.StartsWith("content.promotion.")).ToListAsync(cancellationToken);
        return (resolved, new PromotionTexts(resolved, defaultLanguage, rows));
    }
}
