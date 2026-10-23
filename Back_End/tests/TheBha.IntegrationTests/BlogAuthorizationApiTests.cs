using System.Net;
using System.Text.Json;
using TheBha.Api;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP01 / ADR 0010: who may do what. Read needs edit or publish; edit does not publish; publish does not edit; a Property role or the
/// website-settings flag grants nothing; no cookie, a customer cookie, a revoked flag, LocalGate, a foreign Origin and a non-JSON body are all refused —
/// and the public routes need none of it.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogAuthorizationApiTests(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    private enum Need { Read, Edit, Publish }

    private static readonly Guid Any = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static IEnumerable<(string Name, HttpMethod Method, string Path, object? Body, Need Need)> Routes()
    {
        yield return ("settings", HttpMethod.Get, "/settings", null, Need.Read);
        yield return ("categories", HttpMethod.Get, "/categories", null, Need.Read);
        yield return ("pins", HttpMethod.Get, $"/categories/{Any}/pins", null, Need.Read);
        yield return ("posts", HttpMethod.Get, "/posts", null, Need.Read);
        yield return ("post", HttpMethod.Get, $"/posts/{Any}", null, Need.Read);
        yield return ("revisions", HttpMethod.Get, $"/posts/{Any}/translations/vi/revisions", null, Need.Read);
        yield return ("revision", HttpMethod.Get, $"/posts/{Any}/translations/vi/revisions/{Any}", null, Need.Read);
        yield return ("preview", HttpMethod.Get, $"/posts/{Any}/translations/vi/preview", null, Need.Read);
        yield return ("admin media", HttpMethod.Get, $"/media/{Any}", null, Need.Read);
        yield return ("create post", HttpMethod.Post, "/posts", new { id = Any, locale = "vi", draft = new { title = "x" } }, Need.Edit);
        yield return ("save draft", HttpMethod.Post, $"/posts/{Any}/translations/vi/draft", new { expectedVersion = 1, draft = new { title = "x" } }, Need.Edit);
        yield return ("restore", HttpMethod.Post, $"/posts/{Any}/translations/vi/revisions/{Any}/restore", new { expectedVersion = 1 }, Need.Edit);
        yield return ("publish", HttpMethod.Post, $"/posts/{Any}/translations/vi/publish", new { expectedVersion = 1 }, Need.Publish);
        yield return ("unpublish", HttpMethod.Post, $"/posts/{Any}/translations/vi/unpublish", new { expectedVersion = 1 }, Need.Publish);
        yield return ("archive", HttpMethod.Post, $"/posts/{Any}/translations/vi/archive", new { expectedVersion = 1 }, Need.Publish);
        yield return ("unarchive", HttpMethod.Post, $"/posts/{Any}/translations/vi/unarchive", new { expectedVersion = 1 }, Need.Publish);
        yield return ("create category", HttpMethod.Post, "/categories", new { id = Any, translations = new { } }, Need.Publish);
        yield return ("save category", HttpMethod.Post, $"/categories/{Any}/save", new { expectedVersion = 1, translations = new { } }, Need.Publish);
        yield return ("delete category", HttpMethod.Post, $"/categories/{Any}/delete", new { expectedVersion = 1 }, Need.Publish);
        yield return ("save pins", HttpMethod.Post, $"/categories/{Any}/pins/save", new { expectedVersion = 1, postIds = Array.Empty<Guid>() }, Need.Publish);
        yield return ("save settings", HttpMethod.Post, "/settings/save", new { expectedVersion = 1 }, Need.Publish);
    }

    private static HttpRequestMessage Build((string Name, HttpMethod Method, string Path, object? Body, Need Need) route, string? cookie) =>
        route.Method == HttpMethod.Get ? AdminGet(route.Path, cookie) : AdminPost(route.Path, route.Body, cookie);

    private static bool Allowed(Need need, string account) => need switch
    {
        Need.Read => account is Editor or Publisher or Both,
        Need.Edit => account is Editor or Both,
        _ => account is Publisher or Both
    };

    [Fact]
    public async Task Every_route_enforces_its_permission_for_every_kind_of_account()
    {
        using var host = await StartBlogAsync();
        foreach (var route in Routes())
        {
            // Not signed in: 401. A Staff member with no Blog flag, or only the website-settings flag, or a Manager role: 403.
            Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, Build(route, null))).StatusCode);
            foreach (var account in new[] { Desk, Site, Manager })
            {
                Assert.True(HttpStatusCode.Forbidden == (await SendAsync(host, Build(route, host.Cookie(account)))).StatusCode, $"{route.Name} as {account}");
            }

            foreach (var account in new[] { Editor, Publisher, Both })
            {
                var status = (await SendAsync(host, Build(route, host.Cookie(account)))).StatusCode;
                Assert.True(
                    Allowed(route.Need, account) ? status is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) : status == HttpStatusCode.Forbidden,
                    $"{route.Name} as {account} (need {route.Need}) answered {(int)status}");
            }
        }
    }

    [Fact]
    public async Task Picture_upload_needs_edit_or_publish_and_nothing_else()
    {
        using var host = await StartBlogAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, UploadRequest("cover.png", null))).StatusCode);
        foreach (var account in new[] { Desk, Site, Manager })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(host, UploadRequest("cover.png", host.Cookie(account)))).StatusCode);
        }

        foreach (var account in new[] { Editor, Publisher, Both })
        {
            await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, UploadRequest("cover.png", host.Cookie(account))));
        }

        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "BlogMedia" """));
        // Not a picture, and too small, are refused with the picture codes; nothing is recorded.
        var junk = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, UploadRequest("cover.png", host.Cookie(Editor), [1, 2, 3, 4])));
        Assert.Equal("file", (await ProblemAsync(junk)).Field);
        var small = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, UploadRequest("small.png", host.Cookie(Editor))));
        Assert.Equal("file", (await ProblemAsync(small)).Field);
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "BlogMedia" """));
    }

    [Fact]
    public async Task A_customer_session_is_not_a_staff_session()
    {
        using var host = await StartBlogAsync();
        var customer = await CustomerLoginAsync(host.Host, host.Client);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, AdminGet("/posts", customer))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, AdminPost("/posts", new { id = Any, locale = "vi", draft = new { title = "x" } }, customer))).StatusCode);
    }

    [Fact]
    public async Task Revoking_a_flag_or_disabling_the_account_takes_effect_on_the_next_request()
    {
        using var host = await StartBlogAsync();
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts", host.Cookie(Editor))));

        // The cookie is the same; the database no longer grants it.
        await CliAsync(host.Host, ["--staff-blog-access", "--email", Editor, "--edit", "false", "--publish", "false"]);
        await AssertStatusAsync(HttpStatusCode.Forbidden, SendAsync(host, AdminGet("/posts", host.Cookie(Editor))));

        // Granting publish alone gives read and publish, still not edit.
        await CliAsync(host.Host, ["--staff-blog-access", "--email", Editor, "--edit", "false", "--publish", "true"]);
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts", host.Cookie(Editor))));
        await AssertStatusAsync(HttpStatusCode.Forbidden, SendAsync(host, AdminPost("/posts", new { id = Any, locale = "vi", draft = new { title = "x" } }, host.Cookie(Editor))));

        await CliAsync(host.Host, ["--staff-disable", "--email", Both]);
        var disabled = (await SendAsync(host, AdminGet("/posts", host.Cookie(Both)))).StatusCode;
        Assert.True(disabled is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden, disabled.ToString());
    }

    [Fact]
    public async Task The_cli_verb_is_strict_and_refuses_a_disabled_or_unknown_account()
    {
        using var host = await StartBlogAsync();
        Assert.NotEqual(0, (await RunCliAsync(host.Host, ["--staff-blog-access", "--email", Editor, "--edit", "yes", "--publish", "false"])).Exit);
        Assert.NotEqual(0, (await RunCliAsync(host.Host, ["--staff-blog-access", "--email", "nobody@example.com", "--edit", "true", "--publish", "true"])).Exit);
        Assert.NotEqual(0, (await RunCliAsync(host.Host, ["--staff-blog-access", "--email", Editor, "--edit", "true"])).Exit);
        await CliAsync(host.Host, ["--staff-disable", "--email", Desk]);
        Assert.NotEqual(0, (await RunCliAsync(host.Host, ["--staff-blog-access", "--email", Desk, "--edit", "true", "--publish", "false"])).Exit);

        // Nothing changed by the refused calls; the answers of me/login list exactly the flags set.
        var me = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, host.Client.SendAsync(Get("/api/admin/v1/me", host.Cookie(Both)))));
        Assert.Equal(["BlogEdit", "BlogPublish"], me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).Order().ToArray());
        var editor = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, host.Client.SendAsync(Get("/api/admin/v1/me", host.Cookie(Editor)))));
        Assert.Equal(["BlogEdit"], editor.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).ToArray());
        var site = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, host.Client.SendAsync(Get("/api/admin/v1/me", host.Cookie(Site)))));
        Assert.Equal(["WebsiteSettingsManage"], site.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).ToArray());
    }

    [Fact]
    public async Task The_staff_boundary_applies_origin_json_and_no_store()
    {
        using var host = await StartBlogAsync();
        var body = new { id = Guid.NewGuid(), locale = "vi", draft = new { title = "x" } };
        var wrongOrigin = AdminPost("/posts", body, host.Cookie(Editor));
        wrongOrigin.Headers.Remove("Origin");
        wrongOrigin.Headers.TryAddWithoutValidation("Origin", "https://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(host, wrongOrigin)).StatusCode);

        var noOrigin = AdminPost("/posts", body, host.Cookie(Editor));
        noOrigin.Headers.Remove("Origin");
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(host, noOrigin)).StatusCode);

        var form = Post(Root + "/posts", "title=x", host.Cookie(Editor), null, "application/x-www-form-urlencoded");
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await SendAsync(host, form)).StatusCode);

        var read = await SendAsync(host, AdminGet("/posts", host.Cookie(Editor)));
        Assert.Equal("no-store", read.Headers.CacheControl!.ToString());
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPosts" """));
    }

    [Fact]
    public async Task In_local_gate_mode_the_blog_admin_does_not_exist()
    {
        using var host = await StartBlogAsync(AdminCalendarAccessMode.LocalGate);
        foreach (var route in Routes().Take(8))
        {
            Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(host, Build(route, null))).StatusCode);
        }

        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(host, AdminPost("/posts", new { id = Any, locale = "vi", draft = new { title = "x" } }, null))).StatusCode);
    }

    [Fact]
    public async Task The_public_routes_need_no_session_and_ignore_one()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        await PublishedAsync(host, media, "cong-khai");

        string[] paths = ["/posts?locale=vi", "/posts/cong-khai?locale=vi", "/categories?locale=vi", "/categories/diem-den-noi-bat?locale=vi", "/home-section?locale=vi"];
        foreach (var path in paths)
        {
            var anonymous = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, path)));
            var request = new HttpRequestMessage(HttpMethod.Get, PublicRoot + path);
            request.Headers.Add("Cookie", host.Cookie(Both));
            var signedIn = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, host.Client.SendAsync(request)));
            Assert.Equal(anonymous.GetRawText(), signedIn.GetRawText());
        }

        // The public surface only reads: no write verb is routed, and no public route sits under the admin prefix.
        foreach (var verb in new[] { HttpMethod.Post, HttpMethod.Put, HttpMethod.Delete, HttpMethod.Patch })
        {
            var attempt = await host.Client.SendAsync(new HttpRequestMessage(verb, PublicRoot + "/posts") { Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json") });
            Assert.True(attempt.StatusCode is HttpStatusCode.MethodNotAllowed or HttpStatusCode.NotFound or HttpStatusCode.Forbidden or HttpStatusCode.BadRequest, $"{verb} {attempt.StatusCode}");
        }

        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPosts" """));
    }

    private static readonly string[] Internal =
    [
        "updatedBy", "createdBy", "publishedBy", "email", "staffId", "version", "expectedVersion", "status", "draft", "revisions", "revisionId",
        "translationId", "actor", "audit", "state", "origin", "restoredFromRevisionId", "hasDraft", "storageKey", "byteSize", "createdAtUtc", "updatedAtUtc"
    ];

    private static void AssertNoInternalFields(JsonElement element, string path = "$")
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    Assert.DoesNotContain(property.Name, Internal);
                    AssertNoInternalFields(property.Value, $"{path}.{property.Name}");
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    AssertNoInternalFields(item, path + "[]");
                }

                break;
        }
    }

    [Fact]
    public async Task Public_payloads_carry_no_internal_field_and_no_staff_identity()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        await PublishedAsync(host, media, "khong-ro-ri");
        foreach (var path in new[] { "/posts?locale=vi", "/posts/khong-ro-ri?locale=vi", "/categories?locale=vi", "/categories/diem-den-noi-bat?locale=vi", "/home-section?locale=vi" })
        {
            var text = await (await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, path))).Content.ReadAsStringAsync();
            AssertNoInternalFields(JsonDocument.Parse(text).RootElement);
            foreach (var staff in new[] { Editor, Publisher, Both, Site })
            {
                Assert.DoesNotContain(staff, text, StringComparison.OrdinalIgnoreCase);
            }

            Assert.DoesNotContain((await StaffIdAsync(Editor)).ToString(), text, StringComparison.OrdinalIgnoreCase);
        }
    }
}
