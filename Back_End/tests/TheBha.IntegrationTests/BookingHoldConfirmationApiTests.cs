using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class BookingHoldConfirmationApiTests(PostgreSqlWebApplicationFactory factory)
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
    public async Task Guest_confirms_with_original_token_and_receives_created_with_location()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Guest-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        var response = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var location = response.Headers.Location!.ToString();
        Assert.Contains($"/api/v1/reservations/", location, StringComparison.Ordinal);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(ReservationStatus.Confirmed.ToString(), body.GetProperty("status").GetString());
        Assert.Equal(FixedUtc, body.GetProperty("confirmedAtUtc").GetDateTimeOffset());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("cancelledAtUtc").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("cancellationReason").ValueKind);
        var responseJson = body.GetRawText();
        foreach (var forbidden in new[]
                 {
                     "customerAccountId",
                     "guestAccessTokenHash",
                     "guestAccessToken",
                     "idempotencyKeyHash",
                     "requestFingerprint"
                 })
        {
            Assert.DoesNotContain(forbidden, responseJson, StringComparison.OrdinalIgnoreCase);
        }

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations
            .Include(item => item.Nights)
            .SingleAsync();
        Assert.Equal(holdId, reservation.SourceHoldId);
        Assert.Null(reservation.CustomerAccountId);
        Assert.Equal(
            BookingHoldRequestSecurity.Sha256Hex(guestToken),
            reservation.GuestAccessTokenHash);
        var hold = await context.BookingHolds.SingleAsync(item => item.Id == holdId);
        Assert.Equal(BookingHoldStatus.Confirmed, hold.Status);
    }

    [Fact]
    public async Task Sequential_replay_returns_same_reservation_without_new_token_or_reprice()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Replay-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        var first = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        await using (var pricing = factory.CreateDbContext())
        {
            var rate = await pricing.DailyRoomRates.SingleAsync(item =>
                item.RoomTypeId == DeluxeRoomTypeId &&
                item.RatePlanId == RatePlanId &&
                item.StayDate == LocalToday);
            rate.UpdateAmount(9_999_999m, FixedUtc.AddMinutes(1));
            await pricing.SaveChangesAsync();
        }

        var replay = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(
            firstBody.GetProperty("reservationId").GetGuid(),
            replayBody.GetProperty("reservationId").GetGuid());
        Assert.Equal(
            firstBody.GetProperty("confirmationNumber").GetString(),
            replayBody.GetProperty("confirmationNumber").GetString());
        Assert.Equal(
            firstBody.GetProperty("confirmedAtUtc").GetDateTimeOffset(),
            replayBody.GetProperty("confirmedAtUtc").GetDateTimeOffset());
        Assert.Equal(
            firstBody.GetProperty("totalAmount").GetDecimal(),
            replayBody.GetProperty("totalAmount").GetDecimal());

        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.Reservations.CountAsync());
        Assert.Equal(1, await context.ReservationNights.CountAsync());
    }

    [Fact]
    public async Task Incoherent_persisted_contact_field_fails_replay_closed_without_mutation()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Incoherent-Contact-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var first = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE "Reservations" SET "FullName" = 'Corrupted Name'
                 WHERE "SourceHoldId" = {holdId}
                 """);
        }

        AssertProblem(await ConfirmAsync(client, holdId, guestToken), HttpStatusCode.Conflict);

        await using var verify = factory.CreateDbContext();
        Assert.Equal(1, await verify.Reservations.CountAsync());
        var reservation = await verify.Reservations.SingleAsync();
        Assert.Equal("Corrupted Name", reservation.FullName);
    }

    [Fact]
    public async Task Incoherent_persisted_ownership_fails_replay_closed_without_mutation()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Incoherent-Owner-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var first = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var otherHash = BookingHoldRequestSecurity.Sha256Hex(
            new CryptographicGuestAccessTokenGenerator().Generate());

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE "Reservations" SET "GuestAccessTokenHash" = {otherHash}
                 WHERE "SourceHoldId" = {holdId}
                 """);
        }

        // The original guest token still authorizes against the (untouched) Hold,
        // so the request reaches the coherence gate rather than being rejected as
        // unauthorized/not-found.
        AssertProblem(await ConfirmAsync(client, holdId, guestToken), HttpStatusCode.Conflict);

        await using var verify = factory.CreateDbContext();
        Assert.Equal(1, await verify.Reservations.CountAsync());
        var reservation = await verify.Reservations.SingleAsync();
        Assert.Equal(otherHash, reservation.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Incoherent_persisted_night_amount_fails_replay_closed_without_mutation()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Incoherent-Night-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var first = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var reservationId = (await first.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("reservationId").GetGuid();

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE "ReservationNights"
                 SET "UnitAmount" = 999999, "NightTotal" = 999999
                 WHERE "ReservationId" = {reservationId}
                 """);
        }

        AssertProblem(await ConfirmAsync(client, holdId, guestToken), HttpStatusCode.Conflict);

        await using var verify = factory.CreateDbContext();
        Assert.Equal(1, await verify.Reservations.CountAsync());
        Assert.All(
            await verify.ReservationNights.Where(n => n.ReservationId == reservationId).ToListAsync(),
            night => Assert.Equal(999999m, night.UnitAmount));
    }

    [Fact]
    public async Task Authenticated_confirmation_persists_no_guest_hash()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var customerId = await CreateCustomerAsync(client, "confirm-owner@example.com");

        var created = await CreateHoldAsync(client, "Confirm-Auth-Key", DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();

        var response = await ConfirmAsync(client, holdId, null);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.SingleAsync();
        Assert.Equal(customerId, reservation.CustomerAccountId);
        Assert.Null(reservation.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Exact_expiry_boundary_and_after_expiry_conflict_without_creating_reservation()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Expiry-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        factory.Clock.UtcNow = FixedUtc.AddMinutes(15);
        AssertProblem(await ConfirmAsync(client, holdId, guestToken), HttpStatusCode.Conflict);

        factory.Clock.UtcNow = FixedUtc.AddMinutes(16);
        AssertProblem(await ConfirmAsync(client, holdId, guestToken), HttpStatusCode.Conflict);

        await using var context = factory.CreateDbContext();
        Assert.Empty(await context.Reservations.ToListAsync());
        var hold = await context.BookingHolds.SingleAsync();
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
    }

    [Fact]
    public async Task Cancelled_hold_conflicts_and_missing_hold_is_not_disclosed()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Cancelled-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE \"BookingHolds\" SET \"Status\" = 'Cancelled' WHERE \"Id\" = {holdId}");
        }

        AssertProblem(await ConfirmAsync(client, holdId, guestToken), HttpStatusCode.Conflict);
        AssertProblem(
            await ConfirmAsync(client, Guid.NewGuid(), guestToken),
            HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Wrong_foreign_and_missing_credentials_are_not_disclosing()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Wrong-Cred-Key", DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();
        var otherToken = new CryptographicGuestAccessTokenGenerator().Generate();

        AssertProblem(
            await ConfirmAsync(client, holdId, otherToken),
            HttpStatusCode.NotFound);
        AssertProblem(
            await ConfirmAsync(client, holdId, null),
            HttpStatusCode.Unauthorized);
        AssertProblem(
            await ConfirmAsync(client, holdId, "not-a-valid-token"),
            HttpStatusCode.Unauthorized);

        var otherCustomerClient = factory.CreateClient();
        await CreateCustomerAsync(otherCustomerClient, "other-confirm@example.com");
        AssertProblem(
            await ConfirmAsync(otherCustomerClient, holdId, null),
            HttpStatusCode.NotFound);

        await using var context = factory.CreateDbContext();
        Assert.Empty(await context.Reservations.ToListAsync());
    }

    [Fact]
    public async Task Confirmation_requires_antiforgery_token()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Antiforgery-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/booking-holds/{holdId}/confirm");
        request.Headers.Add("X-Booking-Access-Token", guestToken);
        var response = await client.SendAsync(request);

        AssertProblem(response, HttpStatusCode.BadRequest);
        await using var context = factory.CreateDbContext();
        Assert.Empty(await context.Reservations.ToListAsync());
    }

    [Fact]
    public async Task Invalid_customer_cookie_is_not_silently_ignored()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Invalid-Cookie-Key", DeluxeRoomTypeId);
        var holdId = created.GetProperty("holdId").GetGuid();

        client.DefaultRequestHeaders.Add("Cookie", ".TheBha.Customer=tampered-value");
        AssertProblem(
            await ConfirmAsync(client, holdId, null),
            HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Successful_confirmation_leaves_availability_unchanged()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var before = await GetAvailableRoomsAsync(client, "DLX-KING");

        var created = await CreateHoldAsync(client, "Confirm-Availability-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var afterHold = await GetAvailableRoomsAsync(client, "DLX-KING");
        Assert.Equal(before - 1, afterHold);

        var response = await ConfirmAsync(client, holdId, guestToken);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var afterConfirm = await GetAvailableRoomsAsync(client, "DLX-KING");

        Assert.Equal(afterHold, afterConfirm);
    }

    [Fact]
    public async Task Concurrent_same_hold_confirmation_persists_exactly_one_reservation()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var created = await CreateHoldAsync(client, "Confirm-Concurrent-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var responses = await Task.WhenAll(
            ConfirmAsync(firstClient, holdId, guestToken, timeout.Token),
            ConfirmAsync(secondClient, holdId, guestToken, timeout.Token));

        Assert.Equal(
            [HttpStatusCode.OK, HttpStatusCode.Created],
            responses.Select(response => response.StatusCode).Order().ToArray());
        var bodies = await Task.WhenAll(
            responses.Select(response =>
                response.Content.ReadFromJsonAsync<JsonElement>(timeout.Token)));
        Assert.Equal(
            bodies[0].GetProperty("reservationId").GetGuid(),
            bodies[1].GetProperty("reservationId").GetGuid());

        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.Reservations.CountAsync());
        Assert.Equal(1, await context.ReservationNights.CountAsync());
    }

    [Fact]
    public async Task Confirmation_versus_new_hold_creation_cannot_overbook_last_room()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var created = await CreateHoldAsync(setupClient, "Confirm-LastRoom-Key", FamilyRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        Assert.Equal(0, await GetAvailableRoomsAsync(setupClient, "FAMILY"));

        using var confirmClient = factory.CreateClient();
        using var newHoldClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        var confirmTask = ConfirmAsync(confirmClient, holdId, guestToken, timeout.Token);
        var newHoldTask = PostHoldAsync(
            newHoldClient,
            "Confirm-LastRoom-Competing-Key",
            ValidRequest(FamilyRoomTypeId),
            timeout.Token);
        await Task.WhenAll(confirmTask, newHoldTask);

        var confirmResponse = await confirmTask;
        var newHoldResponse = await newHoldTask;
        Assert.Equal(HttpStatusCode.Created, confirmResponse.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, newHoldResponse.StatusCode);

        Assert.Equal(0, await GetAvailableRoomsAsync(setupClient, "FAMILY"));
        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.Reservations.CountAsync());
        Assert.Equal(1, await context.BookingHolds.CountAsync());
        Assert.Equal(
            0,
            await context.BookingHolds.CountAsync(hold => hold.Status == BookingHoldStatus.Active));
    }

    [Fact]
    public async Task Expiry_is_rechecked_after_waiting_for_the_inventory_lock()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var created = await CreateHoldAsync(setupClient, "Confirm-ExpiryWait-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();

        var inventoryLock = BookingAdvisoryLockKeys.ForInventory(
            PropertyId,
            DeluxeRoomTypeId,
            LocalToday);
        await using var blockerConnection = new NpgsqlConnection(factory.ConnectionString);
        await blockerConnection.OpenAsync();
        await using var blockerTransaction = await blockerConnection.BeginTransactionAsync();
        await AcquireAdvisoryLockAsync(blockerConnection, inventoryLock, CancellationToken.None);

        using var client = factory.CreateClient();
        var confirmTask = ConfirmAsync(client, holdId, guestToken);
        await WaitUntilLockIsHeldAsync(
            BookingAdvisoryLockKeys.ForHoldTransition(holdId),
            TimeSpan.FromSeconds(10));

        factory.Clock.UtcNow = FixedUtc.AddMinutes(15);
        await blockerTransaction.RollbackAsync();

        var response = await confirmTask;
        AssertProblem(response, HttpStatusCode.Conflict);
        await using var context = factory.CreateDbContext();
        Assert.Empty(await context.Reservations.ToListAsync());
    }

    [Fact]
    public async Task Cancelling_the_request_releases_the_hold_transition_lock()
    {
        await SeedFixedAsync();
        using var setupClient = factory.CreateClient();
        var created = await CreateHoldAsync(setupClient, "Confirm-Cancel-Key", DeluxeRoomTypeId);
        var guestToken = created.GetProperty("guestAccessToken").GetString()!;
        var holdId = created.GetProperty("holdId").GetGuid();
        var transitionLock = BookingAdvisoryLockKeys.ForHoldTransition(holdId);

        await using var blockerConnection = new NpgsqlConnection(factory.ConnectionString);
        await blockerConnection.OpenAsync();
        await using var blockerTransaction = await blockerConnection.BeginTransactionAsync();
        await AcquireAdvisoryLockAsync(blockerConnection, transitionLock, CancellationToken.None);

        using var client = factory.CreateClient();
        var csrf = await GetCsrfAsync(client, CancellationToken.None);
        using var cancellation = new CancellationTokenSource();
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/booking-holds/{holdId}/confirm");
        request.Headers.Add("X-Booking-Access-Token", guestToken);
        request.Headers.Add(csrf.HeaderName, csrf.Token);
        var operation = client.SendAsync(request, cancellation.Token);

        await WaitUntilLockIsHeldAsync(transitionLock, TimeSpan.FromSeconds(10));
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await operation);
        await blockerTransaction.RollbackAsync();

        await WaitUntilLockIsAvailableAsync(transitionLock, TimeSpan.FromSeconds(10));
        await using var context = factory.CreateDbContext();
        Assert.Empty(await context.Reservations.ToListAsync());
        var hold = await context.BookingHolds.SingleAsync();
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
    }

    [Fact]
    public async Task OpenApi_documents_confirmation_endpoint_and_guest_header()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths")
            .GetProperty("/api/v1/booking-holds/{holdId}/confirm")
            .GetProperty("post");
        var headerNames = operation.GetProperty("parameters")
            .EnumerateArray()
            .Select(parameter => parameter.GetProperty("name").GetString())
            .ToArray();
        Assert.Contains("X-Booking-Access-Token", headerNames);
        Assert.Contains("X-CSRF-TOKEN", headerNames);
        foreach (var status in new[] { "200", "201", "401", "404", "409" })
        {
            Assert.True(operation.GetProperty("responses").TryGetProperty(status, out _));
        }

        var securitySchemeIds = operation.GetProperty("security")
            .EnumerateArray()
            .SelectMany(requirement => requirement.EnumerateObject())
            .Select(scheme => scheme.Name)
            .ToArray();
        Assert.DoesNotContain("bearer", securitySchemeIds, StringComparer.OrdinalIgnoreCase);
        Assert.All(
            securitySchemeIds,
            id => Assert.Equal("CustomerCookie", id, StringComparer.Ordinal));
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
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "/api/v1/booking-holds")
        {
            Content = JsonContent.Create(payload)
        };
        request.Headers.Add("Idempotency-Key", idempotencyKey);
        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request, cancellationToken);
    }

    private static async Task<CsrfResponse> GetCsrfAsync(
        HttpClient client,
        CancellationToken cancellationToken)
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
            "The confirmation operation did not acquire the expected advisory lock.");
    }

    private async Task WaitUntilLockIsAvailableAsync(long lockKey, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow.Add(timeout);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (await CanAcquireAdvisoryLockAsync(lockKey))
            {
                return;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException(
            "The confirmation operation did not release the expected advisory lock.");
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
}
