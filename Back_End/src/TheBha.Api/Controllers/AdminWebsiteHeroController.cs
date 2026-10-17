using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HERO-001-CP01: the home page hero (slides, order, texts, font, timing), site-wide. <c>GET</c> reads it with every language's
/// text and a revision; <c>save</c> applies all of it in one transaction or nothing; <c>media</c> uploads one picture without publishing it.
/// Same access as the other website routes: Staff session, global <c>WebsiteSettingsManage</c> (401 / 403), then Origin and a body type for
/// a write — JSON, except the upload, the one action marked <see cref="AllowStaffMultipartUploadAttribute"/>. A stale
/// <c>expectedRevision</c> is a 409 (<c>stale-version</c>); a bad font, interval, text, slide list or picture is a 400 with a
/// <c>hero-*</c> code and the offending <c>field</c>.
/// </summary>
[Route("api/admin/v1/website/hero")]
public sealed class AdminWebsiteHeroController(IWebsiteHero hero) : AdminWebsiteControllerBase
{
    /// <summary>10 MB of picture plus the multipart framing; the picture's own limit is checked on what arrives.</summary>
    private const int RequestLimit = HeroLimits.MaxUploadBytes + 1024 * 1024;

    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(HeroAdminDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<HeroAdminDto>> Get(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await hero.GetAdminAsync(cancellationToken));
    }

    /// <summary>
    /// One picture's bytes for the editor's thumbnails and preview — any recorded picture, a published one or not. Same Staff session and
    /// permission as the rest of the screen; the public route serves the pictures a visitor sees.
    /// </summary>
    [HttpGet("media/{id:guid}")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Media(Guid id, CancellationToken cancellationToken)
    {
        var file = await hero.OpenMediaAsync(id, cancellationToken);
        if (file is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "private, max-age=3600";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }

    [HttpPost("save")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(HeroAdminDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Save([FromBody] SaveWebsiteHeroRequest request, CancellationToken cancellationToken) =>
        Respond(
            await hero.SaveAsync(
                new SaveHeroCommand(
                    request.ExpectedRevision,
                    request.FontKey,
                    request.AutoplayEnabled,
                    request.IntervalSeconds,
                    new HeroTextsDto(request.Texts.Title, request.Texts.Description, request.Texts.PrimaryAction, request.Texts.SecondaryAction),
                    [.. request.Slides.Select(slide => new HeroSlideInput(slide.Id, slide.MediaId, slide.FocalPosition, slide.Alt, slide.Caption))],
                    ActorStaffId),
                cancellationToken),
            saved => Ok(saved));

    /// <summary>One picture as a <c>multipart/form-data</c> part named <c>file</c>. The bytes decide the type; the name and the client's media type are ignored.</summary>
    [HttpPost("media")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [AllowStaffMultipartUpload]
    [RequestSizeLimit(RequestLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = RequestLimit, ValueCountLimit = 4)]
    [ProducesResponseType(typeof(HeroMediaDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Upload(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return Respond(
                WebsiteMutationResult<HeroMediaDto>.Invalid("file", "Choose a picture to upload.") with { Code = HeroErrorCodes.ImageEmpty },
                media => Ok(media));
        }

        await using var content = file.OpenReadStream();
        return Respond(await hero.UploadAsync(content, ActorStaffId, cancellationToken), media => Ok(media));
    }
}
