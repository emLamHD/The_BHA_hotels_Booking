using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the public read of the website settings. It exposes only what a visitor may see —
/// active languages, active currencies (which always have a rate), the two defaults and one dictionary — and
/// never an audit actor, a timestamp of who changed what, a draft or a permission. A read sees committed rows
/// only, so a change is visible to the next request after the writer's transaction commits.
/// </summary>
internal sealed class WebsitePublicReader(TheBhaDbContext database) : IWebsitePublicReader
{
    private static readonly string[] CatalogKeys = [.. WebsiteTranslationCatalog.All.Select(definition => definition.Key)];

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

        return new PublicWebsiteConfigDto(
            defaultLanguage.Code,
            [.. languages.Select(language => new PublicLocaleDto(language.Code, language.DisplayName, language.NativeName, language.IsDefault))],
            baseCurrency.Code,
            defaultCurrency.Code,
            [.. currencies.Select(currency => new PublicCurrencyDto(
                currency.Code, currency.Name, currency.Symbol, currency.MinorUnits, currency.IsBase, currency.IsDefault,
                ExchangeRate.Format(currency.VndPerUnit!.Value), currency.RateUpdatedAtUtc!.Value))]);
    }

    public async Task<PublicDictionaryDto> GetDictionaryAsync(string? requestedLocale, CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking().Where(language => language.IsActive).ToListAsync(cancellationToken);
        var defaultLanguage = languages.SingleOrDefault(language => language.IsDefault)
            ?? throw new InvalidOperationException("The website settings have no active default language.");

        string? requested = null;
        var resolved = defaultLanguage;
        if (LanguageTag.TryNormalize(requestedLocale, out var canonical, out var normalized))
        {
            requested = canonical;
            // Exact tag first, then the tag with its region and then its script dropped (en-US -> en).
            resolved = Candidates(normalized)
                .Select(candidate => languages.SingleOrDefault(language => language.NormalizedCode == candidate))
                .FirstOrDefault(language => language is not null) ?? defaultLanguage;
        }

        var rows = await database.WebsiteTranslations.AsNoTracking()
            .Where(row => (row.LanguageId == defaultLanguage.Id || row.LanguageId == resolved.Id) && CatalogKeys.Contains(row.Key))
            .ToListAsync(cancellationToken);
        var entries = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var row in rows.Where(row => row.LanguageId == defaultLanguage.Id))
        {
            entries[row.Key] = row.Value;
        }

        if (resolved.Id != defaultLanguage.Id)
        {
            foreach (var row in rows.Where(row => row.LanguageId == resolved.Id))
            {
                entries[row.Key] = row.Value;
            }
        }

        return new PublicDictionaryDto(
            requested,
            resolved.Code,
            defaultLanguage.Code,
            requested is null || !string.Equals(requested, resolved.Code, StringComparison.OrdinalIgnoreCase),
            entries);
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
