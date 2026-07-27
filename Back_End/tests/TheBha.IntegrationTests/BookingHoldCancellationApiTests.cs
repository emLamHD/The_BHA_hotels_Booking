using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class BookingHoldCancellationApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset FixedUtc =
        DateTimeOffset.Parse("2026-07-22T18:30:00Z");
    private static readonly DateOnly LocalToday = new(2026, 7, 23);
    private static readonly Guid PropertyId =
        Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid DeluxeRoomTypeId =
        Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid FamilyRoomTypeId =
        Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid RatePlanId =
        Guid.Parse("60000000-0000-0000-0000-000000000001");
    private const string StrongPassword = "Strong!Password123";

    [Fact]
    public async Task Guest_owner_cancels_active_hold_and_receives_cancelled_snapshot()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-Guest-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        var response = await CancelAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            BookingHoldStatus.Cancelled.ToString(),
            body.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("guestAccessToken").ValueKind);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Cancelled, hold.Status);
    }

    [Fact]
    public async Task Authenticated_owner_cancels_own_hold()
    {
        await SeedFixedAsync();
        using var application = WithGenerousLoginRateLimit();
        using var client = application.CreateClient();
        await CreateCustomerAsync(client, "cancel-hold-owner@example.com");
        var created = await CreateHoldAsync(client, "Cancel-Auth-Key", DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();

        var response = await CancelAsync(client, holdId, null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Cancelling_an_already_cancelled_hold_is_an_idempotent_replay()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-Replay-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        var first = await CancelAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        var replay = await CancelAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(
            firstBody.GetProperty("expiresAtUtc").GetDateTimeOffset(),
            replayBody.GetProperty("expiresAtUtc").GetDateTimeOffset());
        Assert.Equal(
            firstBody.GetProperty("createdAtUtc").GetDateTimeOffset(),
            replayBody.GetProperty("createdAtUtc").GetDateTimeOffset());
    }

    [Fact]
    public async Task Confirmed_hold_cannot_be_cancelled()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-Confirmed-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var confirm = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, confirm.StatusCode);

        AssertProblem(await CancelAsync(client, holdId, guestToken), HttpStatusCode.Conflict);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Confirmed, hold.Status);
    }

    [Fact]
    public async Task Active_hold_can_be_explicitly_cancelled_at_or_after_expiry_without_double_release()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-Expired-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var beforeExpiryAvailability = await GetAvailableRoomsAsync(client, "DLX-KING");

        factory.Clock.UtcNow = FixedUtc.AddMinutes(15);
        var afterExpiryAvailability = await GetAvailableRoomsAsync(client, "DLX-KING");
        Assert.Equal(beforeExpiryAvailability + 1, afterExpiryAvailability);

        var response = await CancelAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var afterCancelAvailability = await GetAvailableRoomsAsync(client, "DLX-KING");
        Assert.Equal(afterExpiryAvailability, afterCancelAvailability);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Cancelled, hold.Status);
    }

    [Fact]
    public async Task Successful_cancellation_releases_the_exact_room_count_on_every_night()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var before = await GetAvailableRoomsAsync(client, "DLX-KING");

        var created = await CreateHoldAsync(client, "Cancel-Availability-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        Assert.Equal(before - 1, await GetAvailableRoomsAsync(client, "DLX-KING"));

        var response = await CancelAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.Equal(before, await GetAvailableRoomsAsync(client, "DLX-KING"));
    }

    [Fact]
    public async Task No_credential_and_malformed_credential_are_unauthorized()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-NoCred-Key", DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();

        AssertProblem(await CancelAsync(client, holdId, null), HttpStatusCode.Unauthorized);
        AssertProblem(
            await CancelAsync(client, holdId, "not-a-valid-token"),
            HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Wrong_token_foreign_account_and_missing_id_are_not_disclosing()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-Wrong-Key", DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();
        var otherToken = new CryptographicGuestAccessTokenGenerator().Generate();

        AssertProblem(await CancelAsync(client, holdId, otherToken), HttpStatusCode.NotFound);
        AssertProblem(
            await CancelAsync(client, Guid.NewGuid(), otherToken),
            HttpStatusCode.NotFound);

        using var otherCustomerApplication = WithGenerousLoginRateLimit();
        using var otherCustomerClient = otherCustomerApplication.CreateClient();
        await CreateCustomerAsync(otherCustomerClient, "foreign-hold-canceller@example.com");
        AssertProblem(
            await CancelAsync(otherCustomerClient, holdId, null),
            HttpStatusCode.NotFound);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
    }

    [Fact]
    public async Task Invalid_customer_cookie_is_not_silently_ignored()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-InvalidCookie-Key", DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();

        client.DefaultRequestHeaders.Add("Cookie", ".TheBha.Customer=tampered-value");
        AssertProblem(await CancelAsync(client, holdId, null), HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Cancellation_requires_antiforgery_token()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-Antiforgery-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/booking-holds/{holdId}/cancel");
        request.Headers.Add("X-Booking-Access-Token", guestToken);
        var response = await client.SendAsync(request);

        AssertProblem(response, HttpStatusCode.BadRequest);
        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
    }

    [Fact]
    public async Task Concurrent_cancel_requests_are_idempotent_and_preserve_one_terminal_result()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var created = await CreateHoldAsync(setupClient, "Cancel-Concurrent-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var responses = await Task.WhenAll(
            CancelAsync(firstClient, holdId, guestToken, timeout.Token),
            CancelAsync(secondClient, holdId, guestToken, timeout.Token));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Cancelled, hold.Status);
    }

    [Fact]
    public async Task Hold_cancel_racing_confirm_is_serialized_to_exactly_one_terminal_transition()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var created = await CreateHoldAsync(setupClient, "Cancel-Vs-Confirm-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        using var cancelClient = factory.CreateClient();
        using var confirmClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var cancelTask = CancelAsync(cancelClient, holdId, guestToken, timeout.Token);
        var confirmTask = ConfirmAsync(confirmClient, holdId, guestToken, timeout.Token);
        await Task.WhenAll(cancelTask, confirmTask);

        var cancelResponse = await cancelTask;
        var confirmResponse = await confirmTask;

        // Exactly one of the two competing lifecycle transitions can win the
        // shared hold-transition lock; the other observes the resulting
        // terminal state and receives the corresponding existing-state response.
        var outcomes = new[]
        {
            (cancelResponse.StatusCode, confirmResponse.StatusCode)
        };
        Assert.True(
            outcomes[0] == (HttpStatusCode.OK, HttpStatusCode.Conflict) ||
            outcomes[0] == (HttpStatusCode.Conflict, HttpStatusCode.Created),
            $"Unexpected pairing: cancel={cancelResponse.StatusCode}, confirm={confirmResponse.StatusCode}");

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        var reservationCount = await context.Reservations.CountAsync(r => r.SourceHoldId == holdId);
        if (hold.Status == BookingHoldStatus.Cancelled)
        {
            Assert.Equal(0, reservationCount);
        }
        else
        {
            Assert.Equal(BookingHoldStatus.Confirmed, hold.Status);
            Assert.Equal(1, reservationCount);
        }
    }

    [Fact]
    public async Task Multi_night_cancellation_and_overlapping_creation_use_shared_ascending_lock_order_without_deadlock()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var earlyRequest = ValidRequest(DeluxeRoomTypeId) with
        {
            CheckIn = LocalToday.AddDays(2),
            CheckOut = LocalToday.AddDays(5)
        };
        var earlyCreated = await PostHoldAsync(setupClient, "Cancel-MultiNight-Key", earlyRequest);
        Assert.Equal(HttpStatusCode.Created, earlyCreated.StatusCode);
        var earlyBody = await earlyCreated.Content.ReadFromJsonAsync<JsonElement>();
        var earlyHoldId = earlyBody.GetProperty("holdId").GetGuid();
        var earlyToken = earlyBody.GetProperty("guestAccessToken").GetString()!;

        var lateRequest = ValidRequest(DeluxeRoomTypeId) with
        {
            CheckIn = LocalToday.AddDays(3),
            CheckOut = LocalToday.AddDays(6)
        };

        using var cancelClient = factory.CreateClient();
        using var newHoldClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var cancelTask = CancelAsync(cancelClient, earlyHoldId, earlyToken, timeout.Token);
        var newHoldTask = PostHoldAsync(
            newHoldClient,
            "Cancel-MultiNight-Overlap-Key",
            lateRequest,
            timeout.Token);
        await Task.WhenAll(cancelTask, newHoldTask);

        var cancelResponse = await cancelTask;
        var newHoldResponse = await newHoldTask;
        Assert.Equal(HttpStatusCode.OK, cancelResponse.StatusCode);
        Assert.True(
            newHoldResponse.StatusCode is HttpStatusCode.Created or HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Forced_failure_before_commit_releases_locks_and_leaves_no_partial_state()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var created = await CreateHoldAsync(setupClient, "Cancel-ForcedFailure-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var transitionLock = BookingAdvisoryLockKeys.ForHoldTransition(holdId);
        var inventoryLock = BookingAdvisoryLockKeys.ForInventory(
            PropertyId,
            DeluxeRoomTypeId,
            LocalToday);

        using var interceptingApplication = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<Microsoft.EntityFrameworkCore.DbContextOptions<TheBhaDbContext>>();
                services.RemoveAll<TheBhaDbContext>();
                services.AddDbContext<TheBhaDbContext>(options =>
                    options.UseNpgsql(
                            factory.ConnectionString,
                            npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
                        .AddInterceptors(new ThrowBeforeHoldUpdateInterceptor()));
            }));
        using var client = interceptingApplication.CreateClient();

        var response = await CancelAsync(client, holdId, guestToken);
        Assert.False(response.IsSuccessStatusCode);
        Assert.True((int)response.StatusCode >= 500);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Active, hold.Status);

        Assert.True(await CanAcquireAdvisoryLockAsync(transitionLock));
        Assert.True(await CanAcquireAdvisoryLockAsync(inventoryLock));
    }

    [Fact]
    public async Task Cancellation_of_a_deactivated_property_still_succeeds_for_the_owner()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Cancel-DeactivatedCatalog-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        await using (var context = factory.CreateDbContext())
        {
            (await context.RoomTypes.SingleAsync(roomType => roomType.Id == DeluxeRoomTypeId))
                .Deactivate(FixedUtc.AddMinutes(1));
            await context.SaveChangesAsync();
        }

        var response = await CancelAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task OpenApi_documents_hold_cancel_endpoint()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths")
            .GetProperty("/api/v1/booking-holds/{holdId}/cancel")
            .GetProperty("post");
        var headerNames = operation.GetProperty("parameters")
            .EnumerateArray()
            .Select(parameter => parameter.GetProperty("name").GetString())
            .ToArray();
        Assert.Contains("X-Booking-Access-Token", headerNames);
        Assert.Contains("X-CSRF-TOKEN", headerNames);
        foreach (var status in new[] { "200", "401", "404", "409" })
        {
            Assert.True(operation.GetProperty("responses").TryGetProperty(status, out _));
        }
    }

    private async Task<JsonElement> CreateHoldAsync(
        HttpClient client,
        string idempotencyKey,
        Guid roomTypeId)
    {
        var response = await PostHoldAsync(client, idempotencyKey, ValidRequest(roomTypeId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<HttpResponseMessage> CancelAsync(
        HttpClient client,
        Guid holdId,
        string? guestAccessToken,
        CancellationToken cancellationToken = default)
    {
        var csrf = await GetCsrfAsync(client, cancellationToken);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/booking-holds/{holdId}/cancel");
        if (guestAccessToken is not null)
        {
            request.Headers.Add("X-Booking-Access-Token", guestAccessToken);
        }

        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request, cancellationToken);
    }

    private static async Task<HttpResponseMessage> ConfirmAsync(
        HttpClient client,
        Guid holdId,
        string? guestAccessToken,
        CancellationToken cancellationToken = default)
    {
        var csrf = await GetCsrfAsync(client, cancellationToken);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/booking-holds/{holdId}/confirm");
        if (guestAccessToken is not null)
        {
            request.Headers.Add("X-Booking-Access-Token", guestAccessToken);
        }

        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request, cancellationToken);
    }

    private WebApplicationFactory<Program> WithGenerousLoginRateLimit() =>
        factory.WithWebHostBuilder(builder =>
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "1000"));

    private async Task<int> GetAvailableRoomsAsync(HttpClient client, string code)
    {
        var payload = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}/availability" +
            $"?checkIn={LocalToday:yyyy-MM-dd}&checkOut={LocalToday.AddDays(1):yyyy-MM-dd}" +
            "&adults=1&children=0&rooms=1");
        var offer = payload.EnumerateArray()
            .SingleOrDefault(item => item.GetProperty("roomTypeCode").GetString() == code);
        return offer.ValueKind == JsonValueKind.Undefined
            ? 0
            : offer.GetProperty("availableRooms").GetInt32();
    }

    private static ApiRequest ValidRequest(Guid roomTypeId) =>
        new(
            PropertyId,
            roomTypeId,
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
        object payload,
        CancellationToken cancellationToken = default)
    {
        var csrf = await GetCsrfAsync(client, cancellationToken);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/booking-holds")
        {
            Content = JsonContent.Create(payload)
        };
        request.Headers.Add("Idempotency-Key", idempotencyKey);
        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request, cancellationToken);
    }

    private static async Task<CsrfResponse> GetCsrfAsync(
        HttpClient client,
        CancellationToken cancellationToken = default)
    {
        var response = await client.GetAsync("/api/v1/auth/csrf", cancellationToken);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CsrfResponse>(
            cancellationToken: cancellationToken))!;
    }

    private async Task<bool> CanAcquireAdvisoryLockAsync(long lockKey)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT pg_try_advisory_xact_lock(@lockKey)";
        command.Parameters.AddWithValue("lockKey", lockKey);
        var acquired = (bool)(await command.ExecuteScalarAsync())!;
        await transaction.RollbackAsync();
        return acquired;
    }

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

    private sealed class ThrowBeforeHoldUpdateInterceptor
        : Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor
    {
        public override Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> NonQueryExecuting(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result)
        {
            ThrowIfTargetCommand(command);
            return base.NonQueryExecuting(command, eventData, result);
        }

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> NonQueryExecutingAsync(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            ThrowIfTargetCommand(command);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader> ReaderExecuting(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader> result)
        {
            ThrowIfTargetCommand(command);
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            ThrowIfTargetCommand(command);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        private static void ThrowIfTargetCommand(System.Data.Common.DbCommand command)
        {
            if (command.CommandText.Contains(
                    "UPDATE \"BookingHolds\"",
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "Forced test failure immediately before the BookingHold update.");
            }
        }
    }
}
