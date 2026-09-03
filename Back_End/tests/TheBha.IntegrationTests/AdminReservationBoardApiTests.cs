using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using TheBha.Api;
using TheBha.Application.Bookings;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.1 Phase 1: real-PostgreSQL API acceptance evidence for the
/// Admin Reservation Board read projection. Covers the Master Execution
/// Prompt's mandatory backend acceptance list end to end.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminReservationBoardApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");

    private static string BoardUrl(Guid propertyId, DateOnly from, DateOnly to) =>
        $"/api/admin/v1/properties/{propertyId}/reservation-board?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}";

    /// <summary>
    /// PMS-CAL-001.1 correction C7: the board gate refuses cleartext, so every
    /// board test must speak HTTPS explicitly. TestServer derives
    /// <c>Request.IsHttps</c> from the request URI, so an https BaseAddress is
    /// what makes these requests represent a real TLS connection. Redirects are
    /// never followed, so a redirect can never be mistaken for a real result.
    /// Unrelated Customer-route test clients are deliberately left alone.
    /// </summary>
    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });

    // ---------------------------------------------------------------
    // Validation (items 3-10)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Missing_from_or_to_returns_bad_request()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        var propertyId = Guid.NewGuid();
        using var client = CreateHttpsClient(factory);

        var missingFrom = await client.GetAsync(
            $"/api/admin/v1/properties/{propertyId}/reservation-board?to=2026-09-05");
        var missingTo = await client.GetAsync(
            $"/api/admin/v1/properties/{propertyId}/reservation-board?from=2026-09-01");

        Assert.Equal(HttpStatusCode.BadRequest, missingFrom.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, missingTo.StatusCode);
    }

    [Fact]
    public async Task Malformed_date_returns_bad_request()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        var propertyId = Guid.NewGuid();
        using var client = CreateHttpsClient(factory);

        var response = await client.GetAsync(
            $"/api/admin/v1/properties/{propertyId}/reservation-board?from=not-a-date&to=2026-09-05");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("2026-09-05", "2026-09-05")] // from == to
    [InlineData("2026-09-05", "2026-09-01")] // from > to
    public async Task Equal_or_reversed_range_returns_bad_request(string from, string to)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        var propertyId = Guid.NewGuid();
        using var client = CreateHttpsClient(factory);

        var response = await client.GetAsync(
            $"/api/admin/v1/properties/{propertyId}/reservation-board?from={from}&to={to}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task One_night_range_is_accepted_and_thirtyone_nights_is_accepted_and_thirtytwo_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "range-limits");
        using var client = CreateHttpsClient(factory);

        var oneNight = await client.GetAsync(BoardUrl(
            fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 2)));
        var thirtyOneNights = await client.GetAsync(BoardUrl(
            fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 2)));
        var thirtyTwoNights = await client.GetAsync(BoardUrl(
            fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 3)));

        Assert.Equal(HttpStatusCode.OK, oneNight.StatusCode);
        Assert.Equal(HttpStatusCode.OK, thirtyOneNights.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, thirtyTwoNights.StatusCode);
    }

    [Fact]
    public async Task Inactive_and_nonexistent_property_returns_not_found_and_leaks_no_children()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "inactive-property");
        var (_, units) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3), "stay");
        _ = units;
        var property = await context.Properties.SingleAsync(p => p.Id == fixture.Property.Id);
        property.Deactivate(Now);
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var nonExistent = await client.GetAsync(
            BoardUrl(Guid.NewGuid(), new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
        var inactive = await client.GetAsync(
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
        var inactiveProblem = await inactive.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.NotFound, nonExistent.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, inactive.StatusCode);
        Assert.Equal("application/problem+json", inactive.Content.Headers.ContentType?.MediaType);
        Assert.Equal(404, inactiveProblem.GetProperty("status").GetInt32());
    }

    // ---------------------------------------------------------------
    // Segment boundary / overlap exclusion (items 11-12)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Segment_touching_only_the_open_boundary_is_excluded()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "boundary");
        var from = new DateOnly(2026, 9, 10);
        var to = new DateOnly(2026, 9, 15);

        // Stay + assignment beginning exactly at `to` (starts 9/15..9/17) — excluded.
        var (_, unitsAfter) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, to, to.AddDays(2), "after");
        context.Add(Assignment(fixture, fixture.StandardRooms[0], unitsAfter[0], to, to.AddDays(2)));

        // Stay + assignment ending exactly at `from` (9/6..9/10) — excluded.
        var (_, unitsBefore) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, from.AddDays(-4), from, "before");
        context.Add(Assignment(fixture, fixture.StandardRooms[1], unitsBefore[0], from.AddDays(-4), from));

        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var response = await client.GetAsync(BoardUrl(fixture.Property.Id, from, to));
        var board = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, board.GetProperty("stays").GetArrayLength());
    }

    // ---------------------------------------------------------------
    // Assignment/block Effective-vs-Cancelled inclusion (items 13-16)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Effective_assignment_appears_and_cancelled_assignment_does_not()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "assignment-visibility");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 8);
        var (_, effectiveUnits) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, from, from.AddDays(2), "effective");
        var effectiveSegment = Assignment(fixture, fixture.StandardRooms[0], effectiveUnits[0], from, from.AddDays(2));
        context.Add(effectiveSegment);

        var (_, cancelledUnits) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, from.AddDays(3), from.AddDays(5), "cancelled");
        var cancelledSegment = Assignment(fixture, fixture.StandardRooms[1], cancelledUnits[0], from.AddDays(3), from.AddDays(5));
        context.Add(cancelledSegment);
        await context.SaveChangesAsync();
        cancelledSegment.Cancel();
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var response = await client.GetAsync(BoardUrl(fixture.Property.Id, from, to));
        var board = await response.Content.ReadFromJsonAsync<JsonElement>();
        var stays = board.GetProperty("stays").EnumerateArray().ToArray();

        Assert.Equal(2, stays.Length);
        var effectiveStay = stays.Single(s => s.GetProperty("reservationUnitId").GetGuid() == effectiveUnits[0].Id);
        var cancelledStay = stays.Single(s => s.GetProperty("reservationUnitId").GetGuid() == cancelledUnits[0].Id);
        Assert.Equal(1, effectiveStay.GetProperty("assignments").GetArrayLength());
        Assert.Equal("FullyAssigned", effectiveStay.GetProperty("coverageStatus").GetString());
        Assert.Equal(0, cancelledStay.GetProperty("assignments").GetArrayLength());
        Assert.Equal("FullyUnassigned", cancelledStay.GetProperty("coverageStatus").GetString());
    }

    [Fact]
    public async Task Effective_operational_block_appears_on_correct_room_and_dates_cancelled_does_not()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "block-visibility");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 8);
        var block = new RoomBlock(Guid.NewGuid(), fixture.Property.Id, "Maintenance", "actor:qa", Now);
        context.Add(block);
        var effectiveBlockSegment = Block(fixture, fixture.StandardRooms[0], block, from.AddDays(1), from.AddDays(3));
        var cancelledBlockSegment = Block(fixture, fixture.StandardRooms[1], block, from.AddDays(1), from.AddDays(3));
        context.Add(effectiveBlockSegment);
        context.Add(cancelledBlockSegment);
        await context.SaveChangesAsync();
        cancelledBlockSegment.Cancel();
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var response = await client.GetAsync(BoardUrl(fixture.Property.Id, from, to));
        var board = await response.Content.ReadFromJsonAsync<JsonElement>();
        var blocks = board.GetProperty("operationalBlocks").EnumerateArray().ToArray();

        Assert.Single(blocks);
        Assert.Equal(fixture.StandardRooms[0].Id, blocks[0].GetProperty("physicalRoomId").GetGuid());
        Assert.Equal("2026-09-02", blocks[0].GetProperty("startDate").GetString());
        Assert.Equal("2026-09-04", blocks[0].GetProperty("endDate").GetString());
        Assert.Equal("Maintenance", blocks[0].GetProperty("reason").GetString());
        Assert.True(blocks[0].GetProperty("segmentVersion").GetUInt32() > 0);
    }

    // ---------------------------------------------------------------
    // Coverage classification (items 17-20)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Fully_assigned_unit_has_zero_uncovered_ranges()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "fully-assigned");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 5);
        var (_, units) = await CreateReservationAsync(context, fixture, fixture.Standard.Id, from, from.AddDays(3), "full");
        context.Add(Assignment(fixture, fixture.StandardRooms[0], units[0], from, from.AddDays(3)));
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var board = await client.GetFromJsonAsync<JsonElement>(BoardUrl(fixture.Property.Id, from, to));
        var stay = board.GetProperty("stays").EnumerateArray().Single();

        Assert.Equal("FullyAssigned", stay.GetProperty("coverageStatus").GetString());
        Assert.Equal(0, stay.GetProperty("unassignedRanges").GetArrayLength());
    }

    [Fact]
    public async Task Fully_unassigned_committed_unit_has_exact_uncovered_range()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "fully-unassigned");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 5);
        await CreateReservationAsync(context, fixture, fixture.Standard.Id, from, from.AddDays(3), "unassigned");
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var board = await client.GetFromJsonAsync<JsonElement>(BoardUrl(fixture.Property.Id, from, to));
        var stay = board.GetProperty("stays").EnumerateArray().Single();
        var ranges = stay.GetProperty("unassignedRanges").EnumerateArray().ToArray();

        Assert.Equal("FullyUnassigned", stay.GetProperty("coverageStatus").GetString());
        Assert.Single(ranges);
        Assert.Equal("2026-09-01", ranges[0].GetProperty("startDate").GetString());
        Assert.Equal("2026-09-04", ranges[0].GetProperty("endDate").GetString());
    }

    [Fact]
    public async Task Partially_assigned_unit_reports_exact_uncovered_nights_and_multiple_disjoint_spans_are_grouped()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "partial");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 11);
        // 6-night stay 9/1..9/7; assign only the middle two nights (9/3-9/5),
        // leaving two disjoint uncovered spans: 9/1-9/3 and 9/5-9/7.
        var (_, units) = await CreateReservationAsync(context, fixture, fixture.Standard.Id, from, from.AddDays(6), "partial");
        context.Add(Assignment(fixture, fixture.StandardRooms[0], units[0], from.AddDays(2), from.AddDays(4)));
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var board = await client.GetFromJsonAsync<JsonElement>(BoardUrl(fixture.Property.Id, from, to));
        var stay = board.GetProperty("stays").EnumerateArray().Single();
        var ranges = stay.GetProperty("unassignedRanges").EnumerateArray().ToArray();

        Assert.Equal("PartiallyAssigned", stay.GetProperty("coverageStatus").GetString());
        Assert.Equal(2, ranges.Length);
        Assert.Equal("2026-09-01", ranges[0].GetProperty("startDate").GetString());
        Assert.Equal("2026-09-03", ranges[0].GetProperty("endDate").GetString());
        Assert.Equal("2026-09-05", ranges[1].GetProperty("startDate").GetString());
        Assert.Equal("2026-09-07", ranges[1].GetProperty("endDate").GetString());
        Assert.Equal(1, stay.GetProperty("assignments").GetArrayLength());
    }

    // ---------------------------------------------------------------
    // Cross-RoomType attribution (item 21) and cancelled Unit (item 22)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Cross_room_type_assignment_preserves_sold_type_and_exposes_actual_type()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "cross-type");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 5);
        var (_, units) = await CreateReservationAsync(context, fixture, fixture.Standard.Id, from, from.AddDays(2), "cross");
        context.Add(Assignment(fixture, fixture.DeluxeRooms[0], units[0], from, from.AddDays(2)));
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var board = await client.GetFromJsonAsync<JsonElement>(BoardUrl(fixture.Property.Id, from, to));
        var stay = board.GetProperty("stays").EnumerateArray().Single();
        var assignment = stay.GetProperty("assignments").EnumerateArray().Single();

        Assert.Equal(fixture.Standard.Id, stay.GetProperty("soldRoomTypeId").GetGuid());
        Assert.Equal(fixture.Deluxe.Id, assignment.GetProperty("actualRoomTypeId").GetGuid());
    }

    [Fact]
    public async Task Cancelled_reservation_unit_produces_no_current_stay()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "cancelled-unit");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 5);
        var (_, units) = await CreateReservationAsync(context, fixture, fixture.Standard.Id, from, from.AddDays(2), "cancel");
        await context.SaveChangesAsync();

        await using var scope = factory.Services.CreateAsyncScope();
        var cancellationStore = scope.ServiceProvider.GetRequiredService<IReservationCancellationStore>();
        await using (var writeContext = factory.CreateDbContext())
        {
            var reservation = await writeContext.Reservations.SingleAsync(r => r.Units.Any(u => u.Id == units[0].Id));
            _ = reservation;
        }
        var reservationEntity = await context.Reservations.SingleAsync(r => r.Id == units[0].ReservationId);
        var cancelResult = await cancellationStore.CancelAsync(
            reservationEntity.Id, null, reservationEntity.GuestAccessTokenHash, "test cleanup", CancellationToken.None);
        Assert.Equal(ReservationCancellationStatus.Cancelled, cancelResult.Status);
        using var client = CreateHttpsClient(factory);

        var board = await client.GetFromJsonAsync<JsonElement>(BoardUrl(fixture.Property.Id, from, to));

        Assert.Equal(0, board.GetProperty("stays").GetArrayLength());
    }

    // ---------------------------------------------------------------
    // Cross-Property isolation (items 1, 23-24)
    // ---------------------------------------------------------------

    [Fact]
    public async Task No_cross_property_leakage_of_rooms_stays_or_blocks()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var propertyA = await CreatePropertyAsync(context, "isolation-a");
        var propertyB = await CreatePropertyAsync(context, "isolation-b");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 5);
        var (_, unitsA) = await CreateReservationAsync(context, propertyA, propertyA.Standard.Id, from, from.AddDays(2), "iso-a");
        context.Add(Assignment(propertyA, propertyA.StandardRooms[0], unitsA[0], from, from.AddDays(2)));
        var blockA = new RoomBlock(Guid.NewGuid(), propertyA.Property.Id, "Block A", "actor:qa", Now);
        context.Add(blockA);
        context.Add(Block(propertyA, propertyA.DeluxeRooms[0], blockA, from, from.AddDays(1)));
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var boardB = await client.GetFromJsonAsync<JsonElement>(BoardUrl(propertyB.Property.Id, from, to));

        Assert.Equal(0, boardB.GetProperty("stays").GetArrayLength());
        Assert.Equal(0, boardB.GetProperty("operationalBlocks").GetArrayLength());
        var roomIdsB = boardB.GetProperty("physicalRooms").EnumerateArray()
            .Select(room => room.GetProperty("id").GetGuid()).ToHashSet();
        Assert.DoesNotContain(propertyA.StandardRooms[0].Id, roomIdsB);
        Assert.DoesNotContain(propertyA.DeluxeRooms[0].Id, roomIdsB);
    }

    // ---------------------------------------------------------------
    // Deterministic ordering (item 25)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Response_collections_are_deterministically_ordered()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "ordering");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 10);
        var (_, unitsZ) = await CreateReservationAsync(context, fixture, fixture.Standard.Id, from.AddDays(3), from.AddDays(5), "zzz");
        var (_, unitsA) = await CreateReservationAsync(context, fixture, fixture.Standard.Id, from, from.AddDays(2), "aaa");
        context.Add(Assignment(fixture, fixture.StandardRooms[1], unitsZ[0], from.AddDays(3), from.AddDays(5)));
        context.Add(Assignment(fixture, fixture.StandardRooms[0], unitsA[0], from, from.AddDays(2)));
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var board = await client.GetFromJsonAsync<JsonElement>(BoardUrl(fixture.Property.Id, from, to));
        var roomTypeNames = board.GetProperty("roomTypes").EnumerateArray()
            .Select(rt => rt.GetProperty("name").GetString()).ToArray();
        var roomFloorsThenNumbers = board.GetProperty("physicalRooms").EnumerateArray()
            .Select(r => (r.GetProperty("floor").GetInt32(), r.GetProperty("roomNumber").GetString())).ToArray();
        var stayCheckIns = board.GetProperty("stays").EnumerateArray()
            .Select(s => s.GetProperty("checkIn").GetString()).ToArray();

        Assert.Equal(roomTypeNames.OrderBy(n => n, StringComparer.Ordinal), roomTypeNames);
        Assert.Equal(
            roomFloorsThenNumbers.OrderBy(r => r.Item1).ThenBy(r => r.Item2, StringComparer.Ordinal),
            roomFloorsThenNumbers);
        Assert.Equal(stayCheckIns.OrderBy(c => c, StringComparer.Ordinal), stayCheckIns);
    }

    // ---------------------------------------------------------------
    // Property-local today (item 27)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Property_local_today_is_correct_for_a_pinned_time_provider()
    {
        await factory.ResetDatabaseAsync();
        // 2026-09-01T17:30:00Z is 2026-09-02T00:30 in Asia/Ho_Chi_Minh (UTC+7) —
        // a date-crossing instant, so this genuinely exercises timezone conversion
        // rather than incidentally matching the UTC date.
        factory.Clock.UtcNow = DateTimeOffset.Parse("2026-09-01T17:30:00Z");
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "local-today");
        using var client = CreateHttpsClient(factory);

        var board = await client.GetFromJsonAsync<JsonElement>(
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));

        Assert.Equal("2026-09-02", board.GetProperty("property").GetProperty("localToday").GetString());
    }

    // ---------------------------------------------------------------
    // PII omission (item 28)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Response_omits_guest_pii_and_internal_identifiers()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "pii");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 5);
        await CreateReservationAsync(context, fixture, fixture.Standard.Id, from, from.AddDays(2), "pii");
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var response = await client.GetAsync(BoardUrl(fixture.Property.Id, from, to));
        var payload = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain("email", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("phone", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("guestAccessToken", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("customerAccountId", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("sourceHoldId", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("actorReference", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("authorizationEvidence", payload, StringComparison.OrdinalIgnoreCase);
    }

    // ---------------------------------------------------------------
    // Cache-Control / CORS (items 30-33)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Response_sends_cache_control_no_store_on_success_and_error()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        using var client = CreateHttpsClient(factory);

        var notFound = await client.GetAsync(
            BoardUrl(Guid.NewGuid(), new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));

        Assert.Equal("no-store", notFound.Headers.CacheControl?.ToString());
    }

    // PMS-CAL-001.1 correction C3: Cache-Control: no-store must be set as the
    // very first thing the resource filter does, before the gate check, so it
    // also covers an automatic [ApiController] validation response (missing/
    // malformed from or to) — which short-circuits before the action's own
    // Response.Headers.CacheControl line ever runs. Covers every combination
    // of gate state and outcome the correction prompt requires.
    [Fact]
    public async Task Response_always_sets_cache_control_no_store_regardless_of_gate_or_validation_outcome()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "no-store");
        using var enabledClient = CreateHttpsClient(factory);
        await using var gatedFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
                services.Configure<AdminCalendarOptions>(options => options.EnableUnauthenticatedRead = false)));
        using var disabledClient = CreateHttpsClient(gatedFactory);

        var propertyId = fixture.Property.Id;
        var validUrl = BoardUrl(propertyId, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3));
        var missingBothUrl = $"/api/admin/v1/properties/{propertyId}/reservation-board";
        var missingFromUrl = $"/api/admin/v1/properties/{propertyId}/reservation-board?to=2026-09-03";
        var missingToUrl = $"/api/admin/v1/properties/{propertyId}/reservation-board?from=2026-09-01";
        var malformedFromUrl = $"/api/admin/v1/properties/{propertyId}/reservation-board?from=not-a-date&to=2026-09-03";
        var malformedToUrl = $"/api/admin/v1/properties/{propertyId}/reservation-board?from=2026-09-01&to=not-a-date";
        var equalDatesUrl = BoardUrl(propertyId, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 1));
        var propertyNotFoundUrl = BoardUrl(Guid.NewGuid(), new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3));

        var cases = new (string Name, HttpClient Client, string Url)[]
        {
            ("gate-disabled-valid", disabledClient, validUrl),
            ("gate-disabled-missing-both", disabledClient, missingBothUrl),
            ("gate-enabled-success", enabledClient, validUrl),
            ("gate-enabled-missing-from", enabledClient, missingFromUrl),
            ("gate-enabled-missing-to", enabledClient, missingToUrl),
            ("gate-enabled-malformed-from", enabledClient, malformedFromUrl),
            ("gate-enabled-malformed-to", enabledClient, malformedToUrl),
            ("gate-enabled-equal-dates-app-400", enabledClient, equalDatesUrl),
            ("gate-enabled-property-not-found-404", enabledClient, propertyNotFoundUrl),
        };

        foreach (var (name, client, url) in cases)
        {
            var response = await client.GetAsync(url);
            Assert.True(
                "no-store" == response.Headers.CacheControl?.ToString(),
                $"case '{name}' expected Cache-Control: no-store, got '{response.Headers.CacheControl}'");
        }
    }

    [Fact]
    public async Task Explicit_https_admin_origin_is_allowed_and_unapproved_origin_is_not()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "cors");
        using var client = CreateHttpsClient(factory);
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 3);

        using var allowedRequest = new HttpRequestMessage(HttpMethod.Get, BoardUrl(fixture.Property.Id, from, to));
        allowedRequest.Headers.Add("Origin", "https://localhost:3001");
        var allowedResponse = await client.SendAsync(allowedRequest);

        using var unapprovedRequest = new HttpRequestMessage(HttpMethod.Get, BoardUrl(fixture.Property.Id, from, to));
        unapprovedRequest.Headers.Add("Origin", "https://evil.example");
        var unapprovedResponse = await client.SendAsync(unapprovedRequest);

        Assert.Equal(
            "https://localhost:3001",
            Assert.Single(allowedResponse.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(unapprovedResponse.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.DoesNotContain("*", allowedResponse.Headers.GetValues("Access-Control-Allow-Origin"));
    }

    // ---------------------------------------------------------------
    // Unauthenticated-read gate (items 34-35)
    // ---------------------------------------------------------------

    // PMS-CAL-001.1 correction C2: with the gate disabled, every request
    // matching this action — valid, missing, malformed, or otherwise
    // rejectable by the query's own validation — must return the exact same
    // unavailable 404 shape (status/title/type identical, no field-level
    // "errors" leaking which of from/to failed), proving the gate now runs
    // before model binding/automatic [ApiController] validation rather than
    // inside the action (where a malformed request reached automatic
    // validation first and returned a distinguishable 400).
    [Fact]
    public async Task Endpoint_returns_an_identically_shaped_404_when_the_gate_is_disabled_regardless_of_query_validity()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var gatedFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
                services.Configure<AdminCalendarOptions>(options => options.EnableUnauthenticatedRead = false)));
        using var client = CreateHttpsClient(gatedFactory);

        var cases = new (string Name, string? From, string? To)[]
        {
            ("valid", "2026-09-01", "2026-09-03"),
            ("missing-from", null, "2026-09-03"),
            ("missing-to", "2026-09-01", null),
            ("missing-both", null, null),
            ("malformed-from", "not-a-date", "2026-09-03"),
            ("malformed-to", "2026-09-01", "not-a-date"),
            ("equal-dates", "2026-09-01", "2026-09-01"),
            ("reversed-dates", "2026-09-05", "2026-09-01"),
            ("over-31-nights", "2026-09-01", "2026-10-15"),
        };

        (string? Type, string? Title, string? Status) baseline = default;
        foreach (var (name, from, to) in cases)
        {
            var query = new List<string>();
            if (from is not null) query.Add($"from={from}");
            if (to is not null) query.Add($"to={to}");
            var url = $"/api/admin/v1/properties/{Guid.NewGuid()}/reservation-board"
                + (query.Count > 0 ? "?" + string.Join('&', query) : string.Empty);

            var response = await client.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();

            Assert.True(HttpStatusCode.NotFound == response.StatusCode, $"case '{name}' expected 404, got {response.StatusCode}");
            Assert.DoesNotContain("\"errors\"", body, StringComparison.Ordinal);

            string? currentType = null;
            string? currentTitle = null;
            string? currentStatus = null;
            if (!string.IsNullOrEmpty(body))
            {
                using var document = JsonDocument.Parse(body);
                var root = document.RootElement;
                currentType = root.TryGetProperty("type", out var type) ? type.ToString() : null;
                currentTitle = root.TryGetProperty("title", out var title) ? title.ToString() : null;
                currentStatus = root.TryGetProperty("status", out var status) ? status.ToString() : null;
            }

            if (name == "valid")
            {
                baseline = (currentType, currentTitle, currentStatus);
            }
            else
            {
                Assert.Equal(baseline.Type, currentType);
                Assert.Equal(baseline.Title, currentTitle);
                Assert.Equal(baseline.Status, currentStatus);
            }
        }
    }

    // ---------------------------------------------------------------
    // Consistent-snapshot projection (correction C4)
    // ---------------------------------------------------------------

    /// <summary>
    /// Mirrors <c>ReservationBoardDataLoader.CandidateUnitsQueryTag</c> (internal to
    /// TheBha.Infrastructure). The loader's comment records that this test depends on it.
    /// </summary>
    private const string CandidateUnitsQueryTag = "pms-cal-001.1-reservation-board-candidate-units";

    /// <summary>Failure guard only — never used to create the interleaving, which is barrier-driven.</summary>
    private static readonly TimeSpan BarrierTimeout = TimeSpan.FromSeconds(60);

    // PMS-CAL-001.1 correction C4: the projection issues several queries. Under
    // READ COMMITTED each took its own snapshot, so a Reservation cancellation
    // committing between the candidate-Unit query and the assignment query made
    // the board report a cancelled stay as FullyUnassigned — a state that never
    // existed. This forces exactly that interleaving with a command-interceptor
    // barrier (no sleeps, no retry loops) and asserts the read stays coherent.
    [Fact]
    public async Task Board_read_stays_on_one_snapshot_when_a_cancellation_commits_mid_projection()
    {
        await factory.ResetDatabaseAsync();
        // ReservationCancellationStore enforces Reservation.Cancel's check-in cutoff
        // against the DI clock, so this must stay pinned before the fixture's check-in.
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "snapshot-race");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 4);
        var (reservation, units) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, from, to, "snapshot-race");
        context.Add(Assignment(fixture, fixture.StandardRooms[0], units[0], from, to));
        await context.SaveChangesAsync();

        // Re-register the same Npgsql context the API uses, adding only the barrier
        // interceptor — the production registration is otherwise untouched, and this
        // exists solely inside this test-scoped factory.
        var barrier = new ReservationBoardSnapshotBarrierInterceptor(CandidateUnitsQueryTag);
        await using var barrierFactory = factory.WithWebHostBuilder(builder =>
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
        using var client = CreateHttpsClient(barrierFactory);

        // 1-3. Start the board read and let it pause immediately after the
        // candidate-Unit query, before the Unit/night/assignment queries.
        var boardRequest = client.GetAsync(BoardUrl(fixture.Property.Id, from, to));
        await barrier.Reached.WaitAsync(BarrierTimeout);

        // 4-5. Atomically cancel the Reservation and its Effective assignment
        // segments on a separate connection, through the real cancellation
        // boundary, and commit while the board read is still paused.
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var cancellationStore = scope.ServiceProvider.GetRequiredService<IReservationCancellationStore>();
            var cancellation = await cancellationStore.CancelAsync(
                reservation.Id,
                null,
                reservation.GuestAccessTokenHash,
                "Snapshot-race regression",
                CancellationToken.None);
            Assert.Equal(ReservationCancellationStatus.Cancelled, cancellation.Status);
        }

        // 6-7. Resume the read and inspect what that single request observed.
        barrier.Release();
        var response = await boardRequest.WaitAsync(BarrierTimeout);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var board = await response.Content.ReadFromJsonAsync<JsonElement>();
        var stays = board.GetProperty("stays").EnumerateArray().ToArray();

        // The in-flight read must return one coherent pre-cancellation snapshot:
        // the stay is present *with* its Effective assignment, never fabricated as
        // a current fully-unassigned stay for an already-cancelled commitment.
        var stay = Assert.Single(stays);
        Assert.Equal(units[0].Id, stay.GetProperty("reservationUnitId").GetGuid());
        Assert.Equal("FullyAssigned", stay.GetProperty("coverageStatus").GetString());
        Assert.NotEqual("FullyUnassigned", stay.GetProperty("coverageStatus").GetString());
        Assert.Single(stay.GetProperty("assignments").EnumerateArray());
        Assert.Empty(stay.GetProperty("unassignedRanges").EnumerateArray());

        // 8. A fresh request after the cancellation commit sees it gone entirely.
        var afterResponse = await client.GetAsync(BoardUrl(fixture.Property.Id, from, to));
        Assert.Equal(HttpStatusCode.OK, afterResponse.StatusCode);
        var afterBoard = await afterResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(afterBoard.GetProperty("stays").EnumerateArray());

        // The read itself mutated nothing: the cancellation above is the only
        // state change, and it came from the cancellation boundary, not the board.
        await using var verify = factory.CreateDbContext();
        Assert.Equal(
            CommitmentStatus.Cancelled,
            await verify.ReservationUnits.Where(unit => unit.Id == units[0].Id)
                .Select(unit => unit.CommitmentStatus).SingleAsync());
        Assert.Equal(
            1,
            await verify.RoomOccupancySegments.CountAsync(segment =>
                segment.ReservationUnitId == units[0].Id &&
                segment.Status == RoomOccupancySegmentStatus.Cancelled));
    }

    [Fact]
    public async Task Disabling_the_gate_does_not_affect_an_unrelated_route()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context).SeedAsync(CancellationToken.None);
        await using var gatedFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
                services.Configure<AdminCalendarOptions>(options => options.EnableUnauthenticatedRead = false)));
        using var client = CreateHttpsClient(gatedFactory);

        var response = await client.GetAsync("/api/v1/properties");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEqual("no-store", response.Headers.CacheControl?.ToString());
    }

    // ---------------------------------------------------------------
    // Transport fail-closed gate (correction C7)
    // ---------------------------------------------------------------

    // PMS-CAL-001.1 correction C7: app.UseHttpsRedirection() does not by itself
    // refuse cleartext. On an HTTP-only host it cannot discover an HTTPS port,
    // logs a warning and passes the request through — which is exactly the
    // situation TestServer reproduces, since it exposes no server addresses. In
    // Development the unauthenticated read is enabled, so without a transport
    // check a direct HTTP client could read guest names, confirmation numbers
    // and stay dates in the clear. Every cleartext request must therefore get
    // the same unavailable 404, whatever its query looks like.
    [Fact]
    public async Task Cleartext_http_requests_are_uniformly_unavailable_and_never_reach_the_board_query()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "http-transport");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 3);
        var (_, units) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, from, to, "http-transport");
        context.Add(Assignment(fixture, fixture.StandardRooms[0], units[0], from, to));
        await context.SaveChangesAsync();

        var spy = new RecordingReservationBoardQuery();
        await using var spyFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services => services.AddScoped<IReservationBoardQuery>(_ => spy)));

        // Default BaseAddress is http://localhost — a genuine cleartext request
        // on a host with no HTTPS listener. Redirects are never followed, so a
        // redirect could never be mistaken for a successful read.
        using var httpClient = spyFactory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });
        Assert.Equal("http", httpClient.BaseAddress!.Scheme);

        var baseUrl = $"/api/admin/v1/properties/{fixture.Property.Id}/reservation-board";
        var cases = new (string Name, string Url)[]
        {
            ("valid", $"{baseUrl}?from=2026-09-01&to=2026-09-03"),
            ("missing-from", $"{baseUrl}?to=2026-09-03"),
            ("missing-to", $"{baseUrl}?from=2026-09-01"),
            ("missing-both", baseUrl),
            ("malformed-from", $"{baseUrl}?from=not-a-date&to=2026-09-03"),
            ("malformed-to", $"{baseUrl}?from=2026-09-01&to=not-a-date"),
            ("equal-dates", $"{baseUrl}?from=2026-09-01&to=2026-09-01"),
            ("reversed-dates", $"{baseUrl}?from=2026-09-05&to=2026-09-01"),
        };

        (string? Type, string? Title, string? Status) baseline = default;
        foreach (var (name, url) in cases)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            Assert.False(request.Headers.Contains("Origin")); // CORS protects browsers only
            var response = await httpClient.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            Assert.True(
                HttpStatusCode.NotFound == response.StatusCode,
                $"case '{name}' expected 404 over cleartext, got {response.StatusCode}");
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());

            // No board shape, no guest data, and no model-validation detail that
            // would distinguish a valid request from a malformed one.
            foreach (var leak in new[]
                     {
                         "guestDisplayName", "confirmationNumber", "stays", "physicalRooms",
                         "roomTypes", "operationalBlocks", "\"errors\""
                     })
            {
                Assert.DoesNotContain(leak, body, StringComparison.OrdinalIgnoreCase);
            }

            string? type = null, title = null, status = null;
            if (!string.IsNullOrEmpty(body))
            {
                using var document = JsonDocument.Parse(body);
                var root = document.RootElement;
                type = root.TryGetProperty("type", out var t) ? t.ToString() : null;
                title = root.TryGetProperty("title", out var ti) ? ti.ToString() : null;
                status = root.TryGetProperty("status", out var st) ? st.ToString() : null;
            }

            if (name == "valid")
            {
                baseline = (type, title, status);
            }
            else
            {
                Assert.Equal(baseline.Type, type);
                Assert.Equal(baseline.Title, title);
                Assert.Equal(baseline.Status, status);
            }
        }

        // The action, the query and therefore persistence were never reached.
        Assert.Equal(0, spy.Invocations);
    }

    // Headers a caller can write themselves must never stand in for a real TLS
    // connection. Request.IsHttps reflects the server's own view of the
    // connection, and C7 deliberately adds no forwarded-header handling.
    [Fact]
    public async Task Spoofed_origin_or_forwarded_proto_headers_do_not_satisfy_the_transport_gate()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "http-spoof");

        var spy = new RecordingReservationBoardQuery();
        await using var spyFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services => services.AddScoped<IReservationBoardQuery>(_ => spy)));
        using var httpClient = spyFactory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        using var spoofed = new HttpRequestMessage(
            HttpMethod.Get,
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
        spoofed.Headers.Add("Origin", "https://localhost:3001");
        spoofed.Headers.Add("X-Forwarded-Proto", "https");
        spoofed.Headers.Add("X-Forwarded-Scheme", "https");
        var response = await httpClient.SendAsync(spoofed);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.DoesNotContain("guestDisplayName", body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, spy.Invocations);
    }

    // The counterpart: over HTTPS the gate is open exactly as before, so the
    // transport check cannot be passing the suite by blocking everything.
    [Fact]
    public async Task Https_requests_still_reach_the_board_query_and_keep_their_validation_contract()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "https-transport");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 3);
        var (_, units) = await CreateReservationAsync(
            context, fixture, fixture.Standard.Id, from, to, "https-transport");
        context.Add(Assignment(fixture, fixture.StandardRooms[0], units[0], from, to));
        await context.SaveChangesAsync();
        using var client = CreateHttpsClient(factory);

        var ok = await client.GetAsync(BoardUrl(fixture.Property.Id, from, to));
        var board = await ok.Content.ReadFromJsonAsync<JsonElement>();
        var invalid = await client.GetAsync(
            $"/api/admin/v1/properties/{fixture.Property.Id}/reservation-board?from=2026-09-01&to=not-a-date");

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("no-store", ok.Headers.CacheControl?.ToString());
        Assert.Single(board.GetProperty("stays").EnumerateArray());
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("no-store", invalid.Headers.CacheControl?.ToString());
    }

    // ---------------------------------------------------------------
    // Environment fail-closed gate (correction C5)
    // ---------------------------------------------------------------

    /// <summary>
    /// Stands in for the real board query so a blocked request can be proven to
    /// never reach the Application/persistence layer at all. If the gate ever
    /// leaked, this returns unmistakable sentinel guest data instead of a real
    /// board, so the failure is loud rather than subtle.
    /// </summary>
    private sealed class RecordingReservationBoardQuery : IReservationBoardQuery
    {
        public const string SentinelGuest = "LEAKED-GUEST-NAME";
        public const string SentinelConfirmation = "LEAKED-CONFIRMATION";

        private int _invocations;
        public int Invocations => Volatile.Read(ref _invocations);

        public Task<ReservationBoardResult> GetBoardAsync(
            Guid propertyId, DateOnly from, DateOnly to, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _invocations);
            return Task.FromResult(ReservationBoardResult.Success(new ReservationBoardDto(
                new ReservationBoardPropertyDto(
                    propertyId, "LEAKED PROPERTY", "Asia/Ho_Chi_Minh", from, new TimeOnly(14, 0), new TimeOnly(12, 0)),
                from,
                to,
                Array.Empty<ReservationBoardRoomTypeDto>(),
                Array.Empty<ReservationBoardPhysicalRoomDto>(),
                new[]
                {
                    new ReservationBoardStayDto(
                        Guid.NewGuid(), Guid.NewGuid(), SentinelConfirmation, SentinelGuest, Guid.NewGuid(),
                        from, to, StayCoverageStatus.FullyUnassigned,
                        Array.Empty<ReservationBoardAssignmentDto>(),
                        Array.Empty<ReservationBoardUnassignedRangeDto>())
                },
                Array.Empty<ReservationBoardOperationalBlockDto>())));
        }
    }

    /// <summary>
    /// A real host for a non-Development environment, still pointed at the real
    /// test database, with the board query replaced by a recording spy.
    /// Production additionally requires a DataProtection key path to boot.
    /// </summary>
    private WebApplicationFactory<Program> CreateNonDevelopmentFactory(
        string environment,
        RecordingReservationBoardQuery spy,
        string dataProtectionKeysPath,
        bool enableGateAtStartup = false) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("DataProtection:KeysPath", dataProtectionKeysPath);
            if (enableGateAtStartup)
            {
                builder.UseSetting("AdminCalendar:EnableUnauthenticatedRead", "true");
            }

            builder.ConfigureServices(services =>
                services.AddScoped<IReservationBoardQuery>(_ => spy));
        });

    private static string CreateDataProtectionKeysPath()
    {
        var path = Path.Combine(Path.GetTempPath(), "thebha-c5-keys", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    // PMS-CAL-001.1 correction C5 — the exact Codex P1 exploit. Program.cs's
    // startup guard binds one configuration snapshot, but IOptions<T> is
    // materialized lazily, on the first Reservation Board request. A reloadable
    // configuration source could therefore be flipped to true *after* that
    // guard had already passed, and the pre-C5 filter would have honoured the
    // late value and served guest data from a Production host. The gate is now
    // environment-first, so the late value cannot matter.
    [Fact]
    public async Task Production_gate_enabled_after_startup_still_returns_the_unavailable_404_without_reaching_the_board_query()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "prod-late-enable");
        var from = new DateOnly(2026, 9, 1);
        var to = new DateOnly(2026, 9, 3);

        var spy = new RecordingReservationBoardQuery();
        var keysPath = CreateDataProtectionKeysPath();
        try
        {
            await using var productionFactory = CreateNonDevelopmentFactory("Production", spy, keysPath);

            // 1-2. Boot a real Production host while the flag is still false, so
            //      the startup guard passes on the snapshot it binds.
            var services = productionFactory.Services;
            // Guard the guard: prove this host really is Production, so a later
            // change to how the environment is applied can never quietly turn
            // this into a Development test that passes for the wrong reason.
            Assert.Equal("Production", services.GetRequiredService<IHostEnvironment>().EnvironmentName);
            var configuration = services.GetRequiredService<IConfiguration>();
            Assert.Equal("False", configuration["AdminCalendar:EnableUnauthenticatedRead"], ignoreCase: true);

            // 3. Deterministically supply the later value, before the filter's
            //    IOptions<T>.Value has ever been materialized, and prove the
            //    option really does bind true — this is exactly what the pre-C5
            //    filter read and acted on.
            configuration["AdminCalendar:EnableUnauthenticatedRead"] = "true";
            Assert.True(services.GetRequiredService<IOptions<AdminCalendarOptions>>()
                .Value.EnableUnauthenticatedRead);

            // 4. A direct client with no Origin header — CORS restricts browsers,
            //    never curl or a server-to-server caller.
            using var client = CreateHttpsClient(productionFactory);
            using var request = new HttpRequestMessage(HttpMethod.Get, BoardUrl(fixture.Property.Id, from, to));
            Assert.False(request.Headers.Contains("Origin"));
            var response = await client.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            // 5. Unavailable, non-cacheable, and the query/action never ran.
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            Assert.Equal(0, spy.Invocations);
            Assert.DoesNotContain(RecordingReservationBoardQuery.SentinelGuest, body, StringComparison.Ordinal);
            Assert.DoesNotContain(RecordingReservationBoardQuery.SentinelConfirmation, body, StringComparison.Ordinal);
            Assert.DoesNotContain("guestDisplayName", body, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Directory.Delete(keysPath, recursive: true);
        }
    }

    [Fact]
    public async Task A_non_production_non_development_environment_with_the_gate_enabled_still_returns_the_unavailable_404()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "staging-gate");

        var spy = new RecordingReservationBoardQuery();
        var keysPath = CreateDataProtectionKeysPath();
        try
        {
            // Staging is not Production, so the startup guard deliberately does
            // not fire — the host boots with the flag already true, and only the
            // request-time environment check keeps it closed.
            await using var stagingFactory = CreateNonDevelopmentFactory(
                "Staging", spy, keysPath, enableGateAtStartup: true);
            Assert.Equal(
                "Staging",
                stagingFactory.Services.GetRequiredService<IHostEnvironment>().EnvironmentName);
            Assert.True(stagingFactory.Services.GetRequiredService<IOptions<AdminCalendarOptions>>()
                .Value.EnableUnauthenticatedRead);
            using var client = CreateHttpsClient(stagingFactory);

            var response = await client.GetAsync(
                BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
            var body = await response.Content.ReadAsStringAsync();

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            Assert.Equal(0, spy.Invocations);
            Assert.DoesNotContain(RecordingReservationBoardQuery.SentinelGuest, body, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(keysPath, recursive: true);
        }
    }

    [Fact]
    public async Task Production_with_the_gate_off_is_uniformly_unavailable_and_leaves_an_unrelated_route_alone()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context).SeedAsync(CancellationToken.None);
        var propertyId = await context.Properties.Select(property => property.Id).FirstAsync();

        var spy = new RecordingReservationBoardQuery();
        var keysPath = CreateDataProtectionKeysPath();
        try
        {
            await using var productionFactory = CreateNonDevelopmentFactory("Production", spy, keysPath);
            Assert.Equal(
                "Production",
                productionFactory.Services.GetRequiredService<IHostEnvironment>().EnvironmentName);
            using var client = CreateHttpsClient(productionFactory);
            var baseUrl = $"/api/admin/v1/properties/{propertyId}/reservation-board";

            var urls = new (string Name, string Url)[]
            {
                ("valid", $"{baseUrl}?from=2026-09-01&to=2026-09-03"),
                ("missing-both", baseUrl),
                ("malformed-from", $"{baseUrl}?from=not-a-date&to=2026-09-03"),
            };

            foreach (var (name, url) in urls)
            {
                var response = await client.GetAsync(url);
                Assert.True(
                    HttpStatusCode.NotFound == response.StatusCode,
                    $"case '{name}' expected 404, got {response.StatusCode}");
                Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            }

            Assert.Equal(0, spy.Invocations);

            // The gate is scoped to this controller only.
            var unrelated = await client.GetAsync("/api/v1/properties");
            Assert.Equal(HttpStatusCode.OK, unrelated.StatusCode);
            Assert.NotEqual("no-store", unrelated.Headers.CacheControl?.ToString());
        }
        finally
        {
            Directory.Delete(keysPath, recursive: true);
        }
    }

    [Fact]
    public async Task Development_with_the_gate_enabled_still_serves_the_board()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "dev-gate-on");
        Assert.Equal("Development", factory.Services.GetRequiredService<IHostEnvironment>().EnvironmentName);
        using var client = CreateHttpsClient(factory);

        var response = await client.GetAsync(
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
        var board = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(fixture.Property.Id, board.GetProperty("property").GetProperty("id").GetGuid());
    }

    [Fact]
    public void Production_startup_rejects_the_unauthenticated_read_gate()
    {
        using var productionFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting(
                "ConnectionStrings:TheBhaDatabase",
                "Host=localhost;Database=unused;Username=unused;Password=unused");
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedRead", "true");
            builder.UseSetting("DataProtection:KeysPath", Path.GetTempPath());
        });

        var exception = Assert.ThrowsAny<Exception>(() => productionFactory.Server);
        var root = Unwrap(exception);
        Assert.Contains("AdminCalendar:EnableUnauthenticatedRead", root.Message, StringComparison.Ordinal);

        static Exception Unwrap(Exception exception)
        {
            var current = exception;
            while (current.InnerException is not null)
            {
                current = current.InnerException;
            }

            return current;
        }
    }

    // ---------------------------------------------------------------
    // Loopback fail-closed gate (correction C9)
    // ---------------------------------------------------------------

    // PMS-CAL-001.1 correction C9: "Development" is a configuration value, not
    // a location. A process started with ASPNETCORE_ENVIRONMENT=Development on
    // a remote host, listening on a LAN/container/wildcard address, previously
    // satisfied every condition the gate had — so any HTTPS client that could
    // reach the socket could read guest names, confirmation numbers and stay
    // dates. CORS restricts browsers only, never curl or a server-to-server
    // caller. The connection's own addresses are the boundary that actually
    // means "same machine", so both ends must be loopback.
    //
    // Reserved documentation/test-net ranges are used for every synthetic
    // non-local address (RFC 5737 198.51.100.0/24, RFC 3849 2001:db8::/32) plus
    // the private and container ranges a real deployment would actually bind.

    private static readonly IPAddress PrivateLan = IPAddress.Parse("192.168.10.20");
    private static readonly IPAddress ContainerBridge = IPAddress.Parse("172.17.0.1");
    private static readonly IPAddress PublicTestNet = IPAddress.Parse("198.51.100.7");
    private static readonly IPAddress PublicTestNetV6 = IPAddress.Parse("2001:db8::1");
    private static readonly IPAddress AnyV4 = IPAddress.Parse("0.0.0.0");
    private static readonly IPAddress AnyV6 = IPAddress.Parse("::");
    private static readonly IPAddress LoopbackV4Alternate = IPAddress.Parse("127.0.0.53");
    private static readonly IPAddress LoopbackV4MappedToV6 = IPAddress.Parse("::ffff:127.0.0.1");

    /// <summary>
    /// A Development host whose connection presents the given addresses, with
    /// the board query replaced by the recording spy so "never reached" is
    /// provable rather than inferred.
    /// </summary>
    private WebApplicationFactory<Program> CreateConnectionFactory(
        IPAddress? localAddress,
        IPAddress? remoteAddress,
        RecordingReservationBoardQuery spy) =>
        factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.AddSingleton(new TestConnectionAddresses
                {
                    LocalIpAddress = localAddress,
                    RemoteIpAddress = remoteAddress,
                });
                services.AddScoped<IReservationBoardQuery>(_ => spy);
            }));

    public static TheoryData<string, string?, string?> LoopbackMatrix() => new()
    {
        // description,                local,                 remote
        { "loopback v4 / private LAN", "127.0.0.1", "192.168.10.20" },
        { "private LAN / loopback v4", "192.168.10.20", "127.0.0.1" },
        { "private LAN / private LAN", "192.168.10.20", "192.168.10.20" },
        { "container bridge / loopback", "172.17.0.1", "127.0.0.1" },
        { "loopback / public test-net", "127.0.0.1", "198.51.100.7" },
        { "public test-net / loopback", "198.51.100.7", "127.0.0.1" },
        { "loopback v6 / public v6", "::1", "2001:db8::1" },
        { "wildcard 0.0.0.0 / loopback", "0.0.0.0", "127.0.0.1" },
        { "wildcard :: / loopback", "::", "127.0.0.1" },
        { "null local / loopback", null, "127.0.0.1" },
        { "loopback / null remote", "127.0.0.1", null },
        { "null / null (TestServer default)", null, null },
    };

    [Theory]
    [MemberData(nameof(LoopbackMatrix))]
    public async Task A_non_loopback_connection_is_unavailable_and_never_reaches_the_board_query(
        string description, string? localAddress, string? remoteAddress)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, $"c9-{Guid.NewGuid():N}"[..24]);

        var spy = new RecordingReservationBoardQuery();
        await using var remoteFactory = CreateConnectionFactory(
            localAddress is null ? null : IPAddress.Parse(localAddress),
            remoteAddress is null ? null : IPAddress.Parse(remoteAddress),
            spy);

        // The environment and the flag are both satisfied: only the connection
        // differs, so a pass here cannot come from some other condition.
        Assert.Equal(
            "Development",
            remoteFactory.Services.GetRequiredService<IHostEnvironment>().EnvironmentName);
        Assert.True(
            remoteFactory.Services.GetRequiredService<IOptions<AdminCalendarOptions>>()
                .Value.EnableUnauthenticatedRead);

        using var client = CreateHttpsClient(remoteFactory);
        var response = await client.GetAsync(
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(
            response.StatusCode == HttpStatusCode.NotFound,
            $"{description}: expected 404, got {(int)response.StatusCode}");
        Assert.True(
            response.Headers.CacheControl?.ToString() == "no-store",
            $"{description}: expected no-store, got {response.Headers.CacheControl?.ToString() ?? "<none>"}");
        Assert.True(
            spy.Invocations == 0,
            $"{description}: the board query ran {spy.Invocations} time(s) for a blocked request");
        foreach (var leak in new[]
                 {
                     RecordingReservationBoardQuery.SentinelGuest,
                     RecordingReservationBoardQuery.SentinelConfirmation,
                     "guestDisplayName", "confirmationNumber", "stays", "physicalRooms",
                     "roomTypes", "operationalBlocks",
                 })
        {
            Assert.True(
                !body.Contains(leak, StringComparison.Ordinal),
                $"{description}: response leaked '{leak}'");
        }
    }

    [Fact]
    public async Task A_non_loopback_connection_is_uniformly_unavailable_whatever_the_query_looks_like()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "c9-uniform");

        var spy = new RecordingReservationBoardQuery();
        await using var remoteFactory = CreateConnectionFactory(PrivateLan, PrivateLan, spy);
        using var client = CreateHttpsClient(remoteFactory);

        var shapes = new List<string>();
        foreach (var (name, url) in new (string, string)[]
                 {
                     ("valid", BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3))),
                     ("missing both", $"/api/admin/v1/properties/{fixture.Property.Id}/reservation-board"),
                     ("missing to", $"/api/admin/v1/properties/{fixture.Property.Id}/reservation-board?from=2026-09-01"),
                     ("malformed from", $"/api/admin/v1/properties/{fixture.Property.Id}/reservation-board?from=nonsense&to=2026-09-03"),
                     ("equal dates", BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 1))),
                     ("reversed dates", BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 3), new DateOnly(2026, 9, 1))),
                 })
        {
            var response = await client.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            // Model binding must not have run: a malformed date would otherwise
            // produce a 400 with a validation "errors" object, which would tell
            // a prober that the endpoint exists.
            Assert.DoesNotContain("\"errors\"", body, StringComparison.Ordinal);
            Assert.DoesNotContain("guestDisplayName", body, StringComparison.Ordinal);

            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            shapes.Add(string.Join(
                '|',
                Read(root, "type"), Read(root, "title"), Read(root, "status")));
            _ = name;
        }

        // Every rejection is byte-identical apart from traceId, so the valid
        // request is indistinguishable from the malformed ones.
        Assert.Single(shapes.Distinct());
        Assert.Equal(0, spy.Invocations);

        static string Read(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) ? value.ToString() : "<absent>";
    }

    [Fact]
    public async Task Spoofed_local_headers_do_not_make_a_remote_connection_look_loopback()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "c9-spoof");

        var spy = new RecordingReservationBoardQuery();
        await using var remoteFactory = CreateConnectionFactory(PublicTestNet, PublicTestNet, spy);
        using var client = CreateHttpsClient(remoteFactory);

        var request = new HttpRequestMessage(
            HttpMethod.Get,
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
        // Everything below is caller-controlled text. None of it may stand in
        // for the socket the server actually accepted.
        request.Headers.Host = "localhost";
        request.Headers.TryAddWithoutValidation("Origin", "https://localhost:3001");
        request.Headers.TryAddWithoutValidation("Referer", "https://localhost:3001/calendar");
        request.Headers.TryAddWithoutValidation("X-Forwarded-For", "127.0.0.1");
        request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");
        request.Headers.TryAddWithoutValidation("X-Forwarded-Host", "localhost");
        request.Headers.TryAddWithoutValidation("X-Real-IP", "127.0.0.1");
        request.Headers.TryAddWithoutValidation("Forwarded", "for=127.0.0.1;host=localhost;proto=https");

        var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(0, spy.Invocations);
        Assert.DoesNotContain(RecordingReservationBoardQuery.SentinelGuest, body, StringComparison.Ordinal);
    }

    public static TheoryData<string, string> PermittedLoopbackPairs() => new()
    {
        { "127.0.0.1", "127.0.0.1" },
        { "::1", "::1" },
        { "127.0.0.53", "127.0.0.1" },          // anywhere in 127.0.0.0/8
        { "::ffff:127.0.0.1", "::ffff:127.0.0.1" }, // IPv4-mapped IPv6 loopback
        { "::1", "127.0.0.1" },                  // dual-stack listener, v4 client
    };

    [Theory]
    [MemberData(nameof(PermittedLoopbackPairs))]
    public async Task Every_loopback_representation_still_reaches_the_board(
        string localAddress, string remoteAddress)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, $"c9ok-{Guid.NewGuid():N}"[..24]);

        await using var localFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services => services.AddSingleton(new TestConnectionAddresses
            {
                LocalIpAddress = IPAddress.Parse(localAddress),
                RemoteIpAddress = IPAddress.Parse(remoteAddress),
            })));
        using var client = CreateHttpsClient(localFactory);

        var response = await client.GetAsync(
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));
        var board = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(fixture.Property.Id, board.GetProperty("property").GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task A_loopback_connection_keeps_its_validation_contract()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "c9-validation");
        using var client = CreateHttpsClient(factory);

        // A malformed range on a permitted connection must still be a 400 with
        // no-store — the loopback rule tightens who may ask, not what the
        // endpoint answers.
        var response = await client.GetAsync(
            $"/api/admin/v1/properties/{fixture.Property.Id}/reservation-board?from=nonsense&to=2026-09-03");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task A_late_configuration_flip_cannot_open_a_non_loopback_connection()
    {
        // The C5 property, restated for the connection boundary: IOptions is
        // materialized lazily, so a reloadable source could turn the flag on
        // after startup. The connection is checked before the flag is ever
        // read, so a late flip changes nothing for a remote caller.
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "c9-late-flip");

        var spy = new RecordingReservationBoardQuery();
        await using var remoteFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.AddSingleton(new TestConnectionAddresses
                {
                    LocalIpAddress = ContainerBridge,
                    RemoteIpAddress = PublicTestNetV6,
                });
                services.AddScoped<IReservationBoardQuery>(_ => spy);
                services.Configure<AdminCalendarOptions>(options =>
                    options.EnableUnauthenticatedRead = true);
            }));
        using var client = CreateHttpsClient(remoteFactory);

        var response = await client.GetAsync(
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(0, spy.Invocations);
    }

    // ---------------------------------------------------------------
    // Default-closed configuration (correction C9)
    // ---------------------------------------------------------------

    [Fact]
    public void Development_configuration_does_not_enable_the_board_on_its_own()
    {
        // The checked-in Development configuration used to turn the
        // unauthenticated read on, so ASPNETCORE_ENVIRONMENT=Development was by
        // itself enough to expose it. It must now be closed by default, with
        // the local launch profile as the only supported opt-in.
        var configuration = new ConfigurationBuilder()
            .SetBasePath(ApiContentRoot())
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.Development.json", optional: false)
            .Build();

        Assert.False(
            configuration.GetSection(AdminCalendarOptions.SectionName)
                .Get<AdminCalendarOptions>()?.EnableUnauthenticatedRead ?? false);
    }

    [Fact]
    public void Only_the_local_https_launch_profile_opts_into_the_unauthenticated_board()
    {
        using var document = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(ApiContentRoot(), "Properties", "launchSettings.json")));
        var profiles = document.RootElement.GetProperty("profiles");

        const string OptInKey = "AdminCalendar__EnableUnauthenticatedRead";

        var https = profiles.GetProperty("https");
        Assert.Equal(
            "true",
            https.GetProperty("environmentVariables").GetProperty(OptInKey).GetString());

        // …and it must stay bound to localhost. A wildcard or external binding
        // would put the opt-in on a reachable interface, which is exactly the
        // shape this correction exists to prevent.
        var applicationUrl = https.GetProperty("applicationUrl").GetString() ?? string.Empty;
        Assert.NotEmpty(applicationUrl);
        foreach (var url in applicationUrl.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            Assert.Equal("localhost", new Uri(url).Host);
        }

        // No other profile opts in — notably not the HTTP-only one.
        foreach (var profile in profiles.EnumerateObject().Where(entry => entry.Name != "https"))
        {
            if (profile.Value.TryGetProperty("environmentVariables", out var variables))
            {
                Assert.False(variables.TryGetProperty(OptInKey, out _), profile.Name);
            }
        }
    }

    private static string ApiContentRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && directory.GetDirectories("Back_End").Length == 0)
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "Back_End", "src", "TheBha.Api");
    }

    // ---------------------------------------------------------------
    // Fixture helpers
    // ---------------------------------------------------------------

    private static async Task<PropertyFixture> CreatePropertyAsync(TheBhaDbContext context, string slug)
    {
        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var standard = new RoomType(
            Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}-STD", "Standard", $"{slug}-std", null, 2, 4, true, Now);
        var deluxe = new RoomType(
            Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}-DLX", "Deluxe", $"{slug}-dlx", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(
            Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, null, "VND", true, Now);
        context.AddRange(property, standard, deluxe, ratePlan);

        var standardRooms = new List<PhysicalRoom>
        {
            new(Guid.NewGuid(), property.Id, standard, $"{slug}-S1", 1, OperationalStatus.Active, Now),
            new(Guid.NewGuid(), property.Id, standard, $"{slug}-S2", 1, OperationalStatus.Active, Now)
        };
        var deluxeRooms = new List<PhysicalRoom>
        {
            new(Guid.NewGuid(), property.Id, deluxe, $"{slug}-D1", 2, OperationalStatus.Active, Now)
        };
        context.AddRange(standardRooms);
        context.AddRange(deluxeRooms);

        await context.SaveChangesAsync();
        return new PropertyFixture(property, standard, deluxe, standardRooms, deluxeRooms, ratePlan.Id);
    }

    private static async Task<(Reservation Reservation, List<ReservationUnit> Units)> CreateReservationAsync(
        TheBhaDbContext context,
        PropertyFixture fixture,
        Guid roomTypeId,
        DateOnly checkIn,
        DateOnly checkOut,
        string slug)
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

    private static RoomOccupancySegment Assignment(
        PropertyFixture fixture, PhysicalRoom room, ReservationUnit unit, DateOnly start, DateOnly end) =>
        new(Guid.NewGuid(), fixture.Property.Id, room.Id, RoomOccupancySegmentType.ReservationAssignment, start, end, unit.Id, null, Now);

    private static RoomOccupancySegment Block(
        PropertyFixture fixture, PhysicalRoom room, RoomBlock block, DateOnly start, DateOnly end) =>
        new(Guid.NewGuid(), fixture.Property.Id, room.Id, RoomOccupancySegmentType.OperationalBlock, start, end, null, block.Id, Now);

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record PropertyFixture(
        Property Property,
        RoomType Standard,
        RoomType Deluxe,
        List<PhysicalRoom> StandardRooms,
        List<PhysicalRoom> DeluxeRooms,
        Guid RatePlanId);
}
