using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR05 D-03: Direct and Hold are one demand on one inventory. Two independent PostgreSQL transactions contend for the last room; the barrier holds the first one AFTER it has taken its locks
/// (at its first pricing read), the second is started, and the test waits until PostgreSQL itself reports an advisory-lock wait (pg_locks), so the contention is real and not a sleep. One side wins, never both.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class DirectReservationRaceTests(PostgreSqlWebApplicationFactory factory) : DirectReservationTestSupport(factory)
{
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(30);

    [Fact]
    public async Task Two_direct_bookings_for_the_last_room_one_wins_one_is_sold_out_and_demand_never_exceeds_stock()
    {
        await SeedAsync();
        var barrier = new HoldAfterLocks();
        using var host = BarrierHost(barrier);
        using var first = host.CreateClient();
        using var second = host.CreateClient();
        var request = Body(roomTypeId: FamilyId, total: 2_200_000m);

        var a = PostAsync(first, "last-a", request, NewToken());
        await barrier.Reached.WaitAsync(Limit);
        var b = PostAsync(second, "last-b", request, NewToken());
        await WaitForAdvisoryLockWaitAsync();
        barrier.Release();
        var responses = await Task.WhenAll(a, b);

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Conflict], responses.Select(response => response.StatusCode).Order().ToArray());
        Assert.Equal("reservation.rooms-unavailable", Code(await JsonAsync(responses.Single(response => response.StatusCode == HttpStatusCode.Conflict))));
        Assert.Equal(1, await CountAsync("Reservations"));
        Assert.Equal(1, await CountAsync("ReservationUnits"));
        Assert.Equal(1, await CountAsync("FolioEntries"));
        Assert.Equal(1, await CountAsync("EmailOutboxEvents"));
        Assert.Equal(0, await AvailableRoomsAsync(first, "FAMILY"));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_direct_booking_and_a_hold_for_the_last_room_exactly_one_wins_whichever_gets_the_locks_first(bool directHoldsTheLocksFirst)
    {
        await SeedAsync();
        var barrier = new HoldAfterLocks();
        using var host = BarrierHost(barrier);
        using var first = host.CreateClient();
        using var second = host.CreateClient();
        var direct = Body(roomTypeId: FamilyId, total: 2_200_000m);
        var hold = Body(roomTypeId: FamilyId).Without("expectedTotalAmount").Without("expectedCurrencyCode").Without("paymentMethod");

        Task<HttpResponseMessage> StartDirect(HttpClient client) => PostAsync(client, "race-direct", direct, NewToken());
        Task<HttpResponseMessage> StartHold(HttpClient client) => PostHoldAsync(client, "race-hold", hold);

        var a = directHoldsTheLocksFirst ? StartDirect(first) : StartHold(first);
        await barrier.Reached.WaitAsync(Limit);
        var b = directHoldsTheLocksFirst ? StartHold(second) : StartDirect(second);
        await WaitForAdvisoryLockWaitAsync();
        barrier.Release();
        var responses = await Task.WhenAll(a, b);

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Conflict], responses.Select(response => response.StatusCode).Order().ToArray());
        var committed = await CountAsync("Reservations") + await CountAsync("InventoryHolds");
        Assert.Equal(1, committed); // never both
        Assert.Equal(0, await AvailableRoomsAsync(first, "FAMILY"));
    }

    [Fact]
    public async Task An_active_hold_blocks_a_direct_booking_for_its_room_and_can_still_be_confirmed_even_as_the_direct_booking_tries()
    {
        await SeedAsync();
        using var host = Host();
        using var holder = host.CreateClient();
        using var rival = host.CreateClient();
        var hold = Body(roomTypeId: FamilyId).Without("expectedTotalAmount").Without("expectedCurrencyCode").Without("paymentMethod");
        var held = await PostHoldAsync(holder, "hold-first", hold);
        Assert.Equal(HttpStatusCode.Created, held.StatusCode);
        var heldBody = await JsonAsync(held);
        var holdId = heldBody.GetProperty("holdId").GetGuid();
        var holdToken = heldBody.GetProperty("guestAccessToken").GetString()!;

        // The Direct booking is refused while the Hold is Active...
        var refused = await PostAsync(rival, "direct-vs-hold", Body(roomTypeId: FamilyId, total: 2_200_000m), NewToken());
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("reservation.rooms-unavailable", Code(await JsonAsync(refused)));

        // ...and, trying again at the very moment the Hold is confirmed, still cannot take that room, while the confirmation succeeds (the Hold does not block itself).
        var confirm = ConfirmAsync(holder, holdId, holdToken);
        var again = PostAsync(rival, "direct-vs-confirm", Body(roomTypeId: FamilyId, total: 2_200_000m), NewToken());
        var responses = await Task.WhenAll(confirm, again);

        Assert.Equal(HttpStatusCode.Created, responses[0].StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, responses[1].StatusCode);
        Assert.Equal(1, await CountAsync("Reservations"));
        Assert.Equal("Hold", await ScalarAsync<string>("""SELECT "Source" AS "Value" FROM "Reservations" """));
        Assert.Equal(0, await CountAsync("FolioEntries")); // a confirmed Hold writes no charge in this release: unchanged behaviour
        Assert.Equal(0, await CountAsync("EmailOutboxEvents"));
        Assert.Equal(0, await AvailableRoomsAsync(holder, "FAMILY"));
    }

    [Fact]
    public async Task A_direct_booking_and_a_second_room_type_do_not_block_each_other()
    {
        await SeedAsync();
        using var host = Host();
        using var one = host.CreateClient();
        using var two = host.CreateClient();

        var responses = await Task.WhenAll(
            PostAsync(one, "deluxe", Body(), NewToken()),
            PostAsync(two, "family", Body(roomTypeId: FamilyId, total: 2_200_000m), NewToken()));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
        Assert.Equal(2, await CountAsync("Reservations"));
    }

    private WebApplicationFactory<Program> BarrierHost(HoldAfterLocks barrier) =>
        Host(configure: builder => builder.ConfigureServices(services =>
            services.AddScoped(_ => new TheBhaDbContext(new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(factory.ConnectionString).AddInterceptors(barrier).Options))));

    private async Task WaitForAdvisoryLockWaitAsync()
    {
        using var timeout = new CancellationTokenSource(Limit);
        while (await ScalarAsync<long>("""SELECT count(*) AS "Value" FROM pg_locks WHERE locktype = 'advisory' AND NOT granted""") == 0)
        {
            await Task.Delay(50, timeout.Token);
        }
    }

    /// <summary>Pauses the first booking transaction at its first pricing read: by then it holds every lock it needs, so a second one can only wait on them.</summary>
    private sealed class HoldAfterLocks : DbCommandInterceptor
    {
        private readonly TaskCompletionSource _reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _tripped;

        public Task Reached => _reached.Task;

        public void Release() => _released.TrySetResult();

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("FROM \"DailyRoomRates\"", StringComparison.Ordinal) && Interlocked.Exchange(ref _tripped, 1) == 0)
            {
                _reached.TrySetResult();
                await _released.Task.WaitAsync(cancellationToken);
            }

            return result;
        }
    }
}
