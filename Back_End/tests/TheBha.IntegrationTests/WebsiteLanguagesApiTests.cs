using System.Net;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2 acceptance (languages): create, edit, turn on/off, change the default, delete — with the
/// rules that keep exactly one active default, require a language to be COMPLETE before it can be turned on or become the
/// default, and tie a language to a currency that is on. Real PostgreSQL through the real Admin routes; after every
/// scenario the database invariants are checked directly.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteLanguagesApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/admin/v1/website/languages";
    private static readonly int CatalogKeys = LocalizationAssets.Catalog.Count;

    private static object NewLanguage(string code, string? currency = null, bool active = false, string display = "Test language", string native = "Ngôn ngữ thử", int sort = 90) =>
        new { code, displayName = display, nativeName = native, sortOrder = sort, isActive = active, defaultCurrencyCode = currency };

    private static object Edit(int version, string display, string native, int sort, bool active, string? currency = null, string? format = null) =>
        new { expectedVersion = version, displayName = display, nativeName = native, sortOrder = sort, isActive = active, defaultCurrencyCode = currency, formatLocale = format };

    [Fact]
    public async Task The_starting_languages_are_vietnamese_active_default_and_english_present_but_off_with_their_currencies()
    {
        using var session = await StartAsync();

        var list = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Url)))).EnumerateArray().ToArray();
        Assert.Equal(["vi", "en"], list.Select(language => language.GetProperty("code").GetString()).ToArray());
        var vi = list[0];
        Assert.True(vi.GetProperty("isDefault").GetBoolean());
        Assert.True(vi.GetProperty("isActive").GetBoolean());
        Assert.Equal("VND", vi.GetProperty("defaultCurrencyCode").GetString());
        Assert.Equal("vi-VN", vi.GetProperty("formatLocale").GetString());
        Assert.Equal("ltr", vi.GetProperty("direction").GetString());
        Assert.True(vi.GetProperty("isComplete").GetBoolean());
        Assert.Equal(0, vi.GetProperty("missingKeys").GetInt32());

        var en = list[1];
        Assert.False(en.GetProperty("isActive").GetBoolean());
        Assert.Equal("USD", en.GetProperty("defaultCurrencyCode").GetString());
        // English has every catalog text but not yet the stored-content texts of the test Property.
        Assert.False(en.GetProperty("isComplete").GetBoolean());
        Assert.True(en.GetProperty("missingKeys").GetInt32() > 0);
        Assert.Equal(en.GetProperty("requiredKeys").GetInt32() - en.GetProperty("missingKeys").GetInt32(), en.GetProperty("translatedKeys").GetInt32());
        Assert.True(en.GetProperty("translatedKeys").GetInt32() >= CatalogKeys);
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task A_language_is_created_off_with_its_format_and_currency_and_cannot_be_created_on()
    {
        using var session = await StartAsync();

        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("FR", "EUR", display: "French", native: "Français"))));
        Assert.Equal("fr", created.GetProperty("code").GetString());
        Assert.False(created.GetProperty("isActive").GetBoolean());
        Assert.Equal("EUR", created.GetProperty("defaultCurrencyCode").GetString());
        Assert.Equal("fr", created.GetProperty("formatLocale").GetString());   // defaults to the code
        Assert.Equal(0, created.GetProperty("translatedKeys").GetInt32());
        Assert.False(created.GetProperty("isComplete").GetBoolean());
        Assert.Equal(1, created.GetProperty("version").GetInt32());

        // Turning on at creation is refused: a new language has no texts.
        var on = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Url, NewLanguage("de", active: true)));
        Assert.Equal((WebsiteErrorCodes.LanguageIncomplete, "isActive"), await ProblemAsync(on));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'de'"""));

        // Codes are tags, unique in any case; formats and currencies are validated.
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Url, NewLanguage("fr")));
        Assert.Equal((WebsiteErrorCodes.Validation, "code"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage("not a tag")))));
        Assert.Equal((WebsiteErrorCodes.Validation, "defaultCurrencyCode"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage("it", "ZWL")))));
        Assert.Equal((WebsiteErrorCodes.UnknownCurrency, "defaultCurrencyCode"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Url, NewLanguage("it", "JPY")))));
        Assert.Equal((WebsiteErrorCodes.Validation, "direction"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest,
            session.PostAsync(Url, new { code = "it", displayName = "Italian", nativeName = "Italiano", sortOrder = 5, isActive = false, direction = "up" }))));
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task A_language_can_be_turned_on_only_when_complete_and_only_with_a_currency_that_is_on()
    {
        using var session = await StartAsync();
        var version = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");

        // English lacks the stored-content texts: it cannot be turned on yet.
        var incomplete = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/update", Edit(version, "English", "English", 20, true, "USD")));
        Assert.Equal((WebsiteErrorCodes.LanguageIncomplete, "isActive"), await ProblemAsync(incomplete));

        await CompleteContentAsync("en");
        // Complete, but its default currency (USD) is off and has no rate.
        var currency = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/update", Edit(version, "English", "English", 20, true, "USD")));
        Assert.Equal((WebsiteErrorCodes.CurrencyInactive, "defaultCurrencyCode"), await ProblemAsync(currency));

        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/USD/rate", new { expectedVersion = 1, vndPerUnit = "26060" }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/USD/active", new { expectedVersion = 2, isActive = true }));
        var on = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/en/update", Edit(version, "English", "English", 20, true, "USD", "en-GB"))));
        Assert.True(on.GetProperty("isActive").GetBoolean());
        Assert.Equal("en-GB", on.GetProperty("formatLocale").GetString());
        Assert.True(on.GetProperty("isComplete").GetBoolean());

        // While an active language uses USD, USD cannot be turned off or deleted.
        var off = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync("/api/admin/v1/website/currencies/USD/active", new { expectedVersion = 3, isActive = false }));
        Assert.Equal(WebsiteErrorCodes.CurrencyInUse, (await ProblemAsync(off)).Code);
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task The_default_must_be_active_and_complete_changing_it_keeps_exactly_one_and_the_old_default_stays_on()
    {
        using var session = await StartAsync();
        await CompleteContentAsync("en");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/USD/rate", new { expectedVersion = 1, vndPerUnit = "26060" }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/USD/active", new { expectedVersion = 2, isActive = true }));
        var version = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");

        // Off: cannot be the default.
        var off = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/set-default", new { expectedVersion = version }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(off)).Code);

        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/en/update", Edit(version, "English", "English", 20, true, "USD")));
        var chosen = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/en/set-default", new { expectedVersion = version + 1 })));
        Assert.True(chosen.GetProperty("isDefault").GetBoolean());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "IsDefault" """));
        Assert.Equal("en", await ScalarAsync<string>("""SELECT "NormalizedCode" FROM "WebsiteLanguages" WHERE "IsDefault" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi' AND "IsActive" """));

        // The default cannot be turned off or deleted.
        var enVersion = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");
        var turnOff = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/update", Edit(enVersion, "English", "English", 20, false, "USD")));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(turnOff)).Code);
        var delete = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/delete", new { expectedVersion = enVersion }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(delete)).Code);
    }

    [Fact]
    public async Task An_incomplete_language_cannot_become_the_default()
    {
        using var session = await StartAsync();
        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("fr", "VND"))));
        // Force it on in the database, as a legacy or hand-edited row could be, to reach the default rule itself.
        await ExecuteAsync("""UPDATE "WebsiteLanguages" SET "IsActive" = true WHERE "NormalizedCode" = 'fr'""");
        var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/fr/set-default", new { expectedVersion = created.GetProperty("version").GetInt32() }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageIncomplete, (await ProblemAsync(refused)).Code);
        Assert.Equal("vi", await ScalarAsync<string>("""SELECT "NormalizedCode" FROM "WebsiteLanguages" WHERE "IsDefault" """));
    }

    [Fact]
    public async Task Deleting_an_off_language_removes_its_texts_with_it_but_an_active_or_default_one_is_refused()
    {
        using var session = await StartAsync();
        var version = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");
        var englishRows = await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en'""");
        Assert.True(englishRows >= CatalogKeys);
        var viRows = await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'vi'""");

        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/vi/delete", new { expectedVersion = 1 }));
        await AssertStatusAsync(HttpStatusCode.NoContent, session.PostAsync($"{Url}/en/delete", new { expectedVersion = version }));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t WHERE NOT EXISTS (SELECT 1 FROM "WebsiteLanguages" l WHERE l."Id" = t."LanguageId")"""));
        Assert.Equal(viRows, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" """));   // Vietnamese untouched
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/en/delete", new { expectedVersion = version }));
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task A_stale_editor_is_refused_with_a_reason_and_changes_nothing()
    {
        using var session = await StartAsync();
        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("fr", "EUR"))));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/fr/update", Edit(1, "French", "Français", 30, false, "EUR")));
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/fr/update", Edit(1, "French (stale)", "Français", 30, false, "EUR")));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(stale)).Code);
        Assert.Equal("French", await ScalarAsync<string>("""SELECT "DisplayName" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr'"""));
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/fr/delete", new { expectedVersion = created.GetProperty("version").GetInt32() }));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/zz/update", Edit(1, "x", "x", 1, false)));
    }
}
