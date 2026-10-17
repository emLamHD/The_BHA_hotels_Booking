using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: installs, previews, exports and lists language packs. A pack is data (a JSON file)
/// that is parsed and validated, never executed; installing one is a single transaction under the site-wide lock;
/// a preview is bound by a token to the exact state it was computed from, so applying a stale preview, applying twice
/// or applying after somebody else changed the language changes nothing and says why.
/// </summary>
internal sealed class WebsiteLanguagePackService(
    TheBhaDbContext database, TimeProvider timeProvider, IContentCatalog content, IWebsiteSettingsStore settings) : IWebsiteLanguagePacks
{
    private const int MaxIssues = 300;
    // Entities whose Vietnamese text is a column edited on its own Admin screen (Menu, Hero banner): a pack never rewrites it.
    private static readonly HashSet<string> SourceColumnEntities = ["menuItem", "heroSlideshow", "heroSlide"];

    private static readonly JsonWriterOptions WriterOptions = new() { Indented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    // ------------------------------------------------------------------ library

    public async Task<IReadOnlyList<LibraryPackDto>> ListLibraryAsync(CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking().ToListAsync(cancellationToken);
        var catalogKeys = LocalizationAssets.Catalog.Select(definition => definition.Key).ToList();
        var packs = new List<LibraryPackDto>();
        foreach (var pack in LocalizationAssets.BuiltInPacks)
        {
            LanguageTag.TryNormalize(pack.Locale, out _, out var normalized);
            var installed = languages.SingleOrDefault(language => language.NormalizedCode == normalized);
            var state = installed switch
            {
                null => "available",
                { PackId: null } => "custom",
                _ when installed.PackId != pack.PackId => "custom",
                _ when installed.PackVersion != pack.PackVersion => "update-available",
                _ => "installed"
            };
            var texts = pack.All.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
            packs.Add(new LibraryPackDto(
                pack.PackId, pack.Locale, pack.DisplayName, pack.NativeName, pack.PackVersion, texts.Count,
                catalogKeys.Count(key => !texts.ContainsKey(key)), state, installed?.PackVersion));
        }

        return packs;
    }

    // ------------------------------------------------------------------ preview / apply

    public async Task<WebsiteMutationResult<PackPreviewDto>> PreviewAsync(PackSource source, string mode, CancellationToken cancellationToken)
    {
        if (!PackModes.IsValid(mode))
        {
            return WebsiteMutationResult<PackPreviewDto>.Invalid("mode", "mode must be keep-manual or overwrite.");
        }

        var (pack, failure) = Resolve(source);
        if (pack is null)
        {
            return failure!.ToPreviewFailure();
        }

        var plan = await PlanAsync(pack, mode, source, cancellationToken);
        return WebsiteMutationResult<PackPreviewDto>.Success(plan.Preview);
    }

    public async Task<WebsiteMutationResult<PackApplyResultDto>> ApplyAsync(ApplyPackCommand command, CancellationToken cancellationToken)
    {
        if (!PackModes.IsValid(command.Mode))
        {
            return WebsiteMutationResult<PackApplyResultDto>.Invalid("mode", "mode must be keep-manual or overwrite.");
        }

        var (pack, failure) = Resolve(command.Source);
        if (pack is null)
        {
            return failure!.ToApplyFailure();
        }

        return await WebsiteTransaction.InLockAsync(database, timeProvider, async now =>
        {
            // The preview is recomputed inside the lock against the committed state; the token must still describe it.
            var plan = await PlanAsync(pack, command.Mode, command.Source, cancellationToken);
            if (plan.Preview.PreviewToken != command.PreviewToken)
            {
                return WebsiteMutationResult<PackApplyResultDto>.Conflict(
                    WebsiteErrorCodes.StalePreview, "The language, the pack or the content changed since this preview. Check the pack again before installing it.");
            }

            if (!plan.Preview.CanApply)
            {
                return WebsiteMutationResult<PackApplyResultDto>.Conflict(
                    WebsiteErrorCodes.PackInvalid, $"{plan.Preview.Counts.Rejected} text(s) in the pack are not valid, so nothing was installed.");
            }

            var language = plan.Language;
            if (language is null)
            {
                language = new WebsiteLanguage(Guid.NewGuid(), pack.Locale, pack.DisplayName, pack.NativeName, NextSortOrder(), false, now, command.ActorStaffId);
                language.SetFormat(pack.FormatLocale, pack.Direction, plan.CurrencyToUse, now, command.ActorStaffId);
                database.WebsiteLanguages.Add(language);
            }
            else
            {
                database.WebsiteLanguages.Attach(language);
                if (language.DefaultCurrencyCode is null && plan.CurrencyToUse is not null)
                {
                    language.SetFormat(language.FormatLocale, language.Direction, plan.CurrencyToUse, now, command.ActorStaffId);
                }
            }

            language.SetPack(pack.PackId, pack.PackVersion, now, command.ActorStaffId);
            foreach (var change in plan.Changes)
            {
                if (change.Row is null)
                {
                    database.WebsiteTranslations.Add(new WebsiteTranslation(language.Id, change.Key, change.Text, false, change.SourceHash, now, command.ActorStaffId));
                }
                else
                {
                    database.WebsiteTranslations.Attach(change.Row);
                    change.Row.Change(change.Text, false, change.SourceHash, now, command.ActorStaffId);
                }
            }

            await database.SaveChangesAsync(cancellationToken);

            var enabled = false;
            if (command.Enable && plan.Preview.CanEnable && !language.IsActive && plan.CurrencyUsable)
            {
                language.Edit(language.DisplayName, language.NativeName, language.SortOrder, true, now, command.ActorStaffId);
                await database.SaveChangesAsync(cancellationToken);
                enabled = true;
            }

            var dto = (await settings.ListLanguagesAsync(cancellationToken)).Single(item => item.Code == language.Code);
            return WebsiteMutationResult<PackApplyResultDto>.Success(new PackApplyResultDto(plan.Preview.Counts, enabled || language.IsActive, dto));
        }, cancellationToken);
    }

    private (LanguagePack? Pack, PackFailure? Failure) Resolve(PackSource source)
    {
        if (!string.IsNullOrWhiteSpace(source.BuiltInPackId))
        {
            var builtIn = LocalizationAssets.BuiltInPacks.FirstOrDefault(pack => pack.PackId == source.BuiltInPackId);
            return builtIn is null
                ? (null, PackFailure.NotFound($"There is no built-in pack '{source.BuiltInPackId}'."))
                : (builtIn, null);
        }

        var parsed = LanguagePackParser.Parse(source.Json);
        return parsed.Pack is not null
            ? (parsed.Pack, null)
            : (null, PackFailure.Invalid(string.Join(" ", parsed.Issues.Take(5).Select(issue => issue.Key is null ? issue.Message : $"{issue.Key}: {issue.Message}"))));
    }

    private int NextSortOrder() => Math.Min(WebsiteFieldLimits.SortOrderMaximum, (database.WebsiteLanguages.Max(language => (int?)language.SortOrder) ?? 0) + 10);

    private async Task<Plan> PlanAsync(LanguagePack pack, string mode, PackSource source, CancellationToken cancellationToken)
    {
        LanguageTag.TryNormalize(pack.Locale, out _, out var normalized);
        var language = await database.WebsiteLanguages.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.NormalizedCode == normalized, cancellationToken);
        var defaultLanguage = await database.WebsiteLanguages.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.IsDefault, cancellationToken);
        var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
        var reference = await model.ReferenceTextsAsync(database, defaultLanguage, defaultLanguage?.Code ?? ContentSource.Locale, cancellationToken);
        var existing = language is null
            ? new Dictionary<string, WebsiteTranslation>(StringComparer.Ordinal)
            : (await database.WebsiteTranslations.AsNoTracking().Where(row => row.LanguageId == language.Id).ToListAsync(cancellationToken))
                .ToDictionary(row => row.Key, StringComparer.Ordinal);
        var isReference = language is not null && language.Id == defaultLanguage?.Id;

        var issues = new List<PackIssueDto>();
        int added = 0, updated = 0, unchanged = 0, kept = 0, overwritten = 0, ignored = 0, rejected = 0;
        var changes = new List<Change>();
        var coveredKeys = new HashSet<string>(StringComparer.Ordinal);
        void Issue(string? key, string severity, string code, string message)
        {
            if (issues.Count < MaxIssues)
            {
                issues.Add(new PackIssueDto(key, severity, code, message));
            }
        }

        // The content source language's text of a menu entry is the menu row's own column, edited on the Menu screen: a pack for
        // that language never creates or changes a stored text for it (it would silently undo a rename). Other languages carry them by id.
        var isContentSource = string.Equals(normalized, ContentSource.Locale, StringComparison.OrdinalIgnoreCase);
        var inPack = 0;
        foreach (var (key, text) in pack.All)
        {
            inPack++;
            if (!model.ByKey.TryGetValue(key, out var item))
            {
                ignored++;
                Issue(key, "info", ContentKey.TryParse(key, out _, out _, out _) ? "unknown-content" : "unknown-key",
                    ContentKey.TryParse(key, out _, out _, out _) ? "This content does not exist in this site; it was skipped." : "This key is not in the catalog; it was skipped.");
                continue;
            }

            if (isContentSource && item.Content is { } owned && SourceColumnEntities.Contains(owned.Entity))
            {
                ignored++;
                Issue(key, "info", "source-column", "The Vietnamese text of a menu entry or of the home banner is edited on its own Admin screen; the pack does not change it.");
                continue;
            }

            if (TranslationText.Validate(text, item.Placeholders) is { } problem)
            {
                rejected++;
                Issue(key, "error", "invalid-text", problem);
                continue;
            }

            var value = text.Trim();
            var sourceHash = isReference ? null : pack.Sources.TryGetValue(key, out var declared) ? declared : reference.TryGetValue(key, out var referenceText) ? SourceText.Hash(referenceText) : null;
            existing.TryGetValue(key, out var row);
            coveredKeys.Add(key);
            if (row is null)
            {
                added++;
                changes.Add(new Change(key, value, sourceHash, null));
            }
            else if (row.Value == value)
            {
                unchanged++;
            }
            else if (row.IsManual && mode == PackModes.KeepManual)
            {
                kept++;
            }
            else
            {
                updated++;
                if (row.IsManual)
                {
                    overwritten++;
                }

                changes.Add(new Change(key, value, sourceHash, row));
            }
        }

        var missingAfter = model.Required.Count(item =>
            !existing.ContainsKey(item.Key) && !coveredKeys.Contains(item.Key) && !(isContentSource && item.Content is not null));
        var obsolete = existing.Keys.Count(key => !model.ByKey.ContainsKey(key));

        // The pack's default currency is used only when it exists on this site; otherwise the language keeps the site default.
        string? currencyToUse = null;
        var currencyUsable = true;
        if (pack.DefaultCurrency is { } wanted)
        {
            var currency = await database.WebsiteCurrencies.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Code == wanted, cancellationToken);
            if (currency is null)
            {
                Issue(null, "warning", "currency-missing", $"The pack's default currency {wanted} is not set up on this site, so the language will use the site default until you add it.");
            }
            else
            {
                currencyToUse = wanted;
                currencyUsable = currency.IsActive;
                if (!currency.IsActive)
                {
                    Issue(null, "warning", "currency-off", $"The pack's default currency {wanted} is off (or has no rate); turn it on before turning the language on.");
                }
            }
        }

        var effectiveCurrency = language?.DefaultCurrencyCode ?? currencyToUse;
        var canApply = rejected == 0;
        var canEnable = canApply && missingAfter == 0 && (effectiveCurrency is null || (language?.DefaultCurrencyCode is { } own
            ? await CurrencyOnAsync(own, cancellationToken)
            : currencyUsable));
        var counts = new PackCounts(model.Required.Count, inPack, added, updated, unchanged, kept, overwritten, ignored, rejected, missingAfter, obsolete);
        var token = SourceText.Hash(string.Join('|',
            pack.Locale, mode, source.BuiltInPackId ?? SourceText.Hash(source.Json), pack.PackId, pack.PackVersion,
            language?.Version ?? 0, existing.Count, existing.Count == 0 ? 0 : existing.Values.Max(row => row.UpdatedAtUtc.UtcTicks), existing.Values.Sum(row => (long)row.Version),
            LocalizationAssets.CatalogRevision,
            SourceText.Hash(string.Join('\n', model.Required.Where(item => item.Content is not null).Select(item => item.Content!.Key + "=" + item.Content.SourceText)))));
        var preview = new PackPreviewDto(
            pack.Locale, pack.DisplayName, pack.NativeName, pack.PackId, pack.PackVersion, mode, language is null, language?.Version, pack.DefaultCurrency,
            counts, issues, issues.Count >= MaxIssues, canApply, canEnable, token);
        return new Plan(preview, language, changes, currencyToUse, currencyUsable);
    }

    private async Task<bool> CurrencyOnAsync(string code, CancellationToken cancellationToken) =>
        await database.WebsiteCurrencies.AsNoTracking().AnyAsync(currency => currency.Code == code && currency.IsActive, cancellationToken);

    // ------------------------------------------------------------------ export / template

    public async Task<WebsiteMutationResult<string>> ExportAsync(string locale, CancellationToken cancellationToken)
    {
        if (!LanguageTag.TryNormalize(locale, out _, out var normalized) ||
            await database.WebsiteLanguages.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.NormalizedCode == normalized, cancellationToken) is not { } language)
        {
            return WebsiteMutationResult<string>.NotFound($"The language {locale} does not exist.");
        }

        var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
        var rows = await database.WebsiteTranslations.AsNoTracking().Where(row => row.LanguageId == language.Id).ToListAsync(cancellationToken);
        var texts = rows.Where(row => model.ByKey.ContainsKey(row.Key)).ToDictionary(row => row.Key, row => row.Value, StringComparer.Ordinal);
        var sources = rows.Where(row => model.ByKey.ContainsKey(row.Key) && row.SourceHash is not null).ToDictionary(row => row.Key, row => row.SourceHash!, StringComparer.Ordinal);
        var isContentSource = string.Equals(language.NormalizedCode, ContentSource.Locale, StringComparison.OrdinalIgnoreCase);
        if (isContentSource)
        {
            // The content source language's text is the stored column; it is the text a pack for that language carries.
            foreach (var item in model.Required.Where(item => item.Content is not null && !texts.ContainsKey(item.Key)))
            {
                texts[item.Key] = item.Content!.SourceText;
            }
        }

        var translated = model.Required.Count(item => texts.ContainsKey(item.Key));
        return WebsiteMutationResult<string>.Success(Write(
            language.Code, language.DisplayName, language.NativeName, language.Direction, language.FormatLocale, language.DefaultCurrencyCode,
            language.PackId ?? $"custom-{language.NormalizedCode}", language.PackVersion ?? timeProvider.GetUtcNow().ToString("yyyy.MM.dd"),
            texts, sources,
            new ExportInfo(timeProvider.GetUtcNow(), model.Required.Count, translated, model.Required.Count - translated)));
    }

    public async Task<string> TemplateAsync(string? referenceLocale, CancellationToken cancellationToken)
    {
        var defaultLanguage = await database.WebsiteLanguages.AsNoTracking().SingleOrDefaultAsync(language => language.IsDefault, cancellationToken);
        var reference = LanguageTag.TryNormalize(referenceLocale, out _, out var normalized)
            ? await database.WebsiteLanguages.AsNoTracking().SingleOrDefaultAsync(language => language.NormalizedCode == normalized, cancellationToken) ?? defaultLanguage
            : defaultLanguage;
        var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
        var referenceTexts = await model.ReferenceTextsAsync(database, reference, reference?.Code ?? ContentSource.Locale, cancellationToken);
        var texts = model.Required.Where(item => referenceTexts.ContainsKey(item.Key)).ToDictionary(item => item.Key, item => referenceTexts[item.Key], StringComparer.Ordinal);
        // "und" is a valid placeholder tag: the translator replaces it, the names and every text below.
        return Write("und", string.Empty, string.Empty, "ltr", null, null, "my-language-pack", "1", texts, new Dictionary<string, string>(),
            new ExportInfo(timeProvider.GetUtcNow(), model.Required.Count, 0, model.Required.Count),
            reference?.Code ?? ContentSource.Locale);
    }

    private sealed record ExportInfo(DateTimeOffset GeneratedAtUtc, int RequiredKeys, int TranslatedKeys, int MissingKeys);

    private static string Write(
        string locale, string displayName, string nativeName, string direction, string? formatLocale, string? defaultCurrency,
        string packId, string packVersion, IReadOnlyDictionary<string, string> texts, IReadOnlyDictionary<string, string> sources, ExportInfo info,
        string referenceLocale = ContentSource.Locale)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("schema", LanguagePack.SchemaId);
            writer.WriteString("locale", locale);
            writer.WriteString("displayName", displayName);
            writer.WriteString("nativeName", nativeName);
            writer.WriteString("direction", direction);
            writer.WriteString("formatLocale", formatLocale ?? locale);
            if (defaultCurrency is not null)
            {
                writer.WriteString("defaultCurrency", defaultCurrency);
            }

            writer.WriteStartObject("pack");
            writer.WriteString("id", packId);
            writer.WriteString("version", packVersion);
            writer.WriteString("catalogRevision", LocalizationAssets.CatalogRevision);
            writer.WriteEndObject();
            writer.WriteString("referenceLocale", referenceLocale);
            writer.WriteStartObject("export");
            writer.WriteString("generatedAtUtc", info.GeneratedAtUtc);
            writer.WriteNumber("requiredKeys", info.RequiredKeys);
            writer.WriteNumber("translatedKeys", info.TranslatedKeys);
            writer.WriteNumber("missingKeys", info.MissingKeys);
            writer.WriteEndObject();
            writer.WriteStartObject("messages");
            foreach (var scope in MessageScopes.Ui)
            {
                writer.WriteStartObject(scope);
                foreach (var (key, text) in texts.Where(pair => pair.Key.StartsWith(scope + ".", StringComparison.Ordinal)).OrderBy(pair => pair.Key, StringComparer.Ordinal))
                {
                    writer.WriteString(key, text);
                }

                writer.WriteEndObject();
            }

            writer.WriteEndObject();
            writer.WriteStartObject("content");
            foreach (var (key, text) in texts.Where(pair => pair.Key.StartsWith(ContentKey.Prefix, StringComparison.Ordinal)).OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                writer.WriteString(key, text);
            }

            writer.WriteEndObject();
            writer.WriteStartObject("sources");
            foreach (var (key, hash) in sources.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                writer.WriteString(key, hash);
            }

            writer.WriteEndObject();
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private sealed record Change(string Key, string Text, string? SourceHash, WebsiteTranslation? Row);

    private sealed record Plan(PackPreviewDto Preview, WebsiteLanguage? Language, List<Change> Changes, string? CurrencyToUse, bool CurrencyUsable);

    private sealed record PackFailure(WebsiteMutationStatus Status, string Message)
    {
        public static PackFailure NotFound(string message) => new(WebsiteMutationStatus.NotFound, message);

        public static PackFailure Invalid(string message) => new(WebsiteMutationStatus.Invalid, message);

        public WebsiteMutationResult<PackPreviewDto> ToPreviewFailure() =>
            Status == WebsiteMutationStatus.NotFound
                ? WebsiteMutationResult<PackPreviewDto>.NotFound(Message)
                : WebsiteMutationResult<PackPreviewDto>.Conflict(WebsiteErrorCodes.PackInvalid, Message, "pack");

        public WebsiteMutationResult<PackApplyResultDto> ToApplyFailure() =>
            Status == WebsiteMutationStatus.NotFound
                ? WebsiteMutationResult<PackApplyResultDto>.NotFound(Message)
                : WebsiteMutationResult<PackApplyResultDto>.Conflict(WebsiteErrorCodes.PackInvalid, Message, "pack");
    }
}
