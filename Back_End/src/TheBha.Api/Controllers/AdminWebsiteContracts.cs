using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

// CUST-WEB-HEADER-001-CP02 request bodies. Unknown properties (an `actorStaffId`, a `permissions`) are ignored:
// the actor and the authorization come from the server-side session, never from a request. A rate is a JSON
// string; a JSON number does not bind to it, so it cannot pass through a JavaScript Number.

public sealed record CreateWebsiteLanguageRequest
{
    [JsonRequired] public string Code { get; init; } = string.Empty;
    [JsonRequired] public string DisplayName { get; init; } = string.Empty;
    [JsonRequired] public string NativeName { get; init; } = string.Empty;
    [JsonRequired] public int SortOrder { get; init; }
    [JsonRequired] public bool IsActive { get; init; }

    /// <summary>The currency a visitor gets when they pick this language; <c>null</c> = the site default.</summary>
    public string? DefaultCurrencyCode { get; init; }

    /// <summary><c>ltr</c> (default) or <c>rtl</c>.</summary>
    public string? Direction { get; init; }

    /// <summary>The BCP 47 tag used for dates and numbers (<c>fr-FR</c>); defaults to the code.</summary>
    public string? FormatLocale { get; init; }
}

public sealed record UpdateWebsiteLanguageRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public string DisplayName { get; init; } = string.Empty;
    [JsonRequired] public string NativeName { get; init; } = string.Empty;
    [JsonRequired] public int SortOrder { get; init; }
    [JsonRequired] public bool IsActive { get; init; }
    public string? DefaultCurrencyCode { get; init; }
    public string? Direction { get; init; }
    public string? FormatLocale { get; init; }
}

/// <summary>
/// A pack to check or install: either one of the library (<c>builtInPackId</c>) or the text of an uploaded file
/// (<c>json</c>) — never a URL. <c>previewToken</c> (apply only) is the token of the preview the operator confirmed.
/// </summary>
public sealed record WebsiteLanguagePackRequest
{
    public string? BuiltInPackId { get; init; }
    public string? Json { get; init; }
    [JsonRequired] public string Mode { get; init; } = PackModes.KeepManual;
    public string? PreviewToken { get; init; }
    public bool Enable { get; init; }
}

public sealed record WebsiteVersionRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
}

/// <summary><c>ExpectedVersion</c> is <c>null</c> for "no override exists yet".</summary>
public sealed record SaveWebsiteTranslationRequest
{
    [JsonRequired] public string Locale { get; init; } = string.Empty;
    [JsonRequired] public string Key { get; init; } = string.Empty;
    [JsonRequired] public string Value { get; init; } = string.Empty;
    [JsonRequired] public int? ExpectedVersion { get; init; }
}

public sealed record ClearWebsiteTranslationRequest
{
    [JsonRequired] public string Locale { get; init; } = string.Empty;
    [JsonRequired] public string Key { get; init; } = string.Empty;
    [JsonRequired] public int ExpectedVersion { get; init; }
}

public sealed record CreateWebsiteCurrencyRequest
{
    [JsonRequired] public string Code { get; init; } = string.Empty;
    [JsonRequired] public string Name { get; init; } = string.Empty;
    [JsonRequired] public string Symbol { get; init; } = string.Empty;
    [JsonRequired] public int MinorUnits { get; init; }
    [JsonRequired] public int SortOrder { get; init; }
}

public sealed record UpdateWebsiteCurrencyRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public string Name { get; init; } = string.Empty;
    [JsonRequired] public string Symbol { get; init; } = string.Empty;
    [JsonRequired] public int MinorUnits { get; init; }
    [JsonRequired] public int SortOrder { get; init; }
}

public sealed record SetWebsiteCurrencyRateRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }

    /// <summary>VND per one unit of the currency, as a decimal string (<c>"25000.5"</c>).</summary>
    [JsonRequired] public string VndPerUnit { get; init; } = string.Empty;
}

public sealed record SetWebsiteCurrencyActiveRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public bool IsActive { get; init; }
}

/// <summary>
/// The whole header navigation as the editor holds it. <c>ExpectedRevision</c> is the revision it loaded. <c>Items</c>
/// is the flat list in tree order (siblings in the order they appear); <c>Labels</c> maps a language code to its label.
/// </summary>
public sealed record SaveWebsiteMenuRequest
{
    [JsonRequired] public string ExpectedRevision { get; init; } = string.Empty;
    [JsonRequired] public IReadOnlyList<WebsiteMenuItemRequest> Items { get; init; } = [];
}

public sealed record WebsiteMenuItemRequest
{
    [JsonRequired] public Guid Id { get; init; }
    public Guid? ParentId { get; init; }
    public string? Placement { get; init; }
    [JsonRequired] public bool IsEnabled { get; init; }
    [JsonRequired] public string Href { get; init; } = string.Empty;
    [JsonRequired] public bool OpenInNewTab { get; init; }
    public Dictionary<string, string?>? Labels { get; init; }
}

/// <summary>
/// The shared shape of every website-settings controller: Staff mode only (a filter per action, never per
/// controller), no antiforgery token (the Staff boundary checks Origin and JSON instead), the verified Staff id
/// as the actor, and one mapping of a store outcome to a problem with a machine-readable <c>code</c> and the
/// offending <c>field</c>. A 400, 404 or 409 is never a 500.
/// </summary>
[ApiController]
[IgnoreAntiforgeryToken]
public abstract class AdminWebsiteControllerBase : ControllerBase
{
    protected Guid ActorStaffId =>
        HttpContext.Features.Get<StaffWebsiteContext>()?.StaffId
        ?? throw new InvalidOperationException("A website-settings action ran without its Staff authorization filter.");

    protected ActionResult Respond<T>(WebsiteMutationResult<T> result, Func<T, ActionResult> succeeded) =>
        result.Status switch
        {
            WebsiteMutationStatus.Succeeded => succeeded(result.Value!),
            WebsiteMutationStatus.Invalid => Fail(StatusCodes.Status400BadRequest, "Invalid website setting", result.Code, result.Field, result.Message),
            WebsiteMutationStatus.NotFound => Fail(StatusCodes.Status404NotFound, "Website setting not found", result.Code, result.Field, result.Message),
            _ => Fail(StatusCodes.Status409Conflict, "Website setting conflict", result.Code, result.Field, result.Message)
        };

    protected ObjectResult Fail(int status, string title, string? code, string? field, string? detail)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Detail = detail };
        if (code is not null)
        {
            problem.Extensions["code"] = code;
        }

        if (field is not null)
        {
            problem.Extensions["field"] = field;
        }

        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

/// <summary>
/// CUST-WEB-HERO-001-CP01: the whole home hero as the editor holds it. <c>ExpectedRevision</c> is the revision it loaded; <c>Slides</c> is in
/// slideshow order; every text maps a language code to its text.
/// </summary>
public sealed record SaveWebsiteHeroRequest
{
    [JsonRequired] public string ExpectedRevision { get; init; } = string.Empty;
    [JsonRequired] public string FontKey { get; init; } = string.Empty;
    [JsonRequired] public bool AutoplayEnabled { get; init; }
    [JsonRequired] public int IntervalSeconds { get; init; }
    [JsonRequired] public WebsiteHeroTextsRequest Texts { get; init; } = new();
    [JsonRequired] public IReadOnlyList<WebsiteHeroSlideRequest> Slides { get; init; } = [];
}

public sealed record WebsiteHeroTextsRequest
{
    public Dictionary<string, string?>? Title { get; init; }
    public Dictionary<string, string?>? Description { get; init; }
    public Dictionary<string, string?>? PrimaryAction { get; init; }
    public Dictionary<string, string?>? SecondaryAction { get; init; }
}

public sealed record WebsiteHeroSlideRequest
{
    [JsonRequired] public Guid Id { get; init; }
    [JsonRequired] public Guid MediaId { get; init; }
    public string? FocalPosition { get; init; }
    public Dictionary<string, string?>? Alt { get; init; }
    public Dictionary<string, string?>? Caption { get; init; }
}

public sealed record SaveWebsiteSocialRequest
{
    [JsonRequired] public int ExpectedRevision { get; init; }
    [JsonRequired] public bool PhoneEnabled { get; init; }
    public string? PhoneNumber { get; init; }
    [JsonRequired] public bool MessengerEnabled { get; init; }
    public string? MessengerUrl { get; init; }
    [JsonRequired] public bool ZaloEnabled { get; init; }
    public string? ZaloNumber { get; init; }
    [JsonRequired] public bool BackToTopEnabled { get; init; }
}
