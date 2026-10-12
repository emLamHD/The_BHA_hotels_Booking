using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-003-CP01 acceptance: the Admin operational-block move endpoint, proven through a real host
/// against real PostgreSQL in <c>LocalGate</c> mode (the Staff-mode authorization and audit actor are in
/// <see cref="StaffCalendarWriteAuthorizationTests"/>).
///
/// <para>
/// This suite proves only what is new — the thin HTTP adapter over
/// <see cref="IOperationalBlockMutationStore.MoveAsync"/>: request binding, the status mapping, the
/// server-owned actor, the success body and the published contract. The supersession invariants (version,
/// capacity, overlap, locks, concurrency) are the engine's, proven against the store by
/// <see cref="OperationalBlockMutationStoreTests"/>; here they are only observed through HTTP. Every
/// business refusal is checked against the whole prior schedule/header/audit/commercial state read through a
/// new DbContext, because "nothing written" means "all of it exactly as it was".
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminOperationalBlockMoveApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6); // 5 nights: 9/1-9/5
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions BoardJson = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private const string AllowedAdminOrigin = "https://localhost:3001";
    private const string ServerOwnedActor = "admin-calendar-local-development";
    private const string InvalidTitle = "Invalid operational block request";
    private const string NotFoundTitle = "Operational block target not found";
    private const string ConflictTitle = "Operational block conflict";

    // ---------------------------------------------------------------
    // Host and request helpers
    // ---------------------------------------------------------------

    private WebApplicationFactory<Program> CreateWriteHost(Action<IWebHostBuilder>? configure = null) =>
        factory.WithLocalGate(builder =>
        {
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true");
            configure?.Invoke(builder);
        });

    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });

    private static string BlocksUrl(Guid propertyId) => $"/api/admin/v1/properties/{propertyId}/operational-blocks";
    private static string MoveUrl(Guid propertyId, Guid segmentId) => $"{BlocksUrl(propertyId)}/{segmentId}/move";
    private static string BoardUrl(Guid propertyId, DateOnly from, DateOnly to) =>
        $"/api/admin/v1/properties/{propertyId}/reservation-board?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}";

    private static HttpRequestMessage CreateJsonPost(string url, string body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)) };
        request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");
        request.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        return request;
    }

    /// <summary>The valid body; <paramref name="reason"/> is omitted when it is <see cref="Omit"/>.</summary>
    private static JsonObject MoveJson(uint version, Guid destination, string? reason = Omit)
    {
        var body = new JsonObject
        {
            ["expectedVersion"] = (long)version,
            ["destinationPhysicalRoomId"] = destination.ToString(),
        };
        if (!ReferenceEquals(reason, Omit))
        {
            body["reason"] = reason;
        }

        return body;
    }

    private const string Omit = "\u0000omit";

    private static string MoveBody(uint version, Guid destination, string? reason = Omit) =>
        MoveJson(version, destination, reason).ToJsonString();

    private async Task<HttpResponseMessage> MoveAsync(HttpClient client, Guid propertyId, Guid segmentId, string body)
    {
        using var request = CreateJsonPost(MoveUrl(propertyId, segmentId), body);
        return await client.SendAsync(request);
    }

    private static async Task<string?> TitleAsync(HttpResponseMessage response)
    {
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        return problem.TryGetProperty("title", out var title) ? title.GetString() : null;
    }

    private static string BodySchemaRef(JsonElement response) =>
        response.GetProperty("content").EnumerateObject()
            .Select(media => media.Value.GetProperty("schema").GetProperty("$ref").GetString()!)
            .Distinct(StringComparer.Ordinal)
            .Single();

    // ---------------------------------------------------------------
    // State read through a fresh DbContext
    // ---------------------------------------------------------------

    /// <summary>
    /// Every segment (with its committed xmin), every RoomBlock header, every audit row and the commercial
    /// snapshot of every Unit: a refusal must change none of it. xmin is a shadow property, readable only from
    /// a tracked entry in the context that materialized it.
    /// </summary>
    private async Task<string> StateAsync()
    {
        await using var context = factory.CreateDbContext();
        var segments = (await context.RoomOccupancySegments.ToListAsync()).OrderBy(s => s.Id)
            .Select(s => $"S|{s.Id}|{s.Type}|{s.Status}|{s.PhysicalRoomId}|{s.StartDate:yyyy-MM-dd}|{s.EndDate:yyyy-MM-dd}|{s.RoomBlockId}|{context.Entry(s).Property<uint>("xmin").CurrentValue}");
        var blocks = (await context.RoomBlocks.AsNoTracking().ToListAsync()).OrderBy(b => b.Id)
            .Select(b => $"B|{b.Id}|{b.Reason}|{b.CreatedByActorReference}|{b.CreatedAtUtc:O}");
        var audits = (await context.RoomOccupancySegmentAudits.AsNoTracking().ToListAsync()).OrderBy(a => a.Id)
            .Select(a => $"A|{a.Id}|{a.SegmentId}|{a.MutationGroupId}|{a.EventType}|{a.ActorReference}|{a.AuthorizationEvidence}|{a.Reason}");
        var units = await context.ReservationUnits.AsNoTracking().Include(u => u.Nights).OrderBy(u => u.Id).ToListAsync();
        var commercial = units.Select(u =>
            $"U|{u.Id}|{u.RoomTypeId}|{u.CommitmentStatus}|{string.Join(",", u.Nights.OrderBy(n => n.StayDate).Select(n => $"{n.StayDate:yyyy-MM-dd}/{n.RatePlanId}/{n.UnitAmount:0.00}"))}");
        return string.Join("\n", segments.Concat(blocks).Concat(audits).Concat(commercial));
    }

    private async Task<uint> VersionAsync(Guid segmentId)
    {
        await using var context = factory.CreateDbContext();
        var row = await context.RoomOccupancySegments.SingleAsync(s => s.Id == segmentId);
        return context.Entry(row).Property<uint>("xmin").CurrentValue;
    }

    private async Task<List<RoomOccupancySegmentAudit>> AuditsOfAsync(params Guid[] segmentIds)
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegmentAudits.AsNoTracking().Where(a => segmentIds.Contains(a.SegmentId)).ToListAsync();
    }

    /// <summary>One refused request: the status and title the caller sees, and that nothing at all changed.</summary>
    private async Task AssertRefusedAsync(HttpClient client, Guid propertyId, Guid segmentId, string body, HttpStatusCode status, string title, string because)
    {
        var before = await StateAsync();
        var response = await MoveAsync(client, propertyId, segmentId, body);
        Assert.True(status == response.StatusCode, $"{because}: expected {(int)status}, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        Assert.Equal(title, await TitleAsync(response));
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.False(response.Headers.Contains("Location"));
        Assert.True(before == await StateAsync(), $"{because}: state changed");
    }

    // ---------------------------------------------------------------
    // Behaviour
    // ---------------------------------------------------------------

    [Fact]
    public async Task A_valid_move_returns_source_cancelled_and_successor_effective_and_keeps_the_header_and_commercial_state()
    {
        var data = await SeedAsync("block-move-happy");
        var source = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckIn.AddDays(3), "Burst pipe");
        var before = await StateAsync();
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var response = await MoveAsync(client, data.Property.Id, source.Id, MoveBody(source.Version, data.RoomsB[0].Id, "  Move closure to room B  "));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.False(response.Headers.Contains("Location"));
        var segments = (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;
        Assert.Equal(["Cancelled", "Effective"], segments.Select(s => s.Status).ToArray());
        Assert.Equal((source.Id, data.RoomsA[0].Id, CheckIn, CheckIn.AddDays(3)), (segments[0].Id, segments[0].PhysicalRoomId, segments[0].StartDate, segments[0].EndDate));
        Assert.Equal((data.RoomsB[0].Id, CheckIn, CheckIn.AddDays(3)), (segments[1].PhysicalRoomId, segments[1].StartDate, segments[1].EndDate));
        Assert.All(segments, s => Assert.Equal((source.RoomBlockId, "OperationalBlock", (Guid?)null), (s.RoomBlockId, s.Type, s.ReservationUnitId)));
        Assert.NotEqual(source.Version, segments[0].Version);
        foreach (var dto in segments)
        {
            Assert.Equal(await VersionAsync(dto.Id), dto.Version);
        }

        // The header keeps its own reason and creator; the move reason is on the two new audit rows only.
        await using (var context = factory.CreateDbContext())
        {
            var header = await context.RoomBlocks.AsNoTracking().SingleAsync();
            Assert.Equal(("Burst pipe", "actor:housekeeping"), (header.Reason, header.CreatedByActorReference));
        }

        var audits = await AuditsOfAsync(segments[0].Id, segments[1].Id);
        var moveAudits = audits.Where(a => a.Reason == "Move closure to room B").ToList();
        Assert.Equal(2, moveAudits.Count);
        Assert.Equal(["Cancelled", "Created"], moveAudits.Select(a => a.EventType.ToString()).Order(StringComparer.Ordinal).ToArray());
        Assert.Single(moveAudits.Select(a => a.MutationGroupId).Distinct());
        Assert.All(moveAudits, a => Assert.Equal((ServerOwnedActor, (string?)null), (a.ActorReference, a.AuthorizationEvidence)));
        Assert.Equal(3, audits.Count); // the block's original Created row, plus the two of the move
        Assert.Equal(before.Split('\n').Where(l => l.StartsWith("U|", StringComparison.Ordinal)), (await StateAsync()).Split('\n').Where(l => l.StartsWith("U|", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task A_source_clipped_by_the_board_window_still_moves_over_its_own_full_range_and_the_board_shows_only_the_successor()
    {
        var data = await SeedAsync("block-move-clipped");
        var source = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckIn.AddDays(8), "Renovation");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var window = (From: CheckIn.AddDays(3), To: CheckIn.AddDays(5));

        var board = (await client.GetFromJsonAsync<ReservationBoardDto>(BoardUrl(data.Property.Id, window.From, window.To), BoardJson))!;
        var shown = Assert.Single(board.OperationalBlocks);
        // The projection returns the segment un-clipped; the request body below carries no dates of its own.
        Assert.Equal((source.Id, CheckIn, CheckIn.AddDays(8)), (shown.SegmentId, shown.StartDate, shown.EndDate));

        var moved = (await (await MoveAsync(client, data.Property.Id, shown.SegmentId, MoveBody(shown.SegmentVersion, data.RoomsA[1].Id))).Content
            .ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;

        Assert.Equal((data.RoomsA[1].Id, CheckIn, CheckIn.AddDays(8)), (moved[1].PhysicalRoomId, moved[1].StartDate, moved[1].EndDate));
        var after = (await client.GetFromJsonAsync<ReservationBoardDto>(BoardUrl(data.Property.Id, window.From, window.To), BoardJson))!;
        var now = Assert.Single(after.OperationalBlocks);
        Assert.Equal((moved[1].Id, moved[1].Version, data.RoomsA[1].Id, source.RoomBlockId), (now.SegmentId, now.SegmentVersion, now.PhysicalRoomId, now.RoomBlockId));
        Assert.Equal("Renovation", now.Reason);
    }

    [Fact]
    public async Task A_body_that_forges_the_actor_dates_header_or_replacements_changes_nothing_the_server_decides()
    {
        var data = await SeedAsync("block-move-forged");
        var source = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Burst pipe");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var body = MoveJson(source.Version, data.RoomsA[1].Id);
        body["actorReference"] = "forged-actor";
        body["authorizationEvidence"] = "forged-evidence";
        body["confirmCrossRoomType"] = true;
        body["role"] = "Manager";
        body["startDate"] = CheckIn.AddDays(1).ToString("yyyy-MM-dd");
        body["endDate"] = CheckOut.AddDays(3).ToString("yyyy-MM-dd");
        body["physicalRoomId"] = data.RoomsA[2].Id.ToString();
        body["roomBlockId"] = Guid.NewGuid().ToString();
        body["replacements"] = new JsonArray(new JsonObject
        {
            ["physicalRoomId"] = data.RoomsB[0].Id.ToString(), ["startDate"] = CheckIn.ToString("yyyy-MM-dd"), ["endDate"] = CheckIn.AddDays(1).ToString("yyyy-MM-dd"),
        });

        using var request = CreateJsonPost($"{MoveUrl(data.Property.Id, source.Id)}?actorReference=forged&destinationPhysicalRoomId={data.RoomsA[2].Id}&reason=forged", body.ToJsonString());
        request.Headers.Add("X-Actor-Reference", "forged");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var segments = (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;
        Assert.Equal((data.RoomsA[1].Id, CheckIn, CheckOut), (segments[1].PhysicalRoomId, segments[1].StartDate, segments[1].EndDate));
        var audits = await AuditsOfAsync(segments[0].Id, segments[1].Id);
        Assert.All(audits.Where(a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled || a.SegmentId == segments[1].Id),
            a => Assert.Equal((ServerOwnedActor, (string?)null, (string?)null), (a.ActorReference, a.AuthorizationEvidence, a.Reason)));
        await using var context = factory.CreateDbContext();
        Assert.Equal(1, await context.RoomBlocks.CountAsync());
        Assert.Empty(await context.RoomOccupancySegments.Where(s => s.PhysicalRoomId == data.RoomsA[2].Id || s.PhysicalRoomId == data.RoomsB[0].Id).ToListAsync());
    }

    [Fact]
    public async Task A_reason_is_optional_trimmed_blank_means_none_and_500_characters_are_the_limit()
    {
        var data = await SeedAsync("block-move-reason");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var reasons = new (string? Sent, string? Recorded)[]
        {
            (Omit, null), (null, null), ("", null), ("   \t ", null), (" short ", "short"), (new string('x', 500), new string('x', 500)), ($" {new string('y', 500)} ", new string('y', 500)),
        };
        var room = data.RoomsA[0];
        var other = data.RoomsA[1];
        var source = await CreateBlockAsync(data, room, CheckIn, CheckOut, "Burst pipe");
        foreach (var (sent, recorded) in reasons)
        {
            var response = await MoveAsync(client, data.Property.Id, source.Id, MoveBody(source.Version, other.Id, sent));
            Assert.True(HttpStatusCode.OK == response.StatusCode, $"reason '{sent}': {await response.Content.ReadAsStringAsync()}");
            var segments = (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;
            var group = (await AuditsOfAsync(segments[0].Id, segments[1].Id)).Where(a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled && a.SegmentId == segments[0].Id).ToList();
            Assert.Equal(recorded, Assert.Single(group).Reason);
            source = segments[1];
            (room, other) = (other, room);
        }

        // 501 characters, after trimming, is a 400 that writes nothing — even though the version is current.
        await AssertRefusedAsync(client, data.Property.Id, source.Id, MoveBody(source.Version, other.Id, new string('z', 501)), HttpStatusCode.BadRequest, InvalidTitle, "501-character reason");
    }

    [Fact]
    public async Task The_same_room_a_missing_or_foreign_target_a_stale_or_cancelled_source_and_an_unusable_destination_each_change_nothing()
    {
        var data = await SeedAsync("block-move-refusals");
        var foreign = await SeedForeignAsync();
        var source = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Burst pipe");
        var assignment = await CreateAssignmentAsync(data, data.RoomsA[2]);
        var lifted = await CreateBlockAsync(data, data.RoomsA[1], CheckIn, CheckOut, "Lifted");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(CreateJsonPost($"{BlocksUrl(data.Property.Id)}/{lifted.Id}/cancel", $"{{\"expectedVersion\":{lifted.Version}}}"))).StatusCode);
        var liftedVersion = await VersionAsync(lifted.Id);
        var pid = data.Property.Id;

        // 400: the destination is the block's own room.
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version, data.RoomsA[0].Id), HttpStatusCode.BadRequest, InvalidTitle, "same room");
        // 404: no such segment, another Property's segment, an assignment rather than a block, a foreign or missing destination.
        await AssertRefusedAsync(client, pid, Guid.NewGuid(), MoveBody(1, data.RoomsB[0].Id), HttpStatusCode.NotFound, NotFoundTitle, "unknown segment");
        await AssertRefusedAsync(client, foreign.Property.Id, source.Id, MoveBody(source.Version, foreign.Room.Id), HttpStatusCode.NotFound, NotFoundTitle, "segment of another Property");
        await AssertRefusedAsync(client, pid, assignment.Id, MoveBody(assignment.Version, data.RoomsB[0].Id), HttpStatusCode.NotFound, NotFoundTitle, "assignment segment");
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version, foreign.Room.Id), HttpStatusCode.NotFound, NotFoundTitle, "destination of another Property");
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version, Guid.NewGuid()), HttpStatusCode.NotFound, NotFoundTitle, "unknown destination");
        // 409: stale or zero version, a block that is no longer Effective, a destination that is not Active.
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version + 1, data.RoomsB[0].Id), HttpStatusCode.Conflict, ConflictTitle, "stale version");
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(0, data.RoomsB[0].Id), HttpStatusCode.Conflict, ConflictTitle, "zero version");
        await AssertRefusedAsync(client, pid, lifted.Id, MoveBody(liftedVersion, data.RoomsB[0].Id), HttpStatusCode.Conflict, ConflictTitle, "cancelled source");
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version, data.InactiveA.Id), HttpStatusCode.Conflict, ConflictTitle, "destination not Active");

        // And the same source still moves once the request is valid.
        Assert.Equal(HttpStatusCode.OK, (await MoveAsync(client, pid, source.Id, MoveBody(source.Version, data.RoomsB[0].Id))).StatusCode);
    }

    [Fact]
    public async Task An_occupied_destination_or_one_without_capacity_is_409_and_an_adjacent_range_is_200()
    {
        var data = await SeedAsync("block-move-overlap-capacity");
        // The source covers nights 9/3 and 9/4.
        var source = await CreateBlockAsync(data, data.RoomsA[0], CheckIn.AddDays(2), CheckOut.AddDays(-1), "Burst pipe");
        await CreateBlockAsync(data, data.RoomsA[1], CheckIn.AddDays(3), CheckOut, "Overlaps the last night");
        await CreateAssignmentAsync(data, data.RoomsA[2], CheckIn.AddDays(2), CheckOut);
        // Room A3 is busy only on the nights just before and just after the source.
        await CreateBlockAsync(data, data.RoomsA[3], CheckIn, CheckIn.AddDays(2), "Ends where the source starts");
        await CreateBlockAsync(data, data.RoomsA[3], CheckOut.AddDays(-1), CheckOut.AddDays(2), "Starts where the source ends");
        await SellAsync(data, data.TypeB, 2);
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var pid = data.Property.Id;

        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version, data.RoomsA[1].Id), HttpStatusCode.Conflict, ConflictTitle, "overlapping block");
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version, data.RoomsA[2].Id), HttpStatusCode.Conflict, ConflictTitle, "overlapping assignment");
        // Room type B is fully committed: blocking even one of its rooms leaves demand above usable capacity.
        await AssertRefusedAsync(client, pid, source.Id, MoveBody(source.Version, data.RoomsB[0].Id), HttpStatusCode.Conflict, ConflictTitle, "no capacity at the destination type");

        // Half-open ranges: touching at the edges is not overlap.
        Assert.Equal(HttpStatusCode.OK, (await MoveAsync(client, pid, source.Id, MoveBody(source.Version, data.RoomsA[3].Id))).StatusCode);
    }

    [Fact]
    public async Task A_block_of_366_nights_moves_and_one_of_367_or_the_extreme_range_is_400_without_work_proportional_to_its_span()
    {
        var data = await SeedAsync("block-move-span");
        var long366 = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckIn.AddDays(366), "A year");
        var long367 = await CreateBlockAsync(data, data.RoomsA[1], CheckIn, CheckIn.AddDays(367), "A year and a night");
        var forever = Guid.NewGuid();
        await using (var context = factory.CreateDbContext())
        {
            var header = new RoomBlock(Guid.NewGuid(), data.Property.Id, "Forever", "actor:setup", Now);
            context.Add(header);
            context.Add(new RoomOccupancySegment(forever, data.Property.Id, data.RoomsA[2].Id, RoomOccupancySegmentType.OperationalBlock,
                new DateOnly(2026, 1, 1), DateOnly.MaxValue, null, header.Id, Now));
            await context.SaveChangesAsync();
        }

        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var pid = data.Property.Id;
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        await AssertRefusedAsync(client, pid, long367.Id, MoveBody(long367.Version, data.RoomsB[0].Id), HttpStatusCode.BadRequest, InvalidTitle, "367 nights");
        await AssertRefusedAsync(client, pid, forever, MoveBody(await VersionAsync(forever), data.RoomsB[1].Id), HttpStatusCode.BadRequest, InvalidTitle, "extreme range");
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(10), $"refusals took {stopwatch.Elapsed}");

        var moved = await MoveAsync(client, pid, long366.Id, MoveBody(long366.Version, data.RoomsB[0].Id));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        var segments = (await moved.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;
        Assert.Equal((CheckIn, CheckIn.AddDays(366)), (segments[1].StartDate, segments[1].EndDate));
    }

    [Fact]
    public async Task Every_required_field_and_every_typed_field_is_enforced_before_the_store_and_the_command_comes_from_the_route_and_body()
    {
        var spy = new CountingBlockStore();
        using var host = CreateWriteHost(builder => builder.ConfigureTestServices(services => services.AddScoped<IOperationalBlockMutationStore>(_ => spy)));
        using var client = CreateHttpsClient(host);
        var property = Guid.NewGuid();
        var segment = Guid.NewGuid();
        var room = Guid.NewGuid();

        var bad = new[]
        {
            "", "{}", "[]", "null", "{not json",
            $"{{\"destinationPhysicalRoomId\":\"{room}\"}}",
            "{\"expectedVersion\":1}",
            $"{{\"expectedVersion\":null,\"destinationPhysicalRoomId\":\"{room}\"}}",
            "{\"expectedVersion\":1,\"destinationPhysicalRoomId\":null}",
            $"{{\"expectedVersion\":-1,\"destinationPhysicalRoomId\":\"{room}\"}}",
            $"{{\"expectedVersion\":1.5,\"destinationPhysicalRoomId\":\"{room}\"}}",
            $"{{\"expectedVersion\":4294967296,\"destinationPhysicalRoomId\":\"{room}\"}}",
            "{\"expectedVersion\":1,\"destinationPhysicalRoomId\":\"not-a-guid\"}",
            "{\"expectedVersion\":1,\"destinationPhysicalRoomId\":123}",
            $"{{\"expectedVersion\":1,\"destinationPhysicalRoomId\":\"{room}\",\"reason\":123}}",
            $"{{\"expectedVersion\":1,\"destinationPhysicalRoomId\":\"{room}\",\"reason\":{{}}}}",
        };
        foreach (var body in bad)
        {
            var response = await MoveAsync(client, property, segment, body);
            Assert.True(HttpStatusCode.BadRequest == response.StatusCode, $"{body}: {(int)response.StatusCode}");
        }

        Assert.Equal(0, spy.Calls);

        // A route that is not a Guid never reaches an action either.
        using var badRoute = CreateJsonPost($"{BlocksUrl(property)}/not-a-guid/move", MoveBody(1, room));
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(badRoute)).StatusCode);
        Assert.Equal(0, spy.Calls);

        // One valid request reaches the store with exactly the route's ids, the body's version and room, the trimmed reason and the local actor.
        await MoveAsync(client, property, segment, MoveBody(7, room, "  why  "));
        var command = Assert.Single(spy.Moves);
        Assert.Equal((property, segment, 7u, room, ServerOwnedActor, "why"), (command.PropertyId, command.SegmentId, command.ExpectedVersion, command.DestinationPhysicalRoomId, command.ActorReference, command.Reason));
        await MoveAsync(client, property, segment, MoveBody(8, room, "   "));
        Assert.Null(spy.Moves[1].Reason);
        Assert.Equal(2, spy.Calls);
    }

    [Fact]
    public async Task A_closed_gate_origin_and_media_type_answer_before_binding_and_the_store()
    {
        var spy = new CountingBlockStore();
        void UseSpy(IWebHostBuilder builder) => builder.ConfigureTestServices(services => services.AddScoped<IOperationalBlockMutationStore>(_ => spy));
        var url = MoveUrl(Guid.NewGuid(), Guid.NewGuid());
        var valid = MoveBody(1, Guid.NewGuid());

        // Write flag off (the shipped default): the same bare 404, valid or not, JSON or not.
        using (var closed = factory.WithLocalGate(UseSpy))
        {
            using var client = CreateHttpsClient(closed);
            foreach (var (body, contentType) in new[] { (valid, "application/json"), ("{not json", "application/json"), (valid, "text/plain"), ("", "application/json") })
            {
                using var request = CreateJsonPost(url, body);
                request.Content!.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
                var response = await client.SendAsync(request);
                Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
                var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
                Assert.Equal(["status", "title", "traceId", "type"], problem.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
                Assert.Equal("Not Found", problem.GetProperty("title").GetString());
                Assert.True(response.Headers.CacheControl?.NoStore);
                Assert.False(response.Headers.Contains("Location"));
            }
        }

        // Open gate: cleartext is refused without a redirect; Origin and media type keep the gate's order.
        using (var open = CreateWriteHost(UseSpy))
        {
            using var cleartext = open.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false });
            using var plain = CreateJsonPost(url, valid);
            var plainResponse = await cleartext.SendAsync(plain);
            Assert.Equal(HttpStatusCode.NotFound, plainResponse.StatusCode);
            Assert.False(plainResponse.Headers.Contains("Location"));

            using var client = CreateHttpsClient(open);
            using var noOrigin = CreateJsonPost(url, valid);
            noOrigin.Headers.Remove("Origin");
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(noOrigin)).StatusCode);
            using var text = CreateJsonPost(url, valid);
            text.Content!.Headers.ContentType = MediaTypeHeaderValue.Parse("text/plain");
            Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.SendAsync(text)).StatusCode);
        }

        Assert.Equal(0, spy.Calls);
    }

    [Fact]
    public async Task Create_and_cancel_still_work_beside_the_move_and_a_store_that_answers_an_unknown_status_is_never_a_success()
    {
        var data = await SeedAsync("block-move-regression");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var created = await client.SendAsync(CreateJsonPost(BlocksUrl(data.Property.Id),
            JsonSerializer.Serialize(new { physicalRoomId = data.RoomsA[0].Id, startDate = CheckIn, endDate = CheckOut, reason = "Burst pipe" })));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var segment = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("segment").Deserialize<RoomOccupancySegmentDto>(JsonOptions)!;
        var moved = (await (await MoveAsync(client, data.Property.Id, segment.Id, MoveBody(segment.Version, data.RoomsA[1].Id))).Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;
        var cancelled = await client.SendAsync(CreateJsonPost($"{BlocksUrl(data.Property.Id)}/{moved[1].Id}/cancel", $"{{\"expectedVersion\":{moved[1].Version}}}"));
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);

        // A status the controller does not know is a refusal shape, never a 200.
        // (Unauthorized is a real enum member this store never returns; 99 is not a member at all.)
        foreach (var status in new[] { SegmentMutationStatus.Unauthorized, (SegmentMutationStatus)99 })
        {
            var unknown = new CountingBlockStore { Answer = new SegmentMutationResult(status, null, "mystery") };
            using var spyHost = CreateWriteHost(builder => builder.ConfigureTestServices(services => services.AddScoped<IOperationalBlockMutationStore>(_ => unknown)));
            using var spyClient = CreateHttpsClient(spyHost);
            var refusal = await MoveAsync(spyClient, Guid.NewGuid(), Guid.NewGuid(), MoveBody(1, Guid.NewGuid()));
            Assert.Equal(HttpStatusCode.Conflict, refusal.StatusCode);
            Assert.Equal(ConflictTitle, await TitleAsync(refusal));
        }
    }

    // ---------------------------------------------------------------
    // The published contract
    // ---------------------------------------------------------------

    [Fact]
    public async Task OpenApi_publishes_exactly_one_block_move_operation_with_the_two_required_fields_and_json_only()
    {
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        const string Path = "/api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/move";

        Assert.True(swagger.GetProperty("paths").TryGetProperty(Path, out var pathItem), $"{Path} must be published");
        Assert.Equal(["post"], pathItem.EnumerateObject().Select(o => o.Name).ToArray());
        var post = pathItem.GetProperty("post");
        var responses = post.GetProperty("responses");
        Assert.Equal(["200", "400", "403", "404", "409", "415"], responses.EnumerateObject().Select(r => r.Name).Order().ToArray());

        var success = responses.GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema");
        Assert.Equal("array", success.GetProperty("type").GetString());
        Assert.Equal("#/components/schemas/RoomOccupancySegmentDto", success.GetProperty("items").GetProperty("$ref").GetString());
        foreach (var status in new[] { "400", "403", "409", "415" })
        {
            Assert.Equal("#/components/schemas/ProblemDetails", BodySchemaRef(responses.GetProperty(status)));
        }

        Assert.False(responses.GetProperty("404").TryGetProperty("content", out _));
        Assert.False(post.TryGetProperty("security", out _));

        var content = post.GetProperty("requestBody").GetProperty("content");
        Assert.Equal(["application/json"], content.EnumerateObject().Select(m => m.Name).ToArray());
        var schemaRef = content.GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()!;
        var schema = swagger.GetProperty("components").GetProperty("schemas").GetProperty(schemaRef["#/components/schemas/".Length..]);
        Assert.Equal(["destinationPhysicalRoomId", "expectedVersion", "reason"], schema.GetProperty("properties").EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(["destinationPhysicalRoomId", "expectedVersion"], schema.GetProperty("required").EnumerateArray().Select(e => e.GetString()!).Order(StringComparer.Ordinal).ToArray());

        // Below the collection only cancel and move exist: no block split, swap or batch route.
        var subPaths = swagger.GetProperty("paths").EnumerateObject().Select(p => p.Name)
            .Where(p => p.Contains("operational-blocks/", StringComparison.OrdinalIgnoreCase)).Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(["/api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/cancel", Path], subPaths);
    }

    // ---------------------------------------------------------------
    // Spy and seeding
    // ---------------------------------------------------------------

    /// <summary>Counts calls, remembers each move command and answers a conflict (or <see cref="Answer"/>), so nothing is written.</summary>
    private sealed class CountingBlockStore : IOperationalBlockMutationStore
    {
        public int Calls;
        public List<MoveOperationalBlockCommand> Moves { get; } = [];
        public SegmentMutationResult Answer { get; init; } = SegmentMutationResult.Conflict("spy");

        public Task<CreateRoomBlockResult> CreateBlockAsync(CreateRoomBlockCommand command, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            return Task.FromResult(CreateRoomBlockResult.Conflict("spy"));
        }

        public Task<SegmentMutationResult> SupersedeSegmentsAsync(SupersedeBlockSegmentsCommand command, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            return Task.FromResult(Answer);
        }

        public Task<SegmentMutationResult> MoveAsync(MoveOperationalBlockCommand command, CancellationToken cancellationToken)
        {
            lock (Moves)
            {
                Moves.Add(command);
            }

            Interlocked.Increment(ref Calls);
            return Task.FromResult(Answer);
        }
    }

    private sealed record Fixture(
        Property Property, RoomType TypeA, RoomType TypeB, RatePlan RatePlan,
        List<PhysicalRoom> RoomsA, List<PhysicalRoom> RoomsB, PhysicalRoom InactiveA);

    private async Task<Fixture> SeedAsync(string slug)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var typeA = new RoomType(Guid.NewGuid(), property.Id, "MVA", slug, $"{slug}-a", null, 2, 4, true, Now);
        var typeB = new RoomType(Guid.NewGuid(), property.Id, "MVB", slug, $"{slug}-b", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "MV", slug, null, "VND", true, Now);
        context.AddRange(property, typeA, typeB, ratePlan);
        var roomsA = Enumerable.Range(0, 4).Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, typeA, $"A{i}", 1, OperationalStatus.Active, Now)).ToList();
        var roomsB = Enumerable.Range(0, 2).Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, typeB, $"B{i}", 1, OperationalStatus.Active, Now)).ToList();
        var inactive = new PhysicalRoom(Guid.NewGuid(), property.Id, typeA, "A-inactive", 1, OperationalStatus.OutOfService, Now);
        context.AddRange(roomsA.Concat(roomsB).Append(inactive));
        await context.SaveChangesAsync();
        return new Fixture(property, typeA, typeB, ratePlan, roomsA, roomsB, inactive);
    }

    private async Task<(Property Property, PhysicalRoom Room)> SeedForeignAsync()
    {
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Hotel foreign", $"foreign-{Guid.NewGuid():N}", null, "2 Hotel Street", "Hue", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var type = new RoomType(Guid.NewGuid(), property.Id, "FOR", "foreign", $"foreign-{Guid.NewGuid():N}", null, 2, 4, true, Now);
        var room = new PhysicalRoom(Guid.NewGuid(), property.Id, type, "F0", 1, OperationalStatus.Active, Now);
        context.AddRange(property, type, room);
        await context.SaveChangesAsync();
        return (property, room);
    }

    /// <summary>A block created through the unchanged store, so its header, version and Created audit are the real ones.</summary>
    private async Task<RoomOccupancySegmentDto> CreateBlockAsync(Fixture data, PhysicalRoom room, DateOnly start, DateOnly end, string reason)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IOperationalBlockMutationStore>();
        var created = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(data.Property.Id, reason, "actor:housekeeping", [new BlockSegmentSpec(room.Id, start, end)]),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, created.Status);
        return created.Segments![0];
    }

    private async Task SellAsync(Fixture data, RoomType type, int units)
    {
        await using var context = factory.CreateDbContext();
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m)).ToArray();
        var seed = $"sell-{type.Id}-{units}";
        var hold = new InventoryHold(
            Guid.NewGuid(), data.Property.Id, type.Id, units, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash($"{seed}:idempotency"), HexHash($"{seed}:fingerprint"), HexHash($"{seed}:guest"), nights);
        context.Add(hold);
        context.Add(hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash(seed)[..8].ToUpperInvariant()}", Now));
        await context.SaveChangesAsync();
    }

    /// <summary>An Effective reservation assignment in <paramref name="room"/> over a unit sold for the whole stay.</summary>
    private async Task<RoomOccupancySegmentDto> CreateAssignmentAsync(Fixture data, PhysicalRoom room, DateOnly? start = null, DateOnly? end = null)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        await using var context = factory.CreateDbContext();
        if (!await context.ReservationUnits.AnyAsync(u => u.PropertyId == data.Property.Id && u.RoomTypeId == data.TypeA.Id))
        {
            await SellAsync(data, data.TypeA, 1);
        }

        var unit = await context.ReservationUnits.AsNoTracking()
            .Where(u => u.PropertyId == data.Property.Id && u.RoomTypeId == data.TypeA.Id).OrderBy(u => u.Id).FirstAsync();
        var store = scope.ServiceProvider.GetRequiredService<IAssignmentMutationStore>();
        var result = await store.CreateAsync(
            new CreateAssignmentCommand(data.Property.Id, unit.Id, new AssignmentDestination(room.Id, start ?? CheckIn, end ?? CheckOut), "actor:front-desk", null, null),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        return result.Segments![0];
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();
}
