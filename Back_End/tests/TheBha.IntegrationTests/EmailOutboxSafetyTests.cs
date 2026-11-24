using System.Net;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Notifications;
using TheBha.Domain.Notifications;
using TheBha.Infrastructure.Persistence.Notifications;
using static TheBha.IntegrationTests.OutboxTest;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR03, E-06: the render contract in use, the backend failure query, what the logs may contain, and the proof that the real host registers no handler, no template and sends nothing.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class EmailOutboxSafetyTests(PostgreSqlWebApplicationFactory factory)
{
    private const string ProviderBodyMarker = "PROVIDER-BODY-MARKER";

    [Fact]
    public async Task E06_the_real_host_registers_no_handler_and_no_template_runs_off_and_queues_nothing()
    {
        var seed = await FreshAsync(factory);
        using var host = factory.WithWebHostBuilder(_ => { });
        await using var scope = host.Services.CreateAsyncScope();
        Assert.Empty(scope.ServiceProvider.GetServices<IEmailOutboxEventHandler>());
        Assert.Empty(scope.ServiceProvider.GetServices<IEmailTemplate>());
        Assert.Equal(0, scope.ServiceProvider.GetRequiredService<EmailTemplateRenderer>().Count);
        var options = scope.ServiceProvider.GetRequiredService<EmailOutboxOptions>();
        Assert.False(options.DispatchEnabled);
        Assert.False(options.WorkerEnabled);
        Assert.False(options.Resend.IsConfigured);
        Assert.Null(scope.ServiceProvider.GetRequiredService<IEmailTransport>().Identity);

        // Even an event somebody queued is left alone by a default host.
        await EnqueueAsync(host.Services, seed.PropertyId);
        Assert.Equal(new EmailOutboxBatchResult(0, 0), await RunAsync(host.Services));
        Assert.Equal(1, await ScalarAsync<long>(factory, """SELECT count(*) FROM "EmailOutboxEvents" WHERE "Status" = 'Pending' AND "FanoutAttempts" = 0 """));
        Assert.Equal(0, await ScalarAsync<long>(factory, """SELECT count(*) FROM "EmailOutboxDeliveries" """));
    }

    [Fact]
    public void E06_only_the_outbox_itself_and_the_Direct_reservation_create_take_the_enqueue_contract()
    {
        var assemblies = new[] { typeof(Program).Assembly, typeof(ResendEmailTransport).Assembly };
        var users = assemblies.SelectMany(a => a.GetTypes())
            .Where(t => t.Namespace?.EndsWith("Persistence.Notifications", StringComparison.Ordinal) != true)
            .Where(t => t.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance).Any(c => c.GetParameters().Any(p => p.ParameterType == typeof(IEmailOutbox)))
                || t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance).Any(f => f.FieldType == typeof(IEmailOutbox)))
            .Select(t => t.FullName).ToList();
        // BHA-CHECKOUT-001-PR05: the Direct create writes ReservationConfirmed in its own transaction; any other business writer must be added here on purpose.
        Assert.Equal(["TheBha.Infrastructure.Persistence.DirectReservationCreationStore"], users);
    }

    [Fact]
    public void E06_the_provider_address_can_be_changed_only_in_Development()
    {
        var error = Assert.ThrowsAny<Exception>(() => factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("Email:Outbox:Resend:BaseUrl", "https://elsewhere.example");
        }).Services);
        Assert.Contains("Email:Outbox:Resend:BaseUrl may be set only in Development", error.ToString());
    }

    [Fact]
    public async Task E06_the_failure_query_is_scoped_to_the_property_limited_and_shows_no_address_text_or_secret()
    {
        var seed = await FreshAsync(factory);
        var stub = new ResendStub
        {
            Script = call => Task.FromResult<ResendStub.Act>(call.To switch
            {
                "reject-a@example.test" or "reject-b@example.test" => new ResendStub.Act.Respond(422, """{"name":"validation_error"}"""),
                "conflict-a@example.test" => new ResendStub.Act.Respond(409, """{"name":"invalid_idempotent_request"}"""),
                _ => new ResendStub.Act.Normal()
            })
        };
        await PendingDeliveriesAsync(factory, seed, new SyntheticHandler { Recipients = ["reject-a@example.test", "conflict-a@example.test", "fine-a@example.test"] }, seed.PropertyId);
        await MoreDeliveriesAsync(new SyntheticHandler { Recipients = ["reject-b@example.test"] }, seed.OtherPropertyId);
        var broken = new SyntheticHandler("test.broken") { Behavior = _ => throw new InvalidOperationException("bug") };
        using var host = Host(factory, stub, settings: new() { ["Email:Outbox:FanoutMaxAttempts"] = "1" }, handlers: broken);
        await EnqueueAsync(host.Services, seed.PropertyId, type: "test.broken");
        await RunAsync(host.Services);
        await using var scope = host.Services.CreateAsyncScope();
        var failures = scope.ServiceProvider.GetRequiredService<IEmailOutboxFailures>();

        var a = await failures.ListAsync(seed.PropertyId, 50, CancellationToken.None);
        var b = await failures.ListAsync(seed.OtherPropertyId, 50, CancellationToken.None);
        Assert.Equal(3, a.Count); // a Failed delivery, a NeedsReconciliation one and a Failed event; the Accepted one is not a failure
        Assert.Equal(["delivery", "delivery", "event"], a.Select(f => f.Kind).Order().ToArray());
        Assert.Contains(a, f => f.Status == EmailOutboxDelivery.StatusNeedsReconciliation && f.LastOutcome == "key-conflict");
        Assert.Contains(a, f => f.Status == EmailOutboxDelivery.StatusFailed && f.LastOutcome == "rejected");
        Assert.Contains(a, f => f.Kind == "event" && f.Status == EmailOutboxEvent.StatusFailed && f.Purpose == "test.broken");
        Assert.Single(b);
        var ids = (await DeliveriesAsync(factory)).Where(d => d.PropertyId == seed.OtherPropertyId).Select(d => d.Id).ToList();
        Assert.Equal(ids, b.Select(f => f.Id).ToList());
        Assert.DoesNotContain(b, f => a.Any(x => x.Id == f.Id));

        Assert.Single(await failures.ListAsync(seed.PropertyId, 1, CancellationToken.None));
        Assert.Single(await failures.ListAsync(seed.PropertyId, 0, CancellationToken.None)); // clamped up to one
        Assert.Equal(3, (await failures.ListAsync(seed.PropertyId, 100_000, CancellationToken.None)).Count); // clamped down, still answers
        Assert.Empty(await failures.ListAsync(Guid.NewGuid(), 50, CancellationToken.None));

        var json = JsonSerializer.Serialize(a.Concat(b));
        foreach (var forbidden in new[] { "@example.test", "reject-a", "reject-b", "conflict-a", "fine-a", "Bearer", ApiKey, SyntheticTemplate.BodyMarker, "Bonjour", "Protected", "subject" })
        {
            Assert.DoesNotContain(forbidden, json, StringComparison.OrdinalIgnoreCase);
        }

        Assert.DoesNotContain(typeof(EmailOutboxFailure).GetProperties(), p => p.Name.Contains("Recipient") || p.Name.Contains("Message") && p.Name != "ProviderMessageId" || p.Name.Contains("Body"));
    }

    [Fact]
    public async Task E06_the_logs_of_a_full_run_with_failures_hold_no_address_message_key_or_provider_answer()
    {
        var seed = await FreshAsync(factory);
        var logs = new CapturingLoggerProvider();
        var stub = new ResendStub
        {
            Script = call => Task.FromResult<ResendStub.Act>(call.To switch
            {
                "five@example.test" => new ResendStub.Act.Respond(500, $$"""{"name":"application_error","message":"{{ProviderBodyMarker}} five@example.test"}"""),
                "unauth@example.test" => new ResendStub.Act.Respond(401, $$"""{"name":"validation_error","message":"{{ProviderBodyMarker}} {{ApiKey}}"}"""),
                "bad@example.test" => new ResendStub.Act.Respond(422, $$"""{"name":"validation_error","message":"{{ProviderBodyMarker}}"}"""),
                _ => new ResendStub.Act.Normal()
            })
        };
        var handler = new SyntheticHandler { Recipients = ["five@example.test", "unauth@example.test", "bad@example.test", "good@example.test"] };
        using var host = Host(factory, stub, logs, handlers: handler);
        await EnqueueAsync(host.Services, seed.PropertyId);
        var broken = new SyntheticHandler("test.broken") { Behavior = _ => throw new InvalidOperationException($"{ProviderBodyMarker} five@example.test") };
        using var brokenHost = Host(factory, stub, logs, handlers: broken);
        await EnqueueAsync(brokenHost.Services, seed.PropertyId, type: "test.broken");
        await RunAsync(host.Services);
        await RunAsync(brokenHost.Services);
        factory.Clock.UtcNow = T0.AddHours(1);
        await RunAsync(host.Services);

        var lines = logs.Lines;
        Assert.Contains(lines, line => line.Contains("api.resend.com", StringComparison.Ordinal)); // the capture works: the HTTP client's own logs are in it
        Assert.Contains(lines, line => line.Contains("is Failed (rejected)", StringComparison.Ordinal)); // an operator sees the id and the code of a final outcome
        foreach (var forbidden in new[] { "example.test", ApiKey, "Bearer", ProviderBodyMarker, SyntheticTemplate.BodyMarker, "Bonjour", "Synthetic" })
        {
            Assert.DoesNotContain(lines, line => line.Contains(forbidden, StringComparison.OrdinalIgnoreCase));
        }
    }

    [Theory]
    [InlineData(200, """{"id":"abc"}""", EmailSendOutcome.Accepted, "accepted")]
    [InlineData(201, """{"id":"abc"}""", EmailSendOutcome.Accepted, "accepted")]
    [InlineData(200, """{}""", EmailSendOutcome.Unknown, "accepted-no-id")]
    [InlineData(200, "not json", EmailSendOutcome.Unknown, "accepted-no-id")]
    [InlineData(400, """{"name":"validation_error"}""", EmailSendOutcome.Permanent, "rejected")]
    [InlineData(422, """{"name":"missing_required_field"}""", EmailSendOutcome.Permanent, "rejected")]
    [InlineData(418, "", EmailSendOutcome.Permanent, "rejected")]
    [InlineData(401, """{"name":"validation_error"}""", EmailSendOutcome.AuthRejected, "provider-refused-access")]
    [InlineData(403, """{"name":"validation_error"}""", EmailSendOutcome.AuthRejected, "provider-refused-access")]
    [InlineData(404, "", EmailSendOutcome.AuthRejected, "provider-refused-access")]
    [InlineData(429, """{"name":"rate_limit_exceeded"}""", EmailSendOutcome.RateLimited, "rate-limited")]
    [InlineData(409, """{"name":"invalid_idempotent_request"}""", EmailSendOutcome.KeyConflict, "key-conflict")]
    [InlineData(409, """{"name":"concurrent_idempotent_requests"}""", EmailSendOutcome.Unknown, "concurrent")]
    [InlineData(409, "", EmailSendOutcome.Unknown, "conflict")]
    [InlineData(408, "", EmailSendOutcome.Unknown, "server-error")]
    [InlineData(500, """{"name":"application_error"}""", EmailSendOutcome.Unknown, "server-error")]
    [InlineData(503, "", EmailSendOutcome.Unknown, "server-error")]
    public async Task E05_the_adapter_classifies_every_answer_as_accepted_retryable_permanent_or_unknown(int status, string body, EmailSendOutcome outcome, string code)
    {
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(status, body)) };
        var result = await Transport(stub).SendAsync(Message(), CancellationToken.None);
        Assert.Equal((outcome, code), (result.Outcome, result.Code));
        if (outcome == EmailSendOutcome.Accepted) Assert.Equal("abc", result.ProviderMessageId);
    }

    [Fact]
    public async Task E05_the_adapter_sends_one_recipient_per_request_with_the_key_and_a_fixed_body_and_reads_retry_after()
    {
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(429, "{}", 42)) };
        var transport = Transport(stub);
        var result = await transport.SendAsync(Message(), CancellationToken.None);
        Assert.Equal(TimeSpan.FromSeconds(42), result.RetryAfter);
        await transport.SendAsync(Message(), CancellationToken.None);

        var calls = stub.CallList;
        Assert.Equal("/emails", calls[0].Path);
        Assert.Equal("POST", calls[0].Method);
        Assert.Equal("key-1", calls[0].IdempotencyKey);
        Assert.Equal($"Bearer {ApiKey}", calls[0].Authorization);
        Assert.Equal(calls[0].Body, calls[1].Body); // the same input is the same bytes
        Assert.Equal(["from", "to", "subject", "html", "text"], calls[0].Json.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(1, calls[0].Json.GetProperty("to").GetArrayLength());
    }

    [Fact]
    public async Task E05_a_network_failure_or_a_timeout_is_unknown_and_only_the_callers_cancellation_escapes()
    {
        var down = new ResendStub { Script = _ => throw new HttpRequestException("network down") };
        Assert.Equal((EmailSendOutcome.Unknown, "no-response"), Pair(await Transport(down).SendAsync(Message(), CancellationToken.None)));

        var hang = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.AcceptThen(ct => Task.Delay(Timeout.Infinite, ct))) };
        Assert.Equal((EmailSendOutcome.Unknown, "no-response"), Pair(await Transport(hang, TimeSpan.FromMilliseconds(300)).SendAsync(Message(), CancellationToken.None)));

        using var stop = new CancellationTokenSource();
        var hang2 = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.AcceptThen(ct => Task.Delay(Timeout.Infinite, ct))) };
        var pending = Transport(hang2).SendAsync(Message(), stop.Token);
        stop.CancelAfter(200);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
    }

    [Fact]
    public void E06_a_secret_never_appears_in_the_pinned_identity()
    {
        var identity = Transport(new ResendStub()).Identity!;
        Assert.DoesNotContain(ApiKey, identity.Fingerprint);
        Assert.Equal(64, identity.Fingerprint.Length);
        Assert.NotEqual(identity.Fingerprint, Transport(new ResendStub(), key: "re_test_another_account_0003").Identity!.Fingerprint);
        Assert.Equal(identity.Fingerprint, Transport(new ResendStub()).Identity!.Fingerprint);
    }

    /// <summary>Fans one more synthetic event out with the provider unconfigured (so nothing is sent yet), next to what already exists.</summary>
    private async Task MoreDeliveriesAsync(SyntheticHandler handler, Guid propertyId)
    {
        using var host = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: handler);
        await EnqueueAsync(host.Services, propertyId);
        await RunAsync(host.Services);
    }

    private static (EmailSendOutcome, string) Pair(EmailSendResult result) => (result.Outcome, result.Code);

    private static EmailSendRequest Message() => new("key-1", "\"BHA\" <noreply@bha-test.example>", "guest@example.test", "Subject", "<p>Html</p>", "Text");

    private static ResendEmailTransport Transport(ResendStub stub, TimeSpan? timeout = null, string key = ApiKey) =>
        new(new HttpClient(stub) { Timeout = timeout ?? TimeSpan.FromSeconds(5) },
            new EmailOutboxOptions { Resend = new ResendOptions { ApiKey = key, FromAddress = "noreply@bha-test.example", FromName = "BHA" } });
}
