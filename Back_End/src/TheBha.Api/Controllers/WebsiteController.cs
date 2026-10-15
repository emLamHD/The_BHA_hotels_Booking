using Microsoft.AspNetCore.Mvc;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the public read of the website settings for the phase that connects Customer Web
/// (nothing calls it yet). Anonymous <c>GET</c>s, <c>no-store</c> so a changed rate or language shows on the
/// next request. It exposes active languages and currencies (an active currency always has a rate), the two
/// defaults and one dictionary — never who changed what, a draft or a permission.
/// </summary>
[ApiController]
[Route("api/v1/website")]
public sealed class WebsiteController(IWebsitePublicReader reader) : ControllerBase
{
    /// <summary>Active locales and currencies, the default locale and currency, and VND as the base currency.</summary>
    [HttpGet("config")]
    [ProducesResponseType(typeof(PublicWebsiteConfigDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<PublicWebsiteConfigDto>> Config(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await reader.GetConfigAsync(cancellationToken));
    }

    /// <summary>
    /// The dictionary of <c>locale</c> (<c>en</c>, <c>en-US</c>). A locale that is unsupported, disabled or not a
    /// tag is answered with the default's dictionary and <c>isFallbackLocale: true</c>; <c>resolvedLocale</c>
    /// always says which one was used. A key the resolved locale has not overridden carries the default's text.
    /// </summary>
    [HttpGet("dictionary")]
    [ProducesResponseType(typeof(PublicDictionaryDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<PublicDictionaryDto>> Dictionary([FromQuery] string? locale, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await reader.GetDictionaryAsync(locale, cancellationToken));
    }
}
