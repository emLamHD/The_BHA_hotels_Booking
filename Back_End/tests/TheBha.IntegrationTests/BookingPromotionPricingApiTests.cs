using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Promotions;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BOOKING-PROMOTIONS-001: the price a guest is quoted is the price of the Hold and of the Reservation, the backend alone decides
/// it, and a promotion edited or disabled afterwards changes nothing already held.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BookingPromotionPricingApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset FixedUtc = DateTimeOffset.Parse("2026-07-22T18:30:00Z");
    private static readonly DateOnly LocalToday = new(2026, 7, 23);   // 01:30 on the 23rd in Asia/Ho_Chi_Minh
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid DeluxeRoomTypeId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid FamilyRoomTypeId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid RatePlanId = Guid.Parse("60000000-0000-0000-0000-000000000001");
    private static readonly Guid Staff = Guid.Parse("90000000-0000-0000-0000-0000000000a1");

    private DateOnly CheckIn => LocalToday.AddDays(3);
    private DateOnly CheckOut => LocalToday.AddDays(5);   // two nights

    [Fact]
    public async Task A_quote_shows_the_list_price_the_discount_and_the_final_price_of_an_active_promotion()
    {
        await SeedAsync(Promotion("giam-15", value: 15m, roomTypes: [DeluxeRoomTypeId], active: true));
        using var client = factory.CreateClient();

        var deluxe = await Offer(client, "DLX-KING", rooms: 2);

        Assert.Equal(2 * 2 * 1_275_000m, deluxe.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(2 * 2 * 1_500_000m, deluxe.GetProperty("listTotalAmount").GetDecimal());
        Assert.Equal(2 * 2 * 225_000m, deluxe.GetProperty("discountTotalAmount").GetDecimal());
        Assert.Equal("giam-15", deluxe.GetProperty("appliedPromotion").GetProperty("slug").GetString());
        var night = deluxe.GetProperty("nightlyRates")[0];
        Assert.Equal(1_275_000m, night.GetProperty("amount").GetDecimal());
        Assert.Equal(1_500_000m, night.GetProperty("listAmount").GetDecimal());
        Assert.Equal(225_000m, night.GetProperty("discountAmount").GetDecimal());

        var family = await Offer(client, "FAMILY");   // not in the promotion's room types
        Assert.Equal(2 * 2_200_000m, family.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(JsonValueKind.Null, family.GetProperty("appliedPromotion").ValueKind);
        Assert.Equal(0m, family.GetProperty("discountTotalAmount").GetDecimal());
    }

    [Theory]
    [InlineData(PromotionStatus.Draft)]
    [InlineData(PromotionStatus.Disabled)]
    public async Task A_draft_or_disabled_promotion_never_prices(PromotionStatus status)
    {
        var promotion = Promotion("giam-20", value: 20m, active: false);
        await SeedAsync(promotion);
        if (status == PromotionStatus.Disabled) await SetStatusAsync(promotion.Id, PromotionStatus.Active, PromotionStatus.Disabled);
        using var client = factory.CreateClient();

        var deluxe = await Offer(client, "DLX-KING");

        Assert.Equal(2 * 1_500_000m, deluxe.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(JsonValueKind.Null, deluxe.GetProperty("appliedPromotion").ValueKind);
    }

    [Fact]
    public async Task The_promotion_conditions_are_enforced_by_the_backend_for_the_dates_asked()
    {
        // booking window ended yesterday (Property local), and a minimum of three nights for a two-night stay.
        await SeedAsync(
            Promotion("het-han", value: 30m, active: true, bookingTo: LocalToday.AddDays(-1)),
            Promotion("toi-thieu-3", value: 30m, active: true, minNights: 3));
        using var client = factory.CreateClient();

        var deluxe = await Offer(client, "DLX-KING");
        Assert.Equal(JsonValueKind.Null, deluxe.GetProperty("appliedPromotion").ValueKind);
        Assert.Equal(2 * 1_500_000m, deluxe.GetProperty("totalAmount").GetDecimal());

        var threeNights = await Offer(client, "DLX-KING", checkOut: CheckIn.AddDays(3));
        Assert.Equal("toi-thieu-3", threeNights.GetProperty("appliedPromotion").GetProperty("slug").GetString());
    }

    [Fact]
    public async Task A_hold_with_the_confirmed_price_is_created_at_the_discounted_price_with_a_snapshot()
    {
        await SeedAsync(Promotion("giam-10", value: 10m, active: true));
        using var client = factory.CreateClient();
        var quote = await Offer(client, "DLX-KING", rooms: 2);
        var total = quote.GetProperty("totalAmount").GetDecimal();

        var response = await PostHold(client, "promo-1", Request(rooms: 2, expectedTotal: total, expectedCurrency: "VND"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var hold = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(total, hold.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(2 * 2 * 1_500_000m, hold.GetProperty("listTotalAmount").GetDecimal());
        Assert.Equal(2 * 2 * 150_000m, hold.GetProperty("discountTotalAmount").GetDecimal());
        Assert.Equal("giam-10", hold.GetProperty("appliedPromotion").GetProperty("slug").GetString());
        var night = hold.GetProperty("nights")[0];
        Assert.Equal(1_350_000m, night.GetProperty("unitAmount").GetDecimal());
        Assert.Equal(1_500_000m, night.GetProperty("listUnitAmount").GetDecimal());
        Assert.Equal(150_000m, night.GetProperty("discountUnitAmount").GetDecimal());

        await using var context = factory.CreateDbContext();
        var stored = await context.BookingPromotionApplications.SingleAsync();
        Assert.Equal(hold.GetProperty("holdId").GetGuid(), stored.HoldId);
        Assert.Equal(2 * 2 * 150_000m, stored.DiscountTotalAmount);
        Assert.Equal(2, stored.PromotionVersion);   // created as version 1, activated as version 2
        Assert.Null(stored.ReservationId);
        Assert.All(await context.InventoryHoldItemNights.ToListAsync(), n => Assert.Equal(n.ListUnitAmount - n.UnitAmount, 150_000m));
    }

    [Fact]
    public async Task A_stale_price_is_refused_as_a_known_result_with_the_new_quote_and_nothing_is_held()
    {
        await SeedAsync(Promotion("giam-10", value: 10m, active: true));
        using var client = factory.CreateClient();
        var stale = 2 * 1_500_000m;   // the guest was shown the list price, then the promotion started applying

        var response = await PostHold(client, "stale-1", Request(expectedTotal: stale, expectedCurrency: "VND"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("hold.price-changed", problem.GetProperty("code").GetString());
        var quote = problem.GetProperty("quote");
        Assert.Equal(2 * 1_350_000m, quote.GetProperty("totalAmount").GetDecimal());
        Assert.Equal("VND", quote.GetProperty("currencyCode").GetString());
        Assert.Equal("giam-10", quote.GetProperty("appliedPromotion").GetProperty("slug").GetString());
        Assert.Equal(1_350_000m, quote.GetProperty("nightlyRates")[0].GetProperty("amount").GetDecimal());

        await using var context = factory.CreateDbContext();
        Assert.Equal(0, await context.InventoryHolds.CountAsync());
        Assert.Equal(0, await context.BookingPromotionApplications.CountAsync());

        // The refusal stored nothing, so the guest re-confirms the new price (a new attempt) and it is held at exactly that price.
        var again = await PostHold(client, "stale-2", Request(expectedTotal: 2 * 1_350_000m, expectedCurrency: "VND"));
        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
    }

    [Theory]
    [InlineData(1.00)]            // a client trying to pay almost nothing
    [InlineData(2_999_999.00)]    // lower than the real price by one dong
    [InlineData(3_000_001.00)]    // higher than the real price: also refused, the guest confirms what is true
    public async Task A_client_cannot_name_its_own_price(double claimed)
    {
        await SeedAsync(Promotion("giam-10", value: 10m, active: true, status: false));   // draft: real price is 3,000,000
        using var client = factory.CreateClient();

        var response = await PostHold(client, "forge-1", Request(expectedTotal: (decimal)claimed, expectedCurrency: "VND"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("hold.price-changed", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        await using var context = factory.CreateDbContext();
        Assert.Equal(0, await context.InventoryHolds.CountAsync());
    }

    [Fact]
    public async Task A_different_currency_than_the_rate_plans_is_a_price_change()
    {
        await SeedAsync();
        using var client = factory.CreateClient();

        var response = await PostHold(client, "currency-1", Request(expectedTotal: 3_000_000m, expectedCurrency: "USD"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("hold.price-changed", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task The_expected_price_is_sent_with_its_currency_or_not_at_all()
    {
        await SeedAsync();
        using var client = factory.CreateClient();

        var amountOnly = await PostHold(client, "pair-1", Request(expectedTotal: 3_000_000m));
        var currencyOnly = await PostHold(client, "pair-2", Request(expectedCurrency: "VND"));
        var negative = await PostHold(client, "pair-3", Request(expectedTotal: -1m, expectedCurrency: "VND"));
        var threeDecimals = await PostHold(client, "pair-4", Request(expectedTotal: 3_000_000.123m, expectedCurrency: "VND"));

        Assert.All([amountOnly, currencyOnly, negative, threeDecimals], r => Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode));
    }

    [Fact]
    public async Task A_caller_that_sends_no_expected_price_keeps_working_and_gets_the_current_price()
    {
        await SeedAsync(Promotion("giam-10", value: 10m, active: true));
        using var client = factory.CreateClient();

        var response = await PostHold(client, "legacy-1", Request());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(2 * 1_350_000m, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("totalAmount").GetDecimal());
    }

    [Fact]
    public async Task A_replay_of_a_created_hold_returns_the_stored_price_even_after_the_promotion_changed()
    {
        var promotion = Promotion("giam-10", value: 10m, active: true);
        await SeedAsync(promotion);
        using var client = factory.CreateClient();
        var request = Request(expectedTotal: 2 * 1_350_000m, expectedCurrency: "VND");
        var created = await PostHold(client, "replay-1", request);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        await SetStatusAsync(promotion.Id, PromotionStatus.Active, PromotionStatus.Disabled);

        var replay = await PostHold(client, "replay-1", request);

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);   // not a price-changed refusal: the Hold exists
        var body = await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2 * 1_350_000m, body.GetProperty("totalAmount").GetDecimal());
        Assert.Equal("giam-10", body.GetProperty("appliedPromotion").GetProperty("slug").GetString());
        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.InventoryHolds.CountAsync());
    }

    [Fact]
    public async Task The_same_key_with_another_expected_price_is_a_conflict_not_a_new_payload()
    {
        await SeedAsync();
        using var client = factory.CreateClient();
        var first = await PostHold(client, "payload-1", Request(expectedTotal: 3_000_000m, expectedCurrency: "VND"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var changed = await PostHold(client, "payload-1", Request(expectedTotal: 2_900_000m, expectedCurrency: "VND"));

        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal("hold.idempotency-conflict", (await changed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Confirming_keeps_the_price_that_was_held_even_if_the_promotion_is_edited_disabled_or_expired_meanwhile()
    {
        var promotion = Promotion("giam-10", value: 10m, active: true);
        await SeedAsync(promotion);
        using var client = factory.CreateClient();
        var created = await PostHold(client, "confirm-1", Request(expectedTotal: 2 * 1_350_000m, expectedCurrency: "VND"));
        var hold = await created.Content.ReadFromJsonAsync<JsonElement>();
        var holdId = hold.GetProperty("holdId").GetGuid();
        var token = hold.GetProperty("guestAccessToken").GetString()!;

        // The Owner raises the discount, then switches the promotion off: neither touches the Hold.
        await EditValueAsync(promotion.Id, 50m);
        await SetStatusAsync(promotion.Id, PromotionStatus.Active, PromotionStatus.Disabled);

        var confirmed = await Confirm(client, holdId, token);

        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var reservation = await confirmed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2 * 1_350_000m, reservation.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(2 * 150_000m, reservation.GetProperty("discountTotalAmount").GetDecimal());
        Assert.Equal(2 * 1_500_000m, reservation.GetProperty("listTotalAmount").GetDecimal());
        var applied = reservation.GetProperty("appliedPromotion");
        Assert.Equal("giam-10", applied.GetProperty("slug").GetString());
        Assert.Equal(10m, applied.GetProperty("value").GetDecimal());   // the value at the Hold, not the edited 50

        await using var context = factory.CreateDbContext();
        var snapshot = await context.BookingPromotionApplications.SingleAsync();
        Assert.Equal(reservation.GetProperty("reservationId").GetGuid(), snapshot.ReservationId);

        // A replay of the confirmation, and a later read, give the same price.
        var replay = await Confirm(client, holdId, token);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(2 * 1_350_000m, (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("totalAmount").GetDecimal());
    }

    [Fact]
    public async Task A_hold_and_a_reservation_without_a_promotion_report_no_discount()
    {
        await SeedAsync();
        using var client = factory.CreateClient();
        var created = await PostHold(client, "plain-1", Request());
        var hold = await created.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(0m, hold.GetProperty("discountTotalAmount").GetDecimal());
        Assert.Equal(JsonValueKind.Null, hold.GetProperty("appliedPromotion").ValueKind);
        var confirmed = await Confirm(client, hold.GetProperty("holdId").GetGuid(), hold.GetProperty("guestAccessToken").GetString()!);
        var reservation = await confirmed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, reservation.GetProperty("appliedPromotion").ValueKind);
        Assert.Equal(2 * 1_500_000m, reservation.GetProperty("totalAmount").GetDecimal());
    }

    [Fact]
    public async Task Hold_expiry_is_unchanged_an_expired_promotion_hold_cannot_be_confirmed()
    {
        await SeedAsync(Promotion("giam-10", value: 10m, active: true));
        using var client = factory.CreateClient();
        var created = await PostHold(client, "expire-1", Request(expectedTotal: 2 * 1_350_000m, expectedCurrency: "VND"));
        var hold = await created.Content.ReadFromJsonAsync<JsonElement>();
        factory.Clock.UtcNow = FixedUtc.AddMinutes(16);

        var confirmed = await Confirm(client, hold.GetProperty("holdId").GetGuid(), hold.GetProperty("guestAccessToken").GetString()!);

        Assert.Equal(HttpStatusCode.Conflict, confirmed.StatusCode);
        Assert.Equal("hold.expired", (await confirmed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    // ---- helpers ----

    private Promotion Promotion(
        string slug,
        decimal value,
        Guid[]? roomTypes = null,
        bool active = false,
        bool status = true,
        DateOnly? bookingTo = null,
        int minNights = 1)
    {
        _ = status;
        var details = new PromotionDetails(
            slug, "Ưu đãi " + slug, "Mô tả ngắn", ["Điều kiện."], null, null, PromotionDiscountKind.Percent, value, null,
            roomTypes is null, roomTypes ?? [], null, bookingTo, null, null, minNights, false, 0, null, null);
        var promotion = new Promotion(Guid.NewGuid(), PropertyId, details, Staff, Guid.NewGuid(), new string('a', 64), FixedUtc);
        if (active) promotion.SetStatus(PromotionStatus.Active, Staff, FixedUtc);
        return promotion;
    }

    private async Task SeedAsync(params Promotion[] promotions)
    {
        factory.Clock.UtcNow = FixedUtc;
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context, new FixedClock(FixedUtc)).SeedAsync(CancellationToken.None);
        context.Promotions.AddRange(promotions);
        await context.SaveChangesAsync();
    }

    private async Task SetStatusAsync(Guid id, PromotionStatus from, PromotionStatus to)
    {
        await using var context = factory.CreateDbContext();
        var promotion = await context.Promotions.Include(x => x.RoomTypes).SingleAsync(x => x.Id == id);
        if (promotion.Status == PromotionStatus.Draft) promotion.SetStatus(PromotionStatus.Active, Staff, FixedUtc);
        if (promotion.Status == from && from != to) promotion.SetStatus(to, Staff, FixedUtc);
        await context.SaveChangesAsync();
    }

    private async Task EditValueAsync(Guid id, decimal value)
    {
        await using var context = factory.CreateDbContext();
        var promotion = await context.Promotions.Include(x => x.RoomTypes).SingleAsync(x => x.Id == id);
        promotion.Edit(promotion.ToDetails() with { Value = value }, Staff, FixedUtc);
        await context.SaveChangesAsync();
    }

    private async Task<JsonElement> Offer(HttpClient client, string code, int rooms = 1, DateOnly? checkOut = null)
    {
        var payload = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}/availability?checkIn={CheckIn:yyyy-MM-dd}&checkOut={(checkOut ?? CheckOut):yyyy-MM-dd}" +
            $"&adults=1&children=0&rooms={rooms}");
        return payload.EnumerateArray().Single(x => x.GetProperty("roomTypeCode").GetString() == code);
    }

    private object Request(int rooms = 1, decimal? expectedTotal = null, string? expectedCurrency = null) => new
    {
        propertyId = PropertyId,
        roomTypeId = DeluxeRoomTypeId,
        ratePlanId = RatePlanId,
        checkIn = CheckIn,
        checkOut = CheckOut,
        adults = 1,
        children = 0,
        rooms,
        fullName = "Guest Name",
        email = "guest@example.com",
        phone = "+84 123 4567",
        expectedTotalAmount = expectedTotal,
        expectedCurrencyCode = expectedCurrency
    };

    private static async Task<HttpResponseMessage> PostHold(HttpClient client, string key, object payload)
    {
        var csrf = await Csrf(client);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/booking-holds") { Content = JsonContent.Create(payload) };
        request.Headers.Add("Idempotency-Key", key);
        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> Confirm(HttpClient client, Guid holdId, string token)
    {
        var csrf = await Csrf(client);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/booking-holds/{holdId}/confirm");
        request.Headers.Add("X-Booking-Access-Token", token);
        request.Headers.Add(csrf.HeaderName, csrf.Token);
        return await client.SendAsync(request);
    }

    private static async Task<CsrfResponse> Csrf(HttpClient client)
    {
        var response = await client.GetAsync("/api/v1/auth/csrf");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CsrfResponse>())!;
    }

    private sealed record CsrfResponse(string Token, string HeaderName);

    private sealed class FixedClock(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }
}
