using System.Net;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 acceptance A3 (translations): list by language and group, search, save and clear a value,
/// the placeholder and plain-text rules, the default language that always keeps a value for every key, and the
/// fallback to the default when a secondary language has no override. Real PostgreSQL through the real Admin routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteTranslationsApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string List = "/api/admin/v1/website/translations";
    private const string Save = "/api/admin/v1/website/translations/save";
    private const string Clear = "/api/admin/v1/website/translations/clear";
    private const string Languages = "/api/admin/v1/website/languages";
    private static readonly int Keys = WebsiteTranslationCatalog.All.Count;

    private static object Put(string locale, string key, string value, int? version) => new { locale, key, value, expectedVersion = version };

    private static async Task CreateFrenchAsync(Session session) =>
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(
            Languages, new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = true }));

    [Fact]
    public async Task The_list_shows_every_managed_key_with_its_source_value_and_placeholders_for_the_default_language()
    {
        using var session = await StartAsync();

        var vi = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{List}?locale=vi")));
        Assert.Equal("vi", vi.GetProperty("locale").GetString());
        Assert.True(vi.GetProperty("isDefaultLocale").GetBoolean());
        Assert.Equal(Keys, vi.GetProperty("translatedKeys").GetInt32());
        Assert.Equal(Keys, vi.GetProperty("totalKeys").GetInt32());
        Assert.Equal([.. WebsiteTranslationCatalog.Groups], vi.GetProperty("groups").EnumerateArray().Select(group => group.GetString()!).ToArray());
        var rows = vi.GetProperty("rows").EnumerateArray().ToArray();
        Assert.Equal(Keys, rows.Length);
        Assert.All(rows, row =>
        {
            Assert.True(row.GetProperty("hasOverride").GetBoolean());
            Assert.False(row.GetProperty("isFallback").GetBoolean());
            Assert.Equal(row.GetProperty("sourceText").GetString(), row.GetProperty("value").GetString());
            Assert.Equal(1, row.GetProperty("version").GetInt32());
        });

        var withPlaceholder = rows.Single(row => row.GetProperty("key").GetString() == "common.error.loadFailed");
        Assert.Equal(["what"], withPlaceholder.GetProperty("placeholders").EnumerateArray().Select(item => item.GetString()).ToArray());
        Assert.Equal("Đã có lỗi khi tải {what}.", withPlaceholder.GetProperty("sourceText").GetString());

        var en = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{List}?locale=EN")));
        Assert.False(en.GetProperty("isDefaultLocale").GetBoolean());
        Assert.Equal("vi", en.GetProperty("defaultLocale").GetString());
        var offers = en.GetProperty("rows").EnumerateArray().Single(row => row.GetProperty("key").GetString() == "header.menu.offers");
        Assert.Equal("Offers", offers.GetProperty("value").GetString());
        Assert.Equal("Ưu đãi", offers.GetProperty("sourceText").GetString());
    }

    [Fact]
    public async Task The_list_filters_by_group_and_searches_key_source_and_value_without_regard_to_case()
    {
        using var session = await StartAsync();

        async Task<string[]> Keys_(string query) =>
            [.. (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{List}?{query}")))).GetProperty("rows")
                .EnumerateArray().Select(row => row.GetProperty("key").GetString()!)];

        var account = await Keys_("locale=vi&group=header-account");
        Assert.Equal(WebsiteTranslationCatalog.All.Where(definition => definition.Group == "header-account").Select(definition => definition.Key), account);
        Assert.Equal(["header.menu.offers"], await Keys_("locale=vi&q=%C6%AFu%20%C4%91%C3%A3i"));          // "Ưu đãi", the source text
        Assert.Equal(["header.menu.offers"], await Keys_("locale=vi&q=header.menu.OFFERS"));                 // the key
        Assert.Contains("header.menu.riverside", await Keys_("locale=en&q=RIVERSIDE"));
        Assert.Equal(["header.menu.offers"], await Keys_("locale=en&q=offers&group=header-menu"));           // the English value
        Assert.Empty(await Keys_("locale=vi&q=zzzz-not-there"));
        Assert.Empty(await Keys_("locale=vi&group=no-such-group"));

        await AssertStatusAsync(HttpStatusCode.NotFound, session.GetAsync($"{List}?locale=zz"));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.GetAsync($"{List}?locale=english"));
    }

    [Fact]
    public async Task A_secondary_language_falls_back_to_the_default_until_an_override_is_saved_and_returns_when_it_is_cleared()
    {
        using var session = await StartAsync();
        await CreateFrenchAsync(session);

        var before = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{List}?locale=fr&q=common.close")));
        Assert.Equal(0, before.GetProperty("translatedKeys").GetInt32());
        var fallbackRow = before.GetProperty("rows")[0];
        Assert.False(fallbackRow.GetProperty("hasOverride").GetBoolean());
        Assert.True(fallbackRow.GetProperty("isFallback").GetBoolean());
        Assert.Equal("Đóng", fallbackRow.GetProperty("effectiveValue").GetString());
        Assert.Equal(JsonValueKindNull, fallbackRow.GetProperty("value").ValueKind);
        Assert.Equal(JsonValueKindNull, fallbackRow.GetProperty("version").ValueKind);

        // Creating the override: expectedVersion null means "none exists yet".
        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, Put("fr", "common.close", "Fermer", null))));
        Assert.Equal("Fermer", saved.GetProperty("value").GetString());
        Assert.Equal("Fermer", saved.GetProperty("effectiveValue").GetString());
        Assert.True(saved.GetProperty("hasOverride").GetBoolean());
        Assert.False(saved.GetProperty("isFallback").GetBoolean());
        Assert.Equal(1, saved.GetProperty("version").GetInt32());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr' """));
        Assert.Equal(await StaffIdAsync(Site), await ScalarAsync<Guid>("""SELECT t."UpdatedByStaffId" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr' """));

        // The language list now counts it.
        var languages = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Languages)));
        Assert.Equal(1, languages.EnumerateArray().Single(language => language.GetProperty("code").GetString() == "fr").GetProperty("translatedKeys").GetInt32());

        // Clearing returns to the default's text; clearing again finds nothing.
        var cleared = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Clear, new { locale = "fr", key = "common.close", expectedVersion = 1 })));
        Assert.False(cleared.GetProperty("hasOverride").GetBoolean());
        Assert.True(cleared.GetProperty("isFallback").GetBoolean());
        Assert.Equal("Đóng", cleared.GetProperty("effectiveValue").GetString());
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync(Clear, new { locale = "fr", key = "common.close", expectedVersion = 1 }));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr' """));
        await AssertInvariantsAsync();
    }

    private const System.Text.Json.JsonValueKind JsonValueKindNull = System.Text.Json.JsonValueKind.Null;

    [Fact]
    public async Task Saving_checks_versions_so_two_editors_cannot_both_create_or_both_overwrite()
    {
        using var session = await StartAsync();
        await CreateFrenchAsync(session);

        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, Put("fr", "common.retry", "Réessayer", null)));
        // The second editor also loaded "no override": their create is refused, the first value stays.
        var duplicate = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Save, Put("fr", "common.retry", "Encore", null)));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(duplicate)).Code);
        Assert.Equal("Réessayer", await ScalarAsync<string>("""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'common.retry' AND "LanguageId" IN (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr')"""));

        var updated = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, Put("fr", "common.retry", "Réessayez", 1))));
        Assert.Equal(2, updated.GetProperty("version").GetInt32());
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Save, Put("fr", "common.retry", "Stale", 1)));          // stale
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Save, Put("fr", "common.retry", "Future", 7)));         // not the current version
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Save, Put("fr", "common.close", "Fermer", 1)));         // no such override
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Clear, new { locale = "fr", key = "common.retry", expectedVersion = 1 }));
        Assert.Equal("Réessayez", await ScalarAsync<string>("""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'common.retry' AND "LanguageId" IN (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr')"""));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Clear, new { locale = "fr", key = "common.retry", expectedVersion = 2 }));
    }

    [Fact]
    public async Task A_value_is_plain_text_that_keeps_exactly_the_placeholders_its_key_declares()
    {
        using var session = await StartAsync();
        await CreateFrenchAsync(session);
        const string Key = "common.error.loadFailed";   // declares {what}

        async Task Refused(string value, string expectedFragment)
        {
            var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Save, Put("fr", Key, value, null)));
            Assert.Equal((WebsiteErrorCodes.Validation, "value"), await ProblemAsync(refused));
            Assert.Contains(expectedFragment, await refused.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        }

        await Refused("Erreur lors du chargement", "must keep");                    // placeholder lost
        await Refused("Erreur {what} {other}", "does not declare");                 // placeholder added
        await Refused("Erreur {what", "not a placeholder");                          // stray brace
        await Refused("<b>Erreur</b> {what}", "plain text");                          // markup
        await Refused("<script>alert(1)</script> {what}", "plain text");
        await Refused("Erreur\n{what}", "control");                                  // control character
        await Refused("   ", "empty");
        await Refused("", "empty");
        await Refused(new string('x', 1001) + "{what}", "exceed");

        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr' """));
        var ok = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, Put("fr", Key, "  Erreur lors du chargement de {what}.  ", null))));
        Assert.Equal("Erreur lors du chargement de {what}.", ok.GetProperty("value").GetString());   // stored trimmed

        // A key without a placeholder cannot gain one.
        var extra = await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Save, Put("fr", "common.close", "Fermer {what}", null)));
        Assert.Equal("value", (await ProblemAsync(extra)).Field);
    }

    [Fact]
    public async Task Unknown_keys_and_languages_are_404_and_a_bad_version_is_400_never_a_500()
    {
        using var session = await StartAsync();
        await CreateFrenchAsync(session);

        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync(Save, Put("fr", "common.notAKey", "x", null)));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync(Save, Put("fr", "", "x", null)));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync(Save, Put("zz", "common.close", "x", null)));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync(Clear, new { locale = "fr", key = "common.notAKey", expectedVersion = 1 }));
        Assert.Equal((WebsiteErrorCodes.Validation, "expectedVersion"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Save, Put("fr", "common.close", "x", 0)))));
        Assert.Equal((WebsiteErrorCodes.Validation, "expectedVersion"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Clear, new { locale = "fr", key = "common.close", expectedVersion = 0 }))));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Save, """{"locale":"fr","key":"common.close"}"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Save, """{"locale":"fr","key":"common.close","value":"x","expectedVersion":"abc"}"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr' """));
    }

    [Fact]
    public async Task The_default_language_keeps_a_value_for_every_key_it_can_be_edited_but_never_cleared()
    {
        using var session = await StartAsync();

        var cleared = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Clear, new { locale = "vi", key = "header.menu.offers", expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(cleared)).Code);
        Assert.Equal(Keys, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."IsDefault" """));

        // Editing needs the existing version; the "create" form is refused because the row exists.
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Save, Put("vi", "header.menu.offers", "Khuyến mãi", null)));
        var edited = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, Put("vi", "header.menu.offers", "Khuyến mãi", 1))));
        Assert.Equal(2, edited.GetProperty("version").GetInt32());
        Assert.Equal("Khuyến mãi", edited.GetProperty("value").GetString());
        Assert.Equal("Ưu đãi", edited.GetProperty("sourceText").GetString());         // the original wording stays visible
        // An empty value would leave the default without text: refused.
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Save, Put("vi", "header.menu.offers", "", 2)));
        Assert.Equal("Khuyến mãi", await ScalarAsync<string>("""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'header.menu.offers' AND "LanguageId" IN (SELECT "Id" FROM "WebsiteLanguages" WHERE "IsDefault")"""));
        await AssertInvariantsAsync();
    }
}
