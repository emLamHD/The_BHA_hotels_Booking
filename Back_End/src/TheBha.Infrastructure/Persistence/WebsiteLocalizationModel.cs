using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>One key a language must have a text for: a catalog message, a static content text or a stored-content field.</summary>
internal sealed record RequiredKey(
    string Key,
    string Scope,
    string Group,
    string? Context,
    IReadOnlyList<string> Placeholders,
    ContentEntry? Content);

internal sealed record LanguageCoverage(int Required, int Translated, int Missing, int Outdated, int Manual)
{
    public bool IsComplete => Missing == 0;
}

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: what a language has to cover and how much of it it covers. The required set is
/// the embedded catalog (language-neutral keys) plus the stored-content fields found in the database right now;
/// coverage counts real rows (or the column's own text for the content source language) — a fallback is
/// never counted as translated.
/// </summary>
internal sealed class WebsiteLocalizationModel
{
    private WebsiteLocalizationModel(IReadOnlyList<RequiredKey> required)
    {
        Required = required;
        ByKey = required.ToDictionary(item => item.Key, StringComparer.Ordinal);
    }

    public IReadOnlyList<RequiredKey> Required { get; }

    public IReadOnlyDictionary<string, RequiredKey> ByKey { get; }

    public static async Task<WebsiteLocalizationModel> LoadAsync(IContentCatalog content, CancellationToken cancellationToken)
    {
        var required = new List<RequiredKey>(LocalizationAssets.Catalog.Count + 64);
        foreach (var definition in LocalizationAssets.Catalog)
        {
            required.Add(new RequiredKey(definition.Key, definition.Scope, GroupOf(definition.Key), definition.Context, definition.Placeholders, null));
        }

        foreach (var entry in await content.ListAsync(cancellationToken))
        {
            required.Add(new RequiredKey(entry.Key, MessageScopes.Content, entry.Entity, null, [], entry));
        }

        return new WebsiteLocalizationModel(required);
    }

    /// <summary>The second key segment (<c>customer.<b>header</b>.menu.offers</c>, <c>content.<b>roomType</b>.&lt;id&gt;.name</c>) is the module a person filters by.</summary>
    public static string GroupOf(string key)
    {
        var parts = key.Split('.', 3);
        return parts.Length > 1 ? parts[1] : parts[0];
    }

    /// <summary>The text of every required key in the reference language: its own rows, else (for a built-in language) the built-in pack, else the content column.</summary>
    public async Task<Dictionary<string, string>> ReferenceTextsAsync(
        TheBhaDbContext database, WebsiteLanguage? reference, string referenceLocale, CancellationToken cancellationToken)
    {
        var texts = new Dictionary<string, string>(StringComparer.Ordinal);
        if (LocalizationAssets.BuiltInPack(referenceLocale) is { } pack)
        {
            foreach (var (key, value) in pack.All)
            {
                texts[key] = value;
            }
        }

        if (string.Equals(referenceLocale, ContentSource.Locale, StringComparison.OrdinalIgnoreCase))
        {
            foreach (var item in Required.Where(item => item.Content is not null))
            {
                texts[item.Key] = item.Content!.SourceText;
            }
        }

        if (reference is not null)
        {
            var rows = await database.WebsiteTranslations.AsNoTracking()
                .Where(row => row.LanguageId == reference.Id)
                .Select(row => new { row.Key, row.Value })
                .ToListAsync(cancellationToken);
            foreach (var row in rows)
            {
                texts[row.Key] = row.Value;
            }
        }

        return texts;
    }

    public static string StatusOf(
        RequiredKey item, WebsiteTranslation? own, bool isContentSourceLanguage, bool isReferenceLanguage, IReadOnlyDictionary<string, string> reference)
    {
        var hasValue = own is not null || (isContentSourceLanguage && item.Content is not null);
        if (!hasValue)
        {
            return "missing";
        }

        if (!isReferenceLanguage && own?.SourceHash is { } hash && reference.TryGetValue(item.Key, out var referenceText) &&
            hash != SourceText.Hash(referenceText))
        {
            return "outdated";
        }

        return "translated";
    }

    public LanguageCoverage CoverageOf(
        IReadOnlyDictionary<string, CoverageRow> rows, bool isContentSourceLanguage, bool isReferenceLanguage, IReadOnlyDictionary<string, string> reference)
    {
        int translated = 0, missing = 0, outdated = 0, manual = 0;
        foreach (var item in Required)
        {
            rows.TryGetValue(item.Key, out var row);
            var hasValue = row is not null || (isContentSourceLanguage && item.Content is not null);
            if (!hasValue)
            {
                missing++;
                continue;
            }

            translated++;
            if (row?.IsManual == true)
            {
                manual++;
            }

            if (!isReferenceLanguage && row?.SourceHash is { } hash && reference.TryGetValue(item.Key, out var referenceText) &&
                hash != SourceText.Hash(referenceText))
            {
                outdated++;
            }
        }

        return new LanguageCoverage(Required.Count, translated, missing, outdated, manual);
    }
}

/// <summary>The part of a translation row coverage needs; the value is not loaded.</summary>
internal sealed record CoverageRow(bool IsManual, string? SourceHash);

/// <summary>The one transaction shape every website write uses: the site-wide advisory lock first, then the work; any non-success rolls everything back.</summary>
internal static class WebsiteTransaction
{
    public static async Task<WebsiteMutationResult<T>> InLockAsync<T>(
        TheBhaDbContext database,
        TimeProvider timeProvider,
        Func<DateTimeOffset, Task<WebsiteMutationResult<T>>> work,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await AdvisoryLockCoordinator.AcquireKeyAsync(database, BookingAdvisoryLockKeys.ForWebsiteSettings(), cancellationToken);
            database.ChangeTracker.Clear();
            var result = await work(timeProvider.GetUtcNow());
            if (result.Status == WebsiteMutationStatus.Succeeded)
            {
                await transaction.CommitAsync(cancellationToken);
            }
            else
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            return result;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Unreachable while every writer takes the lock; if one ever does not, the version token still says no.
            await transaction.RollbackAsync(cancellationToken);
            return WebsiteMutationResult<T>.Conflict(WebsiteErrorCodes.StaleVersion, "The row was changed by someone else. Reload and try again.");
        }
    }
}
