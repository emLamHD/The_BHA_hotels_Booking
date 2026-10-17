using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: the translatable fields of the stored catalog, discovered from the database on
/// every read, so a property, room type, rate plan, amenity or media item added later brings its own keys
/// (<c>content.&lt;entity&gt;.&lt;id&gt;.&lt;field&gt;</c>) without a code change. The column's text is the source text; a
/// translation row for the same key (in any language, the source language included) overrides it.
/// </summary>
internal sealed class ContentCatalog(TheBhaDbContext database) : IContentCatalog
{
    public async Task<IReadOnlyList<ContentEntry>> ListAsync(CancellationToken cancellationToken)
    {
        var entries = new List<ContentEntry>();

        foreach (var property in await database.Properties.AsNoTracking().Where(item => item.IsActive)
                     .Select(item => new { item.Id, item.Name, item.Description, item.Address, item.City, item.Country })
                     .ToListAsync(cancellationToken))
        {
            Add(entries, "property", property.Id, "name", property.Name);
            Add(entries, "property", property.Id, "description", property.Description);
            Add(entries, "property", property.Id, "address", property.Address);
            Add(entries, "property", property.Id, "city", property.City);
            Add(entries, "property", property.Id, "country", property.Country);
        }

        foreach (var roomType in await database.RoomTypes.AsNoTracking().Where(item => item.IsActive)
                     .Select(item => new { item.Id, item.Name, item.Description })
                     .ToListAsync(cancellationToken))
        {
            Add(entries, "roomType", roomType.Id, "name", roomType.Name);
            Add(entries, "roomType", roomType.Id, "description", roomType.Description);
        }

        foreach (var ratePlan in await database.RatePlans.AsNoTracking().Where(item => item.IsActive)
                     .Select(item => new { item.Id, item.Name })
                     .ToListAsync(cancellationToken))
        {
            Add(entries, "ratePlan", ratePlan.Id, "name", ratePlan.Name);
        }

        foreach (var amenity in await database.Amenities.AsNoTracking().Where(item => item.IsActive)
                     .Select(item => new { item.Id, item.Name, item.Category })
                     .ToListAsync(cancellationToken))
        {
            Add(entries, "amenity", amenity.Id, "name", amenity.Name);
            Add(entries, "amenity", amenity.Id, "category", amenity.Category);
        }

        foreach (var media in await database.Media.AsNoTracking()
                     .Select(item => new { item.Id, item.AltText })
                     .ToListAsync(cancellationToken))
        {
            Add(entries, "media", media.Id, "altText", media.AltText);
        }

        // CUST-WEB-HEADER-001-CP04: a header menu entry's label (the content source language's text); the other languages' labels are translation rows.
        foreach (var item in await database.WebsiteMenuItems.AsNoTracking().Select(item => new { item.Id, item.Label }).ToListAsync(cancellationToken))
        {
            Add(entries, "menuItem", item.Id, "label", item.Label);
        }

        // CUST-WEB-HERO-001-CP01: the home hero's texts (the content source language's text); the other languages' are translation rows.
        var hero = await database.WebsiteHero.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (hero is not null)
        {
            Add(entries, "heroSlideshow", "main", "title", hero.Title);
            Add(entries, "heroSlideshow", "main", "description", hero.Description);
            Add(entries, "heroSlideshow", "main", "primaryAction", hero.PrimaryActionLabel);
            Add(entries, "heroSlideshow", "main", "secondaryAction", hero.SecondaryActionLabel);
        }

        foreach (var slide in await database.WebsiteHeroSlides.AsNoTracking().Select(item => new { item.Id, item.Alt, item.Caption }).ToListAsync(cancellationToken))
        {
            Add(entries, "heroSlide", slide.Id, "alt", slide.Alt);
            Add(entries, "heroSlide", slide.Id, "caption", slide.Caption);
        }

        entries.Sort((left, right) => string.CompareOrdinal(left.Key, right.Key));
        return entries;
    }

    private static void Add(List<ContentEntry> entries, string entity, Guid id, string field, string? text) =>
        Add(entries, entity, id.ToString(), field, text);

    private static void Add(List<ContentEntry> entries, string entity, string id, string field, string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        var key = ContentKey.For(entity, id, field);
        entries.Add(new ContentEntry(key, entity, id, field, text.Trim()));
    }
}
