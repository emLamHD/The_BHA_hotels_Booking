using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Bookings;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class BookingHoldReadApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset FixedUtc =
        DateTimeOffset.Parse("2026-07-22T18:30:00Z");
    private static readonly DateOnly LocalToday = new(2026, 7, 23);
    private static readonly Guid PropertyId =
        Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid DeluxeRoomTypeId =
        Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid RatePlanId =
        Guid.Parse("60000000-0000-0000-0000-000000000001");
    private const string StrongPassword = "Strong!Password123";

    [Fact]
    public async Task Guest_owner_reads_with_original_token_and_receives_null_token_field()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Read-Guest-Key");
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        var response = await GetAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(holdId, body.GetProperty("holdId").GetGuid());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("guestAccessToken").ValueKind);
        Assert.Equal(
            [LocalToday],
            body.GetProperty("nights").EnumerateArray()
                .Select(night => DateOnly.Parse(night.GetProperty("stayDate").GetString()!)));

        var responseJson = body.GetRawText();
        foreach (var forbidden in new[]
                 {
                     "customerAccountId",
                     "guestAccessTokenHash",
                     "idempotencyKeyHash",
                     "requestFingerprint"
                 })
        {
            Assert.DoesNotContain(forbidden, responseJson, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Authenticated_owner_reads_own_hold()
    {
        await SeedFixedAsync();
        using var application = WithGenerousLoginRateLimit();
        using var client = application.CreateClient();
        await CreateCustomerAsync(client, "read-hold-owner@example.com");
        var created = await CreateHoldAsync(client, "Read-Auth-Key");
        var holdId = created.GetProperty("holdId").GetGuid();

        var response = await GetAsync(client, holdId, null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Logged_in_caller_can_read_a_guest_owned_hold_via_correct_token_without_claiming_it()
    {
        await SeedFixedAsync();
        using var guestClient = factory.CreateClient();
        var created = await CreateHoldAsync(guestClient, "Read-Guest-Or-Key");
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        using var loggedInApplication = WithGenerousLoginRateLimit();
        using var loggedInClient = loggedInApplication.CreateClient();
        await CreateCustomerAsync(loggedInClient, "logged-in-hold-reader@example.com");

        var response = await GetAsync(loggedInClient, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Null(hold.CustomerAccountId);
        Assert.NotNull(hold.GuestAccessTokenHash);
    }

    [Fact]
    public async Task No_credential_and_malformed_credential_are_unauthorized()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Read-NoCred-Key");
        var holdId = created.GetProperty("holdId").GetGuid();

        AssertProblem(await GetAsync(client, holdId, null), HttpStatusCode.Unauthorized);
        AssertProblem(
            await GetAsync(client, holdId, "not-a-valid-token"),
            HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Wrong_token_foreign_account_and_missing_id_are_not_disclosing()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Read-Wrong-Key");
        var holdId = created.GetProperty("holdId").GetGuid();
        var otherToken = new CryptographicGuestAccessTokenGenerator().Generate();

        AssertProblem(await GetAsync(client, holdId, otherToken), HttpStatusCode.NotFound);
        AssertProblem(
            await GetAsync(client, Guid.NewGuid(), otherToken),
            HttpStatusCode.NotFound);

        using var otherCustomerApplication = WithGenerousLoginRateLimit();
        using var otherCustomerClient = otherCustomerApplication.CreateClient();
        await CreateCustomerAsync(otherCustomerClient, "foreign-hold-reader@example.com");
        AssertProblem(
            await GetAsync(otherCustomerClient, holdId, null),
            HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Matching_contact_email_alone_does_not_grant_read_ownership_without_the_guest_token()
    {
        const string SharedEmail = "shared-hold-contact@example.com";
        await SeedFixedAsync();
        using var guestClient = factory.CreateClient();
        var holdResponse = await PostHoldAsync(
            guestClient,
            "Read-SharedEmail-Key",
            ValidRequest() with { Email = SharedEmail });
        Assert.Equal(HttpStatusCode.Created, holdResponse.StatusCode);
        var holdId = (await holdResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("holdId").GetGuid();

        using var authenticatedApplication = WithGenerousLoginRateLimit();
        using var authenticatedClient = authenticatedApplication.CreateClient();
        await CreateCustomerAsync(authenticatedClient, SharedEmail);

        AssertProblem(
            await GetAsync(authenticatedClient, holdId, null),
            HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Invalid_customer_cookie_is_not_silently_ignored()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Read-InvalidCookie-Key");
        var holdId = created.GetProperty("holdId").GetGuid();

        client.DefaultRequestHeaders.Add("Cookie", ".TheBha.Customer=tampered-value");
        AssertProblem(await GetAsync(client, holdId, null), HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Read_does_not_require_antiforgery()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Read-NoAntiforgery-Key");
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/booking-holds/{holdId}");
        request.Headers.Add("X-Booking-Access-Token", guestToken);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Read_does_not_mutate_or_refresh_the_hold()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Read-NoMutate-Key");
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        await GetAsync(client, holdId, guestToken);
        await GetAsync(client, holdId, guestToken);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(FixedUtc, hold.CreatedAtUtc);
        Assert.Equal(FixedUtc.AddMinutes(15), hold.ExpiresAtUtc);
        Assert.Equal(
            BookingHoldRequestSecurity.Sha256Hex(guestToken),
            hold.GuestAccessTokenHash);
    }

    [Fact]
    public async Task OpenApi_documents_hold_read_endpoint_without_antiforgery_header()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths")
            .GetProperty("/api/v1/booking-holds/{holdId}")
            .GetProperty("get");
        var headerNames = operation.GetProperty("parameters")
            .EnumerateArray()
            .Select(parameter => parameter.GetProperty("name").GetString())
            .ToArray();
        Assert.Contains("X-Booking-Access-Token", headerNames);
        Assert.DoesNotContain("X-CSRF-TOKEN", headerNames);
        foreach (var status in new[] { "200", "401", "404" })
        {
            Assert.True(operation.GetProperty("responses").TryGetProperty(status, out _));
        }
    }

    private async Task<JsonElement> CreateHoldAsync(HttpClient client, string idempotencyKey)
    {
        var response = await PostHoldAsync(client, idempotencyKey, ValidRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<HttpResponseMessage> GetAsync(
        HttpClient client,
        Guid holdId,
        string? guestAccessToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/booking-holds/{holdId}");
        if (guestAccessToken is not null)
        {
            request.Headers.Add("X-Booking-Access-Token", guestAccessToken);
        }

        return await client.SendAsync(request);
    }

    private static ApiRequest ValidRequest() =>
        new(
            PropertyId,
            DeluxeRoomTypeId,
            RatePlanId,
            LocalToday,
            LocalToday.AddDays(1),
            1,
            0,
            1,
            "Guest Name",
            "guest@example.com",
            "+84 123 4567");

    private static async Task<HttpResponseMessage> PostHoldAsync(
        HttpClient client,
        string idempotencyKey,
        object payload)
    {
        var csrf = await GetCsrfAsync(client);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/booking-holds")
        {
            Content = JsonContent.Create(payload)
        };
        request.Headers.Add("Idempotency-Key", idempotencyKey);
        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request);
    }

    private static async Task<CsrfResponse> GetCsrfAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/v1/auth/csrf");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CsrfResponse>())!;
    }

    private WebApplicationFactory<Program> WithGenerousLoginRateLimit() =>
        factory.WithWebHostBuilder(builder =>
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "1000"));

    private async Task SeedFixedAsync()
    {
        factory.Clock.UtcNow = FixedUtc;
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context, new FixedTimeProvider(FixedUtc))
            .SeedAsync(CancellationToken.None);
    }

    private async Task<Guid> CreateCustomerAsync(HttpClient client, string email)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var userManager = scope.ServiceProvider
            .GetRequiredService<UserManager<CustomerAccount>>();
        var account = new CustomerAccount
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = email
        };
        var result = await userManager.CreateAsync(account, StrongPassword);
        Assert.True(result.Succeeded);
        var login = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { email, password = StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return account.Id;
    }

    private static void AssertProblem(HttpResponseMessage response, HttpStatusCode status)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(
            "application/problem+json",
            response.Content.Headers.ContentType?.MediaType);
    }

    private sealed record CsrfResponse(string Token, string HeaderName);

    private sealed record ApiRequest(
        Guid PropertyId,
        Guid RoomTypeId,
        Guid RatePlanId,
        DateOnly CheckIn,
        DateOnly CheckOut,
        int Adults,
        int Children,
        int Rooms,
        string FullName,
        string Email,
        string Phone);

    private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }
}
