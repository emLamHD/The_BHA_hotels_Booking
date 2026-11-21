using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Numerics;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using TheBha.Api;
using TheBha.Api.Realtime;
using TheBha.Application.Activity;
using TheBha.Application.Properties;
using TheBha.Domain.Properties;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR11 (ADR 0011 §A, §C, §D): the Admin Catalog appends ONE event of the global <c>catalog</c> stream per committed create (Property, RoomType, PhysicalRoom, Amenity), Save
/// (Property, RoomType) and picture upload, as the last statement before COMMIT, hint (menu key only) after it; the two lists answer a watermark from the same snapshot as their rows. Real
/// PostgreSQL and the real HTTP pipeline and login; the storage and the recorder are wrapped only to observe or fail them.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class CatalogActivityApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Root = "/api/admin/v1/catalog";
    private const string Unseen = "/api/admin/v1/menu-unseen";
    private const string Watermark = "X-Admin-View-Watermark";
    private const string Menu = AdminMenuKeys.Catalog;
    private const string Peer = "peer@example.com";

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

    private sealed class SpyStorage(ICatalogMediaStorage inner) : ICatalogMediaStorage
    {
        public volatile TaskCompletionSource<bool>? Parked;
        public readonly TaskCompletionSource<bool> Reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsConfigured => inner.IsConfigured;

        public async Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken ct)
        {
            if (Parked is { } gate)
            {
                Reached.TrySetResult(true);
                await gate.Task.WaitAsync(ct);
            }

            await inner.WriteAsync(key, content, ct);
        }

        public Task<Stream?> OpenAsync(string key, CancellationToken ct) => inner.OpenAsync(key, ct);
        public Task<bool> ExistsAsync(string key, CancellationToken ct) => inner.ExistsAsync(key, ct);
        public Task DeleteUnrecordedAsync(string key, CancellationToken ct) => inner.DeleteUnrecordedAsync(key, ct);
    }

    /// <summary>Throws AFTER PostgreSQL really committed: the caller learns of an error whose outcome it cannot know.</summary>
    private sealed class LostCommitAnswer : DbTransactionInterceptor
    {
        public volatile bool Armed;

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default) =>
            Armed ? throw new InvalidOperationException("Injected: the answer to COMMIT was lost.") : Task.CompletedTask;
    }

    private sealed class ArmableBarrier : DbCommandInterceptor
    {
        private volatile ReservationBoardSnapshotBarrierInterceptor? _inner;

        public ReservationBoardSnapshotBarrierInterceptor Arm(string tag) => _inner = new ReservationBoardSnapshotBarrierInterceptor(tag);

        public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default) =>
            _inner is { } inner ? inner.ReaderExecutedAsync(command, eventData, result, cancellationToken) : ValueTask.FromResult(result);
    }

    // ---------------------------------------------------------------------------------------------------------- plumbing

    /// <summary>
    /// Site (FrontDesk at A + the global website permission) acts; Peer (the same) sees; Manager (Manager at A, NO website permission) and Desk (FrontDesk) are denied. Every account is a day old,
    /// so an event recorded now is after the D2 baseline.
    /// </summary>
    private sealed class Env(WebApplicationFactory<Program> host, HttpClient client, Guid a, Dictionary<string, string> cookies, Probe probe) : IDisposable
    {
        public WebApplicationFactory<Program> Host { get; } = host;
        public HttpClient Client { get; } = client;
        public Guid A { get; } = a;
        public Probe Probe { get; } = probe;
        public string Cookie(string email) => cookies[email];
        /// <summary>The cookie of the website-permission Staff who acts.</summary>
        public string Site => cookies["site@example.com"];
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
        await CliAsync(host, ["--staff-create", "--email", Peer, "--property-id", a.ToString(), "--role", StaffRole.FrontDesk], Password);
        await CliAsync(host, ["--staff-website-access", "--email", Peer, "--enabled", "true"]);
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CreatedAtUtc" = now() - interval '1 day' """);
        var client = CreateHttpsClient(host);
        var cookies = new Dictionary<string, string>();
        foreach (var email in new[] { Site, Peer, Desk, Manager }) cookies[email] = await LoginAsync(client, email);
        return new Env(host, client, a, cookies, probe);
    }

    private static HttpRequestMessage CreateRequest(string path, object body, string cookie, Guid? key = null)
    {
        var request = Post(path, body, cookie);
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        return request;
    }

    private static object PropertyBody(string slug, string name = "Hotel Created") =>
        new { name, slug, description = "A long description that must never reach the history.", address = "1 Sample Street", city = "Da Nang", country = "Vietnam", timeZone = "Asia/Ho_Chi_Minh", checkInTime = "14:00:00", checkOutTime = "12:00:00", isActive = false };

    private static object RoomTypeBody(string code, string name = "Sea Room") =>
        new { code, name, slug = code.ToLowerInvariant(), description = (string?)null, baseOccupancy = 2, maxOccupancy = 3, areaSquareMeters = (decimal?)null, bedrooms = (int?)null, bedDescription = (string?)null, isActive = false };

    private static HttpRequestMessage UploadRequest(string route, string cookie, byte[]? bytes = null)
    {
        var form = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes ?? File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "catalog", "valid.webp")));
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("image/webp");
        form.Add(part, "file", "secret-name.webp");
        var request = new HttpRequestMessage(HttpMethod.Post, route + "/media") { Content = form };
        request.Headers.Add("Origin", AdminOrigin);
        request.Headers.Add("Cookie", cookie);
        return request;
    }

    private static SaveCatalogContent SaveBody(CatalogEditorDto dto, string? name = null, int? version = null) =>
        new(version ?? dto.Version, name ?? dto.Name, dto.Description, dto.Address, dto.City, dto.Country, dto.AreaSquareMeters, dto.Bedrooms, dto.BedDescription,
            dto.Gallery.Select(x => new CatalogGalleryInput(x.MediaId, x.AltText, x.IsCover)).ToArray(), dto.AmenityIds);

    private static async Task<CatalogEditorDto> EditorAsync(Env e, string route, string? cookie = null) =>
        JsonSerializer.Deserialize<CatalogEditorDto>(await (await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(route, cookie ?? e.Site)))).Content.ReadAsStringAsync(), Json)!;

    private static async Task<JsonElement> OkAsync(Task<HttpResponseMessage> send) => await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, send));

    private async Task<List<AdminActivity>> RowsAsync()
    {
        await using var db = Factory.CreateDbContext();
        return (await db.AdminActivities.AsNoTracking().Where(row => row.MenuKey == Menu).ToListAsync()).OrderBy(row => row.Sequence).ToList();
    }

    private Task<long> CounterAsync() => ScalarAsync<long>($"""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = '{Menu}' """);

    private string[] CatalogFiles() => Directory.Exists(Path.Combine(Factory.MediaRoot, "catalog")) ? Directory.GetFiles(Path.Combine(Factory.MediaRoot, "catalog")) : [];

    /// <summary>What a refused or failed request must leave exactly as it found it.</summary>
    private async Task<string> StateAsync(Env e) =>
        string.Join('/', await CounterAsync(), (await RowsAsync()).Count, e.Probe.Hints.Count, CatalogFiles().Length,
            await ScalarAsync<int>("""SELECT count(*)::int FROM "Properties" """), await ScalarAsync<int>("""SELECT count(*)::int FROM "RoomTypes" """),
            await ScalarAsync<int>("""SELECT count(*)::int FROM "PhysicalRooms" """), await ScalarAsync<int>("""SELECT count(*)::int FROM "Amenities" """),
            await ScalarAsync<int>("""SELECT count(*)::int FROM "CatalogUploads" """), await ScalarAsync<int>("""SELECT count(*)::int FROM "Media" """),
            await ScalarAsync<int>("""SELECT count(*)::int FROM "CatalogContentAudits" """), await ScalarAsync<int>("""SELECT count(*)::int FROM "AdminCatalogCreateOperations" """),
            await ScalarAsync<long>("""SELECT coalesce(sum("ContentVersion"), 0)::bigint FROM "Properties" """));

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
    public async Task Every_committed_write_appends_one_global_event_by_the_Staff_actor_with_one_menu_only_hint_after_the_commit()
    {
        using var e = await BeginAsync();
        var site = await StaffIdAsync(Site);
        var hints = new List<(string, Guid?)>();

        async Task<AdminActivity> Expect(int total, string action, string kind, string key, string title)
        {
            hints.Add((Menu, null));
            var rows = await RowsAsync();
            Assert.Equal(total, rows.Count);
            var row = rows[^1];
            Assert.Equal((action, kind, key, title, 1), (row.Action, row.EntityKind, row.EntityKey, row.TitleSnapshot, row.ItemCount));
            Assert.Equal((AdminActorKind.Staff, site, (Guid?)null, (Guid?)null), (row.ActorKind, row.ActorStaffId ?? Guid.Empty, row.PropertyId, row.CorrelationId));
            Assert.Equal(total, row.Sequence);
            Assert.Equal(row.Sequence, await CounterAsync());
            Assert.Equal(hints, e.Probe.Hints.ToList());                              // one hint per committed write, in order, with no Property id
            return row;
        }

        var property = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("created-hotel"), e.Site)));
        var propertyId = property.GetProperty("id").GetGuid();
        await Expect(1, "Created", "property", propertyId.ToString("D"), "Hotel Created");

        var roomType = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("SEA-1"), e.Site)));
        var roomTypeId = roomType.GetProperty("roomTypeId").GetGuid();
        await Expect(2, "Created", "room-type", roomTypeId.ToString("D"), "Sea Room");

        var room = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", new { roomNumber = "SECRET-101", floor = 1, operationalStatus = "Active" }, e.Site)));
        await Expect(3, "Created", "physical-room", room.GetProperty("id").GetGuid().ToString("D"), "Physical room");

        var amenity = await OkAsync(e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/amenities", new { code = "POOL-X", name = "Secret pool name", category = "Leisure" }, e.Site)));
        await Expect(4, "Created", "amenity", amenity.GetProperty("id").GetGuid().ToString("D"), "Amenity");

        var propertyEditor = await EditorAsync(e, $"{Root}/properties/{propertyId}");
        await OkAsync(e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/save", SaveBody(propertyEditor, "Hotel Renamed"), e.Site)));
        await Expect(5, "Saved", "property", propertyId.ToString("D"), "Hotel Renamed");

        var roomEditor = await EditorAsync(e, $"{Root}/properties/{propertyId}/room-types/{roomTypeId}");
        await OkAsync(e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/save", SaveBody(roomEditor, "Sea Room II"), e.Site)));
        await Expect(6, "Saved", "room-type", roomTypeId.ToString("D"), "Sea Room II");

        var propertyPicture = await OkAsync(e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}", e.Site)));
        await Expect(7, "PictureUploaded", "property-picture", propertyPicture.GetProperty("mediaId").GetGuid().ToString("D"), "Property picture");
        var roomPicture = await OkAsync(e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}", e.Site)));
        await Expect(8, "PictureUploaded", "room-type-picture", roomPicture.GetProperty("mediaId").GetGuid().ToString("D"), "Room type picture");

        // nothing sensitive reached the history: no description, address, room number, amenity name, file name, URL or path
        var all = string.Join('|', (await RowsAsync()).Select(row => $"{row.Action} {row.EntityKind} {row.EntityKey} {row.TitleSnapshot}"));
        foreach (var secret in new[] { "long description", "Sample Street", "SECRET-101", "Secret pool", "secret-name", "http", "/catalog/" }) Assert.DoesNotContain(secret, all, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_refused_stale_invalid_or_unauthorized_request_and_every_read_record_nothing_and_send_no_hint()
    {
        using var e = await BeginAsync();
        var property = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("base-hotel"), e.Site)));
        var propertyId = property.GetProperty("id").GetGuid();
        var roomType = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("BASE-1"), e.Site)));
        var roomTypeId = roomType.GetProperty("roomTypeId").GetGuid();
        var key = Guid.NewGuid();
        await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", new { roomNumber = "R-1", floor = 1, operationalStatus = "Active" }, e.Site, key)));
        await OkAsync(e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/amenities", new { code = "BASE-A", name = "Base", category = "Leisure" }, e.Site)));
        var editor = await EditorAsync(e, $"{Root}/properties/{propertyId}");
        var before = await StateAsync(e);

        var attempts = new (string Name, HttpStatusCode Expected, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("property validation", HttpStatusCode.BadRequest, () => e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("Bad Slug", ""), e.Site))),
            ("property slug taken", HttpStatusCode.Conflict, () => e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("base-hotel"), e.Site))),
            ("property no key", HttpStatusCode.BadRequest, () => e.Client.SendAsync(Post($"{Root}/properties", PropertyBody("no-key"), e.Site))),
            ("room type validation", HttpStatusCode.BadRequest, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", new { code = "x y", name = "n", slug = "n", baseOccupancy = 2, maxOccupancy = 3, isActive = false }, e.Site))),
            ("room type code taken", HttpStatusCode.Conflict, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("BASE-1", "Other"), e.Site))),
            ("room type unknown property", HttpStatusCode.NotFound, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{Guid.NewGuid()}/room-types", RoomTypeBody("NEW-9"), e.Site))),
            ("physical room validation", HttpStatusCode.BadRequest, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", new { roomNumber = "", floor = 1, operationalStatus = "Active" }, e.Site))),
            ("physical room number taken", HttpStatusCode.Conflict, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", new { roomNumber = "R-1", floor = 2, operationalStatus = "Active" }, e.Site))),
            ("physical room wrong parent", HttpStatusCode.NotFound, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types/{Guid.NewGuid()}/physical-rooms", new { roomNumber = "R-9", floor = 1, operationalStatus = "Active" }, e.Site))),
            ("idempotency key reused for other content", HttpStatusCode.Conflict, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", new { roomNumber = "R-2", floor = 1, operationalStatus = "Active" }, e.Site, key))),
            ("amenity duplicate", HttpStatusCode.Conflict, () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/amenities", new { code = "BASE-A", name = "Again", category = "Leisure" }, e.Site))),
            ("amenity validation", HttpStatusCode.BadRequest, () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/amenities", new { code = "", name = "", category = "" }, e.Site))),
            ("save stale", HttpStatusCode.Conflict, () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/save", SaveBody(editor, "Stale", editor.Version + 5), e.Site))),
            ("save invalid", HttpStatusCode.BadRequest, () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/save", SaveBody(editor, ""), e.Site))),
            ("save unknown owner", HttpStatusCode.NotFound, () => e.Client.SendAsync(Post($"{Root}/properties/{Guid.NewGuid()}/save", SaveBody(editor), e.Site))),
            ("upload not a picture", HttpStatusCode.BadRequest, () => e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}", e.Site, [1, 2, 3, 4]))),
            ("upload unknown owner", HttpStatusCode.NotFound, () => e.Client.SendAsync(UploadRequest($"{Root}/properties/{Guid.NewGuid()}", e.Site))),
            ("FrontDesk without the website permission", HttpStatusCode.Forbidden, () => e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("by-desk"), e.Cookie(Desk)))),
            ("Property-only Manager create", HttpStatusCode.Forbidden, () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("MGR-1"), e.Cookie(Manager)))),
            ("Property-only Manager save", HttpStatusCode.Forbidden, () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/save", SaveBody(editor), e.Cookie(Manager)))),
            ("Property-only Manager upload", HttpStatusCode.Forbidden, () => e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}", e.Cookie(Manager)))),
            ("Property-only Manager amenity", HttpStatusCode.Forbidden, () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/amenities", new { code = "MGR-A", name = "m", category = "c" }, e.Cookie(Manager)))),
            ("list properties", HttpStatusCode.OK, () => e.Client.SendAsync(Get($"{Root}/properties", e.Site))),
            ("list products", HttpStatusCode.OK, () => e.Client.SendAsync(Get($"{Root}/properties/{propertyId}/products", e.Site))),
            ("editor", HttpStatusCode.OK, () => e.Client.SendAsync(Get($"{Root}/properties/{propertyId}", e.Site))),
            ("physical rooms", HttpStatusCode.OK, () => e.Client.SendAsync(Get($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", e.Site))),
        };
        foreach (var (name, expected, send) in attempts)
        {
            var response = await send();
            Assert.True(expected == response.StatusCode, $"{name}: expected {(int)expected}, got {(int)response.StatusCode}");
        }

        Assert.Equal(before, await StateAsync(e));
    }

    // ---------------------------------------------------------------------------------------------------------- idempotent creates: replay and race

    [Fact]
    public async Task The_three_idempotent_creates_record_one_event_counter_step_and_hint_for_a_replay_a_changed_key_and_a_race()
    {
        using var e = await BeginAsync();
        var site = e.Site;

        // Property
        var propertyKey = Guid.NewGuid();
        var property = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("replayed"), site, propertyKey)));
        var propertyId = property.GetProperty("id").GetGuid();
        var afterProperty = await StateAsync(e);
        for (var i = 0; i < 3; i++) Assert.Equal(propertyId, (await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("replayed"), site, propertyKey)))).GetProperty("id").GetGuid());
        Assert.Equal(afterProperty, await StateAsync(e));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("replayed", "Changed name"), site, propertyKey)));
        Assert.Equal(afterProperty, await StateAsync(e));

        // RoomType
        var roomKey = Guid.NewGuid();
        var roomType = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("REP-1"), site, roomKey)));
        var afterRoom = await StateAsync(e);
        for (var i = 0; i < 3; i++) Assert.Equal(roomType.GetProperty("roomTypeId").GetGuid(), (await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("REP-1"), site, roomKey)))).GetProperty("roomTypeId").GetGuid());
        Assert.Equal(afterRoom, await StateAsync(e));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("REP-1", "Other"), site, roomKey)));
        Assert.Equal(afterRoom, await StateAsync(e));

        // PhysicalRoom
        var roomTypeId = roomType.GetProperty("roomTypeId").GetGuid();
        var physicalRoute = $"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms";
        var physicalKey = Guid.NewGuid();
        var physical = await OkAsync(e.Client.SendAsync(CreateRequest(physicalRoute, new { roomNumber = "REP-101", floor = 1, operationalStatus = "Active" }, site, physicalKey)));
        var afterPhysical = await StateAsync(e);
        for (var i = 0; i < 3; i++) Assert.Equal(physical.GetProperty("id").GetGuid(), (await OkAsync(e.Client.SendAsync(CreateRequest(physicalRoute, new { roomNumber = "REP-101", floor = 1, operationalStatus = "Active" }, site, physicalKey)))).GetProperty("id").GetGuid());
        Assert.Equal(afterPhysical, await StateAsync(e));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Client.SendAsync(CreateRequest(physicalRoute, new { roomNumber = "REP-102", floor = 1, operationalStatus = "Active" }, site, physicalKey)));
        Assert.Equal(afterPhysical, await StateAsync(e));
        Assert.Equal(3, (await RowsAsync()).Count);

        // a race: six requests of ONE operation per route arrive together; the advisory lock makes every loser a replay
        async Task Race(string path, object body, string table, string where, int delta)
        {
            var count = await ScalarAsync<int>($"""SELECT count(*)::int FROM "{table}" """);
            var rows = (await RowsAsync()).Count;
            var hints = e.Probe.Hints.Count;
            var key = Guid.NewGuid();
            var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => e.Client.SendAsync(CreateRequest(path, body, site, key))));
            Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
            Assert.Equal(count + delta, await ScalarAsync<int>($"""SELECT count(*)::int FROM "{table}" """));
            Assert.Equal(rows + 1, (await RowsAsync()).Count);
            Assert.Equal(hints + 1, e.Probe.Hints.Count);
            Assert.Equal(await CounterAsync(), (await RowsAsync()).Count);
            Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*)::int FROM "{table}" WHERE {where} """));
        }

        await Race($"{Root}/properties", PropertyBody("raced-property"), "Properties", "\"Slug\" = 'raced-property'", 1);
        await Race($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("RACE-1"), "RoomTypes", "\"Code\" = 'RACE-1'", 1);
        await Race(physicalRoute, new { roomNumber = "RACE-101", floor = 1, operationalStatus = "Active" }, "PhysicalRooms", "\"RoomNumber\" = 'RACE-101'", 1);
    }

    // ---------------------------------------------------------------------------------------------------------- one transaction

    [Fact]
    public async Task A_failing_recorder_rolls_back_every_write_the_counter_and_the_hint_and_removes_a_just_written_picture()
    {
        var probe = new Probe();
        using var e = await BeginAsync(probe);
        var property = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("kept"), e.Site)));
        var propertyId = property.GetProperty("id").GetGuid();
        var roomType = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("KEPT-1"), e.Site)));
        var roomTypeId = roomType.GetProperty("roomTypeId").GetGuid();
        var editor = await EditorAsync(e, $"{Root}/properties/{propertyId}");
        var roomEditor = await EditorAsync(e, $"{Root}/properties/{propertyId}/room-types/{roomTypeId}");
        var before = await StateAsync(e);

        probe.FailRecorder = true;
        var attempts = new (string Name, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("create property", () => e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("lost"), e.Site))),
            ("create room type", () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("LOST-1"), e.Site))),
            ("create physical room", () => e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", new { roomNumber = "L-1", floor = 1, operationalStatus = "Active" }, e.Site))),
            ("create amenity", () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/amenities", new { code = "LOST-A", name = "Lost", category = "c" }, e.Site))),
            ("save property", () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/save", SaveBody(editor, "Changed"), e.Site))),
            ("save room type", () => e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/save", SaveBody(roomEditor, "Changed"), e.Site))),
            ("upload property picture", () => e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}", e.Site))),
            ("upload room type picture", () => e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}", e.Site))),
        };
        foreach (var (name, send) in attempts) Assert.True((await send()).StatusCode == HttpStatusCode.InternalServerError, $"{name} must fail whole");
        probe.FailRecorder = false;

        Assert.Equal(before, await StateAsync(e));                                    // rows, audits, media, counter, hints and files: exactly as they were

        // and the same operations work once the recorder does
        await OkAsync(e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/save", SaveBody(editor, "Changed"), e.Site)));
        Assert.Equal(3, (await RowsAsync()).Count);
    }

    [Fact]
    public async Task A_commit_whose_answer_is_lost_keeps_its_event_and_its_picture_file_and_a_retry_of_the_create_records_nothing_more()
    {
        var interceptor = new LostCommitAnswer();
        using var e = await BeginAsync(more: services => InstallLostCommit(services, Factory.ConnectionString, interceptor));
        var key = Guid.NewGuid();
        var created = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("lost-answer-base"), e.Site)));
        var propertyId = created.GetProperty("id").GetGuid();
        var files = CatalogFiles().Length;

        interceptor.Armed = true;
        Assert.Equal(HttpStatusCode.InternalServerError, (await e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("LOST-2"), e.Site, key))).StatusCode);
        Assert.Equal(HttpStatusCode.InternalServerError, (await e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}", e.Site))).StatusCode);
        interceptor.Armed = false;

        // both really committed: the room type and its event; the upload row, its event, and its file stays (read back AFTER the transaction ended, found recorded)
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*)::int FROM "RoomTypes" WHERE "Code" = 'LOST-2' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*)::int FROM "CatalogUploads" """));
        Assert.Equal(files + 1, CatalogFiles().Length);
        Assert.Equal(["Created", "Created", "PictureUploaded"], (await RowsAsync()).Select(row => row.Action).ToArray());

        // the client retries the create it never heard about: a replay, no second event
        var replay = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("LOST-2"), e.Site, key)));
        Assert.Equal("LOST-2", replay.GetProperty("code").GetString());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*)::int FROM "RoomTypes" WHERE "Code" = 'LOST-2' """));
        Assert.Equal(3, (await RowsAsync()).Count);
        Assert.Equal(await CounterAsync(), 3);
    }

    [Fact]
    public async Task A_picture_is_written_to_disk_before_the_transaction_and_no_counter_row_is_held_meanwhile()
    {
        SpyStorage? storage = null;
        using var e = await BeginAsync(more: services =>
        {
            var real = (ICatalogMediaStorage)services.Single(descriptor => descriptor.ServiceType == typeof(ICatalogMediaStorage)).ImplementationInstance!;
            services.RemoveAll<ICatalogMediaStorage>();
            storage = new SpyStorage(real);
            services.AddSingleton<ICatalogMediaStorage>(storage);
        });
        var created = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("slow-disk"), e.Site)));
        var propertyId = created.GetProperty("id").GetGuid();

        storage!.Parked = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var upload = e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}", e.Site));
        await storage.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.True(await CounterRowIsFreeAsync());                                                                // no counter lock while the file is written
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "CatalogUploads" """));              // and no row yet: the file comes first
        storage.Parked.SetResult(true);
        await AssertStatusAsync(HttpStatusCode.OK, upload);
        Assert.Equal(2, (await RowsAsync()).Count);
    }

    // ---------------------------------------------------------------------------------------------------------- the lists: bare arrays, header, CORS, one snapshot

    [Fact]
    public async Task The_two_lists_keep_their_bare_arrays_and_answer_the_watermark_header_and_only_they_expose_it()
    {
        using var e = await BeginAsync();
        var property = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("listed"), e.Site)));
        var propertyId = property.GetProperty("id").GetGuid();
        await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("LIST-1"), e.Site)));
        var counter = (await CounterAsync()).ToString();

        var properties = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Root}/properties", e.Site, AdminOrigin)));
        Assert.Equal(JsonValueKind.Array, (await JsonAsync(properties)).ValueKind);
        Assert.Contains((await JsonAsync(properties)).EnumerateArray(), item => item.GetProperty("slug").GetString() == "listed");
        var products = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Root}/properties/{propertyId}/products", e.Site, AdminOrigin)));
        var rows = await JsonAsync(products);
        Assert.Equal(JsonValueKind.Array, rows.ValueKind);
        Assert.Equal(["LIST-1"], rows.EnumerateArray().Select(item => item.GetProperty("code").GetString()).ToArray());
        foreach (var response in new[] { properties, products })
        {
            Assert.Equal(counter, Assert.Single(response.Headers.GetValues(Watermark)));
            Assert.Contains(Watermark, string.Join(',', response.Headers.GetValues("Access-Control-Expose-Headers")), StringComparison.OrdinalIgnoreCase);
            Assert.Equal(AdminOrigin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        }

        // an empty products list is still an array with its watermark; an unknown Property keeps its answer
        var empty = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Root}/properties/{Guid.NewGuid()}/products", e.Site, AdminOrigin)));
        Assert.Empty((await JsonAsync(empty)).EnumerateArray());
        Assert.Equal(counter, Assert.Single(empty.Headers.GetValues(Watermark)));

        // no other Catalog read exposes it
        foreach (var path in new[] { $"{Root}/properties/{propertyId}", $"{Root}/properties/{propertyId}/room-types/{Guid.NewGuid()}/physical-rooms" })
        {
            var response = await e.Client.SendAsync(Get(path, e.Site, AdminOrigin));
            Assert.False(response.Headers.Contains(Watermark));
            Assert.DoesNotContain(Watermark, response.Headers.TryGetValues("Access-Control-Expose-Headers", out var exposed) ? string.Join(',', exposed) : string.Empty, StringComparison.OrdinalIgnoreCase);
        }

        // a stranger origin gets nothing; a Staff without the website permission is refused; the create policy keeps Idempotency-Key and exposes nothing
        Assert.False((await e.Client.SendAsync(Get($"{Root}/properties", e.Site, "https://evil.example"))).Headers.Contains("Access-Control-Allow-Origin"));
        foreach (var email in new[] { Desk, Manager })
        {
            var refused = await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get($"{Root}/properties", e.Cookie(email), AdminOrigin)));
            Assert.False(refused.Headers.Contains(Watermark));
            await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get($"{Root}/properties/{propertyId}/products", e.Cookie(email), AdminOrigin)));
        }

        await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Client.SendAsync(Get($"{Root}/properties")));
        var preflight = new HttpRequestMessage(HttpMethod.Options, $"{Root}/properties");
        preflight.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
        preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type, idempotency-key");
        var allowed = await e.Client.SendAsync(preflight);
        Assert.Contains("idempotency-key", string.Join(',', allowed.Headers.GetValues("Access-Control-Allow-Headers")), StringComparison.OrdinalIgnoreCase);
        Assert.False(allowed.Headers.Contains("Access-Control-Expose-Headers"));

        using var local = CreateHost(AdminCalendarAccessMode.LocalGate);
        using var localClient = CreateHttpsClient(local);
        var gone = await localClient.SendAsync(Get($"{Root}/properties", null, AdminOrigin));
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        Assert.False(gone.Headers.Contains(Watermark));
    }

    [Theory]
    [InlineData("properties", "FROM \"MenuActivityStreams\"")]   // paused after the counter: the rows must not be newer than the watermark
    [InlineData("properties", "FROM \"Properties\"")]            // paused after the rows: the watermark must not be newer than the rows
    [InlineData("products", "FROM \"MenuActivityStreams\"")]
    [InlineData("products", "FROM \"RoomTypes\"")]               // paused after the rows and counts: the cover read must still see the same state
    public async Task A_list_never_pairs_rows_with_a_watermark_from_another_moment_when_a_write_commits_in_the_middle(string list, string pauseAfter)
    {
        var barrier = new ArmableBarrier();
        using var e = await BeginAsync(more: services => services.AddScoped(_ => new TheBhaDbContext(
            new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(barrier).Options)));
        var property = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("snap"), e.Site)));
        var propertyId = property.GetProperty("id").GetGuid();
        var roomType = await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("SNAP-1"), e.Site)));
        var roomTypeId = roomType.GetProperty("roomTypeId").GetGuid();
        var picture = await OkAsync(e.Client.SendAsync(UploadRequest($"{Root}/properties/{propertyId}/room-types/{roomTypeId}", e.Site)));
        var roomEditor = await EditorAsync(e, $"{Root}/properties/{propertyId}/room-types/{roomTypeId}");
        var path = list == "properties" ? $"{Root}/properties" : $"{Root}/properties/{propertyId}/products";
        var gate = barrier.Arm(pauseAfter);

        var read = e.Client.SendAsync(Get(path, e.Site));
        await gate.Reached.WaitAsync(TimeSpan.FromSeconds(30));
        var counterBefore = await CounterAsync();
        // commits while the read is paused: a new Property, a new room type, and the picture made the cover of SNAP-1 (the cover read must not see it)
        await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("snap-during"), e.Site)));
        await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{propertyId}/room-types", RoomTypeBody("SNAP-2"), e.Site)));
        var withCover = SaveBody(roomEditor) with { Gallery = [new CatalogGalleryInput(picture.GetProperty("mediaId").GetGuid(), "alt", true)] };
        await OkAsync(e.Client.SendAsync(Post($"{Root}/properties/{propertyId}/room-types/{roomTypeId}/save", withCover, e.Site)));
        var counterAfter = await CounterAsync();
        gate.Release();
        var response = await AssertStatusAsync(HttpStatusCode.OK, read);

        Assert.True(counterAfter > counterBefore);
        var body = await JsonAsync(response);
        var slugs = list == "properties"
            ? body.EnumerateArray().Select(item => item.GetProperty("slug").GetString()!).ToArray()
            : body.EnumerateArray().Select(item => item.GetProperty("code").GetString()!).ToArray();
        if (list == "properties")
        {
            Assert.Contains("snap", slugs);
            Assert.DoesNotContain("snap-during", slugs);                                       // the commit is not in these rows …
        }
        else
        {
            Assert.Equal(["SNAP-1"], slugs);
            var row = body.EnumerateArray().Single();
            Assert.Equal(JsonValueKind.Null, row.GetProperty("coverMediaId").ValueKind);       // … nor in the cover read of the same snapshot
            Assert.Equal(0, row.GetProperty("galleryCount").GetInt32());
        }

        Assert.Equal(counterBefore.ToString(), Assert.Single(response.Headers.GetValues(Watermark)));   // … and the watermark does not claim any of it
    }

    // ---------------------------------------------------------------------------------------------------------- one global cursor, global permission

    [Fact]
    public async Task Catalog_is_global_one_acknowledgement_moves_only_to_the_displayed_lower_watermark_and_a_Property_only_Manager_has_no_Catalog()
    {
        using var e = await BeginAsync();
        async Task<JsonElement> Summary(string cookie) => (await OkAsync(e.Client.SendAsync(Get(Unseen, cookie)))).GetProperty("menus");
        async Task<int> Count(string cookie) => (await Summary(cookie)).TryGetProperty(Menu, out var entry) ? entry.GetProperty("count").GetInt32() : -1;
        Task<HttpResponseMessage> Seen(string cookie, string watermark) => e.Client.SendAsync(Post($"{Unseen}/{Menu}/seen", new { viewWatermark = watermark }, cookie));
        async Task<string> Mark(string path, string cookie) => Assert.Single((await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(path, cookie)))).Headers.GetValues(Watermark));

        // Site creates a second Property B and a room type in it: Peer has NO membership at B and still reads its Catalog
        var b = (await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties", PropertyBody("hotel-b"), e.Site)))).GetProperty("id").GetGuid();
        await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{b}/room-types", RoomTypeBody("B-1"), e.Site)));
        Assert.Equal(2, await Count(e.Cookie(Peer)));                                    // another person's events count, whichever Property they are about
        Assert.Equal(0, await Count(e.Site));                                            // the actor's own do not
        var peerList = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Root}/properties/{b}/products", e.Cookie(Peer))));
        Assert.Single((await JsonAsync(peerList)).EnumerateArray());

        // the Property-only Manager and the FrontDesk have no Catalog: no entry, no read, and an acknowledgement is the same 404 as an unknown menu
        foreach (var email in new[] { Manager, Desk })
        {
            Assert.Equal(-1, await Count(e.Cookie(email)));
            await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get($"{Root}/properties/{b}/products", e.Cookie(email))));
            await AssertStatusAsync(HttpStatusCode.NotFound, Seen(e.Cookie(email), "1"));
        }

        // Peer displays both lists, then another event arrives before it says "seen" with the LOWER mark
        var propertiesMark = await Mark($"{Root}/properties", e.Cookie(Peer));                       // 2
        await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{b}/room-types", RoomTypeBody("B-2"), e.Site)));   // 3
        var productsMark = await Mark($"{Root}/properties/{b}/products", e.Cookie(Peer));            // 3
        Assert.True(BigInteger.Parse(propertiesMark) < BigInteger.Parse(productsMark));
        var lower = BigInteger.Min(BigInteger.Parse(propertiesMark), BigInteger.Parse(productsMark)).ToString();
        var acknowledged = await OkAsync(Seen(e.Cookie(Peer), lower));
        Assert.Equal(1, acknowledged.GetProperty("count").GetInt32());                   // the event after the lower mark stays unread
        Assert.Equal(1, await Count(e.Cookie(Peer)));
        Assert.Equal(lower, acknowledged.GetProperty("lastSeenWatermark").GetString());

        // a later Catalog event from any Property is unread again; the body of the call names no Property; a mark above the counter is refused
        await OkAsync(e.Client.SendAsync(CreateRequest($"{Root}/properties/{e.A}/room-types", RoomTypeBody("A-9"), e.Site)));
        Assert.Equal(2, await Count(e.Cookie(Peer)));
        await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e.Cookie(Peer), (long.Parse(await Mark($"{Root}/properties", e.Cookie(Peer))) + 100).ToString()));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Client.SendAsync(Post($"{Unseen}/{Menu}/seen", new { viewWatermark = lower, propertyId = e.A }, e.Cookie(Peer))));
        await AssertStatusAsync(HttpStatusCode.OK, Seen(e.Cookie(Peer), await Mark($"{Root}/properties", e.Cookie(Peer))));
        Assert.Equal(0, await Count(e.Cookie(Peer)));
    }
}
