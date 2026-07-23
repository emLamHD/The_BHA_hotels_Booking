using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class BookingHoldApiTests(PostgreSqlWebApplicationFactory factory)
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
    public async Task Guest_creation_is_server_priced_atomic_and_replays_without_raw_token()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var request = ValidRequest(DeluxeRoomTypeId);

        var created = await PostHoldAsync(client, "Guest-Key", request);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var createdBody = await created.Content.ReadFromJsonAsync<JsonElement>();
        var holdId = createdBody.GetProperty("holdId").GetGuid();
        var guestToken = createdBody.GetProperty("guestAccessToken").GetString();
        Assert.False(string.IsNullOrWhiteSpace(guestToken));
        Assert.Equal("Active", createdBody.GetProperty("status").GetString());
        Assert.Equal("VND", createdBody.GetProperty("currencyCode").GetString());
        Assert.Equal(1500000m, createdBody.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(FixedUtc, createdBody.GetProperty("createdAtUtc").GetDateTimeOffset());
        Assert.Equal(
            FixedUtc.AddMinutes(15),
            createdBody.GetProperty("expiresAtUtc").GetDateTimeOffset());
        Assert.Single(createdBody.GetProperty("nights").EnumerateArray());
        var responseJson = createdBody.GetRawText();
        foreach (var forbidden in new[]
                 {
                     "customerAccountId",
                     "idempotencyKeyHash",
                     "requestFingerprint",
                     "guestAccessTokenHash",
                     "physicalRoom",
                     "inventoryControl",
                     "fullName",
                     "email",
                     "phone"
                 })
        {
            Assert.DoesNotContain(forbidden, responseJson, StringComparison.OrdinalIgnoreCase);
        }

        await using (var pricing = factory.CreateDbContext())
        {
            var rate = await pricing.DailyRoomRates.SingleAsync(item =>
                item.RoomTypeId == DeluxeRoomTypeId &&
                item.RatePlanId == RatePlanId &&
                item.StayDate == LocalToday);
            rate.UpdateAmount(1700000m, FixedUtc.AddMinutes(1));
            await pricing.SaveChangesAsync();
        }

        var replay = await PostHoldAsync(client, "Guest-Key", request);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(holdId, replayBody.GetProperty("holdId").GetGuid());
        Assert.Equal(JsonValueKind.Null, replayBody.GetProperty("guestAccessToken").ValueKind);
        Assert.Equal(
            FixedUtc,
            replayBody.GetProperty("createdAtUtc").GetDateTimeOffset());
        Assert.Equal(1500000m, replayBody.GetProperty("totalAmount").GetDecimal());

        await using var context = factory.CreateDbContext();
        var stored = await context.BookingHolds
            .Include(hold => hold.Nights)
            .SingleAsync();
        Assert.Equal(holdId, stored.Id);
        Assert.Null(stored.CustomerAccountId);
        Assert.Equal(
            BookingHoldRequestSecurity.Sha256Hex(guestToken!),
            stored.GuestAccessTokenHash);
        Assert.Equal(
            BookingHoldRequestSecurity.Sha256Hex("Guest-Key"),
            stored.IdempotencyKeyHash);
        Assert.Single(stored.Nights);
        Assert.Equal(1500000m, stored.Nights.Single().UnitAmount);
        Assert.Equal(1500000m, stored.Nights.Single().NightTotal);
        Assert.Equal(1, await context.BookingHoldNights.CountAsync());
    }

    [Fact]
    public async Task Same_key_with_changed_semantics_conflicts_and_failed_creation_is_clean()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var request = ValidRequest(DeluxeRoomTypeId);
        Assert.Equal(
            HttpStatusCode.Created,
            (await PostHoldAsync(client, "Mismatch-Key", request)).StatusCode);

        var mismatch = await PostHoldAsync(
            client,
            "Mismatch-Key",
            request with { FullName = "Different Guest" });
        AssertProblem(mismatch, HttpStatusCode.Conflict);

        var unavailable = await PostHoldAsync(
            client,
            "Unavailable-Key",
            ValidRequest(FamilyRoomTypeId) with
            {
                CheckIn = LocalToday.AddDays(2),
                CheckOut = LocalToday.AddDays(3)
            });
        AssertProblem(unavailable, HttpStatusCode.Conflict);

        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.BookingHolds.CountAsync());
        Assert.Equal(1, await context.BookingHoldNights.CountAsync());
    }

    [Fact]
    public async Task Authenticated_creation_uses_server_customer_and_never_generates_guest_token()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var customerId = await CreateCustomerAsync("hold-owner@example.com");
        var login = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { email = "hold-owner@example.com", password = StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var request = ValidRequest(DeluxeRoomTypeId);
        var response = await PostHoldAsync(client, "Customer-Key", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, body.GetProperty("guestAccessToken").ValueKind);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync();
        Assert.Equal(customerId, hold.CustomerAccountId);
        Assert.Null(hold.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Idempotency_key_cannot_cross_guest_and_authenticated_ownership_scopes()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var request = ValidRequest(DeluxeRoomTypeId);
        Assert.Equal(
            HttpStatusCode.Created,
            (await PostHoldAsync(client, "Owner-Scope-Key", request)).StatusCode);

        await CreateCustomerAsync("scope-owner@example.com");
        var login = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { email = "scope-owner@example.com", password = StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        AssertProblem(
            await PostHoldAsync(client, "Owner-Scope-Key", request),
            HttpStatusCode.Conflict);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync();
        Assert.Null(hold.CustomerAccountId);
    }

    [Fact]
    public async Task Antiforgery_is_required_and_extra_server_authoritative_fields_are_ignored()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var withoutCsrf = await client.PostAsJsonAsync(
            "/api/v1/booking-holds",
            ValidRequest(DeluxeRoomTypeId));
        AssertProblem(withoutCsrf, HttpStatusCode.BadRequest);

        var suppliedCustomer = Guid.NewGuid();
        var payload = new
        {
            propertyId = PropertyId,
            roomTypeId = DeluxeRoomTypeId,
            ratePlanId = RatePlanId,
            checkIn = LocalToday,
            checkOut = LocalToday.AddDays(1),
            adults = 1,
            children = 0,
            rooms = 1,
            fullName = "Guest Name",
            email = "guest@example.com",
            phone = "+84 123 4567",
            customerAccountId = suppliedCustomer,
            totalAmount = 1,
            currencyCode = "USD",
            expiresAtUtc = FixedUtc.AddYears(1),
            guestAccessToken = "client-token"
        };
        var created = await PostHoldAsync(client, "Authority-Key", payload);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        await using var context = factory.CreateDbContext();
        var hold = await context.BookingHolds.SingleAsync();
        Assert.Null(hold.CustomerAccountId);
        Assert.Equal(1500000m, hold.TotalAmount);
        Assert.Equal("VND", hold.CurrencyCode);
        Assert.Equal(FixedUtc.AddMinutes(15), hold.ExpiresAtUtc);
        Assert.NotEqual(
            BookingHoldRequestSecurity.Sha256Hex("client-token"),
            hold.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Active_hold_reduces_availability_and_exact_expiry_restores_it()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var before = await GetDeluxeAvailableRoomsAsync(client);
        Assert.Equal(2, before);

        Assert.Equal(
            HttpStatusCode.Created,
            (await PostHoldAsync(
                client,
                "Demand-Key",
                ValidRequest(DeluxeRoomTypeId))).StatusCode);
        Assert.Equal(1, await GetDeluxeAvailableRoomsAsync(client));

        factory.Clock.UtcNow = FixedUtc.AddMinutes(15);
        Assert.Equal(2, await GetDeluxeAvailableRoomsAsync(client));
        var replay = await PostHoldAsync(
            client,
            "Demand-Key",
            ValidRequest(DeluxeRoomTypeId));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, replayBody.GetProperty("guestAccessToken").ValueKind);
        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.BookingHolds.CountAsync());
    }

    [Fact]
    public async Task Concurrent_different_keys_for_last_room_commit_exactly_one_hold()
    {
        await SeedFixedAsync();
        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        var request = ValidRequest(FamilyRoomTypeId);
        Assert.Equal(1, await GetAvailableRoomsAsync(firstClient, "FAMILY"));
        Assert.Equal(1, await GetAvailableRoomsAsync(secondClient, "FAMILY"));

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var firstTask = PostHoldAsync(firstClient, "Last-Room-A", request, timeout.Token);
        var secondTask = PostHoldAsync(secondClient, "Last-Room-B", request, timeout.Token);
        var responses = await Task.WhenAll(firstTask, secondTask);

        Assert.Equal(
            [HttpStatusCode.Created, HttpStatusCode.Conflict],
            responses.Select(response => response.StatusCode).Order().ToArray());
        Assert.All(
            responses.Where(response => response.StatusCode == HttpStatusCode.Conflict),
            response => Assert.Equal(
                "application/problem+json",
                response.Content.Headers.ContentType?.MediaType));
        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.BookingHolds.CountAsync());
        Assert.Equal(1, await context.BookingHoldNights.CountAsync());
        Assert.Equal(0, await GetAvailableRoomsAsync(firstClient, "FAMILY"));
    }

    [Fact]
    public async Task Concurrent_same_key_converges_and_multinight_overlap_completes_without_deadlock()
    {
        await SeedFixedAsync();
        await using (var setup = factory.CreateDbContext())
        {
            setup.DailyInventoryControls.RemoveRange(setup.DailyInventoryControls);
            await setup.SaveChangesAsync();
        }

        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var sameRequest = ValidRequest(FamilyRoomTypeId);
        var sameKeyResponses = await Task.WhenAll(
            PostHoldAsync(firstClient, "Same-Concurrent-Key", sameRequest, timeout.Token),
            PostHoldAsync(secondClient, "Same-Concurrent-Key", sameRequest, timeout.Token));
        Assert.Equal(
            [HttpStatusCode.OK, HttpStatusCode.Created],
            sameKeyResponses.Select(response => response.StatusCode).Order().ToArray());
        var sameKeyBodies = await Task.WhenAll(
            sameKeyResponses.Select(response =>
                response.Content.ReadFromJsonAsync<JsonElement>(timeout.Token)));
        Assert.Single(
            sameKeyBodies,
            body => body.GetProperty("guestAccessToken").ValueKind == JsonValueKind.String);

        await factory.ResetDatabaseAsync();
        await SeedFixedAsync();
        await using (var setup = factory.CreateDbContext())
        {
            setup.DailyInventoryControls.RemoveRange(setup.DailyInventoryControls);
            await setup.SaveChangesAsync();
        }

        var earlyRange = ValidRequest(FamilyRoomTypeId) with
        {
            CheckIn = LocalToday,
            CheckOut = LocalToday.AddDays(2)
        };
        var lateRange = ValidRequest(FamilyRoomTypeId) with
        {
            CheckIn = LocalToday.AddDays(1),
            CheckOut = LocalToday.AddDays(3)
        };
        var overlapResponses = await Task.WhenAll(
            PostHoldAsync(firstClient, "Overlap-Early", earlyRange, timeout.Token),
            PostHoldAsync(secondClient, "Overlap-Late", lateRange, timeout.Token));
        Assert.Equal(
            [HttpStatusCode.Created, HttpStatusCode.Conflict],
            overlapResponses.Select(response => response.StatusCode).Order().ToArray());
        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.BookingHolds.CountAsync());
        Assert.Equal(2, await context.BookingHoldNights.CountAsync());
    }

    [Fact]
    public async Task Availability_counts_confirmed_reservation_once_and_excludes_cancelled_state()
    {
        await SeedFixedAsync();
        await using (var setup = factory.CreateDbContext())
        {
            var flexible = new RatePlan(
                Guid.NewGuid(),
                PropertyId,
                "FLEXIBLE",
                "Flexible",
                null,
                "VND",
                true,
                FixedUtc);
            setup.RatePlans.Add(flexible);
            setup.DailyRoomRates.Add(new DailyRoomRate(
                Guid.NewGuid(),
                PropertyId,
                DeluxeRoomTypeId,
                flexible.Id,
                LocalToday,
                1600000m,
                FixedUtc));
            await setup.SaveChangesAsync();
        }

        using var client = factory.CreateClient();
        var created = await PostHoldAsync(
            client,
            "Lifecycle-Demand-Key",
            ValidRequest(DeluxeRoomTypeId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var activeOffers = await GetOffersAsync(client);
        Assert.All(
            activeOffers.Where(offer =>
                offer.GetProperty("roomTypeCode").GetString() == "DLX-KING"),
            offer => Assert.Equal(1, offer.GetProperty("availableRooms").GetInt32()));

        Guid reservationId;
        await using (var context = factory.CreateDbContext())
        {
            var hold = await context.BookingHolds
                .AsNoTracking()
                .Include(item => item.Nights)
                .SingleAsync();
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE \"BookingHolds\" SET \"Status\" = 'Confirmed' WHERE \"Id\" = {hold.Id}");
            reservationId = Guid.NewGuid();
            context.Reservations.Add(new Reservation(
                reservationId,
                "CONF-DEMAND-1",
                hold.Id,
                hold.PropertyId,
                hold.RoomTypeId,
                hold.RatePlanId,
                hold.CustomerAccountId,
                hold.FullName,
                hold.Email,
                hold.Phone,
                hold.CheckIn,
                hold.CheckOut,
                hold.Adults,
                hold.Children,
                hold.Rooms,
                hold.CurrencyCode,
                hold.TotalAmount,
                ReservationStatus.Confirmed,
                FixedUtc.AddMinutes(1),
                null,
                null,
                hold.GuestAccessTokenHash,
                hold.Nights.Select(night => new BookingNightSnapshot(
                    night.StayDate,
                    night.Rooms,
                    night.UnitAmount,
                    night.NightTotal))));
            await context.SaveChangesAsync();
        }

        var confirmedOffers = await GetOffersAsync(client);
        Assert.All(
            confirmedOffers.Where(offer =>
                offer.GetProperty("roomTypeCode").GetString() == "DLX-KING"),
            offer => Assert.Equal(1, offer.GetProperty("availableRooms").GetInt32()));

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE "Reservations"
                 SET "Status" = 'Cancelled',
                     "CancelledAtUtc" = {FixedUtc.AddMinutes(2)},
                     "CancellationReason" = 'Test cancellation'
                 WHERE "Id" = {reservationId}
                 """);
        }

        var cancelledOffers = await GetOffersAsync(client);
        Assert.All(
            cancelledOffers.Where(offer =>
                offer.GetProperty("roomTypeCode").GetString() == "DLX-KING"),
            offer => Assert.Equal(2, offer.GetProperty("availableRooms").GetInt32()));
    }

    [Fact]
    public async Task Resource_date_occupancy_and_complete_pricing_fail_with_public_problem_details()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        AssertProblem(
            await PostHoldAsync(
                client,
                "Missing-Property",
                ValidRequest(DeluxeRoomTypeId) with { PropertyId = Guid.NewGuid() }),
            HttpStatusCode.NotFound);
        AssertProblem(
            await PostHoldAsync(
                client,
                "Past-Date",
                ValidRequest(DeluxeRoomTypeId) with
                {
                    CheckIn = LocalToday.AddDays(-1),
                    CheckOut = LocalToday
                }),
            HttpStatusCode.BadRequest);
        AssertProblem(
            await PostHoldAsync(
                client,
                "Occupancy",
                ValidRequest(DeluxeRoomTypeId) with { Adults = 3 }),
            HttpStatusCode.BadRequest);

        await using (var context = factory.CreateDbContext())
        {
            var rate = await context.DailyRoomRates.SingleAsync(item =>
                item.RoomTypeId == DeluxeRoomTypeId &&
                item.RatePlanId == RatePlanId &&
                item.StayDate == LocalToday);
            context.DailyRoomRates.Remove(rate);
            await context.SaveChangesAsync();
        }

        AssertProblem(
            await PostHoldAsync(
                client,
                "Missing-Price",
                ValidRequest(DeluxeRoomTypeId)),
            HttpStatusCode.Conflict);
        await using var verification = factory.CreateDbContext();
        Assert.Empty(await verification.BookingHolds.ToListAsync());
    }

    [Fact]
    public async Task OpenApi_documents_atomic_hold_headers_optional_cookie_and_responses()
    {
        await SeedFixedAsync();
        using var client = factory.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths")
            .GetProperty("/api/v1/booking-holds")
            .GetProperty("post");
        var headers = operation.GetProperty("parameters")
            .EnumerateArray()
            .ToDictionary(
                parameter => parameter.GetProperty("name").GetString()!,
                parameter => parameter);
        Assert.True(headers["Idempotency-Key"].GetProperty("required").GetBoolean());
        Assert.True(headers["X-CSRF-TOKEN"].GetProperty("required").GetBoolean());
        foreach (var status in new[] { "200", "201", "400", "401", "404", "409" })
        {
            Assert.True(operation.GetProperty("responses").TryGetProperty(status, out _));
        }

        Assert.Contains("one-time", operation.GetProperty("description").GetString()!,
            StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, operation.GetProperty("security").GetArrayLength());
    }

    [Fact]
    public void Advisory_lock_keys_are_stable_culture_invariant_and_namespaced()
    {
        var originalCulture = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture =
                System.Globalization.CultureInfo.GetCultureInfo("ar-SA");
            var first = BookingAdvisoryLockKeys.ForInventory(
                PropertyId,
                DeluxeRoomTypeId,
                LocalToday);
            System.Globalization.CultureInfo.CurrentCulture =
                System.Globalization.CultureInfo.GetCultureInfo("vi-VN");
            var second = BookingAdvisoryLockKeys.ForInventory(
                PropertyId,
                DeluxeRoomTypeId,
                LocalToday);
            Assert.Equal(first, second);
            Assert.NotEqual(
                first,
                BookingAdvisoryLockKeys.ForInventory(
                    PropertyId,
                    DeluxeRoomTypeId,
                    LocalToday.AddDays(1)));
            Assert.NotEqual(
                first,
                BookingAdvisoryLockKeys.ForIdempotency(
                    BookingHoldRequestSecurity.Sha256Hex("lock-key")));
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = originalCulture;
        }
    }

    private async Task SeedFixedAsync()
    {
        factory.Clock.UtcNow = FixedUtc;
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context, new FixedTimeProvider(FixedUtc))
            .SeedAsync(CancellationToken.None);
    }

    private async Task<Guid> CreateCustomerAsync(string email)
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
        return account.Id;
    }

    private async Task<int> GetDeluxeAvailableRoomsAsync(HttpClient client) =>
        await GetAvailableRoomsAsync(client, "DLX-KING");

    private async Task<int> GetAvailableRoomsAsync(HttpClient client, string code)
    {
        var payload = await GetOffersAsync(client);
        var offer = payload
            .SingleOrDefault(item => item.GetProperty("roomTypeCode").GetString() == code);
        return offer.ValueKind == JsonValueKind.Undefined
            ? 0
            : offer.GetProperty("availableRooms").GetInt32();
    }

    private static async Task<JsonElement[]> GetOffersAsync(HttpClient client)
    {
        var payload = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}/availability" +
            $"?checkIn={LocalToday:yyyy-MM-dd}&checkOut={LocalToday.AddDays(1):yyyy-MM-dd}" +
            "&adults=1&children=0&rooms=1");
        return payload.EnumerateArray().ToArray();
    }

    private static ApiRequest ValidRequest(Guid roomTypeId) =>
        new
        (
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
            "+84 123 4567"
        );

    private static async Task<HttpResponseMessage> PostHoldAsync(
        HttpClient client,
        string idempotencyKey,
        object payload,
        CancellationToken cancellationToken = default)
    {
        var csrfResponse = await client.GetAsync(
            "/api/v1/auth/csrf",
            cancellationToken);
        csrfResponse.EnsureSuccessStatusCode();
        var csrf = (await csrfResponse.Content.ReadFromJsonAsync<CsrfResponse>(
            cancellationToken: cancellationToken))!;
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

    private static void AssertProblem(
        HttpResponseMessage response,
        HttpStatusCode status)
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
