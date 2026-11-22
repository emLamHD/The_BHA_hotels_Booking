using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using TheBha.Application.Notifications;
using TheBha.Domain.Notifications;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Notifications;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR03: a stand-in for Resend's <c>POST /emails</c>, installed as the PRIMARY handler of the adapter's own HttpClient, so the real request building, timeout and answer parsing run; only the network is replaced.
/// It enforces what the provider documents: the same Idempotency-Key with the same body answers the first result WITHOUT recording a second send, the same key with another body is a 409 invalid_idempotent_request. It records
/// every call and every send it "accepted" (<see cref="DistinctSends"/> is the proof that a lost answer never became a second mail). No real address, key or network is involved.
/// </summary>
public sealed class ResendStub : HttpMessageHandler
{
    public sealed record Call(int Number, string Method, string Path, string? IdempotencyKey, string Body, string? Authorization)
    {
        public JsonElement Json => JsonDocument.Parse(Body).RootElement;
        public string To => Json.GetProperty("to")[0].GetString()!;
        public string From => Json.GetProperty("from").GetString()!;
    }

    /// <summary>What the stub does with one call.</summary>
    public abstract record Act
    {
        /// <summary>The documented behavior.</summary>
        public sealed record Normal : Act;

        /// <summary>Answers without recording a send (a refusal).</summary>
        public sealed record Respond(int Status, string Json = "{}", int? RetryAfterSeconds = null) : Act;

        /// <summary>The provider RECEIVES the message (recorded), then <see cref="After"/> runs: it may hang, throw or wait for a gate, which is a lost or late answer.</summary>
        public sealed record AcceptThen(Func<CancellationToken, Task> After) : Act;
    }

    private readonly ConcurrentDictionary<string, (string Body, string Id)> _accepted = new();
    private int _number;

    public ConcurrentQueue<Call> Calls { get; } = new();

    /// <summary>The messages the provider holds: one per distinct idempotency key.</summary>
    public int DistinctSends => _accepted.Count;

    public IReadOnlyList<Call> CallList => Calls.ToList();

    /// <summary>Decides per call; null means <see cref="Act.Normal"/>.</summary>
    public Func<Call, Task<Act>>? Script { get; set; }

    /// <summary>Runs first on every call, before anything else (a test inspects the database from here).</summary>
    public Func<Call, Task>? Observe { get; set; }

    public static string IdFor(string key) => "re_stub_" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)))[..12].ToLowerInvariant();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        request.Headers.TryGetValues("Idempotency-Key", out var keys);
        var call = new Call(Interlocked.Increment(ref _number), request.Method.Method, request.RequestUri!.AbsolutePath, keys?.SingleOrDefault(), body, request.Headers.Authorization?.ToString());
        Calls.Enqueue(call);
        if (Observe is not null) await Observe(call);
        var act = Script is null ? new Act.Normal() : await Script(call);
        switch (act)
        {
            case Act.Respond respond:
                var refused = Reply(respond.Status, respond.Json);
                if (respond.RetryAfterSeconds is { } seconds) refused.Headers.TryAddWithoutValidation("Retry-After", seconds.ToString());
                return refused;
            case Act.AcceptThen later:
                Accept(call);
                await later.After(cancellationToken);
                return Reply(200, JsonSerializer.Serialize(new { id = IdFor(call.IdempotencyKey!) }));
            default:
                if (call.IdempotencyKey is null || call.Path != "/emails") return Reply(400, """{"name":"validation_error"}""");
                if (_accepted.TryGetValue(call.IdempotencyKey, out var first))
                {
                    return first.Body == call.Body ? Reply(200, JsonSerializer.Serialize(new { id = first.Id })) : Reply(409, """{"name":"invalid_idempotent_request","message":"payload differs"}""");
                }

                Accept(call);
                return Reply(200, JsonSerializer.Serialize(new { id = IdFor(call.IdempotencyKey) }));
        }
    }

    private void Accept(Call call) => _accepted.TryAdd(call.IdempotencyKey!, (call.Body, IdFor(call.IdempotencyKey!)));

    private static HttpResponseMessage Reply(int status, string json) => new((HttpStatusCode)status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
}

/// <summary>A handler for a made-up event type (the real ones belong to PR07). Counts its calls; recipients and behavior are set by the test.</summary>
public sealed class SyntheticHandler(string eventType = "test.synthetic", int schemaVersion = 1) : IEmailOutboxEventHandler
{
    private int _calls;
    public string EventType => eventType;
    public int SchemaVersion => schemaVersion;
    public int Calls => _calls;
    public string[] Recipients { get; set; } = ["guest@example.test"];
    public string Purpose { get; set; } = "notice";
    public string Locale { get; set; } = "fr";
    public Func<EmailOutboxEventContext, IReadOnlyList<EmailDeliveryDraft>>? Behavior { get; set; }

    public Task<IReadOnlyList<EmailDeliveryDraft>> HandleAsync(EmailOutboxEventContext context, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _calls);
        IReadOnlyList<EmailDeliveryDraft> drafts = Behavior is not null
            ? Behavior(context)
            : Recipients.Select(recipient => new EmailDeliveryDraft(Purpose, "to:" + recipient, recipient, Locale, SyntheticTemplate.Key, new Dictionary<string, string> { ["name"] = "Synthetic" })).ToList();
        return Task.FromResult(drafts);
    }
}

public sealed class SyntheticTemplate : IEmailTemplate
{
    public const string Key = "test.synthetic.notice";
    public const string BodyMarker = "BODY-MARKER";

    string IEmailTemplate.Key => Key;
    public string DefaultLocale => "en";

    public IReadOnlyDictionary<string, EmailTemplateText> Locales { get; } = new[] { ("vi", "Xin chao"), ("en", "Hello"), ("fr", "Bonjour") }
        .ToDictionary(pair => pair.Item1, pair => new EmailTemplateText($"[{pair.Item1}] {pair.Item2} {{{{name}}}}", $"{BodyMarker} {pair.Item1} {{{{name}}}}", $"<p>{BodyMarker} {pair.Item1} {{{{name}}}}</p>"));
}

internal static class OutboxTest
{
    public static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-22T00:00:00Z");
    public const string ApiKey = "re_test_key_not_a_real_secret_0001";
    public const string FromAddress = "noreply@bha-test.example";

    /// <summary>A fresh database content, the clock at <see cref="T0"/>, and two Properties (the events' foreign key).</summary>
    public static async Task<FolioSeed> FreshAsync(PostgreSqlWebApplicationFactory factory)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = T0;
        return await FolioTestSupport.SeedAsync(factory.CreateDbContext);
    }

    /// <summary>
    /// A host of the real application whose outbox is on and whose provider is the stub, unless a test says otherwise. Its timer is off (the factory sets it), so the test drives the dispatcher by hand.
    /// <paramref name="settings"/> override or add <c>Email:Outbox:*</c> keys; a null value removes a default.
    /// </summary>
    public static WebApplicationFactory<Program> Host(
        PostgreSqlWebApplicationFactory factory, ResendStub stub, CapturingLoggerProvider? logs = null, Dictionary<string, string?>? settings = null, params IEmailOutboxEventHandler[] handlers)
    {
        var values = new Dictionary<string, string?>
        {
            ["Email:Outbox:DispatchEnabled"] = "true",
            ["Email:Outbox:Resend:ApiKey"] = ApiKey,
            ["Email:Outbox:Resend:FromAddress"] = FromAddress,
            ["Email:Outbox:Resend:FromName"] = "BHA Test"
        };
        foreach (var (key, value) in settings ?? []) values[key] = value;
        return factory.WithWebHostBuilder(builder =>
        {
            foreach (var (key, value) in values)
            {
                if (value is not null) builder.UseSetting(key, value);
            }

            if (logs is not null) builder.ConfigureLogging(logging => { logging.SetMinimumLevel(LogLevel.Trace); logging.AddProvider(logs); });
            builder.ConfigureServices(services =>
            {
                services.AddHttpClient(ResendEmailTransport.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => stub);
                services.AddSingleton<IEmailTemplate, SyntheticTemplate>();
                foreach (var handler in handlers) services.AddSingleton(handler);
            });
        });
    }

    public static async Task<EmailOutboxBatchResult> RunAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IEmailOutboxDispatcher>().ProcessBatchAsync(cancellationToken);
    }

    /// <summary>Queues an event in its own committed transaction.</summary>
    public static async Task<EmailOutboxEnqueueStatus> EnqueueAsync(IServiceProvider services, Guid propertyId, Guid? eventId = null, string type = "test.synthetic", int version = 1, string? payload = null)
    {
        await using var scope = services.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        await using var transaction = await database.Database.BeginTransactionAsync();
        var status = await scope.ServiceProvider.GetRequiredService<IEmailOutbox>().EnqueueAsync(
            new EmailOutboxEventRequest(eventId ?? Guid.NewGuid(), type, version, propertyId, payload ?? """{"reservationId":"00000000-0000-0000-0000-0000000000aa"}"""), CancellationToken.None);
        await transaction.CommitAsync();
        return status;
    }

    public static async Task<List<EmailOutboxDelivery>> DeliveriesAsync(PostgreSqlWebApplicationFactory factory)
    {
        await using var context = factory.CreateDbContext();
        return await context.EmailOutboxDeliveries.AsNoTracking().OrderBy(d => d.CreatedAtUtc).ThenBy(d => d.Id).ToListAsync();
    }

    public static async Task<EmailOutboxDelivery> OnlyDeliveryAsync(PostgreSqlWebApplicationFactory factory) => Assert.Single(await DeliveriesAsync(factory));

    public static Task<T> ScalarAsync<T>(PostgreSqlWebApplicationFactory factory, string sql) => FolioTestSupport.ScalarAsync<T>(factory.ConnectionString, sql);

    public static async Task ExecuteAsync(PostgreSqlWebApplicationFactory factory, string sql)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Queues one synthetic event and lets a host whose PROVIDER IS NOT CONFIGURED fan it out (an unconfigured host sends nothing and spends no attempt): the deliveries it made are Pending with no attempt, the starting point of a send test.
    /// </summary>
    public static async Task<List<EmailOutboxDelivery>> PendingDeliveriesAsync(PostgreSqlWebApplicationFactory factory, FolioSeed seed, SyntheticHandler handler, Guid? propertyId = null)
    {
        using var host = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: handler);
        await EnqueueAsync(host.Services, propertyId ?? seed.PropertyId);
        var result = await RunAsync(host.Services);
        Assert.Equal(new EmailOutboxBatchResult(1, 0), result);
        var rows = await DeliveriesAsync(factory);
        Assert.All(rows, row => { Assert.Equal(EmailOutboxDelivery.StatusPending, row.Status); Assert.Equal(0, row.Attempts); });
        return rows;
    }
}
