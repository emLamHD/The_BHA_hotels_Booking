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

    [Fact]
    public async Task A_guard_that_runs_past_the_lease_cannot_pin_or_send_and_the_next_claim_sends_once()
    {
        var seed = await FreshAsync(factory);
        var delivery = (await PendingDeliveriesAsync(factory, seed, new SyntheticHandler())).Single();
        var stub = new ResendStub();
        var guard = new SlowGuard(factory, TimeSpan.FromMinutes(5)); // the lease is 90 s
        using var host = Host(factory, stub).WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddScoped<IEmailDeliveryPreSendGuard>(_ => guard)));

        var result = await RunAsync(host.Services);

        // Attempt 1 lost its lease inside the guard: nothing was pinned or sent under it. Attempt 2 (a fresh claim) sent the one mail.
        Assert.Equal(2, result.DeliveriesProcessed);
        Assert.Equal(2, guard.Calls);
        var row = await OnlyDeliveryAsync(factory);
        Assert.Equal((EmailOutboxDelivery.StatusAccepted, 2, false), (row.Status, row.Attempts, row.UncertainSend));
        Assert.Equal(delivery.Id, row.Id);
        var call = Assert.Single(stub.CallList);
        Assert.Equal(EmailOutboxSqlKey(delivery.Id), call.IdempotencyKey);
        Assert.Equal(1, stub.DistinctSends);
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
