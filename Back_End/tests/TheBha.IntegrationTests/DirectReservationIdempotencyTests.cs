using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TheBha.Application.Activity;
using TheBha.Application.Notifications;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>BHA-CHECKOUT-001-PR05 D-04, D-05, D-07: a repeat of a request that committed returns that reservation (whatever has changed since), exactly one of everything exists, and a failure before COMMIT leaves nothing.</summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class DirectReservationIdempotencyTests(PostgreSqlWebApplicationFactory factory) : DirectReservationTestSupport(factory)
{
    private const string OneOfEverything =
        "Reservations=1, ReservationUnits=1, ReservationUnitNights=1, ReservationCreationRequests=1, FolioEntries=1, EmailOutboxEvents=1, InventoryHolds=0, BookingPromotionApplications=0, CalendarEvents=1";

    [Fact]
    public async Task The_same_key_owner_and_body_again_is_200_with_the_same_reservation_and_writes_nothing()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        var token = NewToken();
        var created = await PostAsync(client, "same-key", Body(), token);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var createdBody = await JsonAsync(created);

        var replay = await PostAsync(client, "same-key", Body(), token);

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(createdBody.GetRawText(), (await JsonAsync(replay)).GetRawText()); // same shape, same snapshot, same balance
        Assert.Equal(created.Headers.Location, replay.Headers.Location ?? created.Headers.Location);
        Assert.Equal(OneOfEverything, await FootprintAsync());
    }

    [Fact]
    public async Task Two_identical_requests_sent_at_once_make_one_reservation_one_charge_one_event()
    {
        await SeedAsync();
        using var host = Host();
        using var first = host.CreateClient();
        using var second = host.CreateClient();
        var token = NewToken();

        var responses = await Task.WhenAll(PostAsync(first, "race-same", Body(), token), PostAsync(second, "race-same", Body(), token));

        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Created], responses.Select(response => response.StatusCode).Order().ToArray());
        var ids = await Task.WhenAll(responses.Select(async response => (await JsonAsync(response)).GetProperty("reservationId").GetGuid()));
        Assert.Equal(ids[0], ids[1]);
        Assert.Equal(OneOfEverything, await FootprintAsync());
    }

    [Fact]
    public async Task The_same_key_with_another_body_is_a_conflict_and_the_first_reservation_is_unchanged()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        var token = NewToken();
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(client, "key-x", Body(), token)).StatusCode);

        foreach (var changed in new[] { Body(name: "Someone Else"), Body(roomTypeId: FamilyId, total: 2_200_000m), Body(startOffset: 5), Body().With("expectedTotalAmount", 1_500_001m) })
        {
            var conflict = await PostAsync(client, "key-x", changed, token);
            Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
            Assert.Equal("reservation.idempotency-conflict", Code(await JsonAsync(conflict)));
        }

        Assert.Equal(OneOfEverything, await FootprintAsync());
        Assert.Equal("Guest Name", await ScalarAsync<string>("""SELECT "FullName" AS "Value" FROM "Reservations" """));
    }

    [Fact]
    public async Task The_same_key_and_body_under_another_owner_is_a_different_request_and_never_returns_the_first_result()
    {
        await SeedAsync();
        using var host = Host();
        using var guestA = host.CreateClient();
        using var guestB = host.CreateClient();
        using var account = host.CreateClient();
        await CreateCustomerAsync(host, account, "idem-account@example.com");

        // Different nights, so stock is not what is being tested: the same key text must not find another owner's result.
        var a = await JsonAsync(await PostAsync(guestA, "shared-key", Body(startOffset: 3), NewToken()));
        var b = await PostAsync(guestB, "shared-key", Body(startOffset: 3), NewToken());
        var c = await PostAsync(account, "shared-key", Body(roomTypeId: FamilyId, startOffset: 3, total: 2_200_000m));

        // Each owner got a reservation of their own (no 200 replay of A's, no 409): three requests, three reservations (2 Deluxe rooms: the third is a Family room).
        Assert.Equal(HttpStatusCode.Created, b.StatusCode);
        Assert.Equal(HttpStatusCode.Created, c.StatusCode);
        var ids = new[] { a.GetProperty("reservationId").GetGuid(), (await JsonAsync(b)).GetProperty("reservationId").GetGuid(), (await JsonAsync(c)).GetProperty("reservationId").GetGuid() };
        Assert.Equal(3, ids.Distinct().Count());
        Assert.Equal(3, await CountAsync("ReservationCreationRequests"));
    }

    [Fact]
    public async Task A_replay_is_still_served_after_the_price_the_stock_and_both_switches_change_and_never_reprices_or_rewrites()
    {
        await SeedAsync();
        var token = NewToken();
        Guid reservationId;
        using (var host = Host())
        using (var client = host.CreateClient())
        {
            var created = await PostAsync(client, "late-retry", Body(roomTypeId: FamilyId, total: 2_200_000m), token);
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            reservationId = (await JsonAsync(created)).GetProperty("reservationId").GetGuid();
        }

        await ExecuteAsync($"""UPDATE "DailyRoomRates" SET "Amount" = 9999999 WHERE "RoomTypeId" = '{FamilyId}' """); // the price changed
        await StopSellAsync(FamilyId, CheckIn); // and the room is closed (and the only one is sold)
        using var closed = Host(enableDirect: false, settings: ("Booking:AcceptingNewReservations", "false")); // Direct off for the Property and intake stopped
        using var late = closed.CreateClient();

        var replay = await PostAsync(late, "late-retry", Body(roomTypeId: FamilyId, total: 2_200_000m), token);

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var body = await JsonAsync(replay);
        Assert.Equal(reservationId, body.GetProperty("reservationId").GetGuid());
        Assert.Equal(2_200_000m, body.GetProperty("totalAmount").GetDecimal()); // the snapshot, not today's price
        Assert.Equal(2_200_000, body.GetProperty("balanceDueAmount").GetInt64());
        Assert.Equal(OneOfEverything, await FootprintAsync());

        // A NEW request in that state is refused, not replayed.
        var fresh = await PostAsync(late, "brand-new", Body(), NewToken());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, fresh.StatusCode);
        Assert.Equal(OneOfEverything, await FootprintAsync());
    }

    [Fact]
    public async Task A_replay_after_the_reservation_was_cancelled_shows_it_cancelled_and_does_not_make_it_confirmed_again()
    {
        await SeedAsync();
        using var host = Host();
        using var client = host.CreateClient();
        var token = NewToken();
        var created = await PostAsync(client, "then-cancel", Body(), token);
        var id = (await JsonAsync(created)).GetProperty("reservationId").GetGuid();
        using var cancel = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/reservations/{id}/cancel") { Content = JsonContent.Create(new { reason = "Plans changed" }) };
        cancel.Headers.Add("X-Booking-Access-Token", token);
        var csrf = (await (await client.GetAsync("/api/v1/auth/csrf")).Content.ReadFromJsonAsync<Csrf>())!;
        cancel.Headers.Add(csrf.HeaderName, csrf.Token);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(cancel)).StatusCode);

        var replay = await PostAsync(client, "then-cancel", Body(), token);

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal("Cancelled", (await JsonAsync(replay)).GetProperty("status").GetString());
        Assert.Equal("Cancelled", await ScalarAsync<string>("""SELECT "Status" AS "Value" FROM "Reservations" """));
        Assert.Equal("Cancelled", await ScalarAsync<string>("""SELECT "CommitmentStatus" AS "Value" FROM "ReservationUnits" """));
        Assert.Equal(1, await CountAsync("FolioEntries"));
        Assert.Equal(1, await CountAsync("EmailOutboxEvents"));
        Assert.Equal(1, await CountAsync("ReservationCreationRequests"));
    }

    [Fact]
    public async Task A_lost_answer_after_the_commit_is_recovered_by_the_retry_with_the_same_reservation()
    {
        await SeedAsync();
        var lost = new LostAcknowledgement();
        using var host = FaultHost([lost]);
        using var client = host.CreateClient();
        var token = NewToken();

        var first = await PostAsync(client, "lost-answer", Body(), token);

        Assert.Equal(HttpStatusCode.InternalServerError, first.StatusCode); // the client never heard: the real commit happened
        Assert.Equal(OneOfEverything, await FootprintAsync());
        var retry = await PostAsync(client, "lost-answer", Body(), token);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(await ScalarAsync<Guid>("""SELECT "Id" AS "Value" FROM "Reservations" """), (await JsonAsync(retry)).GetProperty("reservationId").GetGuid());
        Assert.Equal(OneOfEverything, await FootprintAsync());
    }

    [Theory]
    [InlineData("INSERT INTO \"FolioEntries\"")]
    [InlineData("INSERT INTO \"EmailOutboxEvents\"")]
    [InlineData("INSERT INTO \"AdminActivities\"")]
    public async Task A_failure_after_the_reservation_is_written_and_before_the_commit_leaves_nothing_and_the_retry_books_once(string failingStatement)
    {
        await SeedAsync();
        var fault = new FailOnce(failingStatement);
        var hint = new CountingHint();
        using var host = FaultHost([fault], hint);
        using var client = host.CreateClient();
        var token = NewToken();

        var failed = await PostAsync(client, "rollback-key", Body(), token);

        Assert.True(fault.Fired, "the injected failure must have run");
        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        Assert.Equal(NothingWritten, await FootprintAsync()); // no Reservation, mapping, charge, event, calendar row, demand
        Assert.Equal(0, hint.Calls); // nothing committed, so nothing is announced
        Assert.Equal(2, await AvailableRoomsAsync(client, "DLX-KING")); // both Deluxe rooms are free again

        var retry = await PostAsync(client, "rollback-key", Body(), token);

        Assert.Equal(HttpStatusCode.Created, retry.StatusCode);
        Assert.Equal(OneOfEverything, await FootprintAsync());
        Assert.Equal(1, hint.Calls); // the hint fires once, after the commit that happened
    }

    [Fact]
    public async Task The_real_worker_calls_no_provider_and_the_event_with_no_handler_stays_pending()
    {
        await SeedAsync();
        var stub = new ResendStub();
        using var host = OutboxTest.Host(factory, stub, settings: new Dictionary<string, string?>
        {
            ["Booking:DirectCheckout:PropertyIds:0"] = PropertyId.ToString(),
            ["Booking:DirectCheckout:RateLimiting:PermitLimit"] = "100000"
        });
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(client, "outbox-key", Body(), NewToken())).StatusCode);

        var batch = await OutboxTest.RunAsync(host.Services);

        Assert.Equal(new EmailOutboxBatchResult(0, 0), batch); // dispatch is on and the provider configured, but the pair has no handler yet (PR07)
        Assert.Empty(stub.CallList);
        Assert.Equal("Pending", await ScalarAsync<string>("""SELECT "Status" AS "Value" FROM "EmailOutboxEvents" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT "FanoutAttempts" AS "Value" FROM "EmailOutboxEvents" """));
        Assert.Equal(0, await CountAsync("EmailOutboxDeliveries"));
    }

    private WebApplicationFactory<Program> FaultHost(IInterceptor[] interceptors, IAdminActivityHint? hint = null) =>
        Host(configure: builder => builder.ConfigureServices(services =>
        {
            services.AddScoped(_ => new TheBhaDbContext(new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(factory.ConnectionString).AddInterceptors(interceptors).Options));
            if (hint is not null)
            {
                services.RemoveAll<IAdminActivityHint>();
                services.AddScoped(_ => hint);
            }
        }));

    private sealed class CountingHint : IAdminActivityHint
    {
        private int _calls;

        public int Calls => _calls;

        public Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            return Task.CompletedTask;
        }
    }

    /// <summary>Throws once, on the first command whose text contains the needle: a database failure in the middle of the booking transaction.</summary>
    private sealed class FailOnce(string needle) : DbCommandInterceptor
    {
        private int _armed = 1;

        public bool Fired { get; private set; }

        private void Check(DbCommand command)
        {
            if (command.CommandText.Contains(needle, StringComparison.Ordinal) && Interlocked.Exchange(ref _armed, 0) == 1)
            {
                Fired = true;
                throw new InvalidOperationException("Injected failure inside the booking transaction.");
            }
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Check(command);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Check(command);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            Check(command);
            return ValueTask.FromResult(result);
        }
    }

    /// <summary>The real COMMIT happens, then the answer is lost (once): what a dropped connection after commit looks like to the caller.</summary>
    private sealed class LostAcknowledgement : DbTransactionInterceptor
    {
        private int _armed = 1;

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Exchange(ref _armed, 0) == 1)
            {
                throw new IOException("Injected lost acknowledgement after the real PostgreSQL commit.");
            }

            return Task.CompletedTask;
        }
    }
}
