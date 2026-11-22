using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;
using TheBha.Infrastructure.Persistence;
using static TheBha.IntegrationTests.FolioTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR02 on PostgreSQL: the writer (<see cref="IFolioPosting"/>) and the reader (<see cref="IFolioReader"/>) over the real schema — F-01..F-05, F-08..F-10. Races are made deterministic: one writer holds the
/// per-reservation lock inside an open transaction, the other is started, the test waits until PostgreSQL shows it blocked on that lock, and only then lets the first commit.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class FolioPostingTests(PostgreSqlWebApplicationFactory factory)
{
    [Fact]
    public async Task Charge_payment_refund_reversal_and_fee_give_the_documented_balance_over_the_real_ledger()
    {
        var seed = await SeedFreshAsync();
        var charge = await Ok(Request(seed, FolioEntryKind.RoomCharge, 3_000_000m, "charge:initial"));
        var payment = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:cash:1", actor: FolioActor.Staff(seed.StaffId)));

        Assert.Equal((3_000_000L, 1_000_000L, 2_000_000L), Triple(await BalanceAsync(seed, seed.DirectId)));

        await Ok(Request(seed, FolioEntryKind.Refund, 200_000m, "staff:refund-1", reference: payment.Id, reason: "guest asked"));
        Assert.Equal((3_000_000L, 800_000L, 2_200_000L), Triple(await BalanceAsync(seed, seed.DirectId)));

        // F-02: a gateway fee is on its own and moves neither C nor B.
        await Ok(Request(seed, FolioEntryKind.GatewayFee, 25_000m, "gateway:fee-1", reference: payment.Id, actor: FolioActor.Gateway));
        var withFee = await BalanceAsync(seed, seed.DirectId);
        Assert.Equal((3_000_000L, 800_000L, 2_200_000L, 25_000L), (withFee.ReceivableAmount, withFee.CollectedAmount, withFee.BalanceDueAmount, withFee.GatewayFeeAmount));

        await Ok(Request(seed, FolioEntryKind.RoomChargeReversal, 500_000m, "staff:reversal-1", reference: charge.Id, reason: "one night waived"));
        Assert.Equal((2_500_000L, 800_000L, 1_700_000L), Triple(await BalanceAsync(seed, seed.DirectId)));

        // F-03: a payment above what is owed leaves a negative balance.
        await Ok(Request(seed, FolioEntryKind.Payment, 5_000_000m, "payment:cash:2"));
        var over = await BalanceAsync(seed, seed.DirectId);
        Assert.Equal(-3_300_000L, over.BalanceDueAmount);
        Assert.True(over.IsOverpaid);
    }

    [Fact]
    public async Task A_reservation_without_a_room_charge_is_not_recorded_and_a_wrong_scope_is_not_found()
    {
        var seed = await SeedFreshAsync();
        await Ok(Request(seed, FolioEntryKind.Payment, 700_000m, "payment:only"));

        // F-04: a Reservation that predates the folio, one that only has a Payment, and a non-VND one are all NotRecorded: found, but no amount and no "paid / unpaid".
        foreach (var reservationId in new[] { seed.HoldSourcedId, seed.DirectId, seed.UsdDirectId })
        {
            var balance = await BalanceAsync(seed, reservationId);
            Assert.Equal(LedgerState.NotRecorded, balance.State);
            Assert.Null(balance.ReceivableAmount);
            Assert.Null(balance.CollectedAmount);
            Assert.Null(balance.BalanceDueAmount);
            Assert.Null(balance.GatewayFeeAmount);
        }

        // A Reservation of another Property, or none at all, is "not found", which is a different answer from NotRecorded.
        await using var scope = factory.Services.CreateAsyncScope();
        var reader = scope.ServiceProvider.GetRequiredService<IFolioReader>();
        Assert.Equal(FolioBalanceStatus.ReservationNotFound, (await reader.GetBalanceAsync(seed.OtherPropertyId, seed.DirectId, default)).Status);
        Assert.Equal(FolioBalanceStatus.ReservationNotFound, (await reader.GetBalanceAsync(seed.PropertyId, seed.OtherPropertyDirectId, default)).Status);
        Assert.Equal(FolioBalanceStatus.ReservationNotFound, (await reader.GetBalanceAsync(seed.PropertyId, Guid.NewGuid(), default)).Status);
        Assert.Equal(FolioBalanceStatus.Found, (await reader.GetBalanceAsync(seed.OtherPropertyId, seed.OtherPropertyDirectId, default)).Status);
    }

    [Fact]
    public async Task Hold_sourced_and_direct_reservations_share_the_reader_and_get_equal_balances_for_equal_entries()
    {
        var seed = await SeedFreshAsync();
        foreach (var reservationId in new[] { seed.HoldSourcedId, seed.DirectId })
        {
            var charge = await Ok(Request(seed, FolioEntryKind.RoomCharge, 3_000_000m, "charge:initial", reservation: reservationId));
            var payment = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1", reservation: reservationId));
            await Ok(Request(seed, FolioEntryKind.Refund, 200_000m, "refund:1", reservation: reservationId, reference: payment.Id, reason: "r"));
            await Ok(Request(seed, FolioEntryKind.RoomChargeReversal, 100_000m, "reversal:1", reservation: reservationId, reference: charge.Id, reason: "r"));
        }

        var hold = await BalanceAsync(seed, seed.HoldSourcedId);
        var direct = await BalanceAsync(seed, seed.DirectId);
        Assert.Equal(hold, direct);
        Assert.Equal((2_900_000L, 800_000L, 2_100_000L), Triple(direct));
    }

    [Fact]
    public async Task The_same_key_and_payload_returns_the_stored_entry_and_a_changed_payload_conflicts_leaving_it_unchanged()
    {
        var seed = await SeedFreshAsync();
        var payment = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1"));
        var original = Request(seed, FolioEntryKind.Refund, 200_000m, "staff:refund-1", reference: payment.Id, reason: "guest asked", actor: FolioActor.Staff(seed.StaffId));
        var stored = await Ok(original);

        // Retry (a later server clock, a new generated Id internally): the original entry comes back, nothing is added.
        factory.Clock.UtcNow = factory.Clock.UtcNow.AddHours(2);
        var replay = await PostAsync(original);
        Assert.Equal(FolioPostingStatus.Replayed, replay.Status);
        Assert.Equal((stored.Id, stored.RecordedAtUtc), (replay.Entry!.Id, replay.Entry.RecordedAtUtc));
        // The retry may carry the instant with sub-microsecond ticks and surrounding spaces: it is still the same posting.
        Assert.Equal(FolioPostingStatus.Replayed, (await PostAsync(original with { OccurredAtUtc = original.OccurredAtUtc.AddTicks(3), PostingKey = " staff:refund-1 ", Reason = " guest asked " })).Status);

        var changes = new[]
        {
            original with { Amount = 200_001m },
            original with { Kind = FolioEntryKind.GatewayFee },
            original with { ReferenceEntryId = (await Ok(Request(seed, FolioEntryKind.Payment, 50_000m, "payment:2"))).Id },
            original with { Actor = FolioActor.System },
            original with { Actor = FolioActor.Public },
            original with { Reason = "another reason" },
            original with { OccurredAtUtc = original.OccurredAtUtc.AddSeconds(1) }
        };
        foreach (var changed in changes)
        {
            var result = await PostAsync(changed);
            Assert.Equal(FolioPostingStatus.Conflict, result.Status);
            Assert.Equal(stored.Id, result.Entry!.Id);
        }

        await using var read = factory.CreateDbContext();
        var rows = await read.FolioEntries.AsNoTracking().Where(entry => entry.PostingKey == "staff:refund-1").ToListAsync();
        var row = Assert.Single(rows);
        Assert.Equal((200_000L, FolioEntryKind.Refund, "guest asked", FolioActorKind.Staff, (Guid?)seed.StaffId), (row.Amount, row.Kind, row.Reason, row.ActorKind, row.ActorStaffId));
        Assert.Equal(3, await read.FolioEntries.CountAsync());
    }

    [Fact]
    public async Task Two_writers_of_the_same_key_and_payload_on_two_connections_leave_one_entry_and_the_retry_gets_the_original()
    {
        var seed = await SeedFreshAsync();
        var request = Request(seed, FolioEntryKind.RoomCharge, 3_000_000m, "charge:initial");

        var (first, second) = await RaceAsync(request, request);

        Assert.Equal(FolioPostingStatus.Posted, first.Status);
        Assert.Equal(FolioPostingStatus.Replayed, second.Status);
        Assert.Equal(first.Entry!.Id, second.Entry!.Id);
        Assert.Equal(1, await CountAsync(seed.DirectId));
        Assert.Equal(first.Entry.Id, (await PostAsync(request)).Entry!.Id);
    }

    [Fact]
    public async Task Two_writers_of_the_same_key_with_a_different_amount_leave_the_first_and_the_second_conflicts()
    {
        var seed = await SeedFreshAsync();

        var (first, second) = await RaceAsync(
            Request(seed, FolioEntryKind.RoomCharge, 3_000_000m, "charge:initial"),
            Request(seed, FolioEntryKind.RoomCharge, 3_000_001m, "charge:initial"));

        Assert.Equal((FolioPostingStatus.Posted, FolioPostingStatus.Conflict), (first.Status, second.Status));
        await using var read = factory.CreateDbContext();
        Assert.Equal(3_000_000L, (await read.FolioEntries.AsNoTracking().SingleAsync()).Amount);
    }

    [Fact]
    public async Task Many_unsynchronized_writers_of_one_key_make_exactly_one_entry()
    {
        var seed = await SeedFreshAsync();
        var request = Request(seed, FolioEntryKind.RoomCharge, 3_000_000m, "charge:initial");

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => PostAsync(request)));

        Assert.Equal(1, results.Count(result => result.Status == FolioPostingStatus.Posted));
        Assert.Equal(7, results.Count(result => result.Status == FolioPostingStatus.Replayed));
        Assert.Single(results.Select(result => result.Entry!.Id).Distinct());
        Assert.Equal(1, await CountAsync(seed.DirectId));
    }

    [Fact]
    public async Task A_caller_rollback_after_posting_leaves_no_entry_and_frees_the_lock_and_the_key()
    {
        var seed = await SeedFreshAsync();
        var request = Request(seed, FolioEntryKind.RoomCharge, 3_000_000m, "charge:initial");

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
            await using var transaction = await context.Database.BeginTransactionAsync();
            var posted = await scope.ServiceProvider.GetRequiredService<IFolioPosting>().PostAsync(request, default);
            Assert.Equal(FolioPostingStatus.Posted, posted.Status);
            // The writer joined the caller's transaction: it is still open, nothing is visible to other connections, and the caller sees its own entry.
            Assert.NotNull(context.Database.CurrentTransaction);
            Assert.Equal(0, await CountAsync(seed.DirectId));
            Assert.Equal(1, await context.FolioEntries.AsNoTracking().CountAsync());
            await transaction.RollbackAsync();
        }

        Assert.Equal(0, await CountAsync(seed.DirectId));
        Assert.Equal(0, await WaitingLocksAsync());
        Assert.Equal(FolioPostingStatus.Posted, (await PostAsync(request)).Status);
        Assert.Equal(1, await CountAsync(seed.DirectId));
    }

    [Fact]
    public async Task Several_postings_in_one_caller_transaction_see_each_other_and_commit_only_when_the_caller_does()
    {
        var seed = await SeedFreshAsync();
        await using var scope = factory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var posting = scope.ServiceProvider.GetRequiredService<IFolioPosting>();

        await using (var transaction = await context.Database.BeginTransactionAsync())
        {
            var payment = (await posting.PostAsync(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1"), default)).Entry!;
            // The reference and the quota are read inside the same transaction, so the uncommitted Payment and the first Refund count.
            Assert.Equal(FolioPostingStatus.Posted, (await posting.PostAsync(Request(seed, FolioEntryKind.Refund, 600_000m, "refund:1", reference: payment.Id, reason: "r"), default)).Status);
            Assert.Equal(FolioPostingStatus.QuotaExceeded, (await posting.PostAsync(Request(seed, FolioEntryKind.Refund, 500_000m, "refund:2", reference: payment.Id, reason: "r"), default)).Status);
            Assert.Equal(0, await CountAsync(seed.DirectId));
            await transaction.CommitAsync();
        }

        Assert.Equal(2, await CountAsync(seed.DirectId));
    }

    [Fact]
    public async Task A_transaction_above_read_committed_is_refused_before_any_lock_or_write()
    {
        var seed = await SeedFreshAsync();
        await using var scope = factory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.ServiceProvider.GetRequiredService<IFolioPosting>().PostAsync(Request(seed, FolioEntryKind.RoomCharge, 1m, "k"), default));

        Assert.Equal(0, await context.FolioEntries.AsNoTracking().CountAsync());
    }

    [Fact]
    public async Task A_fractional_zero_or_out_of_range_amount_is_rejected_before_anything_is_written_and_a_large_whole_amount_is_exact()
    {
        var seed = await SeedFreshAsync();

        foreach (var amount in new[] { 1_000_000.5m, 0.5m, 0m, -1m, 9_223_372_036_854_775_808m, decimal.MaxValue })
        {
            await Assert.ThrowsAsync<DomainException>(() => PostAsync(Request(seed, FolioEntryKind.RoomCharge, amount, "bad")));
        }

        await Assert.ThrowsAsync<DomainException>(() => PostAsync(Request(seed, FolioEntryKind.RoomCharge, 1m, "usd", currency: "USD")));
        await Assert.ThrowsAsync<DomainException>(() => PostAsync(Request(seed, FolioEntryKind.RoomCharge, 1m, "   ")));
        await Assert.ThrowsAsync<DomainException>(() => PostAsync(Request(seed, FolioEntryKind.Payment, 1m, "staff-less") with { Actor = default, Reason = new string('r', 501) }));
        Assert.Equal(0, await CountAsync(seed.DirectId));

        // The largest amount the domain can hold, a decimal with a harmless ".00", and the largest bigint: stored and summed exactly.
        var charge = await Ok(Request(seed, FolioEntryKind.RoomCharge, 9_999_999_999_999_999.00m, "charge:big"));
        Assert.Equal(9_999_999_999_999_999L, charge.Amount);
        await Ok(Request(seed, FolioEntryKind.Payment, 9_223_372_036_854_775_807m, "payment:max"));
        var balance = await BalanceAsync(seed, seed.DirectId);
        Assert.Equal((9_999_999_999_999_999L, 9_223_372_036_854_775_807L, -9_213_372_036_854_775_808L), Triple(balance));
    }

    [Fact]
    public async Task A_reference_must_exist_in_this_reservation_with_the_kind_the_entry_needs()
    {
        var seed = await SeedFreshAsync();
        var charge = await Ok(Request(seed, FolioEntryKind.RoomCharge, 1_000_000m, "charge:initial"));
        var payment = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1"));
        var elsewhere = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1", reservation: seed.HoldSourcedId));

        Assert.Equal(FolioPostingStatus.InvalidReference, (await PostAsync(Request(seed, FolioEntryKind.RoomChargeReversal, 1m, "v1", reference: payment.Id, reason: "r"))).Status);
        Assert.Equal(FolioPostingStatus.InvalidReference, (await PostAsync(Request(seed, FolioEntryKind.Refund, 1m, "v2", reference: charge.Id, reason: "r"))).Status);
        Assert.Equal(FolioPostingStatus.InvalidReference, (await PostAsync(Request(seed, FolioEntryKind.GatewayFee, 1m, "v3", reference: charge.Id))).Status);
        Assert.Equal(FolioPostingStatus.InvalidReference, (await PostAsync(Request(seed, FolioEntryKind.Refund, 1m, "v4", reference: elsewhere.Id, reason: "r"))).Status);
        Assert.Equal(FolioPostingStatus.InvalidReference, (await PostAsync(Request(seed, FolioEntryKind.Refund, 1m, "v5", reference: Guid.NewGuid(), reason: "r"))).Status);
        Assert.Equal(2, await CountAsync(seed.DirectId));
    }

    [Fact]
    public async Task A_missing_reservation_a_wrong_property_and_a_non_VND_reservation_get_no_entry()
    {
        var seed = await SeedFreshAsync();

        Assert.Equal(FolioPostingStatus.ReservationNotFound, (await PostAsync(Request(seed, FolioEntryKind.RoomCharge, 1m, "k", reservation: Guid.NewGuid()))).Status);
        Assert.Equal(FolioPostingStatus.ReservationNotFound, (await PostAsync(Request(seed, FolioEntryKind.RoomCharge, 1m, "k", property: seed.OtherPropertyId))).Status);
        Assert.Equal(FolioPostingStatus.ReservationNotVnd, (await PostAsync(Request(seed, FolioEntryKind.RoomCharge, 1m, "k", reservation: seed.UsdDirectId))).Status);
        Assert.Equal(0, await ScalarAsync<long>(factory.ConnectionString, """SELECT count(*) FROM "FolioEntries" """));
    }

    [Fact]
    public async Task Refunds_and_reversals_cannot_exceed_what_they_reduce_and_a_replay_still_works_when_the_quota_is_used_up()
    {
        var seed = await SeedFreshAsync();
        var charge = await Ok(Request(seed, FolioEntryKind.RoomCharge, 1_000_000m, "charge:initial"));
        var payment = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1"));
        var refund = Request(seed, FolioEntryKind.Refund, 600_000m, "refund:1", reference: payment.Id, reason: "r");
        var reversal = Request(seed, FolioEntryKind.RoomChargeReversal, 600_000m, "reversal:1", reference: charge.Id, reason: "r");
        await Ok(refund);
        await Ok(reversal);

        Assert.Equal(FolioPostingStatus.QuotaExceeded, (await PostAsync(refund with { PostingKey = "refund:2", Amount = 400_001m })).Status);
        Assert.Equal(FolioPostingStatus.QuotaExceeded, (await PostAsync(reversal with { PostingKey = "reversal:2", Amount = 400_001m })).Status);
        // Replay is decided before the quota: the first refund, retried now that 600.000 of 1.000.000 is used, is still the same posting.
        Assert.Equal(FolioPostingStatus.Replayed, (await PostAsync(refund)).Status);
        // Exactly the remainder is allowed; one more đồng is not. A fee has no quota.
        Assert.Equal(FolioPostingStatus.Posted, (await PostAsync(refund with { PostingKey = "refund:3", Amount = 400_000m })).Status);
        Assert.Equal(FolioPostingStatus.QuotaExceeded, (await PostAsync(refund with { PostingKey = "refund:4", Amount = 1m })).Status);
        Assert.Equal(FolioPostingStatus.Posted, (await PostAsync(Request(seed, FolioEntryKind.GatewayFee, 2_000_000m, "fee:1", reference: payment.Id))).Status);
        Assert.Equal(FolioPostingStatus.Posted, (await PostAsync(Request(seed, FolioEntryKind.GatewayFee, 1m, "fee:2", reference: payment.Id))).Status);
    }

    [Fact]
    public async Task Two_refund_writers_on_two_connections_that_together_exceed_the_payment_make_exactly_one_refund()
    {
        var seed = await SeedFreshAsync();
        var payment = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1"));

        var (first, second) = await RaceAsync(
            Request(seed, FolioEntryKind.Refund, 600_000m, "refund:a", reference: payment.Id, reason: "a"),
            Request(seed, FolioEntryKind.Refund, 600_000m, "refund:b", reference: payment.Id, reason: "b"));

        Assert.Equal((FolioPostingStatus.Posted, FolioPostingStatus.QuotaExceeded), (first.Status, second.Status));
        Assert.Equal(600_000L, await SumAsync(seed.DirectId, "Refund"));
    }

    [Fact]
    public async Task Two_reversal_writers_on_two_connections_that_together_exceed_the_charge_make_exactly_one_reversal()
    {
        var seed = await SeedFreshAsync();
        var charge = await Ok(Request(seed, FolioEntryKind.RoomCharge, 1_000_000m, "charge:initial"));

        var (first, second) = await RaceAsync(
            Request(seed, FolioEntryKind.RoomChargeReversal, 600_000m, "reversal:a", reference: charge.Id, reason: "a"),
            Request(seed, FolioEntryKind.RoomChargeReversal, 600_000m, "reversal:b", reference: charge.Id, reason: "b"));

        Assert.Equal((FolioPostingStatus.Posted, FolioPostingStatus.QuotaExceeded), (first.Status, second.Status));
        Assert.Equal(600_000L, await SumAsync(seed.DirectId, "RoomChargeReversal"));
    }

    [Fact]
    public async Task Many_unsynchronized_refund_writers_never_refund_more_than_the_payment()
    {
        var seed = await SeedFreshAsync();
        var payment = await Ok(Request(seed, FolioEntryKind.Payment, 1_000_000m, "payment:1"));

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(index =>
            PostAsync(Request(seed, FolioEntryKind.Refund, 400_000m, $"refund:{index}", reference: payment.Id, reason: "r"))));

        Assert.Equal(2, results.Count(result => result.Status == FolioPostingStatus.Posted));
        Assert.Equal(4, results.Count(result => result.Status == FolioPostingStatus.QuotaExceeded));
        Assert.Equal(800_000L, await SumAsync(seed.DirectId, "Refund"));
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    private async Task<FolioSeed> SeedFreshAsync()
    {
        await factory.ResetDatabaseAsync();
        return await SeedAsync(factory.CreateDbContext);
    }

    private static FolioPostingRequest Request(
        FolioSeed seed,
        FolioEntryKind kind,
        decimal amount,
        string key,
        Guid? reservation = null,
        Guid? property = null,
        Guid? reference = null,
        string? reason = null,
        FolioActor? actor = null,
        string currency = "VND") =>
        new(property ?? seed.PropertyId, reservation ?? seed.DirectId, kind, amount, currency, key, reference, actor ?? FolioActor.System, reason, Now);

    private async Task<FolioPostingResult> PostAsync(FolioPostingRequest request)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IFolioPosting>().PostAsync(request, default);
    }

    private async Task<FolioEntry> Ok(FolioPostingRequest request)
    {
        var result = await PostAsync(request);
        Assert.Equal(FolioPostingStatus.Posted, result.Status);
        return result.Entry!;
    }

    private async Task<ReservationBalance> BalanceAsync(FolioSeed seed, Guid reservationId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var result = await scope.ServiceProvider.GetRequiredService<IFolioReader>().GetBalanceAsync(seed.PropertyId, reservationId, default);
        Assert.Equal(FolioBalanceStatus.Found, result.Status);
        return result.Balance!;
    }

    private static (long? Receivable, long? Collected, long? Due) Triple(ReservationBalance balance) =>
        (balance.ReceivableAmount, balance.CollectedAmount, balance.BalanceDueAmount);

    private Task<long> CountAsync(Guid reservationId) =>
        ScalarAsync<long>(factory.ConnectionString, $"""SELECT count(*) FROM "FolioEntries" WHERE "ReservationId" = '{reservationId}'""");

    private Task<long> SumAsync(Guid reservationId, string kind) =>
        ScalarAsync<long>(factory.ConnectionString, $"""SELECT coalesce(sum("Amount"), 0)::bigint FROM "FolioEntries" WHERE "ReservationId" = '{reservationId}' AND "Kind" = '{kind}'""");

    private Task<long> WaitingLocksAsync() =>
        ScalarAsync<long>(factory.ConnectionString, "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");

    /// <summary>
    /// Writer A posts inside an open transaction and so holds the reservation lock. Writer B is then started on its own connection and the test waits until PostgreSQL reports a ungranted advisory lock, i.e. B is
    /// really queued behind A. Only then does A commit. A's and B's results come back in that order.
    /// </summary>
    private async Task<(FolioPostingResult First, FolioPostingResult Second)> RaceAsync(FolioPostingRequest first, FolioPostingRequest second)
    {
        await using var scopeA = factory.Services.CreateAsyncScope();
        var contextA = scopeA.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        await using var transactionA = await contextA.Database.BeginTransactionAsync();
        var resultA = await scopeA.ServiceProvider.GetRequiredService<IFolioPosting>().PostAsync(first, default);

        var secondTask = Task.Run(() => PostAsync(second));
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (await WaitingLocksAsync() == 0)
        {
            Assert.True(DateTime.UtcNow < deadline, "The second writer never queued behind the first one's lock.");
            Assert.False(secondTask.IsCompleted, "The second writer finished without waiting for the lock.");
            await Task.Delay(25);
        }

        await transactionA.CommitAsync();
        return (resultA, await secondTask);
    }
}
