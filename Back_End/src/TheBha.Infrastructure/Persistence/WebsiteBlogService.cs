using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-BLOG-001-CP01: the public, read-only Blog. One rule decides what is public: a translation whose status is <c>Published</c>, read through
/// its <em>published revision</em> — never the draft. Everything (text, slug, categories, media, dates) comes from that one revision, so a
/// reader can never see half of an edit. Language is strict: no fallback to another language, ever.
/// </summary>
internal sealed class WebsiteBlogService(TheBhaDbContext db, IHeroMediaStorage storage) : IWebsiteBlog
{
    private const string MediaPath = "/api/v1/website/blog/media/";

    private sealed class Pub
    {
        public required BlogPostTranslation Translation { get; init; }
        public required BlogPostRevision Revision { get; init; }
    }

    public async Task<string?> ResolveLocaleAsync(string? locale, CancellationToken cancellationToken)
    {
        var active = await db.WebsiteLanguages.AsNoTracking().Where(language => language.IsActive).Select(language => new { language.NormalizedCode, language.IsDefault }).ToListAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(locale))
        {
            return active.FirstOrDefault(language => language.IsDefault)?.NormalizedCode;
        }

        return LanguageTag.TryNormalize(locale, out _, out var normalized) && active.Any(language => language.NormalizedCode == normalized) ? normalized : null;
    }

    private IQueryable<Pub> Published(string locale) =>
        from t in db.BlogPostTranslations.AsNoTracking()
        where t.Locale == locale && t.Status == BlogTranslationStatus.Published
        join r in db.BlogPostRevisions.AsNoTracking() on t.PublishedRevisionId equals r.Id
        select new Pub { Translation = t, Revision = r };

    private static string Revision(object body) =>
        SourceText.Hash(JsonSerializer.Serialize(body, new JsonSerializerOptions(JsonSerializerDefaults.Web)));

    // ---- lists ----

    public async Task<PublicBlogPostListDto?> ListPostsAsync(string locale, string? categorySlug, int page, int pageSize, CancellationToken cancellationToken)
    {
        Guid? categoryId = null;
        if (!string.IsNullOrWhiteSpace(categorySlug))
        {
            categoryId = await db.BlogCategorySlugs.AsNoTracking()
                .Where(claim => claim.Locale == locale && claim.Slug == categorySlug)
                .Select(claim => (Guid?)claim.CategoryId).SingleOrDefaultAsync(cancellationToken);
            if (categoryId is null)
            {
                return null;
            }
        }

        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, BlogLimits.MaxPageSize);
        var rows = await QueryAsync(locale, categoryId, (page - 1) * pageSize, pageSize, cancellationToken);
        var body = new PublicBlogPostListDto(locale, rows.Items, page, pageSize, rows.Total, string.Empty);
        return body with { ContentHash = Revision(body with { ContentHash = string.Empty }) };
    }

    /// <summary>
    /// One page of published posts: with a category, pinned first (by position) then newest first; without, newest first. Always ended by the
    /// translation id, so the order is total and a post is never repeated or skipped across pages.
    /// </summary>
    private async Task<(IReadOnlyList<PublicBlogPostItemDto> Items, int Total)> QueryAsync(
        string locale, Guid? categoryId, int skip, int take, CancellationToken cancellationToken)
    {
        var query = Published(locale);
        if (categoryId is { } category)
        {
            query = query.Where(p => db.BlogRevisionCategories.Any(rc => rc.RevisionId == p.Revision.Id && rc.CategoryId == category));
        }

        var total = await query.CountAsync(cancellationToken);
        var ordered = categoryId is { } pinCategory
            ? query
                .Select(p => new { p, Pin = db.BlogCategoryPins.Where(pin => pin.CategoryId == pinCategory && pin.PostId == p.Translation.PostId).Select(pin => (int?)pin.Position).FirstOrDefault() })
                .OrderBy(x => x.Pin == null).ThenBy(x => x.Pin)
                .ThenByDescending(x => x.p.Translation.FirstPublishedAtUtc).ThenByDescending(x => x.p.Translation.Id)
                .Select(x => x.p)
            : query.OrderByDescending(p => p.Translation.FirstPublishedAtUtc).ThenByDescending(p => p.Translation.Id);
        var page = await ordered.Skip(skip).Take(take).ToListAsync(cancellationToken);
        return (await ToItemsAsync(locale, page, cancellationToken), total);
    }

    private async Task<IReadOnlyList<PublicBlogPostItemDto>> ToItemsAsync(string locale, List<Pub> page, CancellationToken cancellationToken)
    {
        var revisionIds = page.Select(p => p.Revision.Id).ToList();
        var mediaIds = page.Where(p => p.Revision.CoverMediaId != null).Select(p => p.Revision.CoverMediaId!.Value).Distinct().ToList();
        var media = await db.BlogMedia.AsNoTracking().Include(m => m.Variants).Where(m => mediaIds.Contains(m.Id)).ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await CategoryRefsAsync(locale, revisionIds, cancellationToken);
        return page.Select(p => ToItem(p, media, categories.GetValueOrDefault(p.Revision.Id) ?? [])).ToList();
    }

    private async Task<Dictionary<Guid, List<PublicBlogCategoryRefDto>>> CategoryRefsAsync(string locale, List<Guid> revisionIds, CancellationToken cancellationToken)
    {
        var rows = await (from rc in db.BlogRevisionCategories.AsNoTracking()
                          where revisionIds.Contains(rc.RevisionId)
                          join ct in db.BlogCategoryTranslations.AsNoTracking() on new { rc.CategoryId, Locale = locale } equals new { ct.CategoryId, ct.Locale }
                          join c in db.BlogCategories.AsNoTracking() on rc.CategoryId equals c.Id
                          orderby c.SortOrder, c.Id
                          select new { rc.RevisionId, ct.Slug, ct.Name, rc.IsPrimary }).ToListAsync(cancellationToken);
        return rows.GroupBy(r => r.RevisionId).ToDictionary(g => g.Key, g => g.Select(r => new PublicBlogCategoryRefDto(r.Slug, r.Name, r.IsPrimary)).ToList());
    }

    private static PublicBlogPostItemDto ToItem(Pub p, Dictionary<Guid, BlogMedia> media, List<PublicBlogCategoryRefDto> categories) =>
        new(
            p.Translation.PostId, p.Revision.Slug, p.Revision.Title, p.Revision.Summary, Cover(p.Revision, media), p.Revision.AuthorName,
            p.Translation.FirstPublishedAtUtc!.Value, p.Revision.PublishedAtUtc!.Value,
            categories.FirstOrDefault(c => c.IsPrimary), categories);

    private static PublicBlogCoverDto Cover(BlogPostRevision revision, Dictionary<Guid, BlogMedia> media)
    {
        var file = media[revision.CoverMediaId!.Value];
        var (width, height) = MainSize(file);
        return new PublicBlogCoverDto(MediaPath + file.Id, revision.CoverAlt, width, height, Variants(file));
    }

    /// <summary>The size of what the plain picture address serves: the article-size fallback of a processed picture, the original of an older one.</summary>
    private static (int Width, int Height) MainSize(BlogMedia file) =>
        ArticleFallback(file) is { } variant ? (variant.Width, variant.Height) : (file.Width, file.Height);

    private static BlogMediaVariant? ArticleFallback(BlogMedia file) =>
        file.Variants.FirstOrDefault(v => v.Preset == BlogMediaPresets.Article && BlogMediaFormats.IsFallback(v.Format));

    /// <summary>The published sizes, smallest preset first and WebP before the fallback; each address names the generation, so the bytes under it never change.</summary>
    private static List<PublicBlogVariantDto> Variants(BlogMedia file) =>
        [.. file.Variants
            .OrderBy(v => BlogMediaPresets.All.Select(preset => preset.Name).ToList().IndexOf(v.Preset))
            .ThenBy(v => v.Format == BlogMediaFormats.Webp ? 0 : 1)
            .Select(v => new PublicBlogVariantDto(v.Preset, v.Format, v.ContentType, $"{MediaPath}{file.Id}/{file.Generation}/{v.Preset}.{v.Format}", v.Width, v.Height))];

    // ---- detail ----

    public async Task<PublicBlogPostLookup> GetPostAsync(string locale, string slug, CancellationToken cancellationToken)
    {
        var claim = await db.BlogPostSlugs.AsNoTracking().SingleOrDefaultAsync(c => c.Locale == locale && c.Slug == slug, cancellationToken);
        if (claim is null || claim.State == BlogSlugState.Draft)
        {
            return new PublicBlogPostLookup(null, null);
        }

        var pub = await Published(locale).SingleOrDefaultAsync(p => p.Translation.Id == claim.TranslationId, cancellationToken);
        if (pub is null)
        {
            return new PublicBlogPostLookup(null, null);
        }

        // An old address always answers with the translation's current one (resolved here, once): no chains, no loops.
        if (claim.State == BlogSlugState.Redirect)
        {
            return new PublicBlogPostLookup(null, pub.Revision.Slug);
        }

        var media = await (from rm in db.BlogRevisionMedia.AsNoTracking()
                           where rm.RevisionId == pub.Revision.Id
                           join m in db.BlogMedia.AsNoTracking().Include(media => media.Variants) on rm.MediaId equals m.Id
                           select m).ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = (await CategoryRefsAsync(locale, [pub.Revision.Id], cancellationToken)).GetValueOrDefault(pub.Revision.Id) ?? [];
        var (body, properties) = await PublicBodyAsync(pub.Revision.BodyJson, cancellationToken);
        var alternates = await (from t in db.BlogPostTranslations.AsNoTracking()
                                where t.PostId == pub.Translation.PostId && t.Locale != locale && t.Status == BlogTranslationStatus.Published
                                join r in db.BlogPostRevisions.AsNoTracking() on t.PublishedRevisionId equals r.Id
                                join l in db.WebsiteLanguages.AsNoTracking() on t.Locale equals l.NormalizedCode
                                where l.IsActive
                                orderby t.Locale
                                select new PublicBlogAlternateDto(t.Locale, r.Slug)).ToListAsync(cancellationToken);

        var revision = pub.Revision;
        var dto = new PublicBlogPostDto(
            pub.Translation.PostId, locale, revision.Slug, revision.Title, revision.Summary, body, Cover(revision, media), revision.AuthorName,
            pub.Translation.FirstPublishedAtUtc!.Value, revision.PublishedAtUtc!.Value,
            categories.FirstOrDefault(c => c.IsPrimary), categories,
            media.Values.ToDictionary(m => m.Id, m => new PublicBlogMediaRefDto(MediaPath + m.Id, MainSize(m).Width, MainSize(m).Height, Variants(m))),
            properties,
            new PublicBlogSeoDto(
                revision.MetaTitle.Length > 0 ? revision.MetaTitle : null,
                revision.MetaDescription.Length > 0 ? revision.MetaDescription : null,
                revision.OgImageMediaId is { } og ? MediaPath + og : null),
            alternates, string.Empty);
        return new PublicBlogPostLookup(dto with { ContentHash = Revision(dto with { ContentHash = string.Empty }) }, null);
    }

    /// <summary>The stored body as a JSON value, minus any <c>propertyIntro</c> whose Property is not active now, plus the Properties it still names.</summary>
    private async Task<(JsonElement Body, IReadOnlyDictionary<Guid, PublicBlogPropertyRefDto> Properties)> PublicBodyAsync(string bodyJson, CancellationToken cancellationToken)
    {
        var ids = BlogBody.Validate(bodyJson).Info?.PropertyIds.ToList() ?? [];
        var active = ids.Count == 0
            ? []
            : await db.Properties.AsNoTracking().Where(p => ids.Contains(p.Id) && p.IsActive).ToDictionaryAsync(p => p.Id, p => new PublicBlogPropertyRefDto(p.Slug, p.Name), cancellationToken);
        if (ids.Count == active.Count)
        {
            return (JsonDocument.Parse(bodyJson).RootElement.Clone(), active);
        }

        var root = JsonNode.Parse(bodyJson)!.AsObject();
        var blocks = root["blocks"]!.AsArray();
        foreach (var block in blocks.ToList())
        {
            if (block!["type"]!.GetValue<string>() == "propertyIntro" && !active.ContainsKey(block["propertyId"]!.GetValue<Guid>()))
            {
                blocks.Remove(block);
            }
        }

        return (JsonDocument.Parse(root.ToJsonString()).RootElement.Clone(), active);
    }

    // ---- categories ----

    private async Task<Dictionary<Guid, int>> CountsAsync(string locale, CancellationToken cancellationToken) =>
        await (from p in Published(locale)
               join rc in db.BlogRevisionCategories.AsNoTracking() on p.Revision.Id equals rc.RevisionId
               group rc by rc.CategoryId into g
               select new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, cancellationToken);

    public async Task<PublicBlogCategoryListDto> ListCategoriesAsync(string locale, CancellationToken cancellationToken)
    {
        var counts = await CountsAsync(locale, cancellationToken);
        var ids = counts.Keys.ToList();
        var items = await (from ct in db.BlogCategoryTranslations.AsNoTracking()
                           where ct.Locale == locale && ids.Contains(ct.CategoryId)
                           join c in db.BlogCategories.AsNoTracking() on ct.CategoryId equals c.Id
                           orderby c.SortOrder, c.Id
                           select new { ct, c.Id }).ToListAsync(cancellationToken);
        var list = items.Select(x => new PublicBlogCategoryDto(x.ct.Slug, x.ct.Name, x.ct.Description, counts[x.Id])).ToList();
        var body = new PublicBlogCategoryListDto(locale, list, string.Empty);
        return body with { ContentHash = Revision(body with { ContentHash = string.Empty }) };
    }

    public async Task<PublicBlogCategoryLookup> GetCategoryAsync(string locale, string slug, CancellationToken cancellationToken)
    {
        var claim = await db.BlogCategorySlugs.AsNoTracking().SingleOrDefaultAsync(c => c.Locale == locale && c.Slug == slug, cancellationToken);
        if (claim is null)
        {
            return new PublicBlogCategoryLookup(null, null, string.Empty);
        }

        var text = await db.BlogCategoryTranslations.AsNoTracking().SingleAsync(t => t.CategoryId == claim.CategoryId && t.Locale == locale, cancellationToken);
        if (!claim.IsCurrent)
        {
            return new PublicBlogCategoryLookup(null, text.Slug, string.Empty);
        }

        var count = (await CountsAsync(locale, cancellationToken)).GetValueOrDefault(claim.CategoryId);
        var category = new PublicBlogCategoryDto(text.Slug, text.Name, text.Description, count);
        return new PublicBlogCategoryLookup(category, null, Revision(category));
    }

    public async Task<PublicBlogHomeSectionDto> HomeSectionAsync(string locale, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, BlogLimits.HomeSectionMax);
        var categoryId = (await db.BlogSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken))?.HomeSectionCategoryId;
        var text = categoryId is { } id
            ? await db.BlogCategoryTranslations.AsNoTracking().SingleOrDefaultAsync(t => t.CategoryId == id && t.Locale == locale, cancellationToken)
            : null;
        PublicBlogHomeSectionDto body;
        if (categoryId is null || text is null)
        {
            body = new PublicBlogHomeSectionDto(locale, null, [], string.Empty);
        }
        else
        {
            var (items, total) = await QueryAsync(locale, categoryId, 0, limit, cancellationToken);
            body = new PublicBlogHomeSectionDto(locale, new PublicBlogCategoryDto(text.Slug, text.Name, text.Description, total), items, string.Empty);
        }

        return body with { ContentHash = Revision(body with { ContentHash = string.Empty }) };
    }

    // ---- media ----

    /// <summary>A picture is public only while a published revision of a published translation uses it. Decided on every request, before any byte, redirect or 304.</summary>
    private Task<bool> IsPublicAsync(Guid mediaId, CancellationToken cancellationToken) =>
        (from rm in db.BlogRevisionMedia.AsNoTracking()
         where rm.MediaId == mediaId
         join t in db.BlogPostTranslations.AsNoTracking() on rm.RevisionId equals t.PublishedRevisionId
         where t.Status == BlogTranslationStatus.Published
         select rm.MediaId).AnyAsync(cancellationToken);

    public async Task<BlogMediaFile?> OpenMediaAsync(Guid mediaId, CancellationToken cancellationToken)
    {
        if (!await IsPublicAsync(mediaId, cancellationToken))
        {
            return null;
        }

        var row = await db.BlogMedia.AsNoTracking().Include(m => m.Variants).SingleAsync(m => m.Id == mediaId, cancellationToken);

        // A processed picture is never served as its original (private, and it may carry EXIF); a picture from before CP02 is, until the operator backfill has run.
        var fallback = ArticleFallback(row);
        var stream = await storage.OpenReadAsync(fallback?.StorageKey ?? row.StorageKey, cancellationToken);
        return stream is null ? null : new BlogMediaFile(stream, fallback?.ContentType ?? row.ContentType);
    }

    public async Task<BlogMediaFile?> OpenMediaVariantAsync(Guid mediaId, int generation, string preset, string format, CancellationToken cancellationToken)
    {
        if (!BlogMediaPresets.IsKnown(preset) || !BlogMediaFormats.IsKnown(format) || !await IsPublicAsync(mediaId, cancellationToken))
        {
            return null;
        }

        var row = await db.BlogMedia.AsNoTracking().Include(m => m.Variants).SingleAsync(m => m.Id == mediaId, cancellationToken);
        if (row.Generation != generation || row.Variants.FirstOrDefault(v => v.Preset == preset && v.Format == format) is not { } variant)
        {
            return null;
        }

        var stream = await storage.OpenReadAsync(variant.StorageKey, cancellationToken);
        return stream is null ? null : new BlogMediaFile(stream, variant.ContentType);
    }
}
