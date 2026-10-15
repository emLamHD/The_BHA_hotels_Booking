using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2: the admin half of the website localisation settings. Every mutation is one
/// transaction that takes the site-wide advisory lock first (before any read), compares the caller's
/// <c>ExpectedVersion</c> against the row it then reads, and applies the cross-row rules — exactly one default
/// of each kind, a default is active, an active language is complete, an active currency has a rate, VND is
/// fixed — as ordered statements, so two requests can never leave zero or two defaults or an active currency
/// without a rate. The CHECK constraints, the partial unique indexes and the deferred triggers of the
/// migrations repeat those rules in the database for anything that bypasses this class.
/// </summary>
internal sealed class WebsiteSettingsStore(TheBhaDbContext database, TimeProvider timeProvider, IContentCatalog content) : IWebsiteSettingsStore
{
    private const int DefaultPageSize = 50;
    private const int MaximumPageSize = 200;

    // ------------------------------------------------------------------ reads

    public async Task<IReadOnlyList<WebsiteLanguageDto>> ListLanguagesAsync(CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking()
            .OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)
            .ToListAsync(cancellationToken);
        var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
        var coverage = await CoverageByLanguageAsync(model, languages, cancellationToken);
        return [.. languages.Select(language => ToDto(language, coverage[language.Id]))];
    }

    public async Task<WebsiteTranslationListDto?> ListTranslationsAsync(TranslationQuery query, CancellationToken cancellationToken)
    {
        if (!LanguageTag.TryNormalize(query.Locale, out _, out var normalized))
        {
            return null;
        }

        var languages = await database.WebsiteLanguages.AsNoTracking().ToListAsync(cancellationToken);
        var language = languages.SingleOrDefault(candidate => candidate.NormalizedCode == normalized);
        var defaultLanguage = languages.SingleOrDefault(candidate => candidate.IsDefault);
        if (language is null || defaultLanguage is null)
        {
            return null;
        }

        var referenceLanguage = LanguageTag.TryNormalize(query.ReferenceLocale, out _, out var referenceNormalized)
            ? languages.SingleOrDefault(candidate => candidate.NormalizedCode == referenceNormalized) ?? defaultLanguage
            : defaultLanguage;
        var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
        var reference = await model.ReferenceTextsAsync(database, referenceLanguage, referenceLanguage.Code, cancellationToken);
        var own = (await database.WebsiteTranslations.AsNoTracking().Where(row => row.LanguageId == language.Id).ToListAsync(cancellationToken))
            .ToDictionary(row => row.Key, StringComparer.Ordinal);
        var isContentSource = IsContentSource(language);
        var isReference = language.Id == referenceLanguage.Id;

        var all = model.Required
            .Select(item => (Item: item, Row: own.GetValueOrDefault(item.Key), Status: WebsiteLocalizationModel.StatusOf(item, own.GetValueOrDefault(item.Key), isContentSource, isReference, reference)))
            .ToList();
        var facets = new TranslationFacets(
            all.Count,
            all.Count(entry => entry.Status != "missing"),
            all.Count(entry => entry.Status == "missing"),
            all.Count(entry => entry.Status == "outdated"),
            all.Count(entry => entry.Row?.IsManual == true),
            [.. all.GroupBy(entry => entry.Item.Scope).OrderBy(group => group.Key, StringComparer.Ordinal).Select(group => new FacetCount(group.Key, group.Count()))],
            [.. all.Where(entry => string.IsNullOrEmpty(query.Scope) || entry.Item.Scope == query.Scope)
                .GroupBy(entry => entry.Item.Group).OrderBy(group => group.Key, StringComparer.Ordinal).Select(group => new FacetCount(group.Key, group.Count()))]);

        var needle = query.Search?.Trim();
        var filtered = all
            .Where(entry => string.IsNullOrEmpty(query.Scope) || entry.Item.Scope == query.Scope)
            .Where(entry => string.IsNullOrEmpty(query.Group) || entry.Item.Group == query.Group)
            .Where(entry => query.Status switch
            {
                "missing" => entry.Status == "missing",
                "outdated" => entry.Status == "outdated",
                "translated" => entry.Status != "missing",
                "manual" => entry.Row?.IsManual == true,
                "todo" => entry.Status != "translated",
                _ => true
            })
            .Where(entry => string.IsNullOrEmpty(needle) ||
                            entry.Item.Key.Contains(needle, StringComparison.OrdinalIgnoreCase) ||
                            (reference.GetValueOrDefault(entry.Item.Key) ?? string.Empty).Contains(needle, StringComparison.OrdinalIgnoreCase) ||
                            (entry.Row?.Value ?? string.Empty).Contains(needle, StringComparison.OrdinalIgnoreCase))
            .ToList();

        var pageSize = Math.Clamp(query.PageSize <= 0 ? DefaultPageSize : query.PageSize, 1, MaximumPageSize);
        var page = Math.Max(1, query.Page);
        var rows = filtered.Skip((page - 1) * pageSize).Take(pageSize)
            .Select(entry => BuildRow(entry.Item, entry.Row, entry.Status, reference))
            .ToList();
        return new WebsiteTranslationListDto(
            language.Code, referenceLanguage.Code, defaultLanguage.Code, language.IsDefault, filtered.Count, page, pageSize, facets, rows);
    }

    public async Task<IReadOnlyList<WebsiteCurrencyDto>> ListCurrenciesAsync(CancellationToken cancellationToken) =>
        [.. (await database.WebsiteCurrencies.AsNoTracking()
                .OrderBy(currency => currency.SortOrder).ThenBy(currency => currency.Code)
                .ToListAsync(cancellationToken))
            .Select(ToDto)];

    // --------------------------------------------------------------- languages

    public async Task<WebsiteMutationResult<WebsiteLanguageDto>> CreateLanguageAsync(
        CreateLanguageCommand command, CancellationToken cancellationToken)
    {
        if ((WebsiteInputValidation.Language(command.Code, command.DisplayName, command.NativeName, command.SortOrder)
             ?? WebsiteInputValidation.LanguageFormat(command.DefaultCurrencyCode, command.Direction, command.FormatLocale)) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteLanguageDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async now =>
        {
            var language = new WebsiteLanguage(
                Guid.NewGuid(), command.Code, command.DisplayName, command.NativeName, command.SortOrder, false, now, command.ActorStaffId);
            if (await database.WebsiteLanguages.AnyAsync(existing => existing.NormalizedCode == language.NormalizedCode, cancellationToken))
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.AlreadyExists, $"The language {language.Code} already exists. A code is an identity: use a new row for a new code.", "code");
            }

            if (await CheckCurrencyAsync(command.DefaultCurrencyCode, requireActive: false, cancellationToken) is { } badCurrency)
            {
                return badCurrency;
            }

            language.InitializeFormat(command.FormatLocale, command.Direction ?? "ltr", command.DefaultCurrencyCode);
            database.WebsiteLanguages.Add(language);
            await database.SaveChangesAsync(cancellationToken);
            var created = ToDto(language, new LanguageCoverage(0, 0, 0, 0, 0));
            // A new language has no texts: it starts off (a pack, or the editor, fills it) — turning it on is a separate, checked step.
            if (command.IsActive)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.LanguageIncomplete, $"{language.Code} has no texts yet, so it cannot be turned on. Install a language pack or translate it first.", "isActive");
            }

            return WebsiteMutationResult<WebsiteLanguageDto>.Success(await WithCoverageAsync(language, created, cancellationToken));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteLanguageDto>> UpdateLanguageAsync(
        UpdateLanguageCommand command, CancellationToken cancellationToken)
    {
        if ((WebsiteInputValidation.Version(command.ExpectedVersion)
             ?? WebsiteInputValidation.Language(command.Code, command.DisplayName, command.NativeName, command.SortOrder, codeRequired: false)
             ?? WebsiteInputValidation.LanguageFormat(command.DefaultCurrencyCode, command.Direction, command.FormatLocale)) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteLanguageDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async now =>
        {
            if (await FindLanguageAsync(command.Code, cancellationToken) is not { } language)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.NotFound($"The language {command.Code} does not exist.");
            }

            if (StaleLanguage(language, command.ExpectedVersion) is { } stale)
            {
                return stale;
            }

            if (language.IsDefault && !command.IsActive)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageRequired, "The default language cannot be turned off. Make another active language the default first.", "isActive");
            }

            var coverage = await CoverageOfAsync(language, cancellationToken);
            if (command.IsActive && !language.IsActive && !coverage.IsComplete)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.LanguageIncomplete,
                    $"{language.Code} still lacks {coverage.Missing} of {coverage.Required} texts, so it cannot be turned on yet. Finish the translation first.", "isActive");
            }

            if (await CheckCurrencyAsync(command.DefaultCurrencyCode, requireActive: command.IsActive, cancellationToken) is { } badCurrency)
            {
                return badCurrency;
            }

            language.Edit(
                command.DisplayName, command.NativeName, command.SortOrder, command.IsActive,
                command.FormatLocale ?? language.FormatLocale, command.Direction ?? language.Direction, command.DefaultCurrencyCode, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteLanguageDto>.Success(ToDto(language, coverage));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteLanguageDto>> SetDefaultLanguageAsync(
        LanguageVersionCommand command, CancellationToken cancellationToken)
    {
        if (WebsiteInputValidation.Version(command.ExpectedVersion) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteLanguageDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async now =>
        {
            if (await FindLanguageAsync(command.Code, cancellationToken) is not { } target)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.NotFound($"The language {command.Code} does not exist.");
            }

            if (StaleLanguage(target, command.ExpectedVersion) is { } stale)
            {
                return stale;
            }

            var coverage = await CoverageOfAsync(target, cancellationToken);
            if (target.IsDefault)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Success(ToDto(target, coverage));
            }

            if (!target.IsActive)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageRequired, "Only an active language can be the default. Turn it on first.");
            }

            // The default is the fallback for every other language, so it must have a text for every required key.
            if (!coverage.IsComplete)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageIncomplete,
                    $"{target.Code} lacks {coverage.Missing} of {coverage.Required} required texts; the default language must have all of them.");
            }

            // The partial unique index allows one default at a time, so the old one is cleared before the new one is set.
            var current = await database.WebsiteLanguages.SingleAsync(language => language.IsDefault, cancellationToken);
            current.MarkDefault(false, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            target.MarkDefault(true, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteLanguageDto>.Success(ToDto(target, coverage));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<bool>> DeleteLanguageAsync(
        LanguageVersionCommand command, CancellationToken cancellationToken)
    {
        if (WebsiteInputValidation.Version(command.ExpectedVersion) is { } invalid)
        {
            return WebsiteMutationResult<bool>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async _ =>
        {
            if (await FindLanguageAsync(command.Code, cancellationToken) is not { } language)
            {
                return WebsiteMutationResult<bool>.NotFound($"The language {command.Code} does not exist.");
            }

            if (language.Version != command.ExpectedVersion)
            {
                return WebsiteMutationResult<bool>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText(language.Code));
            }

            if (language.IsDefault)
            {
                return WebsiteMutationResult<bool>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageRequired, "The default language cannot be deleted. Make another language the default first.");
            }

            if (language.IsActive)
            {
                return WebsiteMutationResult<bool>.Conflict(
                    WebsiteErrorCodes.LanguageInUse, $"{language.Code} is active and visitors can pick it. Turn it off first; nothing is deleted.");
            }

            // An installed pack is thousands of rows: removing the language removes them with it (the editor said how many).
            await database.WebsiteTranslations.Where(row => row.LanguageId == language.Id).ExecuteDeleteAsync(cancellationToken);
            database.WebsiteLanguages.Remove(language);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<bool>.Success(true);
        }, cancellationToken);
    }

    // ------------------------------------------------------------ translations

    public async Task<WebsiteMutationResult<WebsiteTranslationRowDto>> SaveTranslationAsync(
        SaveTranslationCommand command, CancellationToken cancellationToken)
    {
        if (command.ExpectedVersion is < 1)
        {
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Invalid("expectedVersion", "expectedVersion must be null (no text saved yet) or the version the editor loaded.");
        }

        return await InLockAsync(async now =>
        {
            var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
            if (!model.ByKey.TryGetValue(command.Key ?? string.Empty, out var item))
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"'{command.Key}' is not a managed translation key.");
            }

            if (TranslationText.Validate(command.Value, item.Placeholders) is { } problem)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Invalid("value", problem);
            }

            if (await FindLanguageAsync(command.Locale, cancellationToken) is not { } language)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"The language {command.Locale} does not exist.");
            }

            var row = await database.WebsiteTranslations.SingleOrDefaultAsync(
                translation => translation.LanguageId == language.Id && translation.Key == item.Key, cancellationToken);
            if (row is null && command.ExpectedVersion is not null)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(
                    WebsiteErrorCodes.StaleVersion, "That text no longer exists. Reload and try again.");
            }

            if (row is not null && command.ExpectedVersion != row.Version)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText($"{language.Code}/{item.Key}"));
            }

            var reference = await ReferenceTextsForAsync(model, cancellationToken);
            var isReference = reference.Language?.Id == language.Id;
            var sourceHash = isReference || !reference.Texts.TryGetValue(item.Key, out var referenceText) ? null : SourceText.Hash(referenceText);
            var value = command.Value.Trim();
            if (row is null)
            {
                row = new WebsiteTranslation(language.Id, item.Key, value, true, sourceHash, now, command.ActorStaffId);
                database.WebsiteTranslations.Add(row);
            }
            else
            {
                row.Change(value, true, sourceHash, now, command.ActorStaffId);
            }

            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Success(BuildRow(item, row, "translated", reference.Texts));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteTranslationRowDto>> ClearTranslationAsync(
        ClearTranslationCommand command, CancellationToken cancellationToken)
    {
        if (WebsiteInputValidation.Version(command.ExpectedVersion) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async _ =>
        {
            var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
            if (!model.ByKey.TryGetValue(command.Key ?? string.Empty, out var item))
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"'{command.Key}' is not a managed translation key.");
            }

            if (await FindLanguageAsync(command.Locale, cancellationToken) is not { } language)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"The language {command.Locale} does not exist.");
            }

            if (language.IsDefault)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageRequired, "The default language must keep a text for every key. Edit the text instead of removing it.");
            }

            var row = await database.WebsiteTranslations.SingleOrDefaultAsync(
                translation => translation.LanguageId == language.Id && translation.Key == item.Key, cancellationToken);
            if (row is null)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"{language.Code} has no text for {item.Key}.");
            }

            if (row.Version != command.ExpectedVersion)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText($"{language.Code}/{item.Key}"));
            }

            database.WebsiteTranslations.Remove(row);
            await database.SaveChangesAsync(cancellationToken);
            var reference = await ReferenceTextsForAsync(model, cancellationToken);
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Success(BuildRow(item, null, "missing", reference.Texts));
        }, cancellationToken);
    }

    // -------------------------------------------------------------- currencies

    public async Task<WebsiteMutationResult<WebsiteCurrencyDto>> CreateCurrencyAsync(
        CreateCurrencyCommand command, CancellationToken cancellationToken)
    {
        if (WebsiteInputValidation.Currency(command.Code, command.Name, command.Symbol, command.MinorUnits, command.SortOrder) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteCurrencyDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async now =>
        {
            var currency = new WebsiteCurrency(command.Code, command.Name, command.Symbol, command.MinorUnits, command.SortOrder, now, command.ActorStaffId);
            if (await database.WebsiteCurrencies.AnyAsync(existing => existing.Code == currency.Code, cancellationToken))
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(
                    WebsiteErrorCodes.AlreadyExists, $"The currency {currency.Code} already exists.", "code");
            }

            // New currencies start off, with no rate: nothing is guessed and nothing is shown until an operator sets one.
            database.WebsiteCurrencies.Add(currency);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteCurrencyDto>.Success(ToDto(currency));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteCurrencyDto>> UpdateCurrencyAsync(
        UpdateCurrencyCommand command, CancellationToken cancellationToken)
    {
        if ((WebsiteInputValidation.Version(command.ExpectedVersion) ?? WebsiteInputValidation.Currency(command.Code, command.Name, command.Symbol, command.MinorUnits, command.SortOrder, codeRequired: false)) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteCurrencyDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InCurrencyAsync(command.Code, command.ExpectedVersion, allowBase: false, (currency, now) =>
        {
            currency.Edit(command.Name, command.Symbol, command.MinorUnits, command.SortOrder, now, command.ActorStaffId);
            return Task.FromResult<WebsiteMutationResult<WebsiteCurrencyDto>?>(null);
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteCurrencyDto>> SetCurrencyRateAsync(
        SetCurrencyRateCommand command, CancellationToken cancellationToken)
    {
        if ((WebsiteInputValidation.Version(command.ExpectedVersion) ?? WebsiteInputValidation.Rate(command.VndPerUnit)) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteCurrencyDto>.Invalid(invalid.Field, invalid.Message);
        }

        ExchangeRate.TryParse(command.VndPerUnit, out var rate);
        return await InCurrencyAsync(command.Code, command.ExpectedVersion, allowBase: false, (currency, now) =>
        {
            currency.SetRate(rate, now, command.ActorStaffId);
            return Task.FromResult<WebsiteMutationResult<WebsiteCurrencyDto>?>(null);
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteCurrencyDto>> SetCurrencyActiveAsync(
        SetCurrencyActiveCommand command, CancellationToken cancellationToken)
    {
        if (WebsiteInputValidation.Version(command.ExpectedVersion) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteCurrencyDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InCurrencyAsync(command.Code, command.ExpectedVersion, allowBase: false, (currency, now) =>
        {
            if (command.IsActive && !currency.HasRate)
            {
                return Task.FromResult<WebsiteMutationResult<WebsiteCurrencyDto>?>(WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(
                    WebsiteErrorCodes.RateRequired, $"{currency.Code} has no exchange rate yet; set a rate before turning it on.", "vndPerUnit"));
            }

            if (!command.IsActive && currency.IsDefault)
            {
                return Task.FromResult<WebsiteMutationResult<WebsiteCurrencyDto>?>(WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(
                    WebsiteErrorCodes.DefaultCurrencyRequired, "The default display currency cannot be turned off. Make another currency the default first."));
            }

            if (!command.IsActive && database.WebsiteLanguages.Any(language => language.IsActive && language.DefaultCurrencyCode == currency.Code))
            {
                return Task.FromResult<WebsiteMutationResult<WebsiteCurrencyDto>?>(WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(
                    WebsiteErrorCodes.CurrencyInUse, $"{currency.Code} is the default currency of an active language. Give that language another default currency first."));
            }

            currency.SetActive(command.IsActive, now, command.ActorStaffId);
            return Task.FromResult<WebsiteMutationResult<WebsiteCurrencyDto>?>(null);
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteCurrencyDto>> SetDefaultCurrencyAsync(
        CurrencyVersionCommand command, CancellationToken cancellationToken)
    {
        if (WebsiteInputValidation.Version(command.ExpectedVersion) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteCurrencyDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async now =>
        {
            if (await FindCurrencyAsync(command.Code, cancellationToken) is not { } target)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.NotFound($"The currency {command.Code} does not exist.");
            }

            if (target.Version != command.ExpectedVersion)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText(target.Code));
            }

            if (target.IsDefault)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.Success(ToDto(target));
            }

            if (!target.HasRate)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(
                    WebsiteErrorCodes.RateRequired, $"{target.Code} has no exchange rate yet; set a rate before choosing it.", "vndPerUnit");
            }

            if (!target.IsActive)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(
                    WebsiteErrorCodes.CurrencyInactive, $"{target.Code} is off. Turn it on before choosing it as the default.");
            }

            var current = await database.WebsiteCurrencies.SingleAsync(currency => currency.IsDefault, cancellationToken);
            current.MarkDefault(false, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            target.MarkDefault(true, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteCurrencyDto>.Success(ToDto(target));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<bool>> DeleteCurrencyAsync(
        CurrencyVersionCommand command, CancellationToken cancellationToken)
    {
        if (WebsiteInputValidation.Version(command.ExpectedVersion) is { } invalid)
        {
            return WebsiteMutationResult<bool>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async _ =>
        {
            if (await FindCurrencyAsync(command.Code, cancellationToken) is not { } currency)
            {
                return WebsiteMutationResult<bool>.NotFound($"The currency {command.Code} does not exist.");
            }

            if (currency.Version != command.ExpectedVersion)
            {
                return WebsiteMutationResult<bool>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText(currency.Code));
            }

            if (currency.IsBase)
            {
                return WebsiteMutationResult<bool>.Conflict(WebsiteErrorCodes.BaseCurrencyFixed, "VND is the base currency and cannot be removed.");
            }

            if (currency.IsDefault)
            {
                return WebsiteMutationResult<bool>.Conflict(
                    WebsiteErrorCodes.DefaultCurrencyRequired, "The default display currency cannot be deleted. Make another currency the default first.");
            }

            if (currency.IsActive)
            {
                return WebsiteMutationResult<bool>.Conflict(
                    WebsiteErrorCodes.CurrencyInUse, $"{currency.Code} is on and visitors can pick it. Turn it off instead.");
            }

            if (await database.WebsiteLanguages.AnyAsync(language => language.DefaultCurrencyCode == currency.Code, cancellationToken))
            {
                return WebsiteMutationResult<bool>.Conflict(
                    WebsiteErrorCodes.CurrencyInUse, $"{currency.Code} is the default currency of a language. Give that language another default currency first.");
            }

            database.WebsiteCurrencies.Remove(currency);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<bool>.Success(true);
        }, cancellationToken);
    }

    // ----------------------------------------------------------------- helpers

    private Task<WebsiteMutationResult<T>> InLockAsync<T>(
        Func<DateTimeOffset, Task<WebsiteMutationResult<T>>> work, CancellationToken cancellationToken) =>
        WebsiteTransaction.InLockAsync(database, timeProvider, work, cancellationToken);

    private async Task<WebsiteMutationResult<WebsiteCurrencyDto>> InCurrencyAsync(
        string code,
        int expectedVersion,
        bool allowBase,
        Func<WebsiteCurrency, DateTimeOffset, Task<WebsiteMutationResult<WebsiteCurrencyDto>?>> change,
        CancellationToken cancellationToken) =>
        await InLockAsync(async now =>
        {
            if (await FindCurrencyAsync(code, cancellationToken) is not { } currency)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.NotFound($"The currency {code} does not exist.");
            }

            if (currency.Version != expectedVersion)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText(currency.Code));
            }

            if (currency.IsBase && !allowBase)
            {
                return WebsiteMutationResult<WebsiteCurrencyDto>.Conflict(
                    WebsiteErrorCodes.BaseCurrencyFixed, "VND is the base currency: its rate is fixed at 1 and it is always on.");
            }

            if (await change(currency, now) is { } refused)
            {
                return refused;
            }

            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteCurrencyDto>.Success(ToDto(currency));
        }, cancellationToken);

    private static string StaleText(string what) =>
        $"{what} was changed by someone else since you loaded it. Reload to see the current values, then apply your change again.";

    private static WebsiteMutationResult<WebsiteLanguageDto>? StaleLanguage(WebsiteLanguage language, int expectedVersion) =>
        language.Version == expectedVersion
            ? null
            : WebsiteMutationResult<WebsiteLanguageDto>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText(language.Code));

    private async Task<WebsiteLanguage?> FindLanguageAsync(string code, CancellationToken cancellationToken) =>
        LanguageTag.TryNormalize(code, out _, out var normalized)
            ? await database.WebsiteLanguages.SingleOrDefaultAsync(language => language.NormalizedCode == normalized, cancellationToken)
            : null;

    private async Task<WebsiteCurrency?> FindCurrencyAsync(string code, CancellationToken cancellationToken) =>
        Iso4217.TryNormalize(code, out var normalized)
            ? await database.WebsiteCurrencies.SingleOrDefaultAsync(currency => currency.Code == normalized, cancellationToken)
            : null;

    /// <summary>A language's default currency must exist; an ACTIVE language needs it on, so a visitor who picks the language is never given an unusable currency.</summary>
    private async Task<WebsiteMutationResult<WebsiteLanguageDto>?> CheckCurrencyAsync(string? code, bool requireActive, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return null;
        }

        if (await FindCurrencyAsync(code, cancellationToken) is not { } currency)
        {
            return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                WebsiteErrorCodes.UnknownCurrency, $"The currency {code.Trim().ToUpperInvariant()} does not exist. Add it on the Currencies screen first.", "defaultCurrencyCode");
        }

        return requireActive && !currency.IsActive
            ? WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                WebsiteErrorCodes.CurrencyInactive, $"{currency.Code} is off. Turn it on (it needs a rate) before an active language uses it as its default.", "defaultCurrencyCode")
            : null;
    }

    private static bool IsContentSource(WebsiteLanguage language) =>
        string.Equals(language.NormalizedCode, ContentSource.Locale, StringComparison.OrdinalIgnoreCase);

    private async Task<Dictionary<Guid, LanguageCoverage>> CoverageByLanguageAsync(
        WebsiteLocalizationModel model, IReadOnlyList<WebsiteLanguage> languages, CancellationToken cancellationToken)
    {
        var defaultLanguage = languages.FirstOrDefault(language => language.IsDefault);
        var reference = await model.ReferenceTextsAsync(database, defaultLanguage, defaultLanguage?.Code ?? ContentSource.Locale, cancellationToken);
        var rows = await database.WebsiteTranslations.AsNoTracking()
            .Select(row => new { row.LanguageId, row.Key, row.IsManual, row.SourceHash })
            .ToListAsync(cancellationToken);
        var byLanguage = rows.GroupBy(row => row.LanguageId)
            .ToDictionary(group => group.Key, group => group.ToDictionary(row => row.Key, row => new CoverageRow(row.IsManual, row.SourceHash), StringComparer.Ordinal));
        var result = new Dictionary<Guid, LanguageCoverage>();
        foreach (var language in languages)
        {
            var own = byLanguage.GetValueOrDefault(language.Id) ?? new Dictionary<string, CoverageRow>(StringComparer.Ordinal);
            result[language.Id] = model.CoverageOf(own, IsContentSource(language), defaultLanguage?.Id == language.Id, reference);
        }

        return result;
    }

    private async Task<LanguageCoverage> CoverageOfAsync(WebsiteLanguage language, CancellationToken cancellationToken)
    {
        var model = await WebsiteLocalizationModel.LoadAsync(content, cancellationToken);
        var languages = await database.WebsiteLanguages.AsNoTracking().ToListAsync(cancellationToken);
        return (await CoverageByLanguageAsync(model, languages, cancellationToken))[language.Id];
    }

    private async Task<WebsiteLanguageDto> WithCoverageAsync(WebsiteLanguage language, WebsiteLanguageDto fallback, CancellationToken cancellationToken) =>
        ToDto(language, await CoverageOfAsync(language, cancellationToken)) is var dto ? dto : fallback;

    private async Task<(WebsiteLanguage? Language, Dictionary<string, string> Texts)> ReferenceTextsForAsync(
        WebsiteLocalizationModel model, CancellationToken cancellationToken)
    {
        var reference = await database.WebsiteLanguages.AsNoTracking().SingleOrDefaultAsync(language => language.IsDefault, cancellationToken);
        return (reference, await model.ReferenceTextsAsync(database, reference, reference?.Code ?? ContentSource.Locale, cancellationToken));
    }

    private static WebsiteTranslationRowDto BuildRow(
        RequiredKey item, WebsiteTranslation? own, string status, IReadOnlyDictionary<string, string> reference) =>
        new(
            item.Key,
            item.Scope,
            item.Group,
            item.Context,
            item.Placeholders,
            reference.GetValueOrDefault(item.Key) ?? item.Content?.SourceText ?? string.Empty,
            own?.Value,
            status,
            own?.IsManual ?? false,
            own?.Version,
            own?.UpdatedAtUtc);

    private static WebsiteLanguageDto ToDto(WebsiteLanguage language, LanguageCoverage coverage) =>
        new(
            language.Code, language.DisplayName, language.NativeName, language.SortOrder, language.IsActive, language.IsDefault, language.Version,
            language.DefaultCurrencyCode, language.Direction, language.FormatLocale, language.PackId, language.PackVersion,
            coverage.Required, coverage.Translated, coverage.Missing, coverage.Outdated, coverage.Manual, coverage.IsComplete,
            language.UpdatedAtUtc, language.UpdatedByStaffId);

    private static WebsiteCurrencyDto ToDto(WebsiteCurrency currency) =>
        new(
            currency.Code, currency.Name, currency.Symbol, currency.MinorUnits, currency.SortOrder, currency.IsActive, currency.IsDefault, currency.IsBase,
            currency.VndPerUnit is { } rate ? ExchangeRate.Format(rate) : null,
            currency.RateUpdatedAtUtc, currency.RateSource, currency.Version, currency.UpdatedAtUtc, currency.UpdatedByStaffId);
}
