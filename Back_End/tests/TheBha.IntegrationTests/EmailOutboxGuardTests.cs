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
