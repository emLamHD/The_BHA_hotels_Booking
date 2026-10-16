using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the currencies and exchange rates of the website. VND is the fixed base. The rate
/// convention is <c>vndPerUnit</c> = VND per one unit of the currency (a reference amount is VND / vndPerUnit),
/// sent and returned as a decimal string, never a JSON number. A currency starts off with no rate; it can be turned
/// on or chosen as the default only once it has one. The server stamps who set the rate and when, and the source
/// is always <c>manual</c>. Nothing here changes a price, hold or reservation. Same access rules as the languages routes.
/// </summary>
[Route("api/admin/v1/website/currencies")]
public sealed class AdminWebsiteCurrenciesController(IWebsiteSettingsStore store) : AdminWebsiteControllerBase
{
    [HttpGet]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(IReadOnlyList<WebsiteCurrencyDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<WebsiteCurrencyDto>>> List(CancellationToken cancellationToken) =>
        Ok(await store.ListCurrenciesAsync(cancellationToken));

    [HttpPost]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteCurrencyDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Create([FromBody] CreateWebsiteCurrencyRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.CreateCurrencyAsync(
                new CreateCurrencyCommand(request.Code, request.Name, request.Symbol, request.MinorUnits, request.SortOrder, ActorStaffId), cancellationToken),
            currency => StatusCode(StatusCodes.Status201Created, currency));

    [HttpPost("{code}/update")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteCurrencyDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Update(string code, [FromBody] UpdateWebsiteCurrencyRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.UpdateCurrencyAsync(
                new UpdateCurrencyCommand(code, request.ExpectedVersion, request.Name, request.Symbol, request.MinorUnits, request.SortOrder, ActorStaffId), cancellationToken),
            currency => Ok(currency));

    [HttpPost("{code}/rate")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteCurrencyDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> SetRate(string code, [FromBody] SetWebsiteCurrencyRateRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.SetCurrencyRateAsync(new SetCurrencyRateCommand(code, request.ExpectedVersion, request.VndPerUnit, ActorStaffId), cancellationToken),
            currency => Ok(currency));

    [HttpPost("{code}/active")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteCurrencyDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> SetActive(string code, [FromBody] SetWebsiteCurrencyActiveRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.SetCurrencyActiveAsync(new SetCurrencyActiveCommand(code, request.ExpectedVersion, request.IsActive, ActorStaffId), cancellationToken),
            currency => Ok(currency));

    [HttpPost("{code}/set-default")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(typeof(WebsiteCurrencyDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> SetDefault(string code, [FromBody] WebsiteVersionRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.SetDefaultCurrencyAsync(new CurrencyVersionCommand(code, request.ExpectedVersion, ActorStaffId), cancellationToken),
            currency => Ok(currency));

    [HttpPost("{code}/delete")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult> Delete(string code, [FromBody] WebsiteVersionRequest request, CancellationToken cancellationToken) =>
        Respond(
            await store.DeleteCurrencyAsync(new CurrencyVersionCommand(code, request.ExpectedVersion, ActorStaffId), cancellationToken),
            _ => NoContent());
}
