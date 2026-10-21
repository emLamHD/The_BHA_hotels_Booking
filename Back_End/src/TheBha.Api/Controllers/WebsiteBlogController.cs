using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using TheBha.Application.Blog;
using TheBha.Domain.Blog;

namespace TheBha.Api.Controllers;

/// <summary>
/// BHA-BLOG-001-CP01: the public, read-only Blog (design §6). Only published content in the requested language — no fallback to another language,
/// no draft, revision, audit line or Staff id. Every answer is revalidated (<c>Cache-Control: no-cache</c> + a weak <c>ETag</c>), so an unpublish is
/// visible on the very next request; a picture is cached for a few minutes and served only while a published article uses it.
/// </summary>
[ApiController]
[Route("api/v1/website/blog")]
public sealed class WebsiteBlogController(IWebsiteBlog blog) : ControllerBase
{
    [HttpGet("posts")]
    [ProducesResponseType(typeof(PublicBlogPostListDto), StatusCodes.Status200OK)]
    public async Task<ActionResult> Posts(
        [FromQuery] string? locale, [FromQuery] string? category, [FromQuery] int page = 1, [FromQuery] int pageSize = BlogLimits.DefaultPageSize, CancellationToken cancellationToken = default)
    {
        if (await LocaleAsync(locale, cancellationToken) is not { } resolved)
        {
            return UnsupportedLocale();
        }

        var list = await blog.ListPostsAsync(resolved, category, page, pageSize, cancellationToken);
        return list is null ? NotFoundNoStore() : Revalidated(list.ContentHash, resolved, list);
    }

    /// <summary>The article, or <c>301</c> with its current slug when <paramref name="slug"/> is an old address of a published article, or <c>404</c>.</summary>
    [HttpGet("posts/{slug}")]
    [ProducesResponseType(typeof(PublicBlogPostDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status301MovedPermanently)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Post(string slug, [FromQuery] string? locale, CancellationToken cancellationToken)
    {
        if (await LocaleAsync(locale, cancellationToken) is not { } resolved)
        {
            return UnsupportedLocale();
        }

        var lookup = await blog.GetPostAsync(resolved, slug, cancellationToken);
        if (lookup.RedirectSlug is { } current)
        {
            return Moved($"/api/v1/website/blog/posts/{Uri.EscapeDataString(current)}?locale={resolved}", current, resolved);
        }

        return lookup.Post is null ? NotFoundNoStore() : Revalidated(lookup.Post.ContentHash, resolved, lookup.Post);
    }

    [HttpGet("categories")]
    [ProducesResponseType(typeof(PublicBlogCategoryListDto), StatusCodes.Status200OK)]
    public async Task<ActionResult> Categories([FromQuery] string? locale, CancellationToken cancellationToken)
    {
        if (await LocaleAsync(locale, cancellationToken) is not { } resolved)
        {
            return UnsupportedLocale();
        }

        var list = await blog.ListCategoriesAsync(resolved, cancellationToken);
        return Revalidated(list.ContentHash, resolved, list);
    }

    [HttpGet("categories/{slug}")]
    [ProducesResponseType(typeof(PublicBlogCategoryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status301MovedPermanently)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Category(string slug, [FromQuery] string? locale, CancellationToken cancellationToken)
    {
        if (await LocaleAsync(locale, cancellationToken) is not { } resolved)
        {
            return UnsupportedLocale();
        }

        var lookup = await blog.GetCategoryAsync(resolved, slug, cancellationToken);
        if (lookup.RedirectSlug is { } current)
        {
            return Moved($"/api/v1/website/blog/categories/{Uri.EscapeDataString(current)}?locale={resolved}", current, resolved);
        }

        return lookup.Category is null ? NotFoundNoStore() : Revalidated(lookup.ContentHash, resolved, lookup.Category);
    }

    /// <summary>The home section: the settings' category (by id) and its first posts, pinned first. <c>items</c> empty ⇒ the page shows nothing.</summary>
    [HttpGet("home-section")]
    [ProducesResponseType(typeof(PublicBlogHomeSectionDto), StatusCodes.Status200OK)]
    public async Task<ActionResult> HomeSection([FromQuery] string? locale, [FromQuery] int limit = BlogLimits.HomeSectionDefault, CancellationToken cancellationToken = default)
    {
        if (await LocaleAsync(locale, cancellationToken) is not { } resolved)
        {
            return UnsupportedLocale();
        }

        var section = await blog.HomeSectionAsync(resolved, limit, cancellationToken);
        return Revalidated(section.ContentHash, resolved, section);
    }

    /// <summary>A picture, only while a published article uses it; a short cache so unpublishing takes effect within minutes.</summary>
    [HttpGet("media/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Media(Guid id, CancellationToken cancellationToken)
    {
        var file = await blog.OpenMediaAsync(id, cancellationToken);
        if (file is null)
        {
            return NotFoundNoStore();
        }

        Response.Headers.CacheControl = "public, max-age=300";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }

    private Task<string?> LocaleAsync(string? locale, CancellationToken cancellationToken) => blog.ResolveLocaleAsync(locale, cancellationToken);

    private ObjectResult UnsupportedLocale()
    {
        Response.Headers.CacheControl = "no-store";
        return new ObjectResult(new ProblemDetails
        {
            Status = StatusCodes.Status400BadRequest,
            Title = "Unsupported language",
            Detail = "The website has no such active language.",
            Extensions = { ["code"] = BlogErrorCodes.LocaleUnsupported, ["field"] = "locale" }
        })
        { StatusCode = StatusCodes.Status400BadRequest, ContentTypes = { "application/problem+json" } };
    }

    private ActionResult NotFoundNoStore()
    {
        Response.Headers.CacheControl = "no-store";
        return NotFound();
    }

    private ActionResult Moved(string location, string slug, string locale)
    {
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Location = location;
        return new ObjectResult(new { slug, locale }) { StatusCode = StatusCodes.Status301MovedPermanently };
    }

    private ActionResult Revalidated(string revision, string locale, object body)
    {
        var etag = "W/\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(revision + "|" + locale))).ToLowerInvariant()[..24] + "\"";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.ETag = etag;
        return Request.Headers.IfNoneMatch.Contains(etag) ? StatusCode(StatusCodes.Status304NotModified) : Ok(body);
    }
}
