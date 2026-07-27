using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class ReservationCancellationApiTests(PostgreSqlWebApplicationFactory factory)
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

    // Property.TimeZone is Asia/Ho_Chi_Minh (UTC+7, no DST), so the UTC instant of a
    // given local date's midnight is that date minus 7 hours.
    private static readonly DateOnly DefaultCheckIn = LocalToday.AddDays(3);
    private const string StrongPassword = "Strong!Password123";

    [Fact]
    public async Task Guest_owner_cancels_confirmed_reservation_before_checkin()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        var response = await CancelAsync(client, reservationId, guestToken, "Change of plans.");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            ReservationStatus.Cancelled.ToString(),
            body.GetProperty("status").GetString());
        Assert.Equal("Change of plans.", body.GetProperty("cancellationReason").GetString());
        Assert.Equal(FixedUtc, body.GetProperty("cancelledAtUtc").GetDateTimeOffset());

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Cancelled, reservation.Status);
    }

    [Fact]
    public async Task Authenticated_owner_cancels_own_reservation()
    {
        await SeedFixedAsync();
        using var application = WithGenerousLoginRateLimit();
        using var client = application.CreateClient();
        var customerId = await CreateCustomerAsync(client, "cancel-reservation-owner@example.com");
        var (reservationId, _, _) = await CreateAndConfirmAuthenticatedHoldAsync(client);

        var response = await CancelAsync(client, reservationId, null, "No longer needed.");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(customerId, reservation.CustomerAccountId);
        Assert.Equal(ReservationStatus.Cancelled, reservation.Status);
    }

    [Fact]
    public async Task Cancelling_an_already_cancelled_reservation_preserves_original_timestamp_and_reason()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        var first = await CancelAsync(client, reservationId, guestToken, "Original reason.");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        var replay = await CancelAsync(
            client,
            reservationId,
            guestToken,
            "A different, later reason that should be ignored.");
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(
            firstBody.GetProperty("cancelledAtUtc").GetDateTimeOffset(),
            replayBody.GetProperty("cancelledAtUtc").GetDateTimeOffset());
        Assert.Equal("Original reason.", replayBody.GetProperty("cancellationReason").GetString());
    }

    [Fact]
    public async Task Cancelled_reservation_replay_still_succeeds_after_the_cutoff()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        var first = await CancelAsync(client, reservationId, guestToken, "Original reason.");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        factory.Clock.UtcNow = LocalMidnightUtc(DefaultCheckIn).AddDays(5);
        var replay = await CancelAsync(client, reservationId, guestToken, "Later reason.");
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(
            firstBody.GetProperty("cancelledAtUtc").GetDateTimeOffset(),
            replayBody.GetProperty("cancelledAtUtc").GetDateTimeOffset());
        Assert.Equal("Original reason.", replayBody.GetProperty("cancellationReason").GetString());
    }

    [Fact]
    public async Task Cancellation_is_rejected_at_the_exact_local_checkin_boundary()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        factory.Clock.UtcNow = LocalMidnightUtc(DefaultCheckIn);
        AssertProblem(
            await CancelAsync(client, reservationId, guestToken, "Too late."),
            HttpStatusCode.Conflict);

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public async Task Cancellation_succeeds_one_tick_before_the_local_checkin_boundary()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        factory.Clock.UtcNow = LocalMidnightUtc(DefaultCheckIn).AddTicks(-1);
        var response = await CancelAsync(client, reservationId, guestToken, "Just in time.");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Cancellation_is_rejected_after_the_local_checkin_date()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        factory.Clock.UtcNow = LocalMidnightUtc(DefaultCheckIn).AddDays(1);
        AssertProblem(
            await CancelAsync(client, reservationId, guestToken, "Too late."),
            HttpStatusCode.Conflict);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Missing_or_blank_reason_is_a_bad_request(string? reason)
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        AssertProblem(
            await CancelAsync(client, reservationId, guestToken, reason),
            HttpStatusCode.BadRequest);

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public async Task Reason_over_the_limit_is_a_bad_request()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);
        var overLimit = new string('x', BookingFieldLimits.CancellationReason + 1);

        AssertProblem(
            await CancelAsync(client, reservationId, guestToken, overLimit),
            HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task No_credential_and_malformed_credential_are_unauthorized()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, _, _) = await CreateAndConfirmGuestHoldAsync(client);

        AssertProblem(
            await CancelAsync(client, reservationId, null, "Reason"),
            HttpStatusCode.Unauthorized);
        AssertProblem(
            await CancelAsync(client, reservationId, "not-a-valid-token", "Reason"),
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
            await CancelAsync(client, reservationId, otherToken, "Reason"),
            HttpStatusCode.NotFound);
        AssertProblem(
            await CancelAsync(client, Guid.NewGuid(), otherToken, "Reason"),
            HttpStatusCode.NotFound);

        using var otherCustomerApplication = WithGenerousLoginRateLimit();
        using var otherCustomerClient = otherCustomerApplication.CreateClient();
        await CreateCustomerAsync(otherCustomerClient, "foreign-reservation-canceller@example.com");
        AssertProblem(
            await CancelAsync(otherCustomerClient, reservationId, null, "Reason"),
            HttpStatusCode.NotFound);

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public async Task Invalid_customer_cookie_is_not_silently_ignored()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, _, _) = await CreateAndConfirmGuestHoldAsync(client);

        client.DefaultRequestHeaders.Add("Cookie", ".TheBha.Customer=tampered-value");
        AssertProblem(
            await CancelAsync(client, reservationId, null, "Reason"),
            HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Cancellation_requires_antiforgery_token()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/reservations/{reservationId}/cancel")
        {
            Content = JsonContent.Create(new { reason = "Reason" })
        };
        request.Headers.Add("X-Booking-Access-Token", guestToken);
        var response = await client.SendAsync(request);

        AssertProblem(response, HttpStatusCode.BadRequest);
        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public async Task Successful_cancellation_releases_the_exact_room_count_on_every_night()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var before = await GetAvailableRoomsAsync(client, "DLX-KING", DefaultCheckIn);

        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);
        Assert.Equal(before - 1, await GetAvailableRoomsAsync(client, "DLX-KING", DefaultCheckIn));

        var response = await CancelAsync(client, reservationId, guestToken, "Reason");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.Equal(before, await GetAvailableRoomsAsync(client, "DLX-KING", DefaultCheckIn));
    }

    [Fact]
    public async Task Concurrent_cancel_requests_are_idempotent_and_preserve_one_terminal_result()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(setupClient);

        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var responses = await Task.WhenAll(
            CancelAsync(firstClient, reservationId, guestToken, "Reason A", timeout.Token),
            CancelAsync(secondClient, reservationId, guestToken, "Reason B", timeout.Token));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        var bodies = await Task.WhenAll(
            responses.Select(response => response.Content.ReadFromJsonAsync<JsonElement>(timeout.Token)));
        Assert.Equal(
            bodies[0].GetProperty("cancelledAtUtc").GetDateTimeOffset(),
            bodies[1].GetProperty("cancelledAtUtc").GetDateTimeOffset());
        Assert.Equal(
            bodies[0].GetProperty("cancellationReason").GetString(),
            bodies[1].GetProperty("cancellationReason").GetString());

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Cancelled, reservation.Status);
    }

    [Fact]
    public async Task Reservation_cancel_versus_new_hold_creation_for_the_last_room_cannot_overbook()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(
            setupClient,
            FamilyRoomTypeId,
            "Cancel-LastRoom-Key");
        Assert.Equal(0, await GetAvailableRoomsAsync(setupClient, "FAMILY", DefaultCheckIn));

        using var cancelClient = factory.CreateClient();
        using var newHoldClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var cancelTask = CancelAsync(cancelClient, reservationId, guestToken, "Reason", timeout.Token);
        var newHoldTask = PostHoldAsync(
            newHoldClient,
            "Cancel-LastRoom-Competing-Key",
            ValidRequest(FamilyRoomTypeId, DefaultCheckIn),
            timeout.Token);
        await Task.WhenAll(cancelTask, newHoldTask);

        var cancelResponse = await cancelTask;
        var newHoldResponse = await newHoldTask;
        Assert.Equal(HttpStatusCode.OK, cancelResponse.StatusCode);
        Assert.True(
            newHoldResponse.StatusCode is HttpStatusCode.Created or HttpStatusCode.Conflict);

        await using var context = factory.CreateDbContext();
        var confirmedDemand = await context.Reservations
            .Where(r => r.PropertyId == PropertyId && r.RoomTypeId == FamilyRoomTypeId &&
                        r.Status == ReservationStatus.Confirmed)
            .SelectMany(r => r.Nights)
            .Where(n => n.StayDate == DefaultCheckIn)
            .SumAsync(n => n.Rooms);
        var activeHoldDemand = await context.BookingHolds
            .Where(h => h.PropertyId == PropertyId && h.RoomTypeId == FamilyRoomTypeId &&
                        h.Status == BookingHoldStatus.Active)
            .SelectMany(h => h.Nights)
            .Where(n => n.StayDate == DefaultCheckIn)
            .SumAsync(n => n.Rooms);
        Assert.True(confirmedDemand + activeHoldDemand <= 1);
    }

    [Fact]
    public async Task Blocked_cancellation_rechecks_the_cutoff_using_time_captured_after_the_wait()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var (reservationId, guestToken, holdId) = await CreateAndConfirmGuestHoldAsync(setupClient);
        var transitionLock = BookingAdvisoryLockKeys.ForHoldTransition(holdId);
        var inventoryLock = BookingAdvisoryLockKeys.ForInventory(
            PropertyId,
            DeluxeRoomTypeId,
            DefaultCheckIn);

        await using var blockerConnection = new NpgsqlConnection(factory.ConnectionString);
        await blockerConnection.OpenAsync();
        await using var blockerTransaction = await blockerConnection.BeginTransactionAsync();
        var blockerRolledBack = false;
        try
        {
            await AcquireAdvisoryLockAsync(blockerConnection, inventoryLock, CancellationToken.None);

            using var client = factory.CreateClient();
            var cancelTask = CancelAsync(client, reservationId, guestToken, "Reason");
            await WaitUntilLockIsHeldAsync(transitionLock, TimeSpan.FromSeconds(10));

            factory.Clock.UtcNow = LocalMidnightUtc(DefaultCheckIn);
            await blockerTransaction.RollbackAsync();
            blockerRolledBack = true;

            var response = await cancelTask;
            AssertProblem(response, HttpStatusCode.Conflict);
        }
        finally
        {
            if (!blockerRolledBack)
            {
                await blockerTransaction.RollbackAsync();
            }
        }

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public async Task Cancellation_of_a_deactivated_property_catalog_selection_still_succeeds_for_the_owner()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var (reservationId, guestToken, _) = await CreateAndConfirmGuestHoldAsync(client);

        await using (var context = factory.CreateDbContext())
        {
            (await context.RoomTypes.SingleAsync(roomType => roomType.Id == DeluxeRoomTypeId))
                .Deactivate(FixedUtc.AddMinutes(1));
            (await context.RatePlans.SingleAsync(ratePlan => ratePlan.Id == RatePlanId))
                .Deactivate(FixedUtc.AddMinutes(1));
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE "PhysicalRooms" SET "OperationalStatus" = 'Inactive'
                 WHERE "PropertyId" = {PropertyId} AND "RoomTypeId" = {DeluxeRoomTypeId}
                 """);
            await context.SaveChangesAsync();
        }

        var response = await CancelAsync(client, reservationId, guestToken, "Reason");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Forced_failure_before_commit_releases_locks_and_leaves_no_partial_state()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var (reservationId, guestToken, holdId) = await CreateAndConfirmGuestHoldAsync(setupClient);
        var transitionLock = BookingAdvisoryLockKeys.ForHoldTransition(holdId);
        var inventoryLock = BookingAdvisoryLockKeys.ForInventory(
            PropertyId,
            DeluxeRoomTypeId,
            DefaultCheckIn);

        using var interceptingApplication = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
                services.RemoveAll<TheBhaDbContext>();
                services.AddDbContext<TheBhaDbContext>(options =>
                    options.UseNpgsql(
                            factory.ConnectionString,
                            npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
                        .AddInterceptors(new ThrowBeforeReservationUpdateInterceptor()));
            }));
        using var client = interceptingApplication.CreateClient();

        var response = await CancelAsync(client, reservationId, guestToken, "Reason");
        Assert.False(response.IsSuccessStatusCode);
        Assert.True((int)response.StatusCode >= 500);

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == reservationId);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Null(reservation.CancelledAtUtc);
        Assert.Null(reservation.CancellationReason);

        Assert.True(await CanAcquireAdvisoryLockAsync(transitionLock));
        Assert.True(await CanAcquireAdvisoryLockAsync(inventoryLock));
    }

    [Fact]
    public async Task OpenApi_documents_reservation_cancel_endpoint_and_reason_body()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths")
            .GetProperty("/api/v1/reservations/{reservationId}/cancel")
            .GetProperty("post");
        var headerNames = operation.GetProperty("parameters")
            .EnumerateArray()
            .Select(parameter => parameter.GetProperty("name").GetString())
            .ToArray();
        Assert.Contains("X-Booking-Access-Token", headerNames);
        Assert.Contains("X-CSRF-TOKEN", headerNames);
        foreach (var status in new[] { "200", "400", "401", "404", "409" })
        {
            Assert.True(operation.GetProperty("responses").TryGetProperty(status, out _));
        }

        Assert.True(operation.TryGetProperty("requestBody", out var requestBody));
        Assert.True(requestBody.GetProperty("required").GetBoolean());
    }

    private async Task<(Guid ReservationId, string GuestToken, Guid HoldId)>
        CreateAndConfirmGuestHoldAsync(
            HttpClient client,
            Guid? roomTypeId = null,
            string? idempotencyKey = null)
    {
        var created = await CreateHoldAsync(
            client,
            idempotencyKey ?? $"Cancel-Guest-{Guid.NewGuid():N}",
            roomTypeId ?? DeluxeRoomTypeId);
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
        var created = await CreateHoldAsync(
            client,
            $"Cancel-Auth-{Guid.NewGuid():N}",
            DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();

        var confirmed = await ConfirmAsync(client, holdId, null);
        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var body = await confirmed.Content.ReadFromJsonAsync<JsonElement>();
        return (body.GetProperty("reservationId").GetGuid(), null, holdId);
    }

    private async Task<JsonElement> CreateHoldAsync(
        HttpClient client,
        string idempotencyKey,
        Guid roomTypeId)
    {
        var response = await PostHoldAsync(
            client,
            idempotencyKey,
            ValidRequest(roomTypeId, DefaultCheckIn));
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

    private static async Task<HttpResponseMessage> CancelAsync(
        HttpClient client,
        Guid reservationId,
        string? guestAccessToken,
        string? reason,
        CancellationToken cancellationToken = default)
    {
        var csrf = await GetCsrfAsync(client, cancellationToken);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/reservations/{reservationId}/cancel")
        {
            Content = JsonContent.Create(new { reason })
        };
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

    private async Task<int> GetAvailableRoomsAsync(HttpClient client, string code, DateOnly stayDate)
    {
        var payload = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}/availability" +
            $"?checkIn={stayDate:yyyy-MM-dd}&checkOut={stayDate.AddDays(1):yyyy-MM-dd}" +
            "&adults=1&children=0&rooms=1");
        var offer = payload.EnumerateArray()
            .SingleOrDefault(item => item.GetProperty("roomTypeCode").GetString() == code);
        return offer.ValueKind == JsonValueKind.Undefined
            ? 0
            : offer.GetProperty("availableRooms").GetInt32();
    }

    private static ApiRequest ValidRequest(Guid roomTypeId, DateOnly checkIn) =>
        new(
            PropertyId,
            roomTypeId,
            RatePlanId,
            checkIn,
            checkIn.AddDays(1),
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

    private static DateTimeOffset LocalMidnightUtc(DateOnly localDate) =>
        new DateTimeOffset(localDate.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)
            .AddHours(-7);

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

    private static async Task AcquireAdvisoryLockAsync(
        NpgsqlConnection connection,
        long lockKey,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT pg_advisory_xact_lock(@lockKey)";
        command.Parameters.AddWithValue("lockKey", lockKey);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task WaitUntilLockIsHeldAsync(long lockKey, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow.Add(timeout);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (!await CanAcquireAdvisoryLockAsync(lockKey))
            {
                return;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException(
            "The cancellation operation did not acquire the expected advisory lock.");
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

    private sealed class ThrowBeforeReservationUpdateInterceptor : DbCommandInterceptor
    {
        public override InterceptionResult<int> NonQueryExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result)
        {
            ThrowIfTargetCommand(command);
            return base.NonQueryExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            ThrowIfTargetCommand(command);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result)
        {
            ThrowIfTargetCommand(command);
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            ThrowIfTargetCommand(command);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        private static void ThrowIfTargetCommand(DbCommand command)
        {
            if (command.CommandText.Contains(
                    "UPDATE \"Reservations\"",
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "Forced test failure immediately before the Reservation update.");
            }
        }
    }
}
