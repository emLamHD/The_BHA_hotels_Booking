using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Application.Activity;
using TheBha.Domain.Properties;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR03 (ADR 0011 §B–D): the shared unseen routes and the history, on real PostgreSQL through the real HTTP pipeline. The Staff session boundary is pinned once (the four
/// routes share one attribute); the rest pins what can go wrong in the data: permission and Property scope applied before counting, the D2 baseline, own events, correlation, the 50-group
/// window with an exact total, cursors that never move back, history paging, and Newsletter parity with the legacy routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminMenuUnseenApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Unseen = "/api/admin/v1/menu-unseen";
    private const string History = "/api/admin/v1/activity";
    private const string LegacyUnseen = "/api/admin/v1/website/menu-unseen";

    private sealed class Env(Session staff, string desk, string manager, Guid propertyA) : IDisposable
    {
        public Session Staff { get; } = staff;                 // Site: website permission + FrontDesk at A
        public string Desk { get; } = desk;                    // FrontDesk at A only
        public string Manager { get; } = manager;              // Manager at A
        public Guid A { get; } = propertyA;
        public HttpClient Http => Staff.Client;
        public Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> Host => Staff.Host;
        public void Dispose() => Staff.Dispose();
    }

    private async Task<Env> BeginAsync(AdminCalendarAccessMode mode = AdminCalendarAccessMode.Staff)
    {
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, mode.ToString());
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", "https://localhost:3000");
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
        });
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var property = await SeedStaffAsync(host);
        // Every account is a day old, so an event recorded now is after the D2 baseline and one moved two days back is before it.
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CreatedAtUtc" = now() - interval '1 day' """);
        var client = CreateHttpsClient(host);
        return new Env(new Session(host, client, await LoginAsync(client, Site)), await LoginAsync(client, Desk), await LoginAsync(client, Manager), property);
    }

    private async Task<Guid> AddPropertyAsync(string slug)
    {
        await using var context = Factory.CreateDbContext();
        var property = new Property(Guid.NewGuid(), "Hotel " + slug, slug, null, "2 Street", "Hue", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, DateTimeOffset.UtcNow);
        context.Add(property);
        await context.SaveChangesAsync();
        return property.Id;
    }

    private static string Key(int n) => $"{n:x8}-0000-4000-8000-000000000000";

    private async Task RecordAsync(Env e, string menu, string? email, string action = "Created", int entity = 1, Guid? property = null, Guid? correlation = null, string title = "Title")
    {
        Guid? actor = email is null ? null : await StaffIdAsync(email);
        await using var scope = e.Host.Services.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        await using var transaction = await database.Database.BeginTransactionAsync();
        await scope.ServiceProvider.GetRequiredService<IAdminActivityRecorder>().RecordAsync(
            new AdminActivityEntry(menu, property, actor is null ? AdminActorKind.System : AdminActorKind.Staff, actor, action, "post", Key(entity), title, 1, correlation), default);
        await transaction.CommitAsync();
    }

    private static async Task<JsonElement> OkAsync(Env e, string path, string? cookie = null) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Http.SendAsync(Get(path, cookie ?? e.Staff.Cookie))));

    private static JsonElement MenuOf(JsonElement summary, string key) => summary.GetProperty("menus").GetProperty(key);
    private static string[] Keys(JsonElement summary) => [.. summary.GetProperty("menus").EnumerateObject().Select(menu => menu.Name).Order(StringComparer.Ordinal)];

    private static Task<HttpResponseMessage> Seen(Env e, string menu, object body, string? cookie = null) => e.Http.SendAsync(Post($"{Unseen}/{menu}/seen", body, cookie ?? e.Staff.Cookie));

    /// <summary>The refusal as a client sees it, without the per-request trace id.</summary>
    private static async Task<string> RefusalAsync(HttpResponseMessage response)
    {
        var body = await JsonAsync(response);
        return $"{(int)response.StatusCode} {body.GetProperty("code").GetString()} {body.GetProperty("title").GetString()} {body.GetProperty("detail").GetString()}";
    }

    // ---------------------------------------------------------------------------------------------------------- the Staff session boundary

    [Fact]
    public async Task The_routes_need_a_Staff_session_origin_and_json_for_writes_send_no_store_answer_the_Admin_CORS_policy_and_do_not_exist_in_LocalGate()
    {
        using (var e = await BeginAsync())
        {
            foreach (var path in new[] { Unseen, $"{Unseen}/blog-posts/changes", $"{History}?menu=blog-posts" })
                await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Http.SendAsync(Get(path)));
            await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Http.SendAsync(Post($"{Unseen}/blog-posts/seen", new { viewWatermark = "0" })));
            await AssertStatusAsync(HttpStatusCode.Forbidden, e.Http.SendAsync(Post($"{Unseen}/blog-posts/seen", new { viewWatermark = "0" }, e.Desk, ["https://evil.example"])));
            await AssertStatusAsync(HttpStatusCode.UnsupportedMediaType, e.Http.SendAsync(Post($"{Unseen}/blog-posts/seen", "viewWatermark=0", e.Desk, contentType: "text/plain")));

            var read = await AssertStatusAsync(HttpStatusCode.OK, e.Http.SendAsync(Get(Unseen, e.Desk, AdminOrigin)));
            Assert.Contains("no-store", read.Headers.CacheControl!.ToString());
            Assert.Equal(AdminOrigin, Assert.Single(read.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(read.Headers.GetValues("Access-Control-Allow-Credentials")));

            var preflight = new HttpRequestMessage(HttpMethod.Options, $"{Unseen}/blog-posts/seen");
            preflight.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
            preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
            preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type");
            var allowed = await e.Http.SendAsync(preflight);
            Assert.Equal(AdminOrigin, Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Origin")));
        }

        using var local = await BeginAsync(AdminCalendarAccessMode.LocalGate);
        foreach (var path in new[] { Unseen, $"{Unseen}/blog-posts/changes", $"{History}?menu=blog-posts" })
            await AssertStatusAsync(HttpStatusCode.NotFound, local.Http.SendAsync(Get(path, local.Staff.Cookie)));
        await AssertStatusAsync(HttpStatusCode.NotFound, Seen(local, "blog-posts", new { viewWatermark = "0" }));
    }

    // ---------------------------------------------------------------------------------------------------------- permission and Property scope

    [Fact]
    public async Task A_Blog_only_Staff_member_sees_only_the_Blog_menus_and_every_other_menu_is_the_same_404_as_an_unknown_one()
    {
        using var e = await BeginAsync();
        await CliAsync(e.Host, ["--staff-blog-access", "--email", Desk, "--edit", "true", "--publish", "false"]);
        await ExecuteAsync($"""DELETE FROM "StaffPropertyMemberships" WHERE "StaffAccountId" = '{await StaffIdAsync(Desk)}' """);
        await RecordAsync(e, "blog-posts", Site);
        foreach (var menu in new[] { "website-hero", "catalog" }) await RecordAsync(e, menu, Site);
        await RecordAsync(e, "calendar", Site, property: e.A);
        await RecordAsync(e, "promotions", Site, property: e.A);

        var summary = await OkAsync(e, Unseen, e.Desk);
        Assert.Equal(["blog-categories", "blog-media", "blog-posts", "blog-settings"], Keys(summary));
        Assert.Equal([1, 0, 0, 0], new[] { "blog-posts", "blog-categories", "blog-media", "blog-settings" }.Select(key => MenuOf(summary, key).GetProperty("count").GetInt32()));
        Assert.Equal(1, (await OkAsync(e, $"{Unseen}/blog-posts/changes", e.Desk)).GetProperty("unseenEvents").GetInt32());

        var unknown = await RefusalAsync(await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{Unseen}/no-such-menu/changes", e.Desk))));
        foreach (var menu in new[] { "website-hero", "newsletter", "catalog", "calendar", "promotions" })
        {
            Assert.Equal(unknown, await RefusalAsync(await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{Unseen}/{menu}/changes", e.Desk)))));
            Assert.Equal(unknown, await RefusalAsync(await AssertStatusAsync(HttpStatusCode.NotFound, Seen(e, menu, new { viewWatermark = "0" }, e.Desk))));
            Assert.Equal(unknown, await RefusalAsync(await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{History}?menu={menu}", e.Desk)))));
        }

        // A malformed request for a menu the member cannot read still gets the 404, never a 400 that would confirm the menu exists.
        Assert.Equal(unknown, await RefusalAsync(await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{History}?menu=website-hero&propertyId={e.A}&limit=0", e.Desk)))));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Get($"{Unseen}/blog-posts/changes?propertyId={e.A}", e.Desk)));
    }

    [Fact]
    public async Task Mixed_roles_across_two_Properties_filter_every_number_list_and_acknowledgement_by_the_members_own_scope()
    {
        using var e = await BeginAsync();
        var b = await AddPropertyAsync("hotel-b");
        await CliAsync(e.Host, ["--staff-grant", "--email", Manager, "--property-id", b.ToString(), "--role", StaffRole.FrontDesk]);   // Manager at A, FrontDesk at B
        await RecordAsync(e, "promotions", Site, property: e.A);
        await RecordAsync(e, "promotions", Site, property: b);
        await RecordAsync(e, "calendar", Site, property: e.A, entity: 1);
        await RecordAsync(e, "calendar", Site, property: b, entity: 2);
        await RecordAsync(e, "calendar", Site, property: b, entity: 2, action: "Moved");
        await RecordAsync(e, "calendar", Site, property: b, entity: 3);

        var manager = await OkAsync(e, Unseen, e.Manager);
        Assert.Equal(["calendar", "promotions"], Keys(manager));
        var promotions = MenuOf(manager, "promotions");
        Assert.Equal(1, promotions.GetProperty("count").GetInt32());
        Assert.Equal([e.A], promotions.GetProperty("byProperty").EnumerateArray().Select(row => row.GetProperty("propertyId").GetGuid()));
        var calendar = MenuOf(manager, "calendar");
        Assert.Equal(3, calendar.GetProperty("count").GetInt32());   // A: 1 object; B: 2 objects (three events, one object twice)
        Assert.Equal(new Dictionary<Guid, int> { [e.A] = 1, [b] = 2 }, calendar.GetProperty("byProperty").EnumerateArray().ToDictionary(row => row.GetProperty("propertyId").GetGuid(), row => row.GetProperty("count").GetInt32()));

        // A FrontDesk at A only: no Promotions (Manager only), Calendar of A alone.
        var desk = await OkAsync(e, Unseen, e.Desk);
        Assert.Equal(["calendar"], Keys(desk));
        Assert.Equal(1, MenuOf(desk, "calendar").GetProperty("count").GetInt32());

        var groups = (await OkAsync(e, $"{Unseen}/calendar/changes?propertyId={b}", e.Manager));
        Assert.Equal(2, groups.GetProperty("unseenEvents").GetInt32());
        Assert.Equal([2, 1], groups.GetProperty("groups").EnumerateArray().Select(group => group.GetProperty("events").GetInt32()).OrderDescending());
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{Unseen}/promotions/changes?propertyId={b}", e.Manager)));          // FrontDesk at B may not read Promotions
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{Unseen}/calendar/changes?propertyId={b}", e.Desk)));              // no membership at B
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Get($"{Unseen}/promotions/changes", e.Manager)));                      // Property required
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Get($"{Unseen}/promotions/changes?propertyId=not-a-guid", e.Manager)));

        // Promotions: an acknowledgement is per Property and only to the watermark sent; the answer is the whole entry.
        await AssertStatusAsync(HttpStatusCode.NotFound, Seen(e, "promotions", new { viewWatermark = "1", propertyId = b }, e.Manager));
        await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e, "promotions", new { viewWatermark = "1" }, e.Manager));
        await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e, "promotions", new { viewWatermark = "3", propertyId = e.A }, e.Manager));      // above the counter (2)
        var after = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Seen(e, "promotions", new { viewWatermark = "2", propertyId = e.A }, e.Manager)));
        Assert.Equal(0, after.GetProperty("count").GetInt32());
        var row = after.GetProperty("byProperty").EnumerateArray().Single();
        Assert.Equal(("2", "2"), (row.GetProperty("lastSeenWatermark").GetString(), row.GetProperty("currentWatermark").GetString()));

        // Calendar is acknowledged per object: the menu-level route answers 400 once permission and scope passed, and 404 before that.
        var entity = await RefusalAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e, "calendar", new { viewWatermark = "1", propertyId = e.A }, e.Manager)));
        Assert.Contains("menu-unseen-use-entity-seen", entity);
        await AssertStatusAsync(HttpStatusCode.NotFound, Seen(e, "calendar", new { viewWatermark = "1", propertyId = b }, e.Desk));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffEntitySeen" """));
    }

    [Fact]
    public async Task A_revoked_permission_takes_effect_on_the_next_request_even_with_a_valid_session()
    {
        using var e = await BeginAsync();
        await RecordAsync(e, "website-hero", Manager);
        Assert.Contains("website-hero", Keys(await OkAsync(e, Unseen)));
        await AssertStatusAsync(HttpStatusCode.OK, Seen(e, "website-hero", new { viewWatermark = "0" }));

        await CliAsync(e.Host, ["--staff-website-access", "--email", Site, "--enabled", "false"]);
        Assert.Equal(["calendar"], Keys(await OkAsync(e, Unseen)));
        await AssertStatusAsync(HttpStatusCode.NotFound, Seen(e, "website-hero", new { viewWatermark = "1" }));
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{Unseen}/website-hero/changes", e.Staff.Cookie)));
        Assert.Equal(0L, await ScalarAsync<long>("""SELECT coalesce(max("LastSeenSequence"), 0) FROM "StaffMenuSeen" WHERE "MenuKey" = 'website-hero' """));
    }

    // ---------------------------------------------------------------------------------------------------------- what counts

    [Fact]
    public async Task The_count_is_by_logical_event_after_the_baseline_own_events_and_the_cursor_and_history_keeps_everything()
    {
        using var e = await BeginAsync();
        await CliAsync(e.Host, ["--staff-blog-access", "--email", Desk, "--edit", "true", "--publish", "false"]);
        var chain = Guid.NewGuid();
        await RecordAsync(e, "blog-posts", Desk, entity: 9);                                         // 1: the reader's own event
        await RecordAsync(e, "blog-posts", Manager, entity: 8);                                      // 2: before the reader's account (D2)
        await ExecuteAsync("""UPDATE "AdminActivities" SET "OccurredAtUtc" = now() - interval '2 days' WHERE "Sequence" = 2 """);
        await RecordAsync(e, "blog-posts", Manager, "Created", entity: 1, correlation: chain);       // 3 \ one Save-then-Publish chain
        await RecordAsync(e, "blog-posts", Manager, "Published", entity: 1, correlation: chain);     // 4 /
        for (var n = 0; n < 5; n++) await RecordAsync(e, "blog-posts", Manager, "DraftSaved", entity: 2);   // 5-9: five independent saves
        await RecordAsync(e, "blog-posts", null, entity: 3);                                        // 10: no Staff caused it
        Assert.Equal(chain, await ScalarAsync<Guid>("""SELECT "CorrelationId" FROM "AdminActivities" WHERE "Sequence" = 4 """));

        async Task<int> Count() => MenuOf(await OkAsync(e, Unseen, e.Desk), "blog-posts").GetProperty("count").GetInt32();
        Assert.Equal(7, await Count());                                                              // 1 (chain) + 5 + 1
        var changes = await OkAsync(e, $"{Unseen}/blog-posts/changes", e.Desk);
        Assert.Equal((7, false), (changes.GetProperty("unseenEvents").GetInt32(), changes.GetProperty("hasMore").GetBoolean()));
        Assert.Equal([1, 5, 1], changes.GetProperty("groups").EnumerateArray().Select(group => group.GetProperty("events").GetInt32()));
        Assert.Equal("10", changes.GetProperty("snapshotWatermark").GetString());

        // Acknowledging the saved half of the chain leaves its publish as ONE unseen event; acknowledging the publish removes it.
        await AssertStatusAsync(HttpStatusCode.OK, Seen(e, "blog-posts", new { viewWatermark = "3" }, e.Desk));
        Assert.Equal(7, await Count());
        await AssertStatusAsync(HttpStatusCode.OK, Seen(e, "blog-posts", new { viewWatermark = "4" }, e.Desk));
        Assert.Equal(6, await Count());

        // The history shows every event: the reader's own and the one from before the baseline included.
        var page = await OkAsync(e, $"{History}?menu=blog-posts", e.Desk);
        Assert.Equal(10, page.GetProperty("items").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, page.GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public async Task The_unseen_list_shows_at_most_50_groups_and_the_exact_total_and_says_when_more_exist()
    {
        using var e = await BeginAsync();
        await CliAsync(e.Host, ["--staff-blog-access", "--email", Desk, "--edit", "true", "--publish", "false"]);
        var actor = await StaffIdAsync(Manager);
        // 60 objects, five of them saved three times: 70 events. Newest groups first, so the five busy ones and objects 60..16 are the 50 shown; objects 6..15 are cut.
        await BulkAsync("blog-posts", 1, 70, actor, "CASE WHEN n <= 60 THEN n ELSE (n - 61) % 5 + 1 END");
        await BulkAsync("blog-media", 1, 50, actor, "n");
        await BulkAsync("blog-categories", 1, 51, actor, "n");

        var changes = await OkAsync(e, $"{Unseen}/blog-posts/changes", e.Desk);
        var shown = changes.GetProperty("groups").EnumerateArray().ToList();
        Assert.Equal(50, shown.Count);
        Assert.True(changes.GetProperty("hasMore").GetBoolean());
        Assert.Equal(70, changes.GetProperty("unseenEvents").GetInt32());
        Assert.Equal(60, shown.Sum(group => group.GetProperty("events").GetInt32()));      // the visible groups never stand in for the total
        Assert.Equal(MenuOf(await OkAsync(e, Unseen, e.Desk), "blog-posts").GetProperty("count").GetInt32(), 70);

        var exact = await OkAsync(e, $"{Unseen}/blog-media/changes", e.Desk);
        Assert.Equal((50, 50, false), (exact.GetProperty("groups").GetArrayLength(), exact.GetProperty("unseenEvents").GetInt32(), exact.GetProperty("hasMore").GetBoolean()));
        var over = await OkAsync(e, $"{Unseen}/blog-categories/changes", e.Desk);
        Assert.Equal((50, 51, true), (over.GetProperty("groups").GetArrayLength(), over.GetProperty("unseenEvents").GetInt32(), over.GetProperty("hasMore").GetBoolean()));
    }

    private async Task BulkAsync(string menu, int from, int to, Guid actor, string objectOf)
    {
        await ExecuteAsync(
            $"""
            INSERT INTO "AdminActivities" ("MenuKey","Sequence","Id","PropertyId","ActorKind","ActorStaffId","Action","EntityKind","EntityKey","TitleSnapshot","ItemCount","CorrelationId","OccurredAtUtc")
            SELECT '{menu}', n, gen_random_uuid(), NULL, 'Staff', '{actor}', 'DraftSaved', 'post', md5(({objectOf})::text)::uuid::text, 'T', 1, NULL, now() FROM generate_series({from}, {to}) n;
            UPDATE "MenuActivityStreams" SET "LastSequence" = {to} WHERE "MenuKey" = '{menu}';
            """);
    }

    // ---------------------------------------------------------------------------------------------------------- acknowledge

    [Fact]
    public async Task A_cursor_only_moves_up_to_the_watermark_sent_and_a_future_or_malformed_watermark_is_refused()
    {
        using var e = await BeginAsync();
        await CliAsync(e.Host, ["--staff-blog-access", "--email", Desk, "--edit", "true", "--publish", "false"]);
        for (var n = 1; n <= 3; n++) await RecordAsync(e, "blog-posts", Manager, entity: n);

        // Reading never writes.
        await OkAsync(e, Unseen, e.Desk);
        await OkAsync(e, $"{Unseen}/blog-posts/changes", e.Desk);
        await OkAsync(e, $"{History}?menu=blog-posts", e.Desk);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffMenuSeen" """));

        var two = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Seen(e, "blog-posts", new { viewWatermark = "2" }, e.Desk)));
        Assert.Equal((1, "2", "3"), (two.GetProperty("count").GetInt32(), two.GetProperty("lastSeenWatermark").GetString()!, two.GetProperty("currentWatermark").GetString()!));
        var older = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Seen(e, "blog-posts", new { viewWatermark = "1" }, e.Desk)));
        Assert.Equal("2", older.GetProperty("lastSeenWatermark").GetString());               // an older acknowledgement arriving late changes nothing

        await RecordAsync(e, "blog-posts", Manager, entity: 4);
        Assert.Equal(2, MenuOf(await OkAsync(e, Unseen, e.Desk), "blog-posts").GetProperty("count").GetInt32());   // only what was sent is acknowledged

        foreach (var bad in new[] { "5", "9223372036854775807", "99999999999999999999", "01", "-1", "1.5", " 1", "1e1", "", "abc" })
            Assert.Equal("400 menu-unseen-watermark-invalid", (await RefusalAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e, "blog-posts", new { viewWatermark = bad }, e.Desk)))).Split(" Invalid")[0]);
        await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e, "blog-posts", new { }, e.Desk));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Post($"{Unseen}/blog-posts/seen", "{\"viewWatermark\":2}", e.Desk)));                  // a JSON number is refused
        await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e, "blog-posts", new { viewWatermark = "1", propertyId = e.A }, e.Desk));                          // a Property on a global menu
        Assert.Equal(2L, await ScalarAsync<long>("""SELECT "LastSeenSequence" FROM "StaffMenuSeen" """));
    }

    // ---------------------------------------------------------------------------------------------------------- history

    [Fact]
    public async Task History_pages_newest_first_with_an_opaque_cursor_bound_to_its_scope_and_filters()
    {
        using var e = await BeginAsync();
        var b = await AddPropertyAsync("hotel-b");
        await CliAsync(e.Host, ["--staff-grant", "--email", Manager, "--property-id", b.ToString(), "--role", StaffRole.FrontDesk]);
        for (var n = 1; n <= 7; n++) await RecordAsync(e, "calendar", n % 2 == 0 ? Site : Desk, property: n <= 5 ? e.A : b, entity: n);
        for (var n = 1; n <= 7; n++) await RecordAsync(e, "blog-posts", n <= 5 ? Manager : Site, entity: n);
        await CliAsync(e.Host, ["--staff-blog-access", "--email", Site, "--edit", "true", "--publish", "false"]);

        async Task<(long[] Sequences, string? Next)> PageAsync(string query, string? cookie = null)
        {
            var page = await OkAsync(e, $"{History}?{query}", cookie ?? e.Staff.Cookie);
            return ([.. page.GetProperty("items").EnumerateArray().Select(item => long.Parse(item.GetProperty("sequence").GetString()!))], page.GetProperty("nextCursor").GetString());
        }

        var first = await PageAsync("menu=blog-posts&limit=3");
        Assert.Equal([7L, 6, 5], first.Sequences);
        var second = await PageAsync($"menu=blog-posts&limit=3&cursor={first.Next}");
        Assert.Equal([4L, 3, 2], second.Sequences);
        var last = await PageAsync($"menu=blog-posts&limit=3&cursor={second.Next}");
        Assert.Equal([1L], last.Sequences);
        Assert.Null(last.Next);
        Assert.Equal([7L, 6], (await PageAsync($"menu=blog-posts&actorStaffId={await StaffIdAsync(Site)}")).Sequences);
        await ExecuteAsync("""UPDATE "AdminActivities" SET "OccurredAtUtc" = now() - interval '5 days' WHERE "MenuKey" = 'blog-posts' AND "Sequence" <= 3 """);
        var window = $"from={Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(-6).ToString("o"))}&to={Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(-4).ToString("o"))}";
        Assert.Equal([3L, 2, 1], (await PageAsync($"menu=blog-posts&{window}")).Sequences);

        // A cursor belongs to the menu, Property and filters it was made for; authorization never comes from it.
        var calendarA = await PageAsync($"menu=calendar&propertyId={e.A}&limit=2", e.Manager);
        Assert.Equal([5L, 4], calendarA.Sequences);
        var wrong = new[]
        {
            ($"menu=blog-media&limit=2&cursor={first.Next}", e.Staff.Cookie), ($"menu=blog-posts&actorStaffId={await StaffIdAsync(Site)}&cursor={first.Next}", e.Staff.Cookie),
            ($"menu=blog-posts&{window}&cursor={first.Next}", e.Staff.Cookie), ($"menu=calendar&propertyId={b}&cursor={calendarA.Next}", e.Manager),
            ("menu=blog-posts&cursor=garbage", e.Staff.Cookie), ("menu=blog-posts&cursor=e30", e.Staff.Cookie)
        };
        foreach (var (query, cookie) in wrong) Assert.Contains("activity-query-invalid", await RefusalAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Get($"{History}?{query}", cookie)))));
        foreach (var query in new[] { "", "menu=blog-posts&limit=0", "menu=blog-posts&limit=101", "menu=blog-posts&limit=abc", "menu=blog-posts&actorStaffId=x", "menu=blog-posts&from=yesterday", "menu=blog-posts&from=2026-02-01&to=2026-01-01" })
            await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Get($"{History}?{query}", e.Staff.Cookie)));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Get($"{History}?menu=calendar", e.Manager)));                      // Property required
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{History}?menu=promotions&propertyId={b}", e.Manager)));        // FrontDesk at B: no Promotions
    }

    // ---------------------------------------------------------------------------------------------------------- Newsletter parity

    [Fact]
    public async Task The_Newsletter_through_the_shared_routes_counts_and_acknowledges_exactly_like_the_legacy_routes_and_lists_from_the_legacy_tables()
    {
        using var e = await BeginAsync();
        var subscription = Guid.NewGuid();
        // Three legacy verifications of one subscription; the first is OLDER than every Staff account, and the Staff member has no cursor row.
        await ExecuteAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES ('{subscription}','verified@example.com','homepage','Verified',now() - interval '9 days',now() - interval '8 days');
            INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (1,'{subscription}',now() - interval '5 days'),(2,'{subscription}',now()),(3,'{subscription}',now());
            UPDATE "MenuActivityStreams" SET "LastSequence" = 3 WHERE "MenuKey" = 'newsletter';
            """);

        async Task<(int, string, string)> Both(bool shared)
        {
            var entry = shared ? MenuOf(await OkAsync(e, Unseen), "newsletter") : (await OkAsync(e, LegacyUnseen)).GetProperty("newsletter");
            return (entry.GetProperty("count").GetInt32(), entry.GetProperty("lastSeenWatermark").GetString()!, entry.GetProperty("currentWatermark").GetString()!);
        }

        Assert.Equal((3, "0", "3"), await Both(false));
        Assert.Equal(await Both(false), await Both(true));

        var changes = await OkAsync(e, $"{Unseen}/newsletter/changes");
        Assert.Equal((3, false), (changes.GetProperty("unseenEvents").GetInt32(), changes.GetProperty("hasMore").GetBoolean()));
        var group = changes.GetProperty("groups").EnumerateArray().Single();
        Assert.Equal((3, "a subscription", "Public"), (group.GetProperty("events").GetInt32(), group.GetProperty("titleSnapshot").GetString()!, group.GetProperty("actors")[0].GetProperty("kind").GetString()!));
        Assert.DoesNotContain("verified@example.com", changes.GetRawText());

        // Acknowledge through one route, read through the other; the same refusals.
        Assert.Equal("2", (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Seen(e, "newsletter", new { viewWatermark = "2" })))).GetProperty("lastSeenWatermark").GetString());
        Assert.Equal((1, "2", "3"), await Both(false));
        await AssertStatusAsync(HttpStatusCode.OK, e.Http.SendAsync(Post($"{LegacyUnseen}/newsletter/seen", new { viewWatermark = "3" }, e.Staff.Cookie)));
        Assert.Equal((0, "3", "3"), await Both(true));
        await AssertStatusAsync(HttpStatusCode.BadRequest, Seen(e, "newsletter", new { viewWatermark = "4" }));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Http.SendAsync(Post($"{LegacyUnseen}/newsletter/seen", new { viewWatermark = "4" }, e.Staff.Cookie)));

        var history = await OkAsync(e, $"{History}?menu=newsletter&limit=2");
        Assert.Equal(["3", "2"], history.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("sequence").GetString()));
        Assert.Equal("Public", history.GetProperty("items")[0].GetProperty("actorKind").GetString());
        Assert.Equal(0, (await OkAsync(e, $"{History}?menu=newsletter&actorStaffId={await StaffIdAsync(Site)}")).GetProperty("items").GetArrayLength());

        // Without the website permission the Newsletter is absent and refused like an unknown menu; the legacy route keeps its 403.
        Assert.DoesNotContain("newsletter", Keys(await OkAsync(e, Unseen, e.Desk)));
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Http.SendAsync(Get($"{Unseen}/newsletter/changes", e.Desk)));
        await AssertStatusAsync(HttpStatusCode.Forbidden, e.Http.SendAsync(Get(LegacyUnseen, e.Desk)));
    }
}
