using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR06 M-03 and M-04: who may read and write a managed reservation, and what the estimated arrival is allowed to do (store a wall-clock value and nothing else). Real PostgreSQL, fixed clock.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ReservationManagementAccessTests(PostgreSqlWebApplicationFactory factory) : ReservationManagementTestSupport(factory)
{
    private async Task<string> SessionAsync(WebApplicationFactory<Program> host, Guid reservationId)
    {
        var link = await IssueLinkAsync(host, reservationId);
        var exchange = await ExchangeAsync(Https(host), reservationId, link);
        Assert.Equal(HttpStatusCode.OK, exchange.StatusCode);
        return CookieValue(exchange)!;
    }

    [Fact]
    public async Task The_private_read_has_its_own_shape_with_the_folio_balance_and_the_legacy_credentials_still_read_and_cancel_as_before()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, bookingToken) = await BookGuestAsync(host);
        var cookie = CookieHeader(await SessionAsync(host, reservationId));
        using var client = Https(host);

        var read = await GetManageAsync(client, reservationId, cookie);

        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        AssertNoStore(read);
        var body = await JsonAsync(read);
        Assert.Equal("Confirmed", body.GetProperty("status").GetString());
        Assert.Equal("PayAtProperty", body.GetProperty("paymentMethod").GetString());
        Assert.Equal("Recorded", body.GetProperty("ledgerState").GetString());
        Assert.Equal(1_500_000, body.GetProperty("receivableAmount").GetInt64());
        Assert.Equal(0, body.GetProperty("collectedAmount").GetInt64());
        Assert.Equal(1_500_000, body.GetProperty("balanceDueAmount").GetInt64());
        Assert.Equal("Guest Name", body.GetProperty("fullName").GetString());
        Assert.Equal(await ScalarAsync<string>("""SELECT "TimeZone" AS "Value" FROM "Properties" WHERE "Id" = '10000000-0000-0000-0000-000000000001' """), body.GetProperty("propertyTimeZoneId").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("estimatedArrival").ValueKind);
        var raw = body.GetRawText();
        foreach (var forbidden in new[] { "email", "phone", "guestAccessToken", "tokenHash", "sessionHash", "customerAccountId", "fingerprint" })
        {
            Assert.DoesNotContain(forbidden, raw, StringComparison.OrdinalIgnoreCase);
        }

        // M-05: the legacy read keeps its exact shape and its X-Booking-Access-Token contract, and the legacy cancel still works with it.
        using var legacy = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/reservations/{reservationId}");
        legacy.Headers.Add("X-Booking-Access-Token", bookingToken);
        var legacyResponse = await client.SendAsync(legacy);
        Assert.Equal(HttpStatusCode.OK, legacyResponse.StatusCode);
        var legacyBody = await JsonAsync(legacyResponse);
        Assert.False(legacyBody.TryGetProperty("estimatedArrival", out _));
        Assert.False(legacyBody.TryGetProperty("paymentMethod", out _));
        Assert.True(legacyBody.TryGetProperty("email", out _));
        Assert.False(legacyResponse.Headers.Contains("Set-Cookie") && legacyResponse.Headers.GetValues("Set-Cookie").Any(c => c.StartsWith(SessionCookie, StringComparison.Ordinal)));
    }

    [Fact]
    public async Task A_guest_session_opens_only_its_own_reservation_and_never_reveals_whether_another_exists()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (a, _) = await BookGuestAsync(host, "key-a");
        var (b, _) = await BookGuestAsync(host, "key-b", startOffset: 6);
        var cookieA = CookieHeader(await SessionAsync(host, a));
        var untouched = await UntouchedStateAsync();
        using var client = Https(host);

        Assert.Equal(HttpStatusCode.OK, (await GetManageAsync(client, a, cookieA)).StatusCode);

        var refusals = new[]
        {
            await GetManageAsync(client, b, cookieA), // A's session on B
            await GetManageAsync(client, Guid.NewGuid(), cookieA), // A's session on a reservation that does not exist
            await GetManageAsync(client, a), // no credential at all
            await GetManageAsync(client, a, CookieHeader("garbage")), // malformed
            await GetManageAsync(client, a, CookieHeader(NewToken())), // well-formed, unknown
            await SetArrivalAsync(client, b, new { arrivalDate = $"{LocalToday.AddDays(6):yyyy-MM-dd}", arrivalTime = "10:00" }, cookie: cookieA) // A's session writing B
        };
        var bodies = new List<string>();
        foreach (var refusal in refusals)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, refusal.StatusCode);
            AssertNoStore(refusal);
            var problem = await JsonAsync(refusal);
            Assert.Equal("reservation.manage-session-invalid", Code(problem));
            bodies.Add($"{problem.GetProperty("title")}|{problem.GetProperty("detail")}");
        }

        Assert.Single(bodies.Distinct());
        Assert.Equal(0, await CountAsync("ReservationArrivalEstimates"));
        Assert.Equal(untouched, await UntouchedStateAsync());
    }

    [Fact]
    public async Task Only_the_account_that_owns_a_direct_reservation_reaches_it_and_a_hold_sourced_one_is_not_manageable()
    {
        await SeedAsync();
        using var host = ManageHost();
        using var owner = Https(host);
        await CreateCustomerAsync(host, owner, "owner@example.com");
        var booking = await PostAsync(owner, "acct-key", Body());
        Assert.Equal(HttpStatusCode.Created, booking.StatusCode);
        var reservationId = (await JsonAsync(booking)).GetProperty("reservationId").GetGuid();
        using var stranger = Https(host);
        await CreateCustomerAsync(host, stranger, "stranger@example.com");
        using var anonymous = Https(host);
        var checkIn = $"{CheckIn:yyyy-MM-dd}";

        var read = await GetManageAsync(owner, reservationId);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        AssertNoStore(read);
        var write = await SetArrivalAsync(owner, reservationId, new { arrivalDate = checkIn, arrivalTime = "14:00" });
        Assert.Equal(HttpStatusCode.OK, write.StatusCode);

        // Another signed-in account: not found (and the write wrote nothing); nobody signed in and no session: no valid credential.
        Assert.Equal(HttpStatusCode.NotFound, (await GetManageAsync(stranger, reservationId)).StatusCode);
        var strangerWrite = await SetArrivalAsync(stranger, reservationId, new { arrivalDate = checkIn, arrivalTime = "23:00" });
        Assert.Equal(HttpStatusCode.NotFound, strangerWrite.StatusCode);
        Assert.Equal("reservation.not-found", Code(await JsonAsync(strangerWrite)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetManageAsync(anonymous, reservationId)).StatusCode);
        Assert.Equal("14:00", Time(await JsonAsync(await GetManageAsync(owner, reservationId))));

        // A Hold-sourced reservation is outside this resource, even for its own account.
        var hold = await PostHoldAsync(owner, "hold-key", HoldBody(startOffset: 8));
        Assert.Equal(HttpStatusCode.Created, hold.StatusCode);
        var holdId = (await JsonAsync(hold)).GetProperty("holdId").GetGuid();
        var confirmed = await ConfirmAsync(owner, holdId, string.Empty);
        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var holdReservation = (await JsonAsync(confirmed)).GetProperty("reservationId").GetGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await GetManageAsync(owner, holdReservation)).StatusCode);
    }

    [Fact]
    public async Task A_customer_cookie_that_does_not_validate_is_refused_and_never_falls_back_to_the_guest_session()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var session = await SessionAsync(host, reservationId);
        var both = $".TheBha.Customer=garbage; {CookieHeader(session)}";
        using var client = Https(host);

        var read = await GetManageAsync(client, reservationId, both);
        var write = await SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "12:00" }, cookie: both);

        foreach (var response in new[] { read, write })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("auth.session-invalid", Code(await JsonAsync(response)));
            AssertNoStore(response);
        }

        Assert.Equal(0, await CountAsync("ReservationArrivalEstimates"));
        // The same guest session with no bad customer cookie works: it was the cookie, not the session.
        Assert.Equal(HttpStatusCode.OK, (await GetManageAsync(client, reservationId, CookieHeader(session))).StatusCode);
    }

    [Fact]
    public async Task The_estimated_arrival_is_stored_as_the_wall_clock_for_the_check_in_date_or_the_next_day_and_replaces_the_previous_one()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var cookie = CookieHeader(await SessionAsync(host, reservationId));
        var untouched = await UntouchedStateAsync();
        using var client = Https(host);
        var zone = await ScalarAsync<string>("""SELECT "TimeZone" AS "Value" FROM "Properties" WHERE "Id" = '10000000-0000-0000-0000-000000000001' """);

        var evening = await SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "21:30" }, cookie: cookie);

        Assert.Equal(HttpStatusCode.OK, evening.StatusCode);
        AssertNoStore(evening);
        var estimate = (await JsonAsync(evening)).GetProperty("estimatedArrival");
        Assert.Equal($"{CheckIn:yyyy-MM-dd}", estimate.GetProperty("arrivalDate").GetString());
        Assert.Equal("21:30", estimate.GetProperty("arrivalTime").GetString());
        Assert.Equal(zone, estimate.GetProperty("timeZoneId").GetString());
        Assert.Equal(FixedUtc, estimate.GetProperty("updatedAtUtc").GetDateTimeOffset());
        await using (var context = factory.CreateDbContext())
        {
            // Stored exactly as typed: no instant, no conversion through the server's zone.
            var row = await context.ReservationArrivalEstimates.AsNoTracking().SingleAsync();
            Assert.Equal((CheckIn, new TimeOnly(21, 30), zone), (row.ArrivalDate, row.ArrivalTime, row.TimeZoneId));
        }

        // Overnight: the day after check-in, just past midnight, replaces it.
        factory.Clock.UtcNow = FixedUtc.AddMinutes(5);
        var overnight = await SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn.AddDays(1):yyyy-MM-dd}", arrivalTime = "00:15" }, cookie: cookie);
        Assert.Equal(HttpStatusCode.OK, overnight.StatusCode);
        var read = (await JsonAsync(await GetManageAsync(client, reservationId, cookie))).GetProperty("estimatedArrival");
        Assert.Equal($"{CheckIn.AddDays(1):yyyy-MM-dd}", read.GetProperty("arrivalDate").GetString());
        Assert.Equal("00:15", read.GetProperty("arrivalTime").GetString());
        Assert.Equal(FixedUtc.AddMinutes(5), read.GetProperty("updatedAtUtc").GetDateTimeOffset());
        Assert.Equal(1, await CountAsync("ReservationArrivalEstimates"));

        // It is information only: not one hold, status, unit, night, inventory, price, folio, Calendar or outbox row changed.
        Assert.Equal(untouched, await UntouchedStateAsync());
    }

    [Theory]
    [InlineData("2026-7-26", "10:00", "validation.arrival-date-invalid")]
    [InlineData("26/07/2026", "10:00", "validation.arrival-date-invalid")]
    [InlineData(null, "10:00", "validation.arrival-date-invalid")]
    [InlineData("2026-07-26T10:00:00Z", "10:00", "validation.arrival-date-invalid")]
    [InlineData("2026-07-26", "9:30", "validation.arrival-time-invalid")]
    [InlineData("2026-07-26", "21:30:00", "validation.arrival-time-invalid")]
    [InlineData("2026-07-26", "21:30+07:00", "validation.arrival-time-invalid")]
    [InlineData("2026-07-26", "24:00", "validation.arrival-time-invalid")]
    [InlineData("2026-07-26", null, "validation.arrival-time-invalid")]
    [InlineData("2026-07-25", "10:00", "validation.arrival-out-of-window")]
    [InlineData("2026-07-28", "10:00", "validation.arrival-out-of-window")]
    public async Task A_malformed_or_out_of_window_arrival_is_a_400_and_writes_nothing(string? date, string? time, string code)
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host); // check-in 2026-07-26
        var cookie = CookieHeader(await SessionAsync(host, reservationId));
        var untouched = await UntouchedStateAsync();
        using var client = Https(host);

        var response = await SetArrivalAsync(client, reservationId, new { arrivalDate = date, arrivalTime = time }, cookie: cookie);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(code, Code(await JsonAsync(response)));
        AssertNoStore(response);
        Assert.Equal(0, await CountAsync("ReservationArrivalEstimates"));
        Assert.Equal(untouched, await UntouchedStateAsync());
    }

    [Fact]
    public async Task A_field_the_arrival_does_not_define_and_a_missing_antiforgery_token_are_both_400_and_write_nothing()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var cookie = CookieHeader(await SessionAsync(host, reservationId));
        using var client = Https(host);

        var extra = await SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "10:00", timeZone = "UTC" }, cookie: cookie);
        Assert.Equal(HttpStatusCode.BadRequest, extra.StatusCode);
        Assert.Equal("request.invalid", Code(await JsonAsync(extra)));

        var noCsrf = await SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "10:00" }, csrf: false, cookie: cookie);
        Assert.Equal(HttpStatusCode.BadRequest, noCsrf.StatusCode);
        Assert.Equal("auth.csrf-invalid", Code(await JsonAsync(noCsrf)));
        AssertNoStore(noCsrf);
        Assert.Equal(0, await CountAsync("ReservationArrivalEstimates"));
    }

    [Fact]
    public async Task A_cancelled_reservation_can_still_be_read_but_its_arrival_cannot_be_changed()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, bookingToken) = await BookGuestAsync(host);
        var cookie = CookieHeader(await SessionAsync(host, reservationId));
        using var client = Https(host);
        Assert.Equal(HttpStatusCode.OK, (await SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "10:00" }, cookie: cookie)).StatusCode);
        var cancel = await SendAsync(client, HttpMethod.Post, $"/api/v1/reservations/{reservationId}/cancel", new { reason = "changed plans" }, cookie: null, origin: null, csrf: true);
        Assert.Equal(HttpStatusCode.Unauthorized, cancel.StatusCode); // the legacy cancel still needs its own credential

        using var cancelRequest = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/reservations/{reservationId}/cancel") { Content = System.Net.Http.Json.JsonContent.Create(new { reason = "changed plans" }) };
        cancelRequest.Headers.Add("X-Booking-Access-Token", bookingToken);
        var csrf = (await (await client.GetAsync("/api/v1/auth/csrf")).Content.ReadAsStringAsync());
        var pair = JsonSerializer.Deserialize<JsonElement>(csrf);
        cancelRequest.Headers.Add(pair.GetProperty("headerName").GetString()!, pair.GetProperty("token").GetString()!);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(cancelRequest)).StatusCode);
        var untouched = await UntouchedStateAsync();

        var write = await SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "11:00" }, cookie: cookie);

        Assert.Equal(HttpStatusCode.Conflict, write.StatusCode);
        Assert.Equal("reservation.arrival-not-changeable", Code(await JsonAsync(write)));
        AssertNoStore(write);
        var read = await GetManageAsync(client, reservationId, cookie);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        var body = await JsonAsync(read);
        Assert.Equal("Cancelled", body.GetProperty("status").GetString());
        Assert.Equal("10:00", Time(body)); // what was there before the cancellation is kept as it was
        Assert.Equal(untouched, await UntouchedStateAsync());
    }

    [Fact]
    public async Task An_arrival_update_waits_for_the_reservation_transition_lock_and_then_sees_a_cancellation_that_won_it()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var cookie = CookieHeader(await SessionAsync(host, reservationId));
        using var client = Https(host);
        using var stranger = Https(host);

        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var lockCommand = new NpgsqlCommand($"SELECT pg_advisory_xact_lock({BookingAdvisoryLockKeys.ForReservationTransition(reservationId)})", connection, transaction))
        {
            await lockCommand.ExecuteNonQueryAsync();
        }

        var pending = SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "20:00" }, cookie: cookie);
        // A caller with no valid session is refused without ever waiting on the lock: it cannot make anyone queue.
        var refused = await SetArrivalAsync(stranger, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "20:00" }, cookie: CookieHeader(NewToken()));
        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
        await Task.Delay(1500);
        Assert.False(pending.IsCompleted, "the update must wait for the lock a cancellation holds");

        // The cancellation (here: its committed effect) lands while the update waits.
        await using (var cancel = new NpgsqlCommand(
                         """UPDATE "Reservations" SET "Status" = 'Cancelled', "CancelledAtUtc" = "ConfirmedAtUtc" + interval '1 minute', "CancellationReason" = 'raced' WHERE "Id" = @id""", connection, transaction))
        {
            cancel.Parameters.AddWithValue("id", reservationId);
            Assert.Equal(1, await cancel.ExecuteNonQueryAsync());
        }

        await using (var units = new NpgsqlCommand("""UPDATE "ReservationUnits" SET "CommitmentStatus" = 'Cancelled' WHERE "ReservationId" = @id""", connection, transaction))
        {
            units.Parameters.AddWithValue("id", reservationId);
            Assert.Equal(1, await units.ExecuteNonQueryAsync());
        }

        await transaction.CommitAsync();

        var result = await pending;
        Assert.Equal(HttpStatusCode.Conflict, result.StatusCode); // re-read under the lock: the status that won, not the one seen before waiting
        Assert.Equal(0, await CountAsync("ReservationArrivalEstimates"));
    }

    [Fact]
    public async Task An_arrival_update_that_waited_for_the_lock_is_refused_when_the_session_expired_while_it_waited()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var cookie = CookieHeader(await SessionAsync(host, reservationId));
        using var client = Https(host);

        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var lockCommand = new NpgsqlCommand($"SELECT pg_advisory_xact_lock({BookingAdvisoryLockKeys.ForReservationTransition(reservationId)})", connection, transaction))
        {
            await lockCommand.ExecuteNonQueryAsync();
        }

        var pending = SetArrivalAsync(client, reservationId, new { arrivalDate = $"{CheckIn:yyyy-MM-dd}", arrivalTime = "20:00" }, cookie: cookie);
        await Task.Delay(1500);
        Assert.False(pending.IsCompleted);

        factory.Clock.UtcNow = FixedUtc.AddHours(24); // the session's own expiry instant arrives while the request waits
        await transaction.CommitAsync();

        var result = await pending;
        Assert.Equal(HttpStatusCode.Unauthorized, result.StatusCode); // authorization is re-read at the time the lock is won, not at the time the request began
        Assert.Equal(0, await CountAsync("ReservationArrivalEstimates"));
    }
}
