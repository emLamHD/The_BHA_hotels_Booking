using TheBha.Domain.Website;

namespace TheBha.Application.Website;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: contracts for installing, exporting and listing language packs, for the stored
/// content a translation can refer to, and for the display-price projection.
/// </summary>

/// <summary>The language whose text the stored catalog columns (property, room type, amenity…) are written in. The database holds one text per field; a <c>vi</c> content row, when present, overrides it.</summary>
public static class ContentSource
{
    public const string Locale = "vi";
}

/// <summary>One translatable field of stored content. <c>SourceText</c> is the column's text.</summary>
public sealed record ContentEntry(string Key, string Entity, string Id, string Field, string SourceText);

public interface IContentCatalog
{
    Task<IReadOnlyList<ContentEntry>> ListAsync(CancellationToken cancellationToken);
}

public static class PackModes
{
    public const string KeepManual = "keep-manual";
    public const string Overwrite = "overwrite";

    public static bool IsValid(string? mode) => mode is KeepManual or Overwrite;
}

/// <summary>A pack from the built-in library (<c>BuiltInPackId</c>) or an uploaded file's text (<c>Json</c>); never a URL.</summary>
public sealed record PackSource(string? BuiltInPackId, string? Json);

public sealed record PackIssueDto(string? Key, string Severity, string Code, string Message);

public sealed record PackCounts(
    int Required,
    int InPack,
    int Added,
    int Updated,
    int Unchanged,
    int KeptManual,
    int OverwrittenManual,
    int Ignored,
    int Rejected,
    int MissingAfter,
    int Obsolete);

public sealed record PackPreviewDto(
    string Locale,
    string DisplayName,
    string NativeName,
    string PackId,
    string PackVersion,
    string Mode,
    bool IsNewLanguage,
    int? LanguageVersion,
    string? DefaultCurrency,
    PackCounts Counts,
    IReadOnlyList<PackIssueDto> Issues,
    bool IssuesTruncated,
    bool CanApply,
    bool CanEnable,
    string PreviewToken);

public sealed record ApplyPackCommand(PackSource Source, string Mode, string PreviewToken, bool Enable, Guid ActorStaffId);

public sealed record PackApplyResultDto(PackCounts Counts, bool Enabled, WebsiteLanguageDto Language);

public sealed record LibraryPackDto(
    string Id,
    string Locale,
    string DisplayName,
    string NativeName,
    string Version,
    int Texts,
    int MissingFromCatalog,
    string State,
    string? InstalledVersion);

public interface IWebsiteLanguagePacks
{
    Task<IReadOnlyList<LibraryPackDto>> ListLibraryAsync(CancellationToken cancellationToken);

    /// <summary>Validates a pack and reports what installing it would do. Nothing is changed.</summary>
    Task<WebsiteMutationResult<PackPreviewDto>> PreviewAsync(PackSource source, string mode, CancellationToken cancellationToken);

    /// <summary>Installs a pack atomically. The preview token must still describe the current state, or nothing is applied.</summary>
    Task<WebsiteMutationResult<PackApplyResultDto>> ApplyAsync(ApplyPackCommand command, CancellationToken cancellationToken);

    /// <summary>The language as a pack file: only values that exist (a fallback is never exported as if translated).</summary>
    Task<WebsiteMutationResult<string>> ExportAsync(string locale, CancellationToken cancellationToken);

    /// <summary>An empty pack for a translator: every required key with the reference language's text.</summary>
    Task<string> TemplateAsync(string? referenceLocale, CancellationToken cancellationToken);
}

// ---- display prices ----

public sealed record DisplayPriceLine(string Ref, string UnitVnd, int Quantity);

public sealed record DisplayPriceSum(string Ref, IReadOnlyList<string> Of);

public sealed record DisplayPriceRequest(string Currency, IReadOnlyList<DisplayPriceLine> Lines, IReadOnlyList<DisplayPriceSum>? Sums);

public sealed record DisplayPriceRate(string VndPerUnit, DateTimeOffset UpdatedAtUtc, int Version);

public sealed record DisplayPriceLineResult(string Ref, string Unit, int Quantity, string Total);

public sealed record DisplayPriceSumResult(string Ref, string Total);

public sealed record DisplayPriceResponse(
    string Currency,
    int MinorUnits,
    bool IsBase,
    DisplayPriceRate Rate,
    IReadOnlyList<DisplayPriceLineResult> Lines,
    IReadOnlyList<DisplayPriceSumResult> Sums);

public interface IWebsiteDisplayPricing
{
    /// <summary>All lines of a request are converted with one rate snapshot. A currency that is off, unknown or without a rate is refused, never answered with a made-up rate.</summary>
    Task<WebsiteMutationResult<DisplayPriceResponse>> QuoteAsync(DisplayPriceRequest request, CancellationToken cancellationToken);
}
