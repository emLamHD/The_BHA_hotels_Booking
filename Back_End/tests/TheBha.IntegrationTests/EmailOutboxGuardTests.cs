using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Notifications;
using TheBha.Domain.Notifications;
using static TheBha.IntegrationTests.OutboxTest;

namespace TheBha.IntegrationTests;

/// <summary>BHA-CHECKOUT-001-PR07: the dispatcher's pre-send guard hook, with made-up purposes (the booking guards are covered by <see cref="BookingConfirmationEmailTests"/>).</summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class EmailOutboxGuardTests(PostgreSqlWebApplicationFactory factory)
{
    private sealed class ThrowingGuard : IEmailDeliveryPreSendGuard
    {
        public string Purpose => "notice";

        public Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken) => throw new InvalidOperationException("database fault");
    }

    private sealed class OtherPurposeGuard : IEmailDeliveryPreSendGuard
    {
        public string Purpose => "another-purpose";

        public Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken) => throw new InvalidOperationException("must not run for this purpose");
    }

    [Fact]
    public async Task A_guard_that_cannot_check_gives_the_attempt_back_and_nothing_is_sent_and_other_purposes_are_untouched()
    {
        var seed = await FreshAsync(factory);
        var rows = await PendingDeliveriesAsync(factory, seed, new SyntheticHandler());
        var stub = new ResendStub();
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddScoped<IEmailDeliveryPreSendGuard, ThrowingGuard>();
            services.AddScoped<IEmailDeliveryPreSendGuard, OtherPurposeGuard>();
        }));

        await RunAsync(host.Services);

        Assert.Empty(stub.CallList);
        var row = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusPending, 0, "guard-unavailable"), (row.Status, row.Attempts, row.LastOutcome));
        Assert.Equal(rows.Single().Id, row.Id);
    }

    private sealed class SlowGuard(PostgreSqlWebApplicationFactory factory, TimeSpan takes) : IEmailDeliveryPreSendGuard
    {
        private int _calls;

        public string Purpose => "notice";

        public int Calls => _calls;

        // The first check "takes" longer than the lease (the shared clock moves); later checks are instant.
        public Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _calls) == 1) factory.Clock.UtcNow += takes;
            return Task.FromResult(EmailPreSendVerdict.Send);
        }
    }

    // The lease was lost inside the guard (it took 5 minutes; the lease is 90 s) and nobody reclaimed the delivery: nothing is pinned or sent, and the attempt the claim spent is RETURNED, not burned.
    [Fact]
    public async Task A_guard_that_runs_past_the_lease_returns_the_attempt_and_the_next_claim_sends_once()
    {
        var seed = await FreshAsync(factory);
        var delivery = (await PendingDeliveriesAsync(factory, seed, new SyntheticHandler())).Single();
        var stub = new ResendStub();
        var guard = new SlowGuard(factory, TimeSpan.FromMinutes(5));
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddScoped<IEmailDeliveryPreSendGuard>(_ => guard)));

        await RunAsync(host.Services);

        Assert.Empty(stub.CallList);
        var returned = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusPending, 0, "lease-lost", false), (returned.Status, returned.Attempts, returned.LastOutcome, returned.FirstAttemptAtUtc is not null));
        Assert.Equal(T0.AddMinutes(5).AddSeconds(30), returned.NextAttemptAtUtc); // the retry base, not the longest backoff

        factory.Clock.UtcNow = T0.AddMinutes(6);
        await RunAsync(host.Services);

        var row = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 1, false), (row.Status, row.Attempts, row.UncertainSend));
        var call = Assert.Single(stub.CallList);
        Assert.Equal(EmailOutboxSqlKey(delivery.Id), call.IdempotencyKey);
    }

    /// <summary>A first check that "takes" past the lease, during which ANOTHER worker reclaims and sends the delivery.</summary>
    private sealed class ReclaimedMeanwhileGuard(PostgreSqlWebApplicationFactory factory, TimeSpan takes, Func<Task> otherWorker) : IEmailDeliveryPreSendGuard
    {
        private int _calls;

        public string Purpose => "notice";

        public async Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _calls) == 1)
            {
                factory.Clock.UtcNow += takes;
                await otherWorker();
            }

            return EmailPreSendVerdict.Send;
        }
    }

    // Fencing: if another worker reclaimed the delivery while the guard ran, the first worker neither sends nor touches the row, and it does not return an attempt that is no longer its own.
    [Fact]
    public async Task A_worker_whose_lease_was_reclaimed_during_the_guard_sends_nothing_and_leaves_the_other_workers_row_alone()
    {
        var seed = await FreshAsync(factory);
        var delivery = (await PendingDeliveriesAsync(factory, seed, new SyntheticHandler())).Single();
        var stub = new ResendStub();
        using var other = Host(factory, stub);
        var guard = new ReclaimedMeanwhileGuard(factory, TimeSpan.FromMinutes(5), () => RunAsync(other.Services));
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddScoped<IEmailDeliveryPreSendGuard>(_ => guard)));

        await RunAsync(host.Services);

        var row = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 2, "accepted"), (row.Status, row.Attempts, row.LastOutcome)); // the other worker's attempt, untouched
        var call = Assert.Single(stub.CallList);
        Assert.Equal(EmailOutboxSqlKey(delivery.Id), call.IdempotencyKey);
        Assert.Equal(1, stub.DistinctSends);
    }

    /// <summary>Instant on every check except one, which "takes" <paramref name="takes"/> on the shared clock.</summary>
    private sealed class SlowOnNthGuard(PostgreSqlWebApplicationFactory factory, int slowCall, TimeSpan takes) : IEmailDeliveryPreSendGuard
    {
        private int _calls;

        public string Purpose => "notice";

        public Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _calls) == slowCall) factory.Clock.UtcNow += takes;
            return Task.FromResult(EmailPreSendVerdict.Send);
        }
    }

    [Fact]
    public async Task A_guard_that_carries_a_retry_past_the_idempotency_window_stops_it_for_reconciliation_and_nothing_more_is_sent()
    {
        var seed = await FreshAsync(factory);
        await PendingDeliveriesAsync(factory, seed, new SyntheticHandler());
        var stub = new ResendStub { Script = call => Task.FromResult<ResendStub.Act>(call.Number == 1 ? new ResendStub.Act.Respond(500) : new ResendStub.Act.Normal()) }; // attempt 1: an unknown answer
        var guard = new SlowOnNthGuard(factory, 2, TimeSpan.FromSeconds(15)); // short of the 90 s lease, long enough to cross the window edge
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddScoped<IEmailDeliveryPreSendGuard>(_ => guard)));

        await RunAsync(host.Services);
        Assert.Single(stub.CallList);
        Assert.Equal(EmailOutboxDelivery.StatusPending, (await OnlyDeliveryAsync(factory)).Status);

        // The retry is due 30 s after T0 and passes the window check with 10 s to spare (window 22 h, call timeout 20 s); the guard then takes 15 s: 5 s past the window.
        factory.Clock.UtcNow = T0.AddHours(22).AddSeconds(-30);
        await RunAsync(host.Services);

        Assert.Single(stub.CallList); // the retry was never made
        Assert.Equal(0, stub.DistinctSends); // and the provider holds nothing under that key from us
        var row = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusNeedsReconciliation, "window-expired", 2), (row.Status, row.LastOutcome, row.Attempts));
    }

    // Finding 1: after the guard the lease must outlast the whole provider call (HttpTimeout 20 s), not merely be alive. Lease 90 s; a guard that takes 80 s leaves 10 s.
    // A slow guard (80 s of a 90 s lease) must not make a worker call the provider on a nearly spent lease, nor spend another attempt: pinning renews the lease to a full LeaseSeconds while the claim still owns it.
    [Fact]
    public async Task A_slow_guard_that_leaves_little_lease_gets_the_lease_renewed_and_the_mail_is_sent_once_in_the_same_attempt()
    {
        var seed = await FreshAsync(factory);
        var delivery = (await PendingDeliveriesAsync(factory, seed, new SyntheticHandler())).Single();
        DateTimeOffset? leaseDuringCall = null;
        DateTimeOffset clockDuringCall = default;
        var stub = new ResendStub
        {
            Observe = async _ =>
            {
                leaseDuringCall = (await OnlyDeliveryAsync(factory)).LeaseUntilUtc;
                clockDuringCall = factory.Clock.UtcNow;
            }
        };
        var guard = new SlowGuard(factory, TimeSpan.FromSeconds(80));
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddScoped<IEmailDeliveryPreSendGuard>(_ => guard)));

        await RunAsync(host.Services);

        var row = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 1, false), (row.Status, row.Attempts, row.UncertainSend)); // one attempt, no reclaim
        var call = Assert.Single(stub.CallList);
        Assert.Equal(EmailOutboxSqlKey(delivery.Id), call.IdempotencyKey);
        Assert.NotNull(leaseDuringCall);
        Assert.Equal(T0.AddSeconds(80 + 90), leaseDuringCall); // renewed to a full 90 s from the moment of pinning
        Assert.True(leaseDuringCall > clockDuringCall.AddSeconds(20), "the lease covers the whole provider call");
    }

    /// <summary>Allows with a deadline, after "taking" <paramref name="takes"/> on the shared clock (a slow check).</summary>
    private sealed class DeadlineGuard(PostgreSqlWebApplicationFactory factory, DateTimeOffset deadline, TimeSpan takes) : IEmailDeliveryPreSendGuard
    {
        public string Purpose => "notice";

        public Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken)
        {
            factory.Clock.UtcNow += takes;
            return Task.FromResult(EmailPreSendVerdict.SendUntil(deadline, "too-late"));
        }
    }

    // Finding 2 (the dispatcher half): a deadline the guard set is enforced on a fresh clock right before the provider call.
    [Fact]
    public async Task A_deadline_set_by_the_guard_is_enforced_on_a_fresh_clock_right_before_the_provider_call()
    {
        var seed = await FreshAsync(factory);
        await PendingDeliveriesAsync(factory, seed, new SyntheticHandler());
        var stub = new ResendStub();
        // The call must be over by T0 + 60 s; the check takes 45 s, so with the 20 s call timeout it is too late (65 s) although the lease still has 45 s.
        var guard = new DeadlineGuard(factory, T0.AddSeconds(60), TimeSpan.FromSeconds(45));
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddScoped<IEmailDeliveryPreSendGuard>(_ => guard)));

        await RunAsync(host.Services);

        Assert.Empty(stub.CallList);
        var row = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusFailed, "too-late", 1), (row.Status, row.LastOutcome, row.Attempts)); // nothing was sent, so a plain Failed
    }

    private static string EmailOutboxSqlKey(Guid deliveryId) => "bha-email-" + deliveryId.ToString("N");

    [Fact]
    public async Task Without_a_guard_for_its_purpose_a_delivery_is_sent_exactly_as_before()
    {
        var seed = await FreshAsync(factory);
        await PendingDeliveriesAsync(factory, seed, new SyntheticHandler());
        var stub = new ResendStub();
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddScoped<IEmailDeliveryPreSendGuard, OtherPurposeGuard>()));

        await RunAsync(host.Services);

        Assert.Single(stub.CallList);
        Assert.Equal(EmailOutboxDelivery.StatusAccepted, (await OnlyDeliveryAsync(factory)).Status);
    }
}
