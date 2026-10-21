using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// BHA-BLOG-001-CP01 / ADR 0010: the Admin side of the Blog, site-wide (not per Property). Each action names the global Staff permission it needs:
/// <see cref="StaffGlobalPermission.BlogAccess"/> (edit or publish) to read and upload, <see cref="StaffGlobalPermission.BlogEdit"/> to write drafts
/// and restore a revision to a draft, <see cref="StaffGlobalPermission.BlogPublish"/> to publish, unpublish, archive and to structure the Blog
/// (categories, pins, settings). Same access shape as the other website routes: HTTPS, Staff session (401), permission read from the database now
/// (403), Origin and a JSON body on a write, <c>Cache-Control: no-store</c>, closed (404) in LocalGate. Every write is a POST. A stale
/// <c>expectedVersion</c> is a 409 <c>blog.stale-version</c>; a refusal is a 400/404/409 with <c>code</c> and <c>field</c>, never a 500.
/// </summary>
[Route("api/admin/v1/website/blog")]
public sealed class AdminBlogController(IAdminBlog blog) : AdminWebsiteControllerBase
{
    private const int UploadLimit = HeroLimits.MaxUploadBytes + 1024 * 1024;

    // ---- settings ----

    [HttpGet("settings")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult<BlogSettingsDto>> GetSettings(CancellationToken cancellationToken) => Ok(await blog.GetSettingsAsync(cancellationToken));

    [HttpPost("settings/save")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> SaveSettings([FromBody] SaveBlogSettingsRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.SetSettingsAsync(new SetBlogSettingsCommand(request.ExpectedVersion, request.HomeSectionCategoryId, ActorStaffId), cancellationToken), saved => Ok(saved));

    // ---- categories ----

    [HttpGet("categories")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult<IReadOnlyList<BlogCategoryAdminDto>>> Categories(CancellationToken cancellationToken) => Ok(await blog.ListCategoriesAsync(cancellationToken));

    [HttpPost("categories")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> CreateCategory([FromBody] CreateBlogCategoryRequest request, CancellationToken cancellationToken) =>
        Respond(
            await blog.CreateCategoryAsync(new CreateBlogCategoryCommand(request.Id, request.SortOrder, request.Translations ?? new Dictionary<string, BlogCategoryText>(), ActorStaffId), cancellationToken),
            created => Ok(created));

    [HttpPost("categories/{categoryId:guid}/save")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> UpdateCategory(Guid categoryId, [FromBody] UpdateBlogCategoryRequest request, CancellationToken cancellationToken) =>
        Respond(
            await blog.UpdateCategoryAsync(
                new UpdateBlogCategoryCommand(categoryId, request.ExpectedVersion, request.SortOrder, request.Translations ?? new Dictionary<string, BlogCategoryText>(), ActorStaffId), cancellationToken),
            saved => Ok(saved));

    [HttpPost("categories/{categoryId:guid}/delete")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> DeleteCategory(Guid categoryId, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.DeleteCategoryAsync(new DeleteBlogCategoryCommand(categoryId, request.ExpectedVersion, ActorStaffId), cancellationToken), _ => NoContent());

    [HttpGet("categories/{categoryId:guid}/pins")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> Pins(Guid categoryId, CancellationToken cancellationToken) => Respond(await blog.GetPinsAsync(categoryId, cancellationToken), pins => Ok(pins));

    [HttpPost("categories/{categoryId:guid}/pins/save")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> SavePins(Guid categoryId, [FromBody] SaveBlogPinsRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.SetPinsAsync(new SetBlogPinsCommand(categoryId, request.ExpectedVersion, request.PostIds ?? [], ActorStaffId), cancellationToken), pins => Ok(pins));

    // ---- posts ----

    [HttpGet("posts")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> Posts(
        [FromQuery] string? q, [FromQuery] Guid? categoryId, [FromQuery] string? status, [FromQuery] string? locale,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken cancellationToken = default) =>
        Respond(await blog.ListPostsAsync(new BlogPostListQuery(q, categoryId, status, locale, page, pageSize), cancellationToken), list => Ok(list));

    [HttpGet("posts/{postId:guid}")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> Post(Guid postId, CancellationToken cancellationToken) => Respond(await blog.GetPostAsync(postId, cancellationToken), post => Ok(post));

    [HttpPost("posts")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogEdit)]
    public async Task<ActionResult> CreatePost([FromBody] CreateBlogPostRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.CreatePostAsync(new CreateBlogPostCommand(request.Id, request.Locale, request.Draft.ToInput(), ActorStaffId), cancellationToken), post => Ok(post));

    [HttpPost("posts/{postId:guid}/translations/{locale}/draft")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogEdit)]
    public async Task<ActionResult> SaveDraft(Guid postId, string locale, [FromBody] SaveBlogDraftRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.SaveDraftAsync(new SaveBlogDraftCommand(postId, locale, request.ExpectedVersion, request.Draft.ToInput(), ActorStaffId), cancellationToken), post => Ok(post));

    [HttpPost("posts/{postId:guid}/translations/{locale}/publish")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> Publish(Guid postId, string locale, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.PublishAsync(new BlogTransitionCommand(postId, locale, request.ExpectedVersion, ActorStaffId), cancellationToken), post => Ok(post));

    [HttpPost("posts/{postId:guid}/translations/{locale}/unpublish")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> Unpublish(Guid postId, string locale, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.UnpublishAsync(new BlogTransitionCommand(postId, locale, request.ExpectedVersion, ActorStaffId), cancellationToken), post => Ok(post));

    [HttpPost("posts/{postId:guid}/translations/{locale}/archive")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> Archive(Guid postId, string locale, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.ArchiveAsync(new BlogTransitionCommand(postId, locale, request.ExpectedVersion, ActorStaffId), cancellationToken), post => Ok(post));

    [HttpPost("posts/{postId:guid}/translations/{locale}/unarchive")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> Unarchive(Guid postId, string locale, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.UnarchiveAsync(new BlogTransitionCommand(postId, locale, request.ExpectedVersion, ActorStaffId), cancellationToken), post => Ok(post));

    [HttpGet("posts/{postId:guid}/translations/{locale}/revisions")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> Revisions(Guid postId, string locale, CancellationToken cancellationToken) =>
        Respond(await blog.ListRevisionsAsync(postId, locale, cancellationToken), list => Ok(list));

    [HttpGet("posts/{postId:guid}/translations/{locale}/revisions/{revisionId:guid}")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> Revision(Guid postId, string locale, Guid revisionId, CancellationToken cancellationToken) =>
        Respond(await blog.GetRevisionAsync(postId, locale, revisionId, cancellationToken), revision => Ok(revision));

    [HttpPost("posts/{postId:guid}/translations/{locale}/revisions/{revisionId:guid}/restore")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogEdit)]
    public async Task<ActionResult> Restore(Guid postId, string locale, Guid revisionId, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.RestoreAsync(new RestoreBlogRevisionCommand(postId, locale, revisionId, request.ExpectedVersion, ActorStaffId), cancellationToken), post => Ok(post));

    // ---- pictures ----

    /// <summary>One picture as a <c>multipart/form-data</c> part named <c>file</c>. The bytes decide the type; the name and the client's media type are ignored.</summary>
    [HttpPost("media")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    [AllowStaffMultipartUpload]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit, ValueCountLimit = 4)]
    public async Task<ActionResult> Upload(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return Respond(WebsiteMutationResult<BlogMediaDto>.Invalid("file", "Choose a picture to upload.") with { Code = HeroErrorCodes.ImageEmpty }, media => Ok(media));
        }

        await using var content = file.OpenReadStream();
        return Respond(await blog.UploadMediaAsync(content, ActorStaffId, cancellationToken), media => Ok(media));
    }

    /// <summary>The bytes of any recorded picture, published or not, for the editor's thumbnails; the public route serves only what a visitor may see.</summary>
    [HttpGet("media/{id:guid}")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<IActionResult> Media(Guid id, CancellationToken cancellationToken)
    {
        var file = await blog.OpenMediaAsync(id, cancellationToken);
        if (file is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "private, max-age=3600";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }
}

public sealed record VersionRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
}

public sealed record SaveBlogSettingsRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    public Guid? HomeSectionCategoryId { get; init; }
}

public sealed record CreateBlogCategoryRequest
{
    [JsonRequired] public Guid Id { get; init; }
    public int SortOrder { get; init; }
    [JsonRequired] public Dictionary<string, BlogCategoryText>? Translations { get; init; }
}

public sealed record UpdateBlogCategoryRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    public int SortOrder { get; init; }
    [JsonRequired] public Dictionary<string, BlogCategoryText>? Translations { get; init; }
}

public sealed record SaveBlogPinsRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public List<Guid>? PostIds { get; init; }
}

/// <summary>A whole draft. <c>Body</c> is the structured body object (design §3); everything may be missing or unfinished.</summary>
public sealed record BlogDraftRequest
{
    public string? Title { get; init; }
    public string? Slug { get; init; }
    public string? Summary { get; init; }
    public JsonElement? Body { get; init; }
    public Guid? CoverMediaId { get; init; }
    public string? CoverAlt { get; init; }
    public string? AuthorName { get; init; }
    public string? MetaTitle { get; init; }
    public string? MetaDescription { get; init; }
    public Guid? OgImageMediaId { get; init; }
    public List<Guid>? CategoryIds { get; init; }
    public Guid? PrimaryCategoryId { get; init; }

    public BlogDraftInput ToInput() => new(
        Title, Slug, Summary, Body is { ValueKind: not (JsonValueKind.Undefined or JsonValueKind.Null) } body ? body.GetRawText() : null,
        CoverMediaId, CoverAlt, AuthorName, MetaTitle, MetaDescription, OgImageMediaId, CategoryIds ?? [], PrimaryCategoryId);
}

public sealed record CreateBlogPostRequest
{
    [JsonRequired] public Guid Id { get; init; }
    [JsonRequired] public string Locale { get; init; } = string.Empty;
    [JsonRequired] public BlogDraftRequest Draft { get; init; } = new();
}

public sealed record SaveBlogDraftRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public BlogDraftRequest Draft { get; init; } = new();
}
