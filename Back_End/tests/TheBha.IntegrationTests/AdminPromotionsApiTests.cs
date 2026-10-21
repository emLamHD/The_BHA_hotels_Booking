using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Controllers;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BOOKING-PROMOTIONS-001 / ADR 0009: the Admin promotion routes are per Property (a Manager of that Property), audited, versioned,
/// idempotent on create, and refuse every rule that would make a price wrong — against real PostgreSQL and the real Staff login.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminPromotionsApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string OtherManager = "other-manager@example.com";
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-15T00:00:00Z");

    private sealed record Fixture(WebApplicationFactory<Program> Host, HttpClient Client, Guid PropertyId, Guid OtherPropertyId, Guid RoomTypeA, Guid RoomTypeB, Guid ForeignRoomType, string ManagerCookie)
        : IDisposable
    {
        public string Url => $"/api/admin/v1/properties/{PropertyId}/promotions";

        public void Dispose()
        {
            Client.Dispose();
            Host.Dispose();
        }
    }

    private async Task<Fixture> StartFixtureAsync(AdminCalendarAccessMode mode = AdminCalendarAccessMode.Staff)
    {
        var host = CreateHost(mode);
        var propertyId = await SeedStaffAsync(host);
        Guid roomA, roomB, otherId, foreign;
        await using (var context = Factory.CreateDbContext())
        {
            var property = await context.Properties.SingleAsync(x => x.Id == propertyId);
            var other = new Property(Guid.NewGuid(), "Other Hotel", "other-hotel", null, "2 Street", "Hue", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
            context.Add(other);
            var a = new RoomType(Guid.NewGuid(), property.Id, "RA", "Room A", "room-a", null, 2, 4, true, Now);
            var b = new RoomType(Guid.NewGuid(), property.Id, "RB", "Room B", "room-b", null, 2, 4, true, Now);
            var f = new RoomType(Guid.NewGuid(), other.Id, "RF", "Room F", "room-f", null, 2, 4, true, Now);
            var plan = new RatePlan(Guid.NewGuid(), property.Id, "STD", "Standard", null, "VND", true, Now);
            context.AddRange(a, b, f, plan);
            await context.SaveChangesAsync();
            for (var day = 0; day < 40; day++)
            {
                context.Add(new DailyRoomRate(Guid.NewGuid(), property.Id, a.Id, plan.Id, new DateOnly(2026, 10, 15).AddDays(day), 1_000_000m, Now));
            }

            await context.SaveChangesAsync();
            (roomA, roomB, otherId, foreign) = (a.Id, b.Id, other.Id, f.Id);
        }

        await CliAsync(host, ["--staff-create", "--email", OtherManager, "--property-id", otherId.ToString(), "--role", StaffRole.Manager], Password);
        var client = CreateHttpsClient(host);
        return new Fixture(host, client, propertyId, otherId, roomA, roomB, foreign, await LoginAsync(client, Manager));
    }

    private static JsonObject Body(Fixture f, Action<JsonObject>? change = null)
    {
        var body = new JsonObject
        {
            ["slug"] = "dat-som",
            ["title"] = "Ưu đãi đặt sớm",
            ["summary"] = "Giảm 15% khi đặt trước",
            ["body"] = new JsonArray("Áp dụng cho kỳ nghỉ từ 2 đêm.", "Không áp dụng cùng ưu đãi khác."),
            ["kind"] = "Percent",
            ["value"] = 15,
            ["allRoomTypes"] = false,
            ["roomTypeIds"] = new JsonArray(f.RoomTypeA.ToString()),
            ["minNights"] = 2,
            ["showOnHomepage"] = false,
            ["sortOrder"] = 10
        };
        change?.Invoke(body);
        return body;
    }

    private static HttpRequestMessage Create(Fixture f, JsonObject body, string cookie, Guid? key = null)
    {
        var request = Post(f.Url, body.ToJsonString(), cookie);
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        return request;
    }

    private static Task<HttpResponseMessage> Send(Fixture f, HttpRequestMessage request) => f.Client.SendAsync(request);

    private async Task<JsonElement> CreateOkAsync(Fixture f, JsonObject? body = null, Guid? key = null) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Create(f, body ?? Body(f), f.ManagerCookie, key))));

    private static JsonObject SaveBody(JsonElement editor, int? expectedVersion = null, Action<JsonObject>? change = null)
    {
        var promotion = new JsonObject
        {
            ["slug"] = editor.GetProperty("slug").GetString(),
            ["title"] = editor.GetProperty("title").GetString(),
            ["summary"] = editor.GetProperty("summary").GetString(),
            ["body"] = JsonNode.Parse(editor.GetProperty("body").GetRawText()),
            ["coverMediaId"] = editor.GetProperty("coverMediaId").ValueKind == JsonValueKind.Null ? null : editor.GetProperty("coverMediaId").GetString(),
            ["coverAltText"] = editor.GetProperty("coverAltText").ValueKind == JsonValueKind.Null ? null : editor.GetProperty("coverAltText").GetString(),
            ["kind"] = editor.GetProperty("kind").GetString(),
            ["value"] = editor.GetProperty("value").GetDecimal(),
            ["currencyCode"] = editor.GetProperty("currencyCode").ValueKind == JsonValueKind.Null ? null : editor.GetProperty("currencyCode").GetString(),
            ["allRoomTypes"] = editor.GetProperty("allRoomTypes").GetBoolean(),
            ["roomTypeIds"] = JsonNode.Parse(editor.GetProperty("roomTypeIds").GetRawText()),
            ["minNights"] = editor.GetProperty("minNights").GetInt32(),
            ["showOnHomepage"] = editor.GetProperty("showOnHomepage").GetBoolean(),
            ["sortOrder"] = editor.GetProperty("sortOrder").GetInt32()
        };
        change?.Invoke(promotion);
        return new JsonObject { ["expectedVersion"] = expectedVersion ?? editor.GetProperty("version").GetInt32(), ["promotion"] = promotion };
    }

    // ---- authorization ----

    [Fact]
    public async Task Only_a_Manager_of_the_Property_can_use_the_promotion_routes()
    {
        using var f = await StartFixtureAsync();
        var created = await CreateOkAsync(f);
        var id = created.GetProperty("id").GetString();
        var desk = await LoginAsync(f.Client, Desk);
        var site = await LoginAsync(f.Client, Site);                 // FrontDesk who also holds the global website permission
        var otherManager = await LoginAsync(f.Client, OtherManager);  // Manager, but of another Property

        var routes = new (string Name, Func<string?, HttpRequestMessage> Request)[]
        {
            ("list", c => Get(f.Url, c)),
            ("get", c => Get($"{f.Url}/{id}", c)),
            ("room types", c => Get($"{f.Url}/room-types", c)),
            ("create", c => Create(f, Body(f, b => b["slug"] = "x-" + Guid.NewGuid().ToString("N")[..6]), c!)),
            ("save", c => Post($"{f.Url}/{id}/save", SaveBody(created).ToJsonString(), c)),
            ("status", c => Post($"{f.Url}/{id}/status", new { expectedVersion = 1, status = "Active" }, c))
        };
        foreach (var (name, request) in routes)
        {
            Assert.True(HttpStatusCode.Unauthorized == (await Send(f, request(null))).StatusCode, $"{name}: anonymous");
            Assert.True(HttpStatusCode.Forbidden == (await Send(f, request(desk))).StatusCode, $"{name}: FrontDesk");
            Assert.True(HttpStatusCode.Forbidden == (await Send(f, request(site))).StatusCode, $"{name}: global website permission is not a promotion permission");
            Assert.True(HttpStatusCode.Forbidden == (await Send(f, request(otherManager))).StatusCode, $"{name}: Manager of another Property");
        }

        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get(f.Url, f.ManagerCookie)));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "Promotions" """));   // none of the refused creates stored anything
    }

    [Fact]
    public async Task The_routes_do_not_exist_in_LocalGate_mode()
    {
        using var f = await StartFixtureAsync(AdminCalendarAccessMode.LocalGate);

        var response = await Send(f, Get(f.Url));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_cookie_is_the_only_actor_the_body_cannot_name_one()
    {
        using var f = await StartFixtureAsync();
        var body = Body(f);
        body["actorStaffId"] = Guid.NewGuid().ToString();
        body["role"] = "Manager";

        var created = await CreateOkAsync(f, body);

        Assert.Equal((await StaffIdAsync(Manager)).ToString(), created.GetProperty("updatedByStaffId").GetString());
    }

    [Fact]
    public void Every_action_of_the_promotion_controller_demands_the_per_property_permission()
    {
        var actions = typeof(AdminPromotionsController).GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly);

        Assert.NotEmpty(actions);
        Assert.All(actions, action =>
        {
            var gate = Assert.Single(action.GetCustomAttributes(typeof(StaffCalendarPermissionAttribute), inherit: false).Cast<StaffCalendarPermissionAttribute>());
            Assert.Equal(StaffPermission.PromotionManage, gate.Permission);
        });
        Assert.True(StaffPermissions.RoleGrants(StaffRole.Manager, StaffPermission.PromotionManage));
        Assert.False(StaffPermissions.RoleGrants(StaffRole.FrontDesk, StaffPermission.PromotionManage));
        Assert.False(StaffPermissions.RoleGrants(null, StaffPermission.PromotionManage));
    }

    // ---- create, idempotency, audit ----

    [Fact]
    public async Task Create_makes_a_draft_priced_nowhere_and_audits_it()
    {
        using var f = await StartFixtureAsync();

        var created = await CreateOkAsync(f);

        Assert.Equal("Draft", created.GetProperty("status").GetString());
        Assert.Equal(1, created.GetProperty("version").GetInt32());
        Assert.False(created.GetProperty("publicNow").GetBoolean());
        Assert.Equal("dat-som", created.GetProperty("slug").GetString());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "PromotionAudits" WHERE "Action" = 'create' AND "After" IS NOT NULL AND "Before" IS NULL """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "PromotionRoomTypes" """));
    }

    [Fact]
    public async Task Create_needs_an_operation_id_and_a_retry_with_it_does_not_duplicate()
    {
        using var f = await StartFixtureAsync();
        await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, Post(f.Url, Body(f).ToJsonString(), f.ManagerCookie)));

        var key = Guid.NewGuid();
        var first = await CreateOkAsync(f, key: key);
        var retry = await CreateOkAsync(f, key: key);

        Assert.Equal(first.GetProperty("id").GetString(), retry.GetProperty("id").GetString());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "Promotions" """));

        var reused = await AssertStatusAsync(HttpStatusCode.Conflict, Send(f, Create(f, Body(f, b => b["title"] = "Khác"), f.ManagerCookie, key)));
        Assert.Equal("idempotency-key-reused", (await ProblemAsync(reused)).Code);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "Promotions" """));
    }

    [Fact]
    public async Task A_slug_is_unique_across_the_site()
    {
        using var f = await StartFixtureAsync();
        await CreateOkAsync(f);

        var duplicate = await AssertStatusAsync(HttpStatusCode.Conflict, Send(f, Create(f, Body(f), f.ManagerCookie)));

        Assert.Equal(("slug-taken", "slug"), await ProblemAsync(duplicate));
    }

    // ---- validation ----

    public static TheoryData<string, string> InvalidChanges => new()
    {
        { "percent of 100 (a free booking)", "value" },
        { "percent of 0", "value" },
        { "percent with three decimals", "value" },
        { "fixed VND with a fraction", "value" },
        { "fixed without a currency", "currencyCode" },
        { "booking window reversed", "bookingTo" },
        { "stay window reversed", "stayTo" },
        { "display window reversed", "displayTo" },
        { "no room types", "roomTypeIds" },
        { "a room type of another property", "roomTypeIds" },
        { "minimum nights zero", "minNights" },
        { "homepage without a cover", "showOnHomepage" },
        { "slug with capitals", "slug" },
        { "empty title", "title" },
        { "markup in the summary", "summary" },
        { "a paragraph with a line break", "body1" }
    };

    [Theory]
    [MemberData(nameof(InvalidChanges))]
    public async Task A_rule_that_would_make_a_price_wrong_is_refused_with_the_field(string change, string field)
    {
        using var f = await StartFixtureAsync();
        Action<JsonObject> apply = change switch
        {
            "percent of 100 (a free booking)" => b => b["value"] = 100,
            "percent of 0" => b => b["value"] = 0,
            "percent with three decimals" => b => b["value"] = 12.345,
            "fixed VND with a fraction" => b => { b["kind"] = "FixedAmount"; b["currencyCode"] = "VND"; b["value"] = 100000.5; },
            "fixed without a currency" => b => { b["kind"] = "FixedAmount"; b["value"] = 100000; },
            "booking window reversed" => b => { b["bookingFrom"] = "2026-11-02"; b["bookingTo"] = "2026-11-01"; },
            "stay window reversed" => b => { b["stayFrom"] = "2026-11-02"; b["stayTo"] = "2026-11-01"; },
            "display window reversed" => b => { b["displayFrom"] = "2026-11-02"; b["displayTo"] = "2026-11-01"; },
            "no room types" => b => b["roomTypeIds"] = new JsonArray(),
            "a room type of another property" => b => b["roomTypeIds"] = new JsonArray(f.ForeignRoomType.ToString()),
            "minimum nights zero" => b => b["minNights"] = 0,
            "homepage without a cover" => b => b["showOnHomepage"] = true,
            "slug with capitals" => b => b["slug"] = "Dat-Som",
            "empty title" => b => b["title"] = " ",
            "markup in the summary" => b => b["summary"] = "<b>bold</b>",
            _ => b => b["body"] = new JsonArray("line one\nline two")
        };

        var response = await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, Create(f, Body(f, apply), f.ManagerCookie)));

        Assert.Equal(field, (await ProblemAsync(response)).Field);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "Promotions" """));
    }

    [Fact]
    public async Task A_discount_that_would_take_a_night_below_the_smallest_price_is_refused_against_the_real_rates()
    {
        using var f = await StartFixtureAsync();

        // The lowest rate of Room A is 1,000,000: a fixed 1,000,000 would leave 0; 999,999 leaves 1 (the smallest valid price).
        var tooMuch = Body(f, b => { b["kind"] = "FixedAmount"; b["currencyCode"] = "VND"; b["value"] = 1_000_000; });
        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, Create(f, tooMuch, f.ManagerCookie)));
        Assert.Equal("value", (await ProblemAsync(refused)).Field);

        var justFits = Body(f, b => { b["kind"] = "FixedAmount"; b["currencyCode"] = "VND"; b["value"] = 999_999; });
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Create(f, justFits, f.ManagerCookie)));
    }

    // ---- concurrency and status ----

    [Fact]
    public async Task A_save_from_a_stale_tab_is_refused_and_overwrites_nothing()
    {
        using var f = await StartFixtureAsync();
        var created = await CreateOkAsync(f);
        var id = created.GetProperty("id").GetString();
        var tabA = SaveBody(created, change: p => p["title"] = "Từ tab A");
        var tabB = SaveBody(created, change: p => p["title"] = "Từ tab B");

        var first = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{id}/save", tabA.ToJsonString(), f.ManagerCookie))));
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, Send(f, Post($"{f.Url}/{id}/save", tabB.ToJsonString(), f.ManagerCookie)));

        Assert.Equal(2, first.GetProperty("version").GetInt32());
        Assert.Equal(("stale-version", null), await ProblemAsync(stale));
        Assert.Equal("Từ tab A", await ScalarAsync<string>($"""SELECT "Title" FROM "Promotions" WHERE "Id" = '{id}' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "PromotionAudits" WHERE "Action" = 'save' """));
        Assert.True(await ScalarAsync<bool>("""SELECT "Before" IS NOT NULL AND "After" IS NOT NULL FROM "PromotionAudits" WHERE "Action" = 'save' """));
    }

    [Fact]
    public async Task Status_follows_Draft_Active_Disabled_Active_and_each_change_is_versioned_and_audited()
    {
        using var f = await StartFixtureAsync();
        var created = await CreateOkAsync(f);
        var id = created.GetProperty("id").GetString();
        string Status(int version, string status) => new JsonObject { ["expectedVersion"] = version, ["status"] = status }.ToJsonString();

        await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, Post($"{f.Url}/{id}/status", Status(1, "Draft"), f.ManagerCookie)));
        await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, Post($"{f.Url}/{id}/status", Status(1, "Disabled"), f.ManagerCookie)));   // Draft -> Disabled is not allowed
        var active = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{id}/status", Status(1, "Active"), f.ManagerCookie))));
        Assert.Equal(("Active", 2), (active.GetProperty("status").GetString(), active.GetProperty("version").GetInt32()));

        await AssertStatusAsync(HttpStatusCode.Conflict, Send(f, Post($"{f.Url}/{id}/status", Status(1, "Disabled"), f.ManagerCookie)));   // stale version
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{id}/status", Status(2, "Disabled"), f.ManagerCookie)));
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{id}/status", Status(3, "Active"), f.ManagerCookie))));

        Assert.Equal(4, again.GetProperty("version").GetInt32());
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "PromotionAudits" WHERE "Action" = 'status' """));
    }

    [Fact]
    public async Task The_list_filters_by_status_and_search_and_never_shows_another_propertys_promotions()
    {
        using var f = await StartFixtureAsync();
        var one = await CreateOkAsync(f);
        await CreateOkAsync(f, Body(f, b => { b["slug"] = "cuoi-tuan"; b["title"] = "Cuối tuần"; }));
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{one.GetProperty("id").GetString()}/status", new { expectedVersion = 1, status = "Active" }, f.ManagerCookie)));
        var otherManager = await LoginAsync(f.Client, OtherManager);

        var active = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get($"{f.Url}?status=Active", f.ManagerCookie))));
        var search = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get($"{f.Url}?q=cu%E1%BB%91i", f.ManagerCookie))));
        var all = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get(f.Url, f.ManagerCookie))));
        var theirs = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get($"/api/admin/v1/properties/{f.OtherPropertyId}/promotions", otherManager))));

        Assert.Single(active.EnumerateArray());
        Assert.Equal("cuoi-tuan", Assert.Single(search.EnumerateArray()).GetProperty("slug").GetString());
        Assert.Equal(2, all.GetArrayLength());
        Assert.Equal(0, theirs.GetArrayLength());
        await AssertStatusAsync(HttpStatusCode.NotFound, Send(f, Get($"{f.Url}/{Guid.NewGuid()}", f.ManagerCookie)));
        // another Property's id on this route is simply not found, not a leak
        var foreign = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get(f.Url, f.ManagerCookie))));
        Assert.All(foreign.EnumerateArray(), item => Assert.Equal(f.PropertyId.ToString(), item.GetProperty("propertyId").GetString()));
    }

    // ---- homepage placement does not touch pricing ----

    [Fact]
    public async Task Showing_a_promotion_on_the_homepage_is_a_content_choice_and_does_not_change_its_status_or_version_rules()
    {
        using var f = await StartFixtureAsync();
        var png = await UploadAsync(f, "cover.png");
        var created = await CreateOkAsync(f, Body(f, b =>
        {
            b["coverMediaId"] = png.GetProperty("id").GetString();
            b["coverAltText"] = "Phòng nhìn ra sông";
            b["showOnHomepage"] = true;
        }));
        await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{created.GetProperty("id").GetString()}/status", new { expectedVersion = 1, status = "Active" }, f.ManagerCookie)));
        var activeAndShown = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get($"{f.Url}/{created.GetProperty("id").GetString()}", f.ManagerCookie))));
        Assert.True(activeAndShown.GetProperty("publicNow").GetBoolean());

        var hidden = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post(
            $"{f.Url}/{created.GetProperty("id").GetString()}/save", SaveBody(activeAndShown, change: p => p["showOnHomepage"] = false).ToJsonString(), f.ManagerCookie))));

        Assert.Equal("Active", hidden.GetProperty("status").GetString());   // still Active: it still prices
        Assert.False(hidden.GetProperty("publicNow").GetBoolean());
        Assert.False(hidden.GetProperty("showOnHomepage").GetBoolean());
    }

    // ---- translations ----

    [Fact]
    public async Task Texts_of_another_language_are_saved_with_the_promotion_read_back_and_removed_when_emptied()
    {
        using var f = await StartFixtureAsync();
        await ScalarAsync<int>("""UPDATE "WebsiteLanguages" SET "IsActive" = true WHERE "NormalizedCode" = 'en' RETURNING 1""");
        var created = await CreateOkAsync(f);
        var id = created.GetProperty("id").GetString();

        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{id}/save", SaveBody(created, change: p =>
            p["translations"] = new JsonObject
            {
                ["en"] = new JsonObject { ["title"] = "Early bird", ["summary"] = "15% off", ["body"] = new JsonArray("Two nights minimum.") }
            }).ToJsonString(), f.ManagerCookie))));

        var en = saved.GetProperty("translations").GetProperty("en");
        Assert.Equal("Early bird", en.GetProperty("title").GetString());
        Assert.Equal("Two nights minimum.", en.GetProperty("body")[0].GetString());
        Assert.Equal("Early bird", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.promotion.{id}.title' """));

        var emptied = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, Post($"{f.Url}/{id}/save", SaveBody(saved, change: p =>
            p["translations"] = new JsonObject { ["en"] = new JsonObject { ["title"] = "", ["summary"] = "15% off", ["body"] = new JsonArray() } }).ToJsonString(), f.ManagerCookie))));
        Assert.Equal(JsonValueKind.Null, emptied.GetProperty("translations").GetProperty("en").GetProperty("title").ValueKind);
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" = 'content.promotion.{id}.title' """));

        var unknown = await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, Post($"{f.Url}/{id}/save", SaveBody(emptied, change: p =>
            p["translations"] = new JsonObject { ["zz"] = new JsonObject { ["title"] = "x" } }).ToJsonString(), f.ManagerCookie)));
        Assert.Equal("translations", (await ProblemAsync(unknown)).Field);
        var vi = await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, Post($"{f.Url}/{id}/save", SaveBody(emptied, change: p =>
            p["translations"] = new JsonObject { ["vi"] = new JsonObject { ["title"] = "x" } }).ToJsonString(), f.ManagerCookie)));
        Assert.Equal("translations", (await ProblemAsync(vi)).Field);
    }

    // ---- cover picture ----

    [Fact]
    public async Task A_cover_is_uploaded_by_a_Manager_checked_by_its_bytes_and_previewed_only_inside_its_Property()
    {
        using var f = await StartFixtureAsync();

        var media = await UploadAsync(f, "cover.png");
        var mediaId = media.GetProperty("id").GetString();
        Assert.Equal(("image/png", 800, 600), (media.GetProperty("contentType").GetString(), media.GetProperty("width").GetInt32(), media.GetProperty("height").GetInt32()));

        var preview = await AssertStatusAsync(HttpStatusCode.OK, Send(f, Get($"{f.Url}/media/{mediaId}", f.ManagerCookie)));
        Assert.Equal("image/png", preview.Content.Headers.ContentType?.MediaType);
        Assert.Contains("private", preview.Headers.CacheControl!.ToString());
        Assert.Equal("nosniff", preview.Headers.GetValues("X-Content-Type-Options").Single());

        var otherManager = await LoginAsync(f.Client, OtherManager);
        await AssertStatusAsync(HttpStatusCode.NotFound, Send(f, Get($"/api/admin/v1/properties/{f.OtherPropertyId}/promotions/media/{mediaId}", otherManager)));
        await AssertStatusAsync(HttpStatusCode.Forbidden, Send(f, Get($"{f.Url}/media/{mediaId}", otherManager)));
        await AssertStatusAsync(HttpStatusCode.Forbidden, Send(f, UploadRequest(f, "cover.png", await LoginAsync(f.Client, Desk))));
        Assert.StartsWith("promo/", await ScalarAsync<string>("""SELECT "StorageKey" FROM "PromotionMedia" """));
    }

    [Fact]
    public async Task A_cover_that_is_too_small_not_a_picture_or_from_another_property_is_refused()
    {
        using var f = await StartFixtureAsync();

        var small = await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, UploadRequest(f, "small.png", f.ManagerCookie)));
        Assert.Equal(("promotion-image-too-small", "file"), await ProblemAsync(small));

        var notAPicture = new HttpRequestMessage(HttpMethod.Post, $"{f.Url}/media") { Content = Multipart([1, 2, 3, 4], "image/png") };
        notAPicture.Headers.Add("Cookie", f.ManagerCookie);
        notAPicture.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        await AssertStatusAsync(HttpStatusCode.BadRequest, Send(f, notAPicture));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "PromotionMedia" """));

        // A cover uploaded under another Property cannot be attached here.
        var otherManager = await LoginAsync(f.Client, OtherManager);
        var theirs = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, UploadRequest(f, "cover.png", otherManager, f.OtherPropertyId))));
        var attach = await AssertStatusAsync(HttpStatusCode.Conflict, Send(f, Create(f, Body(f, b => { b["coverMediaId"] = theirs.GetProperty("id").GetString(); b["coverAltText"] = "x"; }), f.ManagerCookie)));
        Assert.Equal("promotion-media-missing", (await ProblemAsync(attach)).Code);
    }

    private async Task<JsonElement> UploadAsync(Fixture f, string file) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Send(f, UploadRequest(f, file, f.ManagerCookie))));

    private static HttpRequestMessage UploadRequest(Fixture f, string file, string cookie, Guid? propertyId = null)
    {
        var bytes = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "promotion", file));
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/admin/v1/properties/{propertyId ?? f.PropertyId}/promotions/media") { Content = Multipart(bytes, "image/png") };
        request.Headers.Add("Cookie", cookie);
        request.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        return request;
    }

    private static MultipartFormDataContent Multipart(byte[] bytes, string partType)
    {
        var content = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse(partType);
        content.Add(part, "file", "cover.png");
        return content;
    }
}
