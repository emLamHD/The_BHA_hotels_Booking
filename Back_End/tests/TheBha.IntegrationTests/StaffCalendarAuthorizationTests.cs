using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Application.Scheduling;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP04: <c>AdminCalendar:AccessMode</c>, the Property-scoped Staff access
/// evaluator, Staff authorization of the Reservation Board read, and the Staff-mode guard that
/// keeps every unconverted Admin route closed — against real PostgreSQL, with Staff created by
/// the CP02 CLI and signed in through the CP03 routes. Cookies are handled by hand.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StaffCalendarAuthorizationTests(PostgreSqlWebApplicationFactory factory)
{
    private const string AdminOrigin = "https://localhost:3001";
    private const string CustomerOrigin = "https://localhost:3000";
    private const string Desk = "desk@example.com";
    private const string Manager = "manager@example.com";
    private const string Outsider = "outsider@example.com";
    private const string LoginPath = "/api/admin/v1/auth/login";
    private const string LogoutPath = "/api/admin/v1/auth/logout";
    private const string MePath = "/api/admin/v1/me";
    private static readonly string Password = $"A!a1{Guid.NewGuid():N}";
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly From = new(2026, 9, 1);
    private static readonly DateOnly To = new(2026, 9, 8);

    // ---------------------------------------------------------------
    // 1. The fixed role map and the evaluator
    // ---------------------------------------------------------------

    [Fact]
    public async Task The_fixed_role_map_is_exactly_the_decided_one_and_anything_else_is_denied()
    {
        var all = Enum.GetValues<StaffPermission>();
        Assert.Equal(
            [StaffPermission.BoardRead, StaffPermission.AssignmentWrite, StaffPermission.BlockWrite, StaffPermission.AssignmentCrossRoomType],
            all);
        Assert.Equal(
            [StaffPermission.BoardRead, StaffPermission.AssignmentWrite, StaffPermission.BlockWrite],
            all.Where(permission => StaffPermissions.RoleGrants(StaffRole.FrontDesk, permission)).ToArray());
        Assert.Equal(all, all.Where(permission => StaffPermissions.RoleGrants(StaffRole.Manager, permission)).ToArray());
        foreach (var role in new[] { "Viewer", "frontdesk", "MANAGER", "", " Manager", null })
        {
            Assert.DoesNotContain(all, permission => StaffPermissions.RoleGrants(role, permission));
        }

        Assert.False(StaffPermissions.RoleGrants(StaffRole.Manager, (StaffPermission)42));
        Assert.False(StaffPermissions.RoleGrants(StaffRole.FrontDesk, (StaffPermission)(-1)));

        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        var desk = await StaffIdAsync(Desk);
        var manager = await StaffIdAsync(Manager);

        Assert.True(await HasPermissionAsync(host, desk, seed.A, StaffPermission.BoardRead));
        Assert.False(await HasPermissionAsync(host, desk, seed.A, StaffPermission.AssignmentCrossRoomType));
        Assert.True(await HasPermissionAsync(host, manager, seed.A, StaffPermission.AssignmentCrossRoomType));
        // One membership never reaches another Property, and nobody else's membership counts.
        Assert.False(await HasPermissionAsync(host, desk, seed.B, StaffPermission.BoardRead));
        Assert.False(await HasPermissionAsync(host, Guid.NewGuid(), seed.A, StaffPermission.BoardRead));
        Assert.False(await HasPermissionAsync(host, manager, seed.A, (StaffPermission)42));

        await using (var scope = host.Services.CreateAsyncScope())
        {
            using var cancelled = new CancellationTokenSource();
            await cancelled.CancelAsync();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => scope.ServiceProvider
                .GetRequiredService<IStaffAccessEvaluator>()
                .HasPermissionAsync(desk, seed.A, StaffPermission.BoardRead, cancelled.Token));
        }

        await CliAsync(host, ["--staff-disable", "--email", Desk]);
        Assert.False(await HasPermissionAsync(host, desk, seed.A, StaffPermission.BoardRead));
    }

    // ---------------------------------------------------------------
    // 2–3. Board read: members, non-members and sessions
    // ---------------------------------------------------------------

    [Fact]
    public async Task A_member_reads_its_own_property_board_and_is_forbidden_everywhere_else()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        await CliAsync(host, ["--staff-grant", "--email", Desk, "--property-id", seed.Inactive.ToString(), "--role", StaffRole.FrontDesk]);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        var manager = await LoginAsync(client, Manager);
        var outsider = await LoginAsync(client, Outsider);

        foreach (var cookie in new[] { desk, manager })
        {
            var board = await client.SendAsync(Get(BoardUrl(seed.A), cookie));
            Assert.Equal(HttpStatusCode.OK, board.StatusCode);
            AssertNoStore(board);
            var property = (await board.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("property");
            Assert.Equal(seed.A, property.GetProperty("id").GetGuid());
            Assert.Equal("Hotel a", property.GetProperty("name").GetString());
        }

        // Another Property, a Property that does not exist, and a member of B reading A: all 403,
        // so a non-member cannot tell an existing Property from a missing one.
        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.B), desk)));
        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(Guid.NewGuid()), manager)));
        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.A), outsider)));
        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.Inactive), manager)));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.B), outsider))).StatusCode);

        // A member of an inactive Property keeps the board query's own 404.
        var inactive = await client.SendAsync(Get(BoardUrl(seed.Inactive), desk));
        Assert.Equal(HttpStatusCode.NotFound, inactive.StatusCode);
        AssertNoStore(inactive);
        Assert.Equal("Property not found", await TitleAsync(inactive));
    }

    [Fact]
    public async Task Without_a_valid_staff_session_the_board_answers_401_whatever_else_is_sent()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var customers = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
            Assert.True((await customers.CreateAsync(
                new CustomerAccount { Id = Guid.NewGuid(), Email = Desk, UserName = Desk }, Password)).Succeeded);
        }

        using var client = CreateHttpsClient(host);
        var customerLogin = await client.PostAsJsonAsync("/api/v1/auth/login", new { Email = Desk, Password });
        Assert.Equal(HttpStatusCode.OK, customerLogin.StatusCode);
        var customer = CookieHeader(customerLogin, ".TheBha.Customer");
        var customerValue = customer[(customer.IndexOf('=') + 1)..];

        foreach (var cookie in new string?[]
                 {
                     null,
                     ".TheBha.Staff=not-a-ticket",
                     customer,
                     $".TheBha.Staff={customerValue}",
                 })
        {
            await AssertUnauthorizedAsync(await client.SendAsync(Get(BoardUrl(seed.A), cookie)));
        }
    }

    // ---------------------------------------------------------------
    // 4–6. Changes in the database apply on the next request
    // ---------------------------------------------------------------

    [Fact]
    public async Task Membership_grant_removal_and_role_change_apply_on_the_next_request()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        var deskId = await StaffIdAsync(Desk);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.A), desk))).StatusCode);

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlAsync(
                $"DELETE FROM \"StaffPropertyMemberships\" WHERE \"StaffAccountId\" = {deskId} AND \"PropertyId\" = {seed.A}");
        }

        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.A), desk)));

        await CliAsync(host, Grant(Desk, seed.B, StaffRole.FrontDesk));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.B), desk))).StatusCode);
        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.A), desk)));

        // FrontDesk → Manager: the board answer is the same (both have BoardRead), but the
        // evaluator sees the new role on the next call.
        Assert.False(await HasPermissionAsync(host, deskId, seed.B, StaffPermission.AssignmentCrossRoomType));
        await CliAsync(host, Grant(Desk, seed.B, StaffRole.Manager));
        Assert.True(await HasPermissionAsync(host, deskId, seed.B, StaffPermission.AssignmentCrossRoomType));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.B), desk))).StatusCode);
    }

    [Fact]
    public async Task Role_and_property_claims_in_a_valid_cookie_grant_nothing()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        var outsiderId = await StaffIdAsync(Outsider);
        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlAsync(
                $"DELETE FROM \"StaffPropertyMemberships\" WHERE \"StaffAccountId\" = {outsiderId}");
        }

        using var client = CreateHttpsClient(host);
        var desk = await ForgeCookieAsync(host, Desk, seed.B);
        var outsider = await ForgeCookieAsync(host, Outsider, seed.A);

        // Positive control: the forged cookies are real, valid Staff sessions.
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, desk))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, outsider))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.A), desk))).StatusCode);

        // ...but the role, Property and permission claims they carry authorize nothing.
        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.B), desk)));
        await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.A), outsider)));
    }

    [Fact]
    public async Task Cli_disable_and_password_reset_end_the_board_session_on_the_next_request()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        var manager = await LoginAsync(client, Manager);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.A), desk))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.A), manager))).StatusCode);

        await CliAsync(host, ["--staff-reset-password", "--email", Desk], $"B!b2{Guid.NewGuid():N}");
        var afterReset = await client.SendAsync(Get(BoardUrl(seed.A), desk));
        await AssertUnauthorizedAsync(afterReset);
        Assert.StartsWith(".TheBha.Staff=;", Assert.Single(afterReset.Headers.GetValues("Set-Cookie")), StringComparison.Ordinal);

        await CliAsync(host, ["--staff-disable", "--email", Manager]);
        await AssertUnauthorizedAsync(await client.SendAsync(Get(BoardUrl(seed.A), manager)));
    }

    // ---------------------------------------------------------------
    // 7. Local flags and local-gate conditions mean nothing in Staff mode
    // ---------------------------------------------------------------

    [Fact]
    public async Task In_staff_mode_the_local_read_flag_and_gate_conditions_neither_open_nor_close_the_board()
    {
        var seed = await SeedAsync();
        using (var flagOff = CreateHost(AdminCalendarAccessMode.Staff, ReadFlagOff))
        {
            Assert.False(flagOff.Services.GetRequiredService<IOptions<AdminCalendarOptions>>().Value.EnableUnauthenticatedRead);
            await CreateStaffAsync(flagOff, seed);
            using var client = CreateHttpsClient(flagOff);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.A), await LoginAsync(client, Desk)))).StatusCode);
            await AssertUnauthorizedAsync(await client.SendAsync(Get(BoardUrl(seed.A))));
        }

        // The test host opts into the read flag (the local launch profile's shape).
        using (var flagOn = CreateHost(AdminCalendarAccessMode.Staff))
        {
            Assert.True(flagOn.Services.GetRequiredService<IOptions<AdminCalendarOptions>>().Value.EnableUnauthenticatedRead);
            using var client = CreateHttpsClient(flagOn);
            await AssertUnauthorizedAsync(await client.SendAsync(Get(BoardUrl(seed.A))));
            await AssertForbiddenAsync(await client.SendAsync(Get(BoardUrl(seed.A), await LoginAsync(client, Outsider))));
        }

        // Loopback is a local-gate condition: a Staff member on a LAN address still reads.
        using var remote = CreateHost(AdminCalendarAccessMode.Staff, builder => builder.ConfigureServices(services =>
            services.AddSingleton(new TestConnectionAddresses { RemoteIpAddress = IPAddress.Parse("192.168.10.20") })));
        using var remoteClient = CreateHttpsClient(remote);
        Assert.Equal(HttpStatusCode.OK, (await remoteClient.SendAsync(Get(BoardUrl(seed.A), await LoginAsync(remoteClient, Desk)))).StatusCode);
    }

    // ---------------------------------------------------------------
    // 8–10. The Staff-mode guard
    // ---------------------------------------------------------------

    [Fact]
    public async Task In_staff_mode_the_five_calendar_writes_are_converted_and_refuse_without_authority_before_binding()
    {
        var seed = await SeedAsync();
        var segment = Guid.NewGuid();
        var writes = new (string Path, string Body)[]
        {
            ($"/api/admin/v1/properties/{seed.A}/reservation-assignments",
                Json(new { reservationUnitId = Guid.NewGuid(), physicalRoomId = seed.RoomA, startDate = From, endDate = To })),
            ($"/api/admin/v1/properties/{seed.A}/reservation-assignments/{segment}/move",
                Json(new { expectedVersion = 1, physicalRoomId = seed.RoomA, startDate = From, endDate = To })),
            ($"/api/admin/v1/properties/{seed.A}/reservation-assignments/{segment}/unassign",
                Json(new { expectedVersion = 1 })),
            ($"/api/admin/v1/properties/{seed.A}/operational-blocks",
                Json(new { physicalRoomId = seed.RoomA, startDate = From, endDate = To, reason = "Burst pipe" })),
            ($"/api/admin/v1/properties/{seed.A}/operational-blocks/{segment}/cancel",
                Json(new { expectedVersion = 1 })),
        };

        // PMS-ADMIN-AUTH-001-CP05 converted the five writes (CP04 closed them): in Staff mode they
        // now answer the Staff boundary — with the local write flag on, which opens nothing.
        using (var staff = CreateHost(AdminCalendarAccessMode.Staff, builder =>
                   builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true")))
        {
            await CreateStaffAsync(staff, seed);
            using var client = CreateHttpsClient(staff);
            var manager = await LoginAsync(client, Manager);
            var outsider = await LoginAsync(client, Outsider);
            foreach (var (path, body) in writes)
            {
                foreach (var payload in new[] { body, "{not json", "{}" })
                {
                    await AssertUnauthorizedAsync(await client.SendAsync(Post(path, payload)));
                    await AssertForbiddenAsync(await client.SendAsync(Post(path, payload, outsider)));
                }

                // Authority established, the request reaches binding and validation.
                Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Post(path, "{not json", manager))).StatusCode);

                var preflight = await client.SendAsync(Preflight(path, AdminOrigin, "POST", "content-type"));
                Assert.Equal(AdminOrigin, Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Origin")));
                Assert.Equal("true", Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Credentials")));
            }

            Assert.Equal((0, 0, 0), await CalendarRowCountsAsync());
        }

        // Positive control: the same block create, on a LocalGate host with the write flag on,
        // reaches the store — so the refusals above are the Staff boundary, not a broken request.
        using var local = CreateHost(null, builder => builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true"));
        using var localClient = CreateHttpsClient(local);
        Assert.Equal(HttpStatusCode.Created, (await localClient.SendAsync(Post(writes[3].Path, writes[3].Body))).StatusCode);
        var (segments, blocks, _) = await CalendarRowCountsAsync();
        Assert.Equal((1, 1), (segments, blocks));
    }

    [Fact]
    public async Task In_staff_mode_an_admin_endpoint_without_staff_permission_metadata_is_closed()
    {
        var seed = await SeedAsync();
        var spy = new WriteGateProbeSpy();
        Action<IWebHostBuilder> probes = builder =>
        {
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true");
            builder.ConfigureServices(services =>
            {
                services.AddSingleton(spy);
                services.AddControllers().AddApplicationPart(typeof(StaffModeGuardProbeController).Assembly);
            });
        };
        var writeProbe = Json(new { marker = "cp04" });

        // LocalGate: each probe is open by its own means — anonymous, [Authorize] or the local gate.
        using (var local = CreateHost(null, probes))
        {
            await CreateStaffAsync(local, seed);
            using var client = CreateHttpsClient(local);
            var manager = await LoginAsync(client, Manager);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(StaffModeGuardProbeController.Route))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(Get(StaffForbidProbeController.Route, manager))).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(Post("/api/admin/v1/test-only/write-gate-probe", writeProbe))).StatusCode);
            Assert.Equal(2, spy.Invocations);
        }

        // Staff mode: none of them is a Staff permission, so all are closed — cookie or not.
        using var staff = CreateHost(AdminCalendarAccessMode.Staff, probes);
        using var staffClient = CreateHttpsClient(staff);
        var staffManager = await LoginAsync(staffClient, Manager);
        foreach (var cookie in new[] { staffManager, null })
        {
            await AssertClosedAsync(await staffClient.SendAsync(Get(StaffModeGuardProbeController.Route, cookie)), "allow-anonymous probe");
            await AssertClosedAsync(await staffClient.SendAsync(Get(StaffForbidProbeController.Route, cookie)), "authorize probe");
            await AssertClosedAsync(await staffClient.SendAsync(Post("/api/admin/v1/test-only/write-gate-probe", writeProbe, cookie)), "write-gate probe");
            await AssertClosedAsync(await staffClient.SendAsync(Get("/api/admin/v1/auth/anything", cookie)), "unknown auth path");
            await AssertClosedAsync(await staffClient.SendAsync(Get("/api/admin/v1/no-such-route", cookie)), "absent route");
        }

        // Nothing behind the guard ran in Staff mode: still the two LocalGate invocations.
        Assert.Equal(2, spy.Invocations);
        Assert.Equal(1, StaffModeGuardProbeController.Invocations(spy));
        Assert.Equal(1, spy.Markers.Count(marker => marker == "cp04"));
    }

    [Fact]
    public async Task In_staff_mode_the_session_routes_work_and_customer_routes_are_untouched()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff);
        await CreateStaffAsync(host, seed);
        using var client = CreateHttpsClient(host);

        var login = await client.SendAsync(Post(LoginPath, Json(new { email = Desk, password = Password })));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var cookie = CookieHeader(login, ".TheBha.Staff");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, cookie))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(Post(LogoutPath, "{}", cookie))).StatusCode);
        await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath)));

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/properties")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        var register = await client.PostAsJsonAsync(
            "/api/v1/auth/register", new { Email = "guest@example.com", Password });
        Assert.True(register.IsSuccessStatusCode, $"customer register: {(int)register.StatusCode}");
        var customerLogin = await client.PostAsJsonAsync("/api/v1/auth/login", new { Email = "guest@example.com", Password });
        Assert.Equal(HttpStatusCode.OK, customerLogin.StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.SendAsync(Get("/api/v1/auth/me", CookieHeader(customerLogin, ".TheBha.Customer")))).StatusCode);
    }

    // ---------------------------------------------------------------
    // 11–12. LocalGate stays the default; the mode is validated and frozen
    // ---------------------------------------------------------------

    [Fact]
    public async Task An_absent_or_explicit_local_gate_mode_keeps_the_local_gate_and_ignores_staff_sessions()
    {
        var seed = await SeedAsync();
        foreach (var mode in new AdminCalendarAccessMode?[] { null, AdminCalendarAccessMode.LocalGate })
        {
            using var host = CreateHost(mode);
            Assert.Equal(AdminCalendarAccessMode.LocalGate, host.Services.GetRequiredService<AdminCalendarAccess>().Mode);
            await CreateStaffAsync(host, seed);
            using var client = CreateHttpsClient(host);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.A)))).StatusCode);
            var outsider = await LoginAsync(client, Outsider);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(BoardUrl(seed.A), outsider))).StatusCode);
            // The write gate keeps its own order: write flag off → its 404, not a Staff answer.
            // (A closed local write gate may carry its uncredentialed CORS header for an approved
            // Admin origin — the existing write-gate contract — unlike the Staff-mode guard.)
            var write = await client.SendAsync(Post($"/api/admin/v1/properties/{seed.A}/operational-blocks", "{}", outsider));
            Assert.Equal(HttpStatusCode.NotFound, write.StatusCode);
            AssertNoStore(write);
            Assert.False(write.Headers.Contains("Access-Control-Allow-Credentials"));

            using var closed = CreateHost(mode, ReadFlagOff);
            Assert.False(closed.Services.GetRequiredService<IOptions<AdminCalendarOptions>>().Value.EnableUnauthenticatedRead);
            using var closedClient = CreateHttpsClient(closed);
            var desk = await LoginAsync(closedClient, Desk);
            // A Staff session does not open a closed local gate.
            var board = await closedClient.SendAsync(Get(BoardUrl(seed.A), desk));
            Assert.Equal(HttpStatusCode.NotFound, board.StatusCode);
            AssertNoStore(board);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("staff")]
    [InlineData("STAFF")]
    [InlineData("localgate")]
    [InlineData("Staff ")]
    [InlineData("0")]
    [InlineData("1")]
    [InlineData("LocalGate,Staff")]
    [InlineData("Both")]
    public void A_declared_access_mode_must_be_exactly_local_gate_or_staff(string value)
    {
        using var host = factory.WithWebHostBuilder(builder => builder.UseSetting(AdminCalendarAccess.ModeKey, value));
        var exception = Assert.Throws<InvalidOperationException>(() => host.CreateClient());
        Assert.Equal("AdminCalendar:AccessMode must be exactly LocalGate or Staff.", exception.Message);
    }

    [Fact]
    public void A_nested_access_mode_section_is_refused_too()
    {
        using var host = factory.WithWebHostBuilder(builder => builder.UseSetting($"{AdminCalendarAccess.ModeKey}:Value", "Staff"));
        var exception = Assert.Throws<InvalidOperationException>(() => host.CreateClient());
        Assert.Equal("AdminCalendar:AccessMode must be exactly LocalGate or Staff.", exception.Message);
    }

    private const string Refused = "refused";

    /// <summary>
    /// CP04-C1: the mode as the real JSON configuration provider presents it, layered lowest
    /// priority first in a <see cref="ConfigurationManager"/>, as the host builds it. An empty
    /// object or array is a declared key with a null value; only a key no provider declares is
    /// the LocalGate default.
    /// </summary>
    public static TheoryData<string[], string> JsonAccessModes() => new()
    {
        // Declared but empty or null: refused, never a default.
        { ["""{"AdminCalendar":{"AccessMode":{}}}"""], Refused },
        { ["""{"AdminCalendar":{"AccessMode":[]}}"""], Refused },
        { ["""{"AdminCalendar":{"AccessMode":null}}"""], Refused },
        { ["""{"AdminCalendar":{"AccessMode":""}}"""], Refused },
        // Not declared anywhere: LocalGate.
        { ["{}"], nameof(AdminCalendarAccessMode.LocalGate) },
        { ["""{"AdminCalendar":{}}"""], nameof(AdminCalendarAccessMode.LocalGate) },
        { ["""{"AdminCalendar":{"EnableUnauthenticatedRead":true}}"""], nameof(AdminCalendarAccessMode.LocalGate) },
        // Valid scalars, any key casing; the value itself is ordinal.
        { ["""{"AdminCalendar":{"AccessMode":"LocalGate"}}"""], nameof(AdminCalendarAccessMode.LocalGate) },
        { ["""{"AdminCalendar":{"AccessMode":"Staff"}}"""], nameof(AdminCalendarAccessMode.Staff) },
        { ["""{"adminCalendar":{"accessMode":"Staff"}}"""], nameof(AdminCalendarAccessMode.Staff) },
        { ["""{"ADMINCALENDAR":{"ACCESSMODE":"LocalGate"}}"""], nameof(AdminCalendarAccessMode.LocalGate) },
        { ["""{"AdminCalendar":{"AccessMode":"staff"}}"""], Refused },
        // Children: a nested section, or a valid scalar that still has an effective child.
        { ["""{"AdminCalendar":{"AccessMode":{"Value":"Staff"}}}"""], Refused },
        { ["""{"AdminCalendar":{"AccessMode":{"Value":"x"}}}""", """{"AdminCalendar":{"AccessMode":"Staff"}}"""], Refused },
        // Precedence: a higher-priority empty declaration wins over a lower valid one...
        { ["""{"AdminCalendar":{"AccessMode":"Staff"}}""", """{"AdminCalendar":{"AccessMode":{}}}"""], Refused },
        { ["""{"AdminCalendar":{"AccessMode":"Staff"}}""", """{"AdminCalendar":{"AccessMode":[]}}"""], Refused },
        // ...a higher-priority valid scalar wins over a lower empty one...
        { ["""{"AdminCalendar":{"AccessMode":{}}}""", """{"AdminCalendar":{"AccessMode":"Staff"}}"""], nameof(AdminCalendarAccessMode.Staff) },
        { ["""{"AdminCalendar":{"AccessMode":[]}}""", """{"adminCalendar":{"accessMode":"Staff"}}"""], nameof(AdminCalendarAccessMode.Staff) },
        // ...and a higher-priority provider that does not declare the key keeps the lower value.
        { ["""{"AdminCalendar":{"AccessMode":"Staff"}}""", """{"AdminCalendar":{"EnableUnauthenticatedRead":false}}"""], nameof(AdminCalendarAccessMode.Staff) },
        { ["""{"AdminCalendar":{"AccessMode":"Staff"}}""", """{"AdminCalendar":{}}"""], nameof(AdminCalendarAccessMode.Staff) },
    };

    [Theory]
    [MemberData(nameof(JsonAccessModes))]
    public void The_access_mode_is_read_from_real_json_providers_and_only_an_undeclared_key_defaults(
        string[] layers,
        string expected)
    {
        var configuration = new ConfigurationManager();
        foreach (var layer in layers)
        {
            configuration.AddJsonStream(new MemoryStream(Encoding.UTF8.GetBytes(layer)));
        }

        if (expected == Refused)
        {
            var exception = Assert.Throws<InvalidOperationException>(() => AdminCalendarAccess.FromConfiguration(configuration));
            Assert.Equal("AdminCalendar:AccessMode must be exactly LocalGate or Staff.", exception.Message);
        }
        else
        {
            Assert.Equal(expected, AdminCalendarAccess.FromConfiguration(configuration).Mode.ToString());
        }
    }

    [Theory]
    [InlineData("""{"AdminCalendar":{"AccessMode":{}}}""")]
    [InlineData("""{"AdminCalendar":{"AccessMode":[]}}""")]
    public void A_development_host_with_local_gates_on_refuses_to_start_on_an_empty_json_access_mode(string json)
    {
        var contentRoot = JsonContentRoot(json);
        try
        {
            using var host = CreateJsonHost(contentRoot);
            var exception = Assert.Throws<InvalidOperationException>(() => host.CreateClient());
            Assert.Equal("AdminCalendar:AccessMode must be exactly LocalGate or Staff.", exception.Message);
        }
        finally
        {
            Directory.Delete(contentRoot, recursive: true);
        }
    }

    [Fact]
    public async Task The_same_json_source_selects_staff_and_leaves_an_undeclared_mode_on_local_gate()
    {
        var seed = await SeedAsync();
        var staffRoot = JsonContentRoot("""{"AdminCalendar":{"AccessMode":"Staff"}}""");
        var localRoot = JsonContentRoot("""{"AdminCalendar":{"EnableUnauthenticatedRead":true}}""");
        try
        {
            // Positive controls through the same JSON file: it is read at startup...
            using (var staff = CreateJsonHost(staffRoot))
            {
                Assert.Equal(AdminCalendarAccessMode.Staff, staff.Services.GetRequiredService<AdminCalendarAccess>().Mode);
                await AssertUnauthorizedAsync(await CreateHttpsClient(staff).SendAsync(Get(BoardUrl(seed.A))));
            }

            // ...and a file that does not declare the key keeps the LocalGate board.
            using var local = CreateJsonHost(localRoot);
            Assert.Equal(AdminCalendarAccessMode.LocalGate, local.Services.GetRequiredService<AdminCalendarAccess>().Mode);
            Assert.Equal(HttpStatusCode.OK, (await CreateHttpsClient(local).SendAsync(Get(BoardUrl(seed.A)))).StatusCode);
        }
        finally
        {
            Directory.Delete(staffRoot, recursive: true);
            Directory.Delete(localRoot, recursive: true);
        }
    }

    /// <summary>
    /// A content root holding the API's real <c>appsettings.json</c> and, as
    /// <c>appsettings.Development.json</c>, the JSON under test — so the host's own JSON file
    /// provider reads it while <c>Program.cs</c> starts, exactly as a deployed file would be read.
    /// (A source added through <c>ConfigureAppConfiguration</c> arrives after that point.)
    /// </summary>
    private static string JsonContentRoot(string developmentJson)
    {
        var root = Path.Combine(Path.GetTempPath(), "thebha-cp04-access-mode", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        File.Copy(Path.Combine(ApiContentRoot(), "appsettings.json"), Path.Combine(root, "appsettings.json"));
        File.WriteAllText(Path.Combine(root, "appsettings.Development.json"), developmentJson);
        return root;
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

    /// <summary>A Development host (local read and write opt-ins on) whose configuration files come from <paramref name="contentRoot"/>.</summary>
    private WebApplicationFactory<Program> CreateJsonHost(string contentRoot) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseContentRoot(contentRoot);
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true");
        });

    [Fact]
    public async Task The_mode_is_captured_at_startup_and_a_later_configuration_change_does_not_switch_it()
    {
        var seed = await SeedAsync();
        foreach (var (started, flipped, anonymous) in new[]
                 {
                     ("Staff", "LocalGate", HttpStatusCode.Unauthorized),
                     ("LocalGate", "Staff", HttpStatusCode.OK),
                 })
        {
            using var host = factory.WithWebHostBuilder(builder => builder.UseSetting(AdminCalendarAccess.ModeKey, started));
            var configuration = host.Services.GetRequiredService<IConfiguration>();

            // Before the first request, then again after it.
            foreach (var _ in new[] { "before", "after" })
            {
                configuration[AdminCalendarAccess.ModeKey] = flipped;
                Assert.Equal(flipped, configuration[AdminCalendarAccess.ModeKey]);
                using var client = CreateHttpsClient(host);
                Assert.Equal(anonymous, (await client.SendAsync(Get(BoardUrl(seed.A)))).StatusCode);
            }
        }
    }

    // ---------------------------------------------------------------
    // 13–14. Transport and CORS
    // ---------------------------------------------------------------

    [Fact]
    public async Task In_staff_mode_the_board_over_cleartext_is_404_before_redirect_and_authentication()
    {
        var seed = await SeedAsync();
        using var host = CreateHost(AdminCalendarAccessMode.Staff, builder => builder.ConfigureServices(services =>
            services.Configure<HttpsRedirectionOptions>(options => options.HttpsPort = 443)));
        await CreateStaffAsync(host, seed);
        var desk = await LoginAsync(CreateHttpsClient(host), Desk);
        using var cleartext = host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false });

        // Control: redirection is active on this host, so the refusals are not vacuous.
        Assert.Equal(HttpStatusCode.TemporaryRedirect, (await cleartext.GetAsync("/api/v1/properties")).StatusCode);

        foreach (var cookie in new[] { desk, null })
        {
            var response = await cleartext.SendAsync(Get(BoardUrl(seed.A), cookie));
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            AssertNoStore(response);
            Assert.False(response.Headers.Contains("Location"));
            Assert.False(response.Headers.Contains("Set-Cookie"));
            Assert.DoesNotContain("Hotel a", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Board_cors_is_credentialed_for_admin_origins_in_staff_mode_only()
    {
        var seed = await SeedAsync();
        using (var staff = CreateHost(AdminCalendarAccessMode.Staff))
        {
            await CreateStaffAsync(staff, seed);
            using var client = CreateHttpsClient(staff);
            var preflight = await client.SendAsync(Preflight(BoardUrl(seed.A), AdminOrigin, "GET"));
            Assert.Equal(AdminOrigin, Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Credentials")));
            Assert.Contains("GET", Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Methods")), StringComparison.Ordinal);

            var board = await client.SendAsync(Get(BoardUrl(seed.A), await LoginAsync(client, Desk), AdminOrigin));
            Assert.Equal(HttpStatusCode.OK, board.StatusCode);
            Assert.Equal(AdminOrigin, Assert.Single(board.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(board.Headers.GetValues("Access-Control-Allow-Credentials")));

            foreach (var origin in new[] { CustomerOrigin, "https://evil.example", "null", "http://localhost:3001" })
            {
                var refused = await client.SendAsync(Preflight(BoardUrl(seed.A), origin, "GET"));
                Assert.False(refused.Headers.Contains("Access-Control-Allow-Origin"), origin);
                Assert.False(refused.Headers.Contains("Access-Control-Allow-Credentials"), origin);
            }

            var post = await client.SendAsync(Preflight(BoardUrl(seed.A), AdminOrigin, "POST"));
            Assert.False(
                post.Headers.TryGetValues("Access-Control-Allow-Methods", out var methods) &&
                methods.Any(value => value.Contains("POST", StringComparison.Ordinal)));

            // CORS is not authorization: an approved origin without a session is still 401.
            await AssertUnauthorizedAsync(await client.SendAsync(Get(BoardUrl(seed.A), null, AdminOrigin)));
        }

        using var local = CreateHost(null);
        using var localClient = CreateHttpsClient(local);
        var localPreflight = await localClient.SendAsync(Preflight(BoardUrl(seed.A), AdminOrigin, "GET"));
        Assert.Equal(AdminOrigin, Assert.Single(localPreflight.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(localPreflight.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    // ---------------------------------------------------------------
    // 15. Query validation belongs to members; nobody else reaches the query
    // ---------------------------------------------------------------

    [Fact]
    public async Task A_member_keeps_the_query_contract_and_an_unauthorized_request_never_reaches_the_query()
    {
        var seed = await SeedAsync();
        using (var host = CreateHost(AdminCalendarAccessMode.Staff))
        {
            await CreateStaffAsync(host, seed);
            using var client = CreateHttpsClient(host);
            var desk = await LoginAsync(client, Desk);
            foreach (var query in new[] { "?from=2026-09-01", "?from=bad&to=2026-09-08", "?from=2026-09-08&to=2026-09-01", "?from=2026-09-01&to=2026-10-03" })
            {
                var response = await client.SendAsync(Get($"/api/admin/v1/properties/{seed.A}/reservation-board{query}", desk));
                Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
                Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
                AssertNoStore(response);
            }
        }

        var spy = new CountingBoardQuery();
        using var spied = CreateHost(AdminCalendarAccessMode.Staff, builder => builder.ConfigureTestServices(services =>
            services.AddScoped<IReservationBoardQuery>(_ => spy)));
        using var spiedClient = CreateHttpsClient(spied);
        var outsider = await LoginAsync(spiedClient, Outsider);
        foreach (var query in new[] { "?from=bad", "", $"?from={From:yyyy-MM-dd}&to={To:yyyy-MM-dd}" })
        {
            await AssertUnauthorizedAsync(await spiedClient.SendAsync(Get($"/api/admin/v1/properties/{seed.A}/reservation-board{query}")));
            await AssertForbiddenAsync(await spiedClient.SendAsync(Get($"/api/admin/v1/properties/{seed.A}/reservation-board{query}", outsider)));
        }

        Assert.Equal(0, spy.Invocations);
        // Positive control: a member does reach it.
        var member = await spiedClient.SendAsync(Get(BoardUrl(seed.A), await LoginAsync(spiedClient, Desk)));
        Assert.Equal(HttpStatusCode.NotFound, member.StatusCode);
        Assert.Equal(1, spy.Invocations);
    }

    // ---------------------------------------------------------------
    // 16. OpenAPI
    // ---------------------------------------------------------------

    [Fact]
    public async Task OpenApi_documents_the_board_for_the_mode_the_host_runs()
    {
        foreach (var (mode, security, label) in new[]
                 {
                     ((AdminCalendarAccessMode?)AdminCalendarAccessMode.Staff, new[] { "StaffCookie" }, "AccessMode=Staff"),
                     (null, Array.Empty<string>(), "AccessMode=LocalGate"),
                 })
        {
            using var host = CreateHost(mode);
            using var client = CreateHttpsClient(host);
            using var document = JsonDocument.Parse(await client.GetStringAsync("/swagger/v1/swagger.json"));
            var board = document.RootElement.GetProperty("paths")
                .GetProperty("/api/admin/v1/properties/{propertyId}/reservation-board")
                .GetProperty("get");

            var schemes = board.TryGetProperty("security", out var requirements)
                ? requirements.EnumerateArray().SelectMany(requirement => requirement.EnumerateObject().Select(scheme => scheme.Name)).ToArray()
                : [];
            Assert.Equal(security, schemes);
            Assert.StartsWith($"This host runs {label}.", board.GetProperty("description").GetString(), StringComparison.Ordinal);
            Assert.Contains("BoardRead", board.GetProperty("description").GetString(), StringComparison.Ordinal);

            var responses = board.GetProperty("responses");
            Assert.Equal(["200", "400", "401", "403", "404"], responses.EnumerateObject().Select(response => response.Name).Order().ToArray());
            Assert.StartsWith("AccessMode=Staff only", responses.GetProperty("401").GetProperty("description").GetString(), StringComparison.Ordinal);
            Assert.StartsWith("AccessMode=Staff only", responses.GetProperty("403").GetProperty("description").GetString(), StringComparison.Ordinal);
        }
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private WebApplicationFactory<Program> CreateHost(AdminCalendarAccessMode? mode, Action<IWebHostBuilder>? configure = null) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (mode is not null)
            {
                builder.UseSetting(AdminCalendarAccess.ModeKey, mode.ToString());
            }

            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            configure?.Invoke(builder);
        });

    /// <summary>
    /// The factory opts every Development host into the read flag after host settings are applied,
    /// so the flag is switched off on the bound option, as the board tests do.
    /// </summary>
    private static void ReadFlagOff(IWebHostBuilder builder) =>
        builder.ConfigureServices(services =>
            services.Configure<AdminCalendarOptions>(options => options.EnableUnauthenticatedRead = false));

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
        Property NewProperty(string slug, bool active) => new(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), active, Now);
        var a = NewProperty("a", true);
        var b = NewProperty("b", true);
        var inactive = NewProperty("inactive", false);
        var roomType = new RoomType(Guid.NewGuid(), a.Id, "CP04A", "Standard", "cp04-a", null, 2, 4, true, Now);
        var room = new PhysicalRoom(Guid.NewGuid(), a.Id, roomType, "A1", 1, OperationalStatus.Active, Now);
        context.AddRange(a, b, inactive, roomType, room);
        await context.SaveChangesAsync();
        return new Seed(a.Id, b.Id, inactive.Id, room.Id);
    }

    private static async Task CreateStaffAsync(WebApplicationFactory<Program> host, Seed seed)
    {
        await using (var context = host.Services.CreateAsyncScope())
        {
            var users = context.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
            if (await users.FindByEmailAsync(Desk) is not null)
            {
                return;
            }
        }

        await CliAsync(host, Create(Desk, seed.A, StaffRole.FrontDesk), Password);
        await CliAsync(host, Create(Manager, seed.A, StaffRole.Manager), Password);
        await CliAsync(host, Create(Outsider, seed.B, StaffRole.FrontDesk), Password);
    }

    private static async Task CliAsync(WebApplicationFactory<Program> host, string[] args, string? password = null)
    {
        using var output = new StringWriter();
        var exit = await StaffBootstrapCommand.RunAsync(args, host.Services, output, () => password, CancellationToken.None);
        Assert.True(exit == 0, output.ToString());
    }

    private static string[] Create(string email, Guid propertyId, string role) =>
        ["--staff-create", "--email", email, "--property-id", propertyId.ToString(), "--role", role];

    private static string[] Grant(string email, Guid propertyId, string role) =>
        ["--staff-grant", "--email", email, "--property-id", propertyId.ToString(), "--role", role];

    private async Task<Guid> StaffIdAsync(string email)
    {
        await using var context = factory.CreateDbContext();
        return await context.StaffAccounts
            .Where(account => account.NormalizedEmail == email.ToUpperInvariant())
            .Select(account => account.Id)
            .SingleAsync();
    }

    private static async Task<bool> HasPermissionAsync(
        WebApplicationFactory<Program> host, Guid staffId, Guid propertyId, StaffPermission permission)
    {
        await using var scope = host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IStaffAccessEvaluator>()
            .HasPermissionAsync(staffId, propertyId, permission, CancellationToken.None);
    }

    private static async Task<string> LoginAsync(HttpClient client, string email)
    {
        var login = await client.SendAsync(Post(LoginPath, Json(new { email, password = Password })));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return CookieHeader(login, ".TheBha.Staff");
    }

    /// <summary>
    /// A genuine Staff ticket (valid id and stamp, protected with the host's own key) that also
    /// carries role, Property and permission claims, as a tampered or future cookie might.
    /// </summary>
    private async Task<string> ForgeCookieAsync(WebApplicationFactory<Program> host, string email, Guid claimedProperty)
    {
        await using var context = factory.CreateDbContext();
        var staff = await context.StaffAccounts.AsNoTracking().SingleAsync(account => account.NormalizedEmail == email.ToUpperInvariant());
        var principal = StaffAuthentication.CreatePrincipal(staff.Id, staff.SecurityStamp!);
        var identity = (ClaimsIdentity)principal.Identity!;
        identity.AddClaim(new Claim(ClaimTypes.Role, StaffRole.Manager));
        identity.AddClaim(new Claim("propertyId", claimedProperty.ToString()));
        identity.AddClaim(new Claim("permission", nameof(StaffPermission.BoardRead)));
        var options = host.Services
            .GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(StaffAuthentication.Scheme);
        var ticket = new AuthenticationTicket(
            principal, StaffAuthentication.CreateProperties(factory.Clock.GetUtcNow()), StaffAuthentication.Scheme);
        return $"{StaffAuthentication.CookieName}={options.TicketDataFormat.Protect(ticket)}";
    }

    private async Task<(int Segments, int Blocks, int Audits)> CalendarRowCountsAsync()
    {
        await using var context = factory.CreateDbContext();
        return (
            await context.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM \"RoomOccupancySegments\"").SingleAsync(),
            await context.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM \"RoomBlocks\"").SingleAsync(),
            await context.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM \"RoomOccupancySegmentAudits\"").SingleAsync());
    }

    private static string BoardUrl(Guid propertyId) =>
        $"/api/admin/v1/properties/{propertyId}/reservation-board?from={From:yyyy-MM-dd}&to={To:yyyy-MM-dd}";

    private static string Json(object value) => JsonSerializer.Serialize(value);

    private static HttpRequestMessage Get(string path, string? cookie = null, string? origin = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        if (origin is not null)
        {
            request.Headers.Add("Origin", origin);
        }

        return request;
    }

    private static HttpRequestMessage Post(string path, string body, string? cookie = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body))
        };
        request.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json");
        request.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
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
        var setCookie = Assert.Single(
            response.Headers.GetValues("Set-Cookie"),
            value => value.StartsWith($"{name}=", StringComparison.Ordinal));
        return setCookie[..setCookie.IndexOf(';')];
    }

    private static void AssertNoStore(HttpResponseMessage response) =>
        Assert.True(response.Headers.CacheControl?.NoStore, $"Cache-Control: {response.Headers.CacheControl}");

    private static async Task<string?> TitleAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString();

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string title)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        AssertNoStore(response);
        Assert.False(response.Headers.Contains("Location"));
        Assert.Equal(title, await TitleAsync(response));
    }

    private static Task AssertUnauthorizedAsync(HttpResponseMessage response) =>
        AssertProblemAsync(response, HttpStatusCode.Unauthorized, "Authentication required");

    private static Task AssertForbiddenAsync(HttpResponseMessage response) =>
        AssertProblemAsync(response, HttpStatusCode.Forbidden, "Access denied");

    /// <summary>The closed answer: the generic 404 problem, no-store, and no CORS grant at all.</summary>
    private static async Task AssertClosedAsync(HttpResponseMessage response, string because)
    {
        Assert.True(HttpStatusCode.NotFound == response.StatusCode, $"{because}: {(int)response.StatusCode}");
        AssertNoStore(response);
        Assert.False(response.Headers.Contains("Location"), because);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"), because);
        var body = await response.Content.ReadAsStringAsync();
        if (body.Length > 0)
        {
            var root = JsonDocument.Parse(body).RootElement;
            Assert.Equal("Not Found", root.GetProperty("title").GetString());
            Assert.False(root.TryGetProperty("detail", out _), because);
            Assert.False(root.TryGetProperty("errors", out _), because);
        }
    }

    private sealed record Seed(Guid A, Guid B, Guid Inactive, Guid RoomA);

    private sealed class CountingBoardQuery : IReservationBoardQuery
    {
        private int _invocations;

        public int Invocations => Volatile.Read(ref _invocations);

        public Task<ReservationBoardResult> GetBoardAsync(
            Guid propertyId, DateOnly from, DateOnly to, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _invocations);
            return Task.FromResult(ReservationBoardResult.NotFound());
        }
    }
}

/// <summary>
/// Test-assembly-only Admin endpoint with no Staff permission: open to anyone in LocalGate, and
/// the guard's target in Staff mode. Reachable only from a host that adds this assembly as an
/// application part; <c>TheBha.Api</c> has no such route.
/// </summary>
[ApiController]
[Route(Route)]
public sealed class StaffModeGuardProbeController(WriteGateProbeSpy spy) : ControllerBase
{
    public const string Route = "/api/admin/v1/test-only/staff-mode-guard-probe";
    private const string Marker = "staff-mode-guard-probe";

    public static int Invocations(WriteGateProbeSpy spy) => spy.Markers.Count(marker => marker == Marker);

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Probe()
    {
        spy.Record(Marker);
        return Ok();
    }
}
