using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Domain.Promotions;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR05: shared setup for the Direct (pay at the property) reservation tests. Synthetic data only: the Development seed (Riverside-like demo catalog: 2 Deluxe rooms at 1 500 000 VND, 1 Family room at
/// 2 200 000 VND, VND rate plan) on the isolated PostgreSQL test database, a fixed clock, and a host that has Direct switched on for that one Property unless a test says otherwise.
/// </summary>
public abstract class DirectReservationTestSupport(PostgreSqlWebApplicationFactory factory)
{
    protected static readonly DateTimeOffset FixedUtc = DateTimeOffset.Parse("2026-07-22T18:30:00Z");
    protected static readonly DateOnly LocalToday = new(2026, 7, 23);
    protected static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    protected static readonly Guid DeluxeId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    protected static readonly Guid FamilyId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    protected static readonly Guid RatePlanId = Guid.Parse("60000000-0000-0000-0000-000000000001");
    protected static readonly Guid StaffId = Guid.Parse("90000000-0000-0000-0000-0000000000a1");
    protected const string StrongPassword = "Strong!Password123";
    protected const string AdminOrigin = "https://localhost:3001";

    protected PostgreSqlWebApplicationFactory Factory => factory;

    protected DateOnly CheckIn => LocalToday.AddDays(3);

    protected async Task SeedAsync(params Promotion[] promotions)
    {
        factory.Clock.UtcNow = FixedUtc;
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context, new FixedClock(FixedUtc)).SeedAsync(CancellationToken.None);
        if (promotions.Length > 0)
        {
            context.Promotions.AddRange(promotions);
            await context.SaveChangesAsync();
        }
    }

    /// <summary>A host with Direct switched on for the seeded Property (and nothing else changed) unless <paramref name="enableDirect"/> is false. <paramref name="configure"/> adds settings or services.</summary>
    protected WebApplicationFactory<Program> Host(bool enableDirect = true, Action<IWebHostBuilder>? configure = null, params (string Key, string Value)[] settings) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (enableDirect)
            {
                builder.UseSetting("Booking:DirectCheckout:PropertyIds:0", PropertyId.ToString());
            }

            // A limit of 10 a minute from one loopback address would 429 an unrelated test: only the rate-limit tests ask for a real one.
            builder.UseSetting("Booking:DirectCheckout:RateLimiting:PermitLimit", "100000");
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            configure?.Invoke(builder);
        });

    protected static string NewToken() => new CryptographicGuestAccessTokenGenerator().Generate();

    protected Dictionary<string, object?> Body(
        Guid? roomTypeId = null,
        int rooms = 1,
        int nights = 1,
        int startOffset = 3,
        decimal total = 1_500_000m,
        string currency = "VND",
        string name = "Guest Name",
        string email = "guest@example.com",
        string phone = "+84 123 4567",
        int adults = 1) =>
        new()
        {
            ["propertyId"] = PropertyId,
            ["roomTypeId"] = roomTypeId ?? DeluxeId,
            ["ratePlanId"] = RatePlanId,
            ["checkIn"] = LocalToday.AddDays(startOffset),
            ["checkOut"] = LocalToday.AddDays(startOffset + nights),
            ["adults"] = adults,
            ["children"] = 0,
            ["rooms"] = rooms,
            ["fullName"] = name,
            ["email"] = email,
            ["phone"] = phone,
            ["expectedTotalAmount"] = total,
            ["expectedCurrencyCode"] = currency,
            ["paymentMethod"] = "PayAtProperty"
        };

    protected static async Task<HttpResponseMessage> PostAsync(
        HttpClient client,
        string? key,
        object body,
        string? token = null,
        bool csrf = true,
        Action<HttpRequestMessage>? tweak = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/reservations") { Content = JsonContent.Create(body) };
        if (key is not null)
        {
            request.Headers.Add("Idempotency-Key", key);
        }

        if (token is not null)
        {
            request.Headers.Add("X-Booking-Access-Token", token);
        }

        if (csrf)
        {
            var response = await client.GetAsync("/api/v1/auth/csrf", cancellationToken);
            response.EnsureSuccessStatusCode();
            var pair = (await response.Content.ReadFromJsonAsync<Csrf>(cancellationToken))!;
            request.Headers.Add(pair.HeaderName, pair.Token);
        }

        tweak?.Invoke(request);
        return await client.SendAsync(request, cancellationToken);
    }

    protected static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>();

    protected static string Code(JsonElement problem) => problem.GetProperty("code").GetString()!;

    protected async Task<Guid> CreateCustomerAsync(WebApplicationFactory<Program> host, HttpClient client, string email)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
        var account = new CustomerAccount { Id = Guid.NewGuid(), Email = email, UserName = email };
        Assert.True((await users.CreateAsync(account, StrongPassword)).Succeeded);
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return account.Id;
    }

    protected async Task<long> CountAsync(string table)
    {
        await using var context = factory.CreateDbContext();
        return await context.Database.SqlQueryRaw<long>($"""SELECT count(*) AS "Value" FROM "{table}" """).SingleAsync();
    }

    protected async Task<T> ScalarAsync<T>(string sql)
    {
        await using var context = factory.CreateDbContext();
        return await context.Database.SqlQueryRaw<T>(sql).SingleAsync();
    }

    protected async Task ExecuteAsync(string sql)
    {
        await using var context = factory.CreateDbContext();
        await context.Database.ExecuteSqlRawAsync(sql);
    }

    /// <summary>Everything one Direct booking must leave (or must not leave): the counts of every table it touches, for an exact before/after.</summary>
    protected async Task<string> FootprintAsync()
    {
        var parts = new List<string>();
        foreach (var table in new[] { "Reservations", "ReservationUnits", "ReservationUnitNights", "ReservationCreationRequests", "FolioEntries", "EmailOutboxEvents", "InventoryHolds", "BookingPromotionApplications" })
        {
            parts.Add($"{table}={await CountAsync(table)}");
        }

        parts.Add($"CalendarEvents={await ScalarAsync<long>("""SELECT count(*) AS "Value" FROM "AdminActivities" WHERE "MenuKey" = 'calendar' """)}");
        return string.Join(", ", parts);
    }

    protected const string NothingWritten =
        "Reservations=0, ReservationUnits=0, ReservationUnitNights=0, ReservationCreationRequests=0, FolioEntries=0, EmailOutboxEvents=0, InventoryHolds=0, BookingPromotionApplications=0, CalendarEvents=0";

    /// <summary>Stop-sell (no sellable room) for one night of a room type, as the daily inventory controls state it.</summary>
    protected async Task StopSellAsync(Guid roomTypeId, DateOnly night)
    {
        await using var context = factory.CreateDbContext();
        context.DailyInventoryControls.Add(new DailyInventoryControl(Guid.NewGuid(), PropertyId, roomTypeId, night, null, true, FixedUtc));
        await context.SaveChangesAsync();
    }

    /// <summary>The public availability answer for the room type with this code over a stay: how many rooms it says are free for the whole stay (0 when it offers none).</summary>
    protected async Task<int> AvailableRoomsAsync(HttpClient client, string roomTypeCode, int startOffset = 3, int nights = 1)
    {
        var response = await client.GetAsync($"/api/v1/properties/{PropertyId}/availability?checkIn={LocalToday.AddDays(startOffset):yyyy-MM-dd}&checkOut={LocalToday.AddDays(startOffset + nights):yyyy-MM-dd}&adults=1&children=0&rooms=1");
        response.EnsureSuccessStatusCode();
        var offer = (await JsonAsync(response)).EnumerateArray().SingleOrDefault(item => item.GetProperty("roomTypeCode").GetString() == roomTypeCode);
        return offer.ValueKind == JsonValueKind.Undefined ? 0 : offer.GetProperty("availableRooms").GetInt32();
    }

    protected Promotion ActivePromotion(string slug, decimal percent, Guid[]? roomTypes = null)
    {
        var details = new PromotionDetails(
            slug, "Ưu đãi " + slug, "Mô tả ngắn", ["Điều kiện."], null, null, PromotionDiscountKind.Percent, percent, null,
            roomTypes is null, roomTypes ?? [], null, null, null, null, 1, false, 0, null, null);
        var promotion = new Promotion(Guid.NewGuid(), PropertyId, details, StaffId, Guid.NewGuid(), new string('a', 64), FixedUtc);
        promotion.SetStatus(PromotionStatus.Active, StaffId, FixedUtc);
        return promotion;
    }

    protected sealed record Csrf(string Token, string HeaderName);

    private sealed class FixedClock(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }
}
