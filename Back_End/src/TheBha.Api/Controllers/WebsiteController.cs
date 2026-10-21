using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TheBha.Application.Promotions;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2: the public read of the website settings, called by both front ends. Anonymous,
/// no cookie, no secret: active languages and currencies (an active currency always has a rate), the defaults, the
/// dictionary of the chosen language and the display-price projection — never who changed what, a draft, a
/// permission or any Staff data. <c>dictionary</c> carries a revision and an ETag and is revalidated on every
/// request (<c>no-cache</c>), so an installed pack or an edited text is visible to the next request.
/// </summary>
[ApiController]
[EnableCors("website-public")]
[Route("api/v1/website")]
public sealed class WebsiteController(IWebsitePublicReader reader, IWebsiteDisplayPricing pricing, IWebsiteMenus menus, IWebsiteHero hero, IWebsiteSocialSettings social, IWebsitePromotions promotions) : ControllerBase
{
    /// <summary>Active locales (each with its format locale, direction and default currency), active currencies, the defaults, and VND as the base currency.</summary>
    [HttpGet("config")]
    [ProducesResponseType(typeof(PublicWebsiteConfigDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<PublicWebsiteConfigDto>> Config(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await reader.GetConfigAsync(cancellationToken));
    }

    /// <summary>
    /// The dictionary of <c>locale</c> (<c>en</c>, <c>en-US</c>), limited to the <c>scopes</c> (comma separated:
    /// <c>shared</c>, <c>customer</c>, <c>admin</c>, <c>content</c>; default shared, customer, content) and, when
    /// given, the <c>content</c> keys are narrowed to those that start with one of the <c>prefix</c> values (UI scopes are never narrowed). A locale that is unsupported, disabled or not a
    /// tag is answered with the default's dictionary and <c>isFallbackLocale: true</c>; <c>resolvedLocale</c> always says
    /// which one was used. A text the resolved language lacks carries a fallback; the Admin never counts that as translated.
    /// </summary>
    [HttpGet("dictionary")]
    [ProducesResponseType(typeof(PublicDictionaryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult> Dictionary(
        [FromQuery] string? locale, [FromQuery] string? scopes, [FromQuery] string[]? prefix, CancellationToken cancellationToken)
    {
        var wanted = (scopes ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.Ordinal).ToArray();
        if (wanted.Any(scope => !MessageScopes.IsPublic(scope)) || (prefix?.Length ?? 0) > 20 || (prefix ?? []).Any(item => item.Length > 120))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid dictionary request", detail: "scopes must be shared, customer, admin or content; at most 20 prefixes of at most 120 characters.");
        }

        var dictionary = await reader.GetDictionaryAsync(new PublicDictionaryQuery(locale, wanted, prefix ?? []), cancellationToken);
        var etag = "W/\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join('|', dictionary.Revision, dictionary.ResolvedLocale, string.Join(',', wanted), string.Join(',', prefix ?? []))))).ToLowerInvariant()[..24] + "\"";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.ETag = etag;
        return Request.Headers.IfNoneMatch.Contains(etag) ? StatusCode(StatusCodes.Status304NotModified) : Ok(dictionary);
    }

    /// <summary>
    /// CUST-WEB-HEADER-001-CP04: the header navigation for <c>locale</c> (resolved like <c>dictionary</c>): the enabled entries of the
    /// main row and of the secondary group, labels already in the visitor's language. Revalidated on every request
    /// (<c>no-cache</c> + ETag), so a Save in the Admin is visible to the next request. An empty list is a real answer. It never
    /// carries a draft, a Staff id or any administrative field; <c>generatedAtUtc</c> lets a client keep the newest answer.
    /// </summary>
    [HttpGet("menus")]
    [ProducesResponseType(typeof(PublicMenuDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public async Task<ActionResult> Menus([FromQuery] string? locale, CancellationToken cancellationToken)
    {
        var menu = await menus.GetPublicAsync(locale, cancellationToken);
        var etag = "W/\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(menu.Revision + "|" + menu.Locale))).ToLowerInvariant()[..24] + "\"";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.ETag = etag;
        return Request.Headers.IfNoneMatch.Contains(etag) ? StatusCode(StatusCodes.Status304NotModified) : Ok(menu);
    }

    /// <summary>
    /// CUST-WEB-HERO-001-CP01: the home page hero for <c>locale</c> (resolved like <c>dictionary</c>): the saved slides, texts, font and timing,
    /// revalidated on every request (<c>no-cache</c> + ETag) so a Save in the Admin is visible to the next request. Never a draft, a Staff id or
    /// an administrative field; <c>generatedAtUtc</c> lets a client keep the newest answer.
    /// </summary>
    [HttpGet("hero")]
    [ProducesResponseType(typeof(PublicHeroDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public async Task<ActionResult> Hero([FromQuery] string? locale, CancellationToken cancellationToken)
    {
        var body = await hero.GetPublicAsync(locale, cancellationToken);
        var etag = "W/\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body.Revision + "|" + body.Locale))).ToLowerInvariant()[..24] + "\"";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.ETag = etag;
        return Request.Headers.IfNoneMatch.Contains(etag) ? StatusCode(StatusCodes.Status304NotModified) : Ok(body);
    }

    /// <summary>
    /// BHA-BOOKING-PROMOTIONS-001: the promotions that are public today, in the visitor's language, for the homepage and <c>/offers</c>. Revalidated on every
    /// request (<c>no-cache</c> + ETag from the body): a card that stopped being public, by a save or just by the date, is gone from the next request.
    /// Never a draft, a disabled or hidden promotion, a Staff id or an administrative field.
    /// </summary>
    [HttpGet("promotions")]
    [ProducesResponseType(typeof(PublicPromotionListDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public async Task<ActionResult> Promotions([FromQuery] string? locale, CancellationToken cancellationToken)
    {
        var body = await promotions.ListAsync(locale, cancellationToken);
        return Revalidated(body.Revision, body.Locale, body);
    }

    /// <summary>One public promotion by slug. Public by the same rule as the list; anything else is a plain 404.</summary>
    [HttpGet("promotions/{slug}")]
    [ProducesResponseType(typeof(PublicPromotionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Promotion(string slug, [FromQuery] string? locale, CancellationToken cancellationToken)
    {
        var body = await promotions.GetAsync(slug, locale, cancellationToken);
        if (body is null)
        {
            Response.Headers.CacheControl = "no-store";
            return NotFound();
        }

        return Revalidated(body.Revision, body.Locale, body);
    }

    /// <summary>A cover picture, only while a public promotion uses it; short cache so hiding a promotion takes effect within minutes.</summary>
    [HttpGet("promotions/media/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> PromotionMedia(Guid id, CancellationToken cancellationToken)
    {
        var file = await promotions.OpenMediaAsync(id, cancellationToken);
        if (file is null)
        {
            Response.Headers.CacheControl = "no-store";
            return NotFound();
        }

        Response.Headers.CacheControl = "public, max-age=300";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }

    private ActionResult Revalidated(string revision, string locale, object body)
    {
        var etag = "W/\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(revision + "|" + locale))).ToLowerInvariant()[..24] + "\"";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.ETag = etag;
        return Request.Headers.IfNoneMatch.Contains(etag) ? StatusCode(StatusCodes.Status304NotModified) : Ok(body);
    }

    [HttpGet("social-media")]
    [ProducesResponseType(typeof(WebsiteSocialPublicDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<WebsiteSocialPublicDto>> SocialMedia(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await social.GetPublicAsync(cancellationToken));
    }

    /// <summary>
    /// One hero picture by its server-generated id. A picture never changes (a new file is a new id), so it is cached for a year. The content type
    /// is the one recorded at upload, never sniffed; the id is random and unlisted, so a picture uploaded but not yet saved into the slideshow is not discoverable.
    /// </summary>
    [HttpGet("hero/media/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> HeroMedia(Guid id, CancellationToken cancellationToken)
    {
        var file = await hero.OpenMediaAsync(id, cancellationToken);
        if (file is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }

    /// <summary>
    /// Converts VND amounts a client already holds into the chosen currency, in exact decimal arithmetic with one rate
    /// snapshot per request (the response says which). A read-only calculation: it changes and reads no price, hold or
    /// reservation, which is why it needs no antiforgery token (the Next.js server calls it while rendering). A currency
    /// that is off or has no rate is a 409, never a made-up rate.
    /// </summary>
    [HttpPost("display-prices")]
    [IgnoreAntiforgeryToken]
    [ProducesResponseType(typeof(DisplayPriceResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> DisplayPrices([FromBody] DisplayPriceRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var result = await pricing.QuoteAsync(request, cancellationToken);
        return result.Status switch
        {
            WebsiteMutationStatus.Succeeded => Ok(result.Value),
            WebsiteMutationStatus.Invalid => ProblemWith(StatusCodes.Status400BadRequest, "Invalid display price request", result),
            _ => ProblemWith(StatusCodes.Status409Conflict, "Display price unavailable", result)
        };
    }

    private ObjectResult ProblemWith<T>(int status, string title, WebsiteMutationResult<T> result)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Detail = result.Message };
        if (result.Code is not null)
        {
            problem.Extensions["code"] = result.Code;
        }

        if (result.Field is not null)
        {
            problem.Extensions["field"] = result.Field;
        }

        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
