using System.Net;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2: the public read both front ends use. Anonymous; only active languages and currencies that
/// have a valid rate; each language carries its format locale, direction and default currency; the dictionary is scoped, can
/// be narrowed by prefix, carries a revision and an ETag, falls back deterministically (and onto the built-in pack on a fresh
/// install) and never contains a Staff field, a draft or a text outside the catalog and the stored content. Real PostgreSQL;
/// every change goes through the real Admin routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsitePublicApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Config = "/api/v1/website/config";
    private const string Dictionary = "/api/v1/website/dictionary";
    private const string Languages = "/api/admin/v1/website/languages";
    private const string Currencies = "/api/admin/v1/website/currencies";
    private const string Save = "/api/admin/v1/website/translations/save";
    private const string Key = "customer.header.menu.offers";

    // No cookie, no Origin: a visitor.
    private static async Task<(JsonElement Body, HttpResponseMessage Response)> ReadAsync(Session session, string path)
    {
        var response = await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(path)));
        return (await JsonAsync(response), response);
    }

    private async Task TurnOnEnglishAsync(Session session)
    {
        await CompleteContentAsync("en");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/rate", new { expectedVersion = 1, vndPerUnit = "26060" }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = 2, isActive = true }));
        var version = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/en/update",
            new { expectedVersion = version, displayName = "English", nativeName = "English", sortOrder = 20, isActive = true, defaultCurrencyCode = "USD" }));
    }

    [Fact]
    public async Task The_initial_config_has_vietnamese_and_vnd_only_and_exposes_nothing_about_who_or_what_state()
    {
        using var session = await StartAsync();

        var (config, response) = await ReadAsync(session, Config);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("vi", config.GetProperty("defaultLocale").GetString());
        var locales = config.GetProperty("locales").EnumerateArray().ToArray();
        Assert.Equal(["vi"], locales.Select(locale => locale.GetProperty("code").GetString()).ToArray());
        var vi = locales[0];
        Assert.Equal("Tiếng Việt", vi.GetProperty("nativeName").GetString());
        Assert.Equal("vi-VN", vi.GetProperty("formatLocale").GetString());
        Assert.Equal("ltr", vi.GetProperty("direction").GetString());
        Assert.Equal("VND", vi.GetProperty("defaultCurrency").GetString());
        Assert.Equal("VND", config.GetProperty("baseCurrency").GetString());
        Assert.Equal(["VND"], config.GetProperty("currencies").EnumerateArray().Select(currency => currency.GetProperty("code").GetString()).ToArray());
        Assert.Matches("^[0-9a-f]{16}$", config.GetProperty("revision").GetString());

        // Nothing about who changed what, a draft or a permission.
        var text = config.GetRawText();
        Assert.DoesNotContain("UpdatedBy", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("staff", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("version\"", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"en\"", text);   // off languages are not offered
    }

    [Fact]
    public async Task A_language_appears_in_the_config_only_when_on_with_its_own_currency_and_the_revision_follows_every_change()
    {
        using var session = await StartAsync();
        var before = (await ReadAsync(session, Config)).Body.GetProperty("revision").GetString();

        await TurnOnEnglishAsync(session);
        var (config, _) = await ReadAsync(session, Config);
        var locales = config.GetProperty("locales").EnumerateArray().ToDictionary(locale => locale.GetProperty("code").GetString()!);
        Assert.Equal(["vi", "en"], locales.Keys.ToArray());
        Assert.Equal("USD", locales["en"].GetProperty("defaultCurrency").GetString());
        Assert.Equal("en-US", locales["en"].GetProperty("formatLocale").GetString());
        var usd = config.GetProperty("currencies").EnumerateArray().Single(currency => currency.GetProperty("code").GetString() == "USD");
        Assert.Equal("26060", usd.GetProperty("vndPerUnit").GetString());
        Assert.NotEqual(before, config.GetProperty("revision").GetString());

        // A language whose own currency is no longer offered falls back to the site default.
        await ExecuteAsync("""UPDATE "WebsiteLanguages" SET "DefaultCurrencyCode" = NULL WHERE "NormalizedCode" = 'en'""");
        var fallback = (await ReadAsync(session, Config)).Body.GetProperty("locales").EnumerateArray().Single(locale => locale.GetProperty("code").GetString() == "en");
        Assert.Equal("VND", fallback.GetProperty("defaultCurrency").GetString());
    }

    [Fact]
    public async Task The_dictionary_is_scoped_prefix_narrows_only_the_content_and_every_text_is_in_the_catalog_or_the_content()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" LIMIT 1""");

        var (ui, _) = await ReadAsync(session, $"{Dictionary}?locale=vi&scopes=shared,customer");
        var entries = ui.GetProperty("entries").EnumerateObject().ToDictionary(property => property.Name, property => property.Value.GetString()!);
        Assert.Equal("Ưu đãi", entries[Key]);
        Assert.All(entries.Keys, key => Assert.True(key.StartsWith("shared.") || key.StartsWith("customer."), key));
        Assert.All(entries.Keys, key => Assert.True(LocalizationAssets.CatalogByKey.ContainsKey(key), key));

        var (withContent, _) = await ReadAsync(session, $"{Dictionary}?locale=vi&scopes=shared,customer,content&prefix=content.property.");
        var merged = withContent.GetProperty("entries").EnumerateObject().ToDictionary(property => property.Name, property => property.Value.GetString()!);
        Assert.Equal("Hotel Website", merged[$"content.property.{propertyId}.name"]);   // the column is the Vietnamese source
        Assert.True(merged.ContainsKey(Key), "UI texts are never narrowed by a content prefix");
        Assert.All(merged.Keys.Where(key => key.StartsWith("content.")), key => Assert.StartsWith("content.property.", key));

        var (adminScope, _) = await ReadAsync(session, $"{Dictionary}?locale=vi&scopes=admin");
        Assert.All(adminScope.GetProperty("entries").EnumerateObject(), property => Assert.StartsWith("admin.", property.Name));

        await AssertStatusAsync(HttpStatusCode.BadRequest, session.Client.SendAsync(Get($"{Dictionary}?scopes=staff")));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.Client.SendAsync(Get($"{Dictionary}?scopes=shared&prefix={new string('x', 200)}")));
    }

    [Fact]
    public async Task The_dictionary_resolves_the_language_falls_back_deterministically_and_flags_it()
    {
        using var session = await StartAsync();

        var (none, _) = await ReadAsync(session, Dictionary);
        Assert.Equal(JsonValueKind.Null, none.GetProperty("requestedLocale").ValueKind);
        Assert.Equal("vi", none.GetProperty("resolvedLocale").GetString());
        Assert.True(none.GetProperty("isFallbackLocale").GetBoolean());

        // English is off: it is not served, the default is, and the answer says so.
        var (off, _) = await ReadAsync(session, $"{Dictionary}?locale=en");
        Assert.Equal("en", off.GetProperty("requestedLocale").GetString());
        Assert.Equal("vi", off.GetProperty("resolvedLocale").GetString());
        Assert.True(off.GetProperty("isFallbackLocale").GetBoolean());
        Assert.Equal("Ưu đãi", off.GetProperty("entries").GetProperty(Key).GetString());

        await TurnOnEnglishAsync(session);
        var (on, _) = await ReadAsync(session, $"{Dictionary}?locale=en-US");
        Assert.Equal("en", on.GetProperty("resolvedLocale").GetString());
        Assert.False(on.GetProperty("isFallbackLocale").GetBoolean() && on.GetProperty("requestedLocale").GetString() == "en");
        Assert.Equal("Offers", on.GetProperty("entries").GetProperty(Key).GetString());

        var (junk, _) = await ReadAsync(session, $"{Dictionary}?locale=%3Cscript%3E");
        Assert.Equal("vi", junk.GetProperty("resolvedLocale").GetString());
        Assert.Equal(JsonValueKind.Null, junk.GetProperty("requestedLocale").ValueKind);
    }

    [Fact]
    public async Task A_fresh_install_still_shows_the_built_in_default_language_and_never_a_raw_key()
    {
        using var session = await StartAsync();
        // A site where nothing has been installed yet: the default language has only a few stored texts.
        await ExecuteAsync("""DELETE FROM "WebsiteTranslations" WHERE "Key" <> 'customer.header.menu.offers'""");

        var (dictionary, _) = await ReadAsync(session, $"{Dictionary}?locale=vi&scopes=shared,customer");
        var entries = dictionary.GetProperty("entries");
        Assert.Equal(LocalizationAssets.Catalog.Count(definition => definition.Scope is "shared" or "customer"), entries.EnumerateObject().Count());
        Assert.Equal("Tài khoản của tôi", entries.GetProperty("customer.header.account.myAccount").GetString());   // from the built-in Vietnamese pack
    }

    [Fact]
    public async Task A_stored_text_beats_the_built_in_one_and_a_stored_content_text_beats_the_column()
    {
        using var session = await StartAsync();
        var propertyKey = $"content.property.{await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" LIMIT 1""")}.name";
        var version = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{Key}' AND "LanguageId" = '{WebsiteTestSeed.Vietnamese}'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, new { locale = "vi", key = Key, value = "Khuyến mãi", expectedVersion = version }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, new { locale = "vi", key = propertyKey, value = "Khách sạn Website", expectedVersion = (int?)null }));

        var (dictionary, _) = await ReadAsync(session, $"{Dictionary}?locale=vi&scopes=customer,content&prefix=content.property.");
        Assert.Equal("Khuyến mãi", dictionary.GetProperty("entries").GetProperty(Key).GetString());
        Assert.Equal("Khách sạn Website", dictionary.GetProperty("entries").GetProperty(propertyKey).GetString());   // a vi row overrides the column
    }

    [Fact]
    public async Task The_dictionary_has_a_revision_an_etag_and_answers_304_until_something_changes()
    {
        using var session = await StartAsync();
        var path = $"{Dictionary}?locale=vi&scopes=shared,customer";

        var (first, response) = await ReadAsync(session, path);
        var etag = response.Headers.ETag?.ToString();
        Assert.False(string.IsNullOrEmpty(etag));
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());
        var revision = first.GetProperty("revision").GetString();

        var request = Get(path);
        request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        await AssertStatusAsync(HttpStatusCode.NotModified, session.Client.SendAsync(request));

        var version = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{Key}' AND "LanguageId" = '{WebsiteTestSeed.Vietnamese}'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, new { locale = "vi", key = Key, value = "Khuyến mãi", expectedVersion = version }));
        var (second, secondResponse) = await ReadAsync(session, path);
        Assert.NotEqual(revision, second.GetProperty("revision").GetString());
        Assert.NotEqual(etag, secondResponse.Headers.ETag?.ToString());
        var stale = Get(path);
        stale.Headers.TryAddWithoutValidation("If-None-Match", etag);
        await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(stale));
    }

    [Fact]
    public async Task The_public_routes_are_read_only_except_the_price_projection_and_send_no_cookie_or_secret()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.MethodNotAllowed, session.Client.SendAsync(Post(Config, new { })));
        await AssertStatusAsync(HttpStatusCode.MethodNotAllowed, session.Client.SendAsync(Post(Dictionary, new { })));
        foreach (var path in new[] { Config, $"{Dictionary}?locale=vi" })
        {
            var anonymous = await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(path)));
            var withStaff = await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(path, session.Cookie)));
            Assert.False(anonymous.Headers.Contains("Set-Cookie"));
            Assert.Equal(await anonymous.Content.ReadAsStringAsync(), await withStaff.Content.ReadAsStringAsync());   // a Staff cookie changes nothing
        }
    }
}
