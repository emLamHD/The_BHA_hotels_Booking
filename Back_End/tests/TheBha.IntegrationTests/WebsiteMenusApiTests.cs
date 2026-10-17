using System.Net;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP04 acceptance (the header navigation, server side): the seed is the menu the header showed plus FAQ
/// after Blog; one Save applies the whole tree, links and labels or nothing; a stale revision (the tree's or any label's) is a
/// 409; the public read carries only what a visitor sees, in the visitor's language, and changes the moment a Save commits.
/// Real PostgreSQL through the real routes; the same Staff boundary as the other website routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteMenusApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/admin/v1/website/menus";
    private const string Public = "/api/v1/website/menus";

    private sealed record Node(Guid Id, Guid? ParentId, string? Placement, bool IsEnabled, string Href, bool OpenInNewTab, Dictionary<string, string?> Labels);

    private async Task<(string Revision, int Version, List<Node> Items)> LoadAsync(Session session)
    {
        var body = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Url)));
        var items = body.GetProperty("items").EnumerateArray().Select(item => new Node(
            item.GetProperty("id").GetGuid(),
            item.GetProperty("parentId").ValueKind == JsonValueKind.Null ? null : item.GetProperty("parentId").GetGuid(),
            item.GetProperty("placement").ValueKind == JsonValueKind.Null ? null : item.GetProperty("placement").GetString(),
            item.GetProperty("isEnabled").GetBoolean(),
            item.GetProperty("href").GetString()!,
            item.GetProperty("openInNewTab").GetBoolean(),
            item.GetProperty("labels").EnumerateObject().ToDictionary(label => label.Name, label => label.Value.ValueKind == JsonValueKind.Null ? null : label.Value.GetString()))).ToList();
        return (body.GetProperty("revision").GetString()!, body.GetProperty("version").GetInt32(), items);
    }

    private static object Payload(string revision, IEnumerable<Node> items) =>
        new
        {
            expectedRevision = revision,
            items = items.Select(item => new { id = item.Id, parentId = item.ParentId, placement = item.Placement, isEnabled = item.IsEnabled, href = item.Href, openInNewTab = item.OpenInNewTab, labels = item.Labels }).ToArray()
        };

    private Task<HttpResponseMessage> SaveAsync(Session session, string revision, IEnumerable<Node> items) =>
        session.PostAsync($"{Url}/save", Payload(revision, items));

    private async Task<JsonElement> PublicAsync(Session session, string query = "") =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get($"{Public}{query}"))));

    private static IEnumerable<string> Labels(JsonElement nodes) =>
        nodes.EnumerateArray().Select(node => node.GetProperty("label").GetString()!);

    private static Node WithLabel(Node node, string code, string? text) => node with { Labels = new Dictionary<string, string?>(node.Labels) { [code] = text } };

    private static Node RootNamed(List<Node> items, string vi) => items.Single(item => item.ParentId is null && item.Labels["vi"] == vi);

    [Fact]
    public async Task The_seed_is_the_header_menu_with_faq_after_blog_and_every_label_in_vi_and_en()
    {
        using var session = await StartAsync();
        var (_, version, items) = await LoadAsync(session);

        Assert.Equal(1, version);
        Assert.Equal(54, items.Count);
        var primary = items.Where(item => item.ParentId is null && item.Placement == "primary").Select(item => item.Labels["vi"]).ToArray();
        Assert.Equal(["Riverside", "Ưu đãi", "Blog", "FAQ", "Dịch vụ"], primary);
        Assert.Equal(["Giao diện mẫu"], items.Where(item => item.ParentId is null && item.Placement == "secondary").Select(item => item.Labels["vi"]).ToArray());
        var faq = RootNamed(items, "FAQ");
        Assert.Equal("/faq", faq.Href);
        Assert.All(items, item => Assert.True(item.IsEnabled));
        Assert.All(items, item => Assert.False(string.IsNullOrWhiteSpace(item.Labels["en"])));      // English came with the seed
        Assert.All(items, item => Assert.Null(MenuText.ValidateHref(item.Href)));

        // The deepest chain is four levels (root, group, page, sub-page): the template's tree fits.
        int Depth(Node node) => node.ParentId is { } parent ? 1 + Depth(items.Single(item => item.Id == parent)) : 1;
        Assert.Equal(4, items.Max(Depth));
    }

    [Fact]
    public async Task The_public_menu_is_the_enabled_tree_in_the_visitors_language_with_nothing_administrative_in_it()
    {
        using var session = await StartAsync();
        await CompleteContentAsync("en");       // the test Property's own texts: the one thing the test seed leaves out
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/languages/en/update", new { expectedVersion = 1, displayName = "English", nativeName = "English", sortOrder = 20, isActive = true }));

        var vi = await PublicAsync(session, "?locale=vi");
        Assert.Equal("vi", vi.GetProperty("locale").GetString());
        Assert.Equal(["Riverside", "Ưu đãi", "Blog", "FAQ", "Dịch vụ"], Labels(vi.GetProperty("primary")));
        Assert.Equal(["Giao diện mẫu"], Labels(vi.GetProperty("secondary")));
        var en = await PublicAsync(session, "?locale=en");
        Assert.Equal("en", en.GetProperty("locale").GetString());
        Assert.Equal(["Riverside", "Offers", "Blog", "FAQ", "Services"], Labels(en.GetProperty("primary")));
        Assert.Equal(["All posts", "Featured destinations", "Travel news"], Labels(en.GetProperty("primary")[2].GetProperty("children")));
        // An unknown or disabled language is answered in the default language, saying so.
        var other = await PublicAsync(session, "?locale=zz");
        Assert.Equal("vi", other.GetProperty("locale").GetString());

        // No Staff id, no draft, no administrative field — the whole body is the visitor's menu.
        var text = en.GetRawText();
        foreach (var forbidden in new[] { "updatedBy", "staff", "isEnabled", "placement", "version", "expected" })
        {
            Assert.DoesNotContain(forbidden, text, StringComparison.OrdinalIgnoreCase);
        }

        // Revalidated on every request, and a conditional request costs a 304.
        var response = await session.Client.SendAsync(Get($"{Public}?locale=en"));
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());
        var etag = response.Headers.ETag!.ToString();
        var request = Get($"{Public}?locale=en");
        request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        Assert.Equal(HttpStatusCode.NotModified, (await session.Client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task One_save_applies_tree_links_order_visibility_and_labels_together_and_the_public_menu_follows()
    {
        using var session = await StartAsync();
        var (revision, _, items) = await LoadAsync(session);
        var staff = await StaffIdAsync(Site);

        var riverside = RootNamed(items, "Riverside");
        var offers = RootNamed(items, "Ưu đãi");
        var blog = RootNamed(items, "Blog");
        var faq = RootNamed(items, "FAQ");
        var services = RootNamed(items, "Dịch vụ");
        var created = new Node(Guid.NewGuid(), null, "primary", true, "https://example.com/promo?x=1", true, new() { ["vi"] = "Khuyến mãi", ["en"] = "Promotions" });

        // swap the first two, rename + re-link Offers, move FAQ under Blog (after its categories), switch Services off, add one at the end, delete the template group.
        var templateRoot = items.Single(item => item.Placement == "secondary");
        var removed = new HashSet<Guid>(Descendants(items, templateRoot.Id).Append(templateRoot.Id));
        var next = new List<Node>
        {
            offers with { Href = "/offers?ref=menu", Labels = new(offers.Labels) { ["vi"] = "Ưu đãi hè", ["en"] = "Summer offers" } },
            riverside,
            blog,
        };
        next.AddRange(items.Where(item => item.ParentId == blog.Id));
        next.Add(faq with { ParentId = blog.Id, Placement = null });
        next.Add(services with { IsEnabled = false });
        next.AddRange(items.Where(item => item.ParentId == services.Id));
        next.Add(created);
        Assert.DoesNotContain(next, item => removed.Contains(item.Id));

        var response = await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, revision, next));
        var saved = await JsonAsync(response);
        Assert.Equal(2, saved.GetProperty("version").GetInt32());
        Assert.NotEqual(revision, saved.GetProperty("revision").GetString());
        Assert.Equal(staff, saved.GetProperty("updatedByStaffId").GetGuid());

        Assert.Equal(next.Count, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteMenuItems" WHERE "Id" = '{templateRoot.Id}' """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.menuItem.{templateRoot.Id}.%' """));       // a deleted entry leaves no orphan label
        Assert.Equal("Ưu đãi hè", await ScalarAsync<string>($"""SELECT "Label" FROM "WebsiteMenuItems" WHERE "Id" = '{offers.Id}' """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT "SortOrder" FROM "WebsiteMenuItems" WHERE "Id" = '{offers.Id}' """));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT "SortOrder" FROM "WebsiteMenuItems" WHERE "Id" = '{riverside.Id}' """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT "SortOrder" FROM "WebsiteMenuItems" WHERE "Id" = '{faq.Id}' """) - 3);        // after Blog's three categories
        Assert.True(await ScalarAsync<bool>($"""SELECT bool_and("IsEnabled") FROM "WebsiteMenuItems" WHERE "ParentId" = '{services.Id}' """));     // a disabled parent changes no child

        // The labels: en was edited by hand (marked, stamped with the vi text it was written from); a new item got its row.
        Assert.Equal("Summer offers", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.menuItem.{offers.Id}.label' AND "LanguageId" = '{WebsiteTestSeed.English}' """));
        Assert.True(await ScalarAsync<bool>($"""SELECT "IsManual" FROM "WebsiteTranslations" WHERE "Key" = 'content.menuItem.{offers.Id}.label' AND "LanguageId" = '{WebsiteTestSeed.English}' """));
        Assert.Equal(SourceText.Hash("Ưu đãi hè"), await ScalarAsync<string>($"""SELECT "SourceHash" FROM "WebsiteTranslations" WHERE "Key" = 'content.menuItem.{offers.Id}.label' AND "LanguageId" = '{WebsiteTestSeed.English}' """));
        Assert.Equal(staff, await ScalarAsync<Guid>($"""SELECT "UpdatedByStaffId" FROM "WebsiteTranslations" WHERE "Key" = 'content.menuItem.{created.Id}.label' AND "LanguageId" = '{WebsiteTestSeed.English}' """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" = 'content.menuItem.{created.Id}.label' AND "LanguageId" = '{WebsiteTestSeed.Vietnamese}' """));   // vi lives in the column

        var vi = await PublicAsync(session, "?locale=vi");
        Assert.Equal(["Ưu đãi hè", "Riverside", "Blog", "Khuyến mãi"], Labels(vi.GetProperty("primary")));          // Services is off, with its branch
        Assert.Equal(["Tất cả bài viết", "Điểm đến nổi bật", "Tin du lịch", "FAQ"], Labels(vi.GetProperty("primary")[2].GetProperty("children")));
        Assert.Equal(0, vi.GetProperty("secondary").GetArrayLength());
        Assert.True(vi.GetProperty("primary")[3].GetProperty("newTab").GetBoolean());
        Assert.Equal("https://example.com/promo?x=1", vi.GetProperty("primary")[3].GetProperty("href").GetString());
        Assert.Equal("/offers?ref=menu", vi.GetProperty("primary")[0].GetProperty("href").GetString());

        // Saving the same thing again changes nothing: no new version, so no tab is woken for nothing.
        var again = await LoadAsync(session);
        var noop = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, again.Revision, again.Items)));
        Assert.Equal(2, noop.GetProperty("version").GetInt32());
        Assert.Equal(again.Revision, noop.GetProperty("revision").GetString());
    }

    private static IEnumerable<Guid> Descendants(List<Node> items, Guid id) =>
        items.Where(item => item.ParentId == id).SelectMany(child => Descendants(items, child.Id).Append(child.Id));

    [Fact]
    public async Task A_bad_link_label_or_tree_is_a_400_naming_the_field_and_changes_nothing()
    {
        using var session = await StartAsync();
        var (revision, _, items) = await LoadAsync(session);
        var first = items[0];
        var blog = RootNamed(items, "Blog");

        async Task Refused(string code, string field, List<Node> next)
        {
            var response = await AssertStatusAsync(HttpStatusCode.BadRequest, SaveAsync(session, revision, next));
            Assert.Equal((code, field), await ProblemAsync(response));
            Assert.Equal(1, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteMenu" """));
            Assert.Equal(items.Count, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """));
        }

        foreach (var href in new[] { "javascript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "http://example.com", "/%2F%2Fevil.example", "/a b", "" })
        {
            await Refused(MenuErrorCodes.UrlInvalid, "items[0].href", [first with { Href = href }, .. items.Skip(1)]);
        }

        await Refused(MenuErrorCodes.LabelInvalid, "items[0].labels.vi", [WithLabel(first, "vi", "<b>x</b>"), .. items.Skip(1)]);
        await Refused(MenuErrorCodes.LabelRequired, "items[0].labels.vi", [WithLabel(first, "vi", " "), .. items.Skip(1)]);
        await Refused(MenuErrorCodes.UnknownLocale, "items[0].labels.zz", [WithLabel(first, "zz", "x"), .. items.Skip(1)]);
        await Refused(MenuErrorCodes.Duplicate, "items[1].id", [first, first with { }, .. items.Skip(1)]);

        // A cycle: Blog placed under its own child. A parent that does not exist. Too deep: a fifth level.
        var child = items.First(item => item.ParentId == blog.Id);
        var cyclic = items.Select(item => item.Id == blog.Id ? item with { ParentId = child.Id, Placement = null } : item).ToList();
        Assert.Equal(MenuErrorCodes.Cycle, (await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, SaveAsync(session, revision, cyclic)))).Code);
        var orphan = items.Select(item => item.Id == child.Id ? item with { ParentId = Guid.NewGuid() } : item).ToList();
        Assert.Equal(MenuErrorCodes.ParentMissing, (await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, SaveAsync(session, revision, orphan)))).Code);
        var deep = new List<Node>(items);
        var sub = deep.Single(item => item.Labels["vi"] == "Trang lưu trú");
        deep.Add(new Node(Guid.NewGuid(), sub.Id, null, true, "/x", false, new() { ["vi"] = "Quá sâu" }));
        Assert.Equal(MenuErrorCodes.TooDeep, (await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, SaveAsync(session, revision, deep)))).Code);

        // Deleting an entry that still has children is refused with its own code; deleting the whole branch is fine.
        var withoutBlog = items.Where(item => item.Id != blog.Id).ToList();
        Assert.Equal(MenuErrorCodes.DeleteHasChildren, (await ProblemAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, SaveAsync(session, revision, withoutBlog)))).Code);
        var withoutBranch = items.Where(item => item.Id != blog.Id && item.ParentId != blog.Id).ToList();
        await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, revision, withoutBranch));
        Assert.Equal(withoutBranch.Count, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """));

        // Malformed bodies: a missing required field is a 400, never a 500.
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/save", new { items = Array.Empty<object>() }));
        await AssertStatusAsync(HttpStatusCode.BadRequest, session.PostAsync($"{Url}/save", new { expectedRevision = "x", items = new[] { new { id = Guid.NewGuid() } } }));
    }

    [Fact]
    public async Task A_stale_revision_is_a_409_whether_the_tree_or_only_a_label_changed_in_between()
    {
        using var session = await StartAsync();
        var (revision, _, items) = await LoadAsync(session);
        var offers = RootNamed(items, "Ưu đãi");

        // Editor A saves first.
        await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, revision, items.Select(item => item.Id == offers.Id ? WithLabel(item, "en", "Deals") : item).ToList()));
        // Editor B still holds the old revision: refused, and nothing of B's draft is written.
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, SaveAsync(session, revision, items.Select(item => item.Id == offers.Id ? WithLabel(item, "en", "B's edit") : item).ToList()));
        Assert.Equal(WebsiteErrorCodes.StaleVersion, (await ProblemAsync(stale)).Code);
        Assert.Equal("Deals", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.menuItem.{offers.Id}.label' AND "LanguageId" = '{WebsiteTestSeed.English}' """));

        // Someone fixes a label on the Translations screen after the editor loaded: the editor's save is stale too.
        var loaded = await LoadAsync(session);
        var key = $"content.menuItem.{offers.Id}.label";
        var row = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"/api/admin/v1/website/translations?locale=en&q={key}")))).GetProperty("rows")[0];
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/translations/save", new { locale = "en", key, value = "Special offers", expectedVersion = row.GetProperty("version").GetInt32() }));
        await AssertStatusAsync(HttpStatusCode.Conflict, SaveAsync(session, loaded.Revision, loaded.Items));
        // ... and it shows in the public menu at once, with a new revision.
        var viewed = await LoadAsync(session);
        Assert.Equal("Special offers", viewed.Items.Single(item => item.Id == offers.Id).Labels["en"]);
        Assert.NotEqual(loaded.Revision, viewed.Revision);
    }

    [Fact]
    public async Task Two_saves_from_the_same_revision_at_the_same_time_leave_exactly_one_winner()
    {
        using var session = await StartAsync();
        var (revision, _, items) = await LoadAsync(session);
        var a = items.Select(item => item.Id == items[0].Id ? WithLabel(item, "vi", "A") : item).ToList();
        var b = items.Select(item => item.Id == items[0].Id ? WithLabel(item, "vi", "B") : item).ToList();

        var results = await Task.WhenAll(SaveAsync(session, revision, a), SaveAsync(session, revision, b));
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Conflict], results.Select(result => result.StatusCode).Order().ToArray());
        Assert.Equal(2, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteMenu" """));
        Assert.Equal(items.Count, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """));
    }

    [Fact]
    public async Task An_empty_menu_is_a_valid_answer_and_the_old_entries_do_not_come_back()
    {
        using var session = await StartAsync();
        var (revision, _, _) = await LoadAsync(session);
        await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, revision, []));

        var body = await PublicAsync(session, "?locale=vi");
        Assert.Equal(0, body.GetProperty("primary").GetArrayLength());
        Assert.Equal(0, body.GetProperty("secondary").GetArrayLength());
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.menuItem.%' """));
        Assert.Empty((await LoadAsync(session)).Items);
    }

    [Fact]
    public async Task A_label_is_stored_content_so_the_translations_screen_and_a_language_pack_carry_it_by_the_entrys_id()
    {
        using var session = await StartAsync();
        var (_, _, items) = await LoadAsync(session);
        var offers = RootNamed(items, "Ưu đãi");
        var key = $"content.menuItem.{offers.Id}.label";

        var row = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync($"/api/admin/v1/website/translations?locale=en&q={key}")))).GetProperty("rows")[0];
        Assert.Equal(("content", "menuItem", "Ưu đãi", "Offers"), (row.GetProperty("scope").GetString(), row.GetProperty("group").GetString(), row.GetProperty("sourceText").GetString(), row.GetProperty("value").GetString()));

        var export = await (await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync("/api/admin/v1/website/language-packs/export/en"))).Content.ReadAsStringAsync();
        using var pack = JsonDocument.Parse(export);
        Assert.Equal("Offers", pack.RootElement.GetProperty("content").GetProperty(key).GetString());
    }
}
