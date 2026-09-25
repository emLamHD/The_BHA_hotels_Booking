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
using TheBha.Api.Controllers;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.3-CP01 acceptance: the Admin operational-block create endpoint,
/// proven against real PostgreSQL 17 through a real host.
///
/// <para>
/// This suite proves only what is new — the HTTP adapter: status mapping, the
/// server-owned audit identity, and that the created block is visible on the
/// authoritative board read. The scheduling invariants behind it (room/property
/// scoping, Active status, physical capacity, advisory locks, transaction
/// atomicity, append-only audit) are already proven directly against
/// <see cref="IOperationalBlockMutationStore"/> by
/// <see cref="OperationalBlockMutationStoreTests"/>, and the write gate's full
/// transport/origin/media-type permutation matrix by
/// <see cref="AdminCalendarWriteGateApiTests"/>; neither is repeated here, only
/// the few gate outcomes that must hold on this specific new route.
/// </para>
///
/// <para>
/// Every refusal is checked twice: the status the caller sees, and that the
/// database holds no block, no segment and no audit row afterwards. For a write
/// boundary a status code alone would not distinguish "refused" from "mutated,
/// then reported an error".
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminOperationalBlockCreateApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6); // 5 nights: 9/1-9/5

    private const string AllowedAdminOrigin = "https://localhost:3001";
    private const string ServerOwnedActor = "admin-calendar-local-development";

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

    private WebApplicationFactory<Program> CreateWriteHost() =>
        factory.WithWebHostBuilder(builder =>
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true"));

    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });

    private static HttpClient CreateCleartextClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

    private static string BlocksUrl(Guid propertyId) =>
        $"/api/admin/v1/properties/{propertyId}/operational-blocks";

    /// <summary>
    /// The supported shape of a real Admin client call: HTTPS, loopback, the
    /// configured Admin origin, <c>application/json</c> — and deliberately no
    /// Customer session cookie and no antiforgery token, neither of which this
    /// route uses or accepts.
    /// </summary>
    private static HttpRequestMessage CreatePost(
        Guid propertyId,
        string body,
        string? origin = AllowedAdminOrigin,
        string? contentType = "application/json") =>
        Post(BlocksUrl(propertyId), body, origin, contentType);

    private static HttpRequestMessage CancelPost(
        Guid propertyId,
        Guid segmentId,
        string body,
        string? origin = AllowedAdminOrigin,
        string? contentType = "application/json") =>
        Post($"{BlocksUrl(propertyId)}/{segmentId}/cancel", body, origin, contentType);

    private static HttpRequestMessage Post(string url, string body, string? origin, string? contentType)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)),
        };
        if (contentType is not null)
        {
            request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        }

        if (origin is not null)
        {
            request.Headers.TryAddWithoutValidation("Origin", origin);
        }

        return request;
    }

    private static string RequestBody(
        Guid physicalRoomId,
        DateOnly startDate,
        DateOnly endDate,
        string? reason = "Burst pipe in the bathroom",
        string? extraProperties = null) =>
        $$"""
        {
          "physicalRoomId": "{{physicalRoomId}}",
          "startDate": "{{startDate:yyyy-MM-dd}}",
          "endDate": "{{endDate:yyyy-MM-dd}}",
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

    private async Task<List<RoomOccupancySegment>> SegmentsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegments.AsNoTracking().ToListAsync();
    }

    private async Task<List<RoomBlock>> BlocksAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomBlocks.AsNoTracking().ToListAsync();
    }

    private async Task<List<RoomOccupancySegmentAudit>> AuditsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegmentAudits.AsNoTracking().ToListAsync();
    }

    private async Task AssertNothingWrittenAsync(string because)
    {
        Assert.True((await BlocksAsync()).Count == 0, because);
        Assert.True((await SegmentsAsync()).Count == 0, because);
        Assert.True((await AuditsAsync()).Count == 0, because);
    }

    private async Task<ReservationBoardDto> ReadBoardAsync(HttpClient client, Guid propertyId) =>
        (await client.GetFromJsonAsync<ReservationBoardDto>(
            $"/api/admin/v1/properties/{propertyId}/reservation-board" +
            $"?from={CheckIn:yyyy-MM-dd}&to={CheckOut:yyyy-MM-dd}",
            BoardJson))!;

    /// <summary>
    /// Rooms of the fixture's RoomType the public availability search would sell
    /// for the whole stay, or 0 when it offers none (it omits sold-out offers).
    /// </summary>
    private static async Task<int> SellableRoomsAsync(HttpClient client, Guid propertyId)
    {
        var offers = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{propertyId}/availability" +
            $"?checkIn={CheckIn:yyyy-MM-dd}&checkOut={CheckOut:yyyy-MM-dd}&adults=1&children=0&rooms=1");
        return offers.EnumerateArray().Select(offer => offer.GetProperty("availableRooms").GetInt32()).SingleOrDefault();
    }

    private static async Task<RoomOccupancySegmentDto> CreateBlockAsync(
        HttpClient client, Guid propertyId, Guid physicalRoomId)
    {
        using var request = CreatePost(propertyId, RequestBody(physicalRoomId, CheckIn, CheckOut));
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreateOperationalBlockResponse>())!.Segment;
    }

    private static string CancelBody(uint expectedVersion, string? reason = null) =>
        JsonSerializer.Serialize(new { expectedVersion, reason });

    /// <summary>The block survived a refused cancel exactly as created: Effective, one audit row.</summary>
    private async Task AssertBlockUntouchedAsync(RoomOccupancySegmentDto block, string because)
    {
        var persisted = Assert.Single(await SegmentsAsync(), s => s.Id == block.Id);
        Assert.True(persisted.Status == RoomOccupancySegmentStatus.Effective, because);
        Assert.True(
            (await AuditsAsync()).Count(a => a.SegmentId == block.Id) == 1,
            because);
    }

    // ---------------------------------------------------------------
    // Acceptance 1: the happy path, end to end
    // ---------------------------------------------------------------

    [Fact]
    public async Task Block_is_created_audited_and_visible_on_the_next_board_read()
    {
        var data = await SeedAsync("cp01-happy");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            // A forged actor in the body must change nothing: the server owns
            // the audit identity, and an unknown JSON property is ignored.
            RequestBody(
                data.RoomsA[0].Id, CheckIn, CheckOut,
                reason: "  Burst pipe in the bathroom  ",
                extraProperties: """
                ,
                  "actorReference": "staff:general-manager",
                  "authorizationEvidence": "approval:forged-by-the-caller"
                """));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        // The CP01 write composition, on a second real business route: the write
        // policy answers the configured Admin origin exactly, never a wildcard.
        Assert.Equal(
            [AllowedAdminOrigin],
            response.Headers.GetValues("Access-Control-Allow-Origin").ToArray());

        var created = await response.Content.ReadFromJsonAsync<CreateOperationalBlockResponse>();
        Assert.NotNull(created);
        Assert.NotEqual(Guid.Empty, created!.RoomBlockId);
        var segment = created.Segment;
        Assert.NotEqual(Guid.Empty, segment.Id);
        Assert.Equal(data.Property.Id, segment.PropertyId);
        Assert.Equal(data.RoomsA[0].Id, segment.PhysicalRoomId);
        Assert.Equal(created.RoomBlockId, segment.RoomBlockId);
        Assert.Null(segment.ReservationUnitId);
        Assert.Equal(RoomOccupancySegmentType.OperationalBlock.ToString(), segment.Type);
        Assert.Equal(RoomOccupancySegmentStatus.Effective.ToString(), segment.Status);
        Assert.Equal(CheckIn, segment.StartDate);
        Assert.Equal(CheckOut, segment.EndDate);
        Assert.NotEqual(0u, segment.Version);

        // Exactly one header and exactly one segment — never the multi-segment
        // command the store is also capable of.
        var block = Assert.Single(await BlocksAsync());
        Assert.Equal(created.RoomBlockId, block.Id);
        Assert.Equal("Burst pipe in the bathroom", block.Reason);
        Assert.Equal(ServerOwnedActor, block.CreatedByActorReference);

        var persisted = Assert.Single(await SegmentsAsync());
        Assert.Equal(segment.Id, persisted.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, persisted.Status);

        var audit = Assert.Single(await AuditsAsync());
        Assert.Equal(segment.Id, audit.SegmentId);
        Assert.Equal(RoomOccupancySegmentAuditEventType.Created, audit.EventType);
        Assert.Equal(ServerOwnedActor, audit.ActorReference);
        Assert.Null(audit.AuthorizationEvidence);
        Assert.Equal("Burst pipe in the bathroom", audit.Reason);

        // The authoritative read agrees with what the create returned.
        var board = await ReadBoardAsync(client, data.Property.Id);
        var boardBlock = Assert.Single(board.OperationalBlocks);
        Assert.Equal(created.RoomBlockId, boardBlock.RoomBlockId);
        Assert.Equal(segment.Id, boardBlock.SegmentId);
        Assert.Equal(segment.Version, boardBlock.SegmentVersion);
        Assert.Equal(data.RoomsA[0].Id, boardBlock.PhysicalRoomId);
        Assert.Equal(CheckIn, boardBlock.StartDate);
        Assert.Equal(CheckOut, boardBlock.EndDate);
        Assert.Equal("Burst pipe in the bathroom", boardBlock.Reason);
    }

    // ---------------------------------------------------------------
    // Acceptance 2: invalid input is refused, and writes nothing
    // ---------------------------------------------------------------

    [Theory]
    [InlineData("physicalRoomId")]
    [InlineData("startDate")]
    [InlineData("endDate")]
    [InlineData("reason")]
    public async Task Omitted_required_field_is_a_400_before_the_store(string omitted)
    {
        var data = await SeedAsync($"cp01-omit-{omitted}");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var full = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
            RequestBody(data.RoomsA[0].Id, CheckIn, CheckOut))!;
        full.Remove(omitted);

        using var request = CreatePost(data.Property.Id, JsonSerializer.Serialize(full));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNothingWrittenAsync($"'{omitted}' is required, so nothing may reach the store");
    }

    [Theory]
    [InlineData("", "an empty reason is no reason at all")]
    [InlineData("   ", "a whitespace-only reason is no reason at all")]
    public async Task Blank_reason_is_a_400_and_writes_nothing(string reason, string because)
    {
        var data = await SeedAsync($"cp01-blank-{reason.Length}");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(data.RoomsA[0].Id, CheckIn, CheckOut, reason: reason));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNothingWrittenAsync(because);
    }

    [Fact]
    public async Task Reversed_or_empty_date_range_is_a_400_and_writes_nothing()
    {
        var data = await SeedAsync("cp01-dates");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        foreach (var (start, end, because) in new[]
                 {
                     (CheckOut, CheckIn, "endDate before startDate is not a night range"),
                     (CheckIn, CheckIn, "a zero-night range is not a night range"),
                 })
        {
            using var request = CreatePost(data.Property.Id, RequestBody(data.RoomsA[0].Id, start, end));
            var response = await client.SendAsync(request);

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("Invalid operational block request", await TitleAsync(response));
            await AssertNothingWrittenAsync(because);
        }
    }

    // ---------------------------------------------------------------
    // Acceptance 2b: the endpoint bounds the caller-controlled night span
    // ---------------------------------------------------------------

    /// <summary>
    /// PMS-CAL-001.3-CP01-C2: the store enumerates every requested night —
    /// `DatesInRange` materializes them, and `AdvisoryLockCoordinator` takes one
    /// sequential PostgreSQL advisory lock per night inside an open transaction —
    /// so an unbounded span is work proportional to untrusted input. The endpoint
    /// refuses a span longer than its published maximum before the store is
    /// called at all. One night over the maximum is the boundary that proves the
    /// rule, and is deliberately small enough to be safe to run against code
    /// without the guard.
    /// </summary>
    [Fact]
    public async Task Range_one_night_longer_than_the_maximum_is_a_400_and_never_reaches_the_store()
    {
        var data = await SeedAsync("cp01-too-long");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(data.RoomsA[0].Id, CheckIn, CheckIn.AddDays(367)));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        // Read the problem document once: the body is a stream, and reading it
        // twice would fail on the second read rather than on the assertion.
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invalid operational block request", problem.GetProperty("title").GetString());
        // The operator is told the rule and the offending length, not just "invalid".
        var detail = problem.GetProperty("detail").GetString()!;
        Assert.Contains("366", detail);
        Assert.Contains("367", detail);
        await AssertNothingWrittenAsync("a span over the maximum must never reach the store");
    }

    /// <summary>
    /// The widest span <see cref="DateOnly"/> can express — roughly 3.65 million
    /// nights, the case the review finding named. Safe to run only because the
    /// guard answers it before any night is enumerated or any lock is taken.
    /// </summary>
    [Fact]
    public async Task Maximum_DateOnly_span_is_refused_without_touching_the_store()
    {
        var data = await SeedAsync("cp01-max-span");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(data.RoomsA[0].Id, DateOnly.MinValue, DateOnly.MaxValue));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid operational block request", await TitleAsync(response));
        await AssertNothingWrittenAsync("the widest expressible span must never reach the store");
    }

    /// <summary>
    /// The maximum itself is *not* refused by the guard. Proven without asking a
    /// real fixture to lock 366 nights: the request names a room another Property
    /// owns, and the store answers `404` from its room lookup — which happens
    /// before it builds a lock plan or enumerates a single night. A `404` here can
    /// only mean the request passed the guard and reached the store; the guard's
    /// own refusal is a `400`.
    /// </summary>
    [Fact]
    public async Task Range_of_exactly_the_maximum_passes_the_guard_and_reaches_the_store()
    {
        var data = await SeedAsync("cp01-max-allowed");
        var other = await SeedOtherPropertyWithRoomAsync();
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(other.Room.Id, CheckIn, CheckIn.AddDays(366)));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("Operational block target not found", await TitleAsync(response));
        await AssertNothingWrittenAsync("a refused room writes nothing, whatever the span");
    }

    // ---------------------------------------------------------------
    // Acceptance 3: a room this Property does not own is a 404
    // ---------------------------------------------------------------

    [Fact]
    public async Task Room_belonging_to_another_property_is_a_404_and_writes_nothing()
    {
        var data = await SeedAsync("cp01-other-property");
        var other = await SeedOtherPropertyWithRoomAsync();
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(other.Room.Id, CheckIn, CheckOut));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("Operational block target not found", await TitleAsync(response));
        await AssertNothingWrittenAsync("a cross-Property room must never be blocked from this Property's route");
    }

    // ---------------------------------------------------------------
    // Acceptance 4: not-Active and capacity conflicts are 409, atomically
    // ---------------------------------------------------------------

    [Fact]
    public async Task Room_that_is_not_active_is_a_409_and_writes_nothing()
    {
        var data = await SeedAsync("cp01-inactive-room");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var request = CreatePost(
            data.Property.Id,
            RequestBody(data.OutOfServiceRoom.Id, CheckIn, CheckOut));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("Operational block conflict", await TitleAsync(response));
        await AssertNothingWrittenAsync("a room that is not Active cannot take a new block");
    }

    /// <summary>
    /// The fixture has two Active RoomTypeA rooms and one confirmed Unit that
    /// needs one of them, so the first block is allowed (usable capacity 1,
    /// demand 1) and the second would strand that Unit (usable capacity 0) —
    /// the store refuses it, and the first block is left exactly as it was.
    /// </summary>
    [Fact]
    public async Task Block_that_would_strand_a_confirmed_reservation_is_a_409_and_leaves_the_first_block_intact()
    {
        var data = await SeedAsync("cp01-capacity");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        using var first = CreatePost(data.Property.Id, RequestBody(data.RoomsA[0].Id, CheckIn, CheckOut));
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(first)).StatusCode);

        using var second = CreatePost(data.Property.Id, RequestBody(data.RoomsA[1].Id, CheckIn, CheckOut));
        var response = await client.SendAsync(second);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("Operational block conflict", await TitleAsync(response));

        // Exactly the first write survives: the refused one left no partial
        // header, segment or audit row behind.
        Assert.Single(await BlocksAsync());
        var segment = Assert.Single(await SegmentsAsync());
        Assert.Equal(data.RoomsA[0].Id, segment.PhysicalRoomId);
        Assert.Single(await AuditsAsync());
    }

    // ---------------------------------------------------------------
    // Acceptance 5: the gate owns this route too
    // ---------------------------------------------------------------

    [Fact]
    public async Task Closed_write_gate_refuses_the_real_route_before_the_controller_runs()
    {
        var data = await SeedAsync("cp01-closed-gate");
        // The ordinary host: AdminCalendar:EnableUnauthenticatedWrite is false.
        using var client = CreateHttpsClient(factory);

        using var valid = CreatePost(data.Property.Id, RequestBody(data.RoomsA[0].Id, CheckIn, CheckOut));
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

    [Fact]
    public async Task Cleartext_disallowed_origin_and_wrong_media_type_are_each_refused_by_policy()
    {
        var data = await SeedAsync("cp01-gate-policy");
        using var host = CreateWriteHost();
        var body = RequestBody(data.RoomsA[0].Id, CheckIn, CheckOut);

        // Cleartext never becomes a write: the pre-redirect guard answers 404
        // rather than a 307 a client would follow with method and body intact.
        using var cleartextClient = CreateCleartextClient(host);
        using var cleartext = CreatePost(data.Property.Id, body);
        var cleartextResponse = await cleartextClient.SendAsync(cleartext);
        Assert.Equal(HttpStatusCode.NotFound, cleartextResponse.StatusCode);
        Assert.Null(cleartextResponse.Headers.Location);

        using var client = CreateHttpsClient(host);

        using var badOrigin = CreatePost(data.Property.Id, body, origin: "https://evil.example");
        var badOriginResponse = await client.SendAsync(badOrigin);
        Assert.Equal(HttpStatusCode.Forbidden, badOriginResponse.StatusCode);
        Assert.Equal("Origin not allowed", await TitleAsync(badOriginResponse));

        using var badMediaType = CreatePost(data.Property.Id, body, contentType: "text/json");
        var badMediaTypeResponse = await client.SendAsync(badMediaType);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, badMediaTypeResponse.StatusCode);
        Assert.Equal("Unsupported media type", await TitleAsync(badMediaTypeResponse));

        await AssertNothingWrittenAsync("every gate refusal must reach neither the controller nor the store");
    }

    // ---------------------------------------------------------------
    // Acceptance 6: the published contract
    // ---------------------------------------------------------------

    [Fact]
    public async Task OpenApi_publishes_one_block_create_route_with_no_actor_field_and_json_only()
    {
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        const string ExpectedPath = "/api/admin/v1/properties/{propertyId}/operational-blocks";

        Assert.True(
            swagger.GetProperty("paths").TryGetProperty(ExpectedPath, out var blocksPath),
            $"{ExpectedPath} must be published");
        Assert.Equal(["post"], blocksPath.EnumerateObject().Select(o => o.Name).ToArray());

        var post = blocksPath.GetProperty("post");
        var responses = post.GetProperty("responses");
        Assert.Equal(
            ["201", "400", "403", "404", "409", "415"],
            responses.EnumerateObject().Select(r => r.Name).Order().ToArray());

        Assert.Equal(
            "#/components/schemas/CreateOperationalBlockResponse",
            BodySchemaRef(responses.GetProperty("201")));
        foreach (var status in new[] { "400", "403", "409", "415" })
        {
            Assert.Equal("#/components/schemas/ProblemDetails", BodySchemaRef(responses.GetProperty(status)));
        }

        // The closed gate's 404 has an empty body, so no schema may be promised.
        Assert.False(responses.GetProperty("404").TryGetProperty("content", out _));

        // The gate accepts application/json alone, so that is the only media
        // type the contract may advertise.
        var requestContent = post.GetProperty("requestBody").GetProperty("content");
        Assert.Equal(
            ["application/json"],
            requestContent.EnumerateObject().Select(media => media.Name).ToArray());

        var schemaRef = requestContent
            .GetProperty("application/json").GetProperty("schema")
            .GetProperty("$ref").GetString()!;
        var schema = swagger.GetProperty("components").GetProperty("schemas")
            .GetProperty(schemaRef["#/components/schemas/".Length..]);

        // No actor, no authorization evidence, no segment list, and no
        // split/move/cancel surface: four properties, all four required.
        var properties = schema.GetProperty("properties").EnumerateObject()
            .Select(property => property.Name).ToArray();
        Assert.Equal(
            ["endDate", "physicalRoomId", "reason", "startDate"],
            properties.Order(StringComparer.OrdinalIgnoreCase).ToArray());

        var required = schema.GetProperty("required").EnumerateArray()
            .Select(entry => entry.GetString()!).Order(StringComparer.OrdinalIgnoreCase).ToArray();
        Assert.Equal(["endDate", "physicalRoomId", "reason", "startDate"], required);

        // The response publishes the block/segment ids, never the server-owned
        // audit actor.
        var responseSchema = swagger.GetProperty("components").GetProperty("schemas")
            .GetProperty("CreateOperationalBlockResponse");
        Assert.Equal(
            ["roomBlockId", "segment"],
            responseSchema.GetProperty("properties").EnumerateObject()
                .Select(property => property.Name).Order(StringComparer.OrdinalIgnoreCase).ToArray());

        // Below the collection, only CP02's single-segment cancel exists: no
        // block move, split or multi-segment supersede route.
        var subPaths = swagger.GetProperty("paths").EnumerateObject().Select(p => p.Name)
            .Where(p => p.Contains("operational-blocks/", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        Assert.Equal([ExpectedPath + "/{segmentId}/cancel"], subPaths);
    }

    // ---------------------------------------------------------------
    // PMS-CAL-001.3-CP02: cancel one block segment
    // ---------------------------------------------------------------

    /// <summary>
    /// The fixture's one confirmed Unit needs one of the two Active rooms, so
    /// while a block holds the other the RoomType has nothing left to sell;
    /// cancelling the block must make exactly one room sellable again.
    /// </summary>
    [Fact]
    public async Task Cancel_lifts_the_block_keeps_header_and_audit_and_releases_the_room()
    {
        var data = await SeedAsync("cp02-happy");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var block = await CreateBlockAsync(client, data.Property.Id, data.RoomsA[0].Id);
        Assert.Equal(0, await SellableRoomsAsync(client, data.Property.Id));

        using var request = CancelPost(
            data.Property.Id, block.Id, CancelBody(block.Version, "  Pipe repaired  "));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(
            [AllowedAdminOrigin],
            response.Headers.GetValues("Access-Control-Allow-Origin").ToArray());
        var cancelled = (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>())!;
        Assert.Equal(block.Id, cancelled.Id);
        Assert.Equal(block.RoomBlockId, cancelled.RoomBlockId);
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled.ToString(), cancelled.Status);
        Assert.NotEqual(block.Version, cancelled.Version);

        // The header and the segment row stay; only the status changed.
        Assert.Equal(block.RoomBlockId, Assert.Single(await BlocksAsync()).Id);
        var persisted = Assert.Single(await SegmentsAsync());
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled, persisted.Status);
        Assert.Equal((CheckIn, CheckOut), (persisted.StartDate, persisted.EndDate));

        // Append-only audit: the original Created row plus one Cancelled row.
        var audits = await AuditsAsync();
        Assert.Equal(2, audits.Count);
        Assert.Single(audits, a => a.EventType == RoomOccupancySegmentAuditEventType.Created && a.SegmentId == block.Id);
        var cancelAudit = Assert.Single(audits, a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        Assert.Equal(block.Id, cancelAudit.SegmentId);
        Assert.Equal(ServerOwnedActor, cancelAudit.ActorReference);
        Assert.Null(cancelAudit.AuthorizationEvidence);
        Assert.Equal("Pipe repaired", cancelAudit.Reason);

        // The authoritative read and public availability both see the room back.
        Assert.Empty((await ReadBoardAsync(client, data.Property.Id)).OperationalBlocks);
        Assert.Equal(1, await SellableRoomsAsync(client, data.Property.Id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task Cancel_without_a_reason_records_no_reason(string? reason)
    {
        var data = await SeedAsync("cp02-no-reason");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var block = await CreateBlockAsync(client, data.Property.Id, data.RoomsA[0].Id);

        using var request = CancelPost(data.Property.Id, block.Id, CancelBody(block.Version, reason));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(request)).StatusCode);

        var cancelAudit = Assert.Single(
            await AuditsAsync(), a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
        Assert.Null(cancelAudit.Reason);
    }

    [Theory]
    [InlineData("""{ "reason": "no version" }""")]
    [InlineData("""{ "expectedVersion": null }""")]
    [InlineData("""{ "expectedVersion": -1 }""")]
    [InlineData("{ this is not json")]
    public async Task Missing_or_malformed_expected_version_is_a_400_and_cancels_nothing(string body)
    {
        var data = await SeedAsync("cp02-bad-body");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var block = await CreateBlockAsync(client, data.Property.Id, data.RoomsA[0].Id);

        using var request = CancelPost(data.Property.Id, block.Id, body);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertBlockUntouchedAsync(block, "an unreadable body must never reach the store");
    }

    [Fact]
    public async Task Stale_version_and_a_second_cancel_are_each_a_409()
    {
        var data = await SeedAsync("cp02-conflict");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var block = await CreateBlockAsync(client, data.Property.Id, data.RoomsA[0].Id);

        using var stale = CancelPost(data.Property.Id, block.Id, CancelBody(block.Version + 1));
        var staleResponse = await client.SendAsync(stale);
        Assert.Equal(HttpStatusCode.Conflict, staleResponse.StatusCode);
        Assert.Equal("Operational block conflict", await TitleAsync(staleResponse));
        await AssertBlockUntouchedAsync(block, "a stale version must not cancel the block");

        using var first = CancelPost(data.Property.Id, block.Id, CancelBody(block.Version));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(first)).StatusCode);

        // Replaying the same request after success is refused, not repeated:
        // the segment is no longer Effective, and exactly one Cancelled audit exists.
        using var again = CancelPost(data.Property.Id, block.Id, CancelBody(block.Version));
        var againResponse = await client.SendAsync(again);
        Assert.Equal(HttpStatusCode.Conflict, againResponse.StatusCode);
        Assert.Equal("Operational block conflict", await TitleAsync(againResponse));
        Assert.Single(await AuditsAsync(), a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
    }

    [Fact]
    public async Task Another_propertys_block_an_assignment_or_an_unknown_segment_is_a_404()
    {
        var data = await SeedAsync("cp02-not-found");
        var other = await SeedOtherPropertyWithRoomAsync();
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var otherBlock = await CreateBlockAsync(client, other.Property.Id, other.Room.Id);

        var assignment = new RoomOccupancySegment(
            Guid.NewGuid(), data.Property.Id, data.RoomsA[1].Id, RoomOccupancySegmentType.ReservationAssignment,
            CheckIn, CheckOut, data.Unit.Id, null, Now);
        await using (var context = factory.CreateDbContext())
        {
            context.Add(assignment);
            await context.SaveChangesAsync();
        }

        var assignmentVersion = await ReadAssignmentVersionAsync(client, data.Property.Id, assignment.Id);
        foreach (var (segmentId, version, because) in new[]
        {
            (otherBlock.Id, otherBlock.Version, "another Property's block"),
            (assignment.Id, assignmentVersion, "a reservation assignment segment"),
            (Guid.NewGuid(), 1u, "a segment that does not exist"),
        })
        {
            using var request = CancelPost(data.Property.Id, segmentId, CancelBody(version));
            var response = await client.SendAsync(request);
            Assert.True(response.StatusCode == HttpStatusCode.NotFound, because);
            Assert.Equal("Operational block target not found", await TitleAsync(response));
        }

        await AssertBlockUntouchedAsync(otherBlock, "a cross-Property block must survive");
        Assert.Equal(
            RoomOccupancySegmentStatus.Effective,
            Assert.Single(await SegmentsAsync(), s => s.Id == assignment.Id).Status);
        Assert.DoesNotContain(
            await AuditsAsync(), a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
    }

    [Fact]
    public async Task Gate_refuses_cancel_before_the_controller_whatever_the_body()
    {
        var data = await SeedAsync("cp02-gate");
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);
        var block = await CreateBlockAsync(client, data.Property.Id, data.RoomsA[0].Id);
        var body = CancelBody(block.Version);

        // Closed gate: a valid and a malformed body are answered identically.
        using var closedClient = CreateHttpsClient(factory);
        using var closedValid = CancelPost(data.Property.Id, block.Id, body);
        using var closedMalformed = CancelPost(data.Property.Id, block.Id, "{ this is not json");
        Assert.Equal(HttpStatusCode.NotFound, (await closedClient.SendAsync(closedValid)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await closedClient.SendAsync(closedMalformed)).StatusCode);

        using var cleartextClient = CreateCleartextClient(host);
        using var cleartext = CancelPost(data.Property.Id, block.Id, body);
        var cleartextResponse = await cleartextClient.SendAsync(cleartext);
        Assert.Equal(HttpStatusCode.NotFound, cleartextResponse.StatusCode);
        Assert.Null(cleartextResponse.Headers.Location);

        using var badOrigin = CancelPost(data.Property.Id, block.Id, body, origin: "https://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(badOrigin)).StatusCode);

        using var badMediaType = CancelPost(data.Property.Id, block.Id, body, contentType: "text/json");
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.SendAsync(badMediaType)).StatusCode);

        await AssertBlockUntouchedAsync(block, "every gate refusal must reach neither the controller nor the store");
    }

    [Fact]
    public async Task OpenApi_publishes_the_cancel_route_with_version_and_optional_reason_json_only()
    {
        using var host = CreateWriteHost();
        using var client = CreateHttpsClient(host);

        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        const string CancelPath = "/api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/cancel";
        Assert.True(
            swagger.GetProperty("paths").TryGetProperty(CancelPath, out var cancelPath),
            $"{CancelPath} must be published");
        Assert.Equal(["post"], cancelPath.EnumerateObject().Select(o => o.Name).ToArray());

        var post = cancelPath.GetProperty("post");
        var responses = post.GetProperty("responses");
        Assert.Equal(
            ["200", "400", "403", "404", "409", "415"],
            responses.EnumerateObject().Select(r => r.Name).Order().ToArray());
        Assert.Equal("#/components/schemas/RoomOccupancySegmentDto", BodySchemaRef(responses.GetProperty("200")));
        foreach (var status in new[] { "400", "403", "409", "415" })
        {
            Assert.Equal("#/components/schemas/ProblemDetails", BodySchemaRef(responses.GetProperty(status)));
        }

        Assert.False(responses.GetProperty("404").TryGetProperty("content", out _));

        var requestContent = post.GetProperty("requestBody").GetProperty("content");
        Assert.Equal(
            ["application/json"],
            requestContent.EnumerateObject().Select(media => media.Name).ToArray());

        var schemaRef = requestContent
            .GetProperty("application/json").GetProperty("schema")
            .GetProperty("$ref").GetString()!;
        var schema = swagger.GetProperty("components").GetProperty("schemas")
            .GetProperty(schemaRef["#/components/schemas/".Length..]);

        // No room, dates, segment list, actor or authorization evidence.
        Assert.Equal(
            ["expectedVersion", "reason"],
            schema.GetProperty("properties").EnumerateObject()
                .Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(
            ["expectedVersion"],
            schema.GetProperty("required").EnumerateArray().Select(entry => entry.GetString()!).ToArray());
    }

    private async Task<uint> ReadAssignmentVersionAsync(HttpClient client, Guid propertyId, Guid segmentId) =>
        (await ReadBoardAsync(client, propertyId)).Stays
            .SelectMany(stay => stay.Assignments)
            .Single(a => a.SegmentId == segmentId)
            .SegmentVersion;

    // ---------------------------------------------------------------
    // Seeding
    // ---------------------------------------------------------------

    /// <summary>
    /// Two Active RoomTypeA rooms, one OutOfService room, and one confirmed
    /// Reservation for RoomTypeA over <see cref="CheckIn"/>-<see cref="CheckOut"/>:
    /// enough for one block to fit and a second to be refused on capacity.
    /// </summary>
    private async Task<Fixture> SeedAsync(string slug)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();

        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(
            Guid.NewGuid(), property.Id, "CP01A", slug, $"{slug}-a", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(
            Guid.NewGuid(), property.Id, "CP01", slug, null, "VND", true, Now);
        context.AddRange(property, roomType, ratePlan);

        var roomsA = Enumerable.Range(0, 2)
            .Select(index => new PhysicalRoom(
                Guid.NewGuid(), property.Id, roomType, $"A{index}", 1, OperationalStatus.Active, Now))
            .ToList();
        var outOfServiceRoom = new PhysicalRoom(
            Guid.NewGuid(), property.Id, roomType, "A-OOS", 1, OperationalStatus.OutOfService, Now);
        context.AddRange(roomsA);
        context.Add(outOfServiceRoom);

        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlan.Id, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomType.Id, 1, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash($"{slug}:idempotency"), HexHash($"{slug}:fingerprint"), HexHash($"{slug}:guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash(slug)[..8].ToUpperInvariant()}", Now);
        context.Add(reservation);

        // A rate for every night, so public availability can offer this
        // RoomType and its sellable count is observable (CP02 cancel evidence).
        context.AddRange(nights.Select(night => new DailyRoomRate(
            Guid.NewGuid(), property.Id, roomType.Id, ratePlan.Id, night.StayDate, 100m, Now)));

        await context.SaveChangesAsync();
        return new Fixture(property, roomsA, outOfServiceRoom, reservation.Units.Single());
    }

    /// <summary>A second, unrelated Property with its own room, used only to prove isolation.</summary>
    private async Task<OtherProperty> SeedOtherPropertyWithRoomAsync()
    {
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Hotel cp01-other", "cp01-other", null, "2 Hotel Street", "Hue", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(
            Guid.NewGuid(), property.Id, "CP01O", "cp01-other", "cp01-other-a", null, 2, 4, true, Now);
        var room = new PhysicalRoom(
            Guid.NewGuid(), property.Id, roomType, "O0", 1, OperationalStatus.Active, Now);
        context.AddRange(property, roomType);
        context.Add(room);
        await context.SaveChangesAsync();
        return new OtherProperty(property, room);
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(
                System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed)))
            .ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        List<PhysicalRoom> RoomsA,
        PhysicalRoom OutOfServiceRoom,
        ReservationUnit Unit);

    private sealed record OtherProperty(Property Property, PhysicalRoom Room);
}
