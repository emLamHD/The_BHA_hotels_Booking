using Microsoft.EntityFrameworkCore;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;

namespace TheBha.Infrastructure.Persistence;

internal sealed partial class AdminBlogService
{
    private const string AdminMediaPath = "/api/admin/v1/website/blog/media/";

    /// <summary>
    /// The saved draft of one translation (or, with none, its published revision) in the public article shape. Nothing is written and nothing is made public:
    /// the pictures are addressed through the Staff preview routes, which need a session and are <c>no-store</c>.
    /// </summary>
    public async Task<WebsiteMutationResult<BlogPreviewDto>> GetPreviewAsync(Guid postId, string locale, CancellationToken cancellationToken)
    {
        var (normalized, problem) = await LocaleAsync(locale, "locale", cancellationToken);
        if (normalized is null)
        {
            return Fail<BlogPreviewDto>(problem!);
        }

        var translation = await db.BlogPostTranslations.AsNoTracking().SingleOrDefaultAsync(t => t.PostId == postId && t.Locale == normalized, cancellationToken);
        if (translation is null)
        {
            return Fail<BlogPreviewDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The article has no such translation."));
        }

        // The saved draft if there is one, else the revision that was published. A translation with neither (no route of the API leaves one so, but the
        // schema allows it) has nothing to show: a controlled "not found", never another revision picked on the editor's behalf.
        var isDraft = translation.DraftRevisionId is not null;
        var chosen = translation.DraftRevisionId ?? translation.PublishedRevisionId;
        if (chosen is not { } revisionId)
        {
            // `BlogResults.From` (shared by every Blog route) answers a NotFound with the message only; this one case also names itself, so the Admin can tell
            // "the translation has nothing to show" from "no such post or translation" without comparing words.
            return WebsiteMutationResult<BlogPreviewDto>.NotFound("The translation has no revision to preview.") with { Code = BlogErrorCodes.NotFound, Field = "revision" };
        }

        var revision = await db.BlogPostRevisions.AsNoTracking().Include(r => r.Categories).SingleAsync(r => r.Id == revisionId, cancellationToken);
        var media = await (from rm in db.BlogRevisionMedia.AsNoTracking()
                           where rm.RevisionId == revision.Id
                           join m in db.BlogMedia.AsNoTracking().Include(file => file.Variants) on rm.MediaId equals m.Id
                           select m).ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = (await BlogPublicShape.CategoryRefsAsync(db, normalized, [revision.Id], cancellationToken)).GetValueOrDefault(revision.Id) ?? [];
        var (body, properties) = await BlogPublicShape.BodyAsync(db, revision.BodyJson, cancellationToken);
        var alternates = await (from t in db.BlogPostTranslations.AsNoTracking()
                                where t.PostId == postId && t.Locale != normalized && t.Status == BlogTranslationStatus.Published
                                join r in db.BlogPostRevisions.AsNoTracking() on t.PublishedRevisionId equals r.Id
                                join l in db.WebsiteLanguages.AsNoTracking() on t.Locale equals l.NormalizedCode
                                where l.IsActive
                                orderby t.Locale
                                select new PublicBlogAlternateDto(t.Locale, r.Slug)).ToListAsync(cancellationToken);

        PublicBlogCoverDto? cover = revision.CoverMediaId is { } coverId && media.TryGetValue(coverId, out var coverFile)
            ? new PublicBlogCoverDto(PreviewUrl(coverFile, BlogMediaPresets.Article), revision.CoverAlt, PreviewSize(coverFile).Width, PreviewSize(coverFile).Height, PreviewVariants(coverFile))
            : null;
        return WebsiteMutationResult<BlogPreviewDto>.Success(new BlogPreviewDto(
            isDraft ? "draft" : "published",
            revision.Number,
            translation.Status.ToString(),
            translation.Version,
            postId,
            normalized,
            revision.Slug,
            revision.Title,
            revision.Summary,
            body,
            cover,
            revision.AuthorName,
            translation.FirstPublishedAtUtc ?? revision.CreatedAtUtc,
            revision.PublishedAtUtc ?? revision.UpdatedAtUtc,
            categories.FirstOrDefault(c => c.IsPrimary),
            categories,
            media.Values.ToDictionary(m => m.Id, m => new PublicBlogMediaRefDto(PreviewUrl(m, BlogMediaPresets.Article), PreviewSize(m).Width, PreviewSize(m).Height, PreviewVariants(m))),
            properties,
            new PublicBlogSeoDto(
                revision.MetaTitle.Length > 0 ? revision.MetaTitle : null,
                revision.MetaDescription.Length > 0 ? revision.MetaDescription : null,
                revision.OgImageMediaId is { } og ? $"{AdminMediaPath}{og}/preview/{BlogMediaPresets.Article}" : null),
            alternates));
    }

    /// <summary>The Staff route for one size of a picture; a picture the pipeline has not processed is served by the preview route as its original.</summary>
    private static string PreviewUrl(BlogMedia file, string preset) => $"{AdminMediaPath}{file.Id}/preview/{preset}";

    private static (int Width, int Height) PreviewSize(BlogMedia file) =>
        file.Variants.FirstOrDefault(v => v.Preset == BlogMediaPresets.Article && v.Format == BlogMediaFormats.Webp) is { } article ? (article.Width, article.Height) : (file.Width, file.Height);

    /// <summary>The preview route serves each preset as WebP only, so that is the one format listed (smallest first).</summary>
    private static List<PublicBlogVariantDto> PreviewVariants(BlogMedia file) =>
        [.. file.Variants
            .Where(v => v.Format == BlogMediaFormats.Webp)
            .OrderBy(v => BlogMediaPresets.All.Select(preset => preset.Name).ToList().IndexOf(v.Preset))
            .Select(v => new PublicBlogVariantDto(v.Preset, v.Format, v.ContentType, PreviewUrl(file, v.Preset), v.Width, v.Height))];
}
