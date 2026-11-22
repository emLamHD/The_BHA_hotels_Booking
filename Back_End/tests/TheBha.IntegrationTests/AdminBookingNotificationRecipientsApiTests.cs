using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Controllers;
using TheBha.Application.Notifications;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR04 (R-01..R-04): who receives the booking notifications of a Property. Against real PostgreSQL and the real Staff login: Manager-only per Property, closed in LocalGate, server-side
/// Origin/JSON, stale-version refusal, audit without an address, and the internal resolver (local / chain / fallback, opt-out, revocation, dedup, order) reading the CURRENT state.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminBookingNotificationRecipientsApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string OtherManager = "other-manager@example.com";
    private const string ChainAEmail = "chain.boss@chain.example";
    private const string ChainBEmail = "chain.b@chain.example";
    private static readonly Guid ChainA = Guid.Parse("c0000000-0000-0000-0000-00000000000a");
    private static readonly Guid ChainB = Guid.Parse("c0000000-0000-0000-0000-00000000000b");
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-11-22T00:00:00Z");

    private sealed record Fixture(WebApplicationFactory<Program> Host, HttpClient Client, Guid PropertyId, Guid OtherPropertyId, string ManagerCookie) : IDisposable
    {
        public string Url(Guid? property = null) => $"/api/admin/v1/properties/{property ?? PropertyId}/booking-notification-recipients";

        public void Dispose()
        {
            Client.Dispose();
            Host.Dispose();
        }
    }

    private async Task<Fixture> StartFixtureAsync(AdminCalendarAccessMode mode = AdminCalendarAccessMode.Staff)
    {
        var host = CreateHost(mode).WithWebHostBuilder(builder =>
        {
            builder.UseSetting("BookingNotifications:ChainManagers:0:StaffId", ChainA.ToString());
            builder.UseSetting("BookingNotifications:ChainManagers:0:Email", ChainAEmail);
            builder.UseSetting("BookingNotifications:ChainManagers:1:StaffId", ChainB.ToString());
            builder.UseSetting("BookingNotifications:ChainManagers:1:Email", ChainBEmail);
        });
        var propertyId = await SeedStaffAsync(host);
        var other = new Property(Guid.NewGuid(), "Other Hotel", "other-hotel-pr04", null, "2 Street", "Hue", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        await using (var context = Factory.CreateDbContext())
        {
            context.Add(other);
            await context.SaveChangesAsync();
            AddStaff(context, ChainA, "chain.a.login@example.com", (propertyId, StaffRole.Manager), (other.Id, StaffRole.Manager));
            AddStaff(context, ChainB, "chain.b.login@example.com", (propertyId, StaffRole.FrontDesk));
            await context.SaveChangesAsync();
        }

        await CliAsync(host, ["--staff-create", "--email", OtherManager, "--property-id", other.Id.ToString(), "--role", StaffRole.Manager], Password);
        var client = CreateHttpsClient(host);
        return new Fixture(host, client, propertyId, other.Id, await LoginAsync(client, Manager));
    }

    private static void AddStaff(TheBha.Infrastructure.Persistence.TheBhaDbContext context, Guid id, string email, params (Guid Property, string Role)[] memberships)
    {
        context.StaffAccounts.Add(new StaffAccount
        {
            Id = id, Email = email, UserName = email, NormalizedEmail = email.ToUpperInvariant(), NormalizedUserName = email.ToUpperInvariant(),
            SecurityStamp = Guid.NewGuid().ToString(), ConcurrencyStamp = Guid.NewGuid().ToString(), CreatedAtUtc = Now
        });
        foreach (var (property, role) in memberships)
        {
            context.StaffPropertyMemberships.Add(new StaffPropertyMembership { StaffAccountId = id, PropertyId = property, Role = role, CreatedAtUtc = Now });
        }
    }

    private static Task<HttpResponseMessage> Send(Fixture f, HttpRequestMessage request) => f.Client.SendAsync(request);

    private async Task<JsonElement> RosterAsync(Fixture f, Guid? property = null) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get(f.Url(property), f.ManagerCookie))));

    private static JsonElement Row(JsonElement roster, Guid staffId) =>
        roster.GetProperty("staff").EnumerateArray().Single(x => x.GetProperty("staffAccountId").GetGuid() == staffId);

    private Task<HttpResponseMessage> SetEmail(Fixture f, Guid staffId, string? email, int expectedVersion, string? cookie = null) =>
        Send(f, Post($"{f.Url()}/staff/{staffId}/email", new { expectedVersion, email }, cookie ?? f.ManagerCookie));

    private Task<HttpResponseMessage> SetEnabled(Fixture f, Guid staffId, bool enabled, int expectedVersion) =>
        Send(f, Post($"{f.Url()}/staff/{staffId}/enabled", new { expectedVersion, enabled }, f.ManagerCookie));

    private Task<HttpResponseMessage> SetFallback(Fixture f, string? email, int expectedVersion) =>
        Send(f, Post($"{f.Url()}/fallback", new { expectedVersion, email }, f.ManagerCookie));

    private async Task<BookingNotificationRecipientSet> ResolveAsync(Fixture f, Guid? property = null)
    {
        await using var scope = f.Host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IBookingNotificationRecipients>().ResolveAsync(property ?? f.PropertyId, CancellationToken.None);
    }

    private async Task<string> StateHashAsync() =>
        await ScalarAsync<string>(
            """
            SELECT md5(
              coalesce((SELECT string_agg(to_jsonb(a)::text, '|' ORDER BY "Id") FROM "StaffAccounts" a), '') || '#' ||
              coalesce((SELECT string_agg(to_jsonb(m)::text, '|' ORDER BY "StaffAccountId","PropertyId") FROM "StaffPropertyMemberships" m), '') || '#' ||
              (SELECT count(*) FROM "NewsletterSubscriptions") || '#' || (SELECT count(*) FROM "EmailOutboxEvents") || '#' || (SELECT count(*) FROM "EmailOutboxDeliveries"))
            """);

    // ---- R-01 authorization ----

    [Fact]
    public async Task Only_a_Manager_of_the_routed_Property_can_use_the_routes_and_a_refusal_changes_nothing()
    {
        using var f = await StartFixtureAsync();
        var manager = await StaffIdAsync(Manager);
        var desk = await LoginAsync(f.Client, Desk);
        var site = await LoginAsync(f.Client, Site);                  // FrontDesk who also holds the global website permission
        var otherManager = await LoginAsync(f.Client, OtherManager);  // Manager, but of another Property
        var customer = await CustomerLoginAsync(f.Host, f.Client);

        var routes = new (string Name, Func<string?, HttpRequestMessage> Request)[]
        {
            ("read", c => Get(f.Url(), c)),
            ("email", c => Post($"{f.Url()}/staff/{manager}/email", new { expectedVersion = 0, email = "x@x.example" }, c)),
            ("enabled", c => Post($"{f.Url()}/staff/{manager}/enabled", new { expectedVersion = 0, enabled = false }, c)),
            ("fallback", c => Post($"{f.Url()}/fallback", new { expectedVersion = 0, email = "x@x.example" }, c))
        };
        foreach (var (name, request) in routes)
        {
            Assert.True(HttpStatusCode.Unauthorized == (await Send(f, request(null))).StatusCode, $"{name}: anonymous");
            Assert.True(HttpStatusCode.Unauthorized == (await Send(f, request(customer))).StatusCode, $"{name}: customer session");
            Assert.True(HttpStatusCode.Forbidden == (await Send(f, request(desk))).StatusCode, $"{name}: FrontDesk");
            Assert.True(HttpStatusCode.Forbidden == (await Send(f, request(site))).StatusCode, $"{name}: global website permission is not a booking-notification permission");
            Assert.True(HttpStatusCode.Forbidden == (await Send(f, request(otherManager))).StatusCode, $"{name}: Manager of another Property");
        }

        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffBookingNotificationPreferences" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationFallbacks" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationAudits" """));
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get(f.Url(), f.ManagerCookie)));
    }

    [Fact]
    public async Task Manager_A_manages_A_but_can_neither_read_nor_write_B_even_when_the_body_names_B()
    {
        using var f = await StartFixtureAsync();
        var otherManager = await LoginAsync(f.Client, OtherManager);
        var managerOfOther = await StaffIdAsync(OtherManager);

        Assert.Equal(HttpStatusCode.Forbidden, (await Send(f, Get(f.Url(f.OtherPropertyId), f.ManagerCookie))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(f, Post($"{f.Url(f.OtherPropertyId)}/fallback", new { expectedVersion = 0, email = "b@b.example", propertyId = f.OtherPropertyId }, f.ManagerCookie))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(f, Post($"{f.Url(f.OtherPropertyId)}/staff/{managerOfOther}/email", new { expectedVersion = 0, email = "b@b.example" }, f.ManagerCookie))).StatusCode);
        // A body can name another Property or a role; only the route and the session count: this lands at the ROUTED Property.
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url()}/fallback", new { expectedVersion = 0, email = "a@a.example", propertyId = f.OtherPropertyId, role = "Manager", actorStaffId = managerOfOther }, f.ManagerCookie)));

        Assert.Equal(f.PropertyId, await ScalarAsync<Guid>("""SELECT "PropertyId" FROM "BookingNotificationFallbacks" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationFallbacks" """));
        Assert.Equal(await StaffIdAsync(Manager), await ScalarAsync<Guid>("""SELECT "ActorStaffId" FROM "BookingNotificationAudits" """));
        var other = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get(f.Url(f.OtherPropertyId), otherManager))));
        Assert.Equal(JsonValueKind.Null, other.GetProperty("fallback").GetProperty("email").ValueKind);
    }

    [Fact]
    public async Task A_disabled_staff_member_is_refused_at_once()
    {
        using var f = await StartFixtureAsync();
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get(f.Url(), f.ManagerCookie)));

        await CliAsync(f.Host, ["--staff-disable", "--email", Manager]);

        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(f, Get(f.Url(), f.ManagerCookie))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SetFallback(f, "x@x.example", 0)).StatusCode);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationFallbacks" """));
    }

    [Fact]
    public async Task The_routes_do_not_exist_in_LocalGate_mode()
    {
        using var f = await StartFixtureAsync(AdminCalendarAccessMode.LocalGate);

        Assert.Equal(HttpStatusCode.NotFound, (await Send(f, Get(f.Url()))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(f, Post($"{f.Url()}/fallback", new { expectedVersion = 0, email = "x@x.example" }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(f, Post($"{f.Url()}/staff/{Guid.NewGuid()}/email", new { expectedVersion = 0, email = "x@x.example" }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(f, Post($"{f.Url()}/staff/{Guid.NewGuid()}/enabled", new { expectedVersion = 0, enabled = false }))).StatusCode);
    }

    [Fact]
    public async Task The_server_checks_Origin_and_JSON_on_every_write()
    {
        using var f = await StartFixtureAsync();
        var path = $"{f.Url()}/fallback";
        var body = new { expectedVersion = 0, email = "x@x.example" };

        Assert.Equal(HttpStatusCode.Forbidden, (await Send(f, Post(path, body, f.ManagerCookie, origins: ["https://evil.example"]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(f, Post(path, body, f.ManagerCookie, origins: []))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(f, Post(path, body, f.ManagerCookie, origins: [AdminOrigin, "https://evil.example"]))).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await Send(f, Post(path, "expectedVersion=0&email=x@x.example", f.ManagerCookie, contentType: "application/x-www-form-urlencoded"))).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await Send(f, Post(path, body, f.ManagerCookie, contentType: "text/plain"))).StatusCode);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationFallbacks" """));
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post(path, body, f.ManagerCookie)));
    }

    [Fact]
    public void Every_action_demands_the_per_property_permission_and_only_a_Manager_holds_it()
    {
        var actions = typeof(AdminBookingNotificationRecipientsController).GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly);

        Assert.Equal(4, actions.Length);
        Assert.All(actions, action =>
        {
            var gate = Assert.Single(action.GetCustomAttributes(typeof(StaffCalendarPermissionAttribute), inherit: false).Cast<StaffCalendarPermissionAttribute>());
            Assert.Equal(StaffPermission.BookingNotificationManage, gate.Permission);
        });
        Assert.True(StaffPermissions.RoleGrants(StaffRole.Manager, StaffPermission.BookingNotificationManage));
        Assert.False(StaffPermissions.RoleGrants(StaffRole.FrontDesk, StaffPermission.BookingNotificationManage));
        Assert.False(StaffPermissions.RoleGrants(null, StaffPermission.BookingNotificationManage));
    }

    // ---- R-02 roster, save, clear, toggle, validation, audit, stale ----

    [Fact]
    public async Task The_roster_lists_the_active_FrontDesk_and_Manager_of_this_Property_only_and_nobody_receives_via_a_login_address()
    {
        using var f = await StartFixtureAsync();
        await CliAsync(f.Host, ["--staff-create", "--email", "gone@example.com", "--property-id", f.PropertyId.ToString(), "--role", StaffRole.FrontDesk], Password);
        await CliAsync(f.Host, ["--staff-disable", "--email", "gone@example.com"]);

        var roster = await RosterAsync(f);

        var ids = roster.GetProperty("staff").EnumerateArray().Select(x => x.GetProperty("staffAccountId").GetGuid()).ToHashSet();
        Assert.Equal(new HashSet<Guid> { ChainA, ChainB, await StaffIdAsync(Desk), await StaffIdAsync(Manager), await StaffIdAsync(Site) }, ids);   // no OtherManager (Q only), no disabled Staff
        Assert.Equal($"d***@example.com · #{(await StaffIdAsync(Desk)).ToString("N")[..8]}", Row(roster, await StaffIdAsync(Desk)).GetProperty("accountLabel").GetString());
        // The login address is never serialised: no loginEmail field and no full login address anywhere in the answer.
        Assert.All(roster.GetProperty("staff").EnumerateArray(), x => Assert.False(x.TryGetProperty("loginEmail", out _)));
        foreach (var login in new[] { Desk, Manager, Site, "chain.a.login@example.com", "chain.b.login@example.com", "gone@example.com" }) Assert.DoesNotContain(login, roster.GetRawText());
        foreach (var row in roster.GetProperty("staff").EnumerateArray())
        {
            Assert.Equal(JsonValueKind.Null, row.GetProperty("notificationEmail").ValueKind);   // never the login address
            Assert.Equal(0, row.GetProperty("version").GetInt32());
        }

        Assert.Equal("NotConfigured", Row(roster, await StaffIdAsync(Manager)).GetProperty("coverage").GetString());
        // Chain Manager at P is shown as covered by the chain; the chain address itself is never serialised; ChainB is only FrontDesk here.
        Assert.Equal("Chain", Row(roster, ChainA).GetProperty("coverage").GetString());
        Assert.True(Row(roster, ChainA).GetProperty("chainConfigured").GetBoolean());
        Assert.False(Row(roster, ChainB).GetProperty("chainConfigured").GetBoolean());
        Assert.Equal("NotConfigured", Row(roster, ChainB).GetProperty("coverage").GetString());
        Assert.DoesNotContain("chain.example", roster.GetRawText());
        Assert.Equal(0, roster.GetProperty("fallback").GetProperty("version").GetInt32());
        var recipients = (await ResolveAsync(f)).Recipients;
        Assert.True(recipients.All(r => r.Kind == BookingRecipientKind.ChainManager));   // only the chain Manager
        var logins = await Factory.CreateDbContext().StaffAccounts.AsNoTracking().Select(a => a.Email!.ToLower()).ToListAsync();
        Assert.DoesNotContain(recipients, r => logins.Contains(r.Email.ToLowerInvariant()));   // a login address is never a recipient
    }

    [Fact]
    public async Task Save_change_clear_and_toggle_work_keep_the_login_roles_newsletter_and_outbox_untouched_and_audit_without_an_address()
    {
        using var f = await StartFixtureAsync();
        var desk = await StaffIdAsync(Desk);
        var manager = await StaffIdAsync(Manager);
        var untouched = await StateHashAsync();

        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "  Front.Desk@Hotel.Example ", 0)));
        Assert.Equal("front.desk@hotel.example", saved.GetProperty("notificationEmail").GetString());
        Assert.Equal(1, saved.GetProperty("version").GetInt32());
        Assert.Equal("Local", saved.GetProperty("coverage").GetString());
        Assert.False(saved.TryGetProperty("loginEmail", out _));   // the login address is not part of the answer, and was not changed (state hash below)
        Assert.Equal(["front.desk@hotel.example"], (await ResolveAsync(f)).Recipients.Where(r => r.Kind == BookingRecipientKind.Staff).Select(r => r.Email));

        var changed = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "desk2@hotel.example", 1)));
        Assert.Equal(2, changed.GetProperty("version").GetInt32());

        var off = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetEnabled(f, desk, false, 2)));
        Assert.False(off.GetProperty("isEnabled").GetBoolean());
        Assert.Equal("OptedOut", off.GetProperty("coverage").GetString());
        Assert.DoesNotContain((await ResolveAsync(f)).Recipients, r => r.StaffAccountId == desk);

        var on = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetEnabled(f, desk, true, 3)));
        Assert.Equal("Local", on.GetProperty("coverage").GetString());
        var cleared = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "   ", 4)));
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("notificationEmail").ValueKind);
        Assert.Equal("NotConfigured", cleared.GetProperty("coverage").GetString());
        Assert.DoesNotContain((await ResolveAsync(f)).Recipients, r => r.StaffAccountId == desk);

        // A Manager configures themselves too; a FrontDesk member only receives.
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, manager, "mgr@hotel.example", 0));

        Assert.Equal(untouched, await StateHashAsync());   // accounts, login emails, roles, memberships, newsletter and outbox rows are unchanged
        var audits = await ScalarAsync<string>("""SELECT string_agg("Action", ',' ORDER BY "AtUtc") FROM "BookingNotificationAudits" WHERE "TargetStaffId" = (SELECT "Id" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'DESK@EXAMPLE.COM')""");
        Assert.Equal("email-set,email-changed,disabled,enabled,email-cleared", audits);
        var allAudit = await ScalarAsync<string>("""SELECT string_agg(to_jsonb(t)::text, '|') FROM "BookingNotificationAudits" t""");
        Assert.DoesNotContain("@", allAudit);   // no address, old or new, and no login email
        Assert.DoesNotContain("hotel.example", allAudit);
        Assert.Equal(6, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationAudits" WHERE "PropertyId" = '""" + f.PropertyId + "'" + """ AND "ActorStaffId" = '""" + manager + "'"));
    }

    [Theory]
    [InlineData("a@b.example,c@d.example")]
    [InlineData("a@b.example; c@d.example")]
    [InlineData("a@b.example c@d.example")]
    [InlineData("a@b.example\r\nBcc: x@y.example")]
    [InlineData("a@b.example\n")]
    [InlineData("not-an-address")]
    [InlineData("a@b")]
    public async Task Only_one_valid_address_is_accepted_and_nothing_is_written_otherwise(string email)
    {
        using var f = await StartFixtureAsync();
        var desk = await StaffIdAsync(Desk);

        var staff = await AssertStatusAsync(HttpStatusCode.BadRequest, SetEmail(f, desk, email, 0));
        Assert.Equal(("validation", "email"), await ProblemAsync(staff));
        var fallback = await AssertStatusAsync(HttpStatusCode.BadRequest, SetFallback(f, email, 0));
        Assert.Equal(("validation", "email"), await ProblemAsync(fallback));

        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffBookingNotificationPreferences" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationFallbacks" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationAudits" """));
    }

    [Fact]
    public async Task A_save_that_changes_nothing_writes_no_audit_and_no_version()
    {
        using var f = await StartFixtureAsync();
        var desk = await StaffIdAsync(Desk);
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "a@b.example", 0));

        var same = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "A@B.EXAMPLE", 1)));
        await AssertStatusAsync(HttpStatusCode.OK, SetEnabled(f, desk, true, 1));
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, await StaffIdAsync(Site), null, 0));   // clearing what was never set creates no row
        await AssertStatusAsync(HttpStatusCode.OK, SetFallback(f, null, 0));

        Assert.Equal(1, same.GetProperty("version").GetInt32());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationAudits" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "StaffBookingNotificationPreferences" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationFallbacks" """));
    }

    [Fact]
    public async Task A_stale_write_is_refused_with_409_and_changes_nothing_and_a_lost_first_save_race_is_the_same_refusal()
    {
        using var f = await StartFixtureAsync();
        var desk = await StaffIdAsync(Desk);
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "first@b.example", 0));
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "second@b.example", 1));

        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, SetEmail(f, desk, "lost@b.example", 1));
        Assert.Equal(("stale-version", null), await ProblemAsync(stale));
        await AssertStatusAsync(HttpStatusCode.Conflict, SetEnabled(f, desk, false, 1));
        await AssertStatusAsync(HttpStatusCode.Conflict, SetEmail(f, desk, "lost@b.example", 0));   // "I saw no row" is stale once a row exists
        Assert.Equal("second@b.example", await ScalarAsync<string>("""SELECT "NotificationEmail" FROM "StaffBookingNotificationPreferences" """));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationAudits" """));

        await AssertStatusAsync(HttpStatusCode.OK, SetFallback(f, "desk@b.example", 0));
        await AssertStatusAsync(HttpStatusCode.Conflict, SetFallback(f, "other@b.example", 0));
        Assert.Equal("desk@b.example", await ScalarAsync<string>("""SELECT "Email" FROM "BookingNotificationFallbacks" """));

        // Two first saves for the same Staff member at once: exactly one wins, the other is the stale refusal (never a 500), one row.
        var site = await StaffIdAsync(Site);
        var race = await Task.WhenAll(SetEmail(f, site, "r1@b.example", 0), SetEmail(f, site, "r2@b.example", 0));
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Conflict], race.Select(r => r.StatusCode).Order().ToArray());
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "StaffBookingNotificationPreferences" WHERE "StaffAccountId" = '{site}' """));
        var fallbackRace = await Task.WhenAll(SetFallback(f, "x1@b.example", 1), SetFallback(f, "x2@b.example", 1));
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Conflict], fallbackRace.Select(r => r.StatusCode).Order().ToArray());
    }

    [Fact]
    public async Task A_target_that_is_not_an_active_FrontDesk_or_Manager_of_this_Property_is_404_and_writes_nothing()
    {
        using var f = await StartFixtureAsync();
        await CliAsync(f.Host, ["--staff-create", "--email", "gone@example.com", "--property-id", f.PropertyId.ToString(), "--role", StaffRole.FrontDesk], Password);
        var gone = await StaffIdAsync("gone@example.com");
        await CliAsync(f.Host, ["--staff-disable", "--email", "gone@example.com"]);

        foreach (var target in new[] { await StaffIdAsync(OtherManager), gone, Guid.NewGuid() })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await SetEmail(f, target, "x@x.example", 0)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await SetEnabled(f, target, false, 0)).StatusCode);
        }

        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffBookingNotificationPreferences" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationAudits" """));
    }

    [Fact]
    public async Task The_fallback_is_saved_cleared_audited_and_shown_without_being_a_Staff_identity()
    {
        using var f = await StartFixtureAsync();
        var before = await StateHashAsync();

        var set = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetFallback(f, " Desk@Hotel.Example ", 0)));
        Assert.Equal(("desk@hotel.example", 1), (set.GetProperty("email").GetString(), set.GetProperty("version").GetInt32()));
        Assert.Equal("desk@hotel.example", (await RosterAsync(f)).GetProperty("fallback").GetProperty("email").GetString());
        var changed = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetFallback(f, "desk2@hotel.example", 1)));
        var cleared = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetFallback(f, "", changed.GetProperty("version").GetInt32())));
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("email").ValueKind);
        Assert.Equal(3, cleared.GetProperty("version").GetInt32());   // the row stays, the version keeps counting

        Assert.Equal("fallback-set,fallback-changed,fallback-cleared", await ScalarAsync<string>("""SELECT string_agg("Action", ',' ORDER BY "AtUtc") FROM "BookingNotificationAudits" WHERE "TargetStaffId" IS NULL"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BookingNotificationAudits" WHERE "TargetStaffId" IS NOT NULL"""));
        Assert.DoesNotContain("@", await ScalarAsync<string>("""SELECT string_agg(to_jsonb(t)::text, '|') FROM "BookingNotificationAudits" t"""));
        Assert.Equal(before, await StateHashAsync());
    }

    // ---- R-03 / R-04 the resolver reads the current state ----

    [Fact]
    public async Task The_resolver_drops_a_disabled_member_a_revoked_membership_and_B_only_Staff_on_the_next_call_chain_included()
    {
        using var f = await StartFixtureAsync();
        var desk = await StaffIdAsync(Desk);
        var otherManager = await StaffIdAsync(OtherManager);
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "desk@hotel.example", 0));
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, await StaffIdAsync(Manager), "mgr@hotel.example", 0));
        // A preference row for a Staff member who is only at the OTHER Property is configuration that cannot qualify here.
        await ExecuteAsync($"""INSERT INTO "StaffBookingNotificationPreferences" ("PropertyId","StaffAccountId","NotificationEmail","IsEnabled","Version","CreatedAtUtc","UpdatedAtUtc") VALUES ('{f.PropertyId}','{otherManager}','b-only@hotel.example',true,1,now(),now())""");

        Assert.Equal(["desk@hotel.example", "mgr@hotel.example", ChainAEmail], (await ResolveAsync(f)).Recipients.Select(r => r.Email).ToArray());

        await CliAsync(f.Host, ["--staff-disable", "--email", Desk]);                                  // disabled Staff
        await ExecuteAsync($"""DELETE FROM "StaffPropertyMemberships" WHERE "StaffAccountId" = '{ChainA}' AND "PropertyId" = '{f.PropertyId}'""");   // revoked chain Manager
        await ExecuteAsync($"""UPDATE "StaffPropertyMemberships" SET "Role" = 'FrontDesk' WHERE "StaffAccountId" = '{await StaffIdAsync(Manager)}'""");   // downgraded: still a recipient by own address

        var after = await ResolveAsync(f);
        Assert.Equal(["mgr@hotel.example"], after.Recipients.Select(r => r.Email).ToArray());
        Assert.DoesNotContain(after.Recipients, r => r.StaffAccountId == otherManager || r.StaffAccountId == desk || r.StaffAccountId == ChainA);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "StaffBookingNotificationPreferences" WHERE "NotificationEmail" = 'desk@hotel.example'"""));   // the rows stay; they just stop qualifying
    }

    [Fact]
    public async Task A_chain_Manager_receives_only_at_Properties_where_currently_a_Manager_and_a_Property_Manager_cannot_change_the_chain()
    {
        using var f = await StartFixtureAsync();

        Assert.Equal([ChainAEmail], (await ResolveAsync(f)).Recipients.Select(r => r.Email).ToArray());                       // ChainB is only FrontDesk at P
        Assert.Equal([ChainAEmail], (await ResolveAsync(f, f.OtherPropertyId)).Recipients.Select(r => r.Email).ToArray());   // ChainA is a Manager at Q too

        await ExecuteAsync($"""UPDATE "StaffPropertyMemberships" SET "Role" = 'FrontDesk' WHERE "StaffAccountId" = '{ChainA}' AND "PropertyId" = '{f.OtherPropertyId}'""");
        Assert.Empty((await ResolveAsync(f, f.OtherPropertyId)).Recipients);   // no longer a Manager at Q: nothing from the chain there
        Assert.Single((await ResolveAsync(f)).Recipients);                     // and still a Manager at P

        // The Property Manager has no route that touches the chain: an attempt to give the chain Manager an address only creates a LOCAL row, which takes precedence only at this Property.
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, ChainA, "local-a@hotel.example", 0));
        Assert.Equal(["local-a@hotel.example"], (await ResolveAsync(f)).Recipients.Select(r => r.Email).ToArray());
        await ExecuteAsync($"""UPDATE "StaffPropertyMemberships" SET "Role" = 'Manager' WHERE "StaffAccountId" = '{ChainA}' AND "PropertyId" = '{f.OtherPropertyId}'""");
        Assert.Equal([ChainAEmail], (await ResolveAsync(f, f.OtherPropertyId)).Recipients.Select(r => r.Email).ToArray());   // Q still uses the chain address
    }

    [Fact]
    public async Task Local_settings_and_opt_out_behave_as_contracted_against_the_chain()
    {
        using var f = await StartFixtureAsync();

        // A local row with no address (only possible by the toggle) does not override the chain address...
        await AssertStatusAsync(HttpStatusCode.OK, SetEnabled(f, ChainA, true, 0));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "StaffBookingNotificationPreferences" WHERE "StaffAccountId" = '{ChainA}' """));   // enabling the default creates no row
        Assert.Equal([ChainAEmail], (await ResolveAsync(f)).Recipients.Select(r => r.Email).ToArray());

        // ...but an explicit local opt-out blocks it, only at THIS Property.
        var optOut = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SetEnabled(f, ChainA, false, 0)));
        Assert.Equal("OptedOut", optOut.GetProperty("coverage").GetString());
        Assert.Empty((await ResolveAsync(f)).Recipients);
        Assert.Equal([ChainAEmail], (await ResolveAsync(f, f.OtherPropertyId)).Recipients.Select(r => r.Email).ToArray());

        // Back on with no address: the chain address returns. With an own address: the local one wins.
        await AssertStatusAsync(HttpStatusCode.OK, SetEnabled(f, ChainA, true, 1));
        Assert.Equal([ChainAEmail], (await ResolveAsync(f)).Recipients.Select(r => r.Email).ToArray());
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, ChainA, "Own@Hotel.Example", 2));
        var recipient = Assert.Single((await ResolveAsync(f)).Recipients);
        Assert.Equal(("own@hotel.example", BookingRecipientKind.Staff), (recipient.Email, recipient.Kind));
    }

    [Fact]
    public async Task Duplicates_collapse_aliases_stay_separate_the_order_is_stable_and_the_fallback_only_fills_an_empty_set()
    {
        using var f = await StartFixtureAsync();
        var (desk, site, manager) = (await StaffIdAsync(Desk), await StaffIdAsync(Site), await StaffIdAsync(Manager));
        await AssertStatusAsync(HttpStatusCode.OK, SetFallback(f, "fallback@hotel.example", 0));
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "Shared@Hotel.Example", 0));
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, site, "shared@hotel.example", 0));          // same address, other Staff
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, manager, "sha.red+x@hotel.example", 0));    // a dot/plus alias is a different address

        var first = await ResolveAsync(f);
        var second = await ResolveAsync(f);

        Assert.Equal(["sha.red+x@hotel.example", "shared@hotel.example", ChainAEmail], first.Recipients.Select(r => r.Email).ToArray());
        Assert.Equal(first.Recipients, second.Recipients);   // deterministic order and keys
        Assert.DoesNotContain(first.Recipients, r => r.Kind == BookingRecipientKind.Fallback);
        Assert.All(first.Recipients, r => Assert.DoesNotContain("@", r.Key));

        // Everyone out: the fallback fills the empty set; and it is never fetched from another Property.
        foreach (var (id, version) in new[] { (desk, 1), (site, 1), (manager, 1), (ChainA, 0) }) await AssertStatusAsync(HttpStatusCode.OK, SetEnabled(f, id, false, version));
        var onlyFallback = Assert.Single((await ResolveAsync(f)).Recipients);
        Assert.Equal(("fallback@hotel.example", BookingRecipientKind.Fallback, (Guid?)null, $"fallback:{f.PropertyId:N}"), (onlyFallback.Email, onlyFallback.Kind, onlyFallback.StaffAccountId, onlyFallback.Key));
        Assert.Equal([ChainAEmail], (await ResolveAsync(f, f.OtherPropertyId)).Recipients.Select(r => r.Email).ToArray());   // Q has no fallback of its own and borrows nothing from P
        await ExecuteAsync($"""UPDATE "StaffPropertyMemberships" SET "Role" = 'FrontDesk' WHERE "StaffAccountId" = '{ChainA}' AND "PropertyId" = '{f.OtherPropertyId}'""");
        Assert.True((await ResolveAsync(f, f.OtherPropertyId)).IsEmpty);
        Assert.True((await ResolveAsync(f, Guid.NewGuid())).IsEmpty);   // an unknown Property is the recognisable empty set, not an error
    }

    [Fact]
    public async Task A_recipient_is_still_valid_only_while_its_address_is_in_the_current_set()
    {
        using var f = await StartFixtureAsync();
        var desk = await StaffIdAsync(Desk);
        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "desk@hotel.example", 0));
        await using var scope = f.Host.Services.CreateAsyncScope();
        var recipients = scope.ServiceProvider.GetRequiredService<IBookingNotificationRecipients>();

        Assert.True(await recipients.IsStillRecipientAsync(f.PropertyId, " DESK@hotel.example ", CancellationToken.None));
        Assert.False(await recipients.IsStillRecipientAsync(f.OtherPropertyId, "desk@hotel.example", CancellationToken.None));

        await AssertStatusAsync(HttpStatusCode.OK, SetEmail(f, desk, "desk-new@hotel.example", 1));   // address changed after a fan-out
        Assert.False(await recipients.IsStillRecipientAsync(f.PropertyId, "desk@hotel.example", CancellationToken.None));
        Assert.True(await recipients.IsStillRecipientAsync(f.PropertyId, "desk-new@hotel.example", CancellationToken.None));

        await CliAsync(f.Host, ["--staff-disable", "--email", Desk]);                                  // person disabled after a fan-out
        Assert.False(await recipients.IsStillRecipientAsync(f.PropertyId, "desk-new@hotel.example", CancellationToken.None));
    }

    // ---- start-up ----

    [Fact]
    public async Task A_chain_setting_that_cannot_work_stops_the_host()
    {
        await Factory.ResetDatabaseAsync();
        var broken = CreateHost().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("BookingNotifications:ChainManagers:0:StaffId", ChainA.ToString());
            builder.UseSetting("BookingNotifications:ChainManagers:0:Email", "a@b.example, c@d.example");
        });

        var error = Assert.ThrowsAny<Exception>(() => broken.CreateClient());

        Assert.Contains("BookingNotifications:ChainManagers", error.ToString());
        broken.Dispose();
    }
}
