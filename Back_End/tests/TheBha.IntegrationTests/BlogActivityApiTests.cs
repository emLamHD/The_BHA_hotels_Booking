using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TheBha.Api.Realtime;
using TheBha.Application.Activity;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR06 (ADR 0011 §A, §C, §D): the Blog's Admin writes append activity to their four streams, a Save-then-Publish chain is two rows and one logical event, the
/// lists answer a watermark from their own snapshot, and the new headers are reachable from the Admin origin. Real PostgreSQL, the real HTTP pipeline and the real login throughout.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogActivityApiTests(PostgreSqlWebApplicationFactory factory) : BlogMediaTestSupport(factory)
{
    private const string Unseen = "/api/admin/v1/menu-unseen";
    private const string Correlation = "X-Admin-Correlation-Id";
    private const string Watermark = "X-Admin-View-Watermark";
    private static readonly byte[] Good = BlogImageFixtures.Jpeg(1200, 800);

    // ---------------------------------------------------------------------------------------------------------- probes

    /// <summary>Records every hint the real publisher is asked for (the real one still runs, so its "no open transaction" guard is still in force) and can fail the recorder on purpose AFTER it took the number.</summary>
    private sealed class Probe
    {
        public readonly ConcurrentQueue<string> Hints = [];
        public volatile bool FailRecorder;

        public void Install(IServiceCollection services)
        {
            var recorder = services.Single(descriptor => descriptor.ServiceType == typeof(IAdminActivityRecorder)).ImplementationType!;
            services.RemoveAll<IAdminActivityRecorder>();
            services.AddScoped<IAdminActivityRecorder>(provider => new FailingRecorder((IAdminActivityRecorder)ActivatorUtilities.CreateInstance(provider, recorder), this));
            services.RemoveAll<IAdminActivityHint>();
            services.AddScoped<IAdminActivityHint>(provider => new HintSpy(ActivatorUtilities.CreateInstance<AdminActivityHint>(provider), Hints));
        }
    }

    private sealed class FailingRecorder(IAdminActivityRecorder inner, Probe probe) : IAdminActivityRecorder
    {
        public async Task RecordAsync(AdminActivityEntry entry, CancellationToken cancellationToken)
        {
            await inner.RecordAsync(entry, cancellationToken);
            if (probe.FailRecorder)
            {
                throw new InvalidOperationException("Injected recorder failure after the counter moved.");
            }
        }
    }

    private sealed class HintSpy(IAdminActivityHint inner, ConcurrentQueue<string> sent) : IAdminActivityHint
    {
        public Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken)
        {
            sent.Enqueue(menuKey);
            return inner.PublishAsync(menuKey, propertyId, cancellationToken);
        }
    }

    /// <summary>Wraps the real image pipeline so a test can stop the caller exactly while the second picture of a batch is being processed.</summary>
    private sealed class CancellingPipeline(IBlogImagePipeline inner, CancellationTokenSource cancel, int cancelOnCall) : IBlogImagePipeline
    {
        private int _calls;
        public BlogImageCapabilities Capabilities => inner.Capabilities;

        public Task<(BlogProcessedImage? Image, BlogProblem? Problem)> ProcessAsync(ReadOnlyMemory<byte> original, HeroImageInfo expected, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _calls) == cancelOnCall)
            {
                cancel.Cancel();
            }

            return inner.ProcessAsync(original, expected, cancellationToken);
        }
    }

    // ---------------------------------------------------------------------------------------------------------- plumbing

    private async Task<BlogHost> StartAsync(Action<IServiceCollection>? configure = null)
    {
        var host = await StartMediaAsync(configure);
        // A Staff member counts only events at or after the account (decision D2): the accounts are older than the test clock.
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CreatedAtUtc" = '2026-10-01T00:00:00Z' """);
        return host;
    }

    private async Task<List<AdminActivity>> RowsAsync(string? menu = null)
    {
        await using var db = Factory.CreateDbContext();
        return (await db.AdminActivities.AsNoTracking().Where(row => menu == null || row.MenuKey == menu).ToListAsync()).OrderBy(row => row.MenuKey, StringComparer.Ordinal).ThenBy(row => row.Sequence).ToList();
    }

    private Task<long> CounterAsync(string menu) => ScalarAsync<long>($"""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = '{menu}' """);

    private Task<int> CountAsync(string table) => ScalarAsync<int>($"""SELECT count(*)::int FROM "{table}" """);

    private static HttpRequestMessage With(HttpRequestMessage request, params (string Name, string Value)[] headers)
    {
        foreach (var (name, value) in headers)
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }

        return request;
    }

    private Task<HttpResponseMessage> PostWithAsync(BlogHost host, string path, object body, string cookie, params (string Name, string Value)[] headers) =>
        SendAsync(host, With(AdminPost(path, body, cookie), headers));

    private static async Task<JsonElement> OkAsync(Task<HttpResponseMessage> send) => await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, send));

    private async Task<Guid> TranslationIdAsync(Guid postId, string locale) =>
        await ScalarAsync<Guid>($"""SELECT "Id" FROM "BlogPostTranslations" WHERE "PostId" = '{postId}' AND "Locale" = '{locale}' """);

    private Task<int> VersionOfAsync(string table, Guid id) => ScalarAsync<int>($"""SELECT "Version" FROM "{table}" WHERE "Id" = '{id}' """);

    private async Task<string> DefaultLocaleAsync() => await ScalarAsync<string>("""SELECT "NormalizedCode" FROM "WebsiteLanguages" WHERE "IsDefault" LIMIT 1""");

    private async Task<JsonElement> UnseenAsync(BlogHost host, string cookie, string path = "") =>
        await OkAsync(host.Client.SendAsync(Get(Unseen + path, cookie)));

    /// <summary>The first draft of a post a Save-then-Publish chain can follow: created by <paramref name="cookie"/>, no header.</summary>
    private async Task<(Guid Id, int Version)> NewDraftAsync(BlogHost host, Guid media, string slug, string cookie, string locale = "vi")
    {
        var created = await CreatePostAsync(host, Draft(media, slug), locale, cookie: cookie);
        return (PostId(created), Version(created, locale));
    }

    // ---------------------------------------------------------------------------------------------------------- the four streams

    [Fact]
    public async Task Every_Admin_Blog_write_appends_exactly_one_event_to_its_own_stream_beside_its_audit_and_sends_one_hint_after_the_commit()
    {
        var probe = new Probe();
        using var host = await StartAsync(probe.Install);
        var editor = await StaffIdAsync(Editor);
        var publisher = await StaffIdAsync(Publisher);
        var expected = new Dictionary<string, int>();
        var hints = new List<string>();

        async Task<AdminActivity> Expect(string menu, string action, string kind, string key, string title, Guid actor, int items = 1)
        {
            expected[menu] = expected.GetValueOrDefault(menu) + 1;
            hints.Add(menu);
            var rows = await RowsAsync(menu);
            Assert.Equal(expected[menu], rows.Count);
            var row = rows[^1];
            Assert.Equal((action, kind, key, title, items), (row.Action, row.EntityKind, row.EntityKey, row.TitleSnapshot, row.ItemCount));
            Assert.Equal((AdminActorKind.Staff, actor, (Guid?)null, (Guid?)null), (row.ActorKind, row.ActorStaffId ?? Guid.Empty, row.PropertyId, row.CorrelationId));
            Assert.Equal(rows.Count, row.Sequence);
            Assert.Equal(row.Sequence, await CounterAsync(menu));
            Assert.Equal(hints, probe.Hints.ToList()); // one hint per write, in order, never from a refused or failed one
            return row;
        }

        // ---- blog-media
        var media = (await UploadPictureAsync(host, Good, "cover.jpg")).GetProperty("id").GetGuid();
        await Expect("blog-media", "Uploaded", "media", media.ToString("D"), "cover", editor);
        await OkAsync(SaveMediaAsync(host, media, await VersionOfAsync("BlogMedia", media)));
        await Expect("blog-media", "Updated", "media", media.ToString("D"), "Biển Mỹ Khê", editor);

        // ---- blog-categories (the title is the website's default language, read from the saved texts)
        var defaultLocale = await DefaultLocaleAsync();
        var category = Guid.NewGuid();
        var texts = new Dictionary<string, object> { ["vi"] = new { name = "Ẩm thực", slug = "am-thuc", description = "d" }, ["en"] = new { name = "Food", slug = "food", description = "d" } };
        await OkAsync(SendAsync(host, AdminPost("/categories", new { id = category, sortOrder = 20, translations = texts }, host.Cookie(Publisher))));
        var name = defaultLocale == "vi" ? "Ẩm thực" : "Food"; // the default language's text, else the first language in code order (en)
        await Expect("blog-categories", "Created", "category", category.ToString("D"), name, publisher);
        await OkAsync(SendAsync(host, AdminPost($"/categories/{category}/save", new { expectedVersion = await VersionOfAsync("BlogCategories", category), sortOrder = 21, translations = texts }, host.Cookie(Publisher))));
        await Expect("blog-categories", "Saved", "category", category.ToString("D"), name, publisher);

        // ---- blog-posts
        var created = await CreatePostAsync(host, Draft(media, "bai-mot"), "vi", cookie: host.Cookie(Editor));
        var post = PostId(created);
        var translation = await TranslationIdAsync(post, "vi");
        await Expect("blog-posts", "Created", "post-translation", translation.ToString("D"), "Bãi biển Mỹ Khê", editor);
        var saved = await SaveDraftAsync(host, post, "vi", 1, Draft(media, "bai-mot", "Tiêu đề mới"), host.Cookie(Editor));
        await Expect("blog-posts", "DraftSaved", "post-translation", translation.ToString("D"), "Tiêu đề mới", editor);
        var published = await TransitionAsync(host, post, "vi", "publish", Version(saved, "vi"), host.Cookie(Publisher));
        await Expect("blog-posts", "Published", "post-translation", translation.ToString("D"), "Tiêu đề mới", publisher);

        // pins need a published post of the category: the Featured category holds it
        await OkAsync(SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/pins/save", new { expectedVersion = await VersionOfAsync("BlogCategories", FeaturedCategory), postIds = new[] { post } }, host.Cookie(Publisher))));
        await Expect("blog-categories", "PinsSaved", "category", FeaturedCategory.ToString("D"), await ScalarAsync<string>($"""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{FeaturedCategory}' ORDER BY ("Locale" = '{defaultLocale}') DESC, "Locale" COLLATE "C" LIMIT 1"""), publisher);

        var version = Version(published, "vi");
        var unpublished = await TransitionAsync(host, post, "vi", "unpublish", version, host.Cookie(Publisher));
        await Expect("blog-posts", "Unpublished", "post-translation", translation.ToString("D"), "Tiêu đề mới", publisher);
        var republished = await TransitionAsync(host, post, "vi", "publish", Version(unpublished, "vi"), host.Cookie(Publisher));
        await Expect("blog-posts", "Republished", "post-translation", translation.ToString("D"), "Tiêu đề mới", publisher);
        var archived = await TransitionAsync(host, post, "vi", "archive", Version(republished, "vi"), host.Cookie(Publisher));
        await Expect("blog-posts", "Archived", "post-translation", translation.ToString("D"), "Tiêu đề mới", publisher);
        await TransitionAsync(host, post, "vi", "unarchive", Version(archived, "vi"), host.Cookie(Publisher));
        await Expect("blog-posts", "Unarchived", "post-translation", translation.ToString("D"), "Tiêu đề mới", publisher);

        // a second language of the same post is another translation: Created, with its own key
        await SaveDraftAsync(host, post, "en", 0, Draft(media, "bai-mot-en", "English title"), host.Cookie(Editor));
        var englishId = await TranslationIdAsync(post, "en");
        await Expect("blog-posts", "Created", "post-translation", englishId.ToString("D"), "English title", editor);
        Assert.NotEqual(translation, englishId);

        // restore: the draft of the vi translation is replaced by an earlier revision
        var revisions = await OkAsync(SendAsync(host, AdminGet($"/posts/{post}/translations/vi/revisions", host.Cookie(Both))));
        var first = revisions.EnumerateArray().Single(r => r.GetProperty("number").GetInt32() == 1).GetProperty("id").GetGuid();
        var draftAgain = await SaveDraftAsync(host, post, "vi", await VersionOfAsync("BlogPostTranslations", translation), Draft(media, "bai-mot", "Bản nháp khác"), host.Cookie(Editor));
        await Expect("blog-posts", "DraftSaved", "post-translation", translation.ToString("D"), "Bản nháp khác", editor);
        await OkAsync(SendAsync(host, AdminPost($"/posts/{post}/translations/vi/revisions/{first}/restore", new { expectedVersion = Version(draftAgain, "vi") }, host.Cookie(Editor))));
        await Expect("blog-posts", "Restored", "post-translation", translation.ToString("D"), "Tiêu đề mới", editor);

        // ---- blog-settings: one singleton, a fixed token and a generic title
        await OkAsync(SendAsync(host, AdminPost("/settings/save", new { expectedVersion = await ScalarAsync<int>("SELECT \"Version\" FROM \"BlogSettings\""), homeSectionCategoryId = category }, host.Cookie(Publisher))));
        await Expect("blog-settings", "Saved", "settings", "blog-settings", "Blog settings", publisher);

        // every write also left its audit row: one audit per event
        Assert.Equal(expected.Values.Sum(), await CountAsync("BlogAudits"));
        Assert.Equal(expected.Values.Sum(), (await RowsAsync()).Count);
    }

    [Fact]
    public async Task A_delete_records_the_title_taken_before_the_object_goes_and_the_activity_outlives_it()
    {
        var probe = new Probe();
        using var host = await StartAsync(probe.Install);
        var publisher = await StaffIdAsync(Publisher);
        var defaultLocale = await DefaultLocaleAsync();
        var category = Guid.NewGuid();
        await OkAsync(SendAsync(host, AdminPost("/categories", new { id = category, sortOrder = 20, translations = new Dictionary<string, object> { [defaultLocale] = new { name = "Sẽ bị xóa", slug = "se-bi-xoa", description = "d" } } }, host.Cookie(Publisher))));
        await AssertStatusAsync(HttpStatusCode.NoContent, SendAsync(host, AdminPost($"/categories/{category}/delete", new { expectedVersion = await VersionOfAsync("BlogCategories", category) }, host.Cookie(Publisher))));
        var picture = (await UploadPictureAsync(host, Good, "se-xoa.jpg")).GetProperty("id").GetGuid();
        await AssertStatusAsync(HttpStatusCode.NoContent, DeleteMediaAsync(host, picture, await VersionOfAsync("BlogMedia", picture)));

        var categories = await RowsAsync("blog-categories");
        Assert.Equal(["Created", "Deleted"], categories.Select(r => r.Action).ToArray());
        Assert.Equal(("Sẽ bị xóa", category.ToString("D"), publisher), (categories[1].TitleSnapshot, categories[1].EntityKey, categories[1].ActorStaffId!.Value));
        var media = await RowsAsync("blog-media");
        Assert.Equal(["Uploaded", "Deleted"], media.Select(r => r.Action).ToArray());
        Assert.Equal(("se-xoa", picture.ToString("D")), (media[1].TitleSnapshot, media[1].EntityKey));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogCategories" WHERE "Id" = '{category}' """));
        Assert.Equal(["blog-categories", "blog-categories", "blog-media", "blog-media"], probe.Hints.Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task Another_Staff_member_sees_the_event_through_the_unseen_API_and_the_actor_does_not_see_their_own()
    {
        using var host = await StartAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var editor = await StaffIdAsync(Editor);
        await CreatePostAsync(host, Draft(media, "chi-nguoi-khac-thay"), cookie: host.Cookie(Editor));

        var own = await UnseenAsync(host, host.Cookie(Editor));
        Assert.Equal((0, 0), (own.GetProperty("menus").GetProperty("blog-posts").GetProperty("count").GetInt32(), own.GetProperty("menus").GetProperty("blog-media").GetProperty("count").GetInt32()));

        var other = await UnseenAsync(host, host.Cookie(Publisher));
        Assert.Equal((1, 1), (other.GetProperty("menus").GetProperty("blog-posts").GetProperty("count").GetInt32(), other.GetProperty("menus").GetProperty("blog-media").GetProperty("count").GetInt32()));
        var changes = await UnseenAsync(host, host.Cookie(Publisher), "/blog-posts/changes");
        var group = Assert.Single(changes.GetProperty("groups").EnumerateArray());
        Assert.Equal(("Created", "Bãi biển Mỹ Khê", 1), (group.GetProperty("action").GetString(), group.GetProperty("titleSnapshot").GetString(), group.GetProperty("events").GetInt32()));
        Assert.Equal(editor, Assert.Single(group.GetProperty("actors").EnumerateArray()).GetProperty("staffId").GetGuid());
        Assert.Equal(await CounterAsync("blog-posts"), long.Parse(changes.GetProperty("snapshotWatermark").GetString()!));
    }

    // ---------------------------------------------------------------------------------------------------------- correlation

    [Fact]
    public async Task A_valid_Save_then_Publish_is_two_rows_and_one_logical_event_and_Create_then_Publish_merges_too()
    {
        var probe = new Probe();
        using var host = await StartAsync(probe.Install);
        var media = await UploadAsync(host, host.Cookie(Both));
        var chain = Guid.NewGuid();
        var (post, version) = await NewDraftAsync(host, media, "luu-roi-dang", host.Cookie(Both));
        var translation = await TranslationIdAsync(post, "vi");

        var saved = await OkAsync(PostWithAsync(host, $"/posts/{post}/translations/vi/draft", new { expectedVersion = version, draft = Draft(media, "luu-roi-dang", "Đã lưu") }, host.Cookie(Both), (Correlation, chain.ToString())));
        await OkAsync(PostWithAsync(host, $"/posts/{post}/translations/vi/publish", new { expectedVersion = Version(saved, "vi") }, host.Cookie(Both), (Correlation, chain.ToString())));

        var rows = (await RowsAsync("blog-posts")).Where(r => r.EntityKey == translation.ToString("D")).ToList();
        Assert.Equal(["Created", "DraftSaved", "Published"], rows.Select(r => r.Action).ToArray());
        Assert.Equal([null, chain, chain], rows.Select(r => r.CorrelationId).ToArray());
        Assert.Equal(3, probe.Hints.Count(h => h == "blog-posts")); // the badge counts events; every physical write is still announced

        // Create → Publish of a new post is one chain as well
        var second = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var created = await OkAsync(PostWithAsync(host, "/posts", new { id = postId, locale = "vi", draft = Draft(media, "tao-roi-dang") }, host.Cookie(Both), (Correlation, second.ToString())));
        await OkAsync(PostWithAsync(host, $"/posts/{postId}/translations/vi/publish", new { expectedVersion = Version(created, "vi") }, host.Cookie(Both), (Correlation, second.ToString())));
        var secondRows = (await RowsAsync("blog-posts")).Where(r => r.CorrelationId == second).ToList();
        Assert.Equal(["Created", "Published"], secondRows.Select(r => r.Action).ToArray());

        // Another Staff member counts 3 events (the first Create, the chain, the second chain) for 5 rows, and one group per chain object keeps them apart.
        var seen = await UnseenAsync(host, host.Cookie(Publisher));
        Assert.Equal(3, seen.GetProperty("menus").GetProperty("blog-posts").GetProperty("count").GetInt32());
        Assert.Equal(3, (await UnseenAsync(host, host.Cookie(Publisher), "/blog-posts/changes")).GetProperty("unseenEvents").GetInt32());
        // the actor sees none of them
        Assert.Equal(0, (await UnseenAsync(host, host.Cookie(Both))).GetProperty("menus").GetProperty("blog-posts").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task A_failed_or_stale_publish_writes_no_activity_and_sends_no_hint_and_the_saved_draft_keeps_its_event()
    {
        var probe = new Probe();
        using var host = await StartAsync(probe.Install);
        var media = await UploadAsync(host, host.Cookie(Both));
        var chain = Guid.NewGuid();
        var (post, version) = await NewDraftAsync(host, media, "luu-roi-hong", host.Cookie(Both));
        var saved = await OkAsync(PostWithAsync(host, $"/posts/{post}/translations/vi/draft", new { expectedVersion = version, draft = Draft(media, "luu-roi-hong", change: d => d["summary"] = "") }, host.Cookie(Both), (Correlation, chain.ToString())));
        var before = (await RowsAsync()).Count;
        var counters = (await CounterAsync("blog-posts"), await CountAsync("BlogAudits"));
        var hints = probe.Hints.Count;

        // not publishable (no summary): 400; stale expectedVersion: 409. Both carry the id; neither leaves a row, a number, an audit or a hint.
        await AssertStatusAsync(HttpStatusCode.BadRequest, PostWithAsync(host, $"/posts/{post}/translations/vi/publish", new { expectedVersion = Version(saved, "vi") }, host.Cookie(Both), (Correlation, chain.ToString())));
        await AssertStatusAsync(HttpStatusCode.Conflict, PostWithAsync(host, $"/posts/{post}/translations/vi/publish", new { expectedVersion = Version(saved, "vi") + 5 }, host.Cookie(Both), (Correlation, chain.ToString())));

        Assert.Equal(before, (await RowsAsync()).Count);
        Assert.Equal(counters, (await CounterAsync("blog-posts"), await CountAsync("BlogAudits")));
        Assert.Equal(hints, probe.Hints.Count);
        var saveRow = (await RowsAsync("blog-posts")).Single(r => r.Action == "DraftSaved");
        Assert.Equal(chain, saveRow.CorrelationId); // the saved draft keeps its event, and its chain id
    }

    [Fact]
    public async Task A_correlation_id_never_merges_across_Staff_languages_or_reuse_and_a_bad_header_is_no_correlation()
    {
        using var host = await StartAsync();
        var media = await UploadAsync(host, host.Cookie(Both));

        // wrong Staff: the Editor starts the chain, the Publisher finishes it
        var otherStaff = Guid.NewGuid();
        var (a, aVersion) = await NewDraftAsync(host, media, "khac-nguoi", host.Cookie(Editor));
        var aSaved = await OkAsync(PostWithAsync(host, $"/posts/{a}/translations/vi/draft", new { expectedVersion = aVersion, draft = Draft(media, "khac-nguoi", "A") }, host.Cookie(Editor), (Correlation, otherStaff.ToString())));
        await OkAsync(PostWithAsync(host, $"/posts/{a}/translations/vi/publish", new { expectedVersion = Version(aSaved, "vi") }, host.Cookie(Publisher), (Correlation, otherStaff.ToString())));
        Assert.Equal([otherStaff, null], (await RowsAsync("blog-posts")).Where(r => r.CorrelationId == otherStaff || r.Action == "Published").OrderBy(r => r.Sequence).Select(r => r.CorrelationId).ToArray());

        // wrong locale: the chain starts on the vi translation and the id arrives on the en one
        var otherLocale = Guid.NewGuid();
        var (b, bVersion) = await NewDraftAsync(host, media, "khac-ngon-ngu", host.Cookie(Both));
        await OkAsync(PostWithAsync(host, $"/posts/{b}/translations/vi/draft", new { expectedVersion = bVersion, draft = Draft(media, "khac-ngon-ngu", "B") }, host.Cookie(Both), (Correlation, otherLocale.ToString())));
        var english = await SaveDraftAsync(host, b, "en", 0, Draft(media, "other-language"), host.Cookie(Both));
        await OkAsync(PostWithAsync(host, $"/posts/{b}/translations/en/publish", new { expectedVersion = Version(english, "en") }, host.Cookie(Both), (Correlation, otherLocale.ToString())));
        var englishId = (await TranslationIdAsync(b, "en")).ToString("D");
        var enRow = (await RowsAsync("blog-posts")).Single(r => r.EntityKey == englishId && r.Action == "Published");
        Assert.Null(enRow.CorrelationId);

        // reuse: a chain id already completed is not taken again by a second save or a second publish
        var reused = Guid.NewGuid();
        var (c, cVersion) = await NewDraftAsync(host, media, "dung-lai", host.Cookie(Both));
        var cSaved = await OkAsync(PostWithAsync(host, $"/posts/{c}/translations/vi/draft", new { expectedVersion = cVersion, draft = Draft(media, "dung-lai", "C1") }, host.Cookie(Both), (Correlation, reused.ToString())));
        var cPublished = await OkAsync(PostWithAsync(host, $"/posts/{c}/translations/vi/publish", new { expectedVersion = Version(cSaved, "vi") }, host.Cookie(Both), (Correlation, reused.ToString())));
        var cAgain = await OkAsync(PostWithAsync(host, $"/posts/{c}/translations/vi/draft", new { expectedVersion = Version(cPublished, "vi"), draft = Draft(media, "dung-lai", "C2") }, host.Cookie(Both), (Correlation, reused.ToString())));
        await OkAsync(PostWithAsync(host, $"/posts/{c}/translations/vi/publish", new { expectedVersion = Version(cAgain, "vi") }, host.Cookie(Both), (Correlation, reused.ToString())));
        var cKey = (await TranslationIdAsync(c, "vi")).ToString("D");
        var cRows = (await RowsAsync("blog-posts")).Where(r => r.EntityKey == cKey).OrderBy(r => r.Sequence).ToList();
        Assert.Equal(["Created", "DraftSaved", "Published", "DraftSaved", "Published"], cRows.Select(r => r.Action).ToArray());
        Assert.Equal([null, reused, reused, null, null], cRows.Select(r => r.CorrelationId).ToArray());

        // a header that is missing, malformed, all-zero, in braces, comma-joined or repeated is "no correlation"; the write still succeeds and keeps its body semantics
        var (d, dVersion) = await NewDraftAsync(host, media, "header-xau", host.Cookie(Both));
        var good = Guid.NewGuid().ToString();
        var bad = new[] { new[] { "not-a-guid" }, ["00000000-0000-0000-0000-000000000000"], ["{" + good + "}"], [good.Replace("-", "")], [good + "," + good], [good, good], [""] };
        var version = dVersion;
        foreach (var values in bad)
        {
            var request = AdminPost($"/posts/{d}/translations/vi/draft", new { expectedVersion = version, draft = Draft(media, "header-xau", "D" + version) }, host.Cookie(Both));
            foreach (var value in values)
            {
                request.Headers.TryAddWithoutValidation(Correlation, value);
            }

            version = Version(await OkAsync(SendAsync(host, request)), "vi");
        }

        var dKey = (await TranslationIdAsync(d, "vi")).ToString("D");
        var dRows = (await RowsAsync("blog-posts")).Where(r => r.EntityKey == dKey).ToList();
        Assert.Equal(1 + bad.Length, dRows.Count);
        Assert.All(dRows, row => Assert.Null(row.CorrelationId));
    }

    // ---------------------------------------------------------------------------------------------------------- pictures

    [Fact]
    public async Task A_bulk_upload_records_one_event_counting_only_the_new_pictures_beside_the_audit_of_each()
    {
        var probe = new Probe();
        using var host = await StartMediaAsync(probe.Install);
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CreatedAtUtc" = '2026-10-01T00:00:00Z' """);
        var existing = (await UploadPictureAsync(host, Good, "da-co.jpg")).GetProperty("id").GetGuid();
        var (first, second) = (Guid.NewGuid(), Guid.NewGuid());
        var junk = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };

        // new, duplicate id (already a picture), not a picture, new
        var batch = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK,
            BatchAsync(host, host.Cookie(Editor), [("a.jpg", Good), ("b.jpg", Good), ("c.jpg", junk), ("d.jpg", Good)], [first, existing, Guid.NewGuid(), second])));

        Assert.Equal((2, 2), (batch.GetProperty("succeeded").GetInt32(), batch.GetProperty("failed").GetInt32()));
        var items = batch.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal([true, false, false, true], items.Select(item => item.TryGetProperty("media", out var picture) && picture.ValueKind == JsonValueKind.Object).ToArray());
        Assert.Equal("blog.duplicate-id", items[1].GetProperty("error").GetProperty("code").GetString());

        var rows = await RowsAsync("blog-media");
        Assert.Equal(["Uploaded", "Uploaded"], rows.Select(r => r.Action).ToArray());
        var batchRow = rows[1];
        Assert.Equal(("media-batch", 2, await StaffIdAsync(Editor)), (batchRow.EntityKind, batchRow.ItemCount, batchRow.ActorStaffId!.Value));
        Assert.Equal(3, await CountAsync("BlogMedia"));
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*)::int FROM "BlogAudits" WHERE "Action" = 'media.upload' """)); // one audit per picture that went in, none for a refusal
        Assert.Equal(["blog-media", "blog-media"], probe.Hints.ToArray());
        Assert.Equal(2L, await CounterAsync("blog-media"));
        Assert.Equal(21, BlogFiles().Length); // 3 pictures x 7 files; the refused ones left none behind
    }

    [Fact]
    public async Task A_batch_where_nothing_goes_in_records_no_event_takes_no_number_and_sends_no_hint()
    {
        var probe = new Probe();
        using var host = await StartMediaAsync(probe.Install);
        var junk = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
        var batch = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, host.Cookie(Editor), [("a.jpg", junk), ("b.jpg", junk)])));

        Assert.Equal((0, 2), (batch.GetProperty("succeeded").GetInt32(), batch.GetProperty("failed").GetInt32()));
        Assert.Empty(await RowsAsync());
        Assert.Equal(0L, await CounterAsync("blog-media"));
        Assert.Equal(0, await CountAsync("BlogAudits"));
        Assert.Empty(probe.Hints);
        Assert.Empty(BlogFiles());
    }

    [Fact]
    public async Task A_cancelled_batch_keeps_the_pictures_already_prepared_and_records_them_as_one_event()
    {
        var probe = new Probe();
        using var cancel = new CancellationTokenSource();
        using var host = await StartMediaAsync(services =>
        {
            probe.Install(services);
            var pipeline = services.Single(descriptor => descriptor.ServiceType == typeof(IBlogImagePipeline));
            services.RemoveAll<IBlogImagePipeline>();
            services.AddSingleton<IBlogImagePipeline>(provider => new CancellingPipeline(
                (IBlogImagePipeline)(pipeline.ImplementationInstance ?? ActivatorUtilities.CreateInstance(provider, pipeline.ImplementationType!)), cancel, cancelOnCall: 2));
        });

        using var scope = host.Host.Services.CreateScope();
        var blog = scope.ServiceProvider.GetRequiredService<IAdminBlog>();
        var uploads = Enumerable.Range(1, 3).Select(n => new BlogMediaUpload(() => new MemoryStream(Good), $"{n}.jpg", null)).ToArray();
        var editor = await StaffIdAsync(Editor);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => blog.UploadMediaBatchAsync(uploads, editor, cancel.Token));

        Assert.Equal(1, await CountAsync("BlogMedia")); // picture 1 was complete; 2 was cut off after its files were written; 3 never started
        var row = Assert.Single(await RowsAsync("blog-media"));
        Assert.Equal(("media-batch", 1, editor), (row.EntityKind, row.ItemCount, row.ActorStaffId!.Value));
        Assert.Equal(["blog-media"], probe.Hints.ToArray());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*)::int FROM "BlogAudits" WHERE "Action" = 'media.upload' """));
        Assert.Equal(7, BlogFiles().Length); // the cut-off picture's files were removed (no row can refer to them)
    }

    // ---------------------------------------------------------------------------------------------------------- the recorder is part of the transaction

    [Fact]
    public async Task A_recorder_that_fails_after_taking_the_number_rolls_back_the_write_its_audit_and_the_counter_and_sends_no_hint()
    {
        var probe = new Probe();
        using var host = await StartAsync(probe.Install);
        var media = await UploadAsync(host, host.Cookie(Both));
        var (post, version) = await NewDraftAsync(host, media, "recorder-hong", host.Cookie(Both));
        var category = (await CreateCategoryAsync(host, "danh-muc-hong")).GetProperty("id").GetGuid();
        var other = (await UploadPictureAsync(host, Good, "khac.jpg")).GetProperty("id").GetGuid();
        var toDelete = (await UploadPictureAsync(host, Good, "xoa.jpg")).GetProperty("id").GetGuid();
        var spare = (await CreateCategoryAsync(host, "danh-muc-xoa")).GetProperty("id").GetGuid();
        var files = BlogFiles().Length;
        var hints = probe.Hints.Count;

        async Task<string> Fingerprint() => string.Join('|',
            await CountAsync("BlogPosts"), await CountAsync("BlogPostRevisions"), await CountAsync("BlogCategories"), await CountAsync("BlogMedia"), await CountAsync("BlogAudits"), await CountAsync("AdminActivities"),
            await ScalarAsync<string>("""SELECT string_agg("MenuKey" || '=' || "LastSequence", ',' ORDER BY "MenuKey") FROM "MenuActivityStreams" """),
            await ScalarAsync<string>("""SELECT string_agg("Version"::text, ',' ORDER BY "Id") FROM "BlogPostTranslations" """),
            await ScalarAsync<string>("""SELECT string_agg("Version"::text, ',' ORDER BY "Id") FROM "BlogCategories" """),
            await ScalarAsync<string>("""SELECT string_agg("Version"::text, ',' ORDER BY "Id") FROM "BlogMedia" """),
            await ScalarAsync<string>("""SELECT "Version"::text FROM "BlogSettings" """));
        var before = await Fingerprint();
        var cookie = host.Cookie(Both);

        probe.FailRecorder = true;
        var attempts = new (string Name, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("create post", () => SendAsync(host, AdminPost("/posts", new { id = Guid.NewGuid(), locale = "vi", draft = Draft(media, "se-khong-co") }, cookie))),
            ("save draft", () => SendAsync(host, AdminPost($"/posts/{post}/translations/vi/draft", new { expectedVersion = version, draft = Draft(media, "recorder-hong", "Đổi") }, cookie))),
            ("publish", () => SendAsync(host, AdminPost($"/posts/{post}/translations/vi/publish", new { expectedVersion = version }, cookie))),
            ("create category", () => SendAsync(host, AdminPost("/categories", new { id = Guid.NewGuid(), sortOrder = 20, translations = new Dictionary<string, object> { ["vi"] = new { name = "X", slug = "x-khong", description = "d" } } }, cookie))),
            ("save category", () => SendAsync(host, AdminPost($"/categories/{category}/save", new { expectedVersion = 1, sortOrder = 30, translations = new Dictionary<string, object>() }, cookie))),
            ("delete category", () => SendAsync(host, AdminPost($"/categories/{spare}/delete", new { expectedVersion = 1 }, cookie))),
            ("settings", () => SendAsync(host, AdminPost("/settings/save", new { expectedVersion = 1, homeSectionCategoryId = category }, cookie))),
            ("save media", () => SaveMediaAsync(host, other, 1, cookie: cookie)),
            ("delete media", () => DeleteMediaAsync(host, toDelete, 1, cookie)),
            ("upload one", () => SendAsync(host, UploadRequest("cover.png", cookie))),
        };
        foreach (var (name, send) in attempts)
        {
            Assert.True((await send()).StatusCode == HttpStatusCode.InternalServerError, $"{name} must fail whole");
        }

        // a batch answers a failure for each picture (as it does for any database failure) and leaves nothing
        var batch = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, cookie, [("a.jpg", Good), ("b.jpg", Good)])));
        Assert.Equal((0, 2), (batch.GetProperty("succeeded").GetInt32(), batch.GetProperty("failed").GetInt32()));
        probe.FailRecorder = false;

        Assert.Equal(before, await Fingerprint());
        Assert.Equal(hints, probe.Hints.Count);
        Assert.Equal(files, BlogFiles().Length); // the pictures' files were removed (rollback is certain), the deleted picture's files were not touched
        Assert.True(File.Exists(Path.Combine(Factory.MediaRoot, await ScalarAsync<string>($"""SELECT "StorageKey" FROM "BlogMedia" WHERE "Id" = '{toDelete}' """))));

        // and the same operations work once the recorder does
        await TransitionAsync(host, post, "vi", "publish", version, cookie);
        Assert.Equal(1, probe.Hints.Count - hints);
    }

    // ---------------------------------------------------------------------------------------------------------- watermark from one snapshot

    [Fact]
    public async Task Each_list_the_screens_load_answers_the_watermark_of_its_own_stream_and_a_write_answers_none()
    {
        using var host = await StartAsync();
        var media = await UploadAsync(host, host.Cookie(Both));
        await CreatePostAsync(host, Draft(media, "mot"), cookie: host.Cookie(Editor));
        await CreatePostAsync(host, Draft(media, "hai"), cookie: host.Cookie(Editor));
        var category = (await CreateCategoryAsync(host, "dm")).GetProperty("id").GetGuid();
        await OkAsync(SendAsync(host, AdminPost("/settings/save", new { expectedVersion = 1, homeSectionCategoryId = category }, host.Cookie(Publisher))));
        var counters = new Dictionary<string, string>
        {
            ["blog-posts"] = (await CounterAsync("blog-posts")).ToString(), ["blog-categories"] = (await CounterAsync("blog-categories")).ToString(),
            ["blog-media"] = (await CounterAsync("blog-media")).ToString(), ["blog-settings"] = (await CounterAsync("blog-settings")).ToString(),
        };
        Assert.Equal(["1", "1", "2", "1"], [counters["blog-media"], counters["blog-categories"], counters["blog-posts"], counters["blog-settings"]]); // the streams differ, so a mix-up shows

        var posts = await OkAsync(SendAsync(host, AdminGet("/posts", host.Cookie(Both))));
        Assert.Equal((counters["blog-posts"], 2), (posts.GetProperty("viewWatermark").GetString(), posts.GetProperty("total").GetInt32()));
        var list = await OkAsync(SendAsync(host, AdminGet("/media", host.Cookie(Both))));
        Assert.Equal(counters["blog-media"], list.GetProperty("viewWatermark").GetString());
        var settings = await OkAsync(SendAsync(host, AdminGet("/settings", host.Cookie(Both))));
        Assert.Equal(counters["blog-settings"], settings.GetProperty("viewWatermark").GetString());
        var pins = await OkAsync(SendAsync(host, AdminGet($"/categories/{category}/pins", host.Cookie(Both))));
        Assert.Equal(counters["blog-categories"], pins.GetProperty("viewWatermark").GetString());

        // the categories answer is a bare array; its watermark is the header
        var categories = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/categories", host.Cookie(Both))));
        Assert.Equal(JsonValueKind.Array, (await JsonAsync(categories)).ValueKind);
        Assert.Equal(counters["blog-categories"], Assert.Single(categories.Headers.GetValues(Watermark)));

        // an empty page past the end still answers it; a write's own answer carries none; the public routes and a binary route are unchanged
        var past = await OkAsync(SendAsync(host, AdminGet("/posts?page=9", host.Cookie(Both))));
        Assert.Equal(counters["blog-posts"], past.GetProperty("viewWatermark").GetString());
        var saved = await OkAsync(SendAsync(host, AdminPost("/settings/save", new { expectedVersion = 2, homeSectionCategoryId = category }, host.Cookie(Publisher))));
        Assert.False(saved.TryGetProperty("viewWatermark", out _));
        var pinsSaved = await OkAsync(SendAsync(host, AdminPost($"/categories/{category}/pins/save", new { expectedVersion = 1, postIds = Array.Empty<Guid>() }, host.Cookie(Publisher))));
        Assert.False(pinsSaved.TryGetProperty("viewWatermark", out _));
        var publicList = await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, "/posts?locale=vi"));
        Assert.False(publicList.Headers.Contains(Watermark) || (await JsonAsync(publicList)).TryGetProperty("viewWatermark", out _));
        var bytes = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{media}", host.Cookie(Both))));
        Assert.False(bytes.Headers.Contains(Watermark));
    }

    private const string CounterRead = "FROM \"MenuActivityStreams\"";

    /// <summary>
    /// A list is paused right after the first statement that contains <paramref name="pauseAfter"/> while another Staff member commits a write, then released; it must still answer the rows and the
    /// watermark of ONE state. Pausing after the COUNTER read catches "rows newer than the watermark"; pausing after a DATA read catches "rows older than the watermark" (a counter read after the rows).
    /// </summary>
    private async Task<(HttpResponseMessage Response, long Before, long After)> ListAcrossAWriteAsync(string listPath, string pauseAfter, Func<BlogHost, Task> write)
    {
        var barrier = new ReservationBoardSnapshotBarrierInterceptor(pauseAfter);
        using var host = await StartAsync(services => services.AddScoped(_ => new TheBhaDbContext(
            new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(barrier).Options)));
        // The first statement with this text after this point is the list's own: nothing before it reads one through EF.
        var list = SendAsync(host, AdminGet(listPath, host.Cookie(Both)));
        await barrier.Reached.WaitAsync(TimeSpan.FromSeconds(30));
        var before = await CounterAsync(listPath.Contains("posts") ? "blog-posts" : "blog-categories");
        await write(host);
        var after = await CounterAsync(listPath.Contains("posts") ? "blog-posts" : "blog-categories");
        barrier.Release();
        var response = await list;
        Assert.True(after > before, "the write committed while the list was paused");
        return (response, before, after);
    }

    [Theory]
    [InlineData(CounterRead)]                          // paused after the counter: the rows must not be newer than the watermark
    [InlineData("FROM \"BlogPostTranslations\"")]      // paused after the rows' first query: the watermark must not be newer than the rows
    public async Task A_post_list_never_pairs_rows_with_a_watermark_from_another_moment_when_a_write_commits_in_the_middle(string pauseAfter)
    {
        var (response, before, after) = await ListAcrossAWriteAsync("/posts", pauseAfter, async host =>
        {
            var media = await UploadAsync(host, host.Cookie(Editor));
            await CreatePostAsync(host, Draft(media, "xen-giua"), cookie: host.Cookie(Editor));
        });
        var body = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Task.FromResult(response)));

        Assert.Equal(0, body.GetProperty("total").GetInt32());               // the post committed during the read is not in these rows …
        Assert.Equal(before.ToString(), body.GetProperty("viewWatermark").GetString()); // … and the watermark does not claim it
        Assert.True(long.Parse(body.GetProperty("viewWatermark").GetString()!) < after);
    }

    [Theory]
    [InlineData(CounterRead)]
    [InlineData("FROM \"BlogCategories\"")]
    public async Task A_category_list_never_pairs_rows_with_a_watermark_from_another_moment_when_a_write_commits_in_the_middle(string pauseAfter)
    {
        var seeded = 0;
        var (response, before, after) = await ListAcrossAWriteAsync("/categories", pauseAfter, async host =>
        {
            seeded = await CountAsync("BlogCategories");
            await CreateCategoryAsync(host, "xen-giua-dm", cookie: host.Cookie(Publisher));
        });
        var ok = await AssertStatusAsync(HttpStatusCode.OK, Task.FromResult(response));
        var rows = await JsonAsync(ok);

        Assert.Equal(seeded, rows.GetArrayLength());                           // the category created during the read is not in the rows
        Assert.Equal(before.ToString(), Assert.Single(ok.Headers.GetValues(Watermark)));
        Assert.True(long.Parse(Assert.Single(ok.Headers.GetValues(Watermark))) < after);
    }

    // ---------------------------------------------------------------------------------------------------------- the browser can send and read the new headers

    private static HttpRequestMessage Preflight(string path, string origin, string method, string headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, Root + path);
        request.Headers.TryAddWithoutValidation("Origin", origin);
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Method", method);
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", headers);
        return request;
    }

    private static string[] Allowed(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? [.. values.SelectMany(value => value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))] : [];

    [Fact]
    public async Task The_Admin_origin_may_send_the_correlation_header_to_the_three_chain_routes_only_and_read_the_watermark_header_of_the_categories_only()
    {
        using var host = await StartAsync();
        var post = Guid.NewGuid();
        var headers = "content-type, x-admin-correlation-id";

        foreach (var (path, method) in new[] { ("/posts", "POST"), ($"/posts/{post}/translations/vi/draft", "POST"), ($"/posts/{post}/translations/vi/publish", "POST") })
        {
            var allowed = await host.Client.SendAsync(Preflight(path, AdminOrigin, method, headers));
            Assert.Equal(AdminOrigin, Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Credentials")));
            Assert.Contains(Correlation, Allowed(allowed, "Access-Control-Allow-Headers"), StringComparer.OrdinalIgnoreCase);
            Assert.Equal(["POST"], Allowed(allowed, "Access-Control-Allow-Methods"));

            // the allowlist of origins is unchanged
            Assert.False((await host.Client.SendAsync(Preflight(path, "https://evil.example", method, headers))).Headers.Contains("Access-Control-Allow-Origin"));
        }

        // every other Blog write keeps the shared policy: the extra header is not allowed there (the browser would refuse the request), Content-Type still is
        foreach (var path in new[] { $"/posts/{post}/translations/vi/unpublish", $"/posts/{post}/translations/vi/archive", "/settings/save", "/categories", $"/media/{post}/delete" })
        {
            Assert.DoesNotContain(Correlation, Allowed(await host.Client.SendAsync(Preflight(path, AdminOrigin, "POST", headers)), "Access-Control-Allow-Headers"), StringComparer.OrdinalIgnoreCase);
            Assert.Contains("content-type", Allowed(await host.Client.SendAsync(Preflight(path, AdminOrigin, "POST", "content-type")), "Access-Control-Allow-Headers"), StringComparer.OrdinalIgnoreCase);
        }

        // reading: the categories expose the watermark; no other Blog read does (their watermark is in the body)
        var categories = await AssertStatusAsync(HttpStatusCode.OK, host.Client.SendAsync(With(AdminGet("/categories", host.Cookie(Both)), ("Origin", AdminOrigin))));
        Assert.Equal(AdminOrigin, Assert.Single(categories.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Contains(Watermark, Allowed(categories, "Access-Control-Expose-Headers"), StringComparer.OrdinalIgnoreCase);
        Assert.True(categories.Headers.Contains(Watermark));
        foreach (var path in new[] { "/posts", "/media", "/settings" })
        {
            var read = await AssertStatusAsync(HttpStatusCode.OK, host.Client.SendAsync(With(AdminGet(path, host.Cookie(Both)), ("Origin", AdminOrigin))));
            Assert.Empty(Allowed(read, "Access-Control-Expose-Headers"));
            Assert.False(read.Headers.Contains(Watermark), path);
        }

        // a foreign origin is refused by the request boundary and gets no CORS answer
        var foreign = await host.Client.SendAsync(With(AdminGet("/categories", host.Cookie(Both)), ("Origin", "https://evil.example")));
        Assert.False(foreign.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.False(foreign.Headers.Contains("Access-Control-Expose-Headers"));
    }
}
