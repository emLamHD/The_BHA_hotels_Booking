using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2: the translations of the website (UI texts and content). The keys come from the
/// embedded catalog and from the stored content; an operator edits texts only, as plain text in the message syntax that
/// keeps each key's placeholders. The list is filtered, counted and paged by the server (scope, module, status, search).
/// <c>save</c> creates or changes a text (<c>expectedVersion: null</c> means "no text saved yet", so two editors cannot
/// both create it) and marks it as edited by hand; <c>clear</c> removes it. The default language always keeps a text for
/// every key, so <c>clear</c> there is refused. Same access rules as the languages routes.
/// </summary>
[Route("api/admin/v1/website/translations")]
public sealed class AdminWebsiteTranslationsController(IWebsiteSettingsStore store) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteTranslationListDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult> List(
        [FromQuery] string locale,
        [FromQuery] string? scope,
        [FromQuery] string? group,
        [FromQuery] string? status,
        [FromQuery(Name = "q")] string? search,
        [FromQuery(Name = "reference")] string? referenceLocale,
        [FromQuery] int page,
        [FromQuery] int pageSize,
        CancellationToken cancellationToken)
    {
        var list = await store.ListTranslationsAsync(
            new TranslationQuery(locale, scope, group, status, search, referenceLocale, page, pageSize), cancellationToken);
        return list is null
            ? Fail(StatusCodes.Status404NotFound, "Website setting not found", null, "locale", $"The language {locale} does not exist.")
            : Ok(list);
    }

    [HttpPost("save")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteTranslationRowDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Save([FromBody] SaveWebsiteTranslationRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.SaveTranslationAsync(
                new SaveTranslationCommand(request.Locale, request.Key, request.Value, request.ExpectedVersion, ActorStaffId), cancellationToken),
            row => Ok(row));

    [HttpPost("clear")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteTranslationRowDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Clear([FromBody] ClearWebsiteTranslationRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.ClearTranslationAsync(
                new ClearTranslationCommand(request.Locale, request.Key, request.ExpectedVersion, ActorStaffId), cancellationToken),
            row => Ok(row));
}
