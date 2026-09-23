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
        string? contentType = "application/json")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, BlocksUrl(propertyId))
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

        // No block supersede/split/cancel route exists anywhere.
        var allPaths = swagger.GetProperty("paths").EnumerateObject().Select(p => p.Name).ToArray();
        Assert.DoesNotContain(allPaths, p =>
            p.Contains("operational-blocks/", StringComparison.OrdinalIgnoreCase));
    }

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

        await context.SaveChangesAsync();
        return new Fixture(property, roomsA, outOfServiceRoom);
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
        PhysicalRoom OutOfServiceRoom);

    private sealed record OtherProperty(Property Property, PhysicalRoom Room);
}
