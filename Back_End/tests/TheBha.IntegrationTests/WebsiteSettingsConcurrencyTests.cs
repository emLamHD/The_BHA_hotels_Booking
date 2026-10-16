using System.Net;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 acceptance A4 (consistency) against real PostgreSQL: concurrent default switches, disables,
/// deletes and edits through the real Admin routes. Whatever order the requests are served in, the database ends with
/// exactly one active default language that has every key, exactly one active default currency with a rate, no active
/// currency without one, a version that only one editor can win, and no request answers 500.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteSettingsConcurrencyTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Languages = "/api/admin/v1/website/languages";
    private const string Currencies = "/api/admin/v1/website/currencies";
    private const string Save = "/api/admin/v1/website/translations/save";
    private const int Rounds = 12;

    private static async Task<HttpResponseMessage[]> RaceAsync(params Func<Task<HttpResponseMessage>>[] requests)
    {
        using var gate = new ManualResetEventSlim(false);
        var tasks = requests.Select(request => Task.Run(async () =>
        {
            gate.Wait();
            return await request();
        })).ToArray();
        gate.Set();
        return await Task.WhenAll(tasks);
    }

    private static void AssertNoServerError(IEnumerable<HttpResponseMessage> responses) =>
        Assert.All(responses, response => Assert.True((int)response.StatusCode < 500, $"server error {(int)response.StatusCode}"));

    /// <summary>Makes a language active and complete (a copy of English), so it can be the default.</summary>
    private async Task AddCompleteLanguageAsync(Session session, string code)
    {
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Languages, new { code, displayName = code, nativeName = code, sortOrder = 40, isActive = false, defaultCurrencyCode = "VND" }));
        await using (var context = Factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","UpdatedByStaffId")
                SELECT (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = {code}), "Key", "Value", 1, now(), NULL
                FROM "WebsiteTranslations" WHERE "LanguageId" = {WebsiteTestSeed.English}
                """);
        }

        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/{code}/update",
            new { expectedVersion = await VersionAsync(code), displayName = code, nativeName = code, sortOrder = 40, isActive = true, defaultCurrencyCode = "VND" }));
    }

    /// <summary>English complete (stored content included), its currency on, English turned on — the only way it can be switched on now.</summary>
    private async Task TurnEnglishOnAsync(Session session)
    {
        await CompleteContentAsync("en");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/rate", new { expectedVersion = 1, vndPerUnit = "26060" }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = 2, isActive = true }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/en/update",
            new { expectedVersion = await VersionAsync("en"), displayName = "English", nativeName = "English", sortOrder = 20, isActive = true, defaultCurrencyCode = "USD" }));
    }

    private async Task<int> VersionAsync(string code) =>
        await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = '{code}' """);

    [Fact]
    public async Task Concurrent_default_switches_leave_exactly_one_active_complete_default()
    {
        using var session = await StartAsync();
        await TurnEnglishOnAsync(session);
        await AddCompleteLanguageAsync(session, "fr");
        await AddCompleteLanguageAsync(session, "de");

        for (var round = 0; round < Rounds; round++)
        {
            var versions = new Dictionary<string, int>
            {
                ["vi"] = await VersionAsync("vi"), ["en"] = await VersionAsync("en"), ["fr"] = await VersionAsync("fr"), ["de"] = await VersionAsync("de")
            };
            var responses = await RaceAsync(
                [.. versions.SelectMany(pair => Enumerable.Range(0, 3).Select(_ =>
                    (Func<Task<HttpResponseMessage>>)(() => session.PostAsync($"{Languages}/{pair.Key}/set-default", new { expectedVersion = pair.Value }))))]);

            AssertNoServerError(responses);
            Assert.All(responses, response => Assert.True(response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict, $"{(int)response.StatusCode}"));
            Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.OK);
            await AssertInvariantsAsync();
        }
    }

    [Fact]
    public async Task A_disable_racing_a_default_switch_never_leaves_an_inactive_default()
    {
        using var session = await StartAsync();
        await TurnEnglishOnAsync(session);

        var sawSwitch = false;
        var sawDisable = false;
        for (var round = 0; round < Rounds; round++)
        {
            // en is active and not the default; vi is the default.
            var en = await VersionAsync("en");
            var responses = await RaceAsync(
                () => session.PostAsync($"{Languages}/en/set-default", new { expectedVersion = en }),
                () => session.PostAsync($"{Languages}/en/update", new { expectedVersion = en, displayName = "English", nativeName = "English", sortOrder = 20, isActive = false }));

            AssertNoServerError(responses);
            // Same version for both: at most one can win, whichever the lock serves first.
            Assert.True(responses.Count(response => response.StatusCode == HttpStatusCode.OK) <= 1);
            sawSwitch |= responses[0].StatusCode == HttpStatusCode.OK;
            sawDisable |= responses[1].StatusCode == HttpStatusCode.OK;
            await AssertInvariantsAsync();

            // Put the scene back: vi default, en active.
            var vi = await VersionAsync("vi");
            if (await ScalarAsync<bool>("""SELECT "IsDefault" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """))
            {
                await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/vi/set-default", new { expectedVersion = vi }));
            }

            var current = await VersionAsync("en");
            if (!await ScalarAsync<bool>("""SELECT "IsActive" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """))
            {
                await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/en/update", new { expectedVersion = current, displayName = "English", nativeName = "English", sortOrder = 20, isActive = true }));
            }
        }

        Assert.True(sawSwitch || sawDisable);
    }

    [Fact]
    public async Task Two_editors_on_the_same_version_exactly_one_wins_for_a_language_a_translation_and_a_currency()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Languages, new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false }));

        for (var round = 0; round < Rounds; round++)
        {
            var version = await VersionAsync("fr");
            var edits = await RaceAsync(
                () => session.PostAsync($"{Languages}/fr/update", new { expectedVersion = version, displayName = $"A{round}", nativeName = "a", sortOrder = 31, isActive = false }),
                () => session.PostAsync($"{Languages}/fr/update", new { expectedVersion = version, displayName = $"B{round}", nativeName = "b", sortOrder = 32, isActive = false }));
            AssertNoServerError(edits);
            Assert.Equal(1, edits.Count(response => response.StatusCode == HttpStatusCode.OK));
            Assert.Equal(1, edits.Count(response => response.StatusCode == HttpStatusCode.Conflict));
            Assert.Equal(version + 1, await VersionAsync("fr"));
        }

        // Two editors creating the same override: one creates it, the other is told it already exists.
        foreach (var key in new[] { "shared.common.close", "shared.common.retry", "shared.common.loading" })
        {
            var created = await RaceAsync(
                () => session.PostAsync(Save, new { locale = "fr", key, value = "un", expectedVersion = (int?)null }),
                () => session.PostAsync(Save, new { locale = "fr", key, value = "deux", expectedVersion = (int?)null }),
                () => session.PostAsync(Save, new { locale = "fr", key, value = "trois", expectedVersion = (int?)null }));
            AssertNoServerError(created);
            Assert.Equal(1, created.Count(response => response.StatusCode == HttpStatusCode.OK));
            Assert.Equal(2, created.Count(response => response.StatusCode == HttpStatusCode.Conflict));
            Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" IN (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr')"""));
        }

        // The same code created in three spellings at once: one row.
        var spellings = await RaceAsync(
            [.. new[] { "pt", "PT", "Pt", "pT", "pt", "PT" }.Select(code =>
                (Func<Task<HttpResponseMessage>>)(() => session.PostAsync(Languages, new { code, displayName = "Portuguese", nativeName = "Português", sortOrder = 50, isActive = false })))]);
        AssertNoServerError(spellings);
        Assert.Equal(1, spellings.Count(response => response.StatusCode == HttpStatusCode.Created));
        Assert.Equal(5, spellings.Count(response => response.StatusCode == HttpStatusCode.Conflict));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'pt' """));
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task Concurrent_currency_changes_never_leave_an_active_currency_without_a_rate_or_a_missing_default()
    {
        using var session = await StartAsync();

        for (var round = 0; round < Rounds; round++)
        {
            await using (var context = Factory.CreateDbContext())
            {
                await context.Database.ExecuteSqlRawAsync(
                    """
                    UPDATE "WebsiteCurrencies" SET "IsDefault" = false WHERE "Code" <> 'VND' AND "IsDefault";
                    UPDATE "WebsiteCurrencies" SET "IsDefault" = true WHERE "Code" = 'VND' AND NOT "IsDefault";
                    UPDATE "WebsiteLanguages" SET "DefaultCurrencyCode" = NULL WHERE "DefaultCurrencyCode" = 'USD';
                    DELETE FROM "WebsiteCurrencies" WHERE "Code" = 'USD';
                    INSERT INTO "WebsiteCurrencies" VALUES ('USD','US dollar','$',2,20,false,false,false,25000,now(),NULL,'manual',1,now(),now(),NULL);
                    """);
            }

            // All against version 1 of USD: turn on, set the rate, choose it, delete it, turn it off.
            var responses = await RaceAsync(
                () => session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = 1, isActive = true }),
                () => session.PostAsync($"{Currencies}/USD/rate", new { expectedVersion = 1, vndPerUnit = "26000" }),
                () => session.PostAsync($"{Currencies}/USD/set-default", new { expectedVersion = 1 }),
                () => session.PostAsync($"{Currencies}/USD/delete", new { expectedVersion = 1 }),
                () => session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = 1, isActive = false }));

            AssertNoServerError(responses);
            Assert.True(responses.Count(response => (int)response.StatusCode is >= 200 and < 300) <= 1, "two edits of the same version both succeeded");
            Assert.All(responses, response => Assert.True(
                response.StatusCode is HttpStatusCode.OK or HttpStatusCode.NoContent or HttpStatusCode.Conflict or HttpStatusCode.NotFound,
                $"{(int)response.StatusCode}"));
            await AssertInvariantsAsync();
        }
    }

    [Fact]
    public async Task A_currency_default_switch_racing_a_disable_of_the_new_default_keeps_one_active_default()
    {
        using var session = await StartAsync();
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/rate", new { expectedVersion = 1, vndPerUnit = "25400" }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = 2, isActive = true }));

        for (var round = 0; round < Rounds; round++)
        {
            var usd = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """);
            var vnd = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = 'VND' """);
            var responses = await RaceAsync(
                () => session.PostAsync($"{Currencies}/USD/set-default", new { expectedVersion = usd }),
                () => session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = usd, isActive = false }),
                () => session.PostAsync($"{Currencies}/VND/set-default", new { expectedVersion = vnd }));

            AssertNoServerError(responses);
            await AssertInvariantsAsync();

            // Reset: USD on, VND the default.
            var usdNow = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """);
            if (!await ScalarAsync<bool>("""SELECT "IsActive" FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """))
            {
                await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/USD/active", new { expectedVersion = usdNow, isActive = true }));
            }

            if (await ScalarAsync<bool>("""SELECT "IsDefault" FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """))
            {
                var vndNow = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = 'VND' """);
                await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/VND/set-default", new { expectedVersion = vndNow }));
            }
        }
    }

    [Fact]
    public async Task Deleting_a_language_racing_a_translation_save_leaves_either_both_or_neither_and_no_orphan_rows()
    {
        using var session = await StartAsync();

        for (var round = 0; round < Rounds; round++)
        {
            await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Languages, new { code = "de", displayName = "German", nativeName = "Deutsch", sortOrder = 60, isActive = false }));
            var responses = await RaceAsync(
                () => session.PostAsync($"{Languages}/de/delete", new { expectedVersion = 1 }),
                () => session.PostAsync(Save, new { locale = "de", key = "common.close", value = "Schließen", expectedVersion = (int?)null }));

            AssertNoServerError(responses);
            var deleted = responses[0].StatusCode == HttpStatusCode.NoContent;
            var saved = responses[1].StatusCode == HttpStatusCode.OK;
            Assert.True(deleted ^ saved || (!deleted && !saved), "a delete and a save both succeeded");
            var languageRows = await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'de' """);
            var translationRows = await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" t WHERE NOT EXISTS (SELECT 1 FROM "WebsiteLanguages" l WHERE l."Id" = t."LanguageId") """);
            Assert.Equal(0, translationRows);                                  // never a value without its language
            Assert.Equal(deleted ? 0 : 1, languageRows);

            if (!deleted)
            {
                // Clean up for the next round: the saved override is cleared, then the language deleted.
                if (saved)
                {
                    await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/translations/clear", new { locale = "de", key = "common.close", expectedVersion = 1 }));
                }

                var version = await VersionAsync("de");
                await AssertStatusAsync(HttpStatusCode.NoContent, session.PostAsync($"{Languages}/de/delete", new { expectedVersion = version }));
            }

            await AssertInvariantsAsync();
        }
    }

    [Fact]
    public async Task Staff_authorization_is_rechecked_per_request_under_load_a_revoke_stops_later_requests()
    {
        using var session = await StartAsync();
        var before = await RaceAsync([.. Enumerable.Range(0, 8).Select(_ => (Func<Task<HttpResponseMessage>>)(() => session.GetAsync(Languages)))]);
        Assert.All(before, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));

        await CliAsync(session.Host, ["--staff-website-access", "--email", Site, "--enabled", "false"]);
        var after = await RaceAsync([.. Enumerable.Range(0, 8).Select(index => (Func<Task<HttpResponseMessage>>)(() => index % 2 == 0
            ? session.GetAsync(Languages)
            : session.PostAsync(Languages, new { code = "pt", displayName = "Portuguese", nativeName = "Português", sortOrder = 50, isActive = false })))]);
        Assert.All(after, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
    }
}
