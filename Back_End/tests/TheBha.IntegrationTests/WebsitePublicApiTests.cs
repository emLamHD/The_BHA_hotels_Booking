using System.Net;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 acceptance A5: the public read the next phase will use. Anonymous, <c>no-store</c>, only
/// active languages and currencies that have a valid rate, deterministic fallback, no audit or permission data, and
/// the next GET after an Admin change shows the change. Real PostgreSQL; the changes go through the real Admin routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsitePublicApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Config = "/api/v1/website/config";
    private const string Dictionary = "/api/v1/website/dictionary";
    private const string Languages = "/api/admin/v1/website/languages";
    private const string Currencies = "/api/admin/v1/website/currencies";
    private const string Save = "/api/admin/v1/website/translations/save";
    private static readonly int Keys = WebsiteTranslationCatalog.All.Count;

    private static async Task<JsonElement> ReadAsync(Session session, string path)
    {
        // No cookie, no Origin: a visitor.
        var response = await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(path)));
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        return await JsonAsync(response);
    }

    [Fact]
    public async Task The_initial_config_has_vietnamese_and_vnd_only_and_exposes_nothing_about_who_or_what_state()
    {
        using var session = await StartAsync();

        var config = await ReadAsync(session, Config);
        Assert.Equal("vi", config.GetProperty("defaultLocale").GetString());
        Assert.Equal(["vi"], config.GetProperty("locales").EnumerateArray().Select(locale => locale.GetProperty("code").GetString()).ToArray());
        var locale = config.GetProperty("locales")[0];
        Assert.Equal("Tiếng Việt", locale.GetProperty("nativeName").GetString());
        Assert.True(locale.GetProperty("isDefault").GetBoolean());
        Assert.Equal("VND", config.GetProperty("baseCurrency").GetString());
        Assert.Equal("VND", config.GetProperty("defaultCurrency").GetString());
        var currency = Assert.Single(config.GetProperty("currencies").EnumerateArray());
        Assert.Equal("VND", currency.GetProperty("code").GetString());
        Assert.Equal("1", currency.GetProperty("vndPerUnit").GetString());
        Assert.Equal(0, currency.GetProperty("minorUnits").GetInt32());
        Assert.True(currency.GetProperty("isBase").GetBoolean());

        // Nothing that names a Staff member, a version, a draft, a permission or an inactive row.
        var raw = config.GetRawText();
        var staffId = (await StaffIdAsync(Site)).ToString();
        foreach (var forbidden in new[] { "updatedBy", "staff", "version", "isActive", "permission", "createdAt", "expected", staffId, "USD", "EUR", "\"en\"" })
        {
            Assert.DoesNotContain(forbidden, raw, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task The_dictionary_resolves_the_requested_locale_or_the_default_and_always_says_which()
    {
        using var session = await StartAsync();

        var none = await ReadAsync(session, Dictionary);
        Assert.Equal(JsonValueKind.Null, none.GetProperty("requestedLocale").ValueKind);
        Assert.Equal("vi", none.GetProperty("resolvedLocale").GetString());
        Assert.Equal("vi", none.GetProperty("defaultLocale").GetString());
        Assert.True(none.GetProperty("isFallbackLocale").GetBoolean());
        var entries = none.GetProperty("entries");
        Assert.Equal(Keys, entries.EnumerateObject().Count());
        Assert.Equal("Ưu đãi", entries.GetProperty("header.menu.offers").GetString());
        Assert.Equal(WebsiteTranslationCatalog.All.Select(definition => definition.Key).Order(StringComparer.Ordinal), entries.EnumerateObject().Select(property => property.Name));

        var exact = await ReadAsync(session, $"{Dictionary}?locale=vi");
        Assert.Equal("vi", exact.GetProperty("requestedLocale").GetString());
        Assert.False(exact.GetProperty("isFallbackLocale").GetBoolean());

        // English exists but is off: visitors get the default, and the answer says so.
        var off = await ReadAsync(session, $"{Dictionary}?locale=en");
        Assert.Equal("en", off.GetProperty("requestedLocale").GetString());
        Assert.Equal("vi", off.GetProperty("resolvedLocale").GetString());
        Assert.True(off.GetProperty("isFallbackLocale").GetBoolean());
        Assert.Equal("Ưu đãi", off.GetProperty("entries").GetProperty("header.menu.offers").GetString());

        // Unsupported, malformed or hostile input never errors and never reflects the raw text.
        foreach (var bad in new[] { "xx", "zz-ZZ", "english", "en_US", "%3Cscript%3Ealert(1)%3C%2Fscript%3E", "..%2F..%2Fetc", "vi%00", new string('a', 400) })
        {
            var answer = await ReadAsync(session, $"{Dictionary}?locale={bad}");
            Assert.Equal("vi", answer.GetProperty("resolvedLocale").GetString());
            Assert.True(answer.GetProperty("isFallbackLocale").GetBoolean());
            Assert.Equal(Keys, answer.GetProperty("entries").EnumerateObject().Count());
            Assert.DoesNotContain("script", answer.GetRawText(), StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task A_change_made_in_admin_is_what_the_next_public_read_returns()
    {
        using var session = await StartAsync();
        Assert.Equal("Ưu đãi", (await ReadAsync(session, $"{Dictionary}?locale=vi")).GetProperty("entries").GetProperty("header.menu.offers").GetString());

        // Turn English on: it appears in the config and its dictionary is served as itself.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/en/update", new { expectedVersion = 1, displayName = "English", nativeName = "English", sortOrder = 20, isActive = true }));
        var config = await ReadAsync(session, Config);
        Assert.Equal(["vi", "en"], config.GetProperty("locales").EnumerateArray().Select(item => item.GetProperty("code").GetString()).ToArray());
        var english = await ReadAsync(session, $"{Dictionary}?locale=EN");
        Assert.Equal("en", english.GetProperty("requestedLocale").GetString());
        Assert.Equal("en", english.GetProperty("resolvedLocale").GetString());
        Assert.False(english.GetProperty("isFallbackLocale").GetBoolean());
        Assert.Equal("Offers", english.GetProperty("entries").GetProperty("header.menu.offers").GetString());
        // A regional tag falls back along the tag to the language that is on.
        var regional = await ReadAsync(session, $"{Dictionary}?locale=en-US");
        Assert.Equal("en", regional.GetProperty("resolvedLocale").GetString());
        Assert.Equal("en-US", regional.GetProperty("requestedLocale").GetString());
        Assert.True(regional.GetProperty("isFallbackLocale").GetBoolean());

        // Edit the default's text: the very next read has it; the English text is untouched.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, new { locale = "vi", key = "header.menu.offers", value = "Khuyến mãi", expectedVersion = 1 }));
        Assert.Equal("Khuyến mãi", (await ReadAsync(session, $"{Dictionary}?locale=vi")).GetProperty("entries").GetProperty("header.menu.offers").GetString());
        Assert.Equal("Offers", (await ReadAsync(session, $"{Dictionary}?locale=en")).GetProperty("entries").GetProperty("header.menu.offers").GetString());

        // Turn it off again: gone from the config, answered with the default.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/en/update", new { expectedVersion = 2, displayName = "English", nativeName = "English", sortOrder = 20, isActive = false }));
        Assert.Equal(["vi"], (await ReadAsync(session, Config)).GetProperty("locales").EnumerateArray().Select(item => item.GetProperty("code").GetString()).ToArray());
        Assert.Equal("vi", (await ReadAsync(session, $"{Dictionary}?locale=en")).GetProperty("resolvedLocale").GetString());
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task A_secondary_language_serves_its_overrides_and_the_defaults_text_for_every_other_key()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Languages, new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = true }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, new { locale = "fr", key = "common.close", value = "Fermer", expectedVersion = (int?)null }));

        var french = await ReadAsync(session, $"{Dictionary}?locale=fr");
        Assert.Equal("fr", french.GetProperty("resolvedLocale").GetString());
        Assert.False(french.GetProperty("isFallbackLocale").GetBoolean());
        var entries = french.GetProperty("entries");
        Assert.Equal(Keys, entries.EnumerateObject().Count());                                   // complete: no key is missing
        Assert.Equal("Fermer", entries.GetProperty("common.close").GetString());                // the override
        Assert.Equal("Thử lại", entries.GetProperty("common.retry").GetString());               // the default's text

        // Removing the override returns to the fallback.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/translations/clear", new { locale = "fr", key = "common.close", expectedVersion = 1 }));
        Assert.Equal("Đóng", (await ReadAsync(session, $"{Dictionary}?locale=fr")).GetProperty("entries").GetProperty("common.close").GetString());
    }

    [Fact]
    public async Task Only_active_currencies_with_a_rate_are_public_and_the_default_follows_the_admin_choice()
    {
        using var session = await StartAsync();

        // USD has metadata but no rate and is off: not public.
        Assert.Equal(["VND"], (await ReadAsync(session, Config)).GetProperty("currencies").EnumerateArray().Select(item => item.GetProperty("code").GetString()).ToArray());

        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/rate", new { expectedVersion = 1, vndPerUnit = "25400.5" }));
        // Rate set but still off: still not public.
        Assert.Equal(["VND"], (await ReadAsync(session, Config)).GetProperty("currencies").EnumerateArray().Select(item => item.GetProperty("code").GetString()).ToArray());
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = 2, isActive = true }));

        var config = await ReadAsync(session, Config);
        var currencies = config.GetProperty("currencies").EnumerateArray().ToArray();
        Assert.Equal(["VND", "USD"], currencies.Select(item => item.GetProperty("code").GetString()).ToArray());
        var usd = currencies[1];
        Assert.Equal("25400.5", usd.GetProperty("vndPerUnit").GetString());                      // a string: exact digits
        Assert.Equal(JsonValueKind.String, usd.GetProperty("vndPerUnit").ValueKind);
        Assert.Equal(2, usd.GetProperty("minorUnits").GetInt32());
        Assert.False(usd.GetProperty("isBase").GetBoolean());
        Assert.False(usd.GetProperty("isDefault").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, usd.GetProperty("rateUpdatedAtUtc").ValueKind);
        Assert.Equal("VND", config.GetProperty("defaultCurrency").GetString());

        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/set-default", new { expectedVersion = 3 }));
        Assert.Equal("USD", (await ReadAsync(session, Config)).GetProperty("defaultCurrency").GetString());
        Assert.Equal("VND", (await ReadAsync(session, Config)).GetProperty("baseCurrency").GetString());           // the base never moves

        // A corrected rate is what the next read says.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/rate", new { expectedVersion = 4, vndPerUnit = "25500" }));
        Assert.Equal("25500", (await ReadAsync(session, Config)).GetProperty("currencies").EnumerateArray().Single(item => item.GetProperty("code").GetString() == "USD").GetProperty("vndPerUnit").GetString());
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task The_public_read_needs_no_session_ignores_cookies_and_is_not_cached()
    {
        using var session = await StartAsync();

        foreach (var path in new[] { Config, $"{Dictionary}?locale=vi" })
        {
            var anonymous = await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(path)));
            var withStaff = await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(path, session.Cookie)));
            Assert.Equal(await anonymous.Content.ReadAsStringAsync(), await withStaff.Content.ReadAsStringAsync());   // a session changes nothing
            Assert.Contains("no-store", anonymous.Headers.CacheControl?.ToString());
            Assert.Equal("application/json", anonymous.Content.Headers.ContentType?.MediaType);
        }

        // Read-only: the public routes accept no write.
        await AssertStatusAsync(HttpStatusCode.MethodNotAllowed, session.Client.SendAsync(Post(Config, new { })));
        await AssertStatusAsync(HttpStatusCode.MethodNotAllowed, session.Client.SendAsync(Post(Dictionary, new { })));
    }
}
