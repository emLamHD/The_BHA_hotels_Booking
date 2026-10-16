using System.Net;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: the display-price projection. Exact decimal arithmetic on the server, ONE rate snapshot per
/// request, rounding to the currency's minor units per line, totals as the sum of the rounded lines, no stored price or
/// booking touched, and a currency that is off or has no rate refused rather than answered with a made-up rate. The rates
/// here are test data, not market rates.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteDisplayPricesApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/v1/website/display-prices";
    private const string Currencies = "/api/admin/v1/website/currencies";

    private async Task RateAsync(Session session, string code, string rate, bool on = true)
    {
        var version = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = '{code}'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/{code}/rate", new { expectedVersion = version, vndPerUnit = rate }));
        if (on)
        {
            await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/{code}/active", new { expectedVersion = version + 1, isActive = true }));
        }
    }

    private static Task<HttpResponseMessage> QuoteAsync(Session session, object body) => session.Client.SendAsync(Post(Url, body));

    [Fact]
    public async Task Lines_are_converted_and_rounded_one_by_one_and_a_sum_is_the_sum_of_the_rounded_lines()
    {
        using var session = await StartAsync();
        await RateAsync(session, "USD", "26060");

        var quote = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, QuoteAsync(session, new
        {
            currency = "usd",
            lines = new[]
            {
                new { @ref = "night1", unitVnd = "1000000", quantity = 2 },
                new { @ref = "night2", unitVnd = "1100000.50", quantity = 2 },
                new { @ref = "night3", unitVnd = "500", quantity = 1 }
            },
            sums = new[] { new { @ref = "stay", of = new[] { "night1", "night2", "night3" } } }
        })));

        Assert.Equal("USD", quote.GetProperty("currency").GetString());
        Assert.Equal(2, quote.GetProperty("minorUnits").GetInt32());
        Assert.False(quote.GetProperty("isBase").GetBoolean());
        Assert.Equal("26060", quote.GetProperty("rate").GetProperty("vndPerUnit").GetString());
        Assert.Equal(3, quote.GetProperty("rate").GetProperty("version").GetInt32());
        var lines = quote.GetProperty("lines").EnumerateArray().ToDictionary(line => line.GetProperty("ref").GetString()!);
        Assert.Equal("38.37", lines["night1"].GetProperty("unit").GetString());          // 1,000,000 / 26,060 = 38.3730
        Assert.Equal("76.74", lines["night1"].GetProperty("total").GetString());         // 38.37 x 2 (the rounded unit, not the exact product)
        Assert.Equal("42.21", lines["night2"].GetProperty("unit").GetString());          // 1,100,000.50 / 26,060 = 42.2103
        Assert.Equal("0.02", lines["night3"].GetProperty("unit").GetString());
        var sum = quote.GetProperty("sums")[0];
        var expected = 38.37m * 2 + decimal.Parse(lines["night2"].GetProperty("total").GetString()!) + 0.02m;
        Assert.Equal(expected.ToString("F2", System.Globalization.CultureInfo.InvariantCulture), sum.GetProperty("total").GetString());
        // No stored price, hold or reservation is read or written.
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "InventoryHolds" """));
    }

    [Fact]
    public async Task The_base_currency_is_shown_as_stored_with_no_rounding_to_another_unit()
    {
        using var session = await StartAsync();
        var quote = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, QuoteAsync(session, new
        {
            currency = "VND",
            lines = new[] { new { @ref = "a", unitVnd = "1089000", quantity = 3 }, new { @ref = "b", unitVnd = "1000.5", quantity = 1 } },
            sums = new[] { new { @ref = "all", of = new[] { "a", "b" } } }
        })));
        Assert.True(quote.GetProperty("isBase").GetBoolean());
        Assert.Equal("1", quote.GetProperty("rate").GetProperty("vndPerUnit").GetString());
        Assert.Equal("1089000", quote.GetProperty("lines")[0].GetProperty("unit").GetString());
        Assert.Equal("3267000", quote.GetProperty("lines")[0].GetProperty("total").GetString());
        Assert.Equal("1000.5", quote.GetProperty("lines")[1].GetProperty("unit").GetString());
        Assert.Equal("3268000.5", quote.GetProperty("sums")[0].GetProperty("total").GetString());
    }

    [Fact]
    public async Task All_lines_of_one_request_use_one_rate_snapshot_even_if_the_rate_changes_right_after()
    {
        using var session = await StartAsync();
        await RateAsync(session, "EUR", "29748.26");
        var first = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, QuoteAsync(session, new { currency = "EUR", lines = new[] { new { @ref = "a", unitVnd = "1000000", quantity = 1 }, new { @ref = "b", unitVnd = "2000000", quantity = 1 } } })));
        Assert.Equal("33.62", first.GetProperty("lines")[0].GetProperty("unit").GetString());
        Assert.Equal("67.23", first.GetProperty("lines")[1].GetProperty("unit").GetString());
        var version = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteCurrencies" WHERE "Code" = 'EUR'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/EUR/rate", new { expectedVersion = version, vndPerUnit = "30000" }));
        var second = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, QuoteAsync(session, new { currency = "EUR", lines = new[] { new { @ref = "a", unitVnd = "1000000", quantity = 1 } } })));
        Assert.Equal("33.33", second.GetProperty("lines")[0].GetProperty("unit").GetString());
        Assert.Equal(version + 1, second.GetProperty("rate").GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task A_currency_that_is_off_unknown_or_without_a_rate_is_a_409_never_a_made_up_rate()
    {
        using var session = await StartAsync();
        var lines = new[] { new { @ref = "a", unitVnd = "1000000", quantity = 1 } };
        foreach (var currency in new[] { "USD", "EUR", "JPY" })
        {
            var refused = await AssertStatusAsync(HttpStatusCode.Conflict, QuoteAsync(session, new { currency, lines }));
            Assert.Equal((WebsiteErrorCodes.CurrencyInactive, "currency"), await ProblemAsync(refused));
        }

        await RateAsync(session, "USD", "26060", on: false);   // a rate, but still off
        await AssertStatusAsync(HttpStatusCode.Conflict, QuoteAsync(session, new { currency = "USD", lines }));
    }

    [Theory]
    [InlineData("""{"currency":"US","lines":[{"ref":"a","unitVnd":"1","quantity":1}]}""")]
    [InlineData("""{"currency":"VND","lines":[]}""")]
    [InlineData("""{"currency":"VND","lines":[{"ref":"a","unitVnd":"1.234","quantity":1}]}""")]
    [InlineData("""{"currency":"VND","lines":[{"ref":"a","unitVnd":"-5","quantity":1}]}""")]
    [InlineData("""{"currency":"VND","lines":[{"ref":"a","unitVnd":"1e3","quantity":1}]}""")]
    [InlineData("""{"currency":"VND","lines":[{"ref":"a","unitVnd":"1","quantity":0}]}""")]
    [InlineData("""{"currency":"VND","lines":[{"ref":"a","unitVnd":"1","quantity":1},{"ref":"a","unitVnd":"2","quantity":1}]}""")]
    [InlineData("""{"currency":"VND","lines":[{"ref":"a","unitVnd":"1","quantity":1}],"sums":[{"ref":"s","of":["nope"]}]}""")]
    public async Task Malformed_requests_are_a_400_with_a_code(string body)
    {
        using var session = await StartAsync();
        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, session.Client.SendAsync(Post(Url, body)));
        Assert.Equal(WebsiteErrorCodes.Validation, (await ProblemAsync(refused)).Code);
    }

    [Fact]
    public async Task The_projection_needs_no_session_and_no_antiforgery_token_and_is_never_cached()
    {
        using var session = await StartAsync();
        var response = await AssertStatusAsync(HttpStatusCode.OK, QuoteAsync(session, new { currency = "VND", lines = new[] { new { @ref = "a", unitVnd = "100", quantity = 1 } } }));
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.False(response.Headers.Contains("Set-Cookie"));
        var oversize = new { currency = "VND", lines = Enumerable.Range(0, 501).Select(index => new { @ref = $"l{index}", unitVnd = "1", quantity = 1 }) };
        await AssertStatusAsync(HttpStatusCode.BadRequest, QuoteAsync(session, oversize));
    }
}
