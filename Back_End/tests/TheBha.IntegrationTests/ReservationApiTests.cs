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
public sealed class ReservationApiTests(PostgreSqlWebApplicationFactory factory)
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
    public async Task Guest_owner_reads_with_original_token()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        var response = await GetAsync(client, reservationId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(reservationId, body.GetProperty("reservationId").GetGuid());
        Assert.Equal(1, body.GetProperty("nights").GetArrayLength());

        var responseJson = body.GetRawText();
        foreach (var forbidden in new[] { "customerAccountId", "guestAccessTokenHash", "guestAccessToken" })
        {
            Assert.DoesNotContain(forbidden, responseJson, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Authenticated_owner_reads_own_reservation()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var customerId = await CreateCustomerAsync(client, "read-owner@example.com");
        var (reservationId, _, _) = await CreateAndConfirmAuthenticatedHoldAsync(client);

        var response = await GetAsync(client, reservationId, null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(customerId, reservation.CustomerAccountId);
    }

    [Fact]
    public async Task Logged_in_caller_can_read_a_guest_owned_reservation_via_correct_token_without_claiming_it()
    {
        await SeedFixedAsync();
        using var guestClient = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(guestClient);

        using var loggedInClient = factory.CreateClient();
        await CreateCustomerAsync(loggedInClient, "logged-in-reader@example.com");

        var response = await GetAsync(loggedInClient, reservationId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Null(reservation.CustomerAccountId);
        Assert.NotNull(reservation.GuestAccessTokenHash);
    }

    [Fact]
    public async Task No_credential_and_malformed_credential_are_unauthorized()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, _, _) = await CreateAndConfirmGuestHoldAsync(client);

        AssertProblem(
            await GetAsync(client, reservationId, null),
            HttpStatusCode.Unauthorized);
        AssertProblem(
            await GetAsync(client, reservationId, "not-a-valid-token"),
            HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Wrong_token_foreign_account_and_missing_id_are_not_disclosing()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, _, _) = await CreateAndConfirmGuestHoldAsync(client);
        var otherToken = new CryptographicGuestAccessTokenGenerator().Generate();

        AssertProblem(
            await GetAsync(client, reservationId, otherToken),
            HttpStatusCode.NotFound);
        AssertProblem(
            await GetAsync(client, Guid.NewGuid(), otherToken),
            HttpStatusCode.NotFound);

        using var otherCustomerClient = factory.CreateClient();
        await CreateCustomerAsync(otherCustomerClient, "foreign-reader@example.com");
        AssertProblem(
            await GetAsync(otherCustomerClient, reservationId, null),
            HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Confirmation_number_and_source_hold_id_are_not_alternative_authorization()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, holdId) = await CreateAndConfirmGuestHoldAsync(client);
        var confirmed = await GetAsync(client, reservationId, guestToken);
        var body = await confirmed.Content.ReadFromJsonAsync<JsonElement>();
        var confirmationNumber = body.GetProperty("confirmationNumber").GetString()!;

        using var attackerClient = factory.CreateClient();
        AssertProblem(
            await attackerClient.GetAsync($"/api/v1/reservations/{reservationId}"),
            HttpStatusCode.Unauthorized);
        AssertProblem(
            await GetAsync(attackerClient, reservationId, confirmationNumber),
            HttpStatusCode.Unauthorized);
        AssertProblem(
            await GetAsync(attackerClient, holdId, null),
            HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Guest_token_cannot_read_an_authenticated_holds_reservation()
    {
        await SeedFixedAsync();
        using var authApplication = WithGenerousLoginRateLimit();
        using var authClient = authApplication.CreateClient();
        await CreateCustomerAsync(authClient, "read-owner-negative@example.com");
        var (reservationId, _, _) = await CreateAndConfirmAuthenticatedHoldAsync(authClient);
        var unrelatedGuestToken = new CryptographicGuestAccessTokenGenerator().Generate();

        using var anonymousClient = factory.CreateClient();
        AssertProblem(
            await GetAsync(anonymousClient, reservationId, unrelatedGuestToken),
            HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Guest_token_for_one_reservation_cannot_read_another_with_identical_contact_details()
    {
        // ValidRequest() always uses the same fullName/email/phone, so two
        // independently created guest holds are identical-contact by
        // construction here - the only thing distinguishing them is each
        // one's own opaque token.
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationIdA, _, _) = await CreateAndConfirmGuestHoldAsync(client);
        var (_, tokenB, _) = await CreateAndConfirmGuestHoldAsync(client);

        AssertProblem(
            await GetAsync(client, reservationIdA, tokenB),
            HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Matching_contact_email_alone_does_not_grant_read_ownership_without_the_guest_token()
    {
        const string SharedEmail = "shared-contact@example.com";
        await SeedFixedAsync();
        using var guestClient = factory.CreateClient();
        var holdResponse = await PostHoldAsync(
            guestClient,
            "Read-SharedEmail-Guest",
            ValidRequest() with { Email = SharedEmail });
        Assert.Equal(HttpStatusCode.Created, holdResponse.StatusCode);
        var holdBody = await holdResponse.Content.ReadFromJsonAsync<JsonElement>();
        var holdId = holdBody.GetProperty("holdId").GetGuid();
        var guestToken = holdBody.GetProperty("guestAccessToken").GetString();

        var confirmed = await ConfirmAsync(guestClient, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var reservationId = (await confirmed.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("reservationId").GetGuid();

        using var authenticatedApplication = WithGenerousLoginRateLimit();
        using var authenticatedClient = authenticatedApplication.CreateClient();
        await CreateCustomerAsync(authenticatedClient, SharedEmail);

        AssertProblem(
            await GetAsync(authenticatedClient, reservationId, null),
            HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Invalid_customer_cookie_is_not_silently_ignored()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, _, _) = await CreateAndConfirmGuestHoldAsync(client);

        client.DefaultRequestHeaders.Add("Cookie", ".TheBha.Customer=tampered-value");
        AssertProblem(
            await GetAsync(client, reservationId, null),
            HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Read_does_not_require_antiforgery()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/reservations/{reservationId}");
        request.Headers.Add("X-Booking-Access-Token", guestToken);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task OpenApi_documents_reservation_read_endpoint()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths")
            .GetProperty("/api/v1/reservations/{reservationId}")
            .GetProperty("get");
        var headerNames = operation.GetProperty("parameters")
            .EnumerateArray()
            .Select(parameter => parameter.GetProperty("name").GetString())
            .ToArray();
        Assert.Contains("X-Booking-Access-Token", headerNames);
        foreach (var status in new[] { "200", "401", "404" })
        {
            Assert.True(operation.GetProperty("responses").TryGetProperty(status, out _));
        }
    }

    private async Task<(Guid ReservationId, string GuestToken, Guid HoldId)>
        CreateAndConfirmGuestHoldAsync(HttpClient client)
    {
        var created = await CreateHoldAsync(client, $"Read-Guest-{Guid.NewGuid():N}");
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        var confirmed = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var body = await confirmed.Content.ReadFromJsonAsync<JsonElement>();
        return (body.GetProperty("reservationId").GetGuid(), guestToken, holdId);
    }

    private async Task<(Guid ReservationId, string? GuestToken, Guid HoldId)>
        CreateAndConfirmAuthenticatedHoldAsync(HttpClient client)
    {
        var created = await CreateHoldAsync(client, $"Read-Auth-{Guid.NewGuid():N}");
        var holdId = created.GetProperty("holdId").GetGuid();

        var confirmed = await ConfirmAsync(client, holdId, null);
        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var body = await confirmed.Content.ReadFromJsonAsync<JsonElement>();
        return (body.GetProperty("reservationId").GetGuid(), null, holdId);
    }

    private async Task<JsonElement> CreateHoldAsync(HttpClient client, string idempotencyKey)
    {
        var response = await PostHoldAsync(client, idempotencyKey, ValidRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<HttpResponseMessage> ConfirmAsync(
        HttpClient client,
        Guid holdId,
        string? guestAccessToken)
    {
        var csrf = await GetCsrfAsync(client);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/booking-holds/{holdId}/confirm");
        if (guestAccessToken is not null)
        {
            request.Headers.Add("X-Booking-Access-Token", guestAccessToken);
        }

        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> GetAsync(
        HttpClient client,
        Guid reservationId,
        string? guestAccessToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/reservations/{reservationId}");
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
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "/api/v1/booking-holds")
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

    /// <summary>
    /// The whole PostgreSQL integration collection shares one factory and
    /// therefore one login rate-limiter counter across every test class. Tests
    /// that only incidentally need a login (not testing rate-limiting itself)
    /// use an isolated host with a generously raised limit, mirroring the
    /// existing WithWebHostBuilder + UseSetting override pattern
    /// CustomerAuthenticationTests already uses to test the opposite
    /// direction (a deliberately low limit).
    /// </summary>
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
