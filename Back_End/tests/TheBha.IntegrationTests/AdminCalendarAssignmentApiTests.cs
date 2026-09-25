using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TheBha.Api;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.2-CP02 acceptance: the Admin assignment-create endpoint, proven
/// against real PostgreSQL 17 through a real host.
///
/// <para>
/// This suite deliberately proves only what is new — the HTTP adapter: status
/// mapping, the server-owned audit identity, and the CP01 composition applied
/// to a real business route for the first time. The scheduling invariants
/// behind it (booked-night coverage, capacity, concurrency, cross-property
/// isolation, audit append-only-ness) are already proven directly against
/// <see cref="IAssignmentMutationStore"/> by
/// <see cref="AssignmentMutationStoreTests"/>, and the write gate's
/// transport/origin/media-type permutations by
/// <see cref="AdminCalendarWriteGateApiTests"/>; neither matrix is repeated
/// here.
/// </para>
///
/// <para>
/// Every refusal is checked twice: the status the caller sees, and that the
/// database holds no segment and no audit row afterwards. For a write boundary
/// a status code alone would not distinguish "refused" from "mutated, then
/// reported an error".
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminCalendarAssignmentApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6); // 5 nights: 9/1-9/5

    private const string AllowedAdminOrigin = "https://localhost:3001";
    private const string ServerOwnedActor = "admin-calendar-local-development";
    private const string ServerOwnedEvidence = "local-development-write-gate:cross-room-type-confirmed";

    /// <summary>
    /// The host serializes enums as names (<c>Program.cs</c> adds
    /// <see cref="JsonStringEnumConverter"/>), so a client reading the board
    /// projection back must be configured the same way.
    /// </summary>
    private static readonly JsonSerializerOptions BoardJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    // ---------------------------------------------------------------
    // Host and request helpers
    // ---------------------------------------------------------------

    /// <summary>
    /// A host with the local write opt-in on. The shipped Development default
    /// is <c>false</c>, so the ordinary <paramref name="factory"/> host is
    /// already the closed-gate case and needs no override.
    /// </summary>
    private WebApplicationFactory<Program> CreateWriteHost() =>
        factory.WithWebHostBuilder(builder =>
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true"));

    /// <summary>
    /// The gate refuses cleartext, so an HTTPS base address is what makes a
    /// TestServer request represent a real TLS connection. Redirects are never
    /// followed, so <c>UseHttpsRedirection</c> can never answer for the gate.
    /// </summary>
    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });

    private static string AssignmentsUrl(Guid propertyId) =>
        $"/api/admin/v1/properties/{propertyId}/reservation-assignments";

    /// <summary>
    /// The supported shape of a real Admin client call: HTTPS, loopback, the
    /// configured Admin origin, <c>application/json</c> — and deliberately no
    /// Customer session cookie and no antiforgery token, neither of which this
    /// route uses or accepts.
    /// </summary>
    private static HttpRequestMessage CreatePost(Guid propertyId, string body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, AssignmentsUrl(propertyId))
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)),
        };
        request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");
        request.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        return request;
    }

    private static string RequestBody(
        Guid reservationUnitId,
        Guid physicalRoomId,
        DateOnly startDate,
        DateOnly endDate,
        bool confirmCrossRoomType = false,
        string? reason = null,
        string? extraProperties = null) =>
        $$"""
        {
          "reservationUnitId": "{{reservationUnitId}}",
          "physicalRoomId": "{{physicalRoomId}}",
          "startDate": "{{startDate:yyyy-MM-dd}}",
          "endDate": "{{endDate:yyyy-MM-dd}}",
          "confirmCrossRoomType": {{(confirmCrossRoomType ? "true" : "false")}},
          "reason": {{(reason is null ? "null" : JsonSerializer.Serialize(reason))}}{{extraProperties}}
        }
        """;

    private static async Task<string?> TitleAsync(HttpResponseMessage response)
    {
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        return problem.TryGetProperty("title", out var title) ? title.GetString() : null;
    }

    /// <summary>
    /// The one schema a published response promises. Swashbuckle lists a
    /// response body under several media types; every one of them must name the
    /// same schema, or the response does not have a single contract.
    /// </summary>
    private static string BodySchemaRef(JsonElement response) =>
        response.GetProperty("content").EnumerateObject()
            .Select(media => media.Value.GetProperty("schema").GetProperty("$ref").GetString()!)
            .Distinct(StringComparer.Ordinal)
            .Single();

    private async Task<List<RoomOccupancySegment>> SegmentsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegments.AsNoTracking().ToListAsync();
    }

    private async Task<List<RoomOccupancySegmentAudit>> AuditsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegmentAudits.AsNoTracking().ToListAsync();
    }

    private async Task AssertNothingWrittenAsync(string because)
    {
        Assert.True((await SegmentsAsync()).Count == 0, because);
        Assert.True((await AuditsAsync()).Count == 0, because);
    }

    // ---------------------------------------------------------------
    // Acceptance 1 and 6: the happy path, end to end
    // ---------------------------------------------------------------

    [Fact]
    public async Task Same_room_type_assignment_is_created_audited_and_visible_on_the_board()
    {
        var data = await SeedAsync("cp02-same-type");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(data.Unit.Id, data.RoomsA[0].Id, CheckIn, CheckOut));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        // The CP01 composition, on a real business route: the write policy
        // answers the configured Admin origin exactly, never a wildcard.
        Assert.Equal(
            [AllowedAdminOrigin],
            response.Headers.GetValues("Access-Control-Allow-Origin").ToArray());

        var segment = await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>();
        Assert.NotNull(segment);
        Assert.NotEqual(Guid.Empty, segment!.Id);
        Assert.Equal(data.Property.Id, segment.PropertyId);
        Assert.Equal(data.RoomsA[0].Id, segment.PhysicalRoomId);
        Assert.Equal(data.Unit.Id, segment.ReservationUnitId);
        Assert.Null(segment.RoomBlockId);
        Assert.Equal(RoomOccupancySegmentType.ReservationAssignment.ToString(), segment.Type);
        Assert.Equal(RoomOccupancySegmentStatus.Effective.ToString(), segment.Status);
        Assert.Equal(CheckIn, segment.StartDate);
        Assert.Equal(CheckOut, segment.EndDate);
        Assert.NotEqual(0u, segment.Version);

        var persisted = Assert.Single(await SegmentsAsync());
        Assert.Equal(segment.Id, persisted.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, persisted.Status);

        var audit = Assert.Single(await AuditsAsync());
        Assert.Equal(segment.Id, audit.SegmentId);
        Assert.Equal(RoomOccupancySegmentAuditEventType.Created, audit.EventType);
        Assert.Equal(ServerOwnedActor, audit.ActorReference);
        Assert.Null(audit.AuthorizationEvidence);
        Assert.Null(audit.Reason);

        // The authoritative read agrees with what the create returned.
        var board = await client.GetFromJsonAsync<ReservationBoardDto>(
            $"/api/admin/v1/properties/{data.Property.Id}/reservation-board" +
            $"?from={CheckIn:yyyy-MM-dd}&to={CheckOut:yyyy-MM-dd}",
            BoardJson);
        var stay = Assert.Single(board!.Stays);
        Assert.Equal(StayCoverageStatus.FullyAssigned, stay.CoverageStatus);
        var boardAssignment = Assert.Single(stay.Assignments);
        Assert.Equal(segment.Id, boardAssignment.SegmentId);
        Assert.Equal(segment.Version, boardAssignment.SegmentVersion);
        Assert.Equal(data.RoomsA[0].Id, boardAssignment.PhysicalRoomId);
    }

    // ---------------------------------------------------------------
    // Acceptance 2: the closed gate still owns the real route
    // ---------------------------------------------------------------

    [Fact]
    public async Task Closed_write_gate_refuses_the_real_route_before_the_controller_runs()
    {
        var data = await SeedAsync("cp02-closed-gate");
        // The ordinary host: AdminCalendar:EnableUnauthenticatedWrite is false.
        using var client = CreateHttpsClient(factory);

        using var valid = CreatePost(
            data.Property.Id,
            RequestBody(data.Unit.Id, data.RoomsA[0].Id, CheckIn, CheckOut));
        var validResponse = await client.SendAsync(valid);

        using var malformed = CreatePost(data.Property.Id, "{ this is not json");
        var malformedResponse = await client.SendAsync(malformed);

        // A closed gate answers a valid body and a malformed one identically,
        // which is only possible because it runs before model binding.
        Assert.Equal(HttpStatusCode.NotFound, validResponse.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, malformedResponse.StatusCode);
        Assert.Equal("no-store", validResponse.Headers.CacheControl?.ToString());
        await AssertNothingWrittenAsync("a closed gate must reach neither the controller nor the store");
    }

    // ---------------------------------------------------------------
    // Acceptance 3: cross-RoomType acknowledgement, and who the audit names
    // ---------------------------------------------------------------

    [Fact]
    public async Task Cross_room_type_assignment_needs_acknowledgement_and_records_only_server_owned_audit()
    {
        var data = await SeedAsync("cp02-cross-type");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var unconfirmed = CreatePost(
            data.Property.Id,
            RequestBody(data.Unit.Id, data.RoomsB[0].Id, CheckIn, CheckOut, reason: "Guest requested upgrade"));
        var unconfirmedResponse = await client.SendAsync(unconfirmed);

        Assert.Equal(HttpStatusCode.Forbidden, unconfirmedResponse.StatusCode);
        Assert.Equal("Cross-RoomType confirmation required", await TitleAsync(unconfirmedResponse));
        await AssertNothingWrittenAsync("an unacknowledged cross-RoomType placement must write nothing");

        using var blankReason = CreatePost(
            data.Property.Id,
            RequestBody(
                data.Unit.Id, data.RoomsB[0].Id, CheckIn, CheckOut,
                confirmCrossRoomType: true, reason: "   "));
        var blankReasonResponse = await client.SendAsync(blankReason);

        Assert.Equal(HttpStatusCode.Forbidden, blankReasonResponse.StatusCode);
        await AssertNothingWrittenAsync("a blank reason is no reason at all");

        // Acknowledged, with a reason — and with forged actor/authorization
        // fields in the body, which the server must ignore entirely.
        using var confirmed = CreatePost(
            data.Property.Id,
            RequestBody(
                data.Unit.Id, data.RoomsB[0].Id, CheckIn, CheckOut,
                confirmCrossRoomType: true,
                reason: "  Guest requested upgrade  ",
                extraProperties: """
                ,
                  "actorReference": "staff:general-manager",
                  "authorizationEvidence": "approval:forged-by-the-caller"
                """));
        var confirmedResponse = await client.SendAsync(confirmed);

        Assert.Equal(HttpStatusCode.Created, confirmedResponse.StatusCode);
        var segment = await confirmedResponse.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>();
        Assert.Equal(data.RoomsB[0].Id, segment!.PhysicalRoomId);

        var audit = Assert.Single(await AuditsAsync());
        Assert.Equal(ServerOwnedActor, audit.ActorReference);
        Assert.Equal(ServerOwnedEvidence, audit.AuthorizationEvidence);
        Assert.Equal("Guest requested upgrade", audit.Reason);
    }

    /// <summary>
    /// Correction C6, finding 1: a caller may acknowledge a cross-RoomType
    /// placement and then pick a room of the sold RoomType anyway. Nothing was
    /// crossed, so nothing was authorized, and the append-only audit row must
    /// not say otherwise — an over-confirming caller is not making an error, so
    /// the flag simply goes inert. The evidence a same-type placement records is
    /// identical whether the flag was set, cleared, or never sent.
    /// </summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Same_room_type_assignment_records_no_cross_type_evidence(bool confirmCrossRoomType)
    {
        var data = await SeedAsync("cp02-inert-flag");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(
                data.Unit.Id, data.RoomsA[0].Id, CheckIn, CheckOut,
                confirmCrossRoomType: confirmCrossRoomType,
                reason: "Front-desk preference"));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var audit = Assert.Single(await AuditsAsync());
        Assert.Equal(ServerOwnedActor, audit.ActorReference);
        Assert.Null(audit.AuthorizationEvidence);
        // The reason is untouched: recording why a room was chosen claims
        // nothing about authorization, and stays useful for a same-type move.
        Assert.Equal("Front-desk preference", audit.Reason);
    }

    // ---------------------------------------------------------------
    // Acceptance 4: representative status mapping, without restating the
    // store's own invariant matrix
    // ---------------------------------------------------------------

    [Theory]
    [InlineData("reversed-dates", HttpStatusCode.BadRequest, "Invalid assignment request")]
    [InlineData("unknown-unit", HttpStatusCode.NotFound, "Assignment target not found")]
    [InlineData("other-property", HttpStatusCode.NotFound, "Assignment target not found")]
    [InlineData("outside-booked-nights", HttpStatusCode.Conflict, "Assignment conflict")]
    // Correction C2, finding 2: the widest range DateOnly can express, against a
    // real Unit and a real room. It is refused for the ordinary reason — those
    // nights are not booked — and the store derives its candidate dates from the
    // Unit's five booked nights rather than enumerating the 3.6 million requested.
    [InlineData("extreme-range", HttpStatusCode.Conflict, "Assignment conflict")]
    public async Task Refused_requests_map_to_the_documented_status_and_write_nothing(
        string scenario,
        HttpStatusCode expectedStatus,
        string expectedTitle)
    {
        var data = await SeedAsync("cp02-mapping");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var routePropertyId = data.Property.Id;
        var body = scenario switch
        {
            "reversed-dates" => RequestBody(data.Unit.Id, data.RoomsA[0].Id, CheckOut, CheckIn),
            "unknown-unit" => RequestBody(Guid.NewGuid(), data.RoomsA[0].Id, CheckIn, CheckOut),
            // Property isolation: a real Unit, addressed under a different
            // Property, is not found rather than assigned across the boundary.
            "other-property" => RequestBody(data.Unit.Id, data.RoomsA[0].Id, CheckIn, CheckOut),
            "extreme-range" => RequestBody(
                data.Unit.Id, data.RoomsA[0].Id, DateOnly.MinValue, DateOnly.MaxValue),
            _ => RequestBody(data.Unit.Id, data.RoomsA[0].Id, CheckIn, CheckOut.AddDays(2)),
        };

        if (scenario == "other-property")
        {
            routePropertyId = (await SeedOtherPropertyAsync()).Id;
        }

        using var request = CreatePost(routePropertyId, body);
        var response = await client.SendAsync(request);

        Assert.Equal(expectedStatus, response.StatusCode);
        Assert.Equal(expectedTitle, await TitleAsync(response));
        await AssertNothingWrittenAsync($"'{scenario}' must be refused without writing");
    }

    // ---------------------------------------------------------------
    // Correction C2, finding 1: an omitted required property is a bad
    // request, not a missing Unit
    // ---------------------------------------------------------------

    /// <summary>
    /// All four are value types, so before <c>[JsonRequired]</c> an omitted
    /// property deserialized to its default and reached the store as a
    /// real-looking value — an absent <c>reservationUnitId</c> came back as
    /// <c>404</c>, telling the caller its Unit did not exist rather than that it
    /// forgot a field.
    /// </summary>
    [Theory]
    [InlineData("reservationUnitId")]
    [InlineData("physicalRoomId")]
    [InlineData("startDate")]
    [InlineData("endDate")]
    public async Task An_omitted_required_property_is_refused_before_the_store(string omitted)
    {
        var data = await SeedAsync("cp02-omitted");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var properties = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["reservationUnitId"] = $"\"{data.Unit.Id}\"",
            ["physicalRoomId"] = $"\"{data.RoomsA[0].Id}\"",
            ["startDate"] = $"\"{CheckIn:yyyy-MM-dd}\"",
            ["endDate"] = $"\"{CheckOut:yyyy-MM-dd}\"",
            ["confirmCrossRoomType"] = "false",
            ["reason"] = "null",
        };
        properties.Remove(omitted);
        var body = $"{{{string.Join(",", properties.Select(p => $"\"{p.Key}\":{p.Value}"))}}}";

        using var request = CreatePost(data.Property.Id, body);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNothingWrittenAsync($"'{omitted}' is required, so nothing may reach the store");
    }

    // ---------------------------------------------------------------
    // Acceptance 5: the published contract
    // ---------------------------------------------------------------

    [Fact]
    public async Task OpenApi_publishes_exactly_this_one_admin_write_route_and_no_actor_fields()
    {
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        const string ExpectedPath = "/api/admin/v1/properties/{propertyId}/reservation-assignments";

        JsonElement? assignmentsPath = null;
        foreach (var path in swagger.GetProperty("paths").EnumerateObject())
        {
            if (path.Name == ExpectedPath)
            {
                assignmentsPath = path.Value;
                continue;
            }

            // CP02 adds exactly one Admin mutation route, CP04B adds exactly
            // two more (asserted in full by
            // AdminCalendarAssignmentMoveUnassignApiTests), and
            // PMS-CAL-001.3 adds exactly two operational-block routes, create
            // (CP01) and single-segment cancel (CP02), both asserted in full by
            // AdminOperationalBlockCreateApiTests — every other Admin path must
            // still publish no mutating operation at all. This list is the registry of authorized Admin mutation
            // routes: a new one is added here deliberately, never by weakening
            // the assertion.
            if (path.Name.StartsWith("/api/admin/", StringComparison.Ordinal) &&
                path.Name != $"{ExpectedPath}/{{segmentId}}/move" &&
                path.Name != $"{ExpectedPath}/{{segmentId}}/unassign" &&
                path.Name != "/api/admin/v1/properties/{propertyId}/operational-blocks" &&
                path.Name != "/api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/cancel")
            {
                foreach (var method in new[] { "post", "put", "patch", "delete" })
                {
                    Assert.False(path.Value.TryGetProperty(method, out _), $"{method} {path.Name}");
                }
            }
        }

        Assert.True(assignmentsPath.HasValue, $"{ExpectedPath} must be published");
        var operations = assignmentsPath!.Value.EnumerateObject().Select(o => o.Name).ToArray();
        Assert.Equal(["post"], operations);

        var post = assignmentsPath.Value.GetProperty("post");
        var responses = post.GetProperty("responses");
        Assert.Equal(
            ["201", "400", "403", "404", "409", "415"],
            responses.EnumerateObject().Select(r => r.Name).Order().ToArray());

        // Correction C3, finding 1: what each status actually returns. 415 is
        // the gate's, and is published because a caller can receive it. 404 is
        // published as a status alone: the closed gate answers it with an empty
        // body, so promising a schema for every 404 would be a contract no
        // generated client could rely on.
        Assert.Equal(
            "#/components/schemas/RoomOccupancySegmentDto",
            BodySchemaRef(responses.GetProperty("201")));
        foreach (var status in new[] { "400", "403", "409", "415" })
        {
            Assert.Equal("#/components/schemas/ProblemDetails", BodySchemaRef(responses.GetProperty(status)));
        }

        Assert.False(responses.GetProperty("404").TryGetProperty("content", out _));

        // Correction C4: the gate accepts application/json alone, so that is the
        // only media type the contract may advertise — the formatter's defaults
        // (text/json, application/*+json) would be answered with 415.
        var requestContent = post.GetProperty("requestBody").GetProperty("content");
        Assert.Equal(
            ["application/json"],
            requestContent.EnumerateObject().Select(media => media.Name).ToArray());

        var schemaRef = requestContent
            .GetProperty("application/json").GetProperty("schema")
            .GetProperty("$ref").GetString()!;
        var schema = swagger.GetProperty("components").GetProperty("schemas")
            .GetProperty(schemaRef["#/components/schemas/".Length..]);
        var properties = schema.GetProperty("properties").EnumerateObject()
            .Select(property => property.Name).ToArray();

        Assert.Equal(
            ["confirmCrossRoomType", "endDate", "physicalRoomId", "reason", "reservationUnitId", "startDate"],
            properties.Order(StringComparer.OrdinalIgnoreCase).ToArray());

        // Correction C2, finding 1: the published contract says which four a
        // caller may not leave out, and the other two stay optional.
        var required = schema.GetProperty("required").EnumerateArray()
            .Select(entry => entry.GetString()!).Order(StringComparer.OrdinalIgnoreCase).ToArray();
        Assert.Equal(["endDate", "physicalRoomId", "reservationUnitId", "startDate"], required);
    }

    // ---------------------------------------------------------------
    // Seeding
    // ---------------------------------------------------------------

    private async Task<Fixture> SeedAsync(string slug)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();

        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomTypeA = new RoomType(
            Guid.NewGuid(), property.Id, "CP02A", slug, $"{slug}-a", null, 2, 4, true, Now);
        var roomTypeB = new RoomType(
            Guid.NewGuid(), property.Id, "CP02B", slug, $"{slug}-b", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(
            Guid.NewGuid(), property.Id, "CP02", slug, null, "VND", true, Now);
        context.AddRange(property, roomTypeA, roomTypeB, ratePlan);

        var roomsA = Enumerable.Range(0, 2)
            .Select(index => new PhysicalRoom(
                Guid.NewGuid(), property.Id, roomTypeA, $"A{index}", 1, OperationalStatus.Active, Now))
            .ToList();
        var roomsB = Enumerable.Range(0, 2)
            .Select(index => new PhysicalRoom(
                Guid.NewGuid(), property.Id, roomTypeB, $"B{index}", 1, OperationalStatus.Active, Now))
            .ToList();
        context.AddRange(roomsA.Concat(roomsB));

        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlan.Id, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomTypeA.Id, 1, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash($"{slug}:idempotency"), HexHash($"{slug}:fingerprint"), HexHash($"{slug}:guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash(slug)[..8].ToUpperInvariant()}", Now);
        context.Add(reservation);

        await context.SaveChangesAsync();
        return new Fixture(property, roomsA, roomsB, reservation.Units.Single());
    }

    /// <summary>A second, unrelated Property, used only to prove isolation.</summary>
    private async Task<Property> SeedOtherPropertyAsync()
    {
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Hotel cp02-other", "cp02-other", null, "2 Hotel Street", "Hue", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        context.Add(property);
        await context.SaveChangesAsync();
        return property;
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(
                System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed)))
            .ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        List<PhysicalRoom> RoomsA,
        List<PhysicalRoom> RoomsB,
        ReservationUnit Unit);
}
