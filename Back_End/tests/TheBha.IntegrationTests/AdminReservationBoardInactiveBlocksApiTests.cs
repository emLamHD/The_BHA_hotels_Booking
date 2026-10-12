using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TheBha.Api;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-004-CP01: the Reservation Board read lists a room that is not Active when — and only when — an
/// Effective OperationalBlock segment overlapping the requested window sits in it, with the room's real
/// <c>OperationalStatus</c>. Every Active room of the Property is still listed, the block keeps its
/// authoritative un-clipped dates, and nothing else widens the list: no cancelled block, no block outside the
/// window, no assignment-only reference, no other Property, no inactive room without a block. The read is
/// still one RepeatableRead snapshot and mutates nothing. This is a list to display, never a sellable count
/// (ADR 0006; inventory stays Active-only).
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminReservationBoardInactiveBlocksApiTests(PostgreSqlWebApplicationFactory factory) : IDisposable
{
    private readonly WebApplicationFactory<Program> localGate = factory.WithLocalGate();

    public void Dispose() => localGate.Dispose();

    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly TimeSpan BarrierTimeout = TimeSpan.FromSeconds(60);

    /// <summary>
    /// Mirrors <c>ReservationBoardDataLoader.OperationalBlocksQueryTag</c> (internal to Infrastructure): the
    /// barrier pauses the projection right after the block query, before the room query that depends on it.
    /// </summary>
    private const string OperationalBlocksQueryTag = "pms-cal-004-reservation-board-operational-blocks";
    private static readonly DateOnly From = new(2026, 9, 1);
    private static readonly DateOnly To = new(2026, 9, 8);

    private static string BoardUrl(Guid propertyId, DateOnly from, DateOnly to) =>
        $"/api/admin/v1/properties/{propertyId}/reservation-board?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}";

    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });

    // ---------------------------------------------------------------
    // Visibility: the baseline defect and the contract
    // ---------------------------------------------------------------

    [Fact]
    public async Task An_effective_block_in_an_inactive_or_out_of_service_room_lists_that_room_with_its_real_status_and_the_unclipped_block()
    {
        var fixture = await CreateFixtureAsync("visible");
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Pipe burst", "actor:qa", Now);
            context.Add(header);
            context.Add(Block(fixture, fixture.Inactive, header, From.AddDays(1), From.AddDays(3)));
            // Starts before the window and ends after it: the response must carry the full span.
            context.Add(Block(fixture, fixture.OutOfService, header, From.AddDays(-2), To.AddDays(3)));
            await context.SaveChangesAsync();
        }

        using var client = CreateHttpsClient(localGate);
        var board = await GetBoardAsync(client, fixture.Property.Id);

        var rooms = Rooms(board);
        Assert.Equal("Inactive", rooms[fixture.Inactive.Id].GetProperty("operationalStatus").GetString());
        Assert.Equal("OutOfService", rooms[fixture.OutOfService.Id].GetProperty("operationalStatus").GetString());
        // Every Active room is still listed, with the status it really has.
        foreach (var active in fixture.Active)
        {
            Assert.Equal("Active", rooms[active.Id].GetProperty("operationalStatus").GetString());
        }

        var blocks = board.GetProperty("operationalBlocks").EnumerateArray().ToArray();
        Assert.Equal(2, blocks.Length);
        var outOfService = blocks.Single(block => block.GetProperty("physicalRoomId").GetGuid() == fixture.OutOfService.Id);
        Assert.Equal("2026-08-30", outOfService.GetProperty("startDate").GetString());
        Assert.Equal("2026-09-11", outOfService.GetProperty("endDate").GetString());
        Assert.Equal("Pipe burst", outOfService.GetProperty("reason").GetString());
        Assert.True(outOfService.GetProperty("segmentVersion").GetUInt32() > 0);
        Assert.NotEqual(Guid.Empty, outOfService.GetProperty("roomBlockId").GetGuid());
        // The room lists exactly the fields it listed before; only inclusion and the status value changed.
        Assert.Equal(
            ["floor", "id", "operationalStatus", "roomNumber", "roomTypeId"],
            rooms[fixture.Inactive.Id].EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Without_a_qualifying_block_only_active_rooms_are_listed_exactly_as_before()
    {
        var fixture = await CreateFixtureAsync("baseline");
        using var client = CreateHttpsClient(localGate);

        var board = await GetBoardAsync(client, fixture.Property.Id);

        Assert.Equal(
            fixture.Active.Select(room => room.Id).Order(),
            Rooms(board).Keys.Order());
        Assert.All(Rooms(board).Values, room => Assert.Equal("Active", room.GetProperty("operationalStatus").GetString()));
        Assert.Empty(board.GetProperty("operationalBlocks").EnumerateArray());
    }

    [Fact]
    public async Task Nothing_else_widens_the_list_cancelled_outside_adjacent_assignment_only_inactive_without_block_and_other_property()
    {
        var fixture = await CreateFixtureAsync("bounded");
        var other = await CreateFixtureAsync("bounded-other", reset: false);
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Bounded", "actor:qa", Now);
            context.Add(header);
            var cancelled = Block(fixture, fixture.Inactive, header, From.AddDays(1), From.AddDays(3));
            context.Add(cancelled);
            // Outside the window altogether, and merely touching the half-open boundaries on each side.
            context.Add(Block(fixture, fixture.OutOfService, header, To.AddDays(2), To.AddDays(4)));
            context.Add(Block(fixture, fixture.ArchivedRoom, header, From.AddDays(-3), From));
            context.Add(Block(fixture, fixture.SecondInactive, header, To, To.AddDays(2)));
            // An assignment-only reference to a room that is not Active.
            var (_, units) = await CreateReservationAsync(context, fixture, fixture.Standard.Id, From, From.AddDays(2), "assign-only");
            context.Add(Assignment(fixture, fixture.SecondOutOfService, units[0], From, From.AddDays(2)));
            // Another Property's inactive room with an Effective block in the same window.
            var otherHeader = new RoomBlock(Guid.NewGuid(), other.Property.Id, "Other", "actor:qa", Now);
            context.Add(otherHeader);
            context.Add(Block(other, other.Inactive, otherHeader, From, From.AddDays(2)));
            await context.SaveChangesAsync();
            cancelled.Cancel();
            await context.SaveChangesAsync();
        }

        using var client = CreateHttpsClient(localGate);
        var board = await GetBoardAsync(client, fixture.Property.Id);

        Assert.Equal(
            fixture.Active.Select(room => room.Id).Order(),
            Rooms(board).Keys.Order());
        Assert.Empty(board.GetProperty("operationalBlocks").EnumerateArray());
        // The assignment keeps being returned exactly as before; only the block rule widens the room list.
        var stay = Assert.Single(board.GetProperty("stays").EnumerateArray());
        Assert.Equal(fixture.SecondOutOfService.Id, Assert.Single(stay.GetProperty("assignments").EnumerateArray()).GetProperty("physicalRoomId").GetGuid());
        // The other Property's inactive room belongs to the other Property's board alone (it has its own
        // qualifying block there), and none of this Property's rooms leak into it.
        var otherBoard = await GetBoardAsync(client, other.Property.Id);
        Assert.Equal(other.Active.Select(room => room.Id).Append(other.Inactive.Id).Order(), Rooms(otherBoard).Keys.Order());
    }

    [Fact]
    public async Task Several_effective_blocks_in_one_inactive_room_give_one_row_and_all_the_blocks()
    {
        var fixture = await CreateFixtureAsync("two-blocks");
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Two segments", "actor:qa", Now);
            var second = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Other header", "actor:qa", Now);
            context.AddRange(header, second);
            context.Add(Block(fixture, fixture.Inactive, header, From.AddDays(1), From.AddDays(2)));
            context.Add(Block(fixture, fixture.Inactive, header, From.AddDays(4), From.AddDays(6)));
            context.Add(Block(fixture, fixture.Inactive, second, From.AddDays(2), From.AddDays(3)));
            await context.SaveChangesAsync();
        }

        using var client = CreateHttpsClient(localGate);
        var board = await GetBoardAsync(client, fixture.Property.Id);

        var rows = board.GetProperty("physicalRooms").EnumerateArray()
            .Where(room => room.GetProperty("id").GetGuid() == fixture.Inactive.Id).ToArray();
        Assert.Single(rows);
        var blocks = board.GetProperty("operationalBlocks").EnumerateArray().ToArray();
        Assert.Equal(3, blocks.Length);
        Assert.Equal(3, blocks.Select(block => block.GetProperty("segmentId").GetGuid()).Distinct().Count());
        Assert.Equal(
            blocks.Select(block => block.GetProperty("startDate").GetString()).Order(StringComparer.Ordinal),
            blocks.Select(block => block.GetProperty("startDate").GetString()));
    }

    [Fact]
    public async Task Room_types_cover_the_added_rooms_including_an_inactive_type_with_its_real_flag_and_only_then()
    {
        var fixture = await CreateFixtureAsync("types");
        using var client = CreateHttpsClient(localGate);

        // The archived type holds only a non-Active room that has no qualifying block yet: not listed.
        var before = await GetBoardAsync(client, fixture.Property.Id);
        Assert.DoesNotContain(RoomTypeIds(before), id => id == fixture.Archive.Id);

        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Archived", "actor:qa", Now);
            context.Add(header);
            context.Add(Block(fixture, fixture.ArchivedRoom, header, From.AddDays(1), From.AddDays(2)));
            await context.SaveChangesAsync();
        }

        var after = await GetBoardAsync(client, fixture.Property.Id);
        var archive = after.GetProperty("roomTypes").EnumerateArray()
            .Single(type => type.GetProperty("id").GetGuid() == fixture.Archive.Id);
        Assert.False(archive.GetProperty("isActive").GetBoolean());
        Assert.Equal(
            fixture.Active.Select(room => room.RoomTypeId).Append(fixture.Archive.Id).Distinct().Order(),
            RoomTypeIds(after).Order());
        Assert.Equal("Inactive", Rooms(after)[fixture.ArchivedRoom.Id].GetProperty("operationalStatus").GetString());
    }

    [Fact]
    public async Task Rooms_stay_ordered_by_floor_then_ordinal_room_number_then_id_with_inactive_rows_in_place()
    {
        var fixture = await CreateFixtureAsync("ordering");
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Order", "actor:qa", Now);
            context.Add(header);
            context.Add(Block(fixture, fixture.Inactive, header, From, From.AddDays(1)));
            context.Add(Block(fixture, fixture.OutOfService, header, From, From.AddDays(1)));
            context.Add(Block(fixture, fixture.ArchivedRoom, header, From, From.AddDays(1)));
            await context.SaveChangesAsync();
        }

        using var client = CreateHttpsClient(localGate);
        var board = await GetBoardAsync(client, fixture.Property.Id);
        var rows = board.GetProperty("physicalRooms").EnumerateArray()
            .Select(room => (Floor: room.GetProperty("floor").GetInt32(), Number: room.GetProperty("roomNumber").GetString()!, Id: room.GetProperty("id").GetGuid()))
            .ToArray();

        Assert.Equal(
            rows.OrderBy(row => row.Floor).ThenBy(row => row.Number, StringComparer.Ordinal).ThenBy(row => row.Id),
            rows);
        Assert.Equal(fixture.Active.Count + 3, rows.Length);
        // Repeating the read is byte-for-byte the same list.
        var again = await GetBoardAsync(client, fixture.Property.Id);
        Assert.Equal(board.GetProperty("physicalRooms").GetRawText(), again.GetProperty("physicalRooms").GetRawText());
    }

    [Fact]
    public async Task The_read_changes_nothing_in_the_database()
    {
        var fixture = await CreateFixtureAsync("read-only");
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Read only", "actor:qa", Now);
            context.Add(header);
            context.Add(Block(fixture, fixture.Inactive, header, From.AddDays(1), From.AddDays(3)));
            await context.SaveChangesAsync();
        }

        var before = await SnapshotAsync();
        using var client = CreateHttpsClient(localGate);
        for (var read = 0; read < 3; read++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(BoardUrl(fixture.Property.Id, From, To))).StatusCode);
        }

        Assert.Equal(before, await SnapshotAsync());
    }

    // ---------------------------------------------------------------
    // One snapshot: a change committed mid-projection is seen by the next read only
    // ---------------------------------------------------------------

    [Fact]
    public async Task A_room_that_becomes_active_mid_projection_is_still_one_coherent_pre_state_and_the_next_read_shows_active()
    {
        var fixture = await CreateFixtureAsync("race-status");
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Race", "actor:qa", Now);
            context.Add(header);
            context.Add(Block(fixture, fixture.Inactive, header, From.AddDays(1), From.AddDays(3)));
            await context.SaveChangesAsync();
        }

        var barrier = new ReservationBoardSnapshotBarrierInterceptor(OperationalBlocksQueryTag);
        await using var barrierFactory = BarrierFactory(barrier);
        using var client = CreateHttpsClient(barrierFactory);

        // Pause right after the block query, before the room query: an implementation that read rooms from a
        // later snapshot would show the room as Active (or miss it) while still returning the block.
        var request = client.GetAsync(BoardUrl(fixture.Property.Id, From, To));
        await barrier.Reached.WaitAsync(BarrierTimeout);
        await using (var context = factory.CreateDbContext())
        {
            await context.PhysicalRooms.Where(room => room.Id == fixture.Inactive.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(room => room.OperationalStatus, OperationalStatus.Active));
        }

        barrier.Release();
        var response = await request.WaitAsync(BarrierTimeout);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var during = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Inactive", Rooms(during)[fixture.Inactive.Id].GetProperty("operationalStatus").GetString());
        Assert.Single(during.GetProperty("operationalBlocks").EnumerateArray());

        var next = await GetBoardAsync(client, fixture.Property.Id);
        Assert.Equal("Active", Rooms(next)[fixture.Inactive.Id].GetProperty("operationalStatus").GetString());
        Assert.Single(next.GetProperty("operationalBlocks").EnumerateArray());
    }

    [Fact]
    public async Task A_block_cancelled_mid_projection_still_shows_its_room_in_that_read_and_the_next_read_drops_the_row()
    {
        var fixture = await CreateFixtureAsync("race-cancel");
        Guid segmentId;
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Race cancel", "actor:qa", Now);
            context.Add(header);
            var segment = Block(fixture, fixture.OutOfService, header, From.AddDays(1), From.AddDays(3));
            segmentId = segment.Id;
            context.Add(segment);
            await context.SaveChangesAsync();
        }

        var barrier = new ReservationBoardSnapshotBarrierInterceptor(OperationalBlocksQueryTag);
        await using var barrierFactory = BarrierFactory(barrier);
        using var client = CreateHttpsClient(barrierFactory);

        var request = client.GetAsync(BoardUrl(fixture.Property.Id, From, To));
        await barrier.Reached.WaitAsync(BarrierTimeout);
        await using (var context = factory.CreateDbContext())
        {
            var segment = await context.RoomOccupancySegments.SingleAsync(item => item.Id == segmentId);
            segment.Cancel();
            await context.SaveChangesAsync();
        }

        barrier.Release();
        var response = await request.WaitAsync(BarrierTimeout);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var during = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(fixture.OutOfService.Id, Rooms(during).Keys);
        Assert.Single(during.GetProperty("operationalBlocks").EnumerateArray());

        var next = await GetBoardAsync(client, fixture.Property.Id);
        Assert.DoesNotContain(fixture.OutOfService.Id, Rooms(next).Keys);
        Assert.Empty(next.GetProperty("operationalBlocks").EnumerateArray());
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private WebApplicationFactory<Program> BarrierFactory(ReservationBoardSnapshotBarrierInterceptor barrier) =>
        factory.WithLocalGate(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
                services.RemoveAll<DbContextOptions>();
                services.AddDbContext<TheBhaDbContext>(options => options
                    .UseNpgsql(
                        factory.ConnectionString,
                        npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
                    .AddInterceptors(barrier));
            }));

    private static async Task<JsonElement> GetBoardAsync(HttpClient client, Guid propertyId)
    {
        var response = await client.GetAsync(BoardUrl(propertyId, From, To));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static Dictionary<Guid, JsonElement> Rooms(JsonElement board) =>
        board.GetProperty("physicalRooms").EnumerateArray()
            .ToDictionary(room => room.GetProperty("id").GetGuid());

    private static List<Guid> RoomTypeIds(JsonElement board) =>
        board.GetProperty("roomTypes").EnumerateArray().Select(type => type.GetProperty("id").GetGuid()).ToList();

    /// <summary>Everything the read could conceivably touch, as comparable text.</summary>
    private async Task<string> SnapshotAsync()
    {
        await using var context = factory.CreateDbContext();
        var rooms = await context.PhysicalRooms.AsNoTracking().OrderBy(room => room.Id)
            .Select(room => $"{room.Id}:{room.OperationalStatus}:{room.UpdatedAt:O}").ToListAsync();
        var segments = await context.RoomOccupancySegments.AsNoTracking().OrderBy(segment => segment.Id)
            .Select(segment => $"{segment.Id}:{segment.Status}:{segment.StartDate}:{segment.EndDate}:{segment.PhysicalRoomId}:{EF.Property<uint>(segment, "xmin")}").ToListAsync();
        var audits = await context.RoomOccupancySegmentAudits.AsNoTracking().CountAsync();
        var blocks = await context.RoomBlocks.AsNoTracking().OrderBy(block => block.Id)
            .Select(block => $"{block.Id}:{block.Reason}").ToListAsync();
        var units = await context.ReservationUnits.AsNoTracking().OrderBy(unit => unit.Id)
            .Select(unit => $"{unit.Id}:{unit.CommitmentStatus}").ToListAsync();
        return string.Join("|", rooms.Concat(segments).Concat(blocks).Concat(units).Append(audits.ToString()));
    }

    private async Task<Fixture> CreateFixtureAsync(string slug, bool reset = true)
    {
        if (reset)
        {
            await factory.ResetDatabaseAsync();
            factory.Clock.UtcNow = Now;
        }

        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var standard = new RoomType(
            Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}-STD", "Standard", $"{slug}-std", null, 2, 4, true, Now);
        var archive = new RoomType(
            Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}-ARC", "Archive", $"{slug}-arc", null, 2, 4, true, Now);
        archive.Deactivate(Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, null, "VND", true, Now);
        context.AddRange(property, standard, archive, ratePlan);

        PhysicalRoom Room(RoomType type, string number, int floor, OperationalStatus status) =>
            new(Guid.NewGuid(), property.Id, type, $"{slug}-{number}", floor, status, Now);
        var active = new List<PhysicalRoom> { Room(standard, "S10", 1, OperationalStatus.Active), Room(standard, "S2", 1, OperationalStatus.Active), Room(standard, "S3", 2, OperationalStatus.Active) };
        var inactive = Room(standard, "I1", 1, OperationalStatus.Inactive);
        var secondInactive = Room(standard, "I2", 2, OperationalStatus.Inactive);
        var outOfService = Room(standard, "O1", 2, OperationalStatus.OutOfService);
        var secondOutOfService = Room(standard, "O2", 3, OperationalStatus.OutOfService);
        var archivedRoom = Room(archive, "A1", 3, OperationalStatus.Inactive);
        context.AddRange(active);
        context.AddRange(inactive, secondInactive, outOfService, secondOutOfService, archivedRoom);
        await context.SaveChangesAsync();
        return new Fixture(property, standard, archive, active, inactive, secondInactive, outOfService, secondOutOfService, archivedRoom, ratePlan.Id);
    }

    private static async Task<(Reservation Reservation, List<ReservationUnit> Units)> CreateReservationAsync(
        TheBhaDbContext context, Fixture fixture, Guid roomTypeId, DateOnly checkIn, DateOnly checkOut, string slug)
    {
        var nights = Enumerable.Range(0, checkOut.DayNumber - checkIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(checkIn.AddDays(offset), fixture.RatePlanId, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), fixture.Property.Id, roomTypeId, 1, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", checkIn, checkOut, 2, 0, "VND", Now,
            HexHash(slug + ":idempotency"), HexHash(slug + ":fingerprint"), HexHash(slug + ":guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{slug.ToUpperInvariant()}-0001", Now);
        context.Add(reservation);
        await context.SaveChangesAsync();
        return (reservation, reservation.Units.ToList());
    }

    private static RoomOccupancySegment Assignment(Fixture fixture, PhysicalRoom room, ReservationUnit unit, DateOnly start, DateOnly end) =>
        new(Guid.NewGuid(), fixture.Property.Id, room.Id, RoomOccupancySegmentType.ReservationAssignment, start, end, unit.Id, null, Now);

    private static RoomOccupancySegment Block(Fixture fixture, PhysicalRoom room, RoomBlock block, DateOnly start, DateOnly end) =>
        new(Guid.NewGuid(), fixture.Property.Id, room.Id, RoomOccupancySegmentType.OperationalBlock, start, end, null, block.Id, Now);

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        RoomType Standard,
        RoomType Archive,
        List<PhysicalRoom> Active,
        PhysicalRoom Inactive,
        PhysicalRoom SecondInactive,
        PhysicalRoom OutOfService,
        PhysicalRoom SecondOutOfService,
        PhysicalRoom ArchivedRoom,
        Guid RatePlanId);
}
