using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the languages of the website, site-wide. Reads are <c>GET</c>; every mutation is a
/// <c>POST</c> so it rides the one credentialed Staff write CORS policy. All routes need the Staff session and the
/// global <c>WebsiteSettingsManage</c> permission (401 / 403), then Origin (403) and JSON (415) for a write.
/// A <c>code</c> is an identity: a different code is a new row. <c>expectedVersion</c> is the version the editor
/// loaded; a stale one is a 409 (<c>stale-version</c>), never a silent last write.
/// </summary>
[Route("api/admin/v1/website/languages")]
public sealed class AdminWebsiteLanguagesController(IWebsiteSettingsStore store) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(IReadOnlyList<WebsiteLanguageDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<IReadOnlyList<WebsiteLanguageDto>>> List(CancellationToken cancellationToken) =>
        Ok(await store.ListLanguagesAsync(cancellationToken));

    [HttpPost]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteLanguageDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Create([FromBody] CreateWebsiteLanguageRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.CreateLanguageAsync(
                new CreateLanguageCommand(
                    request.Code, request.DisplayName, request.NativeName, request.SortOrder, request.IsActive,
                    request.DefaultCurrencyCode, request.Direction, request.FormatLocale, ActorStaffId),
                cancellationToken),
            language => StatusCode(StatusCodes.Status201Created, language));

    [HttpPost("{code}/update")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteLanguageDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Update(string code, [FromBody] UpdateWebsiteLanguageRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.UpdateLanguageAsync(
                new UpdateLanguageCommand(
                    code, request.ExpectedVersion, request.DisplayName, request.NativeName, request.SortOrder, request.IsActive,
                    request.DefaultCurrencyCode, request.Direction, request.FormatLocale, ActorStaffId),
                cancellationToken),
            language => Ok(language));

    [HttpPost("{code}/set-default")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteLanguageDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> SetDefault(string code, [FromBody] WebsiteVersionRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.SetDefaultLanguageAsync(new LanguageVersionCommand(code, request.ExpectedVersion, ActorStaffId), cancellationToken),
            language => Ok(language));

    [HttpPost("{code}/delete")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Delete(string code, [FromBody] WebsiteVersionRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.DeleteLanguageAsync(new LanguageVersionCommand(code, request.ExpectedVersion, ActorStaffId), cancellationToken),
            _ => NoContent());
}
