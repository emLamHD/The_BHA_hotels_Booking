using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Bookings;
using TheBha.Application.Notifications;
using TheBha.Domain.Bookings;

namespace TheBha.IntegrationTests;

/// <summary>BHA-CHECKOUT-001-PR05 D-01, D-02, D-07: create (guest and account), ownership, refused requests, the shared price, and what a successful booking leaves behind.</summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class DirectReservationApiTests(PostgreSqlWebApplicationFactory factory) : DirectReservationTestSupport(factory)
{
    [Fact]
    public async Task A_guest_booking_is_201_with_a_location_the_guest_can_read_and_leaves_exactly_one_charge_event_and_calendar_row()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        var token = NewToken();

        var response = await PostAsync(client, "guest-key-1", Body(), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonAsync(response);
        var reservationId = body.GetProperty("reservationId").GetGuid();
        Assert.Equal($"/api/v1/reservations/{reservationId}", response.Headers.Location!.AbsolutePath);
        Assert.Equal("Confirmed", body.GetProperty("status").GetString());
        Assert.Equal("PayAtProperty", body.GetProperty("paymentMethod").GetString());
        Assert.Equal("Recorded", body.GetProperty("ledgerState").GetString());
        Assert.Equal(1_500_000, body.GetProperty("receivableAmount").GetInt64());
        Assert.Equal(0, body.GetProperty("collectedAmount").GetInt64());
        Assert.Equal(1_500_000, body.GetProperty("balanceDueAmount").GetInt64());
        Assert.Equal(1_500_000m, body.GetProperty("totalAmount").GetDecimal());
        // Nothing secret comes back: not the token, not its hash, not a request hash.
        var raw = body.GetRawText() + string.Join(';', response.Headers.Select(header => header.Key + string.Join(',', header.Value)));
        Assert.DoesNotContain(token, raw, StringComparison.Ordinal);
        foreach (var forbidden in new[] { "guestAccessToken", "guestAccessTokenHash", "customerAccountId", "fingerprint", "scopeHash", "keyHash" })
        {
            Assert.DoesNotContain(forbidden, raw, StringComparison.OrdinalIgnoreCase);
        }

        // The Location is readable by its owner with the old, unchanged contract (no Direct-only fields).
        using var read = new HttpRequestMessage(HttpMethod.Get, response.Headers.Location);
        read.Headers.Add("X-Booking-Access-Token", token);
        var readResponse = await client.SendAsync(read);
        Assert.Equal(HttpStatusCode.OK, readResponse.StatusCode);
        var readBody = await JsonAsync(readResponse);
        Assert.Equal(reservationId, readBody.GetProperty("reservationId").GetGuid());
        Assert.False(readBody.TryGetProperty("paymentMethod", out _));
        Assert.False(readBody.TryGetProperty("balanceDueAmount", out _));

        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.AsNoTracking().Include(r => r.Units).ThenInclude(u => u.Nights).SingleAsync();
        Assert.Equal(ReservationSource.Direct, reservation.Source);
        Assert.Null(reservation.SourceHoldId);
        Assert.Null(reservation.CustomerAccountId);
        Assert.Equal(BookingAccessTokenValidator.TryHash(token, out var hash) ? hash : null, reservation.GuestAccessTokenHash);
        var unit = Assert.Single(reservation.Units);
        Assert.Null(unit.SourceInventoryHoldItemId);
        Assert.Equal(DeluxeId, unit.RoomTypeId);
        Assert.Equal(CommitmentStatus.Committed, unit.CommitmentStatus);
        Assert.Single(unit.Nights);
        Assert.Equal(0, await CountAsync("InventoryHolds")); // no Hold, real or invented

        // One mapping, one RoomCharge, one event, one Calendar row.
        Assert.Equal(1, await CountAsync("ReservationCreationRequests"));
        var charge = await context.FolioEntries.AsNoTracking().SingleAsync();
        Assert.Equal((FolioEntryKind.RoomCharge, 1_500_000L, "VND", "charge:initial", FolioActorKind.System), (charge.Kind, charge.Amount, charge.CurrencyCode, charge.PostingKey, charge.ActorKind));
        Assert.Equal(reservation.ConfirmedAtUtc, charge.OccurredAtUtc);
        Assert.False(await context.FolioEntries.AnyAsync(entry => entry.Kind == FolioEntryKind.Payment)); // nothing collected

        var outbox = await context.EmailOutboxEvents.AsNoTracking().SingleAsync();
        Assert.Equal((BookingEmailEvents.ReservationConfirmed, 1, PropertyId, "Pending"), (outbox.EventType, outbox.SchemaVersion, outbox.PropertyId, outbox.Status));
        Assert.Equal(BookingEmailEvents.EventId(BookingEmailEvents.ReservationConfirmed, reservationId), outbox.Id);
        Assert.Equal($$"""{"reservationId": "{{reservationId}}"}""", await ScalarAsync<string>("""SELECT "Payload"::text AS "Value" FROM "EmailOutboxEvents" """));
        Assert.DoesNotContain("guest@example.com", await ScalarAsync<string>("""SELECT "Payload"::text AS "Value" FROM "EmailOutboxEvents" """));

        var activity = await ScalarAsync<string>(
            """SELECT concat("Action", '|', "EntityKind", '|', "EntityKey", '|', "ActorKind", '|', "ActorStaffId" IS NULL, '|', "PropertyId", '|', "TitleSnapshot") AS "Value" FROM "AdminActivities" WHERE "MenuKey" = 'calendar' """);
        Assert.Equal($"Created|reservation-unit|{unit.Id}|Public|t|{PropertyId}|Reservation {CheckIn:yyyy-MM-dd} to {CheckIn.AddDays(1):yyyy-MM-dd}", activity);
    }

    [Fact]
    public async Task A_booking_with_a_customer_session_is_owned_by_the_account_and_needs_no_token()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        var accountId = await CreateCustomerAsync(host, client, "direct-owner@example.com");

        var response = await PostAsync(client, "account-key-1", Body());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var id = (await JsonAsync(response)).GetProperty("reservationId").GetGuid();
        var read = await client.GetAsync(response.Headers.Location);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.AsNoTracking().SingleAsync(item => item.Id == id);
        Assert.Equal((accountId, (string?)null, ReservationSource.Direct), (reservation.CustomerAccountId, reservation.GuestAccessTokenHash, reservation.Source));

        // Another visitor, another account and a wrong token cannot read it.
        using var stranger = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync(response.Headers.Location)).StatusCode);
        using var wrongToken = new HttpRequestMessage(HttpMethod.Get, response.Headers.Location);
        wrongToken.Headers.Add("X-Booking-Access-Token", NewToken());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.SendAsync(wrongToken)).StatusCode);
        using var otherAccount = host.CreateClient();
        await CreateCustomerAsync(host, otherAccount, "direct-other@example.com");
        Assert.Equal(HttpStatusCode.NotFound, (await otherAccount.GetAsync(response.Headers.Location)).StatusCode);
    }

    [Fact]
    public async Task A_two_room_booking_has_one_charge_one_event_and_one_calendar_event_per_unit()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();

        var response = await PostAsync(client, "two-rooms", Body(rooms: 2, nights: 2, total: 6_000_000m, adults: 2), NewToken());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal(2, body.GetProperty("rooms").GetInt32());
        Assert.Equal(6_000_000, body.GetProperty("receivableAmount").GetInt64());
        await using var context = factory.CreateDbContext();
        Assert.Equal(2, await context.ReservationUnits.CountAsync());
        Assert.Equal(4, await context.ReservationUnitNights.CountAsync());
        Assert.Equal(6_000_000L, (await context.FolioEntries.SingleAsync()).Amount); // exactly one RoomCharge for the whole reservation
        Assert.Equal(1, await CountAsync("EmailOutboxEvents")); // one event for the whole reservation
        var keys = await context.Database.SqlQueryRaw<string>("""SELECT "EntityKey" AS "Value" FROM "AdminActivities" WHERE "MenuKey" = 'calendar' ORDER BY 1""").ToListAsync();
        Assert.Equal(context.ReservationUnits.Select(unit => unit.Id.ToString("D")).AsEnumerable().Order().ToList(), keys);

        // Read back through the folio and the capacity projection: the rooms are really taken.
        var balance = (await context.FolioEntries.ToListAsync()).Sum(entry => entry.Amount);
        Assert.Equal(6_000_000L, balance);
        Assert.Equal(0, await AvailableRoomsAsync(client, "DLX-KING", nights: 2)); // both Deluxe rooms are taken for both nights
        Assert.Equal(1, await AvailableRoomsAsync(client, "FAMILY", nights: 2));
    }

    [Fact]
    public async Task Refused_requests_write_nothing_and_say_why_with_a_stable_code()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        var token = NewToken();
        var cases = new List<(string Name, HttpResponseMessage Response, HttpStatusCode Status, string Code)>();

        async Task Expect(string name, HttpStatusCode status, string code, Func<Task<HttpResponseMessage>> send) =>
            cases.Add((name, await send(), status, code));

        await Expect("no key", HttpStatusCode.BadRequest, "validation.idempotency-key-required", () => PostAsync(client, null, Body(), token));
        await Expect("long key", HttpStatusCode.BadRequest, "validation.idempotency-key-invalid", () => PostAsync(client, new string('k', 257), Body(), token));
        await Expect("no credential", HttpStatusCode.Unauthorized, "booking.credential-invalid", () => PostAsync(client, "r1", Body()));
        await Expect("bad token", HttpStatusCode.Unauthorized, "booking.credential-invalid", () => PostAsync(client, "r2", Body(), "not-a-token"));
        await Expect("pay online", HttpStatusCode.BadRequest, "validation.payment-method-invalid", () => PostAsync(client, "r3", Body().With("paymentMethod", "PayOnline"), token));
        await Expect("no payment method", HttpStatusCode.BadRequest, "validation.payment-method-invalid", () => PostAsync(client, "r4", Body().Without("paymentMethod"), token));
        await Expect("no expected total", HttpStatusCode.BadRequest, "validation.expected-price-invalid", () => PostAsync(client, "r5", Body().Without("expectedTotalAmount"), token));
        await Expect("no expected currency", HttpStatusCode.BadRequest, "validation.expected-price-invalid", () => PostAsync(client, "r6", Body().Without("expectedCurrencyCode"), token));
        await Expect("bad email", HttpStatusCode.BadRequest, "validation.email-invalid", () => PostAsync(client, "r7", Body(email: "nope"), token));
        await Expect("past date", HttpStatusCode.BadRequest, "validation.check-in-past", () => PostAsync(client, "r8", Body(startOffset: -2), token));
        await Expect("occupancy", HttpStatusCode.BadRequest, "validation.occupancy-exceeds", () => PostAsync(client, "r9", Body(adults: 5), token));
        await Expect("no csrf", HttpStatusCode.BadRequest, "auth.csrf-invalid", () => PostAsync(client, "r10", Body(), token, csrf: false));
        // A money field the route does not define: it can never set what is collected.
        foreach (var field in new[] { "depositAmount", "collectedAmount", "feeAmount", "amountDue", "balanceDueAmount", "depositPercent" })
        {
            await Expect(field, HttpStatusCode.BadRequest, "request.invalid", () => PostAsync(client, "r-" + field, Body().With(field, 1m), token));
        }

        await Expect("unknown room type", HttpStatusCode.NotFound, "booking.selection-not-found", () => PostAsync(client, "r11", Body(roomTypeId: Guid.NewGuid()), token));

        foreach (var (name, response, status, code) in cases)
        {
            Assert.True(status == response.StatusCode, $"{name}: expected {status}, got {response.StatusCode}");
            Assert.True(code == Code(await JsonAsync(response)), $"{name}: wrong code");
        }

        Assert.Equal(NothingWritten, await FootprintAsync());
    }

    [Fact]
    public async Task A_session_and_a_token_together_a_bad_cookie_and_the_wrong_method_are_refused()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        await CreateCustomerAsync(host, client, "direct-both@example.com");

        var both = await PostAsync(client, "both", Body(), NewToken());
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
        Assert.Equal("validation.access-token-with-session", Code(await JsonAsync(both)));

        using var badCookie = host.CreateClient();
        var forged = await PostAsync(badCookie, "forged", Body(), NewToken(), tweak: request => request.Headers.Add("Cookie", ".TheBha.Customer=forged-value"));
        Assert.Equal(HttpStatusCode.Unauthorized, forged.StatusCode);
        Assert.Equal("auth.session-invalid", Code(await JsonAsync(forged))); // never quietly turned into a guest

        foreach (var method in new[] { HttpMethod.Put, HttpMethod.Delete, HttpMethod.Patch })
        {
            using var request = new HttpRequestMessage(method, "/api/v1/reservations") { Content = JsonContent.Create(Body()) };
            Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.SendAsync(request)).StatusCode);
        }

        Assert.Equal(NothingWritten, await FootprintAsync());
    }

    [Fact]
    public async Task A_wrong_expected_price_is_409_with_the_current_quote_and_books_nothing()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();

        var response = await PostAsync(client, "stale-price", Body(total: 1_400_000m), NewToken());

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await JsonAsync(response);
        Assert.Equal("reservation.price-changed", Code(problem));
        var quote = problem.GetProperty("quote");
        Assert.Equal((1_500_000m, "VND"), (quote.GetProperty("totalAmount").GetDecimal(), quote.GetProperty("currencyCode").GetString()));
        Assert.Single(quote.GetProperty("nightlyRates").EnumerateArray());
        Assert.Equal(NothingWritten, await FootprintAsync());

        var wrongCurrency = await PostAsync(client, "stale-currency", Body(currency: "USD"), NewToken());
        Assert.Equal("reservation.price-changed", Code(await JsonAsync(wrongCurrency)));
        Assert.Equal(NothingWritten, await FootprintAsync());
    }

    [Fact]
    public async Task A_price_that_really_changes_between_the_quote_and_the_booking_is_refused_then_booked_at_the_new_price()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        await ExecuteAsync($"""UPDATE "DailyRoomRates" SET "Amount" = 1800000 WHERE "RoomTypeId" = '{DeluxeId}' AND "StayDate" = '{CheckIn:yyyy-MM-dd}' """);

        var stale = await PostAsync(client, "changed-1", Body(total: 1_500_000m), NewToken());
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(1_800_000m, (await JsonAsync(stale)).GetProperty("quote").GetProperty("totalAmount").GetDecimal());
        Assert.Equal(NothingWritten, await FootprintAsync());

        var created = await PostAsync(client, "changed-2", Body(total: 1_800_000m), NewToken());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(1_800_000, (await JsonAsync(created)).GetProperty("receivableAmount").GetInt64());
        Assert.Equal(1_800_000L, await ScalarAsync<long>("""SELECT "Amount" AS "Value" FROM "FolioEntries" """));
    }

    [Fact]
    public async Task A_promotion_prices_the_booking_and_its_snapshot_survives_the_promotion_being_edited_afterwards()
    {
        await SeedAsync(ActivePromotion("giam-20", 20m, [DeluxeId]));
        using var host = Host();
        using var client = host.CreateClient();

        var list = await PostAsync(client, "promo-list", Body(), NewToken()); // the list price is no longer the price
        Assert.Equal(HttpStatusCode.Conflict, list.StatusCode);
        var quote = (await JsonAsync(list)).GetProperty("quote");
        Assert.Equal(1_200_000m, quote.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(300_000m, quote.GetProperty("discountTotalAmount").GetDecimal());

        var created = await PostAsync(client, "promo-final", Body(total: 1_200_000m), NewToken());

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await JsonAsync(created);
        Assert.Equal(1_200_000, body.GetProperty("receivableAmount").GetInt64());
        Assert.Equal(1_500_000m, body.GetProperty("listTotalAmount").GetDecimal());
        Assert.Equal("giam-20", body.GetProperty("appliedPromotion").GetProperty("slug").GetString());
        Assert.Equal(1, await CountAsync("BookingPromotionApplications"));

        await ExecuteAsync("""UPDATE "Promotions" SET "Status" = 'Paused' """);
        await ExecuteAsync("""UPDATE "BookingPromotionApplications" SET "ReservationId" = "ReservationId" """);
        var read = await client.GetAsync(created.Headers.Location);
        Assert.Equal(401, (int)read.StatusCode); // another visitor with no credential
        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.AsNoTracking().Include(r => r.PromotionApplication).SingleAsync();
        Assert.Equal(1_200_000m, reservation.TotalAmount);
        Assert.Equal("giam-20", reservation.PromotionApplication!.Slug);
        Assert.Equal(1_200_000L, (await context.FolioEntries.SingleAsync()).Amount);
    }

    [Fact]
    public async Task A_price_the_folio_cannot_write_is_refused_and_never_rounded()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();

        // A fractional đồng (the rate itself is valid to two decimals).
        await ExecuteAsync($"""UPDATE "DailyRoomRates" SET "Amount" = 1500000.50 WHERE "RoomTypeId" = '{DeluxeId}' AND "StayDate" = '{CheckIn:yyyy-MM-dd}' """);
        var fractional = await PostAsync(client, "fraction", Body(total: 1_500_000.5m), NewToken());
        Assert.Equal(HttpStatusCode.Conflict, fractional.StatusCode);
        Assert.Equal("reservation.amount-unsupported", Code(await JsonAsync(fractional)));

        // A total outside numeric(18,2): refused, not a database overflow.
        await ExecuteAsync($"""UPDATE "DailyRoomRates" SET "Amount" = 9000000000000000 WHERE "RoomTypeId" = '{DeluxeId}' AND "StayDate" IN ('{CheckIn:yyyy-MM-dd}', '{CheckIn.AddDays(1):yyyy-MM-dd}') """);
        var outside = await PostAsync(client, "outside", Body(nights: 2, total: 9_000_000_000_000_000m), NewToken());
        Assert.Equal(HttpStatusCode.Conflict, outside.StatusCode);
        Assert.Equal("reservation.amount-unsupported", Code(await JsonAsync(outside)));

        // Another currency: never converted.
        await ExecuteAsync($"""UPDATE "DailyRoomRates" SET "Amount" = 1500000 WHERE "RoomTypeId" = '{DeluxeId}' """);
        await ExecuteAsync("""UPDATE "RatePlans" SET "CurrencyCode" = 'USD' """);
        var usd = await PostAsync(client, "usd", Body(total: 1_500_000m, currency: "USD"), NewToken());
        Assert.Equal(HttpStatusCode.Conflict, usd.StatusCode);
        Assert.Equal("reservation.amount-unsupported", Code(await JsonAsync(usd)));

        Assert.Equal(NothingWritten, await FootprintAsync());
    }

    [Fact]
    public async Task A_night_that_is_closed_or_sold_out_inside_a_multi_night_request_refuses_the_whole_stay()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        await StopSellAsync(DeluxeId, CheckIn.AddDays(1));

        var response = await PostAsync(client, "closed-middle", Body(nights: 3, total: 4_500_000m), NewToken());

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("reservation.rooms-unavailable", Code(await JsonAsync(response)));
        Assert.Equal(NothingWritten, await FootprintAsync());
        // The nights either side of it are still sellable on their own.
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(client, "first-night", Body(nights: 1), NewToken())).StatusCode);
    }
}

internal static class BodyExtensions
{
    public static Dictionary<string, object?> With(this Dictionary<string, object?> body, string key, object? value)
    {
        body[key] = value;
        return body;
    }

    public static Dictionary<string, object?> Without(this Dictionary<string, object?> body, string key)
    {
        body.Remove(key);
        return body;
    }
}
