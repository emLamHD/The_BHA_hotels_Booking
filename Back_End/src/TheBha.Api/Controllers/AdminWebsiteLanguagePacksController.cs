using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: language packs. The library lists the packs that ship with the product; a file the
/// operator uploads goes through the same pipeline: <c>preview</c> (validate on the server, say exactly what
/// installing would do, change nothing) then <c>apply</c> (one transaction, bound to the preview by its token, so a
/// stale preview, a double click or a lost response can neither import twice nor report a false success). A pack
/// is data — parsed and validated, never executed — and is never fetched from a URL. <c>export</c> writes the real
/// state of a language back out (a fallback is never exported as if translated); <c>template</c> is an empty pack for
/// a translator. Same access rules as the other website routes (Staff session + <c>WebsiteSettingsManage</c>).
/// </summary>
[Route("api/admin/v1/website/language-packs")]
public sealed class AdminWebsiteLanguagePacksController(IWebsiteLanguagePacks packs) : AdminWebsiteControllerBase
{
    [HttpGet("library")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(IReadOnlyList<LibraryPackDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<LibraryPackDto>>> Library(CancellationToken cancellationToken) =>
        Ok(await packs.ListLibraryAsync(cancellationToken));

    [HttpPost("preview")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [RequestSizeLimit(PackLimits.MaxBytes + 4096)]
    [ProducesResponseType(typeof(PackPreviewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Preview([FromBody] WebsiteLanguagePackRequest request, CancellationToken cancellationToken) =>
        Respond(
            await packs.PreviewAsync(new PackSource(request.BuiltInPackId, request.Json), request.Mode, cancellationToken),
            preview => Ok(preview));

    [HttpPost("apply")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [RequestSizeLimit(PackLimits.MaxBytes + 4096)]
    [ProducesResponseType(typeof(PackApplyResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Apply([FromBody] WebsiteLanguagePackRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.PreviewToken))
        {
            return Fail(StatusCodes.Status400BadRequest, "Invalid website setting", WebsiteErrorCodes.Validation, "previewToken", "previewToken is required: check the pack first.");
        }

        return Respond(
            await packs.ApplyAsync(
                new ApplyPackCommand(new PackSource(request.BuiltInPackId, request.Json), request.Mode, request.PreviewToken, request.Enable, ActorStaffId),
                cancellationToken),
            result => Ok(result));
    }

    [HttpGet("export/{code}")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Export(string code, CancellationToken cancellationToken) =>
        Respond(await packs.ExportAsync(code, cancellationToken), json => Content(json, "application/json; charset=utf-8"));

    [HttpGet("template")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult> Template([FromQuery(Name = "reference")] string? referenceLocale, CancellationToken cancellationToken) =>
        Content(await packs.TemplateAsync(referenceLocale, cancellationToken), "application/json; charset=utf-8");
}
