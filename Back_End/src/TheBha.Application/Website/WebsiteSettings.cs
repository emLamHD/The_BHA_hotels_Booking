using TheBha.Domain.Website;

namespace TheBha.Application.Website;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the boundary of the website localisation settings. Application owns the contract
/// (what is asked and answered); the transactional rules that need the database live behind
/// <see cref="IWebsiteSettingsStore"/> in Infrastructure. Everything here is site-wide, not per Property.
/// </summary>
public enum WebsiteMutationStatus
{
    Succeeded,
    /// <summary>The input is wrong on its own: 400, with the field.</summary>
    Invalid,
    /// <summary>The language, key or currency does not exist: 404.</summary>
    NotFound,
    /// <summary>The input is fine but the current state refuses it (stale version, default, in use): 409, with a reason code.</summary>
    Conflict
}

/// <summary>A machine-readable reason for <see cref="WebsiteMutationStatus.Conflict"/> and <see cref="WebsiteMutationStatus.Invalid"/>.</summary>
public static class WebsiteErrorCodes
{
    public const string Validation = "validation";
    public const string StaleVersion = "stale-version";
    public const string AlreadyExists = "already-exists";
    public const string DefaultLanguageRequired = "default-language-required";
    public const string DefaultLanguageIncomplete = "default-language-incomplete";
    public const string LanguageInUse = "language-in-use";
    public const string UnknownKey = "unknown-key";
    public const string DefaultCurrencyRequired = "default-currency-required";
    public const string RateRequired = "rate-required";
    public const string BaseCurrencyFixed = "base-currency-fixed";
    public const string CurrencyInUse = "currency-in-use";
    public const string CurrencyInactive = "currency-inactive";
    public const string LanguageIncomplete = "language-incomplete";
    public const string StalePreview = "stale-preview";
    public const string PackInvalid = "pack-invalid";
    public const string PackIncompatible = "pack-incompatible";
    public const string UnknownCurrency = "unknown-currency";
}

public sealed record WebsiteMutationResult<T>(
    WebsiteMutationStatus Status,
    T? Value,
    string? Code,
    string? Field,
    string? Message)
{
    public static WebsiteMutationResult<T> Success(T value) => new(WebsiteMutationStatus.Succeeded, value, null, null, null);

    public static WebsiteMutationResult<T> Invalid(string field, string message) =>
        new(WebsiteMutationStatus.Invalid, default, WebsiteErrorCodes.Validation, field, message);

    public static WebsiteMutationResult<T> NotFound(string message) =>
        new(WebsiteMutationStatus.NotFound, default, null, null, message);

    public static WebsiteMutationResult<T> Conflict(string code, string message, string? field = null) =>
        new(WebsiteMutationStatus.Conflict, default, code, field, message);
}

// ---- Admin DTOs (never public: they name the Staff member who last changed a row) ----

public sealed record WebsiteLanguageDto(
    string Code,
    string DisplayName,
    string NativeName,
    int SortOrder,
    bool IsActive,
    bool IsDefault,
    int Version,
    string? DefaultCurrencyCode,
    string Direction,
    string FormatLocale,
    string? PackId,
    string? PackVersion,
    int RequiredKeys,
    int TranslatedKeys,
    int MissingKeys,
    int OutdatedKeys,
    int ManualKeys,
    bool IsComplete,
    DateTimeOffset UpdatedAtUtc,
    Guid? UpdatedByStaffId);

/// <summary>One row of the translation editor. <c>Status</c>: <c>translated</c>, <c>missing</c> or <c>outdated</c> (the reference text changed since).</summary>
public sealed record WebsiteTranslationRowDto(
    string Key,
    string Scope,
    string Group,
    string? Context,
    IReadOnlyList<string> Placeholders,
    string SourceText,
    string? Value,
    string Status,
    bool IsManual,
    int? Version,
    DateTimeOffset? UpdatedAtUtc);

public sealed record FacetCount(string Name, int Count);

public sealed record TranslationFacets(
    int Required,
    int Translated,
    int Missing,
    int Outdated,
    int Manual,
    IReadOnlyList<FacetCount> Scopes,
    IReadOnlyList<FacetCount> Groups);

/// <summary>A page of the editor. Filtering, paging and counting are the server's: the editor lists thousands of rows.</summary>
public sealed record WebsiteTranslationListDto(
    string Locale,
    string ReferenceLocale,
    string DefaultLocale,
    bool IsDefaultLocale,
    int Total,
    int Page,
    int PageSize,
    TranslationFacets Facets,
    IReadOnlyList<WebsiteTranslationRowDto> Rows);

public sealed record TranslationQuery(
    string Locale,
    string? Scope,
    string? Group,
    string? Status,
    string? Search,
    string? ReferenceLocale,
    int Page,
    int PageSize);

public sealed record WebsiteCurrencyDto(
    string Code,
    string Name,
    string Symbol,
    int MinorUnits,
    int SortOrder,
    bool IsActive,
    bool IsDefault,
    bool IsBase,
    string? VndPerUnit,
    DateTimeOffset? RateUpdatedAtUtc,
    string RateSource,
    int Version,
    DateTimeOffset UpdatedAtUtc,
    Guid? UpdatedByStaffId);

// ---- Commands: the actor is the verified Staff id, always taken from the session, never from a request ----

public sealed record CreateLanguageCommand(
    string Code, string DisplayName, string NativeName, int SortOrder, bool IsActive,
    string? DefaultCurrencyCode, string? Direction, string? FormatLocale, Guid ActorStaffId);

public sealed record UpdateLanguageCommand(
    string Code, int ExpectedVersion, string DisplayName, string NativeName, int SortOrder, bool IsActive,
    string? DefaultCurrencyCode, string? Direction, string? FormatLocale, Guid ActorStaffId);

public sealed record LanguageVersionCommand(string Code, int ExpectedVersion, Guid ActorStaffId);

/// <summary><c>ExpectedVersion</c> is <c>null</c> when the caller expects no override yet, so two editors cannot both create it.</summary>
public sealed record SaveTranslationCommand(string Locale, string Key, string Value, int? ExpectedVersion, Guid ActorStaffId);

public sealed record ClearTranslationCommand(string Locale, string Key, int ExpectedVersion, Guid ActorStaffId);

public sealed record CreateCurrencyCommand(string Code, string Name, string Symbol, int MinorUnits, int SortOrder, Guid ActorStaffId);

public sealed record UpdateCurrencyCommand(string Code, int ExpectedVersion, string Name, string Symbol, int MinorUnits, int SortOrder, Guid ActorStaffId);

public sealed record SetCurrencyRateCommand(string Code, int ExpectedVersion, string? VndPerUnit, Guid ActorStaffId);

public sealed record SetCurrencyActiveCommand(string Code, int ExpectedVersion, bool IsActive, Guid ActorStaffId);

public sealed record CurrencyVersionCommand(string Code, int ExpectedVersion, Guid ActorStaffId);

/// <summary>
/// The admin half. Every mutation runs in one transaction under one site-wide advisory lock, so a default
/// switch, a disable and a delete can never interleave into zero or two defaults, and compares
/// <c>ExpectedVersion</c> in that lock: a stale one is a conflict, never a silent last write.
/// </summary>
public interface IWebsiteSettingsStore
{
    Task<IReadOnlyList<WebsiteLanguageDto>> ListLanguagesAsync(CancellationToken cancellationToken);

    /// <summary><c>null</c> when the language does not exist.</summary>
    Task<WebsiteTranslationListDto?> ListTranslationsAsync(TranslationQuery query, CancellationToken cancellationToken);

    Task<IReadOnlyList<WebsiteCurrencyDto>> ListCurrenciesAsync(CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteLanguageDto>> CreateLanguageAsync(CreateLanguageCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteLanguageDto>> UpdateLanguageAsync(UpdateLanguageCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteLanguageDto>> SetDefaultLanguageAsync(LanguageVersionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<bool>> DeleteLanguageAsync(LanguageVersionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteTranslationRowDto>> SaveTranslationAsync(SaveTranslationCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteTranslationRowDto>> ClearTranslationAsync(ClearTranslationCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteCurrencyDto>> CreateCurrencyAsync(CreateCurrencyCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteCurrencyDto>> UpdateCurrencyAsync(UpdateCurrencyCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteCurrencyDto>> SetCurrencyRateAsync(SetCurrencyRateCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteCurrencyDto>> SetCurrencyActiveAsync(SetCurrencyActiveCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<WebsiteCurrencyDto>> SetDefaultCurrencyAsync(CurrencyVersionCommand command, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<bool>> DeleteCurrencyAsync(CurrencyVersionCommand command, CancellationToken cancellationToken);
}

// ---- Public contract (phase 3 reads it; nothing here names a Staff member, a draft or a permission) ----

public sealed record PublicLocaleDto(
    string Code,
    string DisplayName,
    string NativeName,
    bool IsDefault,
    string FormatLocale,
    string Direction,
    string? DefaultCurrency);

public sealed record PublicCurrencyDto(
    string Code,
    string Name,
    string Symbol,
    int MinorUnits,
    bool IsBase,
    bool IsDefault,
    string VndPerUnit,
    DateTimeOffset RateUpdatedAtUtc);

public sealed record PublicWebsiteConfigDto(
    string DefaultLocale,
    IReadOnlyList<PublicLocaleDto> Locales,
    string BaseCurrency,
    string DefaultCurrency,
    IReadOnlyList<PublicCurrencyDto> Currencies,
    string Revision);

/// <summary>
/// The dictionary of the locale that was actually used. An unsupported or disabled locale is answered with
/// the default's (<c>IsFallbackLocale</c>; <c>RequestedLocale</c> is <c>null</c> when none or a malformed one was given).
/// <c>Revision</c> changes whenever any text it contains could have changed (an installed pack, an edit, a catalog or content change),
/// so a server render and a client that were given the same revision hold the same texts.
/// </summary>
public sealed record PublicDictionaryDto(
    string? RequestedLocale,
    string ResolvedLocale,
    string DefaultLocale,
    bool IsFallbackLocale,
    string Revision,
    IReadOnlyDictionary<string, string> Entries);

public sealed record PublicDictionaryQuery(string? Locale, IReadOnlyList<string> Scopes, IReadOnlyList<string> Prefixes);

public interface IWebsitePublicReader
{
    Task<PublicWebsiteConfigDto> GetConfigAsync(CancellationToken cancellationToken);

    Task<PublicDictionaryDto> GetDictionaryAsync(PublicDictionaryQuery query, CancellationToken cancellationToken);
}

/// <summary>Per-field input rules shared by the admin API and the store; one place, one wording.</summary>
public static class WebsiteInputValidation
{
    public const string RateExample = "25000.5";

    /// <summary>The first broken rule as (field, message), or <c>null</c>.</summary>
    public static (string Field, string Message)? PlainText(string? value, string field, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return (field, $"{field} is required.");
        }

        var trimmed = value.Trim();
        if (trimmed.Length > maximumLength)
        {
            return (field, $"{field} cannot exceed {maximumLength} characters.");
        }

        return trimmed.Any(char.IsControl) || trimmed.Contains('<') || trimmed.Contains('>')
            ? (field, $"{field} is plain text: no control characters, '<' or '>'.")
            : null;
    }

    public static (string Field, string Message)? Language(string? code, string? displayName, string? nativeName, int sortOrder, bool codeRequired = true)
    {
        if (codeRequired && !LanguageTag.TryNormalize(code, out _, out _))
        {
            return ("code", "code must be a BCP 47 tag such as vi, en-US or zh-Hans.");
        }

        return PlainText(displayName, "displayName", WebsiteFieldLimits.LanguageName)
            ?? PlainText(nativeName, "nativeName", WebsiteFieldLimits.LanguageName)
            ?? SortOrder(sortOrder);
    }

    public static (string Field, string Message)? LanguageFormat(string? defaultCurrencyCode, string? direction, string? formatLocale)
    {
        if (!string.IsNullOrWhiteSpace(direction) && direction is not ("ltr" or "rtl"))
        {
            return ("direction", "direction must be ltr or rtl.");
        }

        if (!string.IsNullOrWhiteSpace(formatLocale) && !LanguageTag.TryNormalize(formatLocale, out _, out _))
        {
            return ("formatLocale", "formatLocale must be a BCP 47 tag such as fr-FR.");
        }

        return !string.IsNullOrWhiteSpace(defaultCurrencyCode) && !Iso4217.TryNormalize(defaultCurrencyCode, out _)
            ? ("defaultCurrencyCode", "defaultCurrencyCode must be a current ISO 4217 code such as EUR.")
            : null;
    }

    public static (string Field, string Message)? Currency(string? code, string? name, string? symbol, int minorUnits, int sortOrder, bool codeRequired = true)
    {
        if (codeRequired && !Iso4217.TryNormalize(code, out _))
        {
            return ("code", "code must be an active ISO 4217 currency code such as USD.");
        }

        if (PlainText(name, "name", WebsiteFieldLimits.CurrencyName) is { } badName)
        {
            return badName;
        }

        if (PlainText(symbol, "symbol", WebsiteFieldLimits.CurrencySymbol) is { } badSymbol)
        {
            return badSymbol;
        }

        if (minorUnits is < 0 or > WebsiteFieldLimits.MinorUnitsMaximum)
        {
            return ("minorUnits", $"minorUnits must be between 0 and {WebsiteFieldLimits.MinorUnitsMaximum}.");
        }

        return SortOrder(sortOrder);
    }

    public static (string Field, string Message)? Rate(string? text) =>
        ExchangeRate.TryParse(text, out _)
            ? null
            : ("vndPerUnit",
                $"vndPerUnit must be a decimal string such as {RateExample}: digits and one '.', up to " +
                $"{ExchangeRate.IntegerDigits} integer and {ExchangeRate.FractionDigits} fraction digits, greater than zero.");

    public static (string Field, string Message)? Version(int expectedVersion) =>
        expectedVersion < 1 ? ("expectedVersion", "expectedVersion must be the version the editor loaded (1 or more).") : null;

    private static (string Field, string Message)? SortOrder(int sortOrder) =>
        sortOrder is < 0 or > WebsiteFieldLimits.SortOrderMaximum
            ? ("sortOrder", $"sortOrder must be between 0 and {WebsiteFieldLimits.SortOrderMaximum}.")
            : null;
}
