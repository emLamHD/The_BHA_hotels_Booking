using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.2-CP04B acceptance: the Admin assignment move/unassign
/// endpoints, proven against real PostgreSQL 17 through a real host.
///
/// <para>
/// This suite proves only what is new — the two thin HTTP adapters over
/// <see cref="IAssignmentMutationStore.SupersedeAsync"/>: status mapping, the
/// server-owned audit identity, the single-segment/single-replacement
/// narrowing (never a general split/swap/batch surface), and the same CP01
/// write-gate composition applied to two more real routes. The scheduling
/// invariants behind <c>SupersedeAsync</c> itself — exact-partition
/// enforcement, capacity, concurrency, cross-property isolation,
/// per-event audit-evidence integrity (PMS-CAL-001.2-CP04A) — are already
/// proven directly against the store by <see cref="AssignmentMutationStoreTests"/>,
/// and the gate's transport/origin/media-type permutations by
/// <see cref="AdminCalendarWriteGateApiTests"/>; neither matrix is repeated
/// here. <see cref="AdminCalendarAssignmentApiTests"/> proves the sibling
/// create endpoint the same way.
/// </para>
///
/// <para>
/// Every refusal is checked against the pre-existing segment/audit state, not
/// just an empty database: for move/unassign there is always a prior segment
/// on the row, so "nothing written" means "the row and its audit history are
/// exactly as they were", not "the table is empty".
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminCalendarAssignmentMoveUnassignApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6); // 5 nights: 9/1-9/5

    private const string AllowedAdminOrigin = "https://localhost:3001";
    private const string ServerOwnedActor = "admin-calendar-local-development";
    private const string ServerOwnedEvidence = "local-development-write-gate:cross-room-type-confirmed";

    // ---------------------------------------------------------------
    // Host and request helpers
    // ---------------------------------------------------------------

    private WebApplicationFactory<Program> CreateWriteHost() =>
        factory.WithWebHostBuilder(builder =>
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true"));

    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });

    private static string AssignmentsUrl(Guid propertyId) =>
        $"/api/admin/v1/properties/{propertyId}/reservation-assignments";

    private static string MoveUrl(Guid propertyId, Guid segmentId) =>
        $"{AssignmentsUrl(propertyId)}/{segmentId}/move";

    private static string UnassignUrl(Guid propertyId, Guid segmentId) =>
        $"{AssignmentsUrl(propertyId)}/{segmentId}/unassign";

    private static HttpRequestMessage CreateJsonPost(string url, string body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)),
        };
        request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");
        request.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        return request;
    }

    private static string CreateAssignmentBody(
        Guid reservationUnitId,
        Guid physicalRoomId,
        DateOnly startDate,
        DateOnly endDate,
        bool confirmCrossRoomType = false,
        string? reason = null) =>
        $$"""
        {
          "reservationUnitId": "{{reservationUnitId}}",
          "physicalRoomId": "{{physicalRoomId}}",
          "startDate": "{{startDate:yyyy-MM-dd}}",
          "endDate": "{{endDate:yyyy-MM-dd}}",
          "confirmCrossRoomType": {{(confirmCrossRoomType ? "true" : "false")}},
          "reason": {{(reason is null ? "null" : JsonSerializer.Serialize(reason))}}
        }
        """;

    private static string MoveBody(
        uint expectedVersion,
        Guid physicalRoomId,
        DateOnly startDate,
        DateOnly endDate,
        bool confirmCrossRoomType = false,
        string? reason = null,
        string? extraProperties = null) =>
        $$"""
        {
          "expectedVersion": {{expectedVersion}},
          "physicalRoomId": "{{physicalRoomId}}",
          "startDate": "{{startDate:yyyy-MM-dd}}",
          "endDate": "{{endDate:yyyy-MM-dd}}",
          "confirmCrossRoomType": {{(confirmCrossRoomType ? "true" : "false")}},
          "reason": {{(reason is null ? "null" : JsonSerializer.Serialize(reason))}}{{extraProperties}}
        }
        """;

    private static string UnassignBody(
        uint expectedVersion,
        string? reason = null,
        string? extraProperties = null) =>
        $$"""
        {
          "expectedVersion": {{expectedVersion}},
          "reason": {{(reason is null ? "null" : JsonSerializer.Serialize(reason))}}{{extraProperties}}
        }
        """;

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

    /// <summary>Creates one Effective segment through the real create endpoint — the realistic origin of every segment this suite moves or unassigns.</summary>
    private async Task<RoomOccupancySegmentDto> CreateAssignmentAsync(
        HttpClient client, Guid propertyId, Guid unitId, Guid roomId)
    {
        using var request = CreateJsonPost(AssignmentsUrl(propertyId), CreateAssignmentBody(unitId, roomId, CheckIn, CheckOut));
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>())!;
    }

    private async Task<List<RoomOccupancySegment>> SegmentsAsync(Guid propertyId)
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegments.AsNoTracking().Where(s => s.PropertyId == propertyId).ToListAsync();
    }

    private async Task<List<RoomOccupancySegmentAudit>> AuditsAsync(Guid propertyId)
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegmentAudits.AsNoTracking().Where(a => a.PropertyId == propertyId).ToListAsync();
    }

    /// <summary>
    /// A snapshot cheap enough to compare before/after a refused attempt: exact
    /// segment set (id/status/room/dates/xmin) and audit count. Segments must be
    /// loaded tracked (not <c>AsNoTracking</c>) in this same context — xmin is a
    /// shadow property, so its value is only readable from a tracked
    /// <see cref="Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry"/> in
    /// the context that materialized it, exactly as
    /// <c>RoomOccupancySegmentMutationSupport.GetVersion</c> requires.
    /// </summary>
    private async Task<string> StateSnapshotAsync(Guid propertyId)
    {
        await using var context = factory.CreateDbContext();
        var segments = await context.RoomOccupancySegments
            .Where(s => s.PropertyId == propertyId)
            .OrderBy(s => s.Id)
            .ToListAsync();
        var parts = segments.Select(s =>
            $"{s.Id}|{s.Status}|{s.PhysicalRoomId}|{s.StartDate}|{s.EndDate}|{context.Entry(s).Property<uint>("xmin").CurrentValue}");
        var auditCount = await context.RoomOccupancySegmentAudits.CountAsync(a => a.PropertyId == propertyId);
        return $"[{string.Join(";", parts)}]#audits={auditCount}";
    }

    /// <summary>Sold RoomType, commitment status and every booked night (date, rate plan, amount), in order.</summary>
    private async Task<string> CommercialSnapshotAsync(Guid unitId)
    {
        await using var context = factory.CreateDbContext();
        var unit = await context.ReservationUnits.AsNoTracking().Include(u => u.Nights).SingleAsync(u => u.Id == unitId);
        var nights = unit.Nights.OrderBy(n => n.StayDate).Select(n => $"{n.StayDate:yyyy-MM-dd}/{n.RatePlanId}/{n.UnitAmount:0.00}");
        return $"{unit.RoomTypeId}|{unit.CommitmentStatus}|{string.Join(",", nights)}";
    }

    private IAssignmentMutationStore CreateStore(WebApplicationFactory<Program> host)
    {
        var scope = host.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<IAssignmentMutationStore>();
    }

    // ---------------------------------------------------------------
    // Acceptance 1: same-RoomType move, end to end
    // ---------------------------------------------------------------

    [Fact]
    public async Task Same_room_type_move_succeeds_cancels_source_creates_successor_and_board_agrees()
    {
        var data = await SeedAsync("cp04b-same-move");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);
        var commercialBefore = await CommercialSnapshotAsync(data.UnitsA[0].Id);

        using var request = CreateJsonPost(
            MoveUrl(data.Property.Id, original.Id),
            MoveBody(original.Version, data.RoomsA[1].Id, CheckIn, CheckOut, reason: "Housekeeping moved the guest"));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal([AllowedAdminOrigin], response.Headers.GetValues("Access-Control-Allow-Origin").ToArray());

        var segments = await response.Content.ReadFromJsonAsync<List<RoomOccupancySegmentDto>>();
        Assert.NotNull(segments);
        Assert.Equal(2, segments!.Count);
        var cancelled = segments.Single(s => s.Id == original.Id);
        var successor = segments.Single(s => s.Id != original.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled.ToString(), cancelled.Status);
        Assert.Equal(RoomOccupancySegmentStatus.Effective.ToString(), successor.Status);
        Assert.Equal(data.RoomsA[1].Id, successor.PhysicalRoomId);
        Assert.Equal(CheckIn, successor.StartDate);
        Assert.Equal(CheckOut, successor.EndDate);
        Assert.Equal(data.UnitsA[0].Id, successor.ReservationUnitId);

        var persisted = await SegmentsAsync(data.Property.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled, persisted.Single(s => s.Id == original.Id).Status);
        var persistedSuccessor = persisted.Single(s => s.Status == RoomOccupancySegmentStatus.Effective);
        Assert.Equal(data.RoomsA[1].Id, persistedSuccessor.PhysicalRoomId);

        var audits = await AuditsAsync(data.Property.Id);
        var cancelledAudit = Assert.Single(audits, a => a.SegmentId == original.Id && a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        var createdAudit = Assert.Single(audits, a => a.SegmentId == successor.Id && a.EventType == RoomOccupancySegmentAuditEventType.Created);
        Assert.Equal(ServerOwnedActor, cancelledAudit.ActorReference);
        Assert.Null(cancelledAudit.AuthorizationEvidence); // same-RoomType — never evidence, even on the Cancelled row (PMS-CAL-001.2-CP04A)
        Assert.Equal("Housekeeping moved the guest", cancelledAudit.Reason);
        Assert.Equal(ServerOwnedActor, createdAudit.ActorReference);
        Assert.Null(createdAudit.AuthorizationEvidence);
        Assert.Equal(cancelledAudit.MutationGroupId, createdAudit.MutationGroupId);

        var board = await client.GetFromJsonAsync<JsonElement>(
            $"/api/admin/v1/properties/{data.Property.Id}/reservation-board?from={CheckIn:yyyy-MM-dd}&to={CheckOut:yyyy-MM-dd}");
        var stay = Assert.Single(board.GetProperty("stays").EnumerateArray());
        var boardAssignment = Assert.Single(stay.GetProperty("assignments").EnumerateArray());
        Assert.Equal(successor.Id.ToString(), boardAssignment.GetProperty("segmentId").GetString());
        Assert.Equal(data.RoomsA[1].Id.ToString(), boardAssignment.GetProperty("physicalRoomId").GetString());

        Assert.Equal(commercialBefore, await CommercialSnapshotAsync(data.UnitsA[0].Id));
    }

    // ---------------------------------------------------------------
    // Acceptance 2 and 3: cross-RoomType move — refusal and success
    // ---------------------------------------------------------------

    [Fact]
    public async Task Cross_room_type_move_needs_acknowledgement_and_reason_and_is_rejected_atomically_without_either()
    {
        var data = await SeedAsync("cp04b-cross-move-refused");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);
        var baseline = await StateSnapshotAsync(data.Property.Id);

        using var unconfirmed = CreateJsonPost(
            MoveUrl(data.Property.Id, original.Id),
            MoveBody(original.Version, data.RoomsB[0].Id, CheckIn, CheckOut, reason: "Guest requested upgrade"));
        var unconfirmedResponse = await client.SendAsync(unconfirmed);
        Assert.Equal(HttpStatusCode.Forbidden, unconfirmedResponse.StatusCode);
        Assert.Equal("Cross-RoomType confirmation required", await TitleAsync(unconfirmedResponse));
        Assert.Equal(baseline, await StateSnapshotAsync(data.Property.Id));

        using var blankReason = CreateJsonPost(
            MoveUrl(data.Property.Id, original.Id),
            MoveBody(original.Version, data.RoomsB[0].Id, CheckIn, CheckOut, confirmCrossRoomType: true, reason: "   "));
        var blankReasonResponse = await client.SendAsync(blankReason);
        Assert.Equal(HttpStatusCode.Forbidden, blankReasonResponse.StatusCode);
        Assert.Equal(baseline, await StateSnapshotAsync(data.Property.Id));
    }

    [Fact]
    public async Task Cross_room_type_move_records_server_owned_evidence_and_the_caller_reason_ignoring_forged_actor_fields()
    {
        var data = await SeedAsync("cp04b-cross-move-succeeds");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);

        using var request = CreateJsonPost(
            MoveUrl(data.Property.Id, original.Id),
            MoveBody(
                original.Version, data.RoomsB[0].Id, CheckIn, CheckOut,
                confirmCrossRoomType: true, reason: "  Guest requested upgrade  ",
                extraProperties: """
                ,
                  "actorReference": "staff:general-manager",
                  "authorizationEvidence": "approval:forged-by-the-caller"
                """));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var segments = await response.Content.ReadFromJsonAsync<List<RoomOccupancySegmentDto>>();
        var successor = segments!.Single(s => s.Id != original.Id);
        Assert.Equal(data.RoomsB[0].Id, successor.PhysicalRoomId);

        var audits = await AuditsAsync(data.Property.Id);
        var cancelledAudit = Assert.Single(audits, a => a.SegmentId == original.Id && a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        var createdAudit = Assert.Single(audits, a => a.SegmentId == successor.Id && a.EventType == RoomOccupancySegmentAuditEventType.Created);
        // The successor's own Created row is evidence — it crosses. The Cancelled row of the
        // segment it replaced never is (PMS-CAL-001.2-CP04A), regardless of this command's flag.
        Assert.Equal(ServerOwnedActor, createdAudit.ActorReference);
        Assert.Equal(ServerOwnedEvidence, createdAudit.AuthorizationEvidence);
        Assert.Equal("Guest requested upgrade", createdAudit.Reason);
        Assert.Equal(ServerOwnedActor, cancelledAudit.ActorReference);
        Assert.Null(cancelledAudit.AuthorizationEvidence);
    }

    // ---------------------------------------------------------------
    // Acceptance 4: cross-type -> sold-type move never fabricates evidence
    // ---------------------------------------------------------------

    [Fact]
    public async Task Cross_type_to_sold_type_move_records_no_evidence_and_preserves_the_commercial_snapshot()
    {
        var data = await SeedAsync("cp04b-cross-to-sold");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        using var initial = CreateJsonPost(
            AssignmentsUrl(data.Property.Id),
            CreateAssignmentBody(data.UnitsA[0].Id, data.RoomsB[0].Id, CheckIn, CheckOut, confirmCrossRoomType: true, reason: "Original upgrade"));
        var initialResponse = await client.SendAsync(initial);
        Assert.Equal(HttpStatusCode.Created, initialResponse.StatusCode);
        var original = (await initialResponse.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>())!;
        var commercialBefore = await CommercialSnapshotAsync(data.UnitsA[0].Id);

        using var request = CreateJsonPost(
            MoveUrl(data.Property.Id, original.Id),
            MoveBody(original.Version, data.RoomsA[0].Id, CheckIn, CheckOut, reason: "Back to the sold room type"));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var segments = await response.Content.ReadFromJsonAsync<List<RoomOccupancySegmentDto>>();
        var successor = segments!.Single(s => s.Id != original.Id);
        Assert.Equal(data.RoomsA[0].Id, successor.PhysicalRoomId);

        var audits = await AuditsAsync(data.Property.Id);
        var createdAudit = Assert.Single(audits, a => a.SegmentId == successor.Id && a.EventType == RoomOccupancySegmentAuditEventType.Created);
        Assert.Null(createdAudit.AuthorizationEvidence); // successor is same-RoomType as the Unit's sold RoomType
        var cancelledAudit = Assert.Single(audits, a => a.SegmentId == original.Id && a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        Assert.Null(cancelledAudit.AuthorizationEvidence);

        // The earlier cross-type creation keeps its own true evidence — history is appended, never rewritten.
        var originalCreated = Assert.Single(audits, a => a.SegmentId == original.Id && a.EventType == RoomOccupancySegmentAuditEventType.Created);
        Assert.Equal(ServerOwnedEvidence, originalCreated.AuthorizationEvidence);
        Assert.Equal("Original upgrade", originalCreated.Reason);

        Assert.Equal(commercialBefore, await CommercialSnapshotAsync(data.UnitsA[0].Id));
    }

    // ---------------------------------------------------------------
    // Acceptance 5 and 6: unassign — same-type, cross-type, and a rejected
    // cross-type unassign that has nowhere safe to revert demand to
    // ---------------------------------------------------------------

    [Fact]
    public async Task Same_type_unassign_succeeds_and_the_board_shows_the_range_unassigned_again()
    {
        var data = await SeedAsync("cp04b-unassign-same");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);
        var commercialBefore = await CommercialSnapshotAsync(data.UnitsA[0].Id);

        using var request = CreateJsonPost(
            UnassignUrl(data.Property.Id, original.Id),
            UnassignBody(original.Version, reason: "Guest cancelled the room swap"));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var segments = await response.Content.ReadFromJsonAsync<List<RoomOccupancySegmentDto>>();
        var cancelled = Assert.Single(segments!);
        Assert.Equal(original.Id, cancelled.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled.ToString(), cancelled.Status);

        var audit = Assert.Single(await AuditsAsync(data.Property.Id), a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        Assert.Equal(ServerOwnedActor, audit.ActorReference);
        Assert.Null(audit.AuthorizationEvidence);
        Assert.Equal("Guest cancelled the room swap", audit.Reason);

        var board = await client.GetFromJsonAsync<JsonElement>(
            $"/api/admin/v1/properties/{data.Property.Id}/reservation-board?from={CheckIn:yyyy-MM-dd}&to={CheckOut:yyyy-MM-dd}");
        var stay = Assert.Single(board.GetProperty("stays").EnumerateArray());
        Assert.Equal("FullyUnassigned", stay.GetProperty("coverageStatus").GetString());
        Assert.Empty(stay.GetProperty("assignments").EnumerateArray());
        var unassignedRange = Assert.Single(stay.GetProperty("unassignedRanges").EnumerateArray());
        Assert.Equal(CheckIn.ToString("yyyy-MM-dd"), unassignedRange.GetProperty("startDate").GetString());
        Assert.Equal(CheckOut.ToString("yyyy-MM-dd"), unassignedRange.GetProperty("endDate").GetString());

        Assert.Equal(commercialBefore, await CommercialSnapshotAsync(data.UnitsA[0].Id));
    }

    [Fact]
    public async Task Cross_type_unassign_succeeds_when_the_sold_room_type_has_capacity_to_receive_the_reverted_demand()
    {
        var data = await SeedAsync("cp04b-unassign-cross");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        using var initial = CreateJsonPost(
            AssignmentsUrl(data.Property.Id),
            CreateAssignmentBody(data.UnitsA[0].Id, data.RoomsB[0].Id, CheckIn, CheckOut, confirmCrossRoomType: true, reason: "Upgrade"));
        var initialResponse = await client.SendAsync(initial);
        var original = (await initialResponse.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>())!;

        using var request = CreateJsonPost(UnassignUrl(data.Property.Id, original.Id), UnassignBody(original.Version));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var board = await client.GetFromJsonAsync<JsonElement>(
            $"/api/admin/v1/properties/{data.Property.Id}/reservation-board?from={CheckIn:yyyy-MM-dd}&to={CheckOut:yyyy-MM-dd}");
        var stay = Assert.Single(board.GetProperty("stays").EnumerateArray());
        Assert.Equal("FullyUnassigned", stay.GetProperty("coverageStatus").GetString());
    }

    /// <summary>
    /// Cross-type unassign reverts demand to the Unit's sold RoomType. When that
    /// RoomType has no capacity left for these nights, the store's final-state
    /// capacity check refuses the whole mutation — the guest keeps the upgraded
    /// room rather than being silently left with nowhere counted.
    /// </summary>
    [Fact]
    public async Task Cross_type_unassign_without_capacity_to_fall_back_to_is_rejected_and_the_source_stays_effective()
    {
        var data = await SeedAsync("cp04b-unassign-no-capacity", roomsAPerType: 1);
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        using var initial = CreateJsonPost(
            AssignmentsUrl(data.Property.Id),
            CreateAssignmentBody(data.UnitsA[0].Id, data.RoomsB[0].Id, CheckIn, CheckOut, confirmCrossRoomType: true, reason: "Upgrade"));
        var initialResponse = await client.SendAsync(initial);
        var original = (await initialResponse.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>())!;

        // Sell out RoomTypeA's only room with a second, unrelated Unit — no
        // Admin HTTP surface creates bookings, so this uses the store directly,
        // exactly as AssignmentMutationStoreTests' own SellOutRoomTypeAAsync does.
        await using (var context = factory.CreateDbContext())
        {
            var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
                .Select(o => new NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m));
            var hold = new InventoryHold(
                Guid.NewGuid(), data.Property.Id, data.RoomTypeA.Id, 1, null, "Fill Guest", "fill@example.com",
                "+84 900 000 222", CheckIn, CheckOut, 1, 0, "VND", Now,
                HexHash("cp04b-fill:idempotency"), HexHash("cp04b-fill:fingerprint"), HexHash("cp04b-fill:guest"), nights);
            context.Add(hold);
            var reservation = hold.Confirm(Guid.NewGuid(), "BHA-CP04BFILL", Now);
            context.Add(reservation);
            await context.SaveChangesAsync();
            var fillResult = await CreateStore(host).CreateAsync(
                new CreateAssignmentCommand(
                    data.Property.Id, reservation.Units[0].Id,
                    new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                    "actor:test-fixture", null, null),
                CancellationToken.None);
            Assert.Equal(SegmentMutationStatus.Succeeded, fillResult.Status);
        }

        using var request = CreateJsonPost(UnassignUrl(data.Property.Id, original.Id), UnassignBody(original.Version));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("Assignment conflict", await TitleAsync(response));

        var persisted = Assert.Single(await SegmentsAsync(data.Property.Id), s => s.Id == original.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, persisted.Status);
    }

    // ---------------------------------------------------------------
    // Acceptance 7: stale/wrong expectedVersion
    // ---------------------------------------------------------------

    [Fact]
    public async Task Stale_expected_version_is_a_conflict_and_writes_nothing_for_move_and_unassign()
    {
        var data = await SeedAsync("cp04b-stale-version");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);
        var staleVersion = original.Version + 12345;
        var baseline = await StateSnapshotAsync(data.Property.Id);

        using var moveRequest = CreateJsonPost(
            MoveUrl(data.Property.Id, original.Id),
            MoveBody(staleVersion, data.RoomsA[1].Id, CheckIn, CheckOut));
        var moveResponse = await client.SendAsync(moveRequest);
        Assert.Equal(HttpStatusCode.Conflict, moveResponse.StatusCode);
        Assert.Equal("Assignment conflict", await TitleAsync(moveResponse));
        Assert.Equal(baseline, await StateSnapshotAsync(data.Property.Id));

        using var unassignRequest = CreateJsonPost(UnassignUrl(data.Property.Id, original.Id), UnassignBody(staleVersion));
        var unassignResponse = await client.SendAsync(unassignRequest);
        Assert.Equal(HttpStatusCode.Conflict, unassignResponse.StatusCode);
        Assert.Equal(baseline, await StateSnapshotAsync(data.Property.Id));
    }

    // ---------------------------------------------------------------
    // Acceptance 8: representative status mapping, without restating the
    // store's own invariant matrix
    // ---------------------------------------------------------------

    [Theory]
    [InlineData("unknown-segment", HttpStatusCode.NotFound, "Assignment target not found")]
    [InlineData("other-property", HttpStatusCode.NotFound, "Assignment target not found")]
    [InlineData("unknown-room", HttpStatusCode.NotFound, "Assignment target not found")]
    [InlineData("inactive-room", HttpStatusCode.Conflict, "Assignment conflict")]
    [InlineData("overlapping-room", HttpStatusCode.Conflict, "Assignment conflict")]
    [InlineData("mismatched-dates", HttpStatusCode.BadRequest, "Invalid assignment request")]
    public async Task Refused_moves_map_to_the_documented_status_and_write_nothing(
        string scenario, HttpStatusCode expectedStatus, string expectedTitle)
    {
        var data = await SeedAsync("cp04b-move-mapping", unitsA: 2);
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);

        var routePropertyId = data.Property.Id;
        var segmentId = original.Id;
        var body = scenario switch
        {
            "unknown-segment" => MoveBody(original.Version, data.RoomsA[1].Id, CheckIn, CheckOut),
            "other-property" => MoveBody(original.Version, data.RoomsA[1].Id, CheckIn, CheckOut),
            "unknown-room" => MoveBody(original.Version, Guid.NewGuid(), CheckIn, CheckOut),
            "inactive-room" => MoveBody(original.Version, data.InactiveRoomA.Id, CheckIn, CheckOut),
            "overlapping-room" => MoveBody(original.Version, data.RoomsA[1].Id, CheckIn, CheckOut),
            "mismatched-dates" => MoveBody(original.Version, data.RoomsA[1].Id, CheckIn, CheckOut.AddDays(-1)),
            _ => throw new InvalidOperationException(scenario),
        };

        if (scenario == "unknown-segment")
        {
            segmentId = Guid.NewGuid();
        }
        else if (scenario == "other-property")
        {
            routePropertyId = (await SeedOtherPropertyAsync()).Id;
        }
        else if (scenario == "overlapping-room")
        {
            // A second Unit already occupies RoomsA[1] for these exact dates.
            await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[1].Id, data.RoomsA[1].Id);
        }

        using var request = CreateJsonPost(MoveUrl(routePropertyId, segmentId), body);
        var response = await client.SendAsync(request);

        Assert.Equal(expectedStatus, response.StatusCode);
        Assert.Equal(expectedTitle, await TitleAsync(response));
        var persistedOriginal = Assert.Single(await SegmentsAsync(data.Property.Id), s => s.Id == original.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, persistedOriginal.Status);
    }

    /// <summary>
    /// All four are value types on <c>MoveReservationAssignmentRequest</c>, so
    /// without <c>[JsonRequired]</c> an omitted property would deserialize to
    /// its default and reach the store as a real-looking value — exactly the
    /// bug <see cref="AdminCalendarAssignmentApiTests"/>'s Correction C2,
    /// finding 1 fixed for <see cref="AdminReservationAssignmentsController.Create"/>.
    /// This proves the same fix on <see cref="AdminReservationAssignmentsController.Move"/>
    /// behaviourally, not only through the published OpenAPI schema.
    /// </summary>
    [Theory]
    [InlineData("expectedVersion")]
    [InlineData("physicalRoomId")]
    [InlineData("startDate")]
    [InlineData("endDate")]
    public async Task An_omitted_required_move_property_is_refused_before_the_store(string omitted)
    {
        var data = await SeedAsync("cp04b-move-omitted");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);
        var baseline = await StateSnapshotAsync(data.Property.Id);

        var properties = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["expectedVersion"] = original.Version.ToString(),
            ["physicalRoomId"] = $"\"{data.RoomsA[1].Id}\"",
            ["startDate"] = $"\"{CheckIn:yyyy-MM-dd}\"",
            ["endDate"] = $"\"{CheckOut:yyyy-MM-dd}\"",
            ["confirmCrossRoomType"] = "false",
            ["reason"] = "null",
        };
        properties.Remove(omitted);
        var body = $"{{{string.Join(",", properties.Select(p => $"\"{p.Key}\":{p.Value}"))}}}";

        using var request = CreateJsonPost(MoveUrl(data.Property.Id, original.Id), body);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(baseline, await StateSnapshotAsync(data.Property.Id));
    }

    /// <summary>An omitted <c>expectedVersion</c> on Unassign is refused the same way — see the Move variant above.</summary>
    [Fact]
    public async Task An_omitted_expected_version_on_unassign_is_refused_before_the_store()
    {
        var data = await SeedAsync("cp04b-unassign-omitted");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);
        var baseline = await StateSnapshotAsync(data.Property.Id);

        using var request = CreateJsonPost(UnassignUrl(data.Property.Id, original.Id), """{"reason":null}""");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(baseline, await StateSnapshotAsync(data.Property.Id));
    }

    // ---------------------------------------------------------------
    // Acceptance 9: extra actor/evidence in the body never becomes identity
    // ---------------------------------------------------------------

    [Fact]
    public async Task Forged_actor_and_evidence_in_the_unassign_body_are_ignored()
    {
        var data = await SeedAsync("cp04b-forged-unassign");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);

        using var request = CreateJsonPost(
            UnassignUrl(data.Property.Id, original.Id),
            UnassignBody(
                original.Version, reason: "Guest changed plans",
                extraProperties: """
                ,
                  "actorReference": "staff:general-manager",
                  "authorizationEvidence": "approval:forged-by-the-caller",
                  "confirmCrossRoomType": true
                """));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var audit = Assert.Single(await AuditsAsync(data.Property.Id), a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        Assert.Equal(ServerOwnedActor, audit.ActorReference);
        Assert.Null(audit.AuthorizationEvidence);
    }

    // ---------------------------------------------------------------
    // Acceptance 10: the closed gate owns these two real routes too
    // ---------------------------------------------------------------

    [Fact]
    public async Task Closed_write_gate_refuses_move_and_unassign_before_the_controller_runs()
    {
        var data = await SeedAsync("cp04b-closed-gate");
        using var writeHost = CreateWriteHost();
        using var writeClient = CreateHttpsClient(writeHost);
        var original = await CreateAssignmentAsync(writeClient, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);

        // The ordinary host: AdminCalendar:EnableUnauthenticatedWrite is false.
        using var closedClient = CreateHttpsClient(factory);

        using var moveRequest = CreateJsonPost(
            MoveUrl(data.Property.Id, original.Id),
            MoveBody(original.Version, data.RoomsA[1].Id, CheckIn, CheckOut));
        var moveResponse = await closedClient.SendAsync(moveRequest);
        Assert.Equal(HttpStatusCode.NotFound, moveResponse.StatusCode);
        Assert.Equal("no-store", moveResponse.Headers.CacheControl?.ToString());

        using var unassignRequest = CreateJsonPost(UnassignUrl(data.Property.Id, original.Id), UnassignBody(original.Version));
        var unassignResponse = await closedClient.SendAsync(unassignRequest);
        Assert.Equal(HttpStatusCode.NotFound, unassignResponse.StatusCode);

        var persisted = Assert.Single(await SegmentsAsync(data.Property.Id), s => s.Id == original.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, persisted.Status);
        Assert.Single(await AuditsAsync(data.Property.Id));
    }

    // ---------------------------------------------------------------
    // Acceptance 11: the published contract adds exactly move and unassign
    // ---------------------------------------------------------------

    [Fact]
    public async Task OpenApi_publishes_exactly_move_and_unassign_with_no_actor_fields_and_no_split_or_swap_contract()
    {
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        const string BasePath = "/api/admin/v1/properties/{propertyId}/reservation-assignments";

        foreach (var (path, requiredFields, allFields) in new[]
        {
            ($"{BasePath}/{{segmentId}}/move",
                new[] { "expectedVersion", "physicalRoomId", "startDate", "endDate" },
                new[] { "confirmCrossRoomType", "endDate", "expectedVersion", "physicalRoomId", "reason", "startDate" }),
            ($"{BasePath}/{{segmentId}}/unassign",
                new[] { "expectedVersion" },
                new[] { "expectedVersion", "reason" }),
        })
        {
            Assert.True(swagger.GetProperty("paths").TryGetProperty(path, out var pathItem), $"{path} must be published");
            var operations = pathItem.EnumerateObject().Select(o => o.Name).ToArray();
            Assert.Equal(["post"], operations);

            var post = pathItem.GetProperty("post");
            var responses = post.GetProperty("responses");
            var expectedStatuses = path.EndsWith("/move", StringComparison.Ordinal)
                ? new[] { "200", "400", "403", "404", "409", "415" }
                : ["200", "400", "404", "409", "415"];
            Assert.Equal(expectedStatuses.Order().ToArray(), responses.EnumerateObject().Select(r => r.Name).Order().ToArray());

            // The 200 body is an array of segments (cancelled source, then created
            // successor for move; just the cancelled source for unassign) — not
            // one resource, so it is asserted as an array-of-$ref shape directly
            // rather than through BodySchemaRef (which expects a bare $ref).
            var successSchema = responses.GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema");
            Assert.Equal("array", successSchema.GetProperty("type").GetString());
            Assert.Equal(
                "#/components/schemas/RoomOccupancySegmentDto",
                successSchema.GetProperty("items").GetProperty("$ref").GetString());

            foreach (var status in expectedStatuses.Where(s => s is not ("200" or "404")))
            {
                Assert.Equal("#/components/schemas/ProblemDetails", BodySchemaRef(responses.GetProperty(status)));
            }
            Assert.False(responses.GetProperty("404").TryGetProperty("content", out _));

            var requestContent = post.GetProperty("requestBody").GetProperty("content");
            Assert.Equal(["application/json"], requestContent.EnumerateObject().Select(m => m.Name).ToArray());

            var schemaRef = requestContent.GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()!;
            var schema = swagger.GetProperty("components").GetProperty("schemas").GetProperty(schemaRef["#/components/schemas/".Length..]);
            var properties = schema.GetProperty("properties").EnumerateObject().Select(p => p.Name).ToArray();
            Assert.Equal(allFields.Order(StringComparer.OrdinalIgnoreCase).ToArray(), properties.Order(StringComparer.OrdinalIgnoreCase).ToArray());
            Assert.DoesNotContain("actorReference", properties);
            Assert.DoesNotContain("authorizationEvidence", properties);

            var required = schema.TryGetProperty("required", out var requiredArray)
                ? requiredArray.EnumerateArray().Select(e => e.GetString()!).Order(StringComparer.OrdinalIgnoreCase).ToArray()
                : [];
            Assert.Equal(requiredFields.Order(StringComparer.OrdinalIgnoreCase).ToArray(), required);
        }

        // No generic split/swap/batch surface: no path anywhere accepts more
        // than one segment id or more than one replacement per request — the
        // schemas above are the whole of what CP04B exposes.
        var allPaths = swagger.GetProperty("paths").EnumerateObject().Select(p => p.Name).ToArray();
        Assert.DoesNotContain(allPaths, p => p.Contains("split", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(allPaths, p => p.Contains("swap", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(allPaths, p => p.Contains("batch", StringComparison.OrdinalIgnoreCase));
    }

    // ---------------------------------------------------------------
    // Acceptance 13: concurrent conflicting moves cannot double-book
    // ---------------------------------------------------------------

    [Fact]
    public async Task Concurrent_moves_targeting_the_same_room_and_dates_leave_exactly_one_valid_final_state()
    {
        var data = await SeedAsync("cp04b-concurrent-moves", unitsA: 2);
        using var host = CreateWriteHost();
        using var clientA = CreateHttpsClient(host);
        using var clientB = CreateHttpsClient(host);
        var first = await CreateAssignmentAsync(clientA, data.Property.Id, data.UnitsA[0].Id, data.RoomsA[0].Id);
        var second = await CreateAssignmentAsync(clientA, data.Property.Id, data.UnitsA[1].Id, data.RoomsA[1].Id);

        // Both Units are sold RoomTypeA, so the shared destination is also
        // RoomTypeA — this test is about physical-room contention, not
        // cross-RoomType authorization (that is acceptance items 2/3 above).
        var targetRoom = data.RoomsA[2].Id;
        using var moveFirst = CreateJsonPost(
            MoveUrl(data.Property.Id, first.Id),
            MoveBody(first.Version, targetRoom, CheckIn, CheckOut));
        using var moveSecond = CreateJsonPost(
            MoveUrl(data.Property.Id, second.Id),
            MoveBody(second.Version, targetRoom, CheckIn, CheckOut));

        var responses = await Task.WhenAll(clientA.SendAsync(moveFirst), clientB.SendAsync(moveSecond));

        var succeeded = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        var conflicted = responses.Count(r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(1, succeeded);
        Assert.Equal(1, conflicted);

        await using var verify = factory.CreateDbContext();
        var effectiveInTargetRoom = await verify.RoomOccupancySegments
            .Where(s => s.PropertyId == data.Property.Id && s.PhysicalRoomId == targetRoom && s.Status == RoomOccupancySegmentStatus.Effective)
            .ToListAsync();
        Assert.Single(effectiveInTargetRoom);

        var overlappingPairs = await verify.RoomOccupancySegments
            .Where(a => a.PropertyId == data.Property.Id && a.Status == RoomOccupancySegmentStatus.Effective)
            .Join(
                verify.RoomOccupancySegments.Where(b => b.PropertyId == data.Property.Id && b.Status == RoomOccupancySegmentStatus.Effective),
                a => 1, b => 1, (a, b) => new { a, b })
            .Where(pair => pair.a.Id != pair.b.Id && pair.a.PhysicalRoomId == pair.b.PhysicalRoomId &&
                           pair.a.StartDate < pair.b.EndDate && pair.b.StartDate < pair.a.EndDate)
            .CountAsync();
        Assert.Equal(0, overlappingPairs);
    }

    // ---------------------------------------------------------------
    // Seeding
    // ---------------------------------------------------------------

    private async Task<Fixture> SeedAsync(string slug, int roomsAPerType = 3, int unitsA = 1)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();

        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomTypeA = new RoomType(Guid.NewGuid(), property.Id, "CP04BA", slug, $"{slug}-a", null, 2, 4, true, Now);
        var roomTypeB = new RoomType(Guid.NewGuid(), property.Id, "CP04BB", slug, $"{slug}-b", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "CP04B", slug, null, "VND", true, Now);
        context.AddRange(property, roomTypeA, roomTypeB, ratePlan);

        var roomsA = Enumerable.Range(0, roomsAPerType)
            .Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeA, $"A{i}", 1, OperationalStatus.Active, Now))
            .ToList();
        var roomsB = Enumerable.Range(0, 2)
            .Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeB, $"B{i}", 1, OperationalStatus.Active, Now))
            .ToList();
        // OperationalStatus has no public mutator (set once, at construction), so
        // an inactive-destination scenario needs a room built inactive from the
        // start rather than one deactivated after the fact.
        var inactiveRoomA = new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeA, "A-inactive", 1, OperationalStatus.OutOfService, Now);
        context.AddRange(roomsA.Concat(roomsB).Append(inactiveRoomA));

        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new NightlyCommitmentSnapshot(CheckIn.AddDays(o), ratePlan.Id, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomTypeA.Id, unitsA, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash($"{slug}:idempotency"), HexHash($"{slug}:fingerprint"), HexHash($"{slug}:guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash(slug)[..8].ToUpperInvariant()}", Now);
        context.Add(reservation);

        await context.SaveChangesAsync();
        return new Fixture(property, roomTypeA, roomTypeB, ratePlan, roomsA, roomsB, inactiveRoomA, reservation.Units.ToList());
    }

    private async Task<Property> SeedOtherPropertyAsync()
    {
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Hotel cp04b-other", "cp04b-other", null, "2 Hotel Street", "Hue", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        context.Add(property);
        await context.SaveChangesAsync();
        return property;
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        RoomType RoomTypeA,
        RoomType RoomTypeB,
        RatePlan RatePlan,
        List<PhysicalRoom> RoomsA,
        List<PhysicalRoom> RoomsB,
        PhysicalRoom InactiveRoomA,
        List<ReservationUnit> UnitsA);
}
