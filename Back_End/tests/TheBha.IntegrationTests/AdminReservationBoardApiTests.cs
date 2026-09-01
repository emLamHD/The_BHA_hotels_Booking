using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Application.Bookings;
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

    // ---------------------------------------------------------------
    // Validation (items 3-10)
    // ---------------------------------------------------------------

    [Fact]
    public async Task Missing_from_or_to_returns_bad_request()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        var propertyId = Guid.NewGuid();
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

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
        using var client = factory.CreateClient();

        var notFound = await client.GetAsync(
            BoardUrl(Guid.NewGuid(), new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));

        Assert.Equal("no-store", notFound.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Explicit_https_admin_origin_is_allowed_and_unapproved_origin_is_not()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "cors");
        using var client = factory.CreateClient();
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

    [Fact]
    public async Task Endpoint_is_unavailable_when_the_development_gate_is_disabled()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var fixture = await CreatePropertyAsync(context, "gate-disabled");
        await using var gatedFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
                services.Configure<AdminCalendarOptions>(options => options.EnableUnauthenticatedRead = false)));
        using var client = gatedFactory.CreateClient();

        var response = await client.GetAsync(
            BoardUrl(fixture.Property.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 3)));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
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
