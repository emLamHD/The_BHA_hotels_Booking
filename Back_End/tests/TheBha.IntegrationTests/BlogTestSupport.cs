using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP01: plumbing of the Blog API tests — a Staff-mode host with five kinds of account (edit only, publish only, both, none,
/// website-settings only), the language rows the Blog needs (English active, French present), pictures uploaded through the real route,
/// and small request builders. Everything runs against real PostgreSQL and the real login.
/// </summary>
public abstract class BlogTestSupport(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    protected const string Editor = "blog-editor@example.com";
    protected const string Publisher = "blog-publisher@example.com";
    protected const string Both = "blog-both@example.com";
    protected const string Root = "/api/admin/v1/website/blog";
    protected const string PublicRoot = "/api/v1/website/blog";
    protected static readonly Guid FeaturedCategory = BlogSeed.FeaturedDestinationsCategoryId;

    protected sealed class BlogHost(WebApplicationFactory<Program> host, HttpClient client, Guid propertyId, Dictionary<string, string> cookies) : IDisposable
    {
        public WebApplicationFactory<Program> Host { get; } = host;
        public HttpClient Client { get; } = client;
        public Guid PropertyId { get; } = propertyId;
        public string Cookie(string email) => cookies[email];

        public void Dispose()
        {
            Client.Dispose();
            Host.Dispose();
        }
    }

    /// <summary>The host's clock is a fixed, settable one: a test moves time on purpose (publication dates, ordering) instead of sleeping.</summary>
    protected void Advance(TimeSpan span) => Factory.Clock.UtcNow += span;

    /// <summary><paramref name="configure"/> replaces services of the host (a storage, a pipeline or a DbContext that fails on purpose); everything else is the real thing.</summary>
    protected async Task<BlogHost> StartBlogAsync(AdminCalendarAccessMode mode = AdminCalendarAccessMode.Staff, Action<IServiceCollection>? configure = null)
    {
        Factory.Clock.UtcNow = DateTimeOffset.Parse("2026-10-21T08:00:00Z");
        var host = CreateHost(mode);
        if (configure is not null)
        {
            host = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(configure));
        }
        var propertyId = await SeedStaffAsync(host);
        foreach (var (email, edit, publish) in new[] { (Editor, true, false), (Publisher, false, true), (Both, true, true) })
        {
            await CliAsync(host, ["--staff-create", "--email", email, "--property-id", propertyId.ToString(), "--role", StaffRole.FrontDesk], Password);
            await CliAsync(host, ["--staff-blog-access", "--email", email, "--edit", edit ? "true" : "false", "--publish", publish ? "true" : "false"]);
        }

        // English is installed but off in the shared test seed; the Blog tests need it on, and French present.
        await ExecuteAsync("""UPDATE "WebsiteLanguages" SET "IsActive" = true WHERE "NormalizedCode" = 'en'""");
        await ExecuteAsync(
            """
            INSERT INTO "WebsiteLanguages" ("Id","Code","NormalizedCode","DisplayName","NativeName","SortOrder","IsActive","IsDefault","Version","CreatedAtUtc","UpdatedAtUtc","UpdatedByStaffId","DefaultCurrencyCode","Direction","FormatLocale")
            VALUES ('7b0c8a10-0001-4000-8000-000000000003','fr','fr','French','Français',30,true,false,1,now(),now(),NULL,NULL,'ltr','fr-FR')
            """);
        var client = CreateHttpsClient(host);
        var cookies = new Dictionary<string, string>();
        foreach (var email in new[] { Editor, Publisher, Both, Desk, Site, Manager })
        {
            cookies[email] = await LoginAsync(client, email);
        }

        return new BlogHost(host, client, propertyId, cookies);
    }

    // ---- requests ----

    protected static HttpRequestMessage AdminGet(string path, string? cookie) => Get(Root + path, cookie);

    protected static HttpRequestMessage AdminPost(string path, object? body, string? cookie) => Post(Root + path, body, cookie);

    protected static Task<HttpResponseMessage> SendAsync(BlogHost host, HttpRequestMessage request) => host.Client.SendAsync(request);

    protected Task<HttpResponseMessage> PublicAsync(BlogHost host, string path, string? ifNoneMatch = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, PublicRoot + path);
        if (ifNoneMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        }

        return host.Client.SendAsync(request);
    }

    protected async Task<JsonElement> PublicOkAsync(BlogHost host, string path) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, path)));

    // ---- content builders ----

    protected static JsonObject Paragraph(string text) =>
        new() { ["type"] = "paragraph", ["inlines"] = new JsonArray(new JsonObject { ["text"] = text }) };

    protected static JsonObject BodyOf(params JsonObject[] blocks) =>
        new() { ["schemaVersion"] = 1, ["blocks"] = new JsonArray(blocks.Select(b => (JsonNode)b).ToArray()) };

    /// <summary>A draft that can be published: everything the publish checks ask for. <paramref name="change"/> edits it.</summary>
    protected static JsonObject Draft(Guid media, string slug, string title = "Bãi biển Mỹ Khê", Action<JsonObject>? change = null, params Guid[] categories)
    {
        var ids = categories.Length == 0 ? [FeaturedCategory] : categories;
        var draft = new JsonObject
        {
            ["title"] = title,
            ["slug"] = slug,
            ["summary"] = "Một bãi biển dài ở Đà Nẵng.",
            ["body"] = BodyOf(
                new JsonObject { ["type"] = "heading", ["level"] = 2, ["text"] = "Giới thiệu" },
                Paragraph("Nội dung bài viết " + title)),
            ["coverMediaId"] = media.ToString(),
            ["coverAlt"] = "Bãi biển Mỹ Khê",
            ["authorName"] = "Ban biên tập",
            ["metaTitle"] = title + " | The BHA",
            ["metaDescription"] = "Mô tả cho công cụ tìm kiếm.",
            ["categoryIds"] = new JsonArray(ids.Select(id => (JsonNode)id.ToString()).ToArray()),
            ["primaryCategoryId"] = ids[0].ToString()
        };
        change?.Invoke(draft);
        return draft;
    }

    protected async Task<Guid> UploadAsync(BlogHost host, string cookie, string file = "cover.png")
    {
        var response = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, UploadRequest(file, cookie)));
        return (await JsonAsync(response)).GetProperty("id").GetGuid();
    }

    protected static HttpRequestMessage UploadRequest(string file, string? cookie, byte[]? bytes = null)
    {
        bytes ??= File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "promotion", file));
        var content = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        content.Add(part, "file", "cover.png");
        var request = new HttpRequestMessage(HttpMethod.Post, Root + "/media") { Content = content };
        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        request.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        return request;
    }

    // ---- operations (each asserts the expected status and returns the body) ----

    protected async Task<JsonElement> CreatePostAsync(BlogHost host, JsonObject draft, string locale = "vi", Guid? id = null, string? cookie = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await AssertStatusAsync(expected, SendAsync(host, AdminPost("/posts", new { id = id ?? Guid.NewGuid(), locale, draft }, cookie ?? host.Cookie(Editor))));
        return await JsonAsync(response);
    }

    protected async Task<JsonElement> SaveDraftAsync(BlogHost host, Guid postId, string locale, int expectedVersion, JsonObject draft, string? cookie = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await AssertStatusAsync(expected, SendAsync(host, AdminPost($"/posts/{postId}/translations/{locale}/draft", new { expectedVersion, draft }, cookie ?? host.Cookie(Editor))));
        return await JsonAsync(response);
    }

    protected async Task<JsonElement> TransitionAsync(BlogHost host, Guid postId, string locale, string action, int expectedVersion, string? cookie = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await AssertStatusAsync(expected, SendAsync(host, AdminPost($"/posts/{postId}/translations/{locale}/{action}", new { expectedVersion }, cookie ?? host.Cookie(Publisher))));
        return await JsonAsync(response);
    }

    protected async Task<JsonElement> GetPostAsync(BlogHost host, Guid postId) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/posts/{postId}", host.Cookie(Both)))));

    protected static JsonElement Translation(JsonElement post, string locale) =>
        post.GetProperty("translations").EnumerateArray().Single(t => t.GetProperty("locale").GetString() == locale);

    protected static int Version(JsonElement post, string locale) => Translation(post, locale).GetProperty("version").GetInt32();

    protected static Guid PostId(JsonElement post) => post.GetProperty("id").GetGuid();

    /// <summary>Creates a post with a publishable draft and publishes it; returns its id and the version after publishing.</summary>
    protected async Task<(Guid Id, int Version)> PublishedAsync(BlogHost host, Guid media, string slug, string title = "Bãi biển Mỹ Khê", string locale = "vi", Action<JsonObject>? change = null, params Guid[] categories)
    {
        var created = await CreatePostAsync(host, Draft(media, slug, title, change, categories), locale);
        var published = await TransitionAsync(host, PostId(created), locale, "publish", Version(created, locale));
        return (PostId(created), Version(published, locale));
    }

    protected static async Task<(string? Code, string? Field)> ProblemOf(HttpResponseMessage response) => await ProblemAsync(response);

    protected async Task<JsonElement> CreateCategoryAsync(BlogHost host, string slug, string name = "Ẩm thực", Dictionary<string, object>? translations = null, string? cookie = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        translations ??= new Dictionary<string, object> { ["vi"] = new { name, slug, description = "Mô tả" }, ["en"] = new { name = name + " EN", slug = slug + "-en", description = "Description" } };
        var response = await AssertStatusAsync(expected, SendAsync(host, AdminPost("/categories", new { id = Guid.NewGuid(), sortOrder = 20, translations }, cookie ?? host.Cookie(Publisher))));
        return await JsonAsync(response);
    }

    protected static string[] Slugs(JsonElement list) => list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("slug").GetString()!).ToArray();
}
