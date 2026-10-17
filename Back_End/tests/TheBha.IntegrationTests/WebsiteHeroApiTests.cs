using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using TheBha.Api;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HERO-001-CP01 acceptance (the home hero, server side): the seed is the hero the Customer had in code; one Save applies slides,
/// order, texts, font and timing or nothing; a stale revision is a 409; an upload is checked by its bytes, written completely before it
/// is recorded, and published only when a Save names it; the public read changes the moment a Save commits and carries nothing
/// administrative. Real PostgreSQL and a real media directory, through the real routes and the same Staff boundary as the other website
/// routes — with multipart allowed on the upload route and nowhere else.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteHeroApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Url = "/api/admin/v1/website/hero";
    private const string Public = "/api/v1/website/hero";

    private static byte[] Fixture(string name) => File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "hero", name));

    private async Task<JsonElement> AdminAsync(Session session) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Url)));

    private async Task<JsonElement> PublicAsync(Session session, string query = "") =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get($"{Public}{query}"))));

    /// <summary>The save body that would re-send exactly what the Admin read, ready to be edited.</summary>
    private static JsonObject SaveBody(JsonElement admin)
    {
        var body = new JsonObject
        {
            ["expectedRevision"] = admin.GetProperty("revision").GetString(),
            ["fontKey"] = admin.GetProperty("fontKey").GetString(),
            ["autoplayEnabled"] = admin.GetProperty("autoplayEnabled").GetBoolean(),
            ["intervalSeconds"] = admin.GetProperty("intervalSeconds").GetInt32(),
            ["texts"] = JsonNode.Parse(admin.GetProperty("texts").GetRawText()),
            ["slides"] = new JsonArray([.. admin.GetProperty("slides").EnumerateArray().Select(slide => (JsonNode?)JsonNode.Parse(slide.GetRawText()))]),
        };
        return body;
    }

    private static Task<HttpResponseMessage> SaveAsync(Session session, JsonObject body) => session.PostAsync($"{Url}/save", body.ToJsonString());

    private static HttpRequestMessage UploadRequest(byte[] bytes, string fileName = "banner.png", string partType = "image/png", string? cookie = null, string[]? origins = null, string? contentType = null)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(partType);
        content.Add(file, "file", fileName);
        var request = new HttpRequestMessage(HttpMethod.Post, $"{Url}/media") { Content = content };
        if (contentType is not null)
        {
            request.Content.Headers.Remove("Content-Type");
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

    private static Task<HttpResponseMessage> UploadAsync(Session session, byte[] bytes, string fileName = "banner.png", string partType = "image/png") =>
        session.Client.SendAsync(UploadRequest(bytes, fileName, partType, session.Cookie));

    private static Guid[] SlideIds(JsonElement admin) => [.. admin.GetProperty("slides").EnumerateArray().Select(slide => slide.GetProperty("id").GetGuid())];

    // ------------------------------------------------------------------ the seed

    [Fact]
    public async Task The_seed_is_the_hero_the_customer_had_in_code_with_vi_and_en_texts_and_the_credited_photographs()
    {
        using var session = await StartAsync();
        var admin = await AdminAsync(session);

        Assert.Equal(1, admin.GetProperty("version").GetInt32());
        Assert.Equal("default", admin.GetProperty("fontKey").GetString());
        Assert.True(admin.GetProperty("autoplayEnabled").GetBoolean());
        Assert.Equal(6, admin.GetProperty("intervalSeconds").GetInt32());
        var texts = admin.GetProperty("texts");
        Assert.Equal("The BHA — Đà Nẵng", texts.GetProperty("title").GetProperty("vi").GetString());
        Assert.Equal("The BHA — Da Nang", texts.GetProperty("title").GetProperty("en").GetString());
        Assert.Equal("Tìm phòng", texts.GetProperty("primaryAction").GetProperty("vi").GetString());
        Assert.Equal("Find a room", texts.GetProperty("primaryAction").GetProperty("en").GetString());
        Assert.Equal("View Riverside", texts.GetProperty("secondaryAction").GetProperty("en").GetString());

        var slides = admin.GetProperty("slides").EnumerateArray().ToArray();
        Assert.Equal(4, slides.Length);
        Assert.Equal(["Cầu Rồng và sông Hàn lúc hoàng hôn", "Bãi biển Mỹ Khê", "Đường chân trời Đà Nẵng lúc chạng vạng", "Sông Hàn về đêm"],
            slides.Select(slide => slide.GetProperty("caption").GetProperty("vi").GetString()));
        Assert.Equal(["40% 50%", "50% 50%", "50% 50%", "60% 50%"], slides.Select(slide => slide.GetProperty("focalPosition").GetString()));
        Assert.All(slides, slide => Assert.False(string.IsNullOrWhiteSpace(slide.GetProperty("alt").GetProperty("en").GetString())));

        var media = admin.GetProperty("media").EnumerateArray().ToArray();
        Assert.Equal(4, media.Length);
        Assert.All(media, item => Assert.Equal("seed", item.GetProperty("kind").GetString()));
        Assert.All(media, item => Assert.Equal([1920, 900], new[] { item.GetProperty("width").GetInt32(), item.GetProperty("height").GetInt32() }));
    }

    [Fact]
    public async Task The_public_hero_is_the_saved_hero_in_the_visitors_language_with_nothing_administrative_and_every_built_in_picture_is_served()
    {
        using var session = await StartAsync();
        await CompleteContentAsync("en");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/languages/en/update", new { expectedVersion = 1, displayName = "English", nativeName = "English", sortOrder = 20, isActive = true }));

        var vi = await PublicAsync(session, "?locale=vi");
        Assert.Equal("vi", vi.GetProperty("locale").GetString());
        Assert.Equal("The BHA — Đà Nẵng", vi.GetProperty("title").GetString());
        Assert.Equal(["Cầu Rồng và sông Hàn lúc hoàng hôn", "Bãi biển Mỹ Khê", "Đường chân trời Đà Nẵng lúc chạng vạng", "Sông Hàn về đêm"],
            vi.GetProperty("slides").EnumerateArray().Select(slide => slide.GetProperty("caption").GetString()));
        var en = await PublicAsync(session, "?locale=en");
        Assert.Equal("The BHA — Da Nang", en.GetProperty("title").GetString());
        Assert.Equal("Find a room", en.GetProperty("primaryAction").GetString());
        Assert.Equal("My Khe Beach", en.GetProperty("slides")[1].GetProperty("caption").GetString());
        Assert.Equal("vi", (await PublicAsync(session, "?locale=zz")).GetProperty("locale").GetString());

        // A built-in picture keeps the file its credit is looked up by; no Staff id, draft or administrative field is in the body.
        Assert.Equal(["hero-dragon-bridge-dusk.webp", "hero-my-khe-beach.webp", "hero-danang-skyline.webp", "hero-han-river-night.webp"],
            en.GetProperty("slides").EnumerateArray().Select(slide => slide.GetProperty("seedFile").GetString()));
        foreach (var forbidden in new[] { "updatedBy", "staff", "version", "expected", "mediaId", "storageKey", "createdBy", "/home", "\\\\" })
        {
            Assert.DoesNotContain(forbidden, en.GetRawText(), StringComparison.OrdinalIgnoreCase);
        }

        // Every picture is served by the API — the built-in ones too — with a fixed type, no sniffing and a year of caching.
        foreach (var slide in en.GetProperty("slides").EnumerateArray())
        {
            var response = await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(slide.GetProperty("imageUrl").GetString()!)));
            Assert.Equal("image/webp", response.Content.Headers.ContentType?.MediaType);
            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
            Assert.Contains("immutable", response.Headers.CacheControl!.ToString());
            Assert.True((await response.Content.ReadAsByteArrayAsync()).Length > 10_000);
        }

        // Revalidated on every request; a conditional request is a 304.
        var again = await session.Client.SendAsync(Get($"{Public}?locale=en"));
        Assert.Equal("no-cache", again.Headers.CacheControl?.ToString());
        var conditional = Get($"{Public}?locale=en");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", again.Headers.ETag!.ToString());
        Assert.Equal(HttpStatusCode.NotModified, (await session.Client.SendAsync(conditional)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await session.Client.SendAsync(Get($"/api/v1/website/hero/media/{Guid.NewGuid()}"))).StatusCode);
    }

    // ------------------------------------------------------------------ save

    [Fact]
    public async Task One_save_applies_order_texts_font_timing_and_autoplay_together_and_the_public_hero_follows_at_once()
    {
        using var session = await StartAsync();
        var admin = await AdminAsync(session);
        var staff = await StaffIdAsync(Site);
        var body = SaveBody(admin);
        var slides = body["slides"]!.AsArray();
        var first = slides[0]!.DeepClone();
        slides.RemoveAt(0);
        slides.Add(first);                                                    // the first slide goes last
        slides.RemoveAt(1);                                                   // and the third (now second) is deleted
        var kept = slides.Select(slide => slide!["id"]!.GetValue<Guid>()).ToArray();
        body["fontKey"] = "system-serif";
        body["autoplayEnabled"] = false;
        body["intervalSeconds"] = 12;
        body["texts"]!["title"]!["vi"] = "Khách sạn The BHA";
        body["texts"]!["title"]!["en"] = "The BHA Hotel";
        body["texts"]!["description"]!["en"] = "Book direct.";
        first["caption"]!["en"] = "The Dragon Bridge";

        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, body)));

        Assert.Equal(2, saved.GetProperty("version").GetInt32());
        Assert.NotEqual(admin.GetProperty("revision").GetString(), saved.GetProperty("revision").GetString());
        Assert.Equal(staff, saved.GetProperty("updatedByStaffId").GetGuid());
        Assert.Equal(kept, SlideIds(saved));
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroSlides" """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT "SortOrder" FROM "WebsiteHeroSlides" WHERE "Id" = '{kept[0]}' """));
        Assert.Equal(4, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" """));           // a removed slide never deletes its picture
        Assert.Equal("Khách sạn The BHA", await ScalarAsync<string>("""SELECT "Title" FROM "WebsiteHero" """));
        Assert.Equal("The BHA Hotel", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.heroSlideshow.main.title' AND "LanguageId" = '{WebsiteTestSeed.English}' """));
        Assert.True(await ScalarAsync<bool>($"""SELECT "IsManual" FROM "WebsiteTranslations" WHERE "Key" = 'content.heroSlideshow.main.title' AND "LanguageId" = '{WebsiteTestSeed.English}' """));
        Assert.Equal(SourceText.Hash("Khách sạn The BHA"), await ScalarAsync<string>($"""SELECT "SourceHash" FROM "WebsiteTranslations" WHERE "Key" = 'content.heroSlideshow.main.title' AND "LanguageId" = '{WebsiteTestSeed.English}' """));
        // The deleted slide leaves no orphan text; the others keep theirs.
        var deleted = SlideIds(admin).Except(kept).Single();
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.heroSlide.{deleted}.%' """));
        Assert.Equal("The Dragon Bridge", await ScalarAsync<string>($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.heroSlide.{kept[^1]}.caption' AND "LanguageId" = '{WebsiteTestSeed.English}' """));

        var visitor = await PublicAsync(session, "?locale=vi");
        Assert.Equal("system-serif", visitor.GetProperty("fontKey").GetString());
        Assert.False(visitor.GetProperty("autoplayEnabled").GetBoolean());
        Assert.Equal(12, visitor.GetProperty("intervalSeconds").GetInt32());
        Assert.Equal("Khách sạn The BHA", visitor.GetProperty("title").GetString());
        Assert.Equal(kept, visitor.GetProperty("slides").EnumerateArray().Select(slide => slide.GetProperty("id").GetGuid()));

        // The new state survives a restart of the API (no seed runs at startup) and a save that changes nothing makes no new version.
        using var restarted = CreateHost();
        using var client = CreateHttpsClient(restarted);
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get(Url, await LoginAsync(client, Site)))));
        Assert.Equal(2, again.GetProperty("version").GetInt32());
        Assert.Equal("Khách sạn The BHA", again.GetProperty("texts").GetProperty("title").GetProperty("vi").GetString());
        var unchanged = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, SaveBody(saved))));
        Assert.Equal(2, unchanged.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task A_save_that_breaks_a_rule_is_refused_with_its_field_and_changes_nothing()
    {
        using var session = await StartAsync();
        var admin = await AdminAsync(session);
        var unknownPicture = Guid.NewGuid();

        var cases = new (string Name, Action<JsonObject> Edit, string Code, string Field)[]
        {
            ("unknown font", body => body["fontKey"] = "comic-sans", HeroErrorCodes.FontInvalid, "fontKey"),
            ("css as a font", body => body["fontKey"] = "serif; background:url(//evil)", HeroErrorCodes.FontInvalid, "fontKey"),
            ("interval 2", body => body["intervalSeconds"] = 2, HeroErrorCodes.IntervalInvalid, "intervalSeconds"),
            ("interval 61", body => body["intervalSeconds"] = 61, HeroErrorCodes.IntervalInvalid, "intervalSeconds"),
            ("no slide", body => body["slides"] = new JsonArray(), HeroErrorCodes.SlideCount, "slides"),
            ("eleven slides", body =>
            {
                var slides = body["slides"]!.AsArray();
                while (slides.Count < 11)
                {
                    var copy = slides[0]!.DeepClone();
                    copy["id"] = Guid.NewGuid();
                    slides.Add(copy);
                }
            }, HeroErrorCodes.SlideCount, "slides"),
            ("a picture that does not exist", body => body["slides"]![0]!["mediaId"] = unknownPicture, HeroErrorCodes.MediaMissing, "slides[0].mediaId"),
            ("markup in a text", body => body["texts"]!["title"]!["vi"] = "<script>alert(1)</script>", HeroErrorCodes.TextInvalid, "texts.title.vi"),
            ("a missing source text", body => body["slides"]![1]!["alt"]!["vi"] = "", HeroErrorCodes.TextRequired, "slides[1].alt.vi"),
            ("an unknown language", body => body["texts"]!["description"]!["zz"] = "x", HeroErrorCodes.UnknownLocale, "texts.description.zz"),
            ("a bad focal position", body => body["slides"]![2]!["focalPosition"] = "center", HeroErrorCodes.FocalInvalid, "slides[2].focalPosition"),
            ("the same slide twice", body => body["slides"]![1]!["id"] = body["slides"]![0]!["id"]!.GetValue<Guid>(), HeroErrorCodes.DuplicateSlide, "slides[1].id"),
        };
        foreach (var (name, edit, code, field) in cases)
        {
            var body = SaveBody(admin);
            edit(body);
            var response = await AssertStatusAsync(HttpStatusCode.BadRequest, SaveAsync(session, body));
            Assert.True((code, field) == await ProblemAsync(response), name);
        }

        Assert.Equal(1, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteHero" """));
        Assert.Equal("default", await ScalarAsync<string>("""SELECT "FontKey" FROM "WebsiteHero" """));
        Assert.Equal(4, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroSlides" """));
    }

    [Fact]
    public async Task Two_editors_the_second_save_is_a_409_and_a_text_changed_elsewhere_makes_a_save_stale_too()
    {
        using var session = await StartAsync();
        var admin = await AdminAsync(session);
        var first = SaveBody(admin);
        var second = SaveBody(admin);
        first["intervalSeconds"] = 9;
        second["intervalSeconds"] = 15;

        await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, first));
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, SaveAsync(session, second));
        Assert.Equal((WebsiteErrorCodes.StaleVersion, null), await ProblemAsync(stale));
        Assert.Equal(9, await ScalarAsync<int>("""SELECT "IntervalSeconds" FROM "WebsiteHero" """));       // the first editor's work stands

        // A text edited on the Translations screen after the editor loaded is also a stale save.
        var loaded = await AdminAsync(session);
        var key = "content.heroSlideshow.main.title";
        var version = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{key}' AND "LanguageId" = '{WebsiteTestSeed.English}' """);
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync("/api/admin/v1/website/translations/save", new { locale = "en", key, value = "Edited elsewhere", expectedVersion = version }));
        await AssertStatusAsync(HttpStatusCode.Conflict, SaveAsync(session, SaveBody(loaded)));
    }

    [Fact]
    public async Task Two_saves_with_the_same_revision_at_once_apply_exactly_one()
    {
        using var session = await StartAsync();
        var admin = await AdminAsync(session);
        var bodies = new[] { 7, 8, 9, 10 }.Select(seconds =>
        {
            var body = SaveBody(admin);
            body["intervalSeconds"] = seconds;
            return body;
        }).ToArray();

        var responses = await Task.WhenAll(bodies.Select(body => SaveAsync(session, body)));

        Assert.Equal(1, responses.Count(response => response.StatusCode == HttpStatusCode.OK));
        Assert.Equal(3, responses.Count(response => response.StatusCode == HttpStatusCode.Conflict));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteHero" """));
    }

    // ------------------------------------------------------------------ upload

    [Fact]
    public async Task An_upload_is_checked_by_its_bytes_stored_under_a_server_name_and_not_published_until_a_save_names_it()
    {
        using var session = await StartAsync();
        var before = await AdminAsync(session);
        var png = Fixture("valid.png");

        // The file name and the part's media type are ignored: the bytes decide.
        var response = await AssertStatusAsync(HttpStatusCode.OK, UploadAsync(session, png, "../../etc/passwd.svg", "image/svg+xml"));
        var media = await JsonAsync(response);

        var id = media.GetProperty("id").GetGuid();
        Assert.Equal("upload", media.GetProperty("kind").GetString());
        Assert.Equal("image/png", media.GetProperty("contentType").GetString());
        Assert.Equal([640, 320], new[] { media.GetProperty("width").GetInt32(), media.GetProperty("height").GetInt32() });
        Assert.Equal($"/api/admin/v1/website/hero/media/{id}", media.GetProperty("url").GetString());           // the Admin's own, Staff-only route
        Assert.Equal(JsonValueKind.Null, media.GetProperty("seedFile").ValueKind);
        var key = await ScalarAsync<string>($"""SELECT "StorageKey" FROM "WebsiteHeroMedia" WHERE "Id" = '{id}' """);
        Assert.Equal($"hero/{id:N}.png", key);
        var path = Path.Combine(Factory.MediaRoot, key);
        Assert.Equal(png, await File.ReadAllBytesAsync(path));
        Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(path)!, "*.tmp"));
        Assert.DoesNotContain(Factory.MediaRoot, response.ToString() + media.GetRawText());      // no disk path is ever returned

        // Uploaded is not published: the slideshow and the public hero are unchanged, and the version too.
        Assert.Equal(before.GetProperty("revision").GetString(), (await AdminAsync(session)).GetProperty("revision").GetString());
        Assert.DoesNotContain(id.ToString(), (await PublicAsync(session)).GetRawText());

        // The editor sees it from the Admin's route (Staff session + permission), with its recorded type; the route is not public.
        var adminUrl = media.GetProperty("url").GetString()!;
        var served = await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(adminUrl));
        Assert.Equal("image/png", served.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", served.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(png, await served.Content.ReadAsByteArrayAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.Client.SendAsync(Get(adminUrl))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(Get(adminUrl, await LoginAsync(session.Client, Desk)))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await session.GetAsync($"{Url}/media/{Guid.NewGuid()}")).StatusCode);

        // A Save that names it as a new slide publishes it; a replaced picture keeps its slide, texts and old file.
        var body = SaveBody(before);
        var replaced = body["slides"]![1]!;
        var oldMedia = replaced["mediaId"]!.GetValue<Guid>();
        replaced["mediaId"] = id;
        replaced["focalPosition"] = "50% 50%";
        var added = body["slides"]![0]!.DeepClone();
        added["id"] = Guid.NewGuid();
        added["mediaId"] = id;
        added["alt"]!["vi"] = "Ảnh mới"; added["caption"]!["vi"] = "Chú thích mới"; added["alt"]!["en"] = null; added["caption"]!["en"] = null;
        body["slides"]!.AsArray().Add(added);
        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, body)));
        Assert.Equal(5, saved.GetProperty("slides").GetArrayLength());
        var publicHero = await PublicAsync(session, "?locale=vi");
        Assert.Null(publicHero.GetProperty("slides")[4].GetProperty("seedFile").GetString());      // never another picture's credit
        Assert.Equal("Ảnh mới", publicHero.GetProperty("slides")[4].GetProperty("alt").GetString());
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteHeroMedia" WHERE "Id" = '{oldMedia}' """));
        Assert.Equal(5, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" """));
        Assert.Equal(5, saved.GetProperty("media").GetArrayLength());                                // the library lists the old picture too

        // After a restart of the API the uploaded picture is still there and still served.
        using var restarted = CreateHost();
        using var client = CreateHttpsClient(restarted);
        var again = await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get($"/api/v1/website/hero/media/{id}")));
        Assert.Equal(png, await again.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task Jpeg_and_webp_are_accepted_and_get_their_own_extension()
    {
        using var session = await StartAsync();
        var jpeg = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, UploadAsync(session, Fixture("valid.jpg"), "a.png", "image/png")));
        var webp = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, UploadAsync(session, Fixture("valid-lossy.webp"), "a.jpg", "image/jpeg")));

        Assert.Equal("image/jpeg", jpeg.GetProperty("contentType").GetString());
        Assert.Equal("image/webp", webp.GetProperty("contentType").GetString());
        Assert.EndsWith(".jpg", await ScalarAsync<string>($"""SELECT "StorageKey" FROM "WebsiteHeroMedia" WHERE "Id" = '{jpeg.GetProperty("id").GetGuid()}' """));
        Assert.EndsWith(".webp", await ScalarAsync<string>($"""SELECT "StorageKey" FROM "WebsiteHeroMedia" WHERE "Id" = '{webp.GetProperty("id").GetGuid()}' """));
    }

    [Fact]
    public async Task A_bad_upload_is_refused_with_a_code_and_leaves_no_file_and_no_row()
    {
        using var session = await StartAsync();
        var png = Fixture("valid.png");
        var filesBefore = Directory.Exists(Factory.MediaRoot) ? Directory.GetFiles(Factory.MediaRoot, "*", SearchOption.AllDirectories).Length : 0;
        var cases = new (string Name, byte[] Bytes, string FileName, string PartType, string Code)[]
        {
            ("html called a png", "<html><script>alert(1)</script></html>"u8.ToArray(), "x.png", "image/png", HeroErrorCodes.ImageUnsupported),
            ("svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"u8.ToArray(), "x.svg", "image/svg+xml", HeroErrorCodes.ImageUnsupported),
            ("gif", Fixture("picture.gif"), "x.gif", "image/gif", HeroErrorCodes.ImageUnsupported),
            ("a truncated png", png[..(png.Length / 2)], "x.png", "image/png", HeroErrorCodes.ImageCorrupt),
            ("bytes after the magic", [.. png[..8], .. new byte[500]], "x.png", "image/png", HeroErrorCodes.ImageCorrupt),
            ("more than ten megabytes", new byte[10 * 1024 * 1024 + 4096], "big.png", "image/png", HeroErrorCodes.ImageTooLarge),
        };
        foreach (var (name, bytes, fileName, partType, code) in cases)
        {
            var response = await AssertStatusAsync(HttpStatusCode.BadRequest, UploadAsync(session, bytes, fileName, partType));
            Assert.True((code, "file") == await ProblemAsync(response), name);
        }

        var empty = await AssertStatusAsync(HttpStatusCode.BadRequest, session.Client.SendAsync(new HttpRequestMessage(HttpMethod.Post, $"{Url}/media")
        {
            Content = new MultipartFormDataContent { { new StringContent("hello"), "other" } },
            Headers = { { "Origin", AdminOrigin }, { "Cookie", session.Cookie } },
        }));
        Assert.Equal((HeroErrorCodes.ImageEmpty, "file"), await ProblemAsync(empty));
        Assert.Equal(4, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" """));
        var filesAfter = Directory.Exists(Factory.MediaRoot) ? Directory.GetFiles(Factory.MediaRoot, "*", SearchOption.AllDirectories).Length : 0;
        Assert.Equal(filesBefore, filesAfter);
    }

    [Fact]
    public async Task A_body_far_over_the_limit_or_not_multipart_is_the_heros_own_refusal_not_a_framework_one_and_stores_nothing()
    {
        using var session = await StartAsync();
        var rows = await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" """);

        var huge = await AssertStatusAsync(HttpStatusCode.BadRequest, UploadAsync(session, new byte[24 * 1024 * 1024]));
        var (code, field) = await ProblemAsync(huge);
        Assert.Equal("file", field);
        Assert.Contains(code, new[] { HeroErrorCodes.UploadUnreadable, HeroErrorCodes.ImageTooLarge });
        var truncated = UploadRequest(Fixture("valid.png"), cookie: session.Cookie);
        truncated.Content = new StringContent("--not-the-boundary\r\ngarbage", System.Text.Encoding.UTF8, "multipart/form-data");
        truncated.Content.Headers.Remove("Content-Type");
        truncated.Content.Headers.TryAddWithoutValidation("Content-Type", "multipart/form-data; boundary=xyz");
        var broken = await AssertStatusAsync(HttpStatusCode.BadRequest, session.Client.SendAsync(truncated));
        Assert.Equal((HeroErrorCodes.UploadUnreadable, "file"), await ProblemAsync(broken));
        Assert.Equal(rows, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" """));
    }

    [Fact]
    public async Task A_save_never_publishes_a_picture_whose_file_is_gone_and_never_deletes_one_in_use()
    {
        using var session = await StartAsync();
        var media = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, UploadAsync(session, Fixture("valid.png"))));
        var path = Path.Combine(Factory.MediaRoot, await ScalarAsync<string>($"""SELECT "StorageKey" FROM "WebsiteHeroMedia" WHERE "Id" = '{media.GetProperty("id").GetGuid()}' """));
        var admin = await AdminAsync(session);
        var body = SaveBody(admin);
        body["slides"]![0]!["mediaId"] = media.GetProperty("id").GetGuid();
        File.Delete(path);                                                       // the file vanished between upload and save

        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, SaveAsync(session, body));
        Assert.Equal((HeroErrorCodes.MediaMissing, "slides[0].mediaId"), await ProblemAsync(refused));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteHero" """));
        Assert.Equal(HttpStatusCode.NotFound, (await session.GetAsync(media.GetProperty("url").GetString()!)).StatusCode);

        // A failed or refused Save, a replaced slide and a deleted slide leave every recorded picture's file where it is.
        await File.WriteAllBytesAsync(path, Fixture("valid.png"));
        body["slides"]![0]!["mediaId"] = media.GetProperty("id").GetGuid();
        await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, body));
        var next = SaveBody(await AdminAsync(session));
        next["slides"]!.AsArray().RemoveAt(0);
        await AssertStatusAsync(HttpStatusCode.OK, SaveAsync(session, next));
        Assert.True(File.Exists(path));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteHeroMedia" WHERE "Id" = '{media.GetProperty("id").GetGuid()}' """));
    }

    [Fact]
    public async Task Without_a_media_root_uploads_say_so_and_everything_else_keeps_working()
    {
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, AdminCalendarAccessMode.Staff.ToString());
            builder.UseSetting("WebsiteMedia:RootPath", "");
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
        });
        await SeedStaffAsync(host);
        var client = CreateHttpsClient(host);
        using var session = new Session(host, client, await LoginAsync(client, Site));

        var response = await AssertStatusAsync(HttpStatusCode.Conflict, UploadAsync(session, Fixture("valid.png")));
        Assert.Equal((HeroErrorCodes.StorageNotConfigured, null), await ProblemAsync(response));
        var hero = await PublicAsync(session);
        Assert.Equal(4, hero.GetProperty("slides").GetArrayLength());
        await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(hero.GetProperty("slides")[0].GetProperty("imageUrl").GetString()!)));       // built-in pictures need no media root
    }

    // ------------------------------------------------------------------ the Staff boundary

    [Fact]
    public async Task The_hero_routes_keep_the_staff_boundary_and_multipart_is_allowed_on_the_upload_route_only()
    {
        using var session = await StartAsync();
        var png = Fixture("valid.png");
        var body = SaveBody(await AdminAsync(session)).ToJsonString();

        // 401: no session. 403: a session without the website permission. Reads need the permission too.
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.Client.SendAsync(UploadRequest(png))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.Client.SendAsync(Get(Url))).StatusCode);
        var desk = await LoginAsync(session.Client, Desk);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(Get(Url, desk))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(UploadRequest(png, cookie: desk))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(Post($"{Url}/save", body, desk))).StatusCode);

        // The upload still needs exactly one approved Origin, and HTTPS.
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(UploadRequest(png, cookie: session.Cookie, origins: []))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(UploadRequest(png, cookie: session.Cookie, origins: ["https://evil.example"]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(UploadRequest(png, cookie: session.Cookie, origins: [AdminOrigin, AdminOrigin]))).StatusCode);
        using var plain = session.Host.CreateClient(new() { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false, HandleCookies = false });
        Assert.Equal(HttpStatusCode.NotFound, (await plain.SendAsync(UploadRequest(png, cookie: session.Cookie))).StatusCode);

        // The upload takes multipart/form-data and nothing else (not JSON, not a raw image, not a boundary-less multipart).
        var jsonToUpload = await session.Client.SendAsync(Post($"{Url}/media", "{}", session.Cookie));
        Assert.True(HttpStatusCode.UnsupportedMediaType == jsonToUpload.StatusCode, $"{(int)jsonToUpload.StatusCode} {await jsonToUpload.Content.ReadAsStringAsync()}");
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await session.Client.SendAsync(Post($"{Url}/media", "x", session.Cookie, contentType: "image/png"))).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await session.Client.SendAsync(UploadRequest(png, cookie: session.Cookie, contentType: "multipart/form-data"))).StatusCode);

        // Every other Staff write — the hero's own save, the menu's, the language's — still takes JSON only, multipart included in the refusal.
        foreach (var path in new[] { $"{Url}/save", "/api/admin/v1/website/menus/save", "/api/admin/v1/website/languages/en/update" })
        {
            var multipart = UploadRequest(png, cookie: session.Cookie);
            multipart.RequestUri = new Uri(path, UriKind.Relative);
            Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await session.Client.SendAsync(multipart)).StatusCode);
        }

        Assert.Equal(HttpStatusCode.OK, (await session.Client.SendAsync(Post($"{Url}/save", body, session.Cookie))).StatusCode);
        Assert.Equal(4, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" """));        // none of the refusals recorded anything
    }

    [Fact]
    public async Task In_local_gate_mode_the_hero_routes_do_not_exist()
    {
        using var host = CreateHost(AdminCalendarAccessMode.LocalGate);
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get(Url))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Post($"{Url}/save", "{}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(UploadRequest(Fixture("valid.png")))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(Public))).StatusCode);                   // the public read has no gate
    }
}
