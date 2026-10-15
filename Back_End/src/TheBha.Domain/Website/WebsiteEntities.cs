using TheBha.Domain.Common;

namespace TheBha.Domain.Website;

/// <summary>
/// A language the website can be shown in. The <see cref="Code"/> is its stable identity (changing it means a
/// new row); everything else is editable. Exactly one row is the default, it is always active, and it has a
/// value for every managed translation key. Those cross-row rules are the store's and the database's, under
/// one lock; this type keeps only what a single row can decide.
/// </summary>
public sealed class WebsiteLanguage
{
    private WebsiteLanguage()
    {
    }

    public WebsiteLanguage(
        Guid id,
        string code,
        string displayName,
        string nativeName,
        int sortOrder,
        bool isActive,
        DateTimeOffset nowUtc,
        Guid? actorStaffId)
    {
        if (!LanguageTag.TryNormalize(code, out var canonical, out var normalized))
        {
            throw new DomainException("code must be a BCP 47 tag such as vi, en-US or zh-Hans.");
        }

        Id = DomainGuard.RequiredId(id, nameof(id));
        Code = canonical;
        NormalizedCode = normalized;
        DisplayName = DomainGuard.Required(displayName, nameof(displayName), WebsiteFieldLimits.LanguageName);
        NativeName = DomainGuard.Required(nativeName, nameof(nativeName), WebsiteFieldLimits.LanguageName);
        SortOrder = CheckSortOrder(sortOrder);
        IsActive = isActive;
        FormatLocale = canonical;
        Version = 1;
        CreatedAtUtc = UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }

    public Guid Id { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public string NormalizedCode { get; private set; } = string.Empty;
    public string DisplayName { get; private set; } = string.Empty;
    public string NativeName { get; private set; } = string.Empty;
    public int SortOrder { get; private set; }
    public bool IsActive { get; private set; }
    public bool IsDefault { get; private set; }
    public int Version { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }

    /// <summary>The currency a visitor gets when they pick this language (<c>null</c> = the site's default currency). Data, not code: nothing switches on a language code.</summary>
    public string? DefaultCurrencyCode { get; private set; }

    /// <summary><c>ltr</c> or <c>rtl</c>.</summary>
    public string Direction { get; private set; } = "ltr";

    /// <summary>The BCP 47 tag handed to <c>Intl</c> for dates, numbers and plurals; defaults to the code.</summary>
    public string FormatLocale { get; private set; } = string.Empty;

    /// <summary>The language pack this language was last installed from, and its version; <c>null</c> for a hand-made language.</summary>
    public string? PackId { get; private set; }

    public string? PackVersion { get; private set; }

    public void Edit(string displayName, string nativeName, int sortOrder, bool isActive, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        DisplayName = DomainGuard.Required(displayName, nameof(displayName), WebsiteFieldLimits.LanguageName);
        NativeName = DomainGuard.Required(nativeName, nameof(nativeName), WebsiteFieldLimits.LanguageName);
        SortOrder = CheckSortOrder(sortOrder);
        IsActive = isActive;
        Touch(nowUtc, actorStaffId);
    }

    /// <summary>Sets the format locale, direction and default currency without a new version: for a language that is being created.</summary>
    public void InitializeFormat(string? formatLocale, string direction, string? defaultCurrencyCode)
    {
        if (direction is not ("ltr" or "rtl"))
        {
            throw new DomainException("direction must be ltr or rtl.");
        }

        var format = string.IsNullOrWhiteSpace(formatLocale) ? Code : formatLocale.Trim();
        if (!LanguageTag.TryNormalize(format, out var canonical, out _))
        {
            throw new DomainException("formatLocale must be a BCP 47 tag such as fr-FR.");
        }

        FormatLocale = canonical;
        Direction = direction;
        DefaultCurrencyCode = string.IsNullOrWhiteSpace(defaultCurrencyCode) ? null : defaultCurrencyCode.Trim().ToUpperInvariant();
    }

    /// <summary>The currency itself is validated against <c>WebsiteCurrencies</c> by the store. One change, one new version.</summary>
    public void SetFormat(string? formatLocale, string direction, string? defaultCurrencyCode, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        InitializeFormat(formatLocale, direction, defaultCurrencyCode);
        Touch(nowUtc, actorStaffId);
    }

    /// <summary>An edit of everything an operator can change on a language, as one new version.</summary>
    public void Edit(
        string displayName, string nativeName, int sortOrder, bool isActive,
        string? formatLocale, string direction, string? defaultCurrencyCode, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        DisplayName = DomainGuard.Required(displayName, nameof(displayName), WebsiteFieldLimits.LanguageName);
        NativeName = DomainGuard.Required(nativeName, nameof(nativeName), WebsiteFieldLimits.LanguageName);
        SortOrder = CheckSortOrder(sortOrder);
        IsActive = isActive;
        InitializeFormat(formatLocale, direction, defaultCurrencyCode);
        Touch(nowUtc, actorStaffId);
    }

    public void SetPack(string? packId, string? packVersion, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        PackId = string.IsNullOrWhiteSpace(packId) ? null : DomainGuard.Required(packId, nameof(packId), WebsiteFieldLimits.PackId);
        PackVersion = string.IsNullOrWhiteSpace(packVersion) ? null : DomainGuard.Required(packVersion, nameof(packVersion), WebsiteFieldLimits.PackVersion);
        Touch(nowUtc, actorStaffId);
    }

    public void MarkDefault(bool isDefault, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        IsDefault = isDefault;
        Touch(nowUtc, actorStaffId);
    }

    internal static int CheckSortOrder(int value) =>
        value is >= 0 and <= WebsiteFieldLimits.SortOrderMaximum
            ? value
            : throw new DomainException($"sortOrder must be between 0 and {WebsiteFieldLimits.SortOrderMaximum}.");

    private void Touch(DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        Version++;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }
}

/// <summary>
/// One administered value of one managed key in one language. A language other than the default has a row only
/// where an operator overrode the default; removing the row returns that key to the default's text.
/// </summary>
public sealed class WebsiteTranslation
{
    private WebsiteTranslation()
    {
    }

    public WebsiteTranslation(Guid languageId, string key, string value, bool isManual, string? sourceHash, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        LanguageId = DomainGuard.RequiredId(languageId, nameof(languageId));
        Key = DomainGuard.Required(key, nameof(key), WebsiteFieldLimits.TranslationKey);
        Value = value;
        IsManual = isManual;
        SourceHash = sourceHash;
        Version = 1;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }

    public Guid LanguageId { get; private set; }
    public string Key { get; private set; } = string.Empty;
    public string Value { get; private set; } = string.Empty;
    public int Version { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }

    /// <summary>True when a person typed or confirmed this value in the editor; a pack installed with "keep my edits" never replaces it.</summary>
    public bool IsManual { get; private set; }

    /// <summary>Hash of the reference-language text this value was translated from; a different hash now means the translation is outdated. <c>null</c> = unknown.</summary>
    public string? SourceHash { get; private set; }

    public void Change(string value, bool isManual, string? sourceHash, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        Value = value;
        IsManual = isManual;
        SourceHash = sourceHash;
        Version++;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }

    public void Place(bool isManual, string? sourceHash)
    {
        IsManual = isManual;
        SourceHash = sourceHash;
    }
}

/// <summary>
/// A currency the site may show a reference price in. VND is the fixed base (rate 1, no decimals, never
/// changed or removed here); every other currency has no rate until an operator types one, and cannot be
/// active or the display default without it. The rate is <c>VndPerUnit</c> — see <see cref="ExchangeRate"/>.
/// Reference amounts only: nothing here changes a stored price, a hold or a reservation.
/// </summary>
public sealed class WebsiteCurrency
{
    private WebsiteCurrency()
    {
    }

    public WebsiteCurrency(
        string code,
        string name,
        string symbol,
        int minorUnits,
        int sortOrder,
        DateTimeOffset nowUtc,
        Guid? actorStaffId)
    {
        if (!Iso4217.TryNormalize(code, out var normalized))
        {
            throw new DomainException("code must be an active ISO 4217 currency code such as USD.");
        }

        Code = normalized;
        Name = DomainGuard.Required(name, nameof(name), WebsiteFieldLimits.CurrencyName);
        Symbol = DomainGuard.Required(symbol, nameof(symbol), WebsiteFieldLimits.CurrencySymbol);
        MinorUnits = CheckMinorUnits(minorUnits);
        SortOrder = WebsiteLanguage.CheckSortOrder(sortOrder);
        RateSource = WebsiteFieldLimits.ManualRateSource;
        Version = 1;
        CreatedAtUtc = UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }

    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string Symbol { get; private set; } = string.Empty;
    public int MinorUnits { get; private set; }
    public int SortOrder { get; private set; }
    public bool IsActive { get; private set; }
    public bool IsDefault { get; private set; }
    public bool IsBase { get; private set; }
    public decimal? VndPerUnit { get; private set; }
    public DateTimeOffset? RateUpdatedAtUtc { get; private set; }
    public Guid? RateUpdatedByStaffId { get; private set; }
    public string RateSource { get; private set; } = WebsiteFieldLimits.ManualRateSource;
    public int Version { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }

    public bool HasRate => VndPerUnit is > 0m;

    public void Edit(string name, string symbol, int minorUnits, int sortOrder, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        Name = DomainGuard.Required(name, nameof(name), WebsiteFieldLimits.CurrencyName);
        Symbol = DomainGuard.Required(symbol, nameof(symbol), WebsiteFieldLimits.CurrencySymbol);
        MinorUnits = CheckMinorUnits(minorUnits);
        SortOrder = WebsiteLanguage.CheckSortOrder(sortOrder);
        Touch(nowUtc, actorStaffId);
    }

    public void SetRate(decimal vndPerUnit, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        if (vndPerUnit <= 0m)
        {
            throw new DomainException("vndPerUnit must be greater than zero.");
        }

        VndPerUnit = vndPerUnit;
        RateUpdatedAtUtc = nowUtc;
        RateUpdatedByStaffId = actorStaffId;
        RateSource = WebsiteFieldLimits.ManualRateSource;
        Touch(nowUtc, actorStaffId);
    }

    public void SetActive(bool isActive, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        IsActive = isActive;
        Touch(nowUtc, actorStaffId);
    }

    public void MarkDefault(bool isDefault, DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        IsDefault = isDefault;
        Touch(nowUtc, actorStaffId);
    }

    private static int CheckMinorUnits(int value) =>
        value is >= 0 and <= WebsiteFieldLimits.MinorUnitsMaximum
            ? value
            : throw new DomainException($"minorUnits must be between 0 and {WebsiteFieldLimits.MinorUnitsMaximum}.");

    private void Touch(DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        Version++;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }
}
