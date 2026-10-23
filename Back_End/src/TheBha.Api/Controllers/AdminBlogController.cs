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

    [HttpGet("posts/{postId:guid}/translations/{locale}/preview")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> Preview(Guid postId, string locale, CancellationToken cancellationToken) =>
        Respond(await blog.GetPreviewAsync(postId, locale, cancellationToken), preview => Ok(preview));

    [HttpPost("posts/{postId:guid}/translations/{locale}/revisions/{revisionId:guid}/restore")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogEdit)]
    public async Task<ActionResult> Restore(Guid postId, string locale, Guid revisionId, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.RestoreAsync(new RestoreBlogRevisionCommand(postId, locale, revisionId, request.ExpectedVersion, ActorStaffId), cancellationToken), post => Ok(post));

    // ---- pictures (the library, CP02) ----

    private const int BatchLimit = (int)BlogMediaLimits.MaxBatchBytes + 1024 * 1024;

    [HttpGet("media")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult<BlogMediaListDto>> MediaList(
        [FromQuery] string? q, [FromQuery] string? usage, [FromQuery] int page = 1, [FromQuery] int pageSize = BlogMediaLimits.DefaultPageSize, CancellationToken cancellationToken = default) =>
        Ok(await blog.ListMediaAsync(new BlogMediaListQuery(q, usage, page, pageSize), cancellationToken));

    /// <summary>
    /// One picture as a <c>multipart/form-data</c> part named <c>file</c>, plus an optional <c>id</c> part (a Guid the picture takes as its id; a repeat is a 409
    /// <c>blog.duplicate-id</c>, so a client that lost the answer can read it back). The bytes decide the type; the name and the client's media type are ignored.
    /// </summary>
    [HttpPost("media")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    [AllowStaffMultipartUpload]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit, ValueCountLimit = 8)]
    public async Task<ActionResult> Upload(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return Respond(WebsiteMutationResult<BlogMediaDto>.Invalid("file", "Choose a picture to upload.") with { Code = HeroErrorCodes.ImageEmpty }, media => Ok(media));
        }

        var raw = Request.Form["id"].ToString();
        Guid? clientId = null;
        if (raw.Length > 0)
        {
            if (!Guid.TryParse(raw, out var parsed) || parsed == Guid.Empty)
            {
                return Fail(StatusCodes.Status400BadRequest, "Invalid picture", BlogErrorCodes.Validation, "id", "The id is not a valid Guid.");
            }

            clientId = parsed;
        }

        return Respond(await blog.UploadMediaAsync(new BlogMediaUpload(file.OpenReadStream, file.FileName, clientId), ActorStaffId, cancellationToken), media => Ok(media));
    }

    /// <summary>
    /// Up to <see cref="BlogMediaLimits.MaxBatchFiles"/> pictures as <c>files</c> parts, together at most <see cref="BlogMediaLimits.MaxBatchBytes"/> bytes (a larger
    /// request is refused before any picture is processed), with an optional <c>ids</c> part per picture in the same order. They are taken in one after the other; each
    /// answer carries the picture's <c>index</c> in the request and its id, and one that fails does not undo the rest. A client that is cut off reads the library
    /// (or each id) to see what arrived; nothing is retried or replayed by the server.
    /// </summary>
    [HttpPost("media/bulk")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    [AllowStaffMultipartUpload]
    [RequestSizeLimit(BatchLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = BatchLimit, ValueCountLimit = 64)]
    public async Task<ActionResult> UploadBatch(List<IFormFile>? files, CancellationToken cancellationToken)
    {
        if (files is null or { Count: 0 })
        {
            return Fail(StatusCodes.Status400BadRequest, "Invalid batch", BlogErrorCodes.MediaBatchInvalid, "files", "Choose at least one picture.");
        }

        if (files.Count > BlogMediaLimits.MaxBatchFiles)
        {
            return Fail(StatusCodes.Status400BadRequest, "Invalid batch", BlogErrorCodes.MediaBatchInvalid, "files", $"A batch has at most {BlogMediaLimits.MaxBatchFiles} pictures.");
        }

        if (files.Sum(file => file.Length) > BlogMediaLimits.MaxBatchBytes)
        {
            return Fail(StatusCodes.Status413PayloadTooLarge, "Batch too large", BlogErrorCodes.MediaBatchInvalid, "files", $"A batch is at most {BlogMediaLimits.MaxBatchBytes / (1024 * 1024)} MB in all.");
        }

        // Every id is parsed once and judged as a Guid, never as text: "…-…" and the 32-digit form, or upper and lower case, are one Guid. All of it is decided before
        // the first picture is taken in, so a request that names one id twice has no effect at all.
        var raw = Request.Form["ids"];
        var ids = new Guid?[files.Count];
        if (raw.Count > 0)
        {
            var seen = new HashSet<Guid>(raw.Count);
            var valid = raw.Count == files.Count;
            for (var index = 0; valid && index < raw.Count; index++)
            {
                valid = Guid.TryParse(raw[index], out var id) && id != Guid.Empty && seen.Add(id);
                ids[index] = valid ? id : null;
            }

            if (!valid)
            {
                return Fail(StatusCodes.Status400BadRequest, "Invalid batch", BlogErrorCodes.MediaBatchInvalid, "ids", "Send one distinct Guid in ids for each picture, in the same order, or none.");
            }
        }

        var uploads = files.Select((file, index) => new BlogMediaUpload(file.OpenReadStream, file.FileName, ids[index])).ToList();
        return Ok(await blog.UploadMediaBatchAsync(uploads, ActorStaffId, cancellationToken));
    }

    [HttpGet("media/{id:guid}/detail")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> MediaDetail(Guid id, CancellationToken cancellationToken) => Respond(await blog.GetMediaAsync(id, cancellationToken), media => Ok(media));

    /// <summary>Every revision that uses the picture — the draft being edited, the live one, and the ones kept in history (also of archived and unpublished articles).</summary>
    [HttpGet("media/{id:guid}/usage")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<ActionResult> MediaUsage(Guid id, CancellationToken cancellationToken) => Respond(await blog.GetMediaUsageAsync(id, cancellationToken), usage => Ok(usage));

    /// <summary>Name, description, credit, source, licence and focal point. It changes nothing in any article and publishes nothing.</summary>
    [HttpPost("media/{id:guid}/save")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogEdit)]
    public async Task<ActionResult> SaveMedia(Guid id, [FromBody] SaveBlogMediaRequest request, CancellationToken cancellationToken) =>
        Respond(
            await blog.UpdateMediaAsync(
                new UpdateBlogMediaCommand(id, request.ExpectedVersion, request.DisplayName, request.Description, request.Credit, request.SourceUrl, request.Licence, request.FocalX, request.FocalY, ActorStaffId),
                cancellationToken),
            media => Ok(media));

    /// <summary>Deletes a picture nothing refers to (409 <c>blog.media-in-use</c> otherwise): its row, its variants and its files.</summary>
    [HttpPost("media/{id:guid}/delete")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogPublish)]
    public async Task<ActionResult> DeleteMedia(Guid id, [FromBody] VersionRequest request, CancellationToken cancellationToken) =>
        Respond(await blog.DeleteMediaAsync(new DeleteBlogMediaCommand(id, request.ExpectedVersion, ActorStaffId), cancellationToken), _ => NoContent());

    /// <summary>The original bytes of any recorded picture, published or not; the public routes serve only what a visitor may see. Never cached.</summary>
    [HttpGet("media/{id:guid}")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<IActionResult> Media(Guid id, CancellationToken cancellationToken) => Serve(await blog.OpenMediaAsync(id, cancellationToken));

    /// <summary>A preset (<c>thumb</c>, <c>card</c>, <c>article</c>) as WebP for the editor's thumbnails; the original for a picture the pipeline has not processed. Never cached.</summary>
    [HttpGet("media/{id:guid}/preview/{preset}")]
    [StaffWebsitePermission(StaffGlobalPermission.BlogAccess)]
    public async Task<IActionResult> MediaPreview(Guid id, string preset, CancellationToken cancellationToken) => Serve(await blog.OpenMediaPreviewAsync(id, preset, cancellationToken));

    private IActionResult Serve(BlogMediaFile? file)
    {
        if (file is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }
}

public sealed record VersionRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
}

public sealed record SaveBlogMediaRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public string DisplayName { get; init; } = string.Empty;
    public string? Description { get; init; }
    public string? Credit { get; init; }
    public string? SourceUrl { get; init; }
    public string? Licence { get; init; }
    [JsonRequired] public double FocalX { get; init; }
    [JsonRequired] public double FocalY { get; init; }
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
