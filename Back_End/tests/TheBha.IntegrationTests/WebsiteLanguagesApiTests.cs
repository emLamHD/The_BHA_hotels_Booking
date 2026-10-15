using System.Net;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 acceptance A3 (languages): create, edit, turn on/off, change the default, delete — with the
/// rules that keep exactly one active default that has a value for every managed key. Real PostgreSQL through the real
/// Admin routes; after every scenario the database invariants are checked directly.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteLanguagesApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/admin/v1/website/languages";
    private static readonly int Keys = WebsiteTranslationCatalog.All.Count;

    private static object NewLanguage(string code, bool active = false, string display = "Test language", string native = "Ngôn ngữ thử", int sort = 90) =>
        new { code, displayName = display, nativeName = native, sortOrder = sort, isActive = active };

    private static object Edit(int version, string display, string native, int sort, bool active) =>
        new { expectedVersion = version, displayName = display, nativeName = native, sortOrder = sort, isActive = active };

    [Fact]
    public async Task The_seeded_languages_are_vietnamese_active_default_and_english_present_but_off_with_every_key()
    {
        using var session = await StartAsync();

        var list = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Url)));
        Assert.Equal(["vi", "en"], list.EnumerateArray().Select(language => language.GetProperty("code").GetString()).ToArray());
        var vi = list[0];
        Assert.True(vi.GetProperty("isDefault").GetBoolean());
        Assert.True(vi.GetProperty("isActive").GetBoolean());
        Assert.Equal(Keys, vi.GetProperty("translatedKeys").GetInt32());
        Assert.Equal(Keys, vi.GetProperty("totalKeys").GetInt32());
        Assert.Equal(1, vi.GetProperty("version").GetInt32());
        var en = list[1];
        Assert.False(en.GetProperty("isDefault").GetBoolean());
        Assert.False(en.GetProperty("isActive").GetBoolean());
        Assert.Equal(Keys, en.GetProperty("translatedKeys").GetInt32());
        // Counts say "of the managed keys", never "of the whole site".
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task A_language_is_created_with_a_canonical_code_and_a_duplicate_in_any_case_is_refused()
    {
        using var session = await StartAsync();

        var created = await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("EN-us", display: "English (US)", native: "English (US)", sort: 25)));
        var body = await JsonAsync(created);
        Assert.Equal("en-US", body.GetProperty("code").GetString());
        Assert.Equal(1, body.GetProperty("version").GetInt32());
        Assert.False(body.GetProperty("isDefault").GetBoolean());
        Assert.Equal(0, body.GetProperty("translatedKeys").GetInt32());
        Assert.Equal(Keys, body.GetProperty("totalKeys").GetInt32());
        Assert.Equal(await StaffIdAsync(Site), body.GetProperty("updatedByStaffId").GetGuid());

        foreach (var duplicate in new[] { "en-us", "EN-US", "en-US", " en-US " })
        {
            var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Url, NewLanguage(duplicate)));
            Assert.Equal((WebsiteErrorCodes.AlreadyExists, "code"), await ProblemAsync(refused));
        }

        foreach (var duplicateOfSeed in new[] { "VI", "En" })
        {
            await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Url, NewLanguage(duplicateOfSeed)));
        }

        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
        Assert.Equal("en-US", await ScalarAsync<string>("""SELECT "Code" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en-us' """));
        await AssertInvariantsAsync();
    }

    [Theory]
    [InlineData("english", "code")]
    [InlineData("en_US", "code")]
    [InlineData("e", "code")]
    [InlineData("", "code")]
    [InlineData("en-USA", "code")]
    public async Task A_malformed_code_is_refused_with_the_field(string code, string field)
    {
        using var session = await StartAsync();
        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage(code)));
        Assert.Equal((WebsiteErrorCodes.Validation, field), await ProblemAsync(refused));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
    }

    [Fact]
    public async Task Names_and_order_are_validated_field_by_field_and_missing_properties_are_a_400_not_a_500()
    {
        using var session = await StartAsync();

        Assert.Equal((WebsiteErrorCodes.Validation, "displayName"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage("fr", display: "   ")))));
        Assert.Equal((WebsiteErrorCodes.Validation, "nativeName"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage("fr", native: "<script>alert(1)</script>")))));
        Assert.Equal((WebsiteErrorCodes.Validation, "displayName"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage("fr", display: new string('x', 101))))));
        Assert.Equal((WebsiteErrorCodes.Validation, "sortOrder"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage("fr", sort: -1)))));
        Assert.Equal((WebsiteErrorCodes.Validation, "sortOrder"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewLanguage("fr", sort: 10_001)))));

        // Missing, null or wrongly typed properties never reach the store.
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, """{"code":"fr"}"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, """{"code":null,"displayName":"x","nativeName":"x","sortOrder":1,"isActive":false}"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, """{"code":"fr","displayName":"x","nativeName":"x","sortOrder":"one","isActive":false}"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, "not json"));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));

        // A client cannot name the actor: an extra property is ignored and the audit says who really signed in.
        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(
            Url, """{"code":"fr","displayName":"French","nativeName":"Français","sortOrder":30,"isActive":false,"updatedByStaffId":"11111111-1111-1111-1111-111111111111","isDefault":true,"version":99}""")));
        Assert.Equal(await StaffIdAsync(Site), created.GetProperty("updatedByStaffId").GetGuid());
        Assert.False(created.GetProperty("isDefault").GetBoolean());
        Assert.Equal(1, created.GetProperty("version").GetInt32());
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task An_edit_checks_the_version_and_a_stale_editor_gets_a_conflict_not_a_silent_overwrite()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("fr", display: "French")));

        var edited = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/fr/update", Edit(1, "Français (FR)", "Français", 31, active: true))));
        Assert.Equal(2, edited.GetProperty("version").GetInt32());
        Assert.Equal("Français (FR)", edited.GetProperty("displayName").GetString());
        Assert.True(edited.GetProperty("isActive").GetBoolean());
        Assert.Equal(31, edited.GetProperty("sortOrder").GetInt32());

        // A second editor loaded version 1 as well: their save is refused and the first edit stays.
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/fr/update", Edit(1, "Stale", "Stale", 99, active: false)));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(stale)).Code);
        Assert.Equal("Français (FR)", await ScalarAsync<string>("""SELECT "DisplayName" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr' """));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr' """));

        // The code in the route is case-insensitive; a code that does not exist is a 404, a malformed expectedVersion a 400.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/FR/update", Edit(2, "Français", "Français", 31, active: true)));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/xx/update", Edit(1, "x", "x", 1, active: false)));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/english/update", Edit(1, "x", "x", 1, active: false)));
        Assert.Equal((WebsiteErrorCodes.Validation, "expectedVersion"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/fr/update", Edit(0, "x", "x", 1, active: false)))));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/fr/update", """{"displayName":"x","nativeName":"x","sortOrder":1,"isActive":true}"""));
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task The_default_language_cannot_be_turned_off_or_deleted_and_changes_only_to_an_active_complete_language()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("fr", active: true)));

        // vi is the default: it cannot be turned off, whatever the version, and it cannot be deleted.
        var off = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/vi/update", Edit(1, "Vietnamese", "Tiếng Việt", 10, active: false)));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(off)).Code);
        var deleted = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/vi/delete", new { expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(deleted)).Code);

        // fr is active but has no translations: the default must have a value for every key, so it is refused with the gap.
        var incomplete = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/fr/set-default", new { expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageIncomplete, (await ProblemAsync(incomplete)).Code);
        Assert.Contains($"{Keys} of {Keys}", await incomplete.Content.ReadAsStringAsync());

        // en is complete but off: refused until it is turned on.
        var inactive = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/set-default", new { expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.DefaultLanguageRequired, (await ProblemAsync(inactive)).Code);
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/en/update", Edit(1, "English", "English", 20, active: true)));

        // A stale version is refused first; the right version switches the default atomically.
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/set-default", new { expectedVersion = 1 }));
        var switched = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/en/set-default", new { expectedVersion = 2 })));
        Assert.True(switched.GetProperty("isDefault").GetBoolean());
        Assert.Equal(["en"], (await ScalarListAsync("""SELECT "NormalizedCode" FROM "WebsiteLanguages" WHERE "IsDefault" """)));
        await AssertInvariantsAsync();

        // vi is an ordinary language now: it may be turned off; en, the default, may not; and back again.
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/update", Edit(3, "English", "English", 20, active: false)));
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/delete", new { expectedVersion = 3 }));
        var viVersion = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi' """);
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/vi/set-default", new { expectedVersion = viVersion }));
        Assert.Equal(["vi"], await ScalarListAsync("""SELECT "NormalizedCode" FROM "WebsiteLanguages" WHERE "IsDefault" """));

        // Setting the current default again is a no-op success, not an error.
        var again = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi' """);
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/vi/set-default", new { expectedVersion = again }));
        Assert.Equal(again, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi' """));
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task A_language_is_deleted_only_when_off_unused_and_not_the_default()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("fr", active: true)));
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewLanguage("de", active: false)));

        // On: visitors can pick it, so it is turned off, not deleted.
        var active = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/fr/delete", new { expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.LanguageInUse, (await ProblemAsync(active)).Code);
        Assert.Contains("Turn it off", await active.Content.ReadAsStringAsync());

        // Off but it has saved translations: deleting would lose them.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(
            "/api/admin/v1/website/translations/save", new { locale = "de", key = "common.close", value = "Schließen", expectedVersion = (int?)null }));
        var used = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/de/delete", new { expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.LanguageInUse, (await ProblemAsync(used)).Code);
        Assert.Contains("1 saved translation", await used.Content.ReadAsStringAsync());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'de' """));

        // Stale version, unknown code: refused; the unused off language is removed.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/fr/update", Edit(1, "Test language", "Ngôn ngữ thử", 90, active: false)));
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/fr/delete", new { expectedVersion = 1 }));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/xx/delete", new { expectedVersion = 1 }));
        await AssertStatusAsync(HttpStatusCode.NoContent, session.PostAsync($"{Url}/fr/delete", new { expectedVersion = 2 }));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr' """));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/fr/delete", new { expectedVersion = 2 }));
        await AssertInvariantsAsync();

        // The seeded English is a normal language with 25 values: it is kept, not deleted.
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/en/delete", new { expectedVersion = 1 }));
        Assert.Equal(Keys, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' """));
    }

    [Fact]
    public async Task The_database_itself_refuses_what_the_application_would_never_send()
    {
        using var session = await StartAsync();
        var viewer = Factory.CreateDbContext();
        await using var _ = viewer;

        async Task<string> Refused(string sql)
        {
            var failure = await Assert.ThrowsAnyAsync<Exception>(() => viewer.Database.ExecuteSqlRawAsync(sql));
            return failure.ToString();
        }

        // Two defaults, a default that is off, a duplicate in another case, a bad code, a missing default: all refused by the database.
        Assert.Contains("CK_WebsiteLanguages_DefaultIsActive", await Refused("""UPDATE "WebsiteLanguages" SET "IsDefault" = true WHERE "NormalizedCode" = 'en'"""));
        Assert.Contains("UX_WebsiteLanguages_OneDefault", await Refused("""UPDATE "WebsiteLanguages" SET "IsActive" = true, "IsDefault" = true WHERE "NormalizedCode" = 'en'"""));
        Assert.Contains("CK_WebsiteLanguages_DefaultIsActive", await Refused("""UPDATE "WebsiteLanguages" SET "IsActive" = false WHERE "NormalizedCode" = 'vi'"""));
        Assert.Contains("UX_WebsiteLanguages_NormalizedCode", await Refused("""INSERT INTO "WebsiteLanguages" VALUES (gen_random_uuid(),'VI','vi','x','x',1,false,false,1,now(),now(),NULL)"""));
        Assert.Contains("CK_WebsiteLanguages_Code", await Refused("""INSERT INTO "WebsiteLanguages" VALUES (gen_random_uuid(),'EN_us','en_us','x','x',1,false,false,1,now(),now(),NULL)"""));
        Assert.Contains("exactly one default language", await Refused("""UPDATE "WebsiteLanguages" SET "IsDefault" = false WHERE "NormalizedCode" = 'vi'"""));
        Assert.Contains("exactly one default language", await Refused("""DELETE FROM "WebsiteTranslations" WHERE "LanguageId" IN (SELECT "Id" FROM "WebsiteLanguages" WHERE "IsDefault"); DELETE FROM "WebsiteLanguages" WHERE "IsDefault" """));
        await AssertInvariantsAsync();
    }

    private async Task<string[]> ScalarListAsync(string sql)
    {
        await using var connection = new Npgsql.NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new Npgsql.NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync())
        {
            values.Add(reader.GetString(0));
        }

        return [.. values];
    }
}
