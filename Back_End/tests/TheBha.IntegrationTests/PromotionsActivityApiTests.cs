using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using TheBha.Api;
using TheBha.Api.Realtime;
using TheBha.Application.Activity;
using TheBha.Application.Website;
using TheBha.Domain.Properties;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR10 (ADR 0009, ADR 0011 §A, §C, §D): the Admin Promotions routes append ONE event of the <c>promotions</c> stream per committed create, save, status change and cover
/// upload (for the route's Property, by the Staff session), as the last statement before COMMIT, hint only after it, and the list answers its watermark from the same snapshot as its rows.
/// Real PostgreSQL, the real HTTP pipeline and the real login; the picture storage and the recorder are wrapped only to observe or fail them.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class PromotionsActivityApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Unseen = "/api/admin/v1/menu-unseen";
    private const string Watermark = "X-Admin-View-Watermark";
    private const string Menu = AdminMenuKeys.Promotions;
    private const string Peer = "peer@example.com";
    private const string DeskB = "desk-b@example.com";

    // ---------------------------------------------------------------------------------------------------------- probes

    private sealed class Probe
    {
        public readonly ConcurrentQueue<(string Menu, Guid? Property)> Hints = [];
        public volatile bool FailRecorder;

        public void Install(IServiceCollection services)
        {
            var recorder = services.Single(descriptor => descriptor.ServiceType == typeof(IAdminActivityRecorder)).ImplementationType!;
            services.RemoveAll<IAdminActivityRecorder>();
            services.AddScoped<IAdminActivityRecorder>(provider => new FailingRecorder((IAdminActivityRecorder)ActivatorUtilities.CreateInstance(provider, recorder), this));
            services.RemoveAll<IAdminActivityHint>();
            services.AddScoped<IAdminActivityHint>(provider => new HintSpy(ActivatorUtilities.CreateInstance<AdminActivityHint>(provider), Hints));
        }
    }

    private sealed class FailingRecorder(IAdminActivityRecorder inner, Probe probe) : IAdminActivityRecorder
    {
        public async Task RecordAsync(AdminActivityEntry entry, CancellationToken cancellationToken)
        {
            await inner.RecordAsync(entry, cancellationToken);
            if (probe.FailRecorder) throw new InvalidOperationException("Injected recorder failure after the counter moved.");
        }
    }

    private sealed class HintSpy(IAdminActivityHint inner, ConcurrentQueue<(string, Guid?)> sent) : IAdminActivityHint
    {
        public Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken)
        {
            sent.Enqueue((menuKey, propertyId));
            return inner.PublishAsync(menuKey, propertyId, cancellationToken);
        }
    }

    private sealed class SpyStorage(IHeroMediaStorage inner) : IHeroMediaStorage
    {
        public readonly ConcurrentQueue<string> Deleted = [];
        public volatile TaskCompletionSource<bool>? Parked;
        public readonly TaskCompletionSource<bool> Reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsConfigured => inner.IsConfigured;

        public async Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
        {
            if (Parked is { } gate)
            {
                Reached.TrySetResult(true);
                await gate.Task.WaitAsync(cancellationToken);
            }

            await inner.WriteAsync(key, content, cancellationToken);
        }

        public Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken) => inner.OpenReadAsync(key, cancellationToken);
        public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken) => inner.ExistsAsync(key, cancellationToken);

        public Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            Deleted.Enqueue(key);
            return inner.DeleteAsync(key, cancellationToken);
        }
    }

    /// <summary>Throws AFTER PostgreSQL really committed: the caller learns of an error whose outcome it cannot know.</summary>
    private sealed class LostCommitAnswer : DbTransactionInterceptor
    {
        public volatile bool Armed;

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default) =>
            Armed ? throw new InvalidOperationException("Injected: the answer to COMMIT was lost.") : Task.CompletedTask;
    }

    /// <summary>The shared barrier, switched on only when a test wants it, so the seeding requests of the same host are not paused.</summary>
    private sealed class ArmableBarrier : DbCommandInterceptor
    {
        private volatile ReservationBoardSnapshotBarrierInterceptor? _inner;

        public ReservationBoardSnapshotBarrierInterceptor Arm(string tag) => _inner = new ReservationBoardSnapshotBarrierInterceptor(tag);

        public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default) =>
            _inner is { } inner ? inner.ReaderExecutedAsync(command, eventData, result, cancellationToken) : ValueTask.FromResult(result);
    }

    // ---------------------------------------------------------------------------------------------------------- plumbing

    /// <summary>
    /// Property A: Manager (also Manager at B), Peer (Manager at A and B), Desk (FrontDesk at A). Property B: DeskB (FrontDesk at B only). Every account is a day old, so an event recorded now is
    /// after the D2 baseline.
    /// </summary>
    private sealed class Env(WebApplicationFactory<Program> host, HttpClient client, Guid a, Guid b, Dictionary<string, string> cookies, Probe probe) : IDisposable
    {
        public WebApplicationFactory<Program> Host { get; } = host;
        public HttpClient Client { get; } = client;
        public Guid A { get; } = a;
        public Guid B { get; } = b;
        public Probe Probe { get; } = probe;
        public string Cookie(string email) => cookies[email];
        public void Dispose()
        {
            Client.Dispose();
            Host.Dispose();
        }
    }

    private async Task<Env> BeginAsync(Probe? probe = null, Action<IServiceCollection>? more = null)
    {
        probe ??= new Probe();
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, "Staff");
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", "https://localhost:3000");
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.ConfigureServices(services =>
            {
                probe.Install(services);
                more?.Invoke(services);
            });
        });
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var a = await SeedStaffAsync(host);
        Guid b;
        await using (var context = Factory.CreateDbContext())
        {
            var property = new Property(Guid.NewGuid(), "Hotel B", "hotel-b", null, "2 Street", "Hue", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, DateTimeOffset.UtcNow);
            context.Add(property);
            await context.SaveChangesAsync();
            b = property.Id;
        }

        await CliAsync(host, ["--staff-grant", "--email", Manager, "--property-id", b.ToString(), "--role", StaffRole.Manager]);
        await CliAsync(host, ["--staff-create", "--email", Peer, "--property-id", a.ToString(), "--role", StaffRole.Manager], Password);
        await CliAsync(host, ["--staff-grant", "--email", Peer, "--property-id", b.ToString(), "--role", StaffRole.Manager]);
        await CliAsync(host, ["--staff-create", "--email", DeskB, "--property-id", b.ToString(), "--role", StaffRole.FrontDesk], Password);
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CreatedAtUtc" = now() - interval '1 day' """);
        var client = CreateHttpsClient(host);
        var cookies = new Dictionary<string, string>();
        foreach (var email in new[] { Manager, Peer, Desk, DeskB }) cookies[email] = await LoginAsync(client, email);
        return new Env(host, client, a, b, cookies, probe);
    }

    private static string Url(Guid property) => $"/api/admin/v1/properties/{property}/promotions";

    private static JsonObject Body(string slug, string title = "Early bird", Action<JsonObject>? change = null)
    {
        var body = new JsonObject
        {
            ["slug"] = slug,
            ["title"] = title,
            ["summary"] = "Save on longer stays",
            ["body"] = new JsonArray("Terms apply."),
            ["kind"] = "Percent",
            ["value"] = 10,
            ["allRoomTypes"] = true,
            ["minNights"] = 1,
            ["showOnHomepage"] = false,
            ["sortOrder"] = 1
        };
        change?.Invoke(body);
        return body;
    }

    private static JsonObject SaveBody(JsonElement editor, int? expectedVersion = null, Action<JsonObject>? change = null)
    {
        var promotion = new JsonObject
        {
            ["slug"] = editor.GetProperty("slug").GetString(),
            ["title"] = editor.GetProperty("title").GetString(),
            ["summary"] = editor.GetProperty("summary").GetString(),
            ["body"] = JsonNode.Parse(editor.GetProperty("body").GetRawText()),
            ["coverMediaId"] = editor.GetProperty("coverMediaId").ValueKind == JsonValueKind.Null ? null : editor.GetProperty("coverMediaId").GetString(),
            ["coverAltText"] = editor.GetProperty("coverAltText").ValueKind == JsonValueKind.Null ? null : editor.GetProperty("coverAltText").GetString(),
            ["kind"] = editor.GetProperty("kind").GetString(),
            ["value"] = editor.GetProperty("value").GetDecimal(),
            ["allRoomTypes"] = editor.GetProperty("allRoomTypes").GetBoolean(),
            ["roomTypeIds"] = JsonNode.Parse(editor.GetProperty("roomTypeIds").GetRawText()),
            ["minNights"] = editor.GetProperty("minNights").GetInt32(),
            ["showOnHomepage"] = editor.GetProperty("showOnHomepage").GetBoolean(),
            ["sortOrder"] = editor.GetProperty("sortOrder").GetInt32()
        };
        change?.Invoke(promotion);
        return new JsonObject { ["expectedVersion"] = expectedVersion ?? editor.GetProperty("version").GetInt32(), ["promotion"] = promotion };
    }

    private static HttpRequestMessage CreateRequest(Guid property, JsonObject body, string cookie, Guid? key = null)
    {
        var request = Post(Url(property), body.ToJsonString(), cookie);
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        return request;
    }

    private static HttpRequestMessage UploadRequest(Guid property, string cookie, byte[]? bytes = null)
    {
        var content = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes ?? File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "promotion", "cover.png")));
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        content.Add(part, "file", "cover.png");
        var request = new HttpRequestMessage(HttpMethod.Post, $"{Url(property)}/media") { Content = content };
        request.Headers.Add("Cookie", cookie);
        request.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        return request;
    }

    private static async Task<JsonElement> OkAsync(Task<HttpResponseMessage> send) => await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, send));

    private Task<JsonElement> CreateOkAsync(Env e, Guid property, string slug, string cookie, string title = "Early bird", Guid? key = null) =>
        OkAsync(e.Client.SendAsync(CreateRequest(property, Body(slug, title), cookie, key)));

    private async Task<List<AdminActivity>> RowsAsync()
    {
        await using var db = Factory.CreateDbContext();
        return (await db.AdminActivities.AsNoTracking().Where(row => row.MenuKey == Menu).ToListAsync()).OrderBy(row => row.Sequence).ToList();
    }

    private Task<long> CounterAsync() => ScalarAsync<long>($"""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = '{Menu}' """);

    /// <summary>The state a refused or failed request must leave exactly as it found it.</summary>
    private async Task<(long Counter, int Rows, int Promotions, int Media, int Audits, int Hints)> StateAsync(Env e) =>
        (await CounterAsync(), (await RowsAsync()).Count, await ScalarAsync<int>("""SELECT count(*)::int FROM "Promotions" """), await ScalarAsync<int>("""SELECT count(*)::int FROM "PromotionMedia" """),
            await ScalarAsync<int>("""SELECT count(*)::int FROM "PromotionAudits" """), e.Probe.Hints.Count);

    private string[] PromoFiles() => Directory.Exists(Path.Combine(Factory.MediaRoot, "promo")) ? Directory.GetFiles(Path.Combine(Factory.MediaRoot, "promo")) : [];

    private async Task<bool> CounterRowIsFreeAsync()
    {
        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = new NpgsqlCommand($"""SELECT 1 FROM "MenuActivityStreams" WHERE "MenuKey" = '{Menu}' FOR UPDATE NOWAIT""", connection, transaction);
        try
        {
            await command.ExecuteScalarAsync();
            return true;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.LockNotAvailable)
        {
            return false;
        }
    }

    private static void InstallLostCommit(IServiceCollection services, string connectionString, LostCommitAnswer interceptor)
    {
        services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
        services.AddDbContext<TheBhaDbContext>(options => options
            .UseNpgsql(connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
            .AddInterceptors(interceptor));
    }

    // ---------------------------------------------------------------------------------------------------------- every committed write, one event

    [Fact]
    public async Task Every_committed_write_appends_one_event_for_its_Property_by_the_Staff_actor_with_one_hint_after_the_commit_and_a_refusal_records_nothing()
    {
        using var e = await BeginAsync();
        var manager = e.Cookie(Manager);
        var managerId = await StaffIdAsync(Manager);
        var hints = new List<(string, Guid?)>();

        async Task<AdminActivity> Expect(int total, Guid property, string action, string kind, string key, string title)
        {
            hints.Add((Menu, property));
            var rows = await RowsAsync();
            Assert.Equal(total, rows.Count);
            var row = rows[^1];
            Assert.Equal((property, action, kind, key, title, 1), (row.PropertyId ?? Guid.Empty, row.Action, row.EntityKind, row.EntityKey, row.TitleSnapshot, row.ItemCount));
            Assert.Equal((AdminActorKind.Staff, managerId, (Guid?)null), (row.ActorKind, row.ActorStaffId ?? Guid.Empty, row.CorrelationId));
            Assert.Equal(total, row.Sequence);
            Assert.Equal(row.Sequence, await CounterAsync());
            Assert.Equal(hints, e.Probe.Hints.ToList()); // one hint per committed write, in order, with its Property, never from a refused one
            return row;
        }

        // ---- create
        var key = Guid.NewGuid();
        var created = await CreateOkAsync(e, e.A, "early-bird", manager, key: key);
        var id = created.GetProperty("id").GetString()!;
        await Expect(1, e.A, "Created", "promotion", id, "Early bird");

        // ---- save (a committed Save always writes a new version, so it is an event)
        var saved = await OkAsync(e.Client.SendAsync(Post($"{Url(e.A)}/{id}/save", SaveBody(created, change: p => p["title"] = "Early bird II").ToJsonString(), manager)));
        await Expect(2, e.A, "DraftSaved", "promotion", id, "Early bird II");

        // ---- status: Draft -> Active -> Disabled, two events
        var active = await OkAsync(e.Client.SendAsync(Post($"{Url(e.A)}/{id}/status", new { expectedVersion = saved.GetProperty("version").GetInt32(), status = "Active" }, manager)));
        await Expect(3, e.A, "StatusChanged", "promotion", id, "Early bird II");
        await OkAsync(e.Client.SendAsync(Post($"{Url(e.A)}/{id}/status", new { expectedVersion = active.GetProperty("version").GetInt32(), status = "Disabled" }, manager)));
        await Expect(4, e.A, "StatusChanged", "promotion", id, "Early bird II");

        // ---- cover upload: the object is the picture, the title a generic label (never the file name)
        var cover = await OkAsync(e.Client.SendAsync(UploadRequest(e.A, manager)));
        await Expect(5, e.A, "CoverUploaded", "promotion-cover", cover.GetProperty("id").GetGuid().ToString("D"), "Promotion cover");

        // ---- the other Property records under its own Property id
        var inB = await CreateOkAsync(e, e.B, "early-bird-b", manager, "Early bird B");
        await Expect(6, e.B, "Created", "promotion", inB.GetProperty("id").GetString()!, "Early bird B");

        // ---- refusals and reads leave everything as it was
        var before = await StateAsync(e);
        var files = PromoFiles().Length;                                                                    // the media root is shared by the tests of this run
        var stale = SaveBody(created, expectedVersion: 1);                                                  // the editor loaded version 1; it is now 3
        var attempts = new (string Name, HttpStatusCode Expected, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("invalid slug", HttpStatusCode.BadRequest, () => e.Client.SendAsync(CreateRequest(e.A, Body("BAD SLUG"), manager))),
            ("slug taken", HttpStatusCode.Conflict, () => e.Client.SendAsync(CreateRequest(e.A, Body("early-bird"), manager))),
            ("no idempotency key", HttpStatusCode.BadRequest, () => e.Client.SendAsync(Post(Url(e.A), Body("no-key").ToJsonString(), manager))),
            ("stale save", HttpStatusCode.Conflict, () => e.Client.SendAsync(Post($"{Url(e.A)}/{id}/save", stale.ToJsonString(), manager))),
            ("stale status", HttpStatusCode.Conflict, () => e.Client.SendAsync(Post($"{Url(e.A)}/{id}/status", new { expectedVersion = 1, status = "Active" }, manager))),
            ("Draft cannot become Disabled", HttpStatusCode.BadRequest, () => e.Client.SendAsync(Post($"{Url(e.B)}/{inB.GetProperty("id").GetString()}/status", new { expectedVersion = inB.GetProperty("version").GetInt32(), status = "Disabled" }, manager))),
            ("not a picture", HttpStatusCode.BadRequest, () => e.Client.SendAsync(UploadRequest(e.A, manager, [1, 2, 3, 4]))),
            ("FrontDesk create", HttpStatusCode.Forbidden, () => e.Client.SendAsync(CreateRequest(e.A, Body("by-desk"), e.Cookie(Desk)))),
            ("FrontDesk upload", HttpStatusCode.Forbidden, () => e.Client.SendAsync(UploadRequest(e.A, e.Cookie(Desk)))),
            ("Manager of A only is not a Manager of B", HttpStatusCode.Forbidden, () => e.Client.SendAsync(CreateRequest(e.B, Body("by-desk-b"), e.Cookie(DeskB)))),
            ("list", HttpStatusCode.OK, () => e.Client.SendAsync(Get(Url(e.A), manager))),
            ("detail", HttpStatusCode.OK, () => e.Client.SendAsync(Get($"{Url(e.A)}/{id}", manager))),
            ("room types", HttpStatusCode.OK, () => e.Client.SendAsync(Get($"{Url(e.A)}/room-types", manager))),
        };
        foreach (var (name, expected, send) in attempts)
        {
            Assert.True(expected == (await send()).StatusCode, name);
        }

        Assert.Equal(before, await StateAsync(e));
        Assert.Equal(files, PromoFiles().Length);
    }

    [Fact]
    public async Task A_create_replay_with_the_same_key_and_a_race_on_one_key_record_exactly_one_event_counter_step_and_hint()
    {
        using var e = await BeginAsync();
        var manager = e.Cookie(Manager);

        // lost-response retry: same key, same body, any number of times
        var key = Guid.NewGuid();
        var first = await CreateOkAsync(e, e.A, "replayed", manager, key: key);
        var after = await StateAsync(e);
        Assert.Equal((1L, 1, 1), (after.Counter, after.Rows, after.Hints));
        for (var i = 0; i < 3; i++)
        {
            var replay = await CreateOkAsync(e, e.A, "replayed", manager, key: key);
            Assert.Equal(first.GetProperty("id").GetString(), replay.GetProperty("id").GetString());
        }

        Assert.Equal(after, await StateAsync(e));
        // the same key for a different promotion is refused and records nothing
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Client.SendAsync(CreateRequest(e.A, Body("another-one"), manager, key)));
        Assert.Equal(after, await StateAsync(e));

        // a race: several requests of ONE operation arrive together; at most one of them commits and records
        var raceKey = Guid.NewGuid();
        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => e.Client.SendAsync(CreateRequest(e.A, Body("raced"), manager, raceKey))));
        Assert.All(responses, response => Assert.True(response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict, response.StatusCode.ToString()));
        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.OK);
        var state = await StateAsync(e);
        Assert.Equal(2, state.Promotions);
        Assert.Equal((2L, 2, 2), (state.Counter, state.Rows, state.Hints));
        Assert.Equal(["Created", "Created"], (await RowsAsync()).Select(row => row.Action).ToArray());
    }

    [Fact]
    public async Task A_failing_recorder_rolls_back_every_write_the_counter_and_the_hint_and_removes_a_just_written_cover()
    {
        var probe = new Probe();
        using var e = await BeginAsync(probe);
        var manager = e.Cookie(Manager);
        var created = await CreateOkAsync(e, e.A, "kept", manager);
        var id = created.GetProperty("id").GetString()!;
        var before = await StateAsync(e);
        var files = PromoFiles().Length;
        var version = await ScalarAsync<int>("""SELECT "Version" FROM "Promotions" """);

        probe.FailRecorder = true;
        var attempts = new (string Name, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("create", () => e.Client.SendAsync(CreateRequest(e.A, Body("lost"), manager))),
            ("save", () => e.Client.SendAsync(Post($"{Url(e.A)}/{id}/save", SaveBody(created, change: p => p["title"] = "Changed").ToJsonString(), manager))),
            ("status", () => e.Client.SendAsync(Post($"{Url(e.A)}/{id}/status", new { expectedVersion = created.GetProperty("version").GetInt32(), status = "Active" }, manager))),
            ("upload", () => e.Client.SendAsync(UploadRequest(e.A, manager))),
        };
        foreach (var (name, send) in attempts)
        {
            Assert.True((await send()).StatusCode == HttpStatusCode.InternalServerError, $"{name} must fail whole");
        }

        probe.FailRecorder = false;
        Assert.Equal(before, await StateAsync(e));                       // rows, audits, media, counter, hints
        Assert.Equal(files, PromoFiles().Length);                        // the just-written file is gone
        Assert.Equal(version, await ScalarAsync<int>("""SELECT "Version" FROM "Promotions" """));

        // and the same operations work once the recorder does
        await OkAsync(e.Client.SendAsync(Post($"{Url(e.A)}/{id}/status", new { expectedVersion = version, status = "Active" }, manager)));
        Assert.Equal(before.Rows + 1, (await RowsAsync()).Count);
    }

    [Fact]
    public async Task A_commit_whose_answer_is_lost_keeps_its_event_and_its_cover_file_and_a_retry_of_the_create_records_nothing_more()
    {
        var interceptor = new LostCommitAnswer();
        using var e = await BeginAsync(more: services => InstallLostCommit(services, Factory.ConnectionString, interceptor));
        var manager = e.Cookie(Manager);
        var key = Guid.NewGuid();
        var files = PromoFiles().Length;                       // the media root is shared by the tests of this run

        interceptor.Armed = true;
        Assert.Equal(HttpStatusCode.InternalServerError, (await e.Client.SendAsync(CreateRequest(e.A, Body("lost-answer"), manager, key))).StatusCode);
        Assert.Equal(HttpStatusCode.InternalServerError, (await e.Client.SendAsync(UploadRequest(e.A, manager))).StatusCode);
        interceptor.Armed = false;

        // both really committed: one promotion, its event; one cover row, its event, and its file stays (a recorded cover without its file is worse than an unreferenced file)
        var state = await StateAsync(e);
        Assert.Equal((1, 1, 2), (state.Promotions, state.Media, state.Rows));
        Assert.Equal(files + 1, PromoFiles().Length);
        Assert.Equal(["Created", "CoverUploaded"], (await RowsAsync()).Select(row => row.Action).ToArray());

        // the client retries the create it never heard about: a replay, no second promotion, no second event
        var replay = await CreateOkAsync(e, e.A, "lost-answer", manager, key: key);
        Assert.Equal(await ScalarAsync<string>("""SELECT "Id"::text FROM "Promotions" """), replay.GetProperty("id").GetString());
        var after = await StateAsync(e);
        Assert.Equal((1, 2), (after.Promotions, after.Rows));
        Assert.Equal(await CounterAsync(), after.Rows);
    }

    [Fact]
    public async Task A_cover_is_written_to_disk_before_the_transaction_and_no_counter_row_is_held_meanwhile()
    {
        SpyStorage? spy = null;
        using var e = await BeginAsync(more: services =>
        {
            var real = services.Single(descriptor => descriptor.ServiceType == typeof(IHeroMediaStorage)).ImplementationInstance!;
            services.RemoveAll<IHeroMediaStorage>();
            spy = new SpyStorage((IHeroMediaStorage)real);
            services.AddSingleton<IHeroMediaStorage>(spy);
        });

        spy!.Parked = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var upload = e.Client.SendAsync(UploadRequest(e.A, e.Cookie(Manager)));
        await spy.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.True(await CounterRowIsFreeAsync());                                                                // no counter lock while the file is written
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "PromotionMedia" """));              // and no row yet: the file comes first
        spy.Parked.SetResult(true);
        await AssertStatusAsync(HttpStatusCode.OK, upload);
        Assert.Single(await RowsAsync());
        Assert.Empty(spy.Deleted);
    }

    // ---------------------------------------------------------------------------------------------------------- the list: bare array, header, one snapshot, CORS

    [Fact]
    public async Task The_list_keeps_its_bare_array_and_filters_and_answers_the_watermark_header_and_only_that_route_exposes_it()
    {
        using var e = await BeginAsync();
        var manager = e.Cookie(Manager);
        var one = await CreateOkAsync(e, e.A, "one", manager, "Alpha");
        await CreateOkAsync(e, e.A, "two", manager, "Beta");
        await CreateOkAsync(e, e.B, "three", manager, "Gamma");
        await OkAsync(e.Client.SendAsync(Post($"{Url(e.A)}/{one.GetProperty("id").GetString()}/status", new { expectedVersion = one.GetProperty("version").GetInt32(), status = "Active" }, manager)));

        var list = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(Url(e.A), manager, AdminOrigin)));
        var rows = await JsonAsync(list);
        Assert.Equal(JsonValueKind.Array, rows.ValueKind);                                           // still a bare array
        Assert.Equal(["Alpha", "Beta"], rows.EnumerateArray().Select(row => row.GetProperty("title").GetString()).Order().ToArray());
        Assert.Equal((await CounterAsync()).ToString(), Assert.Single(list.Headers.GetValues(Watermark)));
        Assert.Contains(Watermark, string.Join(',', list.Headers.GetValues("Access-Control-Expose-Headers")), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(AdminOrigin, Assert.Single(list.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal("true", Assert.Single(list.Headers.GetValues("Access-Control-Allow-Credentials")));

        // the filters still work (status, search, homepage, publicNow)
        Assert.Equal(["Alpha"], (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Url(e.A)}?status=Active", manager))))).EnumerateArray().Select(row => row.GetProperty("title").GetString()).ToArray());
        Assert.Equal(["Beta"], (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Url(e.A)}?q=bet", manager))))).EnumerateArray().Select(row => row.GetProperty("title").GetString()).ToArray());
        Assert.Empty((await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Url(e.A)}?homepage=true", manager))))).EnumerateArray());
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Client.SendAsync(Get($"{Url(e.A)}?status=Nope", manager)));

        // no other promotion route exposes the header, a stranger origin gets nothing, and a FrontDesk is still refused
        foreach (var path in new[] { $"{Url(e.A)}/{one.GetProperty("id").GetString()}", $"{Url(e.A)}/room-types" })
        {
            var response = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(path, manager, AdminOrigin)));
            Assert.False(response.Headers.Contains(Watermark));
            Assert.DoesNotContain(Watermark, response.Headers.TryGetValues("Access-Control-Expose-Headers", out var exposed) ? string.Join(',', exposed) : string.Empty, StringComparison.OrdinalIgnoreCase);
        }

        Assert.False((await e.Client.SendAsync(Get(Url(e.A), manager, "https://evil.example"))).Headers.Contains("Access-Control-Allow-Origin"));
        var refused = await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get(Url(e.A), e.Cookie(Desk), AdminOrigin)));
        Assert.False(refused.Headers.Contains(Watermark));
        await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Client.SendAsync(Get(Url(e.A))));

        // the create route keeps its own narrow policy: Idempotency-Key is still an allowed request header and nothing is exposed
        var preflight = new HttpRequestMessage(HttpMethod.Options, Url(e.A));
        preflight.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
        preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type, idempotency-key");
        var allowed = await e.Client.SendAsync(preflight);
        Assert.Contains("idempotency-key", string.Join(',', allowed.Headers.GetValues("Access-Control-Allow-Headers")), StringComparison.OrdinalIgnoreCase);
        Assert.False(allowed.Headers.Contains("Access-Control-Expose-Headers"));

        // LocalGate: the routes do not exist, so there is nothing to carry the header
        using var local = CreateHost(AdminCalendarAccessMode.LocalGate);
        using var localClient = CreateHttpsClient(local);
        var gone = await localClient.SendAsync(Get(Url(e.A), null, AdminOrigin));
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        Assert.False(gone.Headers.Contains(Watermark));
    }

    [Theory]
    [InlineData("FROM \"MenuActivityStreams\"")]   // paused after the counter: the rows must not be newer than the watermark
    [InlineData("FROM \"Promotions\"")]            // paused after the rows: the watermark must not be newer than the rows
    public async Task A_list_never_pairs_rows_with_a_watermark_from_another_moment_when_a_write_commits_in_the_middle(string pauseAfter)
    {
        var barrier = new ArmableBarrier();
        using var e = await BeginAsync(more: services => services.AddScoped(_ => new TheBhaDbContext(
            new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(barrier).Options)));
        var manager = e.Cookie(Manager);
        await CreateOkAsync(e, e.A, "before", manager, "Before");
        var gate = barrier.Arm(pauseAfter);

        var read = e.Client.SendAsync(Get(Url(e.A), manager));
        await gate.Reached.WaitAsync(TimeSpan.FromSeconds(30));
        var counterBefore = await CounterAsync();
        await CreateOkAsync(e, e.A, "during", manager, "During");     // commits while the read is paused
        var counterAfter = await CounterAsync();
        gate.Release();
        var response = await AssertStatusAsync(HttpStatusCode.OK, read);

        Assert.True(counterAfter > counterBefore);
        Assert.Equal(["Before"], (await JsonAsync(response)).EnumerateArray().Select(row => row.GetProperty("title").GetString()).ToArray());   // the commit is not in these rows …
        Assert.Equal(counterBefore.ToString(), Assert.Single(response.Headers.GetValues(Watermark)));                                         // … and the watermark does not claim it
    }

    // ---------------------------------------------------------------------------------------------------------- who sees what, per Property

    [Fact]
    public async Task Acknowledging_Property_A_leaves_B_unseen_and_the_actor_and_Staff_without_the_Property_see_nothing_of_it()
    {
        using var e = await BeginAsync();
        var manager = e.Cookie(Manager);
        var peer = e.Cookie(Peer);

        async Task<JsonElement> Summary(string cookie) => (await OkAsync(e.Client.SendAsync(Get(Unseen, cookie)))).GetProperty("menus");
        async Task<(int Total, int A, int B)> Counts(string cookie)
        {
            var menus = await Summary(cookie);
            if (!menus.TryGetProperty(Menu, out var entry)) return (-1, -1, -1);
            var byProperty = entry.GetProperty("byProperty").EnumerateArray().ToDictionary(row => row.GetProperty("propertyId").GetGuid(), row => row.GetProperty("count").GetInt32());
            return (entry.GetProperty("count").GetInt32(), byProperty.GetValueOrDefault(e.A, -1), byProperty.GetValueOrDefault(e.B, -1));
        }

        Task<HttpResponseMessage> Seen(string cookie, Guid property, string watermark) => e.Client.SendAsync(Post($"{Unseen}/{Menu}/seen", new { propertyId = property, viewWatermark = watermark }, cookie));
        async Task<string> ListWatermark(string cookie, Guid property) => Assert.Single((await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(Url(property), cookie)))).Headers.GetValues(Watermark));

        // Peer acts in A and B: Manager (a Manager of both) sees one of each, Peer sees nothing of its own work
        await CreateOkAsync(e, e.A, "a-one", peer, "A one");
        await CreateOkAsync(e, e.B, "b-one", peer, "B one");
        Assert.Equal((2, 1, 1), await Counts(manager));
        Assert.Equal((0, 0, 0), await Counts(peer));
        Assert.Equal([(Menu, (Guid?)e.A), (Menu, e.B)], e.Probe.Hints.ToArray());

        // Manager opens A: the watermark of A's own list, for A only; B stays unseen
        var watermark = await ListWatermark(manager, e.A);
        var acked = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Seen(manager, e.A, watermark)));
        Assert.Equal(1, acked.GetProperty("count").GetInt32());
        Assert.Equal((1, 0, 1), await Counts(manager));

        // an event after the watermark stays unseen; the actor's own event never counts for the actor but counts for the other Manager
        await CreateOkAsync(e, e.A, "a-two", peer, "A two");
        Assert.Equal((2, 1, 1), await Counts(manager));
        await CreateOkAsync(e, e.A, "a-three", manager, "A three");
        Assert.Equal((2, 1, 1), await Counts(manager));
        Assert.Equal((1, 1, 0), await Counts(peer));

        // a later event than the list that was on screen stays unseen after that list's acknowledgement
        var onScreen = await ListWatermark(manager, e.A);
        await CreateOkAsync(e, e.A, "a-four", peer, "A four");
        await AssertStatusAsync(HttpStatusCode.OK, Seen(manager, e.A, onScreen));
        Assert.Equal((2, 1, 1), await Counts(manager));
        await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(manager, e.A, (long.Parse(onScreen) + 100).ToString()));           // a mark above the counter is refused, never clamped

        // FrontDesk at A and FrontDesk at B only: Promotions is not theirs, so there is no entry, no list and no acknowledgement
        foreach (var email in new[] { Desk, DeskB })
        {
            Assert.False((await Summary(e.Cookie(email))).TryGetProperty(Menu, out _));
            foreach (var property in new[] { e.A, e.B })
            {
                await AssertStatusAsync(HttpStatusCode.NotFound, Seen(e.Cookie(email), property, "1"));
            }
        }

        await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get(Url(e.B), e.Cookie(DeskB))));
        var deskB = await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get(Url(e.A), e.Cookie(DeskB))));
        Assert.False(deskB.Headers.Contains(Watermark));
        Assert.Equal((2, 1, 1), await Counts(manager));

        // a Manager of A only never sees B's number and cannot acknowledge B
        await ExecuteAsync($"""DELETE FROM "StaffPropertyMemberships" WHERE "StaffAccountId" = '{await StaffIdAsync(Manager)}' AND "PropertyId" = '{e.B}' """);
        Assert.Equal((1, 1, -1), await Counts(manager));
        await AssertStatusAsync(HttpStatusCode.NotFound, Seen(manager, e.B, "1"));
        await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get(Url(e.B), manager)));
    }
}
