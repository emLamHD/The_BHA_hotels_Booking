using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the admin half of the website localisation settings. Every mutation is one
/// transaction that takes the site-wide advisory lock first (before any read), compares the caller's
/// <c>ExpectedVersion</c> against the row it then reads, and applies the cross-row rules — exactly one default
/// of each kind, a default is active, an active currency has a rate, VND is fixed — as ordered statements, so
/// two requests can never leave zero or two defaults or an active currency without a rate. The CHECK
/// constraints, the partial unique indexes and the deferred triggers of the migration repeat those rules in
/// the database for anything that bypasses this class.
/// </summary>
internal sealed class WebsiteSettingsStore(TheBhaDbContext database, TimeProvider timeProvider) : IWebsiteSettingsStore
{
    private static readonly string[] CatalogKeys = [.. WebsiteTranslationCatalog.All.Select(definition => definition.Key)];

    // ------------------------------------------------------------------ reads

    public async Task<IReadOnlyList<WebsiteLanguageDto>> ListLanguagesAsync(CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking()
            .OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)
            .ToListAsync(cancellationToken);
        var counts = await TranslatedCountsAsync(cancellationToken);
        return [.. languages.Select(language => ToDto(language, counts.GetValueOrDefault(language.Id)))];
    }

    public async Task<WebsiteTranslationListDto?> ListTranslationsAsync(
        string locale, string? group, string? search, CancellationToken cancellationToken)
    {
        if (!LanguageTag.TryNormalize(locale, out _, out var normalized))
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

        var rows = await database.WebsiteTranslations.AsNoTracking()
            .Where(translation => (translation.LanguageId == language.Id || translation.LanguageId == defaultLanguage.Id) &&
                                  CatalogKeys.Contains(translation.Key))
            .ToListAsync(cancellationToken);
        var own = rows.Where(row => row.LanguageId == language.Id).ToDictionary(row => row.Key, StringComparer.Ordinal);
        var defaults = rows.Where(row => row.LanguageId == defaultLanguage.Id).ToDictionary(row => row.Key, StringComparer.Ordinal);

        var needle = search?.Trim();
        var listed = WebsiteTranslationCatalog.All
            .Where(definition => string.IsNullOrEmpty(group) || definition.Group == group)
            .Select(definition => BuildRow(definition, own.GetValueOrDefault(definition.Key), defaults.GetValueOrDefault(definition.Key), language.IsDefault))
            .Where(row => string.IsNullOrEmpty(needle) ||
                          row.Key.Contains(needle, StringComparison.OrdinalIgnoreCase) ||
                          row.SourceText.Contains(needle, StringComparison.OrdinalIgnoreCase) ||
                          row.EffectiveValue.Contains(needle, StringComparison.OrdinalIgnoreCase))
            .ToList();
        return new WebsiteTranslationListDto(
            language.Code,
            language.IsDefault,
            defaultLanguage.Code,
            own.Count,
            WebsiteTranslationCatalog.All.Count,
            WebsiteTranslationCatalog.Groups,
            listed);
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
        if (WebsiteInputValidation.Language(command.Code, command.DisplayName, command.NativeName, command.SortOrder) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteLanguageDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async now =>
        {
            var language = new WebsiteLanguage(
                Guid.NewGuid(), command.Code, command.DisplayName, command.NativeName, command.SortOrder, command.IsActive, now, command.ActorStaffId);
            if (await database.WebsiteLanguages.AnyAsync(existing => existing.NormalizedCode == language.NormalizedCode, cancellationToken))
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.AlreadyExists, $"The language {language.Code} already exists. A code is an identity: use a new row for a new code.", "code");
            }

            database.WebsiteLanguages.Add(language);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteLanguageDto>.Success(ToDto(language, 0));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteLanguageDto>> UpdateLanguageAsync(
        UpdateLanguageCommand command, CancellationToken cancellationToken)
    {
        if ((WebsiteInputValidation.Version(command.ExpectedVersion) ?? WebsiteInputValidation.Language(command.Code, command.DisplayName, command.NativeName, command.SortOrder, codeRequired: false)) is { } invalid)
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

            language.Edit(command.DisplayName, command.NativeName, command.SortOrder, command.IsActive, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteLanguageDto>.Success(ToDto(language, await TranslatedCountAsync(language.Id, cancellationToken)));
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

            var translated = await TranslatedCountAsync(target.Id, cancellationToken);
            if (target.IsDefault)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Success(ToDto(target, translated));
            }

            if (!target.IsActive)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageRequired, "Only an active language can be the default. Turn it on first.");
            }

            // The default is the fallback for every other language, so it must have a value for every managed key.
            if (translated < WebsiteTranslationCatalog.All.Count)
            {
                return WebsiteMutationResult<WebsiteLanguageDto>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageIncomplete,
                    $"{target.Code} has {WebsiteTranslationCatalog.All.Count - translated} of {WebsiteTranslationCatalog.All.Count} managed keys without a value; the default language must have all of them.");
            }

            // The partial unique index allows one default at a time, so the old one is cleared before the new one is set.
            var current = await database.WebsiteLanguages.SingleAsync(language => language.IsDefault, cancellationToken);
            current.MarkDefault(false, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            target.MarkDefault(true, now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteLanguageDto>.Success(ToDto(target, translated));
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
                    WebsiteErrorCodes.LanguageInUse, $"{language.Code} is active and visitors can pick it. Turn it off instead; nothing is deleted.");
            }

            var translated = await database.WebsiteTranslations.CountAsync(row => row.LanguageId == language.Id, cancellationToken);
            if (translated > 0)
            {
                return WebsiteMutationResult<bool>.Conflict(
                    WebsiteErrorCodes.LanguageInUse, $"{language.Code} has {translated} saved translation(s). It cannot be deleted without losing them; keep it turned off.");
            }

            database.WebsiteLanguages.Remove(language);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<bool>.Success(true);
        }, cancellationToken);
    }

    // ------------------------------------------------------------ translations

    public async Task<WebsiteMutationResult<WebsiteTranslationRowDto>> SaveTranslationAsync(
        SaveTranslationCommand command, CancellationToken cancellationToken)
    {
        if (!WebsiteTranslationCatalog.ByKey.TryGetValue(command.Key ?? string.Empty, out var definition))
        {
            return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"'{command.Key}' is not a managed translation key.");
        }

        if (command.ExpectedVersion is < 1)
        {
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Invalid("expectedVersion", "expectedVersion must be null (no override yet) or the version the editor loaded.");
        }

        if (TranslationText.Validate(command.Value, definition.Placeholders) is { } problem)
        {
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Invalid("value", problem);
        }

        return await InLockAsync(async now =>
        {
            if (await FindLanguageAsync(command.Locale, cancellationToken) is not { } language)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"The language {command.Locale} does not exist.");
            }

            var row = await database.WebsiteTranslations.SingleOrDefaultAsync(
                translation => translation.LanguageId == language.Id && translation.Key == definition.Key, cancellationToken);
            if (row is null && command.ExpectedVersion is not null)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(
                    WebsiteErrorCodes.StaleVersion, "That override no longer exists. Reload and try again.");
            }

            if (row is not null && command.ExpectedVersion != row.Version)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText($"{language.Code}/{definition.Key}"));
            }

            var value = command.Value.Trim();
            if (row is null)
            {
                row = new WebsiteTranslation(language.Id, definition.Key, value, now, command.ActorStaffId);
                database.WebsiteTranslations.Add(row);
            }
            else
            {
                row.Change(value, now, command.ActorStaffId);
            }

            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Success(await RowAsync(definition, language, cancellationToken));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<WebsiteTranslationRowDto>> ClearTranslationAsync(
        ClearTranslationCommand command, CancellationToken cancellationToken)
    {
        if (!WebsiteTranslationCatalog.ByKey.TryGetValue(command.Key ?? string.Empty, out var definition))
        {
            return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"'{command.Key}' is not a managed translation key.");
        }

        if (WebsiteInputValidation.Version(command.ExpectedVersion) is { } invalid)
        {
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Invalid(invalid.Field, invalid.Message);
        }

        return await InLockAsync(async _ =>
        {
            if (await FindLanguageAsync(command.Locale, cancellationToken) is not { } language)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"The language {command.Locale} does not exist.");
            }

            if (language.IsDefault)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(
                    WebsiteErrorCodes.DefaultLanguageRequired, "The default language must keep a value for every key. Edit the value instead of removing it.");
            }

            var row = await database.WebsiteTranslations.SingleOrDefaultAsync(
                translation => translation.LanguageId == language.Id && translation.Key == definition.Key, cancellationToken);
            if (row is null)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.NotFound($"{language.Code} has no override for {definition.Key}.");
            }

            if (row.Version != command.ExpectedVersion)
            {
                return WebsiteMutationResult<WebsiteTranslationRowDto>.Conflict(WebsiteErrorCodes.StaleVersion, StaleText($"{language.Code}/{definition.Key}"));
            }

            database.WebsiteTranslations.Remove(row);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<WebsiteTranslationRowDto>.Success(await RowAsync(definition, language, cancellationToken));
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

            database.WebsiteCurrencies.Remove(currency);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<bool>.Success(true);
        }, cancellationToken);
    }

    // ----------------------------------------------------------------- helpers

    /// <summary>One transaction, the site-wide lock first, then the work; any non-success rolls everything back.</summary>
    private async Task<WebsiteMutationResult<T>> InLockAsync<T>(
        Func<DateTimeOffset, Task<WebsiteMutationResult<T>>> work, CancellationToken cancellationToken)
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

    private async Task<Dictionary<Guid, int>> TranslatedCountsAsync(CancellationToken cancellationToken) =>
        await database.WebsiteTranslations.AsNoTracking()
            .Where(translation => CatalogKeys.Contains(translation.Key))
            .GroupBy(translation => translation.LanguageId)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);

    private async Task<int> TranslatedCountAsync(Guid languageId, CancellationToken cancellationToken) =>
        await database.WebsiteTranslations.CountAsync(
            translation => translation.LanguageId == languageId && CatalogKeys.Contains(translation.Key), cancellationToken);

    private async Task<WebsiteTranslationRowDto> RowAsync(
        TranslationKeyDefinition definition, WebsiteLanguage language, CancellationToken cancellationToken)
    {
        var defaultId = language.IsDefault
            ? language.Id
            : await database.WebsiteLanguages.Where(candidate => candidate.IsDefault).Select(candidate => candidate.Id).SingleAsync(cancellationToken);
        var rows = await database.WebsiteTranslations.AsNoTracking()
            .Where(translation => translation.Key == definition.Key && (translation.LanguageId == language.Id || translation.LanguageId == defaultId))
            .ToListAsync(cancellationToken);
        return BuildRow(definition, rows.SingleOrDefault(row => row.LanguageId == language.Id), rows.SingleOrDefault(row => row.LanguageId == defaultId), language.IsDefault);
    }

    private static WebsiteTranslationRowDto BuildRow(
        TranslationKeyDefinition definition, WebsiteTranslation? own, WebsiteTranslation? fallback, bool isDefaultLanguage) =>
        new(
            definition.Key,
            definition.Group,
            definition.Vietnamese,
            definition.Placeholders,
            own?.Value,
            own?.Value ?? fallback?.Value ?? definition.Vietnamese,
            own is not null,
            !isDefaultLanguage && own is null,
            own?.Version,
            own?.UpdatedAtUtc);

    private static WebsiteLanguageDto ToDto(WebsiteLanguage language, int translated) =>
        new(
            language.Code, language.DisplayName, language.NativeName, language.SortOrder, language.IsActive, language.IsDefault,
            language.Version, translated, WebsiteTranslationCatalog.All.Count, language.UpdatedAtUtc, language.UpdatedByStaffId);

    private static WebsiteCurrencyDto ToDto(WebsiteCurrency currency) =>
        new(
            currency.Code, currency.Name, currency.Symbol, currency.MinorUnits, currency.SortOrder, currency.IsActive, currency.IsDefault, currency.IsBase,
            currency.VndPerUnit is { } rate ? ExchangeRate.Format(rate) : null,
            currency.RateUpdatedAtUtc, currency.RateSource, currency.Version, currency.UpdatedAtUtc, currency.UpdatedByStaffId);
}
