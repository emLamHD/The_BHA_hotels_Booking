using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Realtime;
using TheBha.Application.Activity;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;
using Xunit.Abstractions;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR12 (ADR 0011 §D, decision D1/D2): the Calendar writes append ONE <c>calendar</c> event per object they change (a ReservationUnit or a RoomBlock, never a segment), for the
/// verified Staff member of the route's Property, as the last statement before COMMIT, and hint only after it; a real customer cancellation appends one Public event per unit it removes. The board,
/// the Property badge and the unseen list answer the same unread state, and one POST acknowledges exactly one object. Real PostgreSQL, the real HTTP pipeline and the real Staff login; the recorder
/// and the hint are wrapped only to observe, fail or hold them.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class CalendarActivityApiTests(PostgreSqlWebApplicationFactory factory, ITestOutputHelper output) : WebsiteTestSupport(factory)
{
    private const string Unseen = "/api/admin/v1/menu-unseen";
    private const string Outsider = "outsider@example.com";
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6);
    private static readonly DateOnly BlockFrom = new(2026, 9, 10);
    private static readonly DateOnly BlockTo = new(2026, 9, 12);
    private const string Window = "from=2026-09-01&to=2026-09-30";

    /// <summary>Mirrors <c>ReservationBoardDataLoader.OperationalBlocksQueryTag</c> (internal to Infrastructure): the board is paused right after this query, once its snapshot is fixed.</summary>
    private const string OperationalBlocksQueryTag = "pms-cal-004-reservation-board-operational-blocks";

    // ------------------------------------------------------------------------------------------------------ probes

    private sealed class Probe
    {
        public readonly ConcurrentQueue<(string Menu, Guid? Property)> Hints = [];
        public volatile bool FailRecorder;
        private TaskCompletionSource<bool>? _hold;
        public readonly TaskCompletionSource<bool> Held = new(TaskCreationOptions.RunContinuationsAsynchronously);

        /// <summary>The NEXT recorder call parks after the counter moved (it still holds the counter row) until the returned source is completed.</summary>
        public TaskCompletionSource<bool> HoldNextRecord() => _hold = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task AfterRecordAsync()
        {
            if (Interlocked.Exchange(ref _hold, null) is { } hold)
            {
                Held.TrySetResult(true);
                await hold.Task;
            }

            if (FailRecorder) throw new InvalidOperationException("Injected recorder failure after the counter moved.");
        }

        public void Install(IServiceCollection services)
        {
            var recorder = services.Single(descriptor => descriptor.ServiceType == typeof(IAdminActivityRecorder)).ImplementationType!;
            services.RemoveAll<IAdminActivityRecorder>();
            services.AddScoped<IAdminActivityRecorder>(provider => new ProbeRecorder((IAdminActivityRecorder)ActivatorUtilities.CreateInstance(provider, recorder), this));
            services.RemoveAll<IAdminActivityHint>();
            services.AddScoped<IAdminActivityHint>(provider => new HintSpy(ActivatorUtilities.CreateInstance<AdminActivityHint>(provider), Hints));
        }
    }

    private sealed class ProbeRecorder(IAdminActivityRecorder inner, Probe probe) : IAdminActivityRecorder
    {
        public async Task RecordAsync(AdminActivityEntry entry, CancellationToken cancellationToken)
        {
            await inner.RecordAsync(entry, cancellationToken);
            await probe.AfterRecordAsync();
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

    /// <summary>The shared board barrier, switched on only when a test wants it, so seeding and writes of the same host are not paused.</summary>
    private sealed class ArmableBarrier : DbCommandInterceptor
    {
        private volatile ReservationBoardSnapshotBarrierInterceptor? _inner;

        public ReservationBoardSnapshotBarrierInterceptor Arm(string tag) => _inner = new ReservationBoardSnapshotBarrierInterceptor(tag);

        public override ValueTask<System.Data.Common.DbDataReader> ReaderExecutedAsync(
            System.Data.Common.DbCommand command, CommandExecutedEventData eventData, System.Data.Common.DbDataReader result, CancellationToken cancellationToken = default) =>
            _inner is { } inner ? inner.ReaderExecutedAsync(command, eventData, result, cancellationToken) : ValueTask.FromResult(result);
    }

    /// <summary>
    /// Pauses the FIRST read that follows the cursor upsert of an entity acknowledgement, after PostgreSQL has executed it (its snapshot is fixed) and before the application has used the result. A
    /// response built from several reads is torn by a commit made in that gap; one built from one statement is not. Armed by the upsert itself, so seeding and other requests are never paused.
    /// </summary>
    private sealed class AfterEntitySeenUpsert : DbCommandInterceptor
    {
        private readonly TaskCompletionSource _reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _armed, _tripped;

        public Task Reached => _reached.Task;
        public void Release() => _released.TrySetResult();

        public override ValueTask<int> NonQueryExecutedAsync(System.Data.Common.DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("INSERT INTO \"StaffEntitySeen\"", StringComparison.Ordinal)) Volatile.Write(ref _armed, 1);
            return ValueTask.FromResult(result);
        }

        public override async ValueTask<System.Data.Common.DbDataReader> ReaderExecutedAsync(
            System.Data.Common.DbCommand command, CommandExecutedEventData eventData, System.Data.Common.DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (Volatile.Read(ref _armed) == 1 && Interlocked.Exchange(ref _tripped, 1) == 0)
            {
                _reached.TrySetResult();
                await _released.Task.WaitAsync(cancellationToken);
            }

            return result;
        }
    }

    private sealed record Seed(Guid A, Guid B, Guid[] Standard, Guid[] Deluxe, Guid[] Units, Guid RoomB, Guid UnitB, Guid ReservationA, string TokenA);

    private sealed class Env(WebApplicationFactory<Program> host, HttpClient client, Seed seed, Dictionary<string, string> cookies, Probe probe) : IDisposable
    {
        public WebApplicationFactory<Program> Host { get; } = host;
        public HttpClient Client { get; } = client;
        public Seed Seed { get; } = seed;
        public Probe Probe { get; } = probe;
        public string Cookie(string email) => cookies[email];
        public void Add(string email, string cookie) => cookies[email] = cookie;
        public void Dispose()
        {
            Client.Dispose();
            Host.Dispose();
        }
    }

    // ------------------------------------------------------------------------------------------------------ plumbing

    /// <summary>Property A: Desk (FrontDesk), Manager (Manager). Property B: Outsider (Manager). Every account is a day old, so an event recorded now is after the D2 baseline.</summary>
    private async Task<Env> BeginAsync(Probe? probe = null, Action<IServiceCollection>? more = null, bool tightLockTimeout = false)
    {
        probe ??= new Probe();
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, "Staff");
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.ConfigureServices(services =>
            {
                probe.Install(services);
                more?.Invoke(services);
            });
        });
        var seed = await SeedAsync();
        if (tightLockTimeout)
        {
            // lock_timeout (30 s) above deadlock_timeout (1 s): a real lock cycle is reported as 40P01 after about a second and cannot hide as a 55P03 timeout.
            await using var admin = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(Factory.ConnectionString) { Database = "postgres", Pooling = false }.ConnectionString);
            await admin.OpenAsync();
            await using var alter = new NpgsqlCommand($"""ALTER DATABASE "{Factory.DatabaseName}" SET lock_timeout = '30s'""", admin);
            await alter.ExecuteNonQueryAsync();
        }

        await CliAsync(host, ["--staff-create", "--email", Desk, "--property-id", seed.A.ToString(), "--role", StaffRole.FrontDesk], Password);
        await CliAsync(host, ["--staff-create", "--email", Manager, "--property-id", seed.A.ToString(), "--role", StaffRole.Manager], Password);
        await CliAsync(host, ["--staff-create", "--email", Outsider, "--property-id", seed.B.ToString(), "--role", StaffRole.Manager], Password);
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CreatedAtUtc" = "CreatedAtUtc" - interval '1 day' """);
        var client = CreateHttpsClient(host);
        var cookies = new Dictionary<string, string>();
        foreach (var email in new[] { Desk, Manager, Outsider }) cookies[email] = await LoginAsync(client, email);
        return new Env(host, client, seed, cookies, probe);
    }

    private async Task<Seed> SeedAsync()
    {
        await Factory.ResetDatabaseAsync();
        Factory.Clock.UtcNow = Now;
        await using var context = Factory.CreateDbContext();
        var a = NewProperty("a");
        var standard = new RoomType(Guid.NewGuid(), a.Id, "PR12S", "Standard", "pr12-s", null, 2, 4, true, Now);
        var deluxe = new RoomType(Guid.NewGuid(), a.Id, "PR12D", "Deluxe", "pr12-d", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), a.Id, "PR12", "pr12", null, "VND", true, Now);
        var standardRooms = Enumerable.Range(0, 4).Select(index => new PhysicalRoom(Guid.NewGuid(), a.Id, standard, $"S{index}", 1, OperationalStatus.Active, Now)).ToList();
        var deluxeRooms = Enumerable.Range(0, 2).Select(index => new PhysicalRoom(Guid.NewGuid(), a.Id, deluxe, $"D{index}", 1, OperationalStatus.Active, Now)).ToList();
        context.AddRange(a, standard, deluxe, ratePlan);
        context.AddRange(standardRooms.Concat(deluxeRooms));

        var b = NewProperty("b");
        var typeB = new RoomType(Guid.NewGuid(), b.Id, "PR12B", "Standard", "pr12-b", null, 2, 4, true, Now);
        var ratePlanB = new RatePlan(Guid.NewGuid(), b.Id, "PR12B", "pr12b", null, "VND", true, Now);
        var roomB = new PhysicalRoom(Guid.NewGuid(), b.Id, typeB, "B0", 1, OperationalStatus.Active, Now);
        context.AddRange(b, typeB, ratePlanB, roomB);

        var (unitsA, reservationA, tokenA) = Reserve(context, a.Id, standard.Id, ratePlan.Id, 2, "a");
        var (unitsB, _, _) = Reserve(context, b.Id, typeB.Id, ratePlanB.Id, 1, "b");
        await context.SaveChangesAsync();
        return new Seed(a.Id, b.Id, standardRooms.Select(room => room.Id).ToArray(), deluxeRooms.Select(room => room.Id).ToArray(), unitsA, roomB.Id, unitsB[0], reservationA, tokenA);

        static Property NewProperty(string slug) => new(
            Guid.NewGuid(), $"Hotel {slug}", $"pr12-{slug}", null, "1 Hotel Street", "Da Nang", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
    }

    private static (Guid[] Units, Guid ReservationId, string Token) Reserve(TheBhaDbContext context, Guid propertyId, Guid roomTypeId, Guid ratePlanId, int units, string slug)
    {
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber).Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlanId, 100m)).ToArray();
        var token = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes($"pr12-{slug}"))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var hold = new InventoryHold(
            Guid.NewGuid(), propertyId, roomTypeId, units, null, "Fixture Guest", "fixture@example.com", "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash($"pr12-{slug}:idempotency"), HexHash($"pr12-{slug}:fingerprint"), HexHash(token), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-PR12-{slug.ToUpperInvariant()}", Now);
        context.Add(reservation);
        return (reservation.Units.Select(unit => unit.Id).ToArray(), reservation.Id, token);
    }

    private static string HexHash(string seed) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private static string AssignUrl(Guid property) => $"/api/admin/v1/properties/{property}/reservation-assignments";
    private static string BlockUrl(Guid property) => $"/api/admin/v1/properties/{property}/operational-blocks";

    private Task<HttpResponseMessage> Send(Env e, string who, string path, object body) => e.Client.SendAsync(Post(path, body, e.Cookie(who)));

    private async Task<JsonElement> Ok(Env e, string who, string path, object body, HttpStatusCode status = HttpStatusCode.OK) =>
        await JsonAsync(await AssertStatusAsync(status, Send(e, who, path, body)));

    private static object CreateBody(Guid unit, Guid room, DateOnly? start = null, DateOnly? end = null) =>
        new { reservationUnitId = unit, physicalRoomId = room, startDate = start ?? CheckIn, endDate = end ?? CheckOut };

    private static object BlockBody(Guid room, DateOnly? start = null, DateOnly? end = null) =>
        new { physicalRoomId = room, startDate = start ?? BlockFrom, endDate = end ?? BlockTo, reason = "Burst pipe" };

    /// <summary>Creates an assignment of <paramref name="unit"/> over its whole stay; returns the segment's (id, version).</summary>
    private async Task<(Guid Id, uint Version)> AssignAsync(Env e, string who, Guid unit, Guid room)
    {
        var segment = await Ok(e, who, AssignUrl(e.Seed.A), CreateBody(unit, room), HttpStatusCode.Created);
        return (segment.GetProperty("id").GetGuid(), segment.GetProperty("version").GetUInt32());
    }

    private async Task<(Guid Block, Guid Segment, uint Version)> BlockAsync(Env e, string who, Guid property, Guid room, DateOnly? start = null, DateOnly? end = null)
    {
        var created = await Ok(e, who, BlockUrl(property), BlockBody(room, start, end), HttpStatusCode.Created);
        var segment = created.GetProperty("segment");
        return (created.GetProperty("roomBlockId").GetGuid(), segment.GetProperty("id").GetGuid(), segment.GetProperty("version").GetUInt32());
    }

    /// <summary>The guest cancels through the real customer route: its own cookie jar, the antiforgery pair, and the booking access token as the only credential.</summary>
    private async Task<HttpResponseMessage> CancelAsync(Env e, string? token, string reason)
    {
        using var guest = e.Host.CreateClient();
        var csrf = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, guest.GetAsync("/api/v1/auth/csrf")));
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/reservations/{e.Seed.ReservationA}/cancel") { Content = JsonContent.Create(new { reason }) };
        if (token is not null) request.Headers.Add("X-Booking-Access-Token", token);
        request.Headers.Add(csrf.GetProperty("headerName").GetString()!, csrf.GetProperty("token").GetString()!);
        return await guest.SendAsync(request);
    }

    private Task<long> CounterAsync() => ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'calendar' """);

    private async Task<List<AdminActivity>> RowsAsync()
    {
        await using var context = Factory.CreateDbContext();
        return await context.AdminActivities.AsNoTracking().Where(row => row.MenuKey == "calendar").OrderBy(row => row.Sequence).ToListAsync();
    }

    private async Task<JsonElement> ReadAsync(Env e, string who, string path) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(path, e.Cookie(who)))));

    private Task<JsonElement> BoardAsync(Env e, string who, Guid property, string window = Window) => ReadAsync(e, who, $"/api/admin/v1/properties/{property}/reservation-board?{window}");
    private Task<JsonElement> ChangesAsync(Env e, string who, Guid property) => ReadAsync(e, who, $"{Unseen}/calendar/changes?propertyId={property}");

    private async Task<(int Count, string Current)> BadgeAsync(Env e, string who, Guid property)
    {
        var summary = await ReadAsync(e, who, Unseen);
        var entry = summary.GetProperty("menus").GetProperty("calendar").GetProperty("byProperty").EnumerateArray().Single(row => row.GetProperty("propertyId").GetGuid() == property);
        return (entry.GetProperty("count").GetInt32(), entry.GetProperty("currentWatermark").GetString()!);
    }

    private static JsonElement StayOf(JsonElement board, Guid unit) => board.GetProperty("stays").EnumerateArray().Single(stay => stay.GetProperty("reservationUnitId").GetGuid() == unit);
    private static JsonElement GroupOf(JsonElement changes, Guid entity) => changes.GetProperty("groups").EnumerateArray().Single(group => group.GetProperty("entityId").GetString() == entity.ToString("D"));

    private Task<HttpResponseMessage> EntitySeen(Env e, string who, object body) => e.Client.SendAsync(Post($"{Unseen}/calendar/entities/seen", body, e.Cookie(who)));
    private static object SeenBody(Guid property, string kind, Guid entity, string watermark) => new { propertyId = property, entityKind = kind, entityId = entity, observedWatermark = watermark };

    /// <summary>Everything a refused or failed write must leave exactly as it found it.</summary>
    private async Task<string> StateAsync(Env e) =>
        await ScalarAsync<string>(
            """
            SELECT (SELECT string_agg(s."Id"::text || s."Status" || s."PhysicalRoomId"::text || s.xmin::text, ',' ORDER BY s."Id") FROM "RoomOccupancySegments" s) || '|' ||
                   (SELECT count(*) FROM "RoomOccupancySegmentAudits") || '|' || (SELECT count(*) FROM "RoomBlocks") || '|' ||
                   (SELECT string_agg("Status", ',' ORDER BY "Id") FROM "Reservations") || '|' || (SELECT string_agg("CommitmentStatus", ',' ORDER BY "Id") FROM "ReservationUnits") || '|' ||
                   (SELECT count(*) FROM "AdminActivities") || '|' || (SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'calendar')
            """) + "|hints:" + e.Probe.Hints.Count;

    // ------------------------------------------------------------------------------------------------------ the seven Staff writes

    [Fact]
    public async Task The_seven_Staff_writes_each_append_one_event_for_the_object_with_the_Staff_actor_and_hint_after_commit()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        var deskId = await StaffIdAsync(Desk);
        var unit = s.Units[0];

        var (segment, version) = await AssignAsync(e, Desk, unit, s.Standard[0]);                                                                       // 1 create
        var moved = await Ok(e, Desk, $"{AssignUrl(s.A)}/{segment}/move", new { expectedVersion = version, physicalRoomId = s.Standard[1], startDate = CheckIn, endDate = CheckOut });   // 2 move
        var second = moved.EnumerateArray().Last();
        await Ok(e, Desk, $"{AssignUrl(s.A)}/{second.GetProperty("id").GetGuid()}/unassign", new { expectedVersion = second.GetProperty("version").GetUInt32() });  // 3 unassign

        // An unassign moves the object to the unassigned lane: it is NOT removed, whatever its old segment did.
        var afterUnassign = await ChangesAsync(e, Manager, s.A);
        Assert.Equal("OnBoard", GroupOf(afterUnassign, unit).GetProperty("presence").GetString());

        var (again, againVersion) = await AssignAsync(e, Desk, unit, s.Standard[0]);
        await Ok(e, Desk, $"{AssignUrl(s.A)}/{again}/split-move", new { expectedVersion = againVersion, splitDate = CheckIn.AddDays(2), destinationPhysicalRoomId = s.Standard[1] });   // 4 split-move
        var block = await BlockAsync(e, Desk, s.A, s.Standard[2]);                                                                                     // 5 block create
        var movedBlock = await Ok(e, Desk, $"{BlockUrl(s.A)}/{block.Segment}/move", new { expectedVersion = block.Version, destinationPhysicalRoomId = s.Standard[3] });   // 6 block move
        var blockNow = movedBlock.EnumerateArray().Last();
        await Ok(e, Desk, $"{BlockUrl(s.A)}/{blockNow.GetProperty("id").GetGuid()}/cancel", new { expectedVersion = blockNow.GetProperty("version").GetUInt32() });   // 7 block cancel

        var rows = await RowsAsync();
        Assert.Equal(
            [("Assigned", "reservation-unit", unit), ("Moved", "reservation-unit", unit), ("Unassigned", "reservation-unit", unit), ("Assigned", "reservation-unit", unit),
             ("SplitMoved", "reservation-unit", unit), ("Created", "room-block", block.Block), ("Moved", "room-block", block.Block), ("Cancelled", "room-block", block.Block)],
            rows.Select(row => (row.Action, row.EntityKind, Guid.Parse(row.EntityKey))).ToArray());
        Assert.Equal(Enumerable.Range(1, 8).Select(i => (long)i), rows.Select(row => row.Sequence));
        Assert.All(rows, row =>
        {
            Assert.Equal((AdminActorKind.Staff, (Guid?)deskId, (Guid?)s.A), (row.ActorKind, row.ActorStaffId, row.PropertyId));
            Assert.Null(row.CorrelationId);
        });
        Assert.Equal("Room S0 2026-09-01 to 2026-09-06", rows[0].TitleSnapshot);
        Assert.Equal("Room S1 2026-09-01 to 2026-09-06", rows[1].TitleSnapshot);
        Assert.Equal("Unassigned 2026-09-01 to 2026-09-06", rows[2].TitleSnapshot);
        Assert.Equal("Room S0 / S1 2026-09-01 to 2026-09-06", rows[4].TitleSnapshot);
        Assert.Equal("Room S2 2026-09-10 to 2026-09-12", rows[5].TitleSnapshot);
        Assert.Equal("Room S3 2026-09-10 to 2026-09-12", rows[7].TitleSnapshot);
        // Safe snapshots only: no guest, reservation code, free-text reason, e-mail or phone.
        Assert.All(rows, row =>
        {
            foreach (var secret in new[] { "Fixture Guest", "BHA-PR12", "Burst pipe", "@", "+84", "fixture" }) Assert.DoesNotContain(secret, row.TitleSnapshot, StringComparison.OrdinalIgnoreCase);
        });
        Assert.Equal(Enumerable.Repeat(("calendar", (Guid?)s.A), 8), e.Probe.Hints.ToArray());

        // Eight events, two objects: the unit is one unread object however many writes touched it, and the cancelled block has LEFT the board but is still unread, as Removed.
        var changes = await ChangesAsync(e, Manager, s.A);
        Assert.Equal(2, changes.GetProperty("unseenEvents").GetInt32());
        Assert.Equal("OnBoard", GroupOf(changes, unit).GetProperty("presence").GetString());
        Assert.Equal("Removed", GroupOf(changes, block.Block).GetProperty("presence").GetString());
        Assert.Equal(5, GroupOf(changes, unit).GetProperty("events").GetInt32());
        Assert.Equal((2, "8"), await BadgeAsync(e, Manager, s.A));
        Assert.Equal("8", GroupOf(changes, block.Block).GetProperty("observedWatermark").GetString());
        // The Staff member's OWN events never count for them.
        Assert.Equal(0, (await BadgeAsync(e, Desk, s.A)).Count);
    }

    [Fact]
    public async Task A_refusal_a_stale_write_and_a_missing_target_append_nothing_and_send_no_hint()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        var (segment, version) = await AssignAsync(e, Desk, s.Units[0], s.Standard[0]);
        var block = await BlockAsync(e, Desk, s.A, s.Standard[2]);
        var before = await StateAsync(e);
        var stale = version + 100;

        var attempts = new (string Name, HttpStatusCode Expected, Task<HttpResponseMessage> Send)[]
        {
            ("stale move", HttpStatusCode.Conflict, Send(e, Desk, $"{AssignUrl(s.A)}/{segment}/move", new { expectedVersion = stale, physicalRoomId = s.Standard[1], startDate = CheckIn, endDate = CheckOut })),
            ("stale unassign", HttpStatusCode.Conflict, Send(e, Desk, $"{AssignUrl(s.A)}/{segment}/unassign", new { expectedVersion = stale })),
            ("stale split", HttpStatusCode.Conflict, Send(e, Desk, $"{AssignUrl(s.A)}/{segment}/split-move", new { expectedVersion = stale, splitDate = CheckIn.AddDays(2), destinationPhysicalRoomId = s.Standard[1] })),
            ("stale block move", HttpStatusCode.Conflict, Send(e, Desk, $"{BlockUrl(s.A)}/{block.Segment}/move", new { expectedVersion = block.Version + 100, destinationPhysicalRoomId = s.Standard[3] })),
            ("stale block cancel", HttpStatusCode.Conflict, Send(e, Desk, $"{BlockUrl(s.A)}/{block.Segment}/cancel", new { expectedVersion = block.Version + 100 })),
            ("cross-type without confirmation", HttpStatusCode.Forbidden, Send(e, Desk, AssignUrl(s.A), CreateBody(s.Units[1], s.Deluxe[0]))),
            ("unknown unit", HttpStatusCode.NotFound, Send(e, Desk, AssignUrl(s.A), CreateBody(Guid.NewGuid(), s.Standard[1]))),
            ("overlapping block", HttpStatusCode.Conflict, Send(e, Desk, BlockUrl(s.A), BlockBody(s.Standard[2]))),
            ("a Property without membership", HttpStatusCode.Forbidden, Send(e, Desk, BlockUrl(s.B), BlockBody(s.RoomB))),
            ("no session", HttpStatusCode.Unauthorized, e.Client.SendAsync(Post(BlockUrl(s.A), BlockBody(s.Standard[1]))))
        };
        foreach (var (name, expected, send) in attempts)
        {
            var response = await send;
            Assert.True(expected == response.StatusCode, $"{name}: expected {(int)expected}, got {(int)response.StatusCode}");
        }

        Assert.Equal(before, await StateAsync(e));
        Assert.Equal(2, (await RowsAsync()).Count);
        Assert.Equal(2, e.Probe.Hints.Count);
    }

    [Fact]
    public async Task A_recorder_that_fails_after_the_counter_moved_rolls_back_every_write_and_the_cancellation()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        var (segment, version) = await AssignAsync(e, Desk, s.Units[0], s.Standard[0]);
        var block = await BlockAsync(e, Desk, s.A, s.Standard[2]);
        var before = await StateAsync(e);

        e.Probe.FailRecorder = true;
        var attempts = new (string Name, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("create", () => Send(e, Desk, AssignUrl(s.A), CreateBody(s.Units[1], s.Standard[1]))),
            ("move", () => Send(e, Desk, $"{AssignUrl(s.A)}/{segment}/move", new { expectedVersion = version, physicalRoomId = s.Standard[1], startDate = CheckIn, endDate = CheckOut })),
            ("unassign", () => Send(e, Desk, $"{AssignUrl(s.A)}/{segment}/unassign", new { expectedVersion = version })),
            ("split-move", () => Send(e, Desk, $"{AssignUrl(s.A)}/{segment}/split-move", new { expectedVersion = version, splitDate = CheckIn.AddDays(2), destinationPhysicalRoomId = s.Standard[1] })),
            ("block create", () => Send(e, Desk, BlockUrl(s.A), BlockBody(s.Standard[3]))),
            ("block move", () => Send(e, Desk, $"{BlockUrl(s.A)}/{block.Segment}/move", new { expectedVersion = block.Version, destinationPhysicalRoomId = s.Standard[3] })),
            ("block cancel", () => Send(e, Desk, $"{BlockUrl(s.A)}/{block.Segment}/cancel", new { expectedVersion = block.Version })),
            ("customer cancellation", () => CancelAsync(e, s.TokenA, "Change of plans"))
        };
        foreach (var (name, send) in attempts)
        {
            Assert.True((await send()).StatusCode == HttpStatusCode.InternalServerError, $"{name} must fail whole");
        }

        e.Probe.FailRecorder = false;
        Assert.Equal(before, await StateAsync(e));   // segments (with xmin), audits, blocks, reservations, units, rows, counter and hints are exactly as they were

        // And the same writes work once the recorder does: nothing was left half done.
        await Ok(e, Desk, $"{BlockUrl(s.A)}/{block.Segment}/cancel", new { expectedVersion = block.Version });
        Assert.Equal(3, (await RowsAsync()).Count);
    }

    // ------------------------------------------------------------------------------------------------------ customer cancellation

    [Fact]
    public async Task A_customer_cancellation_records_one_Public_event_per_removed_unit_and_a_replay_or_foreign_token_records_nothing()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        await AssignAsync(e, Desk, s.Units[0], s.Standard[0]);   // one unit is placed, the other is unassigned: both leave the board
        var hintsBefore = e.Probe.Hints.Count;
        var counterBefore = await CounterAsync();

        var foreign = await CancelAsync(e, "A" + s.TokenA[1..], "x");
        Assert.NotEqual(HttpStatusCode.OK, foreign.StatusCode);
        Assert.Equal((counterBefore, hintsBefore), (await CounterAsync(), e.Probe.Hints.Count));

        var cancelled = await CancelAsync(e, s.TokenA, "Change of plans");
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        var rows = (await RowsAsync()).Skip(1).ToList();
        Assert.Equal(s.Units.Order().Select(unit => unit.ToString("D")), rows.Select(row => row.EntityKey));
        Assert.All(rows, row =>
        {
            Assert.Equal((AdminActorKind.Public, (Guid?)null, "Cancelled", "reservation-unit", (Guid?)s.A), (row.ActorKind, row.ActorStaffId, row.Action, row.EntityKind, row.PropertyId));
            Assert.Equal("Reservation 2026-09-01 to 2026-09-06", row.TitleSnapshot);
        });
        Assert.Equal(hintsBefore + 1, e.Probe.Hints.Count);   // one hint for the Property, not one per unit

        // Replay: the same answer, and no event, no counter move, no hint.
        var counter = await CounterAsync();
        var replay = await CancelAsync(e, s.TokenA, "Change of plans");
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal((counter, hintsBefore + 1), (await CounterAsync(), e.Probe.Hints.Count));

        // Both objects have left the board and are still unread, as Removed, for BOTH Staff members (a Public event counts for everyone, the Staff member who assigned one included).
        Assert.Empty((await BoardAsync(e, Manager, s.A)).GetProperty("stays").EnumerateArray());
        foreach (var who in new[] { Manager, Desk })
        {
            var changes = await ChangesAsync(e, who, s.A);
            Assert.Equal(2, changes.GetProperty("unseenEvents").GetInt32());
            Assert.All(changes.GetProperty("groups").EnumerateArray(), group => Assert.Equal("Removed", group.GetProperty("presence").GetString()));
        }
    }

    // ------------------------------------------------------------------------------------------------------ the board, the badge and the list say the same thing

    [Fact]
    public async Task The_board_carries_one_state_per_object_additively_and_it_equals_the_badge_and_the_list()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        var (segment, version) = await AssignAsync(e, Desk, s.Units[0], s.Standard[0]);
        await Ok(e, Desk, $"{AssignUrl(s.A)}/{segment}/split-move", new { expectedVersion = version, splitDate = CheckIn.AddDays(2), destinationPhysicalRoomId = s.Standard[1] });
        await BlockAsync(e, Desk, s.A, s.Standard[2]);

        var board = await BoardAsync(e, Manager, s.A);
        var stay = StayOf(board, s.Units[0]);
        Assert.Equal(2, stay.GetProperty("assignments").GetArrayLength());                               // a split unit: two segments, two lanes …
        Assert.True(stay.GetProperty("activity").GetProperty("unread").GetBoolean());                    // … one state
        Assert.Equal(JsonValueKind.String, stay.GetProperty("activity").GetProperty("watermark").ValueKind);
        Assert.Equal("2", stay.GetProperty("activity").GetProperty("watermark").GetString());
        var other = StayOf(board, s.Units[1]).GetProperty("activity");                                    // an object nobody touched is read, watermark "0"
        Assert.Equal((false, "0"), (other.GetProperty("unread").GetBoolean(), other.GetProperty("watermark").GetString()));
        var barBlock = board.GetProperty("operationalBlocks").EnumerateArray().Single();
        Assert.Equal((true, "3"), (barBlock.GetProperty("activity").GetProperty("unread").GetBoolean(), barBlock.GetProperty("activity").GetProperty("watermark").GetString()));

        var objects = board.GetProperty("stays").EnumerateArray().Select(item => ("u" + item.GetProperty("reservationUnitId").GetGuid(), item.GetProperty("activity")))
            .Concat(board.GetProperty("operationalBlocks").EnumerateArray().Select(item => ("b" + item.GetProperty("roomBlockId").GetGuid(), item.GetProperty("activity"))));
        var unread = objects.Where(item => item.Item2.GetProperty("unread").GetBoolean()).Select(item => item.Item1).Distinct().Count();
        Assert.Equal(2, unread);
        Assert.Equal(unread, (await BadgeAsync(e, Manager, s.A)).Count);
        Assert.Equal(unread, (await ChangesAsync(e, Manager, s.A)).GetProperty("unseenEvents").GetInt32());

        // The writer's own events are not unread for the writer: the same objects, the same board, no unread.
        Assert.All((await BoardAsync(e, Desk, s.A)).GetProperty("stays").EnumerateArray(), item => Assert.False(item.GetProperty("activity").GetProperty("unread").GetBoolean()));

        // LocalGate and any caller without a Staff session get the board exactly as before: no activity property at all.
        using var local = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, "LocalGate");
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedRead", "true");
        });
        using var localClient = local.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        var plain = await AssertStatusAsync(HttpStatusCode.OK, localClient.GetAsync($"/api/admin/v1/properties/{s.A}/reservation-board?{Window}"));
        Assert.DoesNotContain("\"activity\"", await plain.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_object_outside_the_date_window_is_still_OnBoard_and_a_window_without_it_shows_no_state()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        await AssignAsync(e, Desk, s.Units[0], s.Standard[0]);
        await BlockAsync(e, Desk, s.A, s.Standard[2]);

        var october = await BoardAsync(e, Manager, s.A, "from=2026-10-01&to=2026-10-15");
        Assert.Empty(october.GetProperty("stays").EnumerateArray());
        Assert.Empty(october.GetProperty("operationalBlocks").EnumerateArray());
        var changes = await ChangesAsync(e, Manager, s.A);
        Assert.All(changes.GetProperty("groups").EnumerateArray(), group => Assert.Equal("OnBoard", group.GetProperty("presence").GetString()));
        Assert.Equal(2, changes.GetProperty("groups").GetArrayLength());
    }

    [Fact]
    public async Task Property_B_is_invisible_to_a_Staff_member_of_A_and_the_other_way_round_and_D2_hides_what_happened_before_the_account()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        await AssignAsync(e, Desk, s.Units[0], s.Standard[0]);
        await BlockAsync(e, Outsider, s.B, s.RoomB);

        // Manager of A: A only. Outsider (Manager of B): B only.
        var manager = (await ReadAsync(e, Manager, Unseen)).GetProperty("menus").GetProperty("calendar");
        Assert.Equal([s.A], manager.GetProperty("byProperty").EnumerateArray().Select(row => row.GetProperty("propertyId").GetGuid()));
        var outsider = (await ReadAsync(e, Outsider, Unseen)).GetProperty("menus").GetProperty("calendar");
        Assert.Equal([s.B], outsider.GetProperty("byProperty").EnumerateArray().Select(row => row.GetProperty("propertyId").GetGuid()));
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Client.SendAsync(Get($"{Unseen}/calendar/changes?propertyId={s.B}", e.Cookie(Manager))));
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Client.SendAsync(Get($"{Unseen}/calendar/changes?propertyId={s.A}", e.Cookie(Outsider))));
        await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Get($"/api/admin/v1/properties/{s.A}/reservation-board?{Window}", e.Cookie(Outsider))));

        // D2: a Staff account created AFTER those events starts at 0; a new event is theirs, and the history still shows everything.
        Factory.Clock.UtcNow = Now.AddMinutes(5);   // small step: the Staff sessions made at Now must stay valid
        await CliAsync(e.Host, ["--staff-create", "--email", "late@example.com", "--property-id", s.A.ToString(), "--role", StaffRole.Manager], Password);
        e.Add("late@example.com", await LoginAsync(e.Client, "late@example.com"));
        Assert.Equal(0, (await BadgeAsync(e, "late@example.com", s.A)).Count);
        await BlockAsync(e, Desk, s.A, s.Standard[2]);
        Assert.Equal(1, (await BadgeAsync(e, "late@example.com", s.A)).Count);
        var history = await ReadAsync(e, "late@example.com", $"/api/admin/v1/activity?menu=calendar&propertyId={s.A}");
        Assert.Equal(2, history.GetProperty("items").GetArrayLength());
        Assert.All(history.GetProperty("items").EnumerateArray(), item => Assert.DoesNotContain("Fixture", item.GetProperty("titleSnapshot").GetString()!));
    }

    // ------------------------------------------------------------------------------------------------------ acknowledging one object

    [Fact]
    public async Task An_acknowledgement_moves_one_object_to_the_watermark_it_observed_and_nothing_else()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        var unit = s.Units[0];
        var (segment, version) = await AssignAsync(e, Desk, unit, s.Standard[0]);
        var block = await BlockAsync(e, Desk, s.A, s.Standard[2]);
        var seenBefore = await ScalarAsync<int>("""SELECT count(*)::int FROM "StaffEntitySeen" """);

        // GETs never write: the board, the badge, the list and the history leave every cursor row alone.
        var board = await BoardAsync(e, Manager, s.A);
        var observed = StayOf(board, unit).GetProperty("activity").GetProperty("watermark").GetString()!;   // "1"
        await ChangesAsync(e, Manager, s.A);
        await ReadAsync(e, Manager, $"/api/admin/v1/activity?menu=calendar&propertyId={s.A}");
        await BadgeAsync(e, Manager, s.A);
        Assert.Equal(seenBefore, await ScalarAsync<int>("""SELECT count(*)::int FROM "StaffEntitySeen" """));

        // A newer event arrives after that board was read: an acknowledgement of the OLD watermark must not clear it.
        await Ok(e, Desk, $"{AssignUrl(s.A)}/{segment}/move", new { expectedVersion = version, physicalRoomId = s.Standard[1], startDate = CheckIn, endDate = CheckOut });
        var stale = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, EntitySeen(e, Manager, SeenBody(s.A, "reservation-unit", unit, observed))));
        Assert.Equal(("1", true, 2, "3"), (stale.GetProperty("lastSeenWatermark").GetString(), stale.GetProperty("unread").GetBoolean(), stale.GetProperty("count").GetInt32(), stale.GetProperty("currentWatermark").GetString()));
        Assert.Equal(2, (await BadgeAsync(e, Manager, s.A)).Count);   // the unit (still unread: a newer event) and the block, which this acknowledgement did not touch

        // The block is a different object: acknowledging the unit left it alone, and acknowledging the block leaves the unit alone.
        var current = await BoardAsync(e, Manager, s.A);
        var latest = StayOf(current, unit).GetProperty("activity").GetProperty("watermark").GetString()!;                 // "3"
        var acknowledged = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, EntitySeen(e, Manager, SeenBody(s.A, "reservation-unit", unit, latest))));
        Assert.Equal(("3", false, 1), (acknowledged.GetProperty("lastSeenWatermark").GetString(), acknowledged.GetProperty("unread").GetBoolean(), acknowledged.GetProperty("count").GetInt32()));
        Assert.Equal((false, true), (
            StayOf(await BoardAsync(e, Manager, s.A), unit).GetProperty("activity").GetProperty("unread").GetBoolean(),
            (await BoardAsync(e, Manager, s.A)).GetProperty("operationalBlocks").EnumerateArray().Single().GetProperty("activity").GetProperty("unread").GetBoolean()));

        // Repeating it, or sending an older (out-of-order) one afterwards, never moves the cursor back and never fails.
        var repeat = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, EntitySeen(e, Manager, SeenBody(s.A, "reservation-unit", unit, latest))));
        var older = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, EntitySeen(e, Manager, SeenBody(s.A, "reservation-unit", unit, "1"))));
        Assert.Equal("3", repeat.GetProperty("lastSeenWatermark").GetString());
        Assert.Equal("3", older.GetProperty("lastSeenWatermark").GetString());
        Assert.False(older.GetProperty("unread").GetBoolean());

        // One row per (Staff, Property, object): an upper-case id opens no second cursor.
        await AssertStatusAsync(HttpStatusCode.OK, EntitySeen(e, Manager, new { propertyId = s.A, entityKind = "reservation-unit", entityId = unit.ToString("D").ToUpperInvariant(), observedWatermark = latest }));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*)::int FROM "StaffEntitySeen" WHERE "EntityKey" = '{unit:D}' """));

        // The block, acknowledged from its own list item, clears it; the Staff member's badge is then 0.
        var changes = await ChangesAsync(e, Manager, s.A);
        var item = GroupOf(changes, block.Block);
        var done = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, EntitySeen(e, Manager, SeenBody(s.A, "room-block", block.Block, item.GetProperty("observedWatermark").GetString()!))));
        Assert.Equal((false, 0), (done.GetProperty("unread").GetBoolean(), done.GetProperty("count").GetInt32()));
        Assert.Equal(0, (await ChangesAsync(e, Manager, s.A)).GetProperty("unseenEvents").GetInt32());
    }

    [Fact]
    public async Task A_cancelled_object_stays_unread_until_its_own_acknowledgement_and_the_acknowledgement_is_refused_for_anything_out_of_scope()
    {
        using var e = await BeginAsync();
        var s = e.Seed;
        var block = await BlockAsync(e, Desk, s.A, s.Standard[2]);
        await Ok(e, Desk, $"{BlockUrl(s.A)}/{block.Segment}/cancel", new { expectedVersion = block.Version });
        var counter = await CounterAsync();

        var group = GroupOf(await ChangesAsync(e, Manager, s.A), block.Block);
        Assert.Equal("Removed", group.GetProperty("presence").GetString());
        Assert.Equal("Room S2 2026-09-10 to 2026-09-12", group.GetProperty("titleSnapshot").GetString());   // the safe snapshot survives the object

        async Task<string> Refused(HttpStatusCode status, string who, object body)
        {
            var response = await AssertStatusAsync(status, EntitySeen(e, who, body));
            var problem = await JsonAsync(response);
            return problem.GetProperty("code").GetString()!;
        }

        // 400: malformed, overflowing or above-the-counter watermarks; a missing or malformed Property id. Never clamped, never written.
        foreach (var bad in new[] { "", "01", "-1", "+1", "1.0", "1e3", " 1", "abc", "9223372036854775808", (counter + 1).ToString() })
            Assert.Equal("menu-unseen-watermark-invalid", await Refused(HttpStatusCode.BadRequest, Manager, SeenBody(s.A, "room-block", block.Block, bad)));
        Assert.Equal("menu-unseen-property-invalid", await Refused(HttpStatusCode.BadRequest, Manager, new { propertyId = "nope", entityKind = "room-block", entityId = block.Block, observedWatermark = "1" }));
        await AssertStatusAsync(HttpStatusCode.BadRequest, EntitySeen(e, Manager, new { propertyId = s.A, entityKind = "room-block", entityId = block.Block }));   // observedWatermark missing

        // 404, one answer: a Property without membership, an object with no activity in this Property (a unit of B, an unknown id, a non-GUID id, an unknown kind), the other Property's Staff member.
        var unknown = "menu-unseen-unknown-menu";
        Assert.Equal(unknown, await Refused(HttpStatusCode.NotFound, Manager, SeenBody(s.B, "room-block", block.Block, "1")));
        Assert.Equal(unknown, await Refused(HttpStatusCode.NotFound, Outsider, SeenBody(s.A, "room-block", block.Block, "1")));
        Assert.Equal(unknown, await Refused(HttpStatusCode.NotFound, Outsider, SeenBody(s.B, "room-block", block.Block, "1")));      // A's block through B: no activity in B
        Assert.Equal(unknown, await Refused(HttpStatusCode.NotFound, Manager, SeenBody(s.A, "reservation-unit", s.UnitB, "1")));
        Assert.Equal(unknown, await Refused(HttpStatusCode.NotFound, Manager, SeenBody(s.A, "room-block", Guid.NewGuid(), "1")));
        Assert.Equal(unknown, await Refused(HttpStatusCode.NotFound, Manager, new { propertyId = s.A, entityKind = "room-block", entityId = "not-a-guid", observedWatermark = "1" }));
        Assert.Equal(unknown, await Refused(HttpStatusCode.NotFound, Manager, new { propertyId = s.A, entityKind = "post", entityId = block.Block, observedWatermark = "1" }));
        await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Client.SendAsync(Post($"{Unseen}/calendar/entities/seen", SeenBody(s.A, "room-block", block.Block, "1"))));

        // The menu-level acknowledgement stays refused: opening the page never acknowledges the board.
        var menuLevel = await AssertStatusAsync(HttpStatusCode.BadRequest, e.Client.SendAsync(Post($"{Unseen}/calendar/seen", new { viewWatermark = "1", propertyId = s.A }, e.Cookie(Manager))));
        Assert.Equal("menu-unseen-use-entity-seen", (await JsonAsync(menuLevel)).GetProperty("code").GetString());
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "StaffEntitySeen" """));                                  // every refusal above wrote nothing

        // Its own acknowledgement clears the cancelled object, and only that.
        await AssertStatusAsync(HttpStatusCode.OK, EntitySeen(e, Manager, SeenBody(s.A, "room-block", block.Block, group.GetProperty("observedWatermark").GetString()!)));
        Assert.Equal(0, (await BadgeAsync(e, Manager, s.A)).Count);
    }

    // ------------------------------------------------------------------------------------------------------ one snapshot

    [Fact]
    public async Task A_board_read_never_pairs_an_object_state_with_a_commit_that_happened_while_it_was_paused()
    {
        var barrier = new ArmableBarrier();
        using var e = await BeginAsync(more: services => services.AddScoped(_ => new TheBhaDbContext(
            new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(barrier).Options)));
        var s = e.Seed;
        var (segment, version) = await AssignAsync(e, Desk, s.Units[0], s.Standard[0]);
        var gate = barrier.Arm(OperationalBlocksQueryTag);

        var read = e.Client.SendAsync(Get($"/api/admin/v1/properties/{s.A}/reservation-board?{Window}", e.Cookie(Manager)));
        await gate.Reached.WaitAsync(TimeSpan.FromSeconds(30));
        await Ok(e, Desk, $"{AssignUrl(s.A)}/{segment}/move", new { expectedVersion = version, physicalRoomId = s.Standard[1], startDate = CheckIn, endDate = CheckOut });   // commits while the read is paused
        var counterNow = await CounterAsync();
        gate.Release();
        var paused = StayOf(await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, read)), s.Units[0]);

        // The rows are the OLD committed state (room S0) and so is the watermark ("1"): not the move, and not its number.
        Assert.Equal(s.Standard[0], paused.GetProperty("assignments").EnumerateArray().Single().GetProperty("physicalRoomId").GetGuid());
        Assert.Equal("1", paused.GetProperty("activity").GetProperty("watermark").GetString());
        Assert.Equal(2, counterNow);

        // A read taken after it shows both the new room and the new watermark, together.
        var fresh = StayOf(await BoardAsync(e, Manager, s.A), s.Units[0]);
        Assert.Equal(s.Standard[1], fresh.GetProperty("assignments").EnumerateArray().Single().GetProperty("physicalRoomId").GetGuid());
        Assert.Equal("2", fresh.GetProperty("activity").GetProperty("watermark").GetString());
    }

    [Fact]
    public async Task An_acknowledgement_answers_the_object_the_count_and_the_counter_from_one_snapshot_while_another_Staff_member_commits()
    {
        var gate = new AfterEntitySeenUpsert();
        using var e = await BeginAsync(more: services => services.AddScoped(_ => new TheBhaDbContext(
            new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(gate).Options)));
        var s = e.Seed;
        var unit = s.Units[0];
        var (segment, version) = await AssignAsync(e, Desk, unit, s.Standard[0]);   // W = 1: the only unread object of Property A for the Manager
        Assert.Equal(("1", 1), (StayOf(await BoardAsync(e, Manager, s.A), unit).GetProperty("activity").GetProperty("watermark").GetString(), (await BadgeAsync(e, Manager, s.A)).Count));

        // The Manager acknowledges W = 1. The upsert has run and the read of its answer is paused when the Desk commits W2 = 2 for the same object.
        var ack = EntitySeen(e, Manager, SeenBody(s.A, "reservation-unit", unit, "1"));
        await gate.Reached.WaitAsync(TimeSpan.FromSeconds(30));
        await Ok(e, Desk, $"{AssignUrl(s.A)}/{segment}/move", new { expectedVersion = version, physicalRoomId = s.Standard[1], startDate = CheckIn, endDate = CheckOut });
        Assert.Equal(2, await CounterAsync());
        gate.Release();
        var answer = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, ack));

        // One snapshot: the object, the Property count and the counter all describe the moment of the read, before W2. A torn answer would say "not unread" with a count of 1 and counter "2".
        Assert.Equal(("1", false, 0, "1"), (
            answer.GetProperty("lastSeenWatermark").GetString(), answer.GetProperty("unread").GetBoolean(), answer.GetProperty("count").GetInt32(), answer.GetProperty("currentWatermark").GetString()));

        // After W2 is committed a new read sees the object unread again, and the cursor is still W: the acknowledgement was never moved up to the counter.
        var cursor = await ScalarAsync<long>($"""SELECT "LastSeenSequence" FROM "StaffEntitySeen" WHERE "EntityKey" = '{unit:D}' """);
        Assert.Equal(1, cursor);
        var changes = await ChangesAsync(e, Manager, s.A);
        var group = GroupOf(changes, unit);
        Assert.Equal(("2", "1", 1), (group.GetProperty("observedWatermark").GetString(), changes.GetProperty("lastSeenWatermark").GetString(), changes.GetProperty("unseenEvents").GetInt32()));
        Assert.True(StayOf(await BoardAsync(e, Manager, s.A), unit).GetProperty("activity").GetProperty("unread").GetBoolean());
        Assert.Equal((1, "2"), await BadgeAsync(e, Manager, s.A));
    }

    // ------------------------------------------------------------------------------------------------------ locks and contention

    [Fact]
    public async Task A_write_of_another_Property_waits_on_the_calendar_counter_only_after_its_own_work_and_both_commit()
    {
        var probe = new Probe();
        using var e = await BeginAsync(probe, tightLockTimeout: true);
        using var restore = new LockTimeoutRestore(this);
        var s = e.Seed;
        var release = probe.HoldNextRecord();

        // Property A's write parks AFTER it took the counter (it holds the row until COMMIT) …
        var a = Send(e, Desk, BlockUrl(s.A), BlockBody(s.Standard[0]));
        await probe.Held.Task.WaitAsync(TimeSpan.FromSeconds(30));

        // … so Property B's write, which shares nothing but the counter row, must queue behind it on that row, in the recorder's own UPDATE and nowhere earlier.
        var started = Stopwatch.StartNew();
        var b = Send(e, Outsider, BlockUrl(s.B), BlockBody(s.RoomB));
        string? waitingOn = null;
        for (var attempt = 0; attempt < 100 && waitingOn is null; attempt++)
        {
            waitingOn = await ScalarOrNullAsync(
                $"""SELECT query FROM pg_stat_activity WHERE datname = '{Factory.DatabaseName}' AND wait_event_type = 'Lock' AND query LIKE 'UPDATE "MenuActivityStreams"%' LIMIT 1""");
            if (waitingOn is null) await Task.Delay(50);
        }

        Assert.NotNull(waitingOn);
        Assert.False(b.IsCompleted);
        await Task.Delay(300);                 // a measured hold: B must still be waiting after it
        Assert.False(b.IsCompleted);
        release.SetResult(true);
        Assert.Equal(HttpStatusCode.Created, (await a).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await b).StatusCode);
        output.WriteLine($"Counter wait (local PostgreSQL 17, one machine, one instance, A held the counter row about 300+ ms by design): Property B's write completed {started.ElapsedMilliseconds} ms after it started, queued on the 'calendar' counter row.");

        var rows = await RowsAsync();
        Assert.Equal([1L, 2L], rows.Select(row => row.Sequence));
        Assert.Equal(new HashSet<Guid?> { s.A, s.B }, rows.Select(row => row.PropertyId).ToHashSet());
    }

    [Fact]
    public async Task Concurrent_writes_in_two_Properties_all_commit_with_no_deadlock_gap_or_duplicate_number()
    {
        using var e = await BeginAsync(tightLockTimeout: true);
        using var restore = new LockTimeoutRestore(this);
        var s = e.Seed;
        // Distinct rooms and distinct nights per request, so none of them conflicts on business grounds: only locks are in play (advisory locks of one Property, the one counter row of both).
        var requests = new List<Task<HttpResponseMessage>>();
        for (var i = 0; i < 6; i++)
        {
            var start = new DateOnly(2026, 11, 1).AddDays(i * 2);
            requests.Add(Send(e, Desk, BlockUrl(s.A), BlockBody(s.Standard[i % 4], start, start.AddDays(1))));
            requests.Add(Send(e, Outsider, BlockUrl(s.B), BlockBody(s.RoomB, start, start.AddDays(1))));
        }

        requests.Add(Send(e, Desk, AssignUrl(s.A), CreateBody(s.Units[0], s.Standard[0])));
        requests.Add(Send(e, Desk, AssignUrl(s.A), CreateBody(s.Units[1], s.Standard[1])));
        var watch = Stopwatch.StartNew();
        var responses = await Task.WhenAll(requests);
        output.WriteLine($"{requests.Count} concurrent writes over two Properties finished in {watch.ElapsedMilliseconds} ms (local PostgreSQL 17, one instance; not a capacity figure).");

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
        var rows = await RowsAsync();
        Assert.Equal(Enumerable.Range(1, requests.Count).Select(i => (long)i), rows.Select(row => row.Sequence));
        Assert.Equal(requests.Count, rows.Select(row => row.Id).Distinct().Count());
    }

    /// <summary>The shared test database must not keep the 30 s lock_timeout the lock tests set.</summary>
    private sealed class LockTimeoutRestore(CalendarActivityApiTests test) : IDisposable
    {
        public void Dispose() => test.ExecuteAsync($"""ALTER DATABASE "{test.Factory.DatabaseName}" RESET lock_timeout""").GetAwaiter().GetResult();
    }

    private async Task<string?> ScalarOrNullAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteScalarAsync() as string;
    }
}
