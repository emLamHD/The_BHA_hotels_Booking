using System.Net;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2 acceptance (translations): the editor lists, filters, counts and pages on the server; a text
/// is plain message-syntax text that keeps its key's variables; saving marks it as edited by hand and remembers the reference
/// text it was made from, so a later change of that text shows it as outdated; a stored-content field is a key like any other.
/// Real PostgreSQL through the real Admin routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteTranslationsApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/admin/v1/website/translations";
    private const string Key = "customer.header.menu.offers";
    private const string Placeholder = "shared.common.error.loadFailed";

    private async Task<JsonElement> ListAsync(Session session, string query) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"{Url}?{query}")));

    private static JsonElement RowOf(JsonElement list, string key) =>
        list.GetProperty("rows").EnumerateArray().Single(row => row.GetProperty("key").GetString() == key);

    private async Task<string> PropertyNameKeyAsync() =>
        $"content.property.{await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" LIMIT 1""")}.name";

    [Fact]
    public async Task The_list_is_server_filtered_counted_and_paged_with_the_reference_text_beside_each_row()
    {
        using var session = await StartAsync();

        var all = await ListAsync(session, "locale=vi&pageSize=10");
        Assert.Equal("vi", all.GetProperty("locale").GetString());
        Assert.Equal("vi", all.GetProperty("referenceLocale").GetString());
        Assert.True(all.GetProperty("isDefaultLocale").GetBoolean());
        Assert.Equal(10, all.GetProperty("rows").GetArrayLength());
        var facets = all.GetProperty("facets");
        Assert.Equal(all.GetProperty("total").GetInt32(), facets.GetProperty("required").GetInt32());
        Assert.Equal(0, facets.GetProperty("missing").GetInt32());                       // Vietnamese is complete (content is its own column)
        Assert.Contains(facets.GetProperty("scopes").EnumerateArray(), scope => scope.GetProperty("name").GetString() == "customer");
        Assert.Contains(facets.GetProperty("scopes").EnumerateArray(), scope => scope.GetProperty("name").GetString() == "content");

        var page2 = await ListAsync(session, "locale=vi&pageSize=10&page=2");
        Assert.Empty(all.GetProperty("rows").EnumerateArray().Select(row => row.GetProperty("key").GetString())
            .Intersect(page2.GetProperty("rows").EnumerateArray().Select(row => row.GetProperty("key").GetString())));

        var scoped = await ListAsync(session, "locale=vi&scope=shared&pageSize=200");
        Assert.All(scoped.GetProperty("rows").EnumerateArray(), row => Assert.Equal("shared", row.GetProperty("scope").GetString()));
        var grouped = await ListAsync(session, "locale=vi&scope=customer&group=header&pageSize=200");
        Assert.All(grouped.GetProperty("rows").EnumerateArray(), row => Assert.Equal("header", row.GetProperty("group").GetString()));

        var found = await ListAsync(session, "locale=vi&q=Ưu đãi&pageSize=200");
        Assert.Equal("Ưu đãi", RowOf(found, Key).GetProperty("sourceText").GetString());
        Assert.Equal("translated", RowOf(found, Key).GetProperty("status").GetString());

        var placeholder = RowOf(await ListAsync(session, $"locale=vi&q={Placeholder}"), Placeholder);
        Assert.Equal(["what"], placeholder.GetProperty("placeholders").EnumerateArray().Select(item => item.GetString()).ToArray());
        await AssertStatusAsync(HttpStatusCode.NotFound, session.GetAsync($"{Url}?locale=zz"));
    }

    [Fact]
    public async Task English_shows_its_missing_stored_content_as_missing_and_never_as_translated()
    {
        using var session = await StartAsync();
        var key = await PropertyNameKeyAsync();

        var missing = await ListAsync(session, "locale=en&status=missing&pageSize=200");
        var row = RowOf(missing, key);
        Assert.Equal("missing", row.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, row.GetProperty("value").ValueKind);
        Assert.Equal("Hotel Website", row.GetProperty("sourceText").GetString());        // the column's text is the source
        Assert.All(missing.GetProperty("rows").EnumerateArray(), item => Assert.Equal("content", item.GetProperty("scope").GetString()));
        Assert.Equal(missing.GetProperty("total").GetInt32(), missing.GetProperty("facets").GetProperty("missing").GetInt32());

        var translated = await ListAsync(session, "locale=en&status=translated&pageSize=200");
        Assert.DoesNotContain(translated.GetProperty("rows").EnumerateArray(), item => item.GetProperty("key").GetString() == key);
    }

    [Fact]
    public async Task Saving_a_text_creates_it_marks_it_manual_remembers_its_source_and_a_second_creator_is_refused()
    {
        using var session = await StartAsync();
        var key = await PropertyNameKeyAsync();

        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/save", new { locale = "en", key, value = "  Hotel Website (EN)  ", expectedVersion = (int?)null })));
        Assert.Equal("Hotel Website (EN)", created.GetProperty("value").GetString());
        Assert.True(created.GetProperty("isManual").GetBoolean());
        Assert.Equal("translated", created.GetProperty("status").GetString());
        Assert.Equal(1, created.GetProperty("version").GetInt32());
        Assert.Equal(SourceText.Hash("Hotel Website"), await ScalarAsync<string>($"""SELECT "SourceHash" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = '{WebsiteTestSeed.English}'"""));
        Assert.Equal(await StaffIdAsync(Site), await ScalarAsync<Guid>($"""SELECT "UpdatedByStaffId" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = '{WebsiteTestSeed.English}'"""));

        var second = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/save", new { locale = "en", key, value = "Other", expectedVersion = (int?)null }));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(second)).Code);

        var changed = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/save", new { locale = "en", key, value = "Hotel Website EN", expectedVersion = 1 })));
        Assert.Equal(2, changed.GetProperty("version").GetInt32());
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/save", new { locale = "en", key, value = "Stale", expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(stale)).Code);
        Assert.Equal("Hotel Website EN", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = '{WebsiteTestSeed.English}'"""));
    }

    [Theory]
    [InlineData("Đã có lỗi khi tải.", "value")]                                          // lost {what}
    [InlineData("Could not load {what} {who}.", "value")]                                // added {who}
    [InlineData("<b>Could not load {what}</b>", "value")]                                // markup
    [InlineData("Could not load {what", "value")]                                        // broken message
    [InlineData("  ", "value")]
    public async Task A_text_that_breaks_the_rules_of_its_key_is_a_400_on_value(string value, string field)
    {
        using var session = await StartAsync();
        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/save", new { locale = "en", key = Placeholder, value, expectedVersion = 1 }));
        Assert.Equal((WebsiteErrorCodes.Validation, field), await ProblemAsync(refused));
        Assert.NotEqual(value.Trim(), await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = '{Placeholder}' AND "LanguageId" = '{WebsiteTestSeed.English}'"""));
    }

    [Fact]
    public async Task A_plural_sentence_with_the_declared_variable_is_accepted_and_unknown_keys_or_languages_are_404()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/save", new { locale = "en", key = Placeholder, value = "{what, plural, one {1 thing failed to load} other {# things failed to load}}", expectedVersion = 1 }));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/save", new { locale = "en", key = "customer.nope.nothing", value = "x", expectedVersion = (int?)null }));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/save", new { locale = "zz", key = Key, value = "x", expectedVersion = (int?)null }));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/save", new { locale = "en", key = "content.property.00000000-0000-0000-0000-000000000009.name", value = "x", expectedVersion = (int?)null }));
    }

    [Fact]
    public async Task A_translation_becomes_outdated_when_the_reference_text_changes_and_up_to_date_again_when_it_is_saved()
    {
        using var session = await StartAsync();
        var viVersion = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{Key}' AND "LanguageId" = '{WebsiteTestSeed.Vietnamese}'""");
        Assert.Equal("translated", RowOf(await ListAsync(session, $"locale=en&q={Key}"), Key).GetProperty("status").GetString());

        // Changing the Vietnamese (reference) text: English was made from the old one.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/save", new { locale = "vi", key = Key, value = "Khuyến mãi", expectedVersion = viVersion }));
        var outdated = await ListAsync(session, $"locale=en&q={Key}");
        Assert.Equal("outdated", RowOf(outdated, Key).GetProperty("status").GetString());
        Assert.True(outdated.GetProperty("facets").GetProperty("outdated").GetInt32() >= 1);
        Assert.Contains(RowOf(await ListAsync(session, "locale=en&status=todo&pageSize=200"), Key).GetProperty("key").GetString(), Key);

        var enVersion = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{Key}' AND "LanguageId" = '{WebsiteTestSeed.English}'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/save", new { locale = "en", key = Key, value = "Deals", expectedVersion = enVersion }));
        Assert.Equal("translated", RowOf(await ListAsync(session, $"locale=en&q={Key}"), Key).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Clearing_removes_a_text_of_a_non_default_language_and_is_refused_for_the_default()
    {
        using var session = await StartAsync();
        var version = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{Key}' AND "LanguageId" = '{WebsiteTestSeed.English}'""");

        var cleared = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/clear", new { locale = "en", key = Key, expectedVersion = version })));
        Assert.Equal("missing", cleared.GetProperty("status").GetString());
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" = '{Key}' AND "LanguageId" = '{WebsiteTestSeed.English}'"""));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/clear", new { locale = "en", key = Key, expectedVersion = version }));

        var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/clear", new { locale = "vi", key = Key, expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(refused)).Code);
        await AssertInvariantsAsync();
    }
}
