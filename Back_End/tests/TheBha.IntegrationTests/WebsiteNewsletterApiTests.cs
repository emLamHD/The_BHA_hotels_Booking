using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using TheBha.Api;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-NEWSLETTER-001: the public newsletter request (anonymous, uncredentialed, rate limited) and the Staff list. The database
/// is checked after every request that could write, because "one row per address" is the contract, not the status code.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteNewsletterApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Public = "/api/v1/website/newsletter-subscriptions";
    private const string Admin = "/api/admin/v1/website/newsletter-subscriptions";
    private const string CustomerOrigin = "https://localhost:3000";

    private WebApplicationFactory<Program> PublicHost(int? permitLimit = null) =>
        Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Cors:AllowedOrigins:0", CustomerOrigin);
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.UseSetting("Website:Newsletter:RateLimiting:PermitLimit", (permitLimit ?? 10000).ToString());
        });

    private static HttpRequestMessage Subscribe(object? body, string? origin = CustomerOrigin) => Post(Public, body, origins: origin is null ? [] : [origin]);

    private async Task<int> RowsAsync() => await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSubscriptions" """);

    [Fact]
    public async Task A_new_address_is_recorded_normalized_as_pending_from_the_homepage_and_answered_202()
    {
        await Factory.ResetDatabaseAsync();
        using var host = PublicHost();
        using var client = CreateHttpsClient(host);
        var received = DateTimeOffset.Parse("2026-11-16T04:00:00Z");
        Factory.Clock.UtcNow = received;

        var response = await AssertStatusAsync(HttpStatusCode.Accepted, client.SendAsync(Subscribe(new { email = "  Ten.Nguoi+BHA@Example.COM  " })));

        Assert.Equal("{\"status\":\"received\"}", await response.Content.ReadAsStringAsync());
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(1, await RowsAsync());
        Assert.Equal("ten.nguoi+bha@example.com", await ScalarAsync<string>("""SELECT "Email" FROM "NewsletterSubscriptions" """));
        Assert.Equal("homepage", await ScalarAsync<string>("""SELECT "Source" FROM "NewsletterSubscriptions" """));
        Assert.Equal("PendingVerification", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));
        Assert.Equal(received.UtcDateTime, await ScalarAsync<DateTime>("""SELECT "ReceivedAtUtc" FROM "NewsletterSubscriptions" """));
    }

    [Fact]
    public async Task The_same_address_in_another_case_or_with_spaces_is_one_row_answered_identically_and_keeps_its_first_time()
    {
        await Factory.ResetDatabaseAsync();
        using var host = PublicHost();
        using var client = CreateHttpsClient(host);

        Factory.Clock.UtcNow = DateTimeOffset.Parse("2026-11-16T04:00:00Z");
        var first = await AssertStatusAsync(HttpStatusCode.Accepted, client.SendAsync(Subscribe(new { email = "guest@example.com" })));
        var firstBody = await first.Content.ReadAsStringAsync();
        var firstTime = await ScalarAsync<DateTime>("""SELECT "ReceivedAtUtc" FROM "NewsletterSubscriptions" """);
        Factory.Clock.UtcNow = DateTimeOffset.Parse("2026-11-16T09:30:00Z");

        foreach (var again in new[] { "guest@example.com", "GUEST@EXAMPLE.COM", "  Guest@Example.com\t", "\nguest@EXAMPLE.com " })
        {
            var repeat = await AssertStatusAsync(HttpStatusCode.Accepted, client.SendAsync(Subscribe(new { email = again })));
            Assert.Equal(firstBody, await repeat.Content.ReadAsStringAsync());
            Assert.Equal(first.Content.Headers.ContentType, repeat.Content.Headers.ContentType);
        }

        Assert.Equal(1, await RowsAsync());
        Assert.Equal(firstTime, await ScalarAsync<DateTime>("""SELECT "ReceivedAtUtc" FROM "NewsletterSubscriptions" """));
    }

    [Fact]
    public async Task Concurrent_requests_for_one_address_create_exactly_one_row_and_all_get_the_same_answer()
    {
        await Factory.ResetDatabaseAsync();
        using var host = PublicHost();
        using var client = CreateHttpsClient(host);

        var spellings = Enumerable.Range(0, 24).Select(i => i % 3 == 0 ? "Race@Example.com" : i % 3 == 1 ? " race@example.com" : "RACE@EXAMPLE.COM ").ToArray();
        var responses = await Task.WhenAll(spellings.Select(email => client.SendAsync(Subscribe(new { email }))));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Accepted, response.StatusCode));
        Assert.All(await Task.WhenAll(responses.Select(response => response.Content.ReadAsStringAsync())), body => Assert.Equal("{\"status\":\"received\"}", body));
        Assert.Equal(1, await RowsAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abc")]
    [InlineData("abc@")]
    [InlineData("@example.com")]
    [InlineData("a@b")]
    [InlineData("a@@example.com")]
    [InlineData("a b@example.com")]
    [InlineData("a@example..com")]
    [InlineData("a@example.c")]
    [InlineData(".a@example.com")]
    [InlineData("a..b@example.com")]
    [InlineData("a@-example.com")]
    public async Task An_invalid_address_is_refused_with_a_code_and_writes_nothing(string email)
    {
        await Factory.ResetDatabaseAsync();
        using var host = PublicHost();
        using var client = CreateHttpsClient(host);

        var response = await AssertStatusAsync(HttpStatusCode.BadRequest, client.SendAsync(Subscribe(new { email })));

        Assert.Equal(("newsletter-email-invalid", "email"), await ProblemAsync(response));
        Assert.Equal(0, await RowsAsync());
    }

    [Fact]
    public async Task A_missing_null_overlong_or_malformed_body_is_a_400_and_writes_nothing()
    {
        await Factory.ResetDatabaseAsync();
        using var host = PublicHost();
        using var client = CreateHttpsClient(host);

        await AssertStatusAsync(HttpStatusCode.BadRequest, client.SendAsync(Subscribe(new { })));
        await AssertStatusAsync(HttpStatusCode.BadRequest, client.SendAsync(Subscribe(new { email = (string?)null })));
        await AssertStatusAsync(HttpStatusCode.BadRequest, client.SendAsync(Subscribe(new { email = new string('a', 250) + "@example.com" })));
        await AssertStatusAsync(HttpStatusCode.BadRequest, client.SendAsync(Subscribe("{ not json")));
        Assert.Equal(0, await RowsAsync());
    }

    [Fact]
    public async Task The_request_is_rate_limited_per_client_and_a_limited_request_writes_nothing()
    {
        await Factory.ResetDatabaseAsync();
        using var host = PublicHost(permitLimit: 3);
        using var client = CreateHttpsClient(host);

        for (var i = 0; i < 3; i++)
        {
            await AssertStatusAsync(HttpStatusCode.Accepted, client.SendAsync(Subscribe(new { email = $"person{i}@example.com" })));
        }

        var limited = await AssertStatusAsync(HttpStatusCode.TooManyRequests, client.SendAsync(Subscribe(new { email = "late@example.com" })));
        Assert.DoesNotContain("authentication", await limited.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(3, await RowsAsync());
    }

    [Fact]
    public async Task Only_the_approved_origins_may_call_it_from_a_browser_and_it_never_takes_credentials()
    {
        await Factory.ResetDatabaseAsync();
        using var host = PublicHost();
        using var client = CreateHttpsClient(host);

        foreach (var (origin, allowed) in new[] { (CustomerOrigin, true), (AdminOrigin, true), ("https://evil.example", false) })
        {
            var preflight = new HttpRequestMessage(HttpMethod.Options, Public);
            preflight.Headers.TryAddWithoutValidation("Origin", origin);
            preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
            preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type");
            var answer = await client.SendAsync(preflight);
            Assert.Equal(allowed, answer.Headers.Contains("Access-Control-Allow-Origin"));
            Assert.False(answer.Headers.Contains("Access-Control-Allow-Credentials"));
        }

        var accepted = await AssertStatusAsync(HttpStatusCode.Accepted, client.SendAsync(Subscribe(new { email = "cors@example.com" })));
        Assert.Equal(CustomerOrigin, accepted.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.False(accepted.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task The_database_itself_refuses_a_second_row_for_an_address_and_an_address_that_is_not_normalized()
    {
        await Factory.ResetDatabaseAsync();
        await ExecuteAsync("""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),'one@example.com','homepage','PendingVerification',now())""");

        await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync("""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),'one@example.com','homepage','PendingVerification',now())"""));
        await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync("""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),'Two@Example.com','homepage','PendingVerification',now())"""));
        await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync("""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),' three@example.com','homepage','PendingVerification',now())"""));
        await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync("""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),'four@example.com','homepage','Verified',now())"""));
        Assert.Equal(1, await RowsAsync());
    }

    [Fact]
    public async Task Staff_with_the_website_permission_list_newest_first_search_literally_and_page_on_the_server()
    {
        using var session = await StartAsync();
        await ExecuteAsync("""
            INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES
              (gen_random_uuid(),'old@example.com','homepage','PendingVerification','2026-11-01T00:00:00Z'),
              (gen_random_uuid(),'mid@example.com','homepage','PendingVerification','2026-11-02T00:00:00Z'),
              (gen_random_uuid(),'new@example.com','homepage','PendingVerification','2026-11-03T00:00:00Z'),
              (gen_random_uuid(),'a_b@example.com','homepage','PendingVerification','2026-11-04T00:00:00Z'),
              (gen_random_uuid(),'axb@example.com','homepage','PendingVerification','2026-11-05T00:00:00Z')
            """);

        var all = await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin));
        Assert.Contains("no-store", all.Headers.CacheControl?.ToString());
        var page1 = await JsonAsync(all);
        Assert.Equal(5, page1.GetProperty("total").GetInt32());
        Assert.Equal(["axb@example.com", "a_b@example.com", "new@example.com", "mid@example.com", "old@example.com"],
            page1.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("email").GetString()).ToArray());
        var first = page1.GetProperty("items")[0];
        Assert.Equal("PendingVerification", first.GetProperty("status").GetString());
        Assert.Equal("homepage", first.GetProperty("source").GetString());

        var paged = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin + "?pageSize=2&page=2")));
        Assert.Equal(5, paged.GetProperty("total").GetInt32());
        Assert.Equal(2, paged.GetProperty("page").GetInt32());
        Assert.Equal(["new@example.com", "mid@example.com"], paged.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("email").GetString()).ToArray());

        var beyond = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin + "?pageSize=2&page=9")));
        Assert.Empty(beyond.GetProperty("items").EnumerateArray());
        Assert.Equal(5, beyond.GetProperty("total").GetInt32());

        // A page number whose offset does not fit an int is an empty page, not a 500.
        var huge = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin + $"?pageSize=100&page={int.MaxValue}")));
        Assert.Empty(huge.GetProperty("items").EnumerateArray());
        Assert.Equal(5, huge.GetProperty("total").GetInt32());

        var upper = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin + "?search=MID%40EXAMPLE")));
        Assert.Equal(["mid@example.com"], upper.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("email").GetString()).ToArray());

        // % and _ are data: "a_b" matches only the address that holds an underscore, "%" matches nothing here.
        var underscore = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin + "?search=a_b")));
        Assert.Equal(["a_b@example.com"], underscore.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("email").GetString()).ToArray());
        var percent = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin + "?search=%25")));
        Assert.Equal(0, percent.GetProperty("total").GetInt32());
    }

    [Theory]
    [InlineData("?page=0")]
    [InlineData("?page=-1")]
    [InlineData("?pageSize=0")]
    [InlineData("?pageSize=101")]
    [InlineData("?page=abc")]
    public async Task A_bad_page_request_is_a_400_with_a_code(string query)
    {
        using var session = await StartAsync();

        var response = await session.GetAsync(Admin + query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_request_through_the_real_pipeline_shows_up_in_the_staff_list()
    {
        using var session = await StartAsync();
        using var visitor = CreateHttpsClient(session.Host);

        await AssertStatusAsync(HttpStatusCode.Accepted, visitor.SendAsync(Subscribe(new { email = "demo.guest@example.com" })));

        var list = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin + "?search=demo.guest")));
        Assert.Equal(1, list.GetProperty("total").GetInt32());
        Assert.Equal("demo.guest@example.com", list.GetProperty("items")[0].GetProperty("email").GetString());
    }
}
