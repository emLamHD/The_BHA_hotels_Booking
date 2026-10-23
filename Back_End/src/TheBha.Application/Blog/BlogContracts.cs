using System.Text.Json;
using TheBha.Application.Website;
using TheBha.Domain.Blog;

namespace TheBha.Application.Blog;

// ---- commands (the Staff actor always comes from the verified session, never from a body) ----

/// <summary>One whole draft. Everything may be unfinished; nothing may be malformed. <c>BodyJson</c> is the raw JSON text of the body.</summary>
public sealed record BlogDraftInput(
    string? Title,
    string? Slug,
    string? Summary,
    string? BodyJson,
    Guid? CoverMediaId,
    string? CoverAlt,
    string? AuthorName,
    string? MetaTitle,
    string? MetaDescription,
    Guid? OgImageMediaId,
    IReadOnlyList<Guid> CategoryIds,
    Guid? PrimaryCategoryId);

public sealed record CreateBlogPostCommand(Guid PostId, string Locale, BlogDraftInput Draft, Guid ActorStaffId);

/// <summary><c>ExpectedVersion</c> 0 creates the translation (the post must exist and have none in this locale); otherwise it must equal the current version.</summary>
public sealed record SaveBlogDraftCommand(Guid PostId, string Locale, int ExpectedVersion, BlogDraftInput Draft, Guid ActorStaffId);

public sealed record BlogTransitionCommand(Guid PostId, string Locale, int ExpectedVersion, Guid ActorStaffId);

public sealed record RestoreBlogRevisionCommand(Guid PostId, string Locale, Guid RevisionId, int ExpectedVersion, Guid ActorStaffId);

public sealed record BlogCategoryText(string Name, string Slug, string? Description);

public sealed record CreateBlogCategoryCommand(Guid CategoryId, int SortOrder, IReadOnlyDictionary<string, BlogCategoryText> Translations, Guid ActorStaffId);

public sealed record UpdateBlogCategoryCommand(Guid CategoryId, int ExpectedVersion, int SortOrder, IReadOnlyDictionary<string, BlogCategoryText> Translations, Guid ActorStaffId);

public sealed record DeleteBlogCategoryCommand(Guid CategoryId, int ExpectedVersion, Guid ActorStaffId);

public sealed record SetBlogPinsCommand(Guid CategoryId, int ExpectedVersion, IReadOnlyList<Guid> PostIds, Guid ActorStaffId);

public sealed record SetBlogSettingsCommand(int ExpectedVersion, Guid? HomeSectionCategoryId, Guid ActorStaffId);

public sealed record BlogPostListQuery(string? Search, Guid? CategoryId, string? Status, string? Locale, int Page, int PageSize);

// ---- Admin DTOs (never public: they name Staff members and carry drafts) ----

public sealed record BlogStaffDto(Guid Id, string? Email);

public sealed record BlogRevisionDto(
    Guid Id,
    int Number,
    string State,
    string Origin,
    Guid? RestoredFromRevisionId,
    string Title,
    string Slug,
    string Summary,
    JsonElement Body,
    Guid? CoverMediaId,
    string CoverAlt,
    string AuthorName,
    string MetaTitle,
    string MetaDescription,
    Guid? OgImageMediaId,
    IReadOnlyList<Guid> CategoryIds,
    Guid? PrimaryCategoryId,
    DateTimeOffset CreatedAtUtc,
    BlogStaffDto? CreatedBy,
    DateTimeOffset UpdatedAtUtc,
    BlogStaffDto? UpdatedBy,
    DateTimeOffset? PublishedAtUtc,
    BlogStaffDto? PublishedBy);

public sealed record BlogTranslationAdminDto(
    Guid TranslationId,
    string Locale,
    string Status,
    int Version,
    bool HasDraft,
    DateTimeOffset? FirstPublishedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    BlogStaffDto? UpdatedBy,
    BlogRevisionDto? Draft,
    BlogRevisionDto? Published);

public sealed record BlogPostAdminDto(Guid Id, DateTimeOffset CreatedAtUtc, IReadOnlyList<BlogTranslationAdminDto> Translations);

/// <summary><c>CoverMediaId</c> is the cover of the revision the row shows (the draft if there is one, else the published one), for the list thumbnail.</summary>
public sealed record BlogTranslationRowDto(
    string Locale, string Status, int Version, string Title, string Slug, bool HasDraft, DateTimeOffset UpdatedAtUtc, BlogStaffDto? UpdatedBy, Guid? CoverMediaId);

public sealed record BlogPostRowDto(Guid Id, DateTimeOffset UpdatedAtUtc, IReadOnlyList<BlogTranslationRowDto> Translations);

public sealed record BlogPostListDto(IReadOnlyList<BlogPostRowDto> Items, int Page, int PageSize, int Total);

public sealed record BlogRevisionSummaryDto(
    Guid Id, int Number, string State, string Origin, string Title, string Slug, DateTimeOffset CreatedAtUtc, BlogStaffDto? CreatedBy,
    DateTimeOffset? PublishedAtUtc, BlogStaffDto? PublishedBy, bool IsDraft, bool IsPublished);

public sealed record BlogCategoryAdminDto(
    Guid Id,
    string? SystemKey,
    int SortOrder,
    int Version,
    IReadOnlyDictionary<string, BlogCategoryText> Translations,
    int RevisionCount,
    int PinCount,
    bool IsHomeSection);

public sealed record BlogPinDto(Guid PostId, int Position, bool Effective, IReadOnlyDictionary<string, string> Titles);

public sealed record BlogPinsDto(Guid CategoryId, int Version, IReadOnlyList<BlogPinDto> Pins);

public sealed record BlogSettingsDto(Guid? HomeSectionCategoryId, int Version, DateTimeOffset UpdatedAtUtc);

public sealed record BlogMediaFile(Stream Content, string ContentType);

/// <summary>
/// BHA-BLOG-001-CP03: what the Staff-only preview shows — the translation's draft if it has one, else its published revision — in the shape of the public
/// article detail (same field names), with picture addresses that point at the Staff preview routes instead of the public ones. <c>Cover</c> may be
/// <c>null</c> because a draft does not need one yet. <c>Version</c> is the translation's version when it was read.
/// </summary>
public sealed record BlogPreviewDto(
    string Source,
    int RevisionNumber,
    string Status,
    int Version,
    Guid Id,
    string Locale,
    string Slug,
    string Title,
    string Summary,
    JsonElement Body,
    PublicBlogCoverDto? Cover,
    string Author,
    DateTimeOffset FirstPublishedAt,
    DateTimeOffset ModifiedAt,
    PublicBlogCategoryRefDto? PrimaryCategory,
    IReadOnlyList<PublicBlogCategoryRefDto> Categories,
    IReadOnlyDictionary<Guid, PublicBlogMediaRefDto> Media,
    IReadOnlyDictionary<Guid, PublicBlogPropertyRefDto> Properties,
    PublicBlogSeoDto Seo,
    IReadOnlyList<PublicBlogAlternateDto> Alternates);

// ---- Public DTOs: published content only; no Staff id, no revision, no audit, no draft ----

/// <summary>One published size of a picture (CP02): the same bytes for the same address, always, and only while a published article uses the picture.</summary>
public sealed record PublicBlogVariantDto(string Preset, string Format, string Type, string Url, int Width, int Height);

public sealed record PublicBlogCoverDto(string Url, string Alt, int Width, int Height, IReadOnlyList<PublicBlogVariantDto> Variants);

public sealed record PublicBlogCategoryRefDto(string Slug, string Name, bool IsPrimary);

public sealed record PublicBlogCategoryDto(string Slug, string Name, string? Description, int PostCount);

public sealed record PublicBlogPostItemDto(
    Guid Id,
    string Slug,
    string Title,
    string Summary,
    PublicBlogCoverDto Cover,
    string Author,
    DateTimeOffset FirstPublishedAt,
    DateTimeOffset ModifiedAt,
    PublicBlogCategoryRefDto? PrimaryCategory,
    IReadOnlyList<PublicBlogCategoryRefDto> Categories);

public sealed record PublicBlogPostListDto(string Locale, IReadOnlyList<PublicBlogPostItemDto> Items, int Page, int PageSize, int Total, string ContentHash);

public sealed record PublicBlogMediaRefDto(string Url, int Width, int Height, IReadOnlyList<PublicBlogVariantDto> Variants);

public sealed record PublicBlogPropertyRefDto(string Slug, string Name);

public sealed record PublicBlogSeoDto(string? MetaTitle, string? MetaDescription, string? OgImageUrl);

public sealed record PublicBlogAlternateDto(string Locale, string Slug);

public sealed record PublicBlogPostDto(
    Guid Id,
    string Locale,
    string Slug,
    string Title,
    string Summary,
    JsonElement Body,
    PublicBlogCoverDto Cover,
    string Author,
    DateTimeOffset FirstPublishedAt,
    DateTimeOffset ModifiedAt,
    PublicBlogCategoryRefDto? PrimaryCategory,
    IReadOnlyList<PublicBlogCategoryRefDto> Categories,
    IReadOnlyDictionary<Guid, PublicBlogMediaRefDto> Media,
    IReadOnlyDictionary<Guid, PublicBlogPropertyRefDto> Properties,
    PublicBlogSeoDto Seo,
    IReadOnlyList<PublicBlogAlternateDto> Alternates,
    string ContentHash);

/// <summary>The detail answer: the post, or the slug it now lives under (a 301), or nothing (a 404).</summary>
public sealed record PublicBlogPostLookup(PublicBlogPostDto? Post, string? RedirectSlug);

public sealed record PublicBlogCategoryLookup(PublicBlogCategoryDto? Category, string? RedirectSlug, string ContentHash);

public sealed record PublicBlogCategoryListDto(string Locale, IReadOnlyList<PublicBlogCategoryDto> Items, string ContentHash);

public sealed record PublicBlogHomeSectionDto(string Locale, PublicBlogCategoryDto? Category, IReadOnlyList<PublicBlogPostItemDto> Items, string ContentHash);

// ---- services ----

public interface IAdminBlog
{
    Task<BlogSettingsDto> GetSettingsAsync(CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogSettingsDto>> SetSettingsAsync(SetBlogSettingsCommand command, CancellationToken cancellationToken);

    Task<IReadOnlyList<BlogCategoryAdminDto>> ListCategoriesAsync(CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogCategoryAdminDto>> CreateCategoryAsync(CreateBlogCategoryCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogCategoryAdminDto>> UpdateCategoryAsync(UpdateBlogCategoryCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<bool>> DeleteCategoryAsync(DeleteBlogCategoryCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPinsDto>> GetPinsAsync(Guid categoryId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPinsDto>> SetPinsAsync(SetBlogPinsCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostListDto>> ListPostsAsync(BlogPostListQuery query, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> GetPostAsync(Guid postId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> CreatePostAsync(CreateBlogPostCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> SaveDraftAsync(SaveBlogDraftCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> PublishAsync(BlogTransitionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> UnpublishAsync(BlogTransitionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> ArchiveAsync(BlogTransitionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> UnarchiveAsync(BlogTransitionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<IReadOnlyList<BlogRevisionSummaryDto>>> ListRevisionsAsync(Guid postId, string locale, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogRevisionDto>> GetRevisionAsync(Guid postId, string locale, Guid revisionId, CancellationToken cancellationToken);

    /// <summary>The saved draft (or, with none, the published revision) of one translation as the public article would look, with Staff-only picture addresses.</summary>
    Task<WebsiteMutationResult<BlogPreviewDto>> GetPreviewAsync(Guid postId, string locale, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogPostAdminDto>> RestoreAsync(RestoreBlogRevisionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogMediaDto>> UploadMediaAsync(BlogMediaUpload upload, Guid actorStaffId, CancellationToken cancellationToken);

    /// <summary>Each file is taken in on its own: one that is refused or fails does not undo the others. Count and size limits are the caller's, checked before this is called.</summary>
    Task<BlogMediaBatchDto> UploadMediaBatchAsync(IReadOnlyList<BlogMediaUpload> uploads, Guid actorStaffId, CancellationToken cancellationToken);

    Task<BlogMediaListDto> ListMediaAsync(BlogMediaListQuery query, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogMediaDto>> GetMediaAsync(Guid mediaId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogMediaDto>> UpdateMediaAsync(UpdateBlogMediaCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BlogMediaUsageDto>> GetMediaUsageAsync(Guid mediaId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<bool>> DeleteMediaAsync(DeleteBlogMediaCommand command, CancellationToken cancellationToken);

    /// <summary>The original bytes, private to the Admin.</summary>
    Task<BlogMediaFile?> OpenMediaAsync(Guid mediaId, CancellationToken cancellationToken);

    /// <summary>A preset's WebP (or the original, for a picture the pipeline has not processed yet).</summary>
    Task<BlogMediaFile?> OpenMediaPreviewAsync(Guid mediaId, string preset, CancellationToken cancellationToken);
}

/// <summary>The public, read-only side. Every method answers for one language and never falls back to another.</summary>
public interface IWebsiteBlog
{
    /// <summary><c>null</c> locale = the default language. Returns the normalized active language, or <c>null</c> when it is not an active one.</summary>
    Task<string?> ResolveLocaleAsync(string? locale, CancellationToken cancellationToken);

    /// <summary><c>null</c> when <paramref name="categorySlug"/> is given but names no category of this language (current or old).</summary>
    Task<PublicBlogPostListDto?> ListPostsAsync(string locale, string? categorySlug, int page, int pageSize, CancellationToken cancellationToken);

    Task<PublicBlogPostLookup> GetPostAsync(string locale, string slug, CancellationToken cancellationToken);

    Task<PublicBlogCategoryListDto> ListCategoriesAsync(string locale, CancellationToken cancellationToken);

    Task<PublicBlogCategoryLookup> GetCategoryAsync(string locale, string slug, CancellationToken cancellationToken);

    Task<PublicBlogHomeSectionDto> HomeSectionAsync(string locale, int limit, CancellationToken cancellationToken);

    /// <summary>The legacy address: the article-size fallback of a processed picture, the original of an older one. Only while a published article uses it.</summary>
    Task<BlogMediaFile?> OpenMediaAsync(Guid mediaId, CancellationToken cancellationToken);

    /// <summary>One variant at its exact address (picture, generation, preset, format). Only while a published article uses the picture.</summary>
    Task<BlogMediaFile?> OpenMediaVariantAsync(Guid mediaId, int generation, string preset, string format, CancellationToken cancellationToken);
}

public static class BlogResults
{
    /// <summary>A <see cref="BlogProblem"/> as the website result every Admin route already answers with (400 / 404 / 409).</summary>
    public static WebsiteMutationResult<T> From<T>(BlogProblem problem) => problem.Code switch
    {
        BlogErrorCodes.NotFound => WebsiteMutationResult<T>.NotFound(problem.Message),
        BlogErrorCodes.StaleVersion or BlogErrorCodes.SlugTaken or BlogErrorCodes.CategoryInUse or BlogErrorCodes.Archived or
            BlogErrorCodes.InvalidState or BlogErrorCodes.DuplicateId or BlogErrorCodes.NothingToPublish or BlogErrorCodes.StorageNotConfigured or
            BlogErrorCodes.PinNotPublished or BlogErrorCodes.MediaInUse => WebsiteMutationResult<T>.Conflict(problem.Code, problem.Message, problem.Field),
        _ => WebsiteMutationResult<T>.Invalid(problem.Field, problem.Message) with { Code = problem.Code }
    };
}
