using System.Net.Http;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Notifications;
using TheBha.Domain.Notifications;
using static TheBha.IntegrationTests.OutboxTest;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR03, E-03 (claims, fencing, no transaction across the provider call), E-04 (lost answers, recovery, reconciliation) and E-05 (bounded retry, permanent failures, off and unconfigured). Real PostgreSQL and the
/// real adapter; the provider is <see cref="ResendStub"/>, which records every send it "accepted", and the clock is a mutable test clock.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class EmailOutboxSendTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly Func<CancellationToken, Task> NeverAnswers = ct => Task.Delay(Timeout.Infinite, ct);

    private async Task<(FolioSeed Seed, SyntheticHandler Handler, EmailOutboxDelivery Delivery)> OneAsync(params string[] recipients)
    {
        var seed = await FreshAsync(factory);
        var handler = new SyntheticHandler { Recipients = recipients.Length == 0 ? ["guest@example.test"] : recipients };
        var rows = await PendingDeliveriesAsync(factory, seed, handler);
        return (seed, handler, rows[0]);
    }

    private async Task<EmailOutboxDelivery> ReloadAsync(Guid id)
    {
        await using var context = factory.CreateDbContext();
        return await context.EmailOutboxDeliveries.AsNoTracking().SingleAsync(d => d.Id == id);
    }

    // ------------------------------------------------------------------ E-03

    [Fact]
    public async Task E03_two_independent_workers_compete_and_exactly_one_claims_the_delivery_and_the_provider_sees_one_call()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub();
        var gate = new TaskCompletionSource();
        var arrived = new TaskCompletionSource();
        stub.Script = async _ => { arrived.TrySetResult(); await gate.Task; return new ResendStub.Act.Normal(); };
        using var hostA = Host(factory, stub);
        using var hostB = Host(factory, stub);

        var workerA = RunAsync(hostA.Services);
        await arrived.Task;
        var held = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusSending, 1), (held.Status, held.Attempts)); // A holds it, committed, while the provider has not answered
        Assert.NotNull(held.ClaimId);

        var resultB = await RunAsync(hostB.Services); // B finds nothing due: the lease is alive
        Assert.Equal(new EmailOutboxBatchResult(0, 0), resultB);
        Assert.Single(stub.Calls);

        gate.SetResult();
        Assert.Equal(1, (await workerA).DeliveriesProcessed);
        var done = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 1), (done.Status, done.Attempts));
        Assert.Single(stub.Calls);
        Assert.Equal(1, stub.DistinctSends);
    }

    [Fact]
    public async Task E03_many_workers_over_many_deliveries_send_each_exactly_once()
    {
        var seed = await FreshAsync(factory);
        var recipients = Enumerable.Range(0, 12).Select(i => $"guest{i}@example.test").ToArray();
        await PendingDeliveriesAsync(factory, seed, new SyntheticHandler { Recipients = recipients });
        var stub = new ResendStub();
        using var hosts = new CompositeDisposable(Enumerable.Range(0, 4).Select(_ => Host(factory, stub, settings: new() { ["Email:Outbox:BatchSize"] = "5" })));
        await Task.WhenAll(hosts.Items.Select(host => Task.Run(() => RunAsync(host.Services))));
        await Task.WhenAll(hosts.Items.Select(host => Task.Run(() => RunAsync(host.Services))));

        Assert.Equal(12, stub.Calls.Count);
        Assert.Equal(12, stub.DistinctSends);
        Assert.Equal(12, stub.Calls.Select(c => c.IdempotencyKey).Distinct().Count());
        Assert.All(await DeliveriesAsync(factory), row => Assert.Equal((EmailOutboxDelivery.StatusAccepted, 1), (row.Status, row.Attempts)));
    }

    [Fact]
    public async Task E03_a_worker_whose_lease_was_reclaimed_cannot_finalize_or_retry_over_the_new_workers_result()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub();
        var firstGate = new TaskCompletionSource<int>();
        var firstArrived = new TaskCompletionSource();
        // The FIRST call: the provider receives the message, the answer is held up. Every later call is answered normally.
        stub.Script = call =>
        {
            if (call.Number != 1) return Task.FromResult<ResendStub.Act>(new ResendStub.Act.Normal());
            firstArrived.TrySetResult();
            return Task.FromResult<ResendStub.Act>(new ResendStub.Act.AcceptThen(async _ => { var status = await firstGate.Task; if (status != 200) throw new HttpRequestException("answer lost"); }));
        };
        using var hostA = Host(factory, stub);
        using var hostB = Host(factory, stub);

        var workerA = RunAsync(hostA.Services);
        await firstArrived.Task;
        var claimA = (await ReloadAsync(delivery.Id)).ClaimId;

        factory.Clock.UtcNow = T0.AddMinutes(5); // far past the 90 s lease
        Assert.Equal(1, (await RunAsync(hostB.Services)).DeliveriesProcessed);
        var byB = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 2), (byB.Status, byB.Attempts));
        Assert.Null(byB.ClaimId);
        Assert.NotEqual(claimA, Guid.Empty);

        // A's late answer is a failure the old claim would have turned into "retry later": it must change nothing.
        firstGate.SetResult(500);
        await workerA;
        var final = await ReloadAsync(delivery.Id);
        Assert.Equal(byB.Status, final.Status);
        Assert.Equal(byB.Attempts, final.Attempts);
        Assert.Equal(byB.ProviderMessageId, final.ProviderMessageId);
        Assert.Equal(byB.NextAttemptAtUtc, final.NextAttemptAtUtc);
        Assert.Equal(byB.LastOutcome, final.LastOutcome);
        Assert.Equal(2, stub.Calls.Count);
        Assert.Equal(stub.Calls.First().IdempotencyKey, stub.Calls.Last().IdempotencyKey);
        Assert.Equal(stub.Calls.First().Body, stub.Calls.Last().Body);
        Assert.Equal(1, stub.DistinctSends); // the reclaim sent under the same key: the provider holds one message
    }

    [Fact]
    public async Task E03_the_claim_is_committed_before_the_provider_is_called_and_no_transaction_is_open_during_the_call()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub();
        (string Status, long IdleInTransaction, string? Claim)? seen = null;
        stub.Observe = async _ =>
        {
            seen = (
                await ScalarAsync<string>(factory, $"""SELECT "Status" FROM "EmailOutboxDeliveries" WHERE "Id" = '{delivery.Id}' """), // read on ANOTHER connection: the claim is committed
                await ScalarAsync<long>(factory, $"SELECT count(*) FROM pg_stat_activity WHERE datname = '{factory.DatabaseName}' AND state LIKE 'idle in transaction%'"),
                await ScalarAsync<string>(factory, $"""SELECT "ClaimId"::text FROM "EmailOutboxDeliveries" WHERE "Id" = '{delivery.Id}' """));
        };
        using var host = Host(factory, stub);
        await RunAsync(host.Services);

        Assert.NotNull(seen);
        Assert.Equal(EmailOutboxDelivery.StatusSending, seen!.Value.Status);
        Assert.Equal(0, seen.Value.IdleInTransaction);
        Assert.NotNull(seen.Value.Claim);
        Assert.Single(stub.Calls);
    }

    [Fact]
    public async Task E03_the_first_attempt_time_and_the_pin_are_persisted_before_the_provider_is_called()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub();
        (DateTimeOffset? First, string? Fingerprint, string? From)? seen = null;
        stub.Observe = async _ =>
        {
            await using var context = factory.CreateDbContext();
            var row = await context.EmailOutboxDeliveries.AsNoTracking().SingleAsync(d => d.Id == delivery.Id);
            seen = (row.FirstAttemptAtUtc, row.PinnedFingerprint, row.PinnedFrom);
        };
        using var host = Host(factory, stub);
        await RunAsync(host.Services);

        Assert.Equal(T0, seen!.Value.First);
        Assert.Equal(64, seen.Value.Fingerprint!.Length);
        Assert.DoesNotContain(ApiKey, seen.Value.Fingerprint);
        Assert.Equal($"\"BHA Test\" <{FromAddress}>", seen.Value.From);
    }

    // ------------------------------------------------------------------ E-04

    [Fact]
    public async Task E04_a_provider_that_accepts_and_loses_its_answer_is_retried_with_the_same_key_and_payload_and_records_one_send()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub
        {
            Script = call => Task.FromResult<ResendStub.Act>(call.Number == 1 ? new ResendStub.Act.AcceptThen(_ => throw new HttpRequestException("connection reset")) : new ResendStub.Act.Normal())
        };
        using var host = Host(factory, stub);

        await RunAsync(host.Services);
        var lost = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusPending, 1, "no-response", true), (lost.Status, lost.Attempts, lost.LastOutcome, lost.UncertainSend));
        Assert.Equal(T0.AddSeconds(30), lost.NextAttemptAtUtc);
        Assert.NotNull(lost.ProtectedMessage); // kept: the mail is not known to have left

        factory.Clock.UtcNow = T0.AddSeconds(31);
        await RunAsync(host.Services);

        var done = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 2, true), (done.Status, done.Attempts, done.UncertainSend));
        Assert.Equal(ResendStub.IdFor($"bha-email-{delivery.Id:N}"), done.ProviderMessageId);
        var calls = stub.CallList;
        Assert.Equal(2, calls.Count);
        Assert.Equal(calls[0].IdempotencyKey, calls[1].IdempotencyKey);
        Assert.Equal($"bha-email-{delivery.Id:N}", calls[0].IdempotencyKey);
        Assert.Equal(calls[0].Body, calls[1].Body); // byte-identical, so the provider's replay answered the second
        Assert.Equal(1, stub.DistinctSends);
        Assert.Equal($"Bearer {ApiKey}", calls[0].Authorization);
        Assert.Null(done.ProtectedMessage);
        Assert.Null(done.ProtectedRecipient);
    }

    [Fact]
    public async Task E04_a_provider_timeout_is_an_unknown_outcome_that_is_retried_and_is_not_mistaken_for_a_shutdown()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub
        {
            Script = call => Task.FromResult<ResendStub.Act>(call.Number == 1 ? new ResendStub.Act.AcceptThen(NeverAnswers) : new ResendStub.Act.Normal())
        };
        using var host = Host(factory, stub, settings: new() { ["Email:Outbox:HttpTimeoutSeconds"] = "1", ["Email:Outbox:LeaseSeconds"] = "30" });

        var result = await RunAsync(host.Services); // returns normally: HttpClient.Timeout is not the worker's stopping token
        Assert.Equal(1, result.DeliveriesProcessed);
        var timedOut = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusPending, "no-response", true), (timedOut.Status, timedOut.LastOutcome, timedOut.UncertainSend));

        factory.Clock.UtcNow = T0.AddMinutes(1);
        await RunAsync(host.Services);
        Assert.Equal(EmailOutboxDelivery.StatusAccepted, (await ReloadAsync(delivery.Id)).Status);
        Assert.Equal(1, stub.DistinctSends);
    }

    [Fact]
    public async Task E04_a_worker_stopped_before_it_finalizes_leaves_the_lease_and_the_next_worker_recovers_with_the_same_key()
    {
        var (_, _, delivery) = await OneAsync();
        using var stopping = new CancellationTokenSource();
        var stub = new ResendStub
        {
            Script = call => Task.FromResult<ResendStub.Act>(call.Number == 1
                ? new ResendStub.Act.AcceptThen(ct => { stopping.Cancel(); ct.ThrowIfCancellationRequested(); return Task.CompletedTask; }) // the host shuts down while the answer is on its way
                : new ResendStub.Act.Normal())
        };
        using var host = Host(factory, stub);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => RunAsync(host.Services, stopping.Token));
        var stuck = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusSending, 1), (stuck.Status, stuck.Attempts));
        Assert.Equal(T0.AddSeconds(90), stuck.LeaseUntilUtc);

        Assert.Equal(0, (await RunAsync(host.Services)).DeliveriesProcessed); // lease still alive
        factory.Clock.UtcNow = T0.AddSeconds(91);
        Assert.Equal(1, (await RunAsync(host.Services)).DeliveriesProcessed);

        var done = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 2, true), (done.Status, done.Attempts, done.UncertainSend));
        Assert.Equal(1, stub.DistinctSends);
        Assert.Equal(stub.Calls.First().Body, stub.Calls.Last().Body);
    }

    [Fact]
    public async Task E04_past_the_idempotency_window_nothing_more_is_sent_and_the_delivery_needs_reconciliation()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(500)) };
        using var host = Host(factory, stub, settings: new() { ["Email:Outbox:MaxAttempts"] = "20" });
        await RunAsync(host.Services);
        Assert.Equal(1, stub.Calls.Count);

        // 21h later is inside the 22 h window; the retry may still use the key.
        factory.Clock.UtcNow = T0.AddHours(21);
        await RunAsync(host.Services);
        Assert.Equal(2, stub.Calls.Count);
        Assert.Equal(EmailOutboxDelivery.StatusPending, (await ReloadAsync(delivery.Id)).Status);

        // The provider keeps a key for 24 h; we stop trusting it at 22 h, counted from the FIRST attempt (not the last).
        factory.Clock.UtcNow = T0.AddHours(22).AddMinutes(5);
        await RunAsync(host.Services);
        var held = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusNeedsReconciliation, "window-expired"), (held.Status, held.LastOutcome));
        Assert.Equal(2, stub.Calls.Count); // no third call, and no new key

        factory.Clock.UtcNow = T0.AddDays(3);
        await RunAsync(host.Services);
        Assert.Equal(2, stub.Calls.Count);
        Assert.NotNull(held.ProtectedMessage);
    }

    [Fact]
    public async Task E04_a_retry_in_a_different_account_is_not_sent_and_a_changed_sender_address_does_not_become_a_new_send()
    {
        var (_, _, delivery) = await OneAsync();
        var first = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(503)) };
        using (var host = Host(factory, first)) await RunAsync(host.Services);
        var pinned = await ReloadAsync(delivery.Id);
        Assert.Equal(1, first.Calls.Count);

        // Same account (same key and endpoint), other From settings: the retry keeps the PINNED sender, so the body and the idempotency key are unchanged.
        factory.Clock.UtcNow = T0.AddMinutes(2);
        var sameAccount = new ResendStub();
        using (var host = Host(factory, sameAccount, settings: new() { ["Email:Outbox:Resend:FromAddress"] = "other@bha-test.example", ["Email:Outbox:Resend:FromName"] = "Other" })) await RunAsync(host.Services);
        Assert.Equal(pinned.PinnedFrom, sameAccount.Calls.Single().From);
        Assert.Equal(first.Calls.Single().Body, sameAccount.Calls.Single().Body);
        Assert.Equal(first.Calls.Single().IdempotencyKey, sameAccount.Calls.Single().IdempotencyKey);
        Assert.Equal(EmailOutboxDelivery.StatusAccepted, (await ReloadAsync(delivery.Id)).Status);
    }

    [Fact]
    public async Task E04_a_different_account_or_endpoint_after_an_uncertain_attempt_sends_nothing_and_needs_reconciliation()
    {
        var (_, _, delivery) = await OneAsync();
        using (var host = Host(factory, new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(503)) })) await RunAsync(host.Services);

        factory.Clock.UtcNow = T0.AddMinutes(2);
        var otherAccount = new ResendStub();
        using (var host = Host(factory, otherAccount, settings: new() { ["Email:Outbox:Resend:ApiKey"] = "re_test_a_different_account_0002" })) await RunAsync(host.Services);

        Assert.Empty(otherAccount.Calls); // nothing was sent from the new account, under the old key or a new one
        var held = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusNeedsReconciliation, "account-changed"), (held.Status, held.LastOutcome));
    }

    [Fact]
    public async Task E04_a_payload_conflict_from_the_provider_needs_reconciliation_and_is_never_repeated()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(409, """{"name":"invalid_idempotent_request","message":"x"}""")) };
        using var host = Host(factory, stub);
        await RunAsync(host.Services);
        factory.Clock.UtcNow = T0.AddHours(1);
        await RunAsync(host.Services);
        var held = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusNeedsReconciliation, "key-conflict"), (held.Status, held.LastOutcome));
        Assert.Single(stub.Calls);
    }

    [Fact]
    public async Task E04_a_concurrent_request_answer_is_retried_later_under_the_same_key()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub { Script = call => Task.FromResult<ResendStub.Act>(call.Number == 1 ? new ResendStub.Act.Respond(409, """{"name":"concurrent_idempotent_requests"}""") : new ResendStub.Act.Normal()) };
        using var host = Host(factory, stub);
        await RunAsync(host.Services);
        var waiting = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusPending, "concurrent", true), (waiting.Status, waiting.LastOutcome, waiting.UncertainSend));
        factory.Clock.UtcNow = T0.AddMinutes(1);
        await RunAsync(host.Services);
        Assert.Equal(EmailOutboxDelivery.StatusAccepted, (await ReloadAsync(delivery.Id)).Status);
        Assert.Equal(1, stub.DistinctSends);
    }

    [Fact]
    public async Task E04_when_attempts_run_out_an_unknown_outcome_needs_reconciliation_but_a_known_refusal_is_a_plain_failure()
    {
        var seed = await FreshAsync(factory);
        var rows = await PendingDeliveriesAsync(factory, seed, new SyntheticHandler { Recipients = ["unknown@example.test", "limited@example.test"] });
        var unknown = rows.Single(r => r.RecipientKey == "to:unknown@example.test");
        var limited = rows.Single(r => r.RecipientKey == "to:limited@example.test");
        var stub = new ResendStub { Script = call => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(call.To == "unknown@example.test" ? 500 : 429)) };
        using var host = Host(factory, stub, settings: new() { ["Email:Outbox:MaxAttempts"] = "3" });

        for (var minute = 0; minute < 40; minute += 10)
        {
            factory.Clock.UtcNow = T0.AddMinutes(minute * 10);
            await RunAsync(host.Services);
        }

        var uncertain = await ReloadAsync(unknown.Id);
        var refused = await ReloadAsync(limited.Id);
        Assert.Equal((EmailOutboxDelivery.StatusNeedsReconciliation, "uncertain", 3), (uncertain.Status, uncertain.LastOutcome, uncertain.Attempts));
        Assert.Equal((EmailOutboxDelivery.StatusFailed, "gave-up", 3), (refused.Status, refused.LastOutcome, refused.Attempts));
        Assert.Equal(6, stub.Calls.Count);
    }

    // ------------------------------------------------------------------ E-05

    [Fact]
    public async Task E05_retry_after_is_respected_and_capped_and_the_backoff_is_bounded()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(429, "{}", 600)) };
        using var host = Host(factory, stub);
        await RunAsync(host.Services);
        var limited = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusPending, "rate-limited", false), (limited.Status, limited.LastOutcome, limited.UncertainSend));
        Assert.Equal(T0.AddSeconds(600), limited.NextAttemptAtUtc);

        factory.Clock.UtcNow = T0.AddSeconds(599);
        await RunAsync(host.Services);
        Assert.Single(stub.Calls); // not before Retry-After

        stub.Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(429, "{}", 999_999));
        factory.Clock.UtcNow = T0.AddSeconds(601);
        await RunAsync(host.Services);
        Assert.Equal(T0.AddSeconds(601).AddSeconds(3600), (await ReloadAsync(delivery.Id)).NextAttemptAtUtc); // a huge Retry-After is capped

        stub.Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(500));
        var delays = new List<double>();
        var now = factory.Clock.UtcNow;
        for (var i = 0; i < 2; i++)
        {
            now = (await ReloadAsync(delivery.Id)).NextAttemptAtUtc;
            factory.Clock.UtcNow = now;
            await RunAsync(host.Services);
            delays.Add(((await ReloadAsync(delivery.Id)).NextAttemptAtUtc - now).TotalSeconds);
        }

        Assert.All(delays, delay => Assert.InRange(delay, 30, 1800));
    }

    [Fact]
    public async Task E05_a_permanent_failure_is_final_and_a_transient_one_does_not_block_the_next_delivery()
    {
        var seed = await FreshAsync(factory);
        var rows = await PendingDeliveriesAsync(factory, seed, new SyntheticHandler { Recipients = ["bad@example.test", "slow@example.test", "good@example.test"] });
        var stub = new ResendStub
        {
            Script = call => Task.FromResult<ResendStub.Act>(call.To switch
            {
                "bad@example.test" => new ResendStub.Act.Respond(422, """{"name":"validation_error"}"""),
                "slow@example.test" => new ResendStub.Act.Respond(500),
                _ => new ResendStub.Act.Normal()
            })
        };
        using var host = Host(factory, stub);

        Assert.Equal(3, (await RunAsync(host.Services)).DeliveriesProcessed); // one pass settles all three: the slow one went to the back, it did not hold the queue
        var byRecipient = (await DeliveriesAsync(factory)).ToDictionary(r => r.RecipientKey);
        Assert.Equal((EmailOutboxDelivery.StatusFailed, "rejected", 1), (byRecipient["to:bad@example.test"].Status, byRecipient["to:bad@example.test"].LastOutcome, byRecipient["to:bad@example.test"].Attempts));
        Assert.Equal((EmailOutboxDelivery.StatusPending, 1), (byRecipient["to:slow@example.test"].Status, byRecipient["to:slow@example.test"].Attempts));
        Assert.Equal(EmailOutboxDelivery.StatusAccepted, byRecipient["to:good@example.test"].Status);

        factory.Clock.UtcNow = T0.AddHours(2); // inside the idempotency window
        var before = stub.Calls.Count;
        await RunAsync(host.Services);
        Assert.Single(stub.Calls.Skip(before)); // only the slow one is tried again; the permanent failure never repeats
        Assert.Equal("slow@example.test", stub.Calls.Last().To);
        Assert.Equal(rows.Count, (await DeliveriesAsync(factory)).Count);
    }

    [Fact]
    public async Task E05_a_refusal_of_the_credentials_gives_the_attempt_back_and_waits_without_failing_the_delivery()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(401, """{"name":"validation_error","message":"API key is invalid"}""")) };
        using var host = Host(factory, stub);
        await RunAsync(host.Services);
        var waiting = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusPending, 0, "provider-refused-access"), (waiting.Status, waiting.Attempts, waiting.LastOutcome));
        Assert.Equal(T0.AddSeconds(1800), waiting.NextAttemptAtUtc);
        Assert.Single(stub.Calls);
    }

    [Fact]
    public async Task E05_when_dispatch_is_off_or_the_provider_is_not_configured_nothing_is_claimed_sent_or_counted_and_a_valid_configuration_then_sends()
    {
        var (seed, handler, delivery) = await OneAsync();
        var off = new ResendStub();
        using (var host = Host(factory, off, settings: new() { ["Email:Outbox:DispatchEnabled"] = "false" }))
        {
            Assert.Equal(new EmailOutboxBatchResult(0, 0), await RunAsync(host.Services));
        }

        foreach (var missing in new[] { "Email:Outbox:Resend:ApiKey", "Email:Outbox:Resend:FromAddress" })
        {
            var unconfigured = new ResendStub();
            using var host = Host(factory, unconfigured, settings: new() { [missing] = null });
            Assert.Equal(new EmailOutboxBatchResult(0, 0), await RunAsync(host.Services));
            Assert.Empty(unconfigured.Calls);
        }

        Assert.Empty(off.Calls);
        var untouched = await ReloadAsync(delivery.Id);
        Assert.Equal((EmailOutboxDelivery.StatusPending, 0, null), (untouched.Status, untouched.Attempts, untouched.FirstAttemptAtUtc));

        var configured = new ResendStub();
        using var valid = Host(factory, configured);
        Assert.Equal(1, (await RunAsync(valid.Services)).DeliveriesProcessed);
        Assert.Equal(EmailOutboxDelivery.StatusAccepted, (await ReloadAsync(delivery.Id)).Status);
        Assert.Single(configured.Calls);
        Assert.Equal(0, handler.Calls - 1); // fan-out happened once, in the setup; the sending passes never called the handler again
        _ = seed;
    }

    [Fact]
    public async Task E05_a_host_that_cannot_read_the_stored_message_keeps_the_delivery_and_does_not_spend_an_attempt()
    {
        var (_, _, delivery) = await OneAsync();
        var stub = new ResendStub();
        // Another key ring (a lost one): the protected recipient and message cannot be read.
        using var host = Host(factory, stub, settings: new() { ["DataProtection:KeysPath"] = Path.Combine(Path.GetTempPath(), "bha-dp-other-" + Guid.NewGuid().ToString("N")) });
        try
        {
            await RunAsync(host.Services);
            var kept = await ReloadAsync(delivery.Id);
            Assert.Equal((EmailOutboxDelivery.StatusPending, 0, "payload-unreadable"), (kept.Status, kept.Attempts, kept.LastOutcome));
            Assert.Empty(stub.Calls);
            Assert.Null(kept.FirstAttemptAtUtc);
        }
        finally
        {
            foreach (var directory in Directory.GetDirectories(Path.GetTempPath(), "bha-dp-other-*")) Directory.Delete(directory, true);
        }
    }

    private sealed class CompositeDisposable(IEnumerable<IDisposable> items) : IDisposable
    {
        public IReadOnlyList<Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>> Items { get; } = items.Cast<Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>>().ToList();
        public void Dispose() { foreach (var item in Items) item.Dispose(); }
    }
}
