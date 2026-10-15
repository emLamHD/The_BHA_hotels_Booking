using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the UI translations of the website. The keys are fixed in source (and seeded by a
/// migration); an operator edits values only, as plain text that keeps each key's placeholders. A language other
/// than the default has a row only where it overrides the default: <c>save</c> creates or changes it
/// (<c>expectedVersion: null</c> means "no override yet", so two editors cannot both create it), <c>clear</c>
/// removes it and the default's text applies again. The default language always keeps a value for every key, so
/// <c>clear</c> there is refused. Same access rules as the languages routes.
/// </summary>
[Route("api/admin/v1/website/translations")]
public sealed class AdminWebsiteTranslationsController(IWebsiteSettingsStore store) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteTranslationListDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult> List(
        [FromQuery] string locale, [FromQuery] string? group, [FromQuery(Name = "q")] string? search, CancellationToken cancellationToken)
    {
        var list = await store.ListTranslationsAsync(locale, group, search, cancellationToken);
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
