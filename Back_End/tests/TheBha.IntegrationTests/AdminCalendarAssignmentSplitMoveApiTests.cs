using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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
/// PMS-CAL-002-CP02 acceptance: the Admin split-move endpoint, proven through a real host against
/// real PostgreSQL in <c>LocalGate</c> mode (the Staff-mode authorization and audit actor are in
/// <see cref="StaffCalendarWriteAuthorizationTests"/>).
///
/// <para>
/// This suite proves only what is new: the thin HTTP adapter over
/// <see cref="IAssignmentMutationStore.SplitMoveAsync"/> (CP01) — request binding, the status
/// mapping, the server-owned actor/evidence, the success body and the published contract. The
/// partition, capacity and audit-row invariants themselves are the store's, proven by
/// <see cref="AssignmentMutationStoreTests"/>; here they are only observed through HTTP. Every
/// business refusal is checked against the whole prior schedule/audit/commercial state read through
/// a new DbContext, because for split-move there is always a source segment on the row: "nothing
/// written" means "all of it exactly as it was".
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminCalendarAssignmentSplitMoveApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6); // 5 nights: 9/1-9/5
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private const string AllowedAdminOrigin = "https://localhost:3001";
    private const string ServerOwnedActor = "admin-calendar-local-development";
    private const string ServerOwnedEvidence = "local-development-write-gate:cross-room-type-confirmed";
    private const string CrossRefusal = "Cross-RoomType confirmation required";
    private const string InvalidRefusal = "Invalid assignment request";

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

    private static string AssignmentsUrl(Guid propertyId) => $"/api/admin/v1/properties/{propertyId}/reservation-assignments";
    private static string SplitMoveUrl(Guid propertyId, Guid segmentId) => $"{AssignmentsUrl(propertyId)}/{segmentId}/split-move";
    private static string BoardUrl(Guid propertyId, DateOnly from, DateOnly to) =>
        $"/api/admin/v1/properties/{propertyId}/reservation-board?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}";

    private static HttpRequestMessage CreateJsonPost(string url, string body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)) };
        request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");
        request.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        return request;
    }

    /// <summary>The valid body; <paramref name="confirm"/> and <paramref name="reason"/> are omitted when null, as an absent field is meaningful.</summary>
    private static JsonObject SplitJson(uint version, DateOnly splitDate, Guid destination, bool? confirm = null, string? reason = null)
    {
        var body = new JsonObject
        {
            ["expectedVersion"] = (long)version,
            ["splitDate"] = splitDate.ToString("yyyy-MM-dd"),
            ["destinationPhysicalRoomId"] = destination.ToString(),
        };
        if (confirm is { } value)
        {
            body["confirmCrossRoomType"] = value;
        }

        if (reason is not null)
        {
            body["reason"] = reason;
        }

        return body;
    }

    private static string SplitBody(uint version, DateOnly splitDate, Guid destination, bool? confirm = null, string? reason = null) =>
        SplitJson(version, splitDate, destination, confirm, reason).ToJsonString();

    private async Task<RoomOccupancySegmentDto> CreateAssignmentAsync(
        HttpClient client, Guid propertyId, Guid unitId, Guid roomId,
        DateOnly? start = null, DateOnly? end = null, bool confirm = false, string? reason = null)
    {
        var body = new JsonObject
        {
            ["reservationUnitId"] = unitId.ToString(),
            ["physicalRoomId"] = roomId.ToString(),
            ["startDate"] = (start ?? CheckIn).ToString("yyyy-MM-dd"),
            ["endDate"] = (end ?? CheckOut).ToString("yyyy-MM-dd"),
            ["confirmCrossRoomType"] = confirm,
            ["reason"] = reason,
        };
        using var request = CreateJsonPost(AssignmentsUrl(propertyId), body.ToJsonString());
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>())!;
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
    /// Every segment of the Property (identity, type, status, room, nights, xmin), every audit row
    /// (group, event, actor, evidence, reason) and the commercial snapshot of every Unit. xmin is a
    /// shadow property, readable only from a tracked entry in the context that materialized it.
    /// </summary>
    private async Task<string> StateAsync(Guid propertyId)
    {
        await using var context = factory.CreateDbContext();
        var segments = (await context.RoomOccupancySegments.Where(s => s.PropertyId == propertyId).ToListAsync())
            .OrderBy(s => s.Id)
            .Select(s => $"{s.Id}|{s.Type}|{s.Status}|{s.PhysicalRoomId}|{s.StartDate:yyyy-MM-dd}|{s.EndDate:yyyy-MM-dd}|{context.Entry(s).Property<uint>("xmin").CurrentValue}");
        var audits = (await context.RoomOccupancySegmentAudits.Where(a => a.PropertyId == propertyId).ToListAsync())
            .OrderBy(a => a.Id)
            .Select(a => $"{a.Id}|{a.SegmentId}|{a.MutationGroupId}|{a.EventType}|{a.ActorReference}|{a.AuthorizationEvidence}|{a.Reason}");
        var units = await context.ReservationUnits.AsNoTracking().Include(u => u.Nights)
            .Where(u => u.PropertyId == propertyId).OrderBy(u => u.Id).ToListAsync();
        var commercial = units.Select(u =>
            $"{u.Id}|{u.RoomTypeId}|{u.CommitmentStatus}|{string.Join(",", u.Nights.OrderBy(n => n.StayDate).Select(n => $"{n.StayDate:yyyy-MM-dd}/{n.RatePlanId}/{n.UnitAmount:0.00}"))}");
        return string.Join("\n", segments) + "\n--\n" + string.Join("\n", audits) + "\n--\n" + string.Join("\n", commercial);
    }

    private async Task<List<RoomOccupancySegmentAudit>> AuditsOfAsync(params Guid[] segmentIds)
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegmentAudits.AsNoTracking().Where(a => segmentIds.Contains(a.SegmentId)).ToListAsync();
    }

    /// <summary>
    /// Asserts <c>[source Cancelled, prefix, suffix]</c> over the source's own nights, every version
    /// against the committed xmin, and no row beyond the source and the two successors.
    /// </summary>
    private async Task<(RoomOccupancySegmentDto Prefix, RoomOccupancySegmentDto Suffix)> AssertPartitionAsync(
        RoomOccupancySegmentDto[] segments, RoomOccupancySegmentDto original, Guid prefixRoom, Guid suffixRoom, DateOnly splitDate)
    {
        Assert.Equal(3, segments.Length);
        var (source, prefix, suffix) = (segments[0], segments[1], segments[2]);
        Assert.Equal((original.Id, original.PhysicalRoomId, original.StartDate, original.EndDate), (source.Id, source.PhysicalRoomId, source.StartDate, source.EndDate));
        Assert.Equal("Cancelled", source.Status);
        Assert.NotEqual(original.Version, source.Version);
        Assert.Equal((prefixRoom, original.StartDate, splitDate), (prefix.PhysicalRoomId, prefix.StartDate, prefix.EndDate));
        Assert.Equal((suffixRoom, splitDate, original.EndDate), (suffix.PhysicalRoomId, suffix.StartDate, suffix.EndDate));
        Assert.All(new[] { prefix, suffix }, s =>
        {
            Assert.Equal("Effective", s.Status);
            Assert.Equal("ReservationAssignment", s.Type);
            Assert.Equal(original.ReservationUnitId, s.ReservationUnitId);
        });

        await using var verify = factory.CreateDbContext();
        var rows = await verify.RoomOccupancySegments.Where(s => s.ReservationUnitId == original.ReservationUnitId).ToListAsync();
        Assert.Equal(3, rows.Count);
        foreach (var dto in segments)
        {
            Assert.Equal(dto.Version, verify.Entry(rows.Single(r => r.Id == dto.Id)).Property<uint>("xmin").CurrentValue);
        }

        return (prefix, suffix);
    }

    /// <summary>
    /// The three audit rows of one split-move share a group that the source's own Created row does
    /// not: a Cancelled source without evidence and two Created successors, each carrying evidence
    /// only when it was meant to, all with the same actor and reason.
    /// </summary>
    private async Task AssertAuditGroupAsync(
        RoomOccupancySegmentDto original, RoomOccupancySegmentDto prefix, RoomOccupancySegmentDto suffix,
        string actor, string? prefixEvidence, string? suffixEvidence, string? reason)
    {
        var rows = await AuditsOfAsync(original.Id, prefix.Id, suffix.Id);
        var cancelled = Assert.Single(rows, a => a.SegmentId == original.Id && a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        var group = rows.Where(a => a.MutationGroupId == cancelled.MutationGroupId).ToList();
        Assert.Equal(3, group.Count);
        Assert.All(group, a => Assert.Equal((actor, reason), (a.ActorReference, a.Reason)));
        Assert.Null(cancelled.AuthorizationEvidence);
        Assert.Equal(prefixEvidence, Assert.Single(group, a => a.SegmentId == prefix.Id && a.EventType == RoomOccupancySegmentAuditEventType.Created).AuthorizationEvidence);
        Assert.Equal(suffixEvidence, Assert.Single(group, a => a.SegmentId == suffix.Id && a.EventType == RoomOccupancySegmentAuditEventType.Created).AuthorizationEvidence);

        // The source keeps its own Created row, in an earlier group.
        var created = Assert.Single(rows, a => a.SegmentId == original.Id && a.EventType == RoomOccupancySegmentAuditEventType.Created);
        Assert.NotEqual(cancelled.MutationGroupId, created.MutationGroupId);
    }

    // ---------------------------------------------------------------
    // Success
    // ---------------------------------------------------------------

    [Fact]
    public async Task Same_type_split_move_returns_source_prefix_and_suffix_with_local_constants_and_unchanged_commercial_state()
    {
        var data = await SeedAsync("cp02-same-type");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id);
        var commercialBefore = (await StateAsync(data.Property.Id)).Split("\n--\n")[2];
        var splitDate = CheckIn.AddDays(2);

        // confirmCrossRoomType is absent on purpose (absent means false); the reason is trimmed.
        using var request = CreateJsonPost(SplitMoveUrl(data.Property.Id, original.Id), SplitBody(original.Version, splitDate, data.RoomsA[1].Id, reason: "  AC failure  "));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Location"));
        var segments = (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;
        var (prefix, suffix) = await AssertPartitionAsync(segments, original, data.RoomsA[0].Id, data.RoomsA[1].Id, splitDate);
        await AssertAuditGroupAsync(original, prefix, suffix, ServerOwnedActor, null, null, "AC failure");
        Assert.Equal(commercialBefore, (await StateAsync(data.Property.Id)).Split("\n--\n")[2]);

        // The board is the authoritative read: it shows exactly the two successors, un-clipped.
        using var board = await ReadBoardAsync(client, data.Property.Id, CheckIn, CheckOut);
        var stay = board.RootElement.GetProperty("stays").EnumerateArray().Single(s => s.GetProperty("reservationUnitId").GetGuid() == data.Units[0].Id);
        Assert.Equal("FullyAssigned", stay.GetProperty("coverageStatus").GetString());
        Assert.Equal(
            [(prefix.Id, prefix.Version, data.RoomsA[0].Id, CheckIn, splitDate), (suffix.Id, suffix.Version, data.RoomsA[1].Id, splitDate, CheckOut)],
            BoardAssignments(stay));
    }

    [Fact]
    public async Task A_partial_stay_source_is_split_over_its_own_range_not_the_visible_window()
    {
        var data = await SeedAsync("cp02-partial");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var (start, end, splitDate) = (CheckIn.AddDays(1), CheckOut.AddDays(-1), CheckIn.AddDays(2)); // [9/2, 9/5) split at 9/3
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id, start, end);

        using var request = CreateJsonPost(SplitMoveUrl(data.Property.Id, original.Id), SplitBody(original.Version, splitDate, data.RoomsA[1].Id));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var (prefix, suffix) = await AssertPartitionAsync(
            (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!, original, data.RoomsA[0].Id, data.RoomsA[1].Id, splitDate);

        // The whole stay window: both successors, the nights outside the source still unassigned.
        using (var wide = await ReadBoardAsync(client, data.Property.Id, CheckIn, CheckOut))
        {
            var stay = wide.RootElement.GetProperty("stays").EnumerateArray().Single();
            Assert.Equal(
                [(prefix.Id, prefix.Version, data.RoomsA[0].Id, start, splitDate), (suffix.Id, suffix.Version, data.RoomsA[1].Id, splitDate, end)],
                BoardAssignments(stay));
            Assert.Equal(
                [(CheckIn, start), (end, CheckOut)],
                stay.GetProperty("unassignedRanges").EnumerateArray().Select(r => (Date(r, "startDate"), Date(r, "endDate"))).ToArray());
        }

        // A window touching only the suffix still gets it un-clipped, and never the prefix.
        using var narrow = await ReadBoardAsync(client, data.Property.Id, splitDate, splitDate.AddDays(1));
        Assert.Equal(
            [(suffix.Id, suffix.Version, data.RoomsA[1].Id, splitDate, end)],
            BoardAssignments(narrow.RootElement.GetProperty("stays").EnumerateArray().Single()));
    }

    [Fact]
    public async Task A_cross_type_source_kept_on_the_prefix_needs_fresh_evidence_even_when_the_destination_is_the_sold_type()
    {
        var data = await SeedAsync("cp02-prefix-cross");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsB[0].Id, confirm: true, reason: "Upgrade");
        var originalCreated = Assert.Single(await AuditsOfAsync(original.Id));
        Assert.Equal(ServerOwnedEvidence, originalCreated.AuthorizationEvidence);
        var splitDate = CheckIn.AddDays(2);

        using var request = CreateJsonPost(SplitMoveUrl(data.Property.Id, original.Id), SplitBody(original.Version, splitDate, data.RoomsA[1].Id, confirm: true, reason: "Back to the sold type"));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var (prefix, suffix) = await AssertPartitionAsync(
            (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!, original, data.RoomsB[0].Id, data.RoomsA[1].Id, splitDate);
        await AssertAuditGroupAsync(original, prefix, suffix, ServerOwnedActor, ServerOwnedEvidence, null, "Back to the sold type");

        // The old row's evidence is neither copied nor rewritten.
        var kept = Assert.Single(await AuditsOfAsync(original.Id), a => a.EventType == RoomOccupancySegmentAuditEventType.Created);
        Assert.Equal((originalCreated.Id, originalCreated.MutationGroupId, originalCreated.Reason), (kept.Id, kept.MutationGroupId, kept.Reason));
    }

    [Fact]
    public async Task A_body_that_forges_the_actor_evidence_ranges_unit_or_replacements_changes_nothing_the_server_decides()
    {
        var data = await SeedAsync("cp02-spoof", units: 2);
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id);
        var splitDate = CheckIn.AddDays(2);
        var body = SplitJson(original.Version, splitDate, data.RoomsA[1].Id, reason: "Honest reason");
        body["actorReference"] = "forged-actor";
        body["authorizationEvidence"] = "forged-evidence";
        body["role"] = "Manager";
        body["startDate"] = CheckIn.AddDays(1).ToString("yyyy-MM-dd");
        body["endDate"] = CheckIn.AddDays(3).ToString("yyyy-MM-dd");
        body["physicalRoomId"] = data.RoomsA[2].Id.ToString();
        body["reservationUnitId"] = data.Units[1].Id.ToString();
        body["replacements"] = new JsonArray(new JsonObject { ["physicalRoomId"] = data.RoomsB[0].Id.ToString(), ["startDate"] = "2026-09-01", ["endDate"] = "2026-09-06" });
        body["unitAmount"] = 1;

        using var request = CreateJsonPost($"{SplitMoveUrl(data.Property.Id, original.Id)}?actorReference=forged&physicalRoomId={data.RoomsA[2].Id}", body.ToJsonString());
        request.Headers.TryAddWithoutValidation("X-Actor-Reference", "forged");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var (prefix, suffix) = await AssertPartitionAsync(
            (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!, original, data.RoomsA[0].Id, data.RoomsA[1].Id, splitDate);
        await AssertAuditGroupAsync(original, prefix, suffix, ServerOwnedActor, null, null, "Honest reason");
        await using var verify = factory.CreateDbContext();
        Assert.Empty(await verify.RoomOccupancySegments.Where(s => s.ReservationUnitId == data.Units[1].Id || s.PhysicalRoomId == data.RoomsA[2].Id || s.PhysicalRoomId == data.RoomsB[0].Id).ToListAsync());
        Assert.DoesNotContain(await verify.RoomOccupancySegmentAudits.ToListAsync(), a => a.ActorReference.Contains("forged", StringComparison.Ordinal) || a.AuthorizationEvidence == "forged-evidence");
    }

    // ---------------------------------------------------------------
    // Refusals: every one leaves the whole state exactly as it was
    // ---------------------------------------------------------------

    private async Task AssertRefusedAsync(
        HttpClient client, Guid propertyId, string url, string body, HttpStatusCode status, string? title)
    {
        var before = await StateAsync(propertyId);
        using var request = CreateJsonPost(url, body);
        var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(status == response.StatusCode, $"expected {(int)status} {title}, got {(int)response.StatusCode}: {text}");
        Assert.Equal(title, JsonDocument.Parse(text).RootElement.GetProperty("title").GetString());
        Assert.False(response.Headers.Contains("Location"));
        Assert.Equal(before, await StateAsync(propertyId));
    }

    [Fact]
    public async Task Either_successor_crossing_the_sold_type_without_confirmation_and_reason_is_a_store_403_and_the_server_never_confirms_for_the_caller()
    {
        var data = await SeedAsync("cp02-cross-refusal", units: 2);
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var sameType = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id);
        var crossType = await CreateAssignmentAsync(client, data.Property.Id, data.Units[1].Id, data.RoomsB[0].Id, confirm: true, reason: "Upgrade");
        var splitDate = CheckIn.AddDays(2);
        var propertyId = data.Property.Id;

        // Sold-type source, cross-type suffix: unconfirmed, confirmed without a reason, blank reason.
        var toB = SplitMoveUrl(propertyId, sameType.Id);
        await AssertRefusedAsync(client, propertyId, toB, SplitBody(sameType.Version, splitDate, data.RoomsB[1].Id, reason: "Upgrade"), HttpStatusCode.Forbidden, CrossRefusal);
        await AssertRefusedAsync(client, propertyId, toB, SplitBody(sameType.Version, splitDate, data.RoomsB[1].Id, confirm: true), HttpStatusCode.Forbidden, CrossRefusal);
        await AssertRefusedAsync(client, propertyId, toB, SplitBody(sameType.Version, splitDate, data.RoomsB[1].Id, confirm: true, reason: "   "), HttpStatusCode.Forbidden, CrossRefusal);

        // Cross-type source, sold-type suffix: the prefix is still a new cross-type placement.
        var fromB = SplitMoveUrl(propertyId, crossType.Id);
        await AssertRefusedAsync(client, propertyId, fromB, SplitBody(crossType.Version, splitDate, data.RoomsA[1].Id, reason: "Back"), HttpStatusCode.Forbidden, CrossRefusal);
        await AssertRefusedAsync(client, propertyId, fromB, SplitBody(crossType.Version, splitDate, data.RoomsA[1].Id, confirm: true), HttpStatusCode.Forbidden, CrossRefusal);
        await AssertRefusedAsync(client, propertyId, fromB, SplitBody(crossType.Version, splitDate, data.RoomsA[1].Id, confirm: true, reason: " "), HttpStatusCode.Forbidden, CrossRefusal);
    }

    [Fact]
    public async Task Invalid_dates_the_same_room_and_an_overlong_reason_are_400_and_a_500_character_reason_is_accepted()
    {
        var data = await SeedAsync("cp02-invalid");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id);
        var url = SplitMoveUrl(data.Property.Id, original.Id);
        var propertyId = data.Property.Id;

        foreach (var splitDate in new[] { CheckIn, CheckOut, CheckIn.AddDays(-1), CheckOut.AddDays(1), DateOnly.MinValue, DateOnly.MaxValue })
        {
            await AssertRefusedAsync(client, propertyId, url, SplitBody(original.Version, splitDate, data.RoomsA[1].Id), HttpStatusCode.BadRequest, InvalidRefusal);
        }

        await AssertRefusedAsync(client, propertyId, url, SplitBody(original.Version, CheckIn.AddDays(2), data.RoomsA[0].Id), HttpStatusCode.BadRequest, InvalidRefusal);
        await AssertRefusedAsync(client, propertyId, url, SplitBody(original.Version, CheckIn.AddDays(2), data.RoomsA[1].Id, reason: new string('r', 501)), HttpStatusCode.BadRequest, InvalidRefusal);

        using var request = CreateJsonPost(url, SplitBody(original.Version, CheckIn.AddDays(2), data.RoomsA[1].Id, reason: new string('r', 500)));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Unknown_foreign_and_non_assignment_sources_and_a_foreign_destination_are_404()
    {
        var data = await SeedAsync("cp02-not-found");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id);
        var (otherProperty, foreignRoom) = await SeedForeignRoomAsync();
        var blockSegmentId = Guid.NewGuid();
        await using (var context = factory.CreateDbContext())
        {
            var blockId = Guid.NewGuid();
            context.Add(new RoomBlock(blockId, data.Property.Id, "Maintenance", ServerOwnedActor, Now));
            context.Add(new RoomOccupancySegment(blockSegmentId, data.Property.Id, data.RoomsA[2].Id, RoomOccupancySegmentType.OperationalBlock, CheckIn, CheckOut, null, blockId, Now));
            await context.SaveChangesAsync();
        }

        var propertyId = data.Property.Id;
        var valid = SplitBody(original.Version, CheckIn.AddDays(2), data.RoomsA[1].Id);
        const string NotFound = "Assignment target not found";
        await AssertRefusedAsync(client, propertyId, SplitMoveUrl(propertyId, Guid.NewGuid()), valid, HttpStatusCode.NotFound, NotFound);
        await AssertRefusedAsync(client, propertyId, SplitMoveUrl(otherProperty, original.Id), valid, HttpStatusCode.NotFound, NotFound);
        await AssertRefusedAsync(client, propertyId, SplitMoveUrl(propertyId, blockSegmentId), valid, HttpStatusCode.NotFound, NotFound);
        await AssertRefusedAsync(client, propertyId, SplitMoveUrl(propertyId, original.Id), SplitBody(original.Version, CheckIn.AddDays(2), foreignRoom, confirm: true, reason: "Foreign"), HttpStatusCode.NotFound, NotFound);
    }

    [Fact]
    public async Task Stale_or_cancelled_sources_inactive_or_occupied_destinations_are_409()
    {
        var data = await SeedAsync("cp02-conflict", units: 2);
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id);
        await CreateAssignmentAsync(client, data.Property.Id, data.Units[1].Id, data.RoomsA[1].Id); // RoomsA[1] taken for the whole stay
        var (propertyId, url, splitDate) = (data.Property.Id, SplitMoveUrl(data.Property.Id, original.Id), CheckIn.AddDays(2));
        const string Conflict = "Assignment conflict";

        await AssertRefusedAsync(client, propertyId, url, SplitBody(original.Version + 1000, splitDate, data.RoomsA[2].Id), HttpStatusCode.Conflict, Conflict);
        await AssertRefusedAsync(client, propertyId, url, SplitBody(original.Version, splitDate, data.RoomsA[1].Id), HttpStatusCode.Conflict, Conflict);
        await AssertRefusedAsync(client, propertyId, url, SplitBody(original.Version, splitDate, data.InactiveRoomA.Id), HttpStatusCode.Conflict, Conflict);

        // A cancelled source: unassign it through the real route, then split with its new version.
        using var unassign = CreateJsonPost($"{AssignmentsUrl(propertyId)}/{original.Id}/unassign", $$"""{"expectedVersion": {{original.Version}}}""");
        var cancelled = (await (await client.SendAsync(unassign)).Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!.Single();
        await AssertRefusedAsync(client, propertyId, url, SplitBody(cancelled.Version, splitDate, data.RoomsA[2].Id), HttpStatusCode.Conflict, Conflict);
    }

    [Fact]
    public async Task A_cross_type_suffix_without_capacity_is_409_and_the_source_stays_effective()
    {
        // The only RoomTypeB room is free, but an Active, unexpired hold consumes its capacity.
        var data = await SeedAsync("cp02-capacity", roomsB: 1);
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var original = await CreateAssignmentAsync(client, data.Property.Id, data.Units[0].Id, data.RoomsA[0].Id);
        var fixedNow = Now.AddDays(60);
        await PlaceActiveHoldAsync(data, fixedNow.AddMinutes(-1));
        factory.Clock.UtcNow = fixedNow;

        await AssertRefusedAsync(
            client, data.Property.Id, SplitMoveUrl(data.Property.Id, original.Id),
            SplitBody(original.Version, CheckIn.AddDays(2), data.RoomsB[0].Id, confirm: true, reason: "Upgrade"), HttpStatusCode.Conflict, "Assignment conflict");
    }

    // ---------------------------------------------------------------
    // Boundary: refusals before the store, on a spy that counts calls
    // ---------------------------------------------------------------

    [Fact]
    public async Task Each_required_field_and_every_typed_field_is_enforced_before_the_store_and_the_command_is_composed_from_the_route_and_body()
    {
        var spy = new CountingStore();
        using var host = CreateWriteHost(builder => builder.ConfigureTestServices(services => services.AddScoped<IAssignmentMutationStore>(_ => spy)));
        using var client = CreateHttpsClient(host);
        var (propertyId, segmentId, destination, splitDate) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 9, 3));
        var url = SplitMoveUrl(propertyId, segmentId);

        var bad = new List<(string Case, string Body)>();
        foreach (var field in new[] { "expectedVersion", "splitDate", "destinationPhysicalRoomId" })
        {
            var variants = new Dictionary<string, JsonNode?>
            {
                ["null"] = null,
                ["bool"] = true,
                ["object"] = new JsonObject(),
                ["text"] = "not-a-value",
            };
            if (field == "expectedVersion")
            {
                variants["negative"] = -1;
                variants["fraction"] = 1.5;
                variants["overflow"] = 4294967296L;
            }
            else if (field == "splitDate")
            {
                variants["impossible date"] = "2026-02-30";
                variants["number"] = 20260903;
            }

            var missing = SplitJson(1, splitDate, destination);
            missing.Remove(field);
            bad.Add(($"{field} missing", missing.ToJsonString()));
            foreach (var (name, value) in variants)
            {
                var body = SplitJson(1, splitDate, destination);
                body[field] = value;
                bad.Add(($"{field} {name}", body.ToJsonString()));
            }
        }

        foreach (var (name, value) in new (string, JsonNode?)[] { ("confirmCrossRoomType", "yes"), ("confirmCrossRoomType", 5), ("reason", 5), ("reason", true) })
        {
            var body = SplitJson(1, splitDate, destination);
            body[name] = value;
            bad.Add(($"{name} {value}", body.ToJsonString()));
        }

        bad.AddRange([("malformed", "{not json"), ("empty", ""), ("array", "[]"), ("null literal", "null")]);
        foreach (var (name, body) in bad)
        {
            using var request = CreateJsonPost(url, body);
            var response = await client.SendAsync(request);
            Assert.True(HttpStatusCode.BadRequest == response.StatusCode, $"{name}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
            Assert.True(response.Headers.CacheControl?.NoStore, name);
            Assert.False(response.Headers.Contains("Location"), name);
        }

        Assert.Equal(0, spy.Calls);

        // The same route with valid bodies: one store call each, built from route and body only.
        using (var trimmed = CreateJsonPost(url, SplitBody(7, splitDate, destination, reason: "  x  ")))
        {
            Assert.Equal(HttpStatusCode.Conflict, (await client.SendAsync(trimmed)).StatusCode);
        }

        using (var blank = CreateJsonPost(url, SplitBody(8, splitDate, destination, confirm: true, reason: "   ")))
        {
            Assert.Equal(HttpStatusCode.Conflict, (await client.SendAsync(blank)).StatusCode);
        }

        Assert.Equal(
            [
                new SplitMoveAssignmentCommand(propertyId, segmentId, 7, splitDate, destination, ServerOwnedActor, null, "x"),
                new SplitMoveAssignmentCommand(propertyId, segmentId, 8, splitDate, destination, ServerOwnedActor, ServerOwnedEvidence, null),
            ],
            spy.Commands);
    }

    [Fact]
    public async Task A_closed_gate_origin_and_media_type_answer_before_binding_and_the_store()
    {
        var spy = new CountingStore();
        void UseSpy(IWebHostBuilder builder) => builder.ConfigureTestServices(services => services.AddScoped<IAssignmentMutationStore>(_ => spy));
        var url = SplitMoveUrl(Guid.NewGuid(), Guid.NewGuid());
        var valid = SplitBody(1, CheckIn.AddDays(2), Guid.NewGuid());

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
                // The generic, detail-free 404 the closed gate shares with every Admin write.
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
            Assert.True(plainResponse.Headers.CacheControl?.NoStore);

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

    // ---------------------------------------------------------------
    // The published contract
    // ---------------------------------------------------------------

    [Fact]
    public async Task OpenApi_publishes_exactly_one_split_move_operation_with_the_five_field_body()
    {
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        const string Path = "/api/admin/v1/properties/{propertyId}/reservation-assignments/{segmentId}/split-move";

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
        Assert.Equal(
            ["confirmCrossRoomType", "destinationPhysicalRoomId", "expectedVersion", "reason", "splitDate"],
            schema.GetProperty("properties").EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(
            ["destinationPhysicalRoomId", "expectedVersion", "splitDate"],
            schema.GetProperty("required").EnumerateArray().Select(e => e.GetString()!).Order(StringComparer.Ordinal).ToArray());
    }

    // ---------------------------------------------------------------
    // Board reads
    // ---------------------------------------------------------------

    private static async Task<JsonDocument> ReadBoardAsync(HttpClient client, Guid propertyId, DateOnly from, DateOnly to)
    {
        var response = await client.GetAsync(BoardUrl(propertyId, from, to));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }

    private static DateOnly Date(JsonElement element, string name) => DateOnly.Parse(element.GetProperty(name).GetString()!);

    private static (Guid Id, uint Version, Guid Room, DateOnly Start, DateOnly End)[] BoardAssignments(JsonElement stay) =>
        stay.GetProperty("assignments").EnumerateArray()
            .Select(a => (a.GetProperty("segmentId").GetGuid(), a.GetProperty("segmentVersion").GetUInt32(), a.GetProperty("physicalRoomId").GetGuid(),
                Date(a, "startDate"), Date(a, "endDate")))
            .OrderBy(a => a.Item4)
            .ToArray();

    // ---------------------------------------------------------------
    // Spy and seeding
    // ---------------------------------------------------------------

    /// <summary>Counts calls, remembers each split-move command and answers a conflict, so nothing is written.</summary>
    private sealed class CountingStore : IAssignmentMutationStore
    {
        public int Calls;
        public List<SplitMoveAssignmentCommand> Commands { get; } = [];

        public Task<SegmentMutationResult> CreateAsync(CreateAssignmentCommand command, CancellationToken cancellationToken) => Count();

        public Task<SegmentMutationResult> SupersedeAsync(SupersedeAssignmentsCommand command, CancellationToken cancellationToken) => Count();

        public Task<SegmentMutationResult> SplitMoveAsync(SplitMoveAssignmentCommand command, CancellationToken cancellationToken)
        {
            lock (Commands)
            {
                Commands.Add(command);
            }

            return Count();
        }

        private Task<SegmentMutationResult> Count()
        {
            Interlocked.Increment(ref Calls);
            return Task.FromResult(SegmentMutationResult.Conflict("spy"));
        }
    }

    private async Task<Fixture> SeedAsync(string slug, int roomsB = 2, int units = 1)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();

        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomTypeA = new RoomType(Guid.NewGuid(), property.Id, "CP02SA", slug, $"{slug}-a", null, 2, 4, true, Now);
        var roomTypeB = new RoomType(Guid.NewGuid(), property.Id, "CP02SB", slug, $"{slug}-b", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "CP02S", slug, null, "VND", true, Now);
        context.AddRange(property, roomTypeA, roomTypeB, ratePlan);

        var roomsA = Enumerable.Range(0, 3)
            .Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeA, $"A{i}", 1, OperationalStatus.Active, Now)).ToList();
        var roomsBList = Enumerable.Range(0, roomsB)
            .Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeB, $"B{i}", 1, OperationalStatus.Active, Now)).ToList();
        var inactive = new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeA, "A-inactive", 1, OperationalStatus.OutOfService, Now);
        context.AddRange(roomsA.Concat(roomsBList).Append(inactive));

        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new NightlyCommitmentSnapshot(CheckIn.AddDays(o), ratePlan.Id, 100m)).ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomTypeA.Id, units, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash($"{slug}:idempotency"), HexHash($"{slug}:fingerprint"), HexHash($"{slug}:guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash(slug)[..8].ToUpperInvariant()}", Now);
        context.Add(reservation);

        await context.SaveChangesAsync();
        return new Fixture(property, roomTypeB, ratePlan, roomsA, roomsBList, inactive, reservation.Units.ToList());
    }

    private async Task<(Guid PropertyId, Guid RoomId)> SeedForeignRoomAsync()
    {
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Hotel cp02-other", "cp02-split-other", null, "2 Hotel Street", "Hue", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(Guid.NewGuid(), property.Id, "CP02SO", "other", "cp02-split-other-a", null, 2, 4, true, Now);
        var room = new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, "F0", 1, OperationalStatus.Active, Now);
        context.AddRange(property, roomType, room);
        await context.SaveChangesAsync();
        return (property.Id, room.Id);
    }

    private async Task PlaceActiveHoldAsync(Fixture data, DateTimeOffset createdAtUtc)
    {
        await using var context = factory.CreateDbContext();
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m)).ToArray();
        context.Add(new InventoryHold(
            Guid.NewGuid(), data.Property.Id, data.RoomTypeB.Id, 1, null, "Hold Guest", "hold@example.com",
            "+84 900 000 555", CheckIn, CheckOut, 1, 0, "VND", createdAtUtc,
            HexHash("hold:idempotency"), HexHash("hold:fingerprint"), HexHash("hold:guest"), nights));
        await context.SaveChangesAsync();
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        RoomType RoomTypeB,
        RatePlan RatePlan,
        List<PhysicalRoom> RoomsA,
        List<PhysicalRoom> RoomsB,
        PhysicalRoom InactiveRoomA,
        List<ReservationUnit> Units);
}
