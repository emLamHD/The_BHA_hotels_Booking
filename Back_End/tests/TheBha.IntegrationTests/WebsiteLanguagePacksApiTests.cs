using System.Net;
using Microsoft.Extensions.DependencyInjection;
using System.Text;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: installing languages as data. The library lists the packs that ship with the product; any
/// pack — built-in or an uploaded file — goes preview (changes nothing, says exactly what would happen) then apply (one
/// transaction bound to the preview, atomic, never importing twice or reporting a false success). A language installed from a
/// pack arrives OFF and can be turned on only when it is complete; the public API never serves a draft. Export then import
/// round-trips without losing manual edits. Real PostgreSQL through the real Admin routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteLanguagePacksApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/admin/v1/website/language-packs";
    private const string Translations = "/api/admin/v1/website/translations";

    private static readonly int CatalogKeys = LocalizationAssets.Catalog.Count;

    private static object Builtin(string id, string mode = PackModes.KeepManual, string? token = null, bool enable = false) =>
        new { builtInPackId = id, mode, previewToken = token, enable };

    private static object File(string json, string mode = PackModes.KeepManual, string? token = null, bool enable = false) =>
        new { json, mode, previewToken = token, enable };

    private async Task<JsonElement> PreviewAsync(Session session, object request) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/preview", request)));

    private async Task<JsonElement> ApplyAsync(Session session, object request) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/apply", request)));

    /// <summary>A Spanish pack for the catalog (and the test Property's content), every text made from the Vietnamese reference by a marker so a copy is detectable.</summary>
    private async Task<string> SpanishPackAsync(string packId = "es-test", string version = "1", string? offers = "Ofertas", bool complete = true)
    {
        await using var scope = Factory.Services.CreateAsyncScope();
        var content = await scope.ServiceProvider.GetRequiredService<IContentCatalog>().ListAsync(CancellationToken.None);
        var reference = LocalizationAssets.BuiltInPack("en")!.All.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            writer.WriteStartObject();
            writer.WriteString("schema", LanguagePack.SchemaId);
            writer.WriteString("locale", "es");
            writer.WriteString("displayName", "Spanish");
            writer.WriteString("nativeName", "Español");
            writer.WriteString("direction", "ltr");
            writer.WriteString("formatLocale", "es-ES");
            writer.WriteString("defaultCurrency", "EUR");
            writer.WriteStartObject("pack"); writer.WriteString("id", packId); writer.WriteString("version", version); writer.WriteEndObject();
            writer.WriteString("referenceLocale", "vi");
            writer.WriteStartObject("messages");
            foreach (var scopeName in MessageScopes.Ui)
            {
                writer.WriteStartObject(scopeName);
                var keys = LocalizationAssets.Catalog.Where(definition => definition.Scope == scopeName).Select(definition => definition.Key);
                foreach (var key in keys.OrderBy(item => item, StringComparer.Ordinal))
                {
                    if (!complete && key == "customer.header.menu.blog")
                    {
                        continue;
                    }

                    writer.WriteString(key, key == "customer.header.menu.offers" && offers is not null ? offers : MarkSpanish(reference[key]));
                }

                writer.WriteEndObject();
            }

            writer.WriteEndObject();
            writer.WriteStartObject("content");
            foreach (var entry in content)
            {
                writer.WriteString(entry.Key, "ES " + entry.SourceText);
            }

            // The static content of the site (posts, offers, navigation…) is part of what a language must cover.
            foreach (var definition in LocalizationAssets.Catalog.Where(definition => definition.Scope == MessageScopes.Content).OrderBy(definition => definition.Key, StringComparer.Ordinal))
            {
                writer.WriteString(definition.Key, MarkSpanish(reference[definition.Key]));
            }

            writer.WriteEndObject();
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());

        static string MarkSpanish(string english) => english.Contains('{') ? english : "ES " + english;
    }

    [Fact]
    public async Task The_library_lists_the_built_in_packs_with_their_state_and_nothing_is_installed_by_listing()
    {
        using var session = await StartAsync();
        var library = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{Url}/library")))).EnumerateArray().ToDictionary(pack => pack.GetProperty("locale").GetString()!);

        Assert.Contains("vi", library.Keys);
        Assert.Contains("en", library.Keys);
        Assert.Contains("fr", library.Keys);
        Assert.Equal("available", library["fr"].GetProperty("state").GetString());      // not installed
        Assert.Equal("custom", library["vi"].GetProperty("state").GetString());         // present, but not from this pack
        Assert.Equal(0, library["fr"].GetProperty("missingFromCatalog").GetInt32());
        Assert.Equal("Français", library["fr"].GetProperty("nativeName").GetString());
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr'"""));
    }

    [Fact]
    public async Task A_preview_changes_nothing_and_says_exactly_what_installing_would_do()
    {
        using var session = await StartAsync();

        var preview = await PreviewAsync(session, Builtin("bha-fr"));
        Assert.Equal("fr", preview.GetProperty("locale").GetString());
        Assert.True(preview.GetProperty("isNewLanguage").GetBoolean());
        var counts = preview.GetProperty("counts");
        Assert.True(counts.GetProperty("added").GetInt32() >= CatalogKeys);
        Assert.Equal(0, counts.GetProperty("rejected").GetInt32());
        Assert.Equal(counts.GetProperty("inPack").GetInt32(), counts.GetProperty("added").GetInt32() + counts.GetProperty("ignored").GetInt32());
        Assert.True(preview.GetProperty("canApply").GetBoolean());
        Assert.False(string.IsNullOrEmpty(preview.GetProperty("previewToken").GetString()));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr'"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr'"""));
    }

    [Fact]
    public async Task Installing_a_built_in_pack_creates_the_language_off_with_its_texts_and_enabling_needs_the_stored_content_too()
    {
        using var session = await StartAsync();
        var preview = await PreviewAsync(session, Builtin("bha-fr"));
        var applied = await ApplyAsync(session, Builtin("bha-fr", token: preview.GetProperty("previewToken").GetString(), enable: true));

        var language = applied.GetProperty("language");
        Assert.Equal("fr", language.GetProperty("code").GetString());
        Assert.Equal("bha-fr", language.GetProperty("packId").GetString());
        Assert.Equal("EUR", language.GetProperty("defaultCurrencyCode").GetString());
        Assert.Equal("fr-FR", language.GetProperty("formatLocale").GetString());
        // The built-in pack covers the catalog and the demo Riverside content, not this test's Property: it stays a draft.
        Assert.False(language.GetProperty("isActive").GetBoolean());
        Assert.False(applied.GetProperty("enabled").GetBoolean());
        Assert.True(language.GetProperty("missingKeys").GetInt32() > 0);
        Assert.True(language.GetProperty("translatedKeys").GetInt32() >= CatalogKeys);
        Assert.False(await IsOfferedAsync(session, "fr"));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "IsManual" AND "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr')"""));
    }

    private async Task<bool> IsOfferedAsync(Session session, string code)
    {
        var config = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get("/api/v1/website/config"))));
        return config.GetProperty("locales").EnumerateArray().Any(locale => locale.GetProperty("code").GetString() == code);
    }

    [Fact]
    public async Task A_complete_uploaded_pack_installs_enables_and_is_served_with_its_own_texts_and_currency()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/EUR/rate", new { expectedVersion = 1, vndPerUnit = "29748.26" }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/EUR/active", new { expectedVersion = 2, isActive = true }));
        var pack = await SpanishPackAsync();

        var preview = await PreviewAsync(session, File(pack));
        Assert.True(preview.GetProperty("canEnable").GetBoolean());
        Assert.Equal(0, preview.GetProperty("counts").GetProperty("missingAfter").GetInt32());
        var applied = await ApplyAsync(session, File(pack, token: preview.GetProperty("previewToken").GetString(), enable: true));
        Assert.True(applied.GetProperty("enabled").GetBoolean());
        Assert.True(applied.GetProperty("language").GetProperty("isActive").GetBoolean());
        Assert.True(applied.GetProperty("language").GetProperty("isComplete").GetBoolean());

        Assert.True(await IsOfferedAsync(session, "es"));
        var config = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get("/api/v1/website/config"))));
        Assert.Equal("EUR", config.GetProperty("locales").EnumerateArray().Single(locale => locale.GetProperty("code").GetString() == "es").GetProperty("defaultCurrency").GetString());
        var dictionary = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get("/api/v1/website/dictionary?locale=es&scopes=customer,content"))));
        Assert.Equal("es", dictionary.GetProperty("resolvedLocale").GetString());
        Assert.Equal("Ofertas", dictionary.GetProperty("entries").GetProperty("customer.header.menu.offers").GetString());
        Assert.StartsWith("ES ", dictionary.GetProperty("entries").EnumerateObject().First(property => property.Name.StartsWith("content.property.")).Value.GetString());
        Assert.NotEqual(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "SourceHash" IS NOT NULL AND "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es')"""));
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task An_incomplete_pack_is_a_draft_the_public_never_sees_and_it_cannot_be_turned_on()
    {
        using var session = await StartAsync();
        var pack = await SpanishPackAsync(complete: false);

        var preview = await PreviewAsync(session, File(pack));
        Assert.False(preview.GetProperty("canEnable").GetBoolean());
        Assert.Equal(1, preview.GetProperty("counts").GetProperty("missingAfter").GetInt32());
        var applied = await ApplyAsync(session, File(pack, token: preview.GetProperty("previewToken").GetString(), enable: true));
        Assert.False(applied.GetProperty("enabled").GetBoolean());
        Assert.False(await IsOfferedAsync(session, "es"));

        var version = applied.GetProperty("language").GetProperty("version").GetInt32();
        var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync("/api/admin/v1/website/languages/es/update",
            new { expectedVersion = version, displayName = "Spanish", nativeName = "Español", sortOrder = 90, isActive = true }));
        Assert.Equal(WebsiteErrorCodes.LanguageIncomplete, (await ProblemAsync(refused)).Code);
        var dictionary = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get("/api/v1/website/dictionary?locale=es"))));
        Assert.Equal("vi", dictionary.GetProperty("resolvedLocale").GetString());   // a draft is invisible

        // Completing it in the editor is enough to turn it on.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Translations}/save", new { locale = "es", key = "customer.header.menu.blog", value = "Blog", expectedVersion = (int?)null }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/EUR/rate", new { expectedVersion = 1, vndPerUnit = "29748.26" }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/currencies/EUR/active", new { expectedVersion = 2, isActive = true }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/languages/es/update",
            new { expectedVersion = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es'"""), displayName = "Spanish", nativeName = "Español", sortOrder = 90, isActive = true, defaultCurrencyCode = "EUR" }));
    }

    [Theory]
    [InlineData("not json at all", "pack-invalid")]
    [InlineData("""{"schema":"bha.language-pack/1","locale":"es"}""", "pack-invalid")]
    [InlineData("[]", "pack-invalid")]
    public async Task A_file_that_is_not_a_pack_is_refused_with_a_reason_and_installs_nothing(string json, string code)
    {
        using var session = await StartAsync();
        var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/preview", File(json)));
        Assert.Equal(code, (await ProblemAsync(refused)).Code);
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/preview", Builtin("no-such-pack")));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/preview", Builtin("bha-fr", mode: "merge")));
    }

    [Fact]
    public async Task A_bad_text_is_reported_against_its_key_and_blocks_the_whole_install_atomically()
    {
        using var session = await StartAsync();
        var good = await SpanishPackAsync();
        using var document = JsonDocument.Parse(good);
        var tampered = good
            .Replace("\"customer.header.menu.offers\": \"Ofertas\"", "\"customer.header.menu.offers\": \"<script>alert(1)</script>\"")
            .Replace("\"shared.common.error.loadFailed\": \"Something went wrong while loading {what}.\"", "\"shared.common.error.loadFailed\": \"Algo salió mal al cargar.\"");
        Assert.NotEqual(good, tampered);

        var preview = await PreviewAsync(session, File(tampered));
        Assert.False(preview.GetProperty("canApply").GetBoolean());
        Assert.Equal(2, preview.GetProperty("counts").GetProperty("rejected").GetInt32());
        var issues = preview.GetProperty("issues").EnumerateArray().Where(issue => issue.GetProperty("severity").GetString() == "error").ToArray();
        Assert.Contains(issues, issue => issue.GetProperty("key").GetString() == "customer.header.menu.offers" && issue.GetProperty("message").GetString()!.Contains("plain text"));
        Assert.Contains(issues, issue => issue.GetProperty("key").GetString() == "shared.common.error.loadFailed" && issue.GetProperty("message").GetString()!.Contains("{what}"));

        var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/apply", File(tampered, token: preview.GetProperty("previewToken").GetString())));
        Assert.Equal(WebsiteErrorCodes.PackInvalid, (await ProblemAsync(refused)).Code);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es'"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "LanguageId" NOT IN (SELECT "Id" FROM "WebsiteLanguages")"""));
    }

    [Fact]
    public async Task Keys_that_do_not_exist_here_are_skipped_and_reported_not_stored()
    {
        using var session = await StartAsync();
        var pack = (await SpanishPackAsync()).Replace("\"content\": {", "\"content\": {\n \"content.roomType.00000000-0000-0000-0000-000000000009.name\": \"Fantasma\",", StringComparison.Ordinal)
            .Replace("\"customer\": {", "\"customer\": {\n \"customer.not.in.catalog\": \"x\",", StringComparison.Ordinal);
        var preview = await PreviewAsync(session, File(pack));
        Assert.Equal(2, preview.GetProperty("counts").GetProperty("ignored").GetInt32());
        Assert.True(preview.GetProperty("canApply").GetBoolean());
        var applied = await ApplyAsync(session, File(pack, token: preview.GetProperty("previewToken").GetString()));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" IN ('customer.not.in.catalog', 'content.roomType.00000000-0000-0000-0000-000000000009.name')"""));
        Assert.True(applied.GetProperty("language").GetProperty("isComplete").GetBoolean());
    }

    [Fact]
    public async Task Applying_a_stale_preview_a_second_time_or_after_a_change_installs_nothing_and_says_why()
    {
        using var session = await StartAsync();
        var pack = await SpanishPackAsync();
        var preview = await PreviewAsync(session, File(pack));
        var token = preview.GetProperty("previewToken").GetString();

        await ApplyAsync(session, File(pack, token: token));
        var versionAfter = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es'""");
        var rowsAfter = await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" """);

        // The same confirmation again (a double click, a retry after a lost response): nothing is imported twice.
        var again = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/apply", File(pack, token: token)));
        Assert.Equal(WebsiteErrorCodes.StalePreview, (await ProblemAsync(again)).Code);
        Assert.Equal(versionAfter, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es'"""));
        Assert.Equal(rowsAfter, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" """));

        // A preview made before somebody edited the language is stale too.
        var fresh = await PreviewAsync(session, File(pack, mode: PackModes.Overwrite));
        var key = "customer.header.menu.blog";
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Translations}/save",
            new { locale = "es", key, value = "Diario", expectedVersion = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es')""") }));
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/apply", File(pack, mode: PackModes.Overwrite, token: fresh.GetProperty("previewToken").GetString())));
        Assert.Equal(WebsiteErrorCodes.StalePreview, (await ProblemAsync(stale)).Code);
        Assert.Equal("Diario", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es')"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/apply", File(pack)));   // no token at all
    }

    [Fact]
    public async Task Updating_a_pack_keeps_manual_edits_unless_overwrite_is_chosen_and_says_how_many_it_kept()
    {
        using var session = await StartAsync();
        var first = await SpanishPackAsync(version: "1", offers: "Ofertas");
        await ApplyAsync(session, File(first, token: (await PreviewAsync(session, File(first))).GetProperty("previewToken").GetString()));
        var key = "customer.header.menu.offers";
        var languageId = "(SELECT \"Id\" FROM \"WebsiteLanguages\" WHERE \"NormalizedCode\" = 'es')";
        Assert.False(await ScalarAsync<bool>($"""SELECT "IsManual" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = {languageId}"""));

        // The operator edits one text by hand.
        var version = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = {languageId}""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Translations}/save", new { locale = "es", key, value = "Promociones", expectedVersion = version }));
        Assert.True(await ScalarAsync<bool>($"""SELECT "IsManual" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = {languageId}"""));

        // A new version of the pack changes that text and another one.
        var second = (await SpanishPackAsync(version: "2", offers: "Ofertas nuevas")).Replace("\"ES Blog\"", "\"ES Blog 2\"");
        var keep = await PreviewAsync(session, File(second, mode: PackModes.KeepManual));
        Assert.Equal(1, keep.GetProperty("counts").GetProperty("keptManual").GetInt32());
        Assert.Equal(0, keep.GetProperty("counts").GetProperty("overwrittenManual").GetInt32());
        Assert.False(keep.GetProperty("isNewLanguage").GetBoolean());
        await ApplyAsync(session, File(second, mode: PackModes.KeepManual, token: keep.GetProperty("previewToken").GetString()));
        Assert.Equal("Promociones", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = {languageId}"""));
        Assert.Equal("2", await ScalarAsync<string>("""SELECT "PackVersion" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'es'"""));

        var overwrite = await PreviewAsync(session, File(second, mode: PackModes.Overwrite));
        Assert.Equal(1, overwrite.GetProperty("counts").GetProperty("overwrittenManual").GetInt32());
        Assert.Equal(0, overwrite.GetProperty("counts").GetProperty("keptManual").GetInt32());
        await ApplyAsync(session, File(second, mode: PackModes.Overwrite, token: overwrite.GetProperty("previewToken").GetString()));
        Assert.Equal("Ofertas nuevas", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = {languageId}"""));
        Assert.False(await ScalarAsync<bool>($"""SELECT "IsManual" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = {languageId}"""));
    }

    [Fact]
    public async Task Export_then_import_round_trips_and_a_fallback_is_never_exported_as_translated()
    {
        using var session = await StartAsync();
        await CompleteContentAsync("en");
        var key = "customer.header.menu.blog";
        await ExecuteAsync($"""DELETE FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = '{WebsiteTestSeed.English}'""");   // English now lacks one text

        var exported = await (await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{Url}/export/en"))).Content.ReadAsStringAsync();
        using var pack = JsonDocument.Parse(exported);
        var root = pack.RootElement;
        Assert.Equal(LanguagePack.SchemaId, root.GetProperty("schema").GetString());
        Assert.Equal("en", root.GetProperty("locale").GetString());
        Assert.Equal("English", root.GetProperty("nativeName").GetString());
        Assert.Equal("USD", root.GetProperty("defaultCurrency").GetString());
        Assert.False(root.GetProperty("messages").GetProperty("customer").TryGetProperty(key, out _));       // not exported as if translated
        Assert.Equal(1, root.GetProperty("export").GetProperty("missingKeys").GetInt32());
        Assert.Equal("Offers", root.GetProperty("messages").GetProperty("customer").GetProperty("customer.header.menu.offers").GetString());
        Assert.True(root.GetProperty("sources").EnumerateObject().Any());

        // Import it back: nothing changes, and the missing text is reported as missing.
        var preview = await PreviewAsync(session, File(exported));
        var counts = preview.GetProperty("counts");
        Assert.Equal(0, counts.GetProperty("added").GetInt32());
        Assert.Equal(0, counts.GetProperty("updated").GetInt32());
        Assert.Equal(1, counts.GetProperty("missingAfter").GetInt32());
        Assert.False(preview.GetProperty("canEnable").GetBoolean());
        Assert.Equal(counts.GetProperty("inPack").GetInt32(), counts.GetProperty("unchanged").GetInt32());
        await AssertStatusAsync(HttpStatusCode.NotFound, session.GetAsync($"{Url}/export/zz"));
    }

    [Fact]
    public async Task A_template_is_an_empty_pack_with_every_required_key_and_the_reference_text_to_translate()
    {
        using var session = await StartAsync();
        var template = await (await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{Url}/template?reference=vi"))).Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(template);
        var root = document.RootElement;
        Assert.Equal("und", root.GetProperty("locale").GetString());
        Assert.Equal("vi", root.GetProperty("referenceLocale").GetString());
        Assert.Equal("Ưu đãi", root.GetProperty("messages").GetProperty("customer").GetProperty("customer.header.menu.offers").GetString());
        var total = root.GetProperty("messages").EnumerateObject().Sum(space => space.Value.EnumerateObject().Count()) + root.GetProperty("content").EnumerateObject().Count();
        Assert.Equal(root.GetProperty("export").GetProperty("requiredKeys").GetInt32(), total);
        // The template is not installable as it is: the translator names the language first.
        var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/preview", File(template)));
        Assert.Equal(WebsiteErrorCodes.PackInvalid, (await ProblemAsync(refused)).Code);
    }
}
