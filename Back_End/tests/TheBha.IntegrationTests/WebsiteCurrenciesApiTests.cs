using System.Net;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 acceptance A3 (currencies and rates): create and edit a currency, set an exact decimal
/// rate (VND per one unit), turn on and choose a default only with a rate, return to VND, and the protections of the
/// VND base and of a default or active currency. Real PostgreSQL through the real Admin routes. The rates used here
/// are test data, not real exchange rates.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteCurrenciesApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/admin/v1/website/currencies";

    private static object NewCurrency(string code, string name = "Test currency", string symbol = "¤", int minor = 2, int sort = 90) =>
        new { code, name, symbol, minorUnits = minor, sortOrder = sort };

    private static object Rate(int version, string rate) => new { expectedVersion = version, vndPerUnit = rate };

    private async Task<string?> RateTextAsync(string code) =>
        await ScalarAsync<string?>($"""SELECT COALESCE("VndPerUnit"::text, '') FROM "WebsiteCurrencies" WHERE "Code" = '{code}' """) is { Length: > 0 } text ? text : null;

    [Fact]
    public async Task The_seeded_currencies_are_vnd_the_base_and_default_and_usd_eur_with_metadata_but_no_rate()
    {
        using var session = await StartAsync();

        var list = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Url)))).EnumerateArray().ToArray();
        Assert.Equal(["VND", "USD", "EUR"], list.Select(currency => currency.GetProperty("code").GetString()).ToArray());
        var vnd = list[0];
        Assert.True(vnd.GetProperty("isBase").GetBoolean());
        Assert.True(vnd.GetProperty("isDefault").GetBoolean());
        Assert.True(vnd.GetProperty("isActive").GetBoolean());
        Assert.Equal("1", vnd.GetProperty("vndPerUnit").GetString());
        Assert.Equal(0, vnd.GetProperty("minorUnits").GetInt32());
        Assert.Equal("manual", vnd.GetProperty("rateSource").GetString());
        foreach (var foreign in list.Skip(1))
        {
            Assert.False(foreign.GetProperty("isActive").GetBoolean());
            Assert.False(foreign.GetProperty("isDefault").GetBoolean());
            Assert.False(foreign.GetProperty("isBase").GetBoolean());
            Assert.Equal(JsonValueKind.Null, foreign.GetProperty("vndPerUnit").ValueKind);        // nothing invented
            Assert.Equal(JsonValueKind.Null, foreign.GetProperty("rateUpdatedAtUtc").ValueKind);
            Assert.Equal(2, foreign.GetProperty("minorUnits").GetInt32());
        }

        Assert.Equal("$", list[1].GetProperty("symbol").GetString());
        Assert.Equal("€", list[2].GetProperty("symbol").GetString());
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task A_currency_starts_off_without_a_rate_gets_an_exact_rate_then_is_turned_on_chosen_and_returned_to_vnd()
    {
        using var session = await StartAsync();

        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewCurrency("gbp", "Pound sterling", "£", 2, 40))));
        Assert.Equal("GBP", created.GetProperty("code").GetString());
        Assert.False(created.GetProperty("isActive").GetBoolean());
        Assert.Equal(JsonValueKind.Null, created.GetProperty("vndPerUnit").ValueKind);
        Assert.Equal(1, created.GetProperty("version").GetInt32());

        // No rate: it can be neither turned on nor chosen.
        var noRateOn = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/GBP/active", new { expectedVersion = 1, isActive = true }));
        Assert.Equal((WebsiteErrorCodes.RateRequired, "vndPerUnit"), await ProblemAsync(noRateOn));
        var noRateDefault = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/GBP/set-default", new { expectedVersion = 1 }));
        Assert.Equal(WebsiteErrorCodes.RateRequired, (await ProblemAsync(noRateDefault)).Code);

        // The rate is stored exactly and stamped by the server with who and when; the source is manual.
        var rated = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/gbp/rate", Rate(1, "33333.33333333"))));
        Assert.Equal("33333.33333333", rated.GetProperty("vndPerUnit").GetString());
        Assert.Equal("manual", rated.GetProperty("rateSource").GetString());
        Assert.Equal(2, rated.GetProperty("version").GetInt32());
        Assert.NotEqual(JsonValueKind.Null, rated.GetProperty("rateUpdatedAtUtc").ValueKind);
        Assert.Equal("33333.33333333", await RateTextAsync("GBP"));
        Assert.Equal(await StaffIdAsync(Site), await ScalarAsync<Guid>("""SELECT "RateUpdatedByStaffId" FROM "WebsiteCurrencies" WHERE "Code" = 'GBP' """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "Code" = 'GBP' AND ("IsActive" OR "IsDefault")"""));

        // On, then chosen as the display default; VND is no longer the default but stays the base.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/GBP/active", new { expectedVersion = 2, isActive = true }));
        var chosen = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/GBP/set-default", new { expectedVersion = 3 })));
        Assert.True(chosen.GetProperty("isDefault").GetBoolean());
        Assert.Equal(["GBP"], await Defaults());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "IsBase" AND "Code" = 'VND' """));
        await AssertInvariantsAsync();

        // The default display currency can be neither turned off nor deleted while it is the default.
        var off = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/GBP/active", new { expectedVersion = 4, isActive = false }));
        Assert.Equal(WebsiteErrorCodes.DefaultCurrencyRequired, (await ProblemAsync(off)).Code);
        var removed = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/GBP/delete", new { expectedVersion = 4 }));
        Assert.Equal(WebsiteErrorCodes.DefaultCurrencyRequired, (await ProblemAsync(removed)).Code);

        // Back to VND: the base is always chosen-able.
        var vndVersion = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = 'VND' """);
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/VND/set-default", new { expectedVersion = vndVersion }));
        Assert.Equal(["VND"], await Defaults());
        await AssertInvariantsAsync();

        // GBP is on: it is turned off, not deleted; then it can be deleted.
        var active = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/GBP/delete", new { expectedVersion = 5 }));
        Assert.Equal(WebsiteErrorCodes.CurrencyInUse, (await ProblemAsync(active)).Code);
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/GBP/active", new { expectedVersion = 5, isActive = false }));
        await AssertStatusAsync(HttpStatusCode.NoContent, session.PostAsync($"{Url}/GBP/delete", new { expectedVersion = 6 }));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "Code" = 'GBP' """));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/GBP/delete", new { expectedVersion = 6 }));
        await AssertInvariantsAsync();

        async Task<string[]> Defaults()
        {
            await using var connection = new Npgsql.NpgsqlConnection(Factory.ConnectionString);
            await connection.OpenAsync();
            await using var command = new Npgsql.NpgsqlCommand("""SELECT "Code" FROM "WebsiteCurrencies" WHERE "IsDefault" """, connection);
            await using var reader = await command.ExecuteReaderAsync();
            var codes = new List<string>();
            while (await reader.ReadAsync())
            {
                codes.Add(reader.GetString(0).Trim());
            }

            return [.. codes];
        }
    }

    [Theory]
    [InlineData("0")]
    [InlineData("0.0")]
    [InlineData("-1")]
    [InlineData("+5")]
    [InlineData("1e3")]
    [InlineData("1E3")]
    [InlineData("1,5")]
    [InlineData("1 000")]
    [InlineData(" 5")]
    [InlineData("NaN")]
    [InlineData("Infinity")]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData("25000.123456789")]
    [InlineData("1000000000000")]
    [InlineData(".5")]
    public async Task A_rate_that_is_not_a_plain_positive_decimal_within_precision_is_a_400_on_vndPerUnit(string rate)
    {
        using var session = await StartAsync();
        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/USD/rate", Rate(1, rate)));
        Assert.Equal((WebsiteErrorCodes.Validation, "vndPerUnit"), await ProblemAsync(refused));
        Assert.Null(await RateTextAsync("USD"));
    }

    [Fact]
    public async Task A_rate_sent_as_a_json_number_is_refused_so_it_never_passes_through_a_javascript_number()
    {
        using var session = await StartAsync();

        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/USD/rate", """{"expectedVersion":1,"vndPerUnit":25000.5}"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/USD/rate", """{"expectedVersion":1,"vndPerUnit":25000}"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/USD/rate", """{"expectedVersion":1,"vndPerUnit":null}"""));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/USD/rate", """{"expectedVersion":1}"""));
        Assert.Null(await RateTextAsync("USD"));

        // As a string, the same digits are accepted and kept exactly (a double would have rounded this one).
        var ok = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/USD/rate", """{"expectedVersion":1,"vndPerUnit":"123456789012.12345678"}""")));
        Assert.Equal("123456789012.12345678", ok.GetProperty("vndPerUnit").GetString());
        Assert.Equal("123456789012.12345678", await RateTextAsync("USD"));
    }

    [Fact]
    public async Task A_rate_can_be_corrected_while_the_currency_is_on_and_a_stale_editor_is_refused()
    {
        using var session = await StartAsync();

        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/USD/rate", Rate(1, "25400")));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/USD/active", new { expectedVersion = 2, isActive = true }));
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/USD/rate", Rate(2, "99999")));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(stale)).Code);
        Assert.Equal("25400.00000000", await RateTextAsync("USD"));

        var corrected = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/USD/rate", Rate(3, "25450.25"))));
        Assert.Equal("25450.25", corrected.GetProperty("vndPerUnit").GetString());
        Assert.True(corrected.GetProperty("isActive").GetBoolean());
        await AssertInvariantsAsync();

        // A default may be chosen only if it is on; an off currency with a rate is refused until it is turned on.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/EUR/rate", Rate(1, "27800")));
        var off = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/EUR/set-default", new { expectedVersion = 2 }));
        Assert.Equal(WebsiteErrorCodes.CurrencyInactive, (await ProblemAsync(off)).Code);
        Assert.Equal(["VND"], await DefaultCodes());
    }

    [Fact]
    public async Task VND_is_fixed_its_rate_status_and_existence_cannot_be_changed_and_codes_are_validated()
    {
        using var session = await StartAsync();

        foreach (var (path, body) in new (string, object)[]
                 {
                     ($"{Url}/VND/update", new { expectedVersion = 1, name = "Dong", symbol = "d", minorUnits = 0, sortOrder = 10 }),
                     ($"{Url}/VND/rate", Rate(1, "2")),
                     ($"{Url}/VND/active", new { expectedVersion = 1, isActive = false }),
                     ($"{Url}/vnd/delete", new { expectedVersion = 1 })
                 })
        {
            var refused = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(path, body));
            Assert.Equal(WebsiteErrorCodes.BaseCurrencyFixed, (await ProblemAsync(refused)).Code);
        }

        Assert.Equal("1.00000000", await RateTextAsync("VND"));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = 'VND' """));
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Url, NewCurrency("vnd")));          // cannot be created again

        // Codes: ISO 4217 only, upper-cased, unique.
        Assert.Equal((WebsiteErrorCodes.Validation, "code"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewCurrency("ABC")))));
        Assert.Equal((WebsiteErrorCodes.Validation, "code"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewCurrency("US")))));
        Assert.Equal((WebsiteErrorCodes.Validation, "minorUnits"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewCurrency("GBP", minor: 5)))));
        Assert.Equal((WebsiteErrorCodes.Validation, "symbol"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewCurrency("GBP", symbol: " ")))));
        Assert.Equal((WebsiteErrorCodes.Validation, "name"), await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewCurrency("GBP", name: "<b>")))));
        await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewCurrency("jpy", "Yen", "¥", 0, 50)));
        await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync(Url, NewCurrency("JPY")));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/XYZ/rate", Rate(1, "1")));
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/GBP/rate", Rate(1, "1")));
        await AssertInvariantsAsync();
    }

    /// <summary>
    /// ISO 4217 List Three codes: a withdrawn code is refused on the code field and nothing is stored, so the public
    /// config can never offer it. The assertion that matters is the absence of a row (a never-activated currency is
    /// absent from the config anyway).
    /// </summary>
    [Theory]
    [InlineData("ZWL")]
    [InlineData("zwl")]
    [InlineData("ANG")]
    [InlineData("BGN")]
    public async Task A_withdrawn_currency_code_is_a_400_on_code_and_nothing_is_stored(string code)
    {
        using var session = await StartAsync();

        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync(Url, NewCurrency(code, "Withdrawn", "¤")));
        Assert.Equal((WebsiteErrorCodes.Validation, "code"), await ProblemAsync(refused));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "Code" IN ('ZWL', 'ANG', 'BGN') """));
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" """));   // still only VND, USD, EUR
        await AssertStatusAsync(HttpStatusCode.NotFound, session.PostAsync($"{Url}/{code}/rate", Rate(1, "1")));
        await AssertInvariantsAsync();
    }

    /// <summary>
    /// XCG (Caribbean guilder, amendment 176) is a current code that was missing, and SVC is a current code that a
    /// review mistook for withdrawn. Both go through the whole lifecycle; the rates are made-up test data.
    /// </summary>
    [Theory]
    [InlineData("xcg", "XCG", "Caribbean guilder", "Cg", "14000.5")]
    [InlineData("SVC", "SVC", "El Salvador colon", "₡", "2900")]
    public async Task A_current_code_is_created_rated_turned_on_and_offered_by_the_public_config(string typed, string code, string name, string symbol, string rate)
    {
        using var session = await StartAsync();

        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, session.PostAsync(Url, NewCurrency(typed, name, symbol, 2, 60))));
        Assert.Equal(code, created.GetProperty("code").GetString());
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/{code.ToLowerInvariant()}/rate", Rate(1, rate)));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/{code}/active", new { expectedVersion = 2, isActive = true }));

        var config = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get("/api/v1/website/config"))));   // no cookie: anonymous
        var offered = config.GetProperty("currencies").EnumerateArray().Single(currency => currency.GetProperty("code").GetString() == code);
        Assert.Equal(rate, offered.GetProperty("vndPerUnit").GetString());
        Assert.Equal(name, offered.GetProperty("name").GetString());
        Assert.Equal("VND", config.GetProperty("defaultCurrency").GetString());
        await AssertInvariantsAsync();
    }

    [Fact]
    public async Task Editing_a_currency_checks_the_version_and_the_code_is_never_changed()
    {
        using var session = await StartAsync();

        var edited = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/usd/update", new { expectedVersion = 1, name = "United States dollar", symbol = "US$", minorUnits = 2, sortOrder = 25 })));
        Assert.Equal("USD", edited.GetProperty("code").GetString());
        Assert.Equal("United States dollar", edited.GetProperty("name").GetString());
        Assert.Equal("US$", edited.GetProperty("symbol").GetString());
        Assert.Equal(2, edited.GetProperty("version").GetInt32());
        Assert.Equal(JsonValueKind.Null, edited.GetProperty("vndPerUnit").ValueKind);        // editing metadata invents no rate

        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, session.PostAsync($"{Url}/USD/update", new { expectedVersion = 1, name = "Stale", symbol = "S", minorUnits = 2, sortOrder = 1 }));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(stale)).Code);
        Assert.Equal("United States dollar", await ScalarAsync<string>("""SELECT "Name" FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/USD/update", new { expectedVersion = 2, name = "x", symbol = "x", minorUnits = 9, sortOrder = 1 }));
        // The code is the identity: an extra "code" in the body is ignored, the route decides.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Url}/USD/update", """{"expectedVersion":2,"code":"EUR","name":"Dollar","symbol":"$","minorUnits":2,"sortOrder":25}"""));
        Assert.Equal("Dollar", await ScalarAsync<string>("""SELECT "Name" FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """));
        Assert.Equal("Euro", await ScalarAsync<string>("""SELECT "Name" FROM "WebsiteCurrencies" WHERE "Code" = 'EUR' """));
    }

    [Fact]
    public async Task The_database_itself_refuses_a_wrong_rate_an_active_currency_without_one_and_a_second_default_or_base()
    {
        using var session = await StartAsync();
        await using var viewer = Factory.CreateDbContext();

        async Task<string> Refused(string sql) =>
            (await Assert.ThrowsAnyAsync<Exception>(() => viewer.Database.ExecuteSqlRawAsync(sql))).ToString();

        Assert.Contains("CK_WebsiteCurrencies_ActiveNeedsRate", await Refused("""UPDATE "WebsiteCurrencies" SET "IsActive" = true WHERE "Code" = 'USD'"""));
        Assert.Contains("CK_WebsiteCurrencies_Rate", await Refused("""UPDATE "WebsiteCurrencies" SET "VndPerUnit" = 0, "RateUpdatedAtUtc" = now() WHERE "Code" = 'USD'"""));
        Assert.Contains("CK_WebsiteCurrencies_Rate", await Refused("""UPDATE "WebsiteCurrencies" SET "VndPerUnit" = -5, "RateUpdatedAtUtc" = now() WHERE "Code" = 'USD'"""));
        Assert.Contains("CK_WebsiteCurrencies_RateStamp", await Refused("""UPDATE "WebsiteCurrencies" SET "VndPerUnit" = 5 WHERE "Code" = 'USD'"""));
        Assert.Contains("CK_WebsiteCurrencies_Base", await Refused("""UPDATE "WebsiteCurrencies" SET "VndPerUnit" = 2 WHERE "Code" = 'VND'"""));
        Assert.Contains("CK_WebsiteCurrencies_Base", await Refused("""UPDATE "WebsiteCurrencies" SET "IsBase" = true WHERE "Code" = 'USD'"""));
        Assert.Contains("CK_WebsiteCurrencies_DefaultIsActive", await Refused("""UPDATE "WebsiteCurrencies" SET "IsDefault" = true WHERE "Code" = 'USD'"""));
        Assert.Contains("CK_WebsiteCurrencies_Code", await Refused("""INSERT INTO "WebsiteCurrencies" VALUES ('us','x','x',2,1,false,false,false,NULL,NULL,NULL,'manual',1,now(),now(),NULL)"""));
        Assert.Contains("exactly one default currency", await Refused("""UPDATE "WebsiteCurrencies" SET "IsDefault" = false WHERE "Code" = 'VND'"""));
        await AssertInvariantsAsync();
    }

    private async Task<string[]> DefaultCodes()
    {
        await using var connection = new Npgsql.NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new Npgsql.NpgsqlCommand("""SELECT "Code" FROM "WebsiteCurrencies" WHERE "IsDefault" """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var codes = new List<string>();
        while (await reader.ReadAsync())
        {
            codes.Add(reader.GetString(0).Trim());
        }

        return [.. codes];
    }
}
