using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2: the public read of the website settings. It exposes only what a visitor may see —
/// active languages, active currencies (which always have a rate), the defaults and a dictionary — and never an audit
/// actor, a draft, a permission or any Staff data. A read sees committed rows only, so an installed pack is visible to
/// the next request after the installer's transaction commits.
///
/// <para>The dictionary is layered, lowest first: the stored content's own text; the built-in pack of the default
/// language; the default language's stored texts; the built-in pack of the requested language; the requested
/// language's stored texts. So a fresh deployment (nothing installed yet) still shows the built-in default language,
/// an incomplete language never shows a raw key, and — in every case — a text from a pack that is not installed is a
/// fallback only: coverage (the Admin's idea of "translated") counts stored texts, never these.</para>
/// </summary>
internal sealed class WebsitePublicReader(TheBhaDbContext database, IContentCatalog content) : IWebsitePublicReader
{
    public async Task<PublicWebsiteConfigDto> GetConfigAsync(CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking()
            .Where(language => language.IsActive)
            .OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)
            .ToListAsync(cancellationToken);
        var currencies = await database.WebsiteCurrencies.AsNoTracking()
            .Where(currency => currency.IsActive && currency.VndPerUnit != null)
            .OrderBy(currency => currency.SortOrder).ThenBy(currency => currency.Code)
            .ToListAsync(cancellationToken);

        // The database guarantees exactly one active default of each kind; a missing one is a broken install, not a state to answer.
        var defaultLanguage = languages.SingleOrDefault(language => language.IsDefault)
            ?? throw new InvalidOperationException("The website settings have no active default language.");
        var defaultCurrency = currencies.SingleOrDefault(currency => currency.IsDefault)
            ?? throw new InvalidOperationException("The website settings have no active default currency.");
        var baseCurrency = currencies.SingleOrDefault(currency => currency.IsBase)
            ?? throw new InvalidOperationException("The website settings have no active base currency.");

        var offered = currencies.Select(currency => currency.Code).ToHashSet(StringComparer.Ordinal);
        var locales = languages.Select(language => new PublicLocaleDto(
            language.Code, language.DisplayName, language.NativeName, language.IsDefault, language.FormatLocale, language.Direction,
            // A language's own currency, only while that currency is on; otherwise the site default.
            language.DefaultCurrencyCode is { } own && offered.Contains(own) ? own : defaultCurrency.Code)).ToList();
        var revision = SourceText.Hash(
            string.Join(',', languages.Select(language => $"{language.Code}:{language.Version}:{language.DefaultCurrencyCode}")) + "|" +
            string.Join(',', currencies.Select(currency => $"{currency.Code}:{currency.Version}")));
        return new PublicWebsiteConfigDto(
            defaultLanguage.Code,
            locales,
            baseCurrency.Code,
            defaultCurrency.Code,
            [.. currencies.Select(currency => new PublicCurrencyDto(
                currency.Code, currency.Name, currency.Symbol, currency.MinorUnits, currency.IsBase, currency.IsDefault,
                ExchangeRate.Format(currency.VndPerUnit!.Value), currency.RateUpdatedAtUtc!.Value))],
            revision);
    }

    public async Task<PublicDictionaryDto> GetDictionaryAsync(PublicDictionaryQuery query, CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking().Where(language => language.IsActive).ToListAsync(cancellationToken);
        var defaultLanguage = languages.SingleOrDefault(language => language.IsDefault)
            ?? throw new InvalidOperationException("The website settings have no active default language.");

        var (requested, resolved) = Resolve(languages, defaultLanguage, query.Locale);

        var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
        var scopes = query.Scopes.Count == 0 ? [MessageScopes.Shared, MessageScopes.Customer, MessageScopes.Content] : query.Scopes;
        bool Wanted(string key) =>
            model.ByKey.TryGetValue(key, out var item) &&
            scopes.Contains(item.Scope, StringComparer.Ordinal) &&
            // A prefix narrows the content scope only (a post, the FAQ, the room names): the UI texts of the other scopes are always whole.
            (item.Scope != MessageScopes.Content || query.Prefixes.Count == 0 || query.Prefixes.Any(prefix => key.StartsWith(prefix, StringComparison.Ordinal)));

        var ids = new[] { defaultLanguage.Id, resolved.Id };
        var rows = await database.WebsiteTranslations.AsNoTracking()
            .Where(row => ids.Contains(row.LanguageId))
            .Select(row => new { row.LanguageId, row.Key, row.Value, row.UpdatedAtUtc, row.Version })
            .ToListAsync(cancellationToken);

        var entries = new SortedDictionary<string, string>(StringComparer.Ordinal);
        void Overlay(IEnumerable<KeyValuePair<string, string>> texts)
        {
            foreach (var (key, value) in texts)
            {
                if (Wanted(key))
                {
                    entries[key] = value;
                }
            }
        }

        Overlay(model.Required.Where(item => item.Content is not null).Select(item => KeyValuePair.Create(item.Key, item.Content!.SourceText)));
        Overlay(LocalizationAssets.BuiltInPack(defaultLanguage.Code)?.All ?? []);
        Overlay(rows.Where(row => row.LanguageId == defaultLanguage.Id).Select(row => KeyValuePair.Create(row.Key, row.Value)));
        if (resolved.Id != defaultLanguage.Id)
        {
            Overlay(LocalizationAssets.BuiltInPack(resolved.Code)?.All ?? []);
            Overlay(rows.Where(row => row.LanguageId == resolved.Id).Select(row => KeyValuePair.Create(row.Key, row.Value)));
        }

        // Every text that could appear is a function of these: the catalog, the two languages, their rows and the content.
        var revision = SourceText.Hash(string.Join('|',
            LocalizationAssets.CatalogRevision, resolved.Code, resolved.Version, defaultLanguage.Version,
            rows.Count, rows.Count == 0 ? 0 : rows.Max(row => row.UpdatedAtUtc.UtcTicks), rows.Sum(row => (long)row.Version),
            SourceText.Hash(string.Join('\n', model.Required.Where(item => item.Content is not null).Select(item => item.Content!.Key + "=" + item.Content.SourceText)))));
        return new PublicDictionaryDto(
            requested,
            resolved.Code,
            defaultLanguage.Code,
            requested is null || !string.Equals(requested, resolved.Code, StringComparison.OrdinalIgnoreCase),
            revision,
            entries);
    }

    /// <summary>The language a request resolves to: the exact tag, then the tag with its region and script dropped (en-US -> en), else the default. Shared with the menu read so both answer in the same language.</summary>
    internal static (string? Requested, WebsiteLanguage Resolved) Resolve(IReadOnlyList<WebsiteLanguage> active, WebsiteLanguage defaultLanguage, string? locale)
    {
        if (!LanguageTag.TryNormalize(locale, out var canonical, out var normalized))
        {
            return (null, defaultLanguage);
        }

        var resolved = Candidates(normalized)
            .Select(candidate => active.SingleOrDefault(language => language.NormalizedCode == candidate))
            .FirstOrDefault(language => language is not null) ?? defaultLanguage;
        return (canonical, resolved);
    }

    private static IEnumerable<string> Candidates(string normalized)
    {
        var parts = normalized.Split('-');
        for (var length = parts.Length; length >= 1; length--)
        {
            yield return string.Join('-', parts.Take(length));
        }
    }
}
