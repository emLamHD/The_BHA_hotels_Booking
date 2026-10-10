using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Controllers;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP05: Staff authorization of the five Admin Calendar writes, the conditional
/// cross-RoomType permission, and the audit actor/evidence taken from the authenticated Staff
/// member (D8) — against real PostgreSQL, Staff from the CP02 CLI, sessions from the CP03 routes.
/// Counting store spies prove a refused request never reaches the store; real stores prove what
/// the audit rows say.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StaffCalendarWriteAuthorizationTests(PostgreSqlWebApplicationFactory factory)
{
    private const string AdminOrigin = "https://localhost:3001";
    private const string CustomerOrigin = "https://localhost:3000";
    private const string Desk = "desk@example.com";
    private const string Manager = "manager@example.com";
    private const string Outsider = "outsider@example.com";
    private const string LocalActor = "admin-calendar-local-development";
    private const string LocalEvidence = "local-development-write-gate:cross-room-type-confirmed";
    private static readonly string Password = $"A!a1{Guid.NewGuid():N}";
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6);
    private static readonly DateOnly BlockFrom = new(2026, 10, 1);
    private static readonly DateOnly BlockTo = new(2026, 10, 3);

    // ---------------------------------------------------------------
    // 1, 6–8. Happy paths and what the audit says
    // ---------------------------------------------------------------

    [Fact]
    public async Task A_front_desk_member_runs_all_five_writes_and_every_row_names_it()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);

        var created = await client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Standard[0]), desk));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var segment = await SegmentAsync(created);
        Assert.Equal("Effective", segment.Status);

        var moved = await client.SendAsync(Post(MoveUrl(seed.A, segment.Id), MoveBody(segment.Version, seed.Standard[1]), desk));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        var afterMove = await SegmentsAsync(moved);
        Assert.Equal(["Cancelled", "Effective"], afterMove.Select(item => item.Status).ToArray());

        var unassigned = await client.SendAsync(Post(UnassignUrl(seed.A, afterMove[1].Id), UnassignBody(afterMove[1].Version), desk));
        Assert.Equal(HttpStatusCode.OK, unassigned.StatusCode);
        Assert.Equal(["Cancelled"], (await SegmentsAsync(unassigned)).Select(item => item.Status).ToArray());

        var block = await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[2]), desk));
        Assert.Equal(HttpStatusCode.Created, block.StatusCode);
        var blockSegment = (await block.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("segment").Deserialize<RoomOccupancySegmentDto>(JsonOptions)!;
        var cancelled = await client.SendAsync(Post(CancelUrl(seed.A, blockSegment.Id), CancelBody(blockSegment.Version), desk));
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Equal("Cancelled", (await SegmentAsync(cancelled)).Status);

        var deskActor = $"staff:{await StaffIdAsync(Desk):D}";
        var audits = await AuditsAsync();
        // create 1 + move 2 (Cancelled source, Created successor) + unassign 1 + block create 1 + cancel 1.
        Assert.Equal(
            [RoomOccupancySegmentAuditEventType.Created, RoomOccupancySegmentAuditEventType.Cancelled, RoomOccupancySegmentAuditEventType.Created,
             RoomOccupancySegmentAuditEventType.Cancelled, RoomOccupancySegmentAuditEventType.Created, RoomOccupancySegmentAuditEventType.Cancelled],
            audits.Select(audit => audit.EventType).ToArray());
        Assert.All(audits, audit => Assert.Equal(deskActor, audit.ActorReference));
        Assert.All(audits, audit => Assert.Null(audit.AuthorizationEvidence));
        Assert.Equal([deskActor], await BlockCreatorsAsync());
    }

    [Fact]
    public async Task A_manager_places_cross_room_type_and_evidence_lands_only_on_cross_type_created_rows()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var manager = await LoginAsync(client, Manager);
        var desk = await LoginAsync(client, Desk);
        var managerActor = $"staff:{await StaffIdAsync(Manager):D}";
        var evidence = $"staff-rbac:Manager:{seed.A:D}:cross-room-type-confirmed";

        // Cross-type create: evidence on its Created row.
        var created = await SegmentAsync(await AssertStatusAsync(HttpStatusCode.Created,
            client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Deluxe[0], confirm: true, reason: "Upgrade"), manager))));
        Assert.Equal((managerActor, evidence), await CreatedAuditAsync(created.Id));

        // Over-confirmed move to the sold type: neither the Cancelled source nor the same-type
        // successor keeps any evidence.
        var sameType = await SegmentsAsync(await AssertStatusAsync(HttpStatusCode.OK,
            client.SendAsync(Post(MoveUrl(seed.A, created.Id), MoveBody(created.Version, seed.Standard[0], confirm: true, reason: "Back"), manager))));
        Assert.Equal((managerActor, (string?)null), await CancelledAuditAsync(created.Id));
        Assert.Equal((managerActor, (string?)null), await CreatedAuditAsync(sameType[1].Id));

        // Cross-type move: Cancelled source none, cross-type successor has it.
        var cross = await SegmentsAsync(await AssertStatusAsync(HttpStatusCode.OK,
            client.SendAsync(Post(MoveUrl(seed.A, sameType[1].Id), MoveBody(sameType[1].Version, seed.Deluxe[1], confirm: true, reason: "Upgrade again"), manager))));
        Assert.Equal((managerActor, (string?)null), await CancelledAuditAsync(sameType[1].Id));
        Assert.Equal((managerActor, evidence), await CreatedAuditAsync(cross[1].Id));

        // FrontDesk may unassign a cross-type segment: it places nobody, so it needs no cross
        // permission and records no evidence.
        await AssertStatusAsync(HttpStatusCode.OK,
            client.SendAsync(Post(UnassignUrl(seed.A, cross[1].Id), UnassignBody(cross[1].Version), desk)));
        Assert.Equal(($"staff:{await StaffIdAsync(Desk):D}", (string?)null), await CancelledAuditAsync(cross[1].Id));

        var withEvidence = (await AuditsAsync()).Where(audit => audit.AuthorizationEvidence is not null).ToArray();
        Assert.Equal(2, withEvidence.Length);
        Assert.All(withEvidence, audit => Assert.Equal(RoomOccupancySegmentAuditEventType.Created, audit.EventType));
    }

    [Fact]
    public async Task With_both_cookies_the_staff_member_is_the_actor_and_the_customer_is_nowhere()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        var customerId = await CreateCustomerAsync(host);
        using var client = CreateHttpsClient(host);
        var both = $"{await LoginAsync(client, Desk)}; {await CustomerLoginAsync(client)}";

        var created = await SegmentAsync(await AssertStatusAsync(HttpStatusCode.Created,
            client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Standard[0]), both))));
        Assert.Equal(($"staff:{await StaffIdAsync(Desk):D}", (string?)null), await CreatedAuditAsync(created.Id));
        Assert.DoesNotContain(await AuditsAsync(), audit => audit.ActorReference.Contains(customerId.ToString(), StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Spoofed_identity_in_the_body_query_or_headers_changes_nothing()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var manager = await LoginAsync(client, Manager);
        var desk = await LoginAsync(client, Desk);
        var deskId = await StaffIdAsync(Desk);
        var spoof = new { actorReference = LocalActor, authorizationEvidence = "forged", role = "Manager", staffId = deskId, staffAccountId = deskId };

        var request = Post(
            $"{CreateUrl(seed.A)}?actorReference=forged&role=Manager&staffId={deskId}",
            CreateBody(seed.Units[0], seed.Deluxe[0], confirm: true, reason: "Upgrade", extra: spoof),
            manager);
        foreach (var (name, value) in new[] { ("X-Actor-Reference", "forged"), ("X-Staff-Id", deskId.ToString()), ("X-Role", "Manager"), ("X-Authorization-Evidence", "forged") })
        {
            request.Headers.Add(name, value);
        }

        var created = await SegmentAsync(await AssertStatusAsync(HttpStatusCode.Created, client.SendAsync(request)));
        Assert.Equal(
            ($"staff:{await StaffIdAsync(Manager):D}", $"staff-rbac:Manager:{seed.A:D}:cross-room-type-confirmed"),
            await CreatedAuditAsync(created.Id));

        // A FrontDesk body that claims Manager still has FrontDesk's authority.
        await AssertForbiddenAsync(await client.SendAsync(Post(
            CreateUrl(seed.A), CreateBody(seed.Units[1], seed.Deluxe[1], confirm: true, reason: "Upgrade", extra: spoof), desk)));
        Assert.Single(await AuditsAsync());
    }

    [Fact]
    public async Task A_block_keeps_its_creator_and_each_cancel_names_its_canceller()
    {
        var seed = await SeedAsync();
        RoomOccupancySegmentDto historical;
        using (var local = CreateHost(AdminCalendarAccessMode.LocalGate, LocalWriteOn))
        {
            var block = await AssertStatusAsync(HttpStatusCode.Created,
                CreateHttpsClient(local).SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]))));
            historical = (await block.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("segment").Deserialize<RoomOccupancySegmentDto>(JsonOptions)!;
        }

        var before = await AuditsAsync();
        Assert.Equal(LocalActor, Assert.Single(before).ActorReference);

        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        var manager = await LoginAsync(client, Manager);
        var deskActor = $"staff:{await StaffIdAsync(Desk):D}";
        var managerActor = $"staff:{await StaffIdAsync(Manager):D}";

        var created = await AssertStatusAsync(HttpStatusCode.Created, client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[2]), desk)));
        var segment = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("segment").Deserialize<RoomOccupancySegmentDto>(JsonOptions)!;
        foreach (var (id, version) in new[] { (historical.Id, historical.Version), (segment.Id, segment.Version) })
        {
            await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Post(CancelUrl(seed.A, id), CancelBody(version), manager)));
        }

        Assert.Equal([LocalActor, deskActor], (await BlockCreatorsAsync()).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal((LocalActor, (string?)null), await CreatedAuditAsync(historical.Id));
        Assert.Equal((deskActor, (string?)null), await CreatedAuditAsync(segment.Id));
        Assert.Equal((managerActor, (string?)null), await CancelledAuditAsync(historical.Id));
        Assert.Equal((managerActor, (string?)null), await CancelledAuditAsync(segment.Id));
        // The historical row is untouched.
        Assert.Equivalent(before[0], (await AuditsAsync()).Single(audit => audit.Id == before[0].Id));
    }

    // ---------------------------------------------------------------
    // 2–5, 9. Refusals happen before the store
    // ---------------------------------------------------------------

    [Fact]
    public async Task Every_write_refuses_without_authority_or_boundary_before_the_store_is_called()
    {
        var seed = await SeedAsync();
        var assignments = new CountingAssignmentStore();
        var blocks = new CountingBlockStore();
        using var host = CreateHost(AdminCalendarAccessMode.Staff, builder => builder.ConfigureTestServices(services =>
        {
            services.AddScoped<IAssignmentMutationStore>(_ => assignments);
            services.AddScoped<IOperationalBlockMutationStore>(_ => blocks);
        }));
        await CreateStaffAsync(host, seed);
        await CreateCustomerAsync(host);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        var outsider = await LoginAsync(client, Outsider);
        var customer = await CustomerLoginAsync(client);
        var segment = Guid.NewGuid();
        var writes = Writes(seed.A, seed, segment);

        foreach (var (path, body) in writes)
        {
            await AssertUnauthorizedAsync(await client.SendAsync(Post(path, body)));
            await AssertUnauthorizedAsync(await client.SendAsync(Post(path, body, customer)));
            await AssertUnauthorizedAsync(await client.SendAsync(Post(path, body, $".TheBha.Staff={customer[(customer.IndexOf('=') + 1)..]}")));
            await AssertForbiddenAsync(await client.SendAsync(Post(path, body, outsider)));
            await AssertForbiddenAsync(await client.SendAsync(Post(path.Replace(seed.A.ToString(), seed.B.ToString()), body, desk)));

            foreach (var origins in new[] { Array.Empty<string>(), ["null"], [""], ["https://localhost:3001.evil.example"], ["http://localhost:3001"], [CustomerOrigin], [AdminOrigin, AdminOrigin] })
            {
                await AssertProblemAsync(await client.SendAsync(Post(path, body, desk, origins)), HttpStatusCode.Forbidden, "Origin not allowed");
                await AssertProblemAsync(await client.SendAsync(Post(path, "{not json", desk, origins)), HttpStatusCode.Forbidden, "Origin not allowed");
            }

            foreach (var contentType in new[] { null, "text/plain", "application/json; charset=utf-16", "application/x-www-form-urlencoded" })
            {
                await AssertProblemAsync(await client.SendAsync(Post(path, body, desk, contentType: contentType)), HttpStatusCode.UnsupportedMediaType, "Unsupported media type");
            }

            // With authority and a valid boundary, a malformed body is a binding error, still storeless.
            Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Post(path, "{not json", desk))).StatusCode);
        }

        // FrontDesk confirming a cross-RoomType placement — even onto a same-type room — is
        // refused before the store, for create and move.
        foreach (var (path, body) in new[]
                 {
                     (CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Standard[0], confirm: true, reason: "x")),
                     (MoveUrl(seed.A, segment), MoveBody(1, seed.Standard[0], confirm: true, reason: "x")),
                 })
        {
            await AssertForbiddenAsync(await client.SendAsync(Post(path, body, desk)));
        }

        Assert.Equal((0, 0), (assignments.Calls, blocks.Calls));

        // Positive control: the same five requests with the member's cookie reach the store.
        foreach (var (path, body) in writes)
        {
            await client.SendAsync(Post(path, body, desk));
        }

        Assert.Equal((3, 2), (assignments.Calls, blocks.Calls));
        var deskActor = $"staff:{await StaffIdAsync(Desk):D}";
        Assert.All(assignments.Actors.Concat(blocks.Actors), actor => Assert.Equal(deskActor, actor));
    }

    [Fact]
    public async Task Front_desk_confirmation_is_refused_and_an_unconfirmed_or_reasonless_cross_type_is_still_the_store_refusal()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        var manager = await LoginAsync(client, Manager);

        // FrontDesk: confirmation is a missing permission (403 Access denied), whatever the room.
        await AssertForbiddenAsync(await client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Standard[0], confirm: true, reason: "x"), desk)));
        await AssertForbiddenAsync(await client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Deluxe[0], confirm: true, reason: "x"), desk)));
        // FrontDesk without confirmation onto another type: the store's own refusal, no evidence made up.
        await AssertProblemAsync(
            await client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Deluxe[0], reason: "x"), desk)),
            HttpStatusCode.Forbidden, "Cross-RoomType confirmation required");

        var segment = await SegmentAsync(await AssertStatusAsync(HttpStatusCode.Created,
            client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Standard[0]), desk))));
        await AssertForbiddenAsync(await client.SendAsync(Post(MoveUrl(seed.A, segment.Id), MoveBody(segment.Version, seed.Deluxe[0], confirm: true, reason: "x"), desk)));
        await AssertProblemAsync(
            await client.SendAsync(Post(MoveUrl(seed.A, segment.Id), MoveBody(segment.Version, seed.Deluxe[0], reason: "x"), desk)),
            HttpStatusCode.Forbidden, "Cross-RoomType confirmation required");
        Assert.Single(await AuditsAsync());

        // Manager: confirmation reaches the store, which still needs a reason and a confirmation.
        await AssertProblemAsync(
            await client.SendAsync(Post(MoveUrl(seed.A, segment.Id), MoveBody(segment.Version, seed.Deluxe[0], confirm: true), manager)),
            HttpStatusCode.Forbidden, "Cross-RoomType confirmation required");
        await AssertProblemAsync(
            await client.SendAsync(Post(MoveUrl(seed.A, segment.Id), MoveBody(segment.Version, seed.Deluxe[0], reason: "x"), manager)),
            HttpStatusCode.Forbidden, "Cross-RoomType confirmation required");
        Assert.Single(await AuditsAsync());
        await AssertStatusAsync(HttpStatusCode.OK,
            client.SendAsync(Post(MoveUrl(seed.A, segment.Id), MoveBody(segment.Version, seed.Deluxe[0], confirm: true, reason: "Upgrade"), manager)));
        await AssertStatusAsync(HttpStatusCode.Created,
            client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[1], seed.Deluxe[1], confirm: true, reason: "Upgrade"), manager)));
    }

    // ---------------------------------------------------------------
    // 10–11. Database changes and local flags
    // ---------------------------------------------------------------

    [Fact]
    public async Task Membership_and_session_changes_apply_to_writes_on_the_next_request()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var manager = await LoginAsync(client, Manager);
        var desk = await LoginAsync(client, Desk);

        await AssertStatusAsync(HttpStatusCode.Created,
            client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Deluxe[0], confirm: true, reason: "Upgrade"), manager)));

        // Manager → FrontDesk: the cross permission goes, same-type writes stay.
        await CliAsync(host, Grant(Manager, seed.A, StaffRole.FrontDesk));
        await AssertForbiddenAsync(await client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[1], seed.Deluxe[1], confirm: true, reason: "x"), manager)));
        await AssertStatusAsync(HttpStatusCode.Created, client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[2]), manager)));

        // Removal, then a new grant.
        var deskId = await StaffIdAsync(Desk);
        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlAsync($"DELETE FROM \"StaffPropertyMemberships\" WHERE \"StaffAccountId\" = {deskId}");
        }

        await AssertForbiddenAsync(await client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[1], seed.Standard[0]), desk)));
        await CliAsync(host, Grant(Desk, seed.A, StaffRole.FrontDesk));
        await AssertStatusAsync(HttpStatusCode.Created, client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[1], seed.Standard[0]), desk)));

        await CliAsync(host, ["--staff-disable", "--email", Desk]);
        await AssertUnauthorizedAsync(await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]), desk)));
        await CliAsync(host, ["--staff-reset-password", "--email", Manager], $"B!b2{Guid.NewGuid():N}");
        await AssertUnauthorizedAsync(await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]), manager)));
    }

    [Fact]
    public async Task In_staff_mode_the_local_write_flag_and_gate_conditions_neither_open_nor_skip_staff_authorization()
    {
        var seed = await SeedAsync();
        using (var flagOn = CreateHost(AdminCalendarAccessMode.Staff, LocalWriteOn))
        {
            await CreateStaffAsync(flagOn, seed);
            using var client = CreateHttpsClient(flagOn);
            await AssertUnauthorizedAsync(await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]))));
            await AssertForbiddenAsync(await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]), await LoginAsync(client, Outsider))));
        }

        // Flag off (the default) and a LAN connection — both local-gate conditions — and a member
        // writes anyway, through the Staff boundary only.
        using var lan = CreateHost(AdminCalendarAccessMode.Staff, builder => builder.ConfigureServices(services =>
            services.AddSingleton(new TestConnectionAddresses { RemoteIpAddress = IPAddress.Parse("192.168.10.20") })));
        using var lanClient = CreateHttpsClient(lan);
        await AssertStatusAsync(HttpStatusCode.Created,
            lanClient.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]), await LoginAsync(lanClient, Desk))));
        Assert.Equal([$"staff:{await StaffIdAsync(Desk):D}"], await BlockCreatorsAsync());
    }

    [Fact]
    public async Task Local_gate_mode_keeps_anonymous_local_writes_and_their_constants_whatever_staff_cookie_is_sent()
    {
        var seed = await SeedAsync();
        using (var open = CreateHost(AdminCalendarAccessMode.LocalGate, LocalWriteOn))
        {
            await CreateStaffAsync(open, seed);
            using var client = CreateHttpsClient(open);
            var desk = await LoginAsync(client, Desk);
            var cross = await SegmentAsync(await AssertStatusAsync(HttpStatusCode.Created,
                client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Deluxe[0], confirm: true, reason: "Upgrade")))));
            Assert.Equal((LocalActor, LocalEvidence), await CreatedAuditAsync(cross.Id));

            // A Staff cookie is not an identity here: still the local actor.
            var block = await AssertStatusAsync(HttpStatusCode.Created, client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[2]), desk)));
            Assert.Equal([LocalActor], await BlockCreatorsAsync());
            var blockId = (await block.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("segment").GetProperty("id").GetGuid();
            Assert.Equal((LocalActor, (string?)null), await CreatedAuditAsync(blockId));

            // The write gate keeps its order: Origin then media type.
            await AssertProblemAsync(await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]), origins: [])), HttpStatusCode.Forbidden, "Origin not allowed");
            await AssertProblemAsync(await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]), contentType: "text/plain")), HttpStatusCode.UnsupportedMediaType, "Unsupported media type");
        }

        // Write flag off: closed, a Staff session does not open it.
        using var closed = CreateHost(AdminCalendarAccessMode.LocalGate);
        using var closedClient = CreateHttpsClient(closed);
        var response = await closedClient.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[1]), await LoginAsync(closedClient, Manager)));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Single(await BlockCreatorsAsync());
    }

    // ---------------------------------------------------------------
    // 12–14. Guard, transport, CORS and business rules
    // ---------------------------------------------------------------

    [Fact]
    public async Task Staff_writes_refuse_cleartext_get_credentialed_post_cors_and_leave_other_admin_routes_closed()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff, builder => builder.ConfigureServices(services =>
            services.Configure<HttpsRedirectionOptions>(options => options.HttpsPort = 443)));
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        using var cleartext = host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false });
        Assert.Equal(HttpStatusCode.TemporaryRedirect, (await cleartext.GetAsync("/api/v1/properties")).StatusCode);

        foreach (var (path, body) in Writes(seed.A, seed, Guid.NewGuid()))
        {
            var plain = await cleartext.SendAsync(Post(path, body, desk));
            Assert.Equal(HttpStatusCode.NotFound, plain.StatusCode);
            AssertNoStore(plain);
            Assert.False(plain.Headers.Contains("Location"));

            var preflight = await client.SendAsync(Preflight(path, AdminOrigin, "POST", "content-type"));
            Assert.Equal(AdminOrigin, Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Credentials")));
            Assert.Contains("POST", Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Methods")), StringComparison.Ordinal);
            foreach (var origin in new[] { CustomerOrigin, "https://evil.example", "null" })
            {
                Assert.False((await client.SendAsync(Preflight(path, origin, "POST", "content-type"))).Headers.Contains("Access-Control-Allow-Origin"), origin);
            }
        }

        Assert.Empty(await AuditsAsync());

        // The board keeps its GET-only Staff policy; an unconverted Admin path stays closed.
        var board = await client.SendAsync(Preflight($"/api/admin/v1/properties/{seed.A}/reservation-board", AdminOrigin, "GET"));
        Assert.DoesNotContain("POST", Assert.Single(board.Headers.GetValues("Access-Control-Allow-Methods")), StringComparison.Ordinal);
        var split = await client.SendAsync(Post($"{CreateUrl(seed.A)}/{Guid.NewGuid()}/split", "{}", desk));
        Assert.Equal(HttpStatusCode.NotFound, split.StatusCode);
        Assert.False(split.Headers.Contains("Access-Control-Allow-Origin"));

        // LocalGate keeps the uncredentialed legacy write policy.
        using var local = CreateHost(AdminCalendarAccessMode.LocalGate, LocalWriteOn);
        var localPreflight = await CreateHttpsClient(local).SendAsync(Preflight(BlockUrl(seed.A), AdminOrigin, "POST", "content-type"));
        Assert.Equal(AdminOrigin, Assert.Single(localPreflight.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(localPreflight.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task Business_rules_versions_and_property_isolation_hold_for_staff_writes()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        var outsider = await LoginAsync(client, Outsider);

        var segment = await SegmentAsync(await AssertStatusAsync(HttpStatusCode.Created,
            client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[0], seed.Standard[0]), desk))));
        await AssertProblemAsync(await client.SendAsync(Post(MoveUrl(seed.A, segment.Id), MoveBody(segment.Version + 7, seed.Standard[1]), desk)), HttpStatusCode.Conflict, "Assignment conflict");
        await AssertProblemAsync(await client.SendAsync(Post(MoveUrl(seed.A, Guid.NewGuid()), MoveBody(1, seed.Standard[1]), desk)), HttpStatusCode.NotFound, "Assignment target not found");
        await AssertProblemAsync(await client.SendAsync(Post(CreateUrl(seed.A), CreateBody(seed.Units[1], seed.Standard[1], start: CheckOut, end: CheckIn), desk)), HttpStatusCode.BadRequest, "Invalid assignment request");
        await AssertProblemAsync(
            await client.SendAsync(Post(BlockUrl(seed.A), BlockBody(seed.Standard[2], BlockFrom, BlockFrom.AddDays(367)), desk)),
            HttpStatusCode.BadRequest, "Invalid operational block request");

        // B's own segment, through A's route by A's member, and A's segment by B's member through B's
        // route: the store's Property isolation answers 404.
        var other = await SegmentAsync(await AssertStatusAsync(HttpStatusCode.Created,
            client.SendAsync(Post(CreateUrl(seed.B), CreateBody(seed.UnitB, seed.RoomB), outsider))));
        await AssertProblemAsync(await client.SendAsync(Post(UnassignUrl(seed.A, other.Id), UnassignBody(other.Version), desk)), HttpStatusCode.NotFound, "Assignment target not found");
        await AssertProblemAsync(await client.SendAsync(Post(UnassignUrl(seed.B, segment.Id), UnassignBody(segment.Version), outsider)), HttpStatusCode.NotFound, "Assignment target not found");
        await AssertProblemAsync(await client.SendAsync(Post(CancelUrl(seed.A, segment.Id), CancelBody(segment.Version), desk)), HttpStatusCode.NotFound, "Operational block target not found");
        Assert.Equal(2, (await AuditsAsync()).Length);
    }

    [Fact]
    public void Every_calendar_write_action_enforces_its_staff_permission_per_action_and_keeps_the_local_gate()
    {
        var expected = new Dictionary<string, StaffPermission>
        {
            [$"{nameof(AdminReservationAssignmentsController)}.{nameof(AdminReservationAssignmentsController.Create)}"] = StaffPermission.AssignmentWrite,
            [$"{nameof(AdminReservationAssignmentsController)}.{nameof(AdminReservationAssignmentsController.Move)}"] = StaffPermission.AssignmentWrite,
            [$"{nameof(AdminReservationAssignmentsController)}.{nameof(AdminReservationAssignmentsController.Unassign)}"] = StaffPermission.AssignmentWrite,
            [$"{nameof(AdminOperationalBlocksController)}.{nameof(AdminOperationalBlocksController.Create)}"] = StaffPermission.BlockWrite,
            [$"{nameof(AdminOperationalBlocksController)}.{nameof(AdminOperationalBlocksController.Cancel)}"] = StaffPermission.BlockWrite,
        };

        var actual = new Dictionary<string, StaffPermission>();
        foreach (var controller in new[] { typeof(AdminReservationAssignmentsController), typeof(AdminOperationalBlocksController) })
        {
            // Never per controller: an action added later must be converted deliberately.
            Assert.Null(controller.GetCustomAttribute<StaffCalendarPermissionAttribute>());
            Assert.Null(controller.GetCustomAttribute<ServiceFilterAttribute>());
            foreach (var action in controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                var permission = action.GetCustomAttribute<StaffCalendarPermissionAttribute>();
                Assert.True(permission is not null, $"{controller.Name}.{action.Name} has no Staff permission");
                Assert.Equal(typeof(AdminCalendarWriteGateFilter), permission!.LocalGateFilter);
                actual[$"{controller.Name}.{action.Name}"] = permission.Permission;
            }
        }

        Assert.Equal(expected.OrderBy(pair => pair.Key), actual.OrderBy(pair => pair.Key));
    }

    // ---------------------------------------------------------------
    // 15. OpenAPI
    // ---------------------------------------------------------------

    [Fact]
    public async Task OpenApi_documents_the_writes_for_the_mode_the_host_runs()
    {
        var operations = new (string Path, string Permission, bool Confirmable, string[] LocalStatuses)[]
        {
            ("/api/admin/v1/properties/{propertyId}/reservation-assignments", "AssignmentWrite", true, ["201", "400", "403", "404", "409", "415"]),
            ("/api/admin/v1/properties/{propertyId}/reservation-assignments/{segmentId}/move", "AssignmentWrite", true, ["200", "400", "403", "404", "409", "415"]),
            ("/api/admin/v1/properties/{propertyId}/reservation-assignments/{segmentId}/unassign", "AssignmentWrite", false, ["200", "400", "404", "409", "415"]),
            ("/api/admin/v1/properties/{propertyId}/operational-blocks", "BlockWrite", false, ["201", "400", "403", "404", "409", "415"]),
            ("/api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/cancel", "BlockWrite", false, ["200", "400", "403", "404", "409", "415"]),
        };

        foreach (var mode in new AdminCalendarAccessMode?[] { AdminCalendarAccessMode.Staff, AdminCalendarAccessMode.LocalGate })
        {
            using var host = CreateHost(mode);
            using var document = JsonDocument.Parse(await CreateHttpsClient(host).GetStringAsync("/swagger/v1/swagger.json"));
            var paths = document.RootElement.GetProperty("paths");
            foreach (var (path, permission, confirmable, localStatuses) in operations)
            {
                var post = paths.GetProperty(path).GetProperty("post");
                var description = post.GetProperty("description").GetString()!;
                Assert.Contains(permission, description, StringComparison.Ordinal);
                Assert.Equal(confirmable, description.Contains("AssignmentCrossRoomType", StringComparison.Ordinal));
                var schemes = post.TryGetProperty("security", out var security)
                    ? security.EnumerateArray().SelectMany(item => item.EnumerateObject().Select(scheme => scheme.Name)).ToArray()
                    : [];
                var statuses = post.GetProperty("responses").EnumerateObject().Select(response => response.Name).Order().ToArray();
                if (mode == AdminCalendarAccessMode.Staff)
                {
                    Assert.StartsWith("This host runs AccessMode=Staff.", description, StringComparison.Ordinal);
                    Assert.Equal(["StaffCookie"], schemes);
                    Assert.Equal(localStatuses.Append("401").Append("403").Distinct().Order().ToArray(), statuses);
                    Assert.Contains(permission, post.GetProperty("responses").GetProperty("403").GetProperty("description").GetString(), StringComparison.Ordinal);
                }
                else
                {
                    Assert.StartsWith("This host runs AccessMode=LocalGate.", description, StringComparison.Ordinal);
                    Assert.Empty(schemes);
                    Assert.Equal(localStatuses.Order().ToArray(), statuses);
                }
            }
        }
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static void LocalWriteOn(IWebHostBuilder builder) =>
        builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true");

    private WebApplicationFactory<Program> CreateHost(AdminCalendarAccessMode? mode, Action<IWebHostBuilder>? configure = null) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (mode is not null)
            {
                builder.UseSetting(AdminCalendarAccess.ModeKey, mode.ToString());
            }

            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            configure?.Invoke(builder);
        });

    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> host) =>
        host.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
            HandleCookies = false
        });

    private async Task<Seed> SeedAsync()
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();

        var a = NewProperty("a");
        var standard = new RoomType(Guid.NewGuid(), a.Id, "CP05S", "Standard", "cp05-s", null, 2, 4, true, Now);
        var deluxe = new RoomType(Guid.NewGuid(), a.Id, "CP05D", "Deluxe", "cp05-d", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), a.Id, "CP05", "cp05", null, "VND", true, Now);
        var standardRooms = Enumerable.Range(0, 3)
            .Select(index => new PhysicalRoom(Guid.NewGuid(), a.Id, standard, $"S{index}", 1, OperationalStatus.Active, Now)).ToList();
        var deluxeRooms = Enumerable.Range(0, 2)
            .Select(index => new PhysicalRoom(Guid.NewGuid(), a.Id, deluxe, $"D{index}", 1, OperationalStatus.Active, Now)).ToList();
        context.AddRange(a, standard, deluxe, ratePlan);
        context.AddRange(standardRooms.Concat(deluxeRooms));

        var b = NewProperty("b");
        var typeB = new RoomType(Guid.NewGuid(), b.Id, "CP05B", "Standard", "cp05-b", null, 2, 4, true, Now);
        var ratePlanB = new RatePlan(Guid.NewGuid(), b.Id, "CP05B", "cp05b", null, "VND", true, Now);
        var roomB = new PhysicalRoom(Guid.NewGuid(), b.Id, typeB, "B0", 1, OperationalStatus.Active, Now);
        context.AddRange(b, typeB, ratePlanB, roomB);

        var unitsA = Reserve(context, a.Id, standard.Id, ratePlan.Id, 2, "a");
        var unitsB = Reserve(context, b.Id, typeB.Id, ratePlanB.Id, 1, "b");
        await context.SaveChangesAsync();
        return new Seed(
            a.Id, b.Id,
            standardRooms.Select(room => room.Id).ToArray(),
            deluxeRooms.Select(room => room.Id).ToArray(),
            unitsA, roomB.Id, unitsB[0]);

        static Property NewProperty(string slug) => new(
            Guid.NewGuid(), $"Hotel {slug}", $"cp05-{slug}", null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
    }

    private static Guid[] Reserve(
        TheBhaDbContext context, Guid propertyId, Guid roomTypeId, Guid ratePlanId, int units, string slug)
    {
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlanId, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), propertyId, roomTypeId, units, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash($"cp05-{slug}:idempotency"), HexHash($"cp05-{slug}:fingerprint"), HexHash($"cp05-{slug}:guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-CP05-{slug.ToUpperInvariant()}", Now);
        context.Add(reservation);
        return reservation.Units.Select(unit => unit.Id).ToArray();
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private static async Task CreateStaffAsync(WebApplicationFactory<Program> host, Seed seed)
    {
        await using (var scope = host.Services.CreateAsyncScope())
        {
            if (await scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>().FindByEmailAsync(Desk) is not null)
            {
                return;
            }
        }

        await CliAsync(host, ["--staff-create", "--email", Desk, "--property-id", seed.A.ToString(), "--role", StaffRole.FrontDesk], Password);
        await CliAsync(host, ["--staff-create", "--email", Manager, "--property-id", seed.A.ToString(), "--role", StaffRole.Manager], Password);
        await CliAsync(host, ["--staff-create", "--email", Outsider, "--property-id", seed.B.ToString(), "--role", StaffRole.Manager], Password);
    }

    private static async Task CliAsync(WebApplicationFactory<Program> host, string[] args, string? password = null)
    {
        using var output = new StringWriter();
        var exit = await StaffBootstrapCommand.RunAsync(args, host.Services, output, () => password, CancellationToken.None);
        Assert.True(exit == 0, output.ToString());
    }

    private static string[] Grant(string email, Guid propertyId, string role) =>
        ["--staff-grant", "--email", email, "--property-id", propertyId.ToString(), "--role", role];

    private static async Task<Guid> CreateCustomerAsync(WebApplicationFactory<Program> host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var customers = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
        var customer = new CustomerAccount { Id = Guid.NewGuid(), Email = "guest@example.com", UserName = "guest@example.com" };
        Assert.True((await customers.CreateAsync(customer, Password)).Succeeded);
        return customer.Id;
    }

    private static async Task<string> CustomerLoginAsync(HttpClient client)
    {
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { Email = "guest@example.com", Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return CookieHeader(login, ".TheBha.Customer");
    }

    private async Task<Guid> StaffIdAsync(string email)
    {
        await using var context = factory.CreateDbContext();
        return await context.StaffAccounts
            .Where(account => account.NormalizedEmail == email.ToUpperInvariant())
            .Select(account => account.Id)
            .SingleAsync();
    }

    private static async Task<string> LoginAsync(HttpClient client, string email)
    {
        var login = await client.SendAsync(Post("/api/admin/v1/auth/login", JsonSerializer.Serialize(new { email, password = Password })));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return CookieHeader(login, ".TheBha.Staff");
    }

    private async Task<RoomOccupancySegmentAudit[]> AuditsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegmentAudits.AsNoTracking().OrderBy(audit => audit.OccurredAtUtc).ToArrayAsync();
    }

    private async Task<(string Actor, string? Evidence)> CreatedAuditAsync(Guid segmentId) =>
        await AuditAsync(segmentId, RoomOccupancySegmentAuditEventType.Created);

    private async Task<(string Actor, string? Evidence)> CancelledAuditAsync(Guid segmentId) =>
        await AuditAsync(segmentId, RoomOccupancySegmentAuditEventType.Cancelled);

    private async Task<(string Actor, string? Evidence)> AuditAsync(Guid segmentId, RoomOccupancySegmentAuditEventType type)
    {
        var audit = Assert.Single(await AuditsAsync(), row => row.SegmentId == segmentId && row.EventType == type);
        return (audit.ActorReference, audit.AuthorizationEvidence);
    }

    private async Task<string[]> BlockCreatorsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomBlocks.AsNoTracking().Select(block => block.CreatedByActorReference).ToArrayAsync();
    }

    private static (string Path, string Body)[] Writes(Guid propertyId, Seed seed, Guid segment) =>
    [
        (CreateUrl(propertyId), CreateBody(seed.Units[0], seed.Standard[0])),
        (MoveUrl(propertyId, segment), MoveBody(1, seed.Standard[1])),
        (UnassignUrl(propertyId, segment), UnassignBody(1)),
        (BlockUrl(propertyId), BlockBody(seed.Standard[2])),
        (CancelUrl(propertyId, segment), CancelBody(1)),
    ];

    private static string CreateUrl(Guid propertyId) => $"/api/admin/v1/properties/{propertyId}/reservation-assignments";
    private static string MoveUrl(Guid propertyId, Guid segment) => $"{CreateUrl(propertyId)}/{segment}/move";
    private static string UnassignUrl(Guid propertyId, Guid segment) => $"{CreateUrl(propertyId)}/{segment}/unassign";
    private static string BlockUrl(Guid propertyId) => $"/api/admin/v1/properties/{propertyId}/operational-blocks";
    private static string CancelUrl(Guid propertyId, Guid segment) => $"{BlockUrl(propertyId)}/{segment}/cancel";

    private static string CreateBody(
        Guid unit, Guid room, bool confirm = false, string? reason = null, object? extra = null, DateOnly? start = null, DateOnly? end = null) =>
        Body(new
        {
            reservationUnitId = unit,
            physicalRoomId = room,
            startDate = start ?? CheckIn,
            endDate = end ?? CheckOut,
            confirmCrossRoomType = confirm,
            reason
        }, extra);

    private static string MoveBody(uint version, Guid room, bool confirm = false, string? reason = null) =>
        Body(new { expectedVersion = version, physicalRoomId = room, startDate = CheckIn, endDate = CheckOut, confirmCrossRoomType = confirm, reason });

    private static string UnassignBody(uint version) => Body(new { expectedVersion = version });

    private static string BlockBody(Guid room, DateOnly? start = null, DateOnly? end = null) =>
        Body(new { physicalRoomId = room, startDate = start ?? BlockFrom, endDate = end ?? BlockTo, reason = "Burst pipe" });

    private static string CancelBody(uint version) => Body(new { expectedVersion = version });

    /// <summary>The JSON body, with any <paramref name="extra"/> properties a forged client would add.</summary>
    private static string Body(object payload, object? extra = null)
    {
        var body = JsonSerializer.SerializeToNode(payload)!.AsObject();
        foreach (var (name, value) in extra is null ? [] : JsonSerializer.SerializeToNode(extra)!.AsObject().ToArray())
        {
            body[name] = value?.DeepClone();
        }

        return body.ToJsonString();
    }

    private static HttpRequestMessage Post(
        string path, string body, string? cookie = null, string[]? origins = null, string? contentType = "application/json")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)) };
        if (contentType is not null)
        {
            request.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
        }

        foreach (var origin in origins ?? [AdminOrigin])
        {
            request.Headers.TryAddWithoutValidation("Origin", origin);
        }

        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        return request;
    }

    private static HttpRequestMessage Preflight(string path, string origin, string method, string? requestHeaders = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, path);
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", method);
        if (requestHeaders is not null)
        {
            request.Headers.Add("Access-Control-Request-Headers", requestHeaders);
        }

        return request;
    }

    private static string CookieHeader(HttpResponseMessage response, string name)
    {
        var setCookie = Assert.Single(response.Headers.GetValues("Set-Cookie"), value => value.StartsWith($"{name}=", StringComparison.Ordinal));
        return setCookie[..setCookie.IndexOf(';')];
    }

    private static async Task<HttpResponseMessage> AssertStatusAsync(HttpStatusCode status, Task<HttpResponseMessage> send)
    {
        var response = await send;
        Assert.True(status == response.StatusCode, $"expected {(int)status}, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return response;
    }

    private static async Task<RoomOccupancySegmentDto> SegmentAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto>(JsonOptions))!;

    private static async Task<RoomOccupancySegmentDto[]> SegmentsAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<RoomOccupancySegmentDto[]>(JsonOptions))!;

    private static void AssertNoStore(HttpResponseMessage response) =>
        Assert.True(response.Headers.CacheControl?.NoStore, $"Cache-Control: {response.Headers.CacheControl}");

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string title)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(status == response.StatusCode, $"expected {(int)status} {title}, got {(int)response.StatusCode}: {body}");
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        AssertNoStore(response);
        Assert.False(response.Headers.Contains("Location"));
        Assert.Equal(title, JsonDocument.Parse(body).RootElement.GetProperty("title").GetString());
    }

    private static Task AssertUnauthorizedAsync(HttpResponseMessage response) =>
        AssertProblemAsync(response, HttpStatusCode.Unauthorized, "Authentication required");

    private static Task AssertForbiddenAsync(HttpResponseMessage response) =>
        AssertProblemAsync(response, HttpStatusCode.Forbidden, "Access denied");

    private sealed record Seed(Guid A, Guid B, Guid[] Standard, Guid[] Deluxe, Guid[] Units, Guid RoomB, Guid UnitB);

    /// <summary>Counts calls and records the actor; answers a conflict, so nothing is written.</summary>
    private sealed class CountingAssignmentStore : IAssignmentMutationStore
    {
        public int Calls;
        public List<string> Actors { get; } = [];

        public Task<SegmentMutationResult> CreateAsync(CreateAssignmentCommand command, CancellationToken cancellationToken) =>
            Record(command.ActorReference);

        public Task<SegmentMutationResult> SupersedeAsync(SupersedeAssignmentsCommand command, CancellationToken cancellationToken) =>
            Record(command.ActorReference);

        public Task<SegmentMutationResult> SplitMoveAsync(SplitMoveAssignmentCommand command, CancellationToken cancellationToken) =>
            Record(command.ActorReference);

        private Task<SegmentMutationResult> Record(string actor)
        {
            Interlocked.Increment(ref Calls);
            lock (Actors)
            {
                Actors.Add(actor);
            }

            return Task.FromResult(SegmentMutationResult.Conflict("spy"));
        }
    }

    private sealed class CountingBlockStore : IOperationalBlockMutationStore
    {
        public int Calls;
        public List<string> Actors { get; } = [];

        public Task<CreateRoomBlockResult> CreateBlockAsync(CreateRoomBlockCommand command, CancellationToken cancellationToken)
        {
            Record(command.ActorReference);
            return Task.FromResult(CreateRoomBlockResult.Conflict("spy"));
        }

        public Task<SegmentMutationResult> SupersedeSegmentsAsync(SupersedeBlockSegmentsCommand command, CancellationToken cancellationToken)
        {
            Record(command.ActorReference);
            return Task.FromResult(SegmentMutationResult.Conflict("spy"));
        }

        private void Record(string actor)
        {
            Interlocked.Increment(ref Calls);
            lock (Actors)
            {
                Actors.Add(actor);
            }
        }
    }
}
