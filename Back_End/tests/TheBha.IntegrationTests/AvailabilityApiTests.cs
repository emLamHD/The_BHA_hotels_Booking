using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class AvailabilityApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly DateOnly LocalToday = new(2026, 7, 23);

    [Fact]
    public async Task One_night_request_returns_public_offer_shape_prices_currency_and_inventory()
    {
        await SeedFixedAsync(); using var client = factory.CreateClient();
        var response = await client.GetAsync(Url(LocalToday, LocalToday.AddDays(1), 2, 0, 1));
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal(2, payload.GetArrayLength());
        var deluxe = payload.EnumerateArray().Single(item => item.GetProperty("roomTypeCode").GetString() == "DLX-KING");
        Assert.Equal("STANDARD", deluxe.GetProperty("ratePlanCode").GetString()); Assert.Equal("VND", deluxe.GetProperty("currencyCode").GetString());
        Assert.Equal(2, deluxe.GetProperty("availableRooms").GetInt32()); Assert.Equal(1, deluxe.GetProperty("nights").GetInt32());
        Assert.Equal(1500000m, deluxe.GetProperty("nightlyRates")[0].GetProperty("amount").GetDecimal()); Assert.Equal(1500000m, deluxe.GetProperty("totalAmount").GetDecimal());
        var json = payload.GetRawText();
        foreach (var forbidden in new[] { "physicalRoomId", "roomNumber", "floor", "operationalStatus", "bookedQuantity", "reservedQuantity", "hold" }) Assert.DoesNotContain(forbidden, json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Multi_night_multi_room_request_multiplies_decimal_total_and_orders_nights()
    {
        await SeedFixedAsync(); await using (var context = factory.CreateDbContext()) { context.DailyInventoryControls.RemoveRange(context.DailyInventoryControls); await context.SaveChangesAsync(); }
        using var client = factory.CreateClient(); var payload = await client.GetFromJsonAsync<JsonElement>(Url(LocalToday, LocalToday.AddDays(2), 4, 0, 2));
        Assert.Equal(1, payload.GetArrayLength()); var offer = payload[0];
        Assert.Equal("DLX-KING", offer.GetProperty("roomTypeCode").GetString()); Assert.Equal(2, offer.GetProperty("availableRooms").GetInt32());
        Assert.Equal(["2026-07-23", "2026-07-24"], offer.GetProperty("nightlyRates").EnumerateArray().Select(item => item.GetProperty("stayDate").GetString()));
        Assert.Equal(6000000m, offer.GetProperty("totalAmount").GetDecimal());
    }

    [Fact]
    public async Task Seed_limit_and_stop_sell_affect_stay_offers()
    {
        await SeedFixedAsync(); using var client = factory.CreateClient();
        var limited = await client.GetFromJsonAsync<JsonElement>(Url(LocalToday.AddDays(1), LocalToday.AddDays(2), 1, 0, 1));
        Assert.Equal(1, limited.EnumerateArray().Single(item => item.GetProperty("roomTypeCode").GetString() == "DLX-KING").GetProperty("availableRooms").GetInt32());
        var stoppedStay = await client.GetFromJsonAsync<JsonElement>(Url(LocalToday, LocalToday.AddDays(3), 2, 0, 1));
        Assert.DoesNotContain(stoppedStay.EnumerateArray(), item => item.GetProperty("roomTypeCode").GetString() == "FAMILY");
    }

    [Fact]
    public async Task Non_active_rooms_and_a_limit_above_base_do_not_increase_available_rooms()
    {
        await SeedFixedAsync();
        await using (var context = factory.CreateDbContext())
        {
            var property = await context.Properties.SingleAsync();
            var deluxe = await context.RoomTypes.SingleAsync(item => item.Code == "DLX-KING");
            context.PhysicalRooms.AddRange(
                new PhysicalRoom(Guid.NewGuid(), property.Id, deluxe, "TEST-INACTIVE", 9, OperationalStatus.Inactive, FixedUtc),
                new PhysicalRoom(Guid.NewGuid(), property.Id, deluxe, "TEST-OOS", 9, OperationalStatus.OutOfService, FixedUtc));
            var control = await context.DailyInventoryControls.SingleAsync(item =>
                item.RoomTypeId == deluxe.Id && item.StayDate == LocalToday.AddDays(1));
            control.Update(99, false, FixedUtc.AddMinutes(1));
            await context.SaveChangesAsync();
        }

        using var client = factory.CreateClient();
        var payload = await client.GetFromJsonAsync<JsonElement>(
            Url(LocalToday.AddDays(1), LocalToday.AddDays(2), 2, 0, 1));
        var deluxeOffer = payload.EnumerateArray().Single(item =>
            item.GetProperty("roomTypeCode").GetString() == "DLX-KING");
        Assert.Equal(2, deluxeOffer.GetProperty("availableRooms").GetInt32());
    }

    [Fact]
    public async Task Inactive_rate_plan_is_excluded()
    {
        await SeedFixedAsync();
        await using (var context = factory.CreateDbContext())
        {
            var ratePlan = await context.RatePlans.SingleAsync();
            ratePlan.Deactivate(FixedUtc.AddMinutes(1));
            await context.SaveChangesAsync();
        }

        using var client = factory.CreateClient();
        var payload = await client.GetFromJsonAsync<JsonElement>(
            Url(LocalToday, LocalToday.AddDays(1), 1, 0, 1));
        Assert.Equal(0, payload.GetArrayLength());
    }

    [Fact]
    public async Task Missing_nightly_rate_and_inactive_candidates_are_excluded_without_affecting_complete_candidates()
    {
        await SeedFixedAsync(); await using var context = factory.CreateDbContext();
        var family = await context.RoomTypes.SingleAsync(item => item.Code == "FAMILY"); family.Deactivate(DateTimeOffset.Parse("2026-07-22T19:00:00Z"));
        var missingRate = await context.DailyRoomRates.SingleAsync(item => item.RoomTypeId != family.Id && item.StayDate == LocalToday.AddDays(1)); context.DailyRoomRates.Remove(missingRate); await context.SaveChangesAsync();
        using var client = factory.CreateClient(); var payload = await client.GetFromJsonAsync<JsonElement>(Url(LocalToday, LocalToday.AddDays(2), 2, 0, 1)); Assert.Equal(0, payload.GetArrayLength());
    }

    [Theory]
    [InlineData("2026-07-23", "2026-07-23", 2, 0, 1)]
    [InlineData("2026-07-24", "2026-07-23", 2, 0, 1)]
    [InlineData("2026-07-22", "2026-07-23", 2, 0, 1)]
    [InlineData("2026-07-23", "2026-07-24", 0, 0, 1)]
    [InlineData("2026-07-23", "2026-07-24", 1, -1, 1)]
    [InlineData("2026-07-23", "2026-07-24", 1, 0, 0)]
    [InlineData("2026-07-23", "2026-08-23", 1, 0, 1)]
    [InlineData("2026-07-23", "2026-07-24", 1, 0, 11)]
    public async Task Invalid_business_requests_return_problem_details_400(string checkIn, string checkOut, int adults, int children, int rooms)
    {
        await SeedFixedAsync(); using var client = factory.CreateClient(); var response = await client.GetAsync($"/api/v1/properties/{PropertyId}/availability?checkIn={checkIn}&checkOut={checkOut}&adults={adults}&children={children}&rooms={rooms}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("/api/v1/properties/not-a-guid/availability?checkIn=2026-07-23&checkOut=2026-07-24&adults=1&children=0&rooms=1")]
    [InlineData("/api/v1/properties/10000000-0000-0000-0000-000000000001/availability?checkIn=bad&checkOut=2026-07-24&adults=1&children=0&rooms=1")]
    [InlineData("/api/v1/properties/10000000-0000-0000-0000-000000000001/availability?checkIn=2026-07-23&adults=1&children=0&rooms=1")]
    public async Task Malformed_or_missing_parameters_return_400(string url)
    {
        await SeedFixedAsync(); using var client = factory.CreateClient(); Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Missing_or_inactive_property_returns_404_while_valid_zero_candidates_returns_empty_200()
    {
        await SeedFixedAsync(); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/properties/{Guid.NewGuid()}/availability?checkIn=2026-07-23&checkOut=2026-07-24&adults=1&children=0&rooms=1")).StatusCode);
        var empty = await client.GetAsync(Url(LocalToday, LocalToday.AddDays(1), 100, 0, 1)); Assert.Equal(HttpStatusCode.OK, empty.StatusCode); Assert.Equal(0, (await empty.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());
        await using var context = factory.CreateDbContext(); var property = await context.Properties.SingleAsync(); property.Deactivate(DateTimeOffset.Parse("2026-07-22T19:00:00Z")); await context.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Url(LocalToday, LocalToday.AddDays(1), 1, 0, 1))).StatusCode);
    }

    [Fact]
    public async Task Swagger_documents_availability_parameters_and_responses()
    {
        await SeedFixedAsync(); using var client = factory.CreateClient(); var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths").GetProperty("/api/v1/properties/{propertyId}/availability").GetProperty("get");
        Assert.Equal(new[] { "propertyId", "checkIn", "checkOut", "adults", "children", "rooms" }, operation.GetProperty("parameters").EnumerateArray().Select(item => item.GetProperty("name").GetString()));
        Assert.True(operation.GetProperty("responses").TryGetProperty("200", out _)); Assert.True(operation.GetProperty("responses").TryGetProperty("400", out _)); Assert.True(operation.GetProperty("responses").TryGetProperty("404", out _));
    }

    private async Task SeedFixedAsync()
    {
        factory.Clock.UtcNow = FixedUtc;
        await factory.ResetDatabaseAsync(); await using var context = factory.CreateDbContext(); await new DevelopmentDataSeeder(context, new FixedTimeProvider(FixedUtc)).SeedAsync(CancellationToken.None);
    }
    private static readonly DateTimeOffset FixedUtc = DateTimeOffset.Parse("2026-07-22T18:30:00Z");
    private static string Url(DateOnly checkIn, DateOnly checkOut, int adults, int children, int rooms) => $"/api/v1/properties/{PropertyId}/availability?checkIn={checkIn:yyyy-MM-dd}&checkOut={checkOut:yyyy-MM-dd}&adults={adults}&children={children}&rooms={rooms}";
    private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider { public override DateTimeOffset GetUtcNow() => value; }
}
