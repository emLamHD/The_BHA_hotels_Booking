using System.Net;
using System.Text.Json;
using TheBha.Api;
using TheBha.Api.Authentication;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteSocialApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Admin = "/api/admin/v1/website/social-media";
    private const string Public = "/api/v1/website/social-media";

    [Fact]
    public async Task Seed_is_safe_and_public_response_contains_only_effective_destinations()
    {
        using var session = await StartAsync();
        var admin = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.GetAsync(Admin)));
        Assert.Equal(1, admin.GetProperty("revision").GetInt32());
        Assert.True(admin.GetProperty("phoneEnabled").GetBoolean());
        Assert.Equal("0899474888", admin.GetProperty("phoneNumber").GetString());
        Assert.Equal("tel:+84899474888", admin.GetProperty("phoneHref").GetString());
        Assert.False(admin.GetProperty("messengerEnabled").GetBoolean());
        Assert.False(admin.GetProperty("zaloEnabled").GetBoolean());

        var visitor = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(Public))));
        Assert.Equal(JsonValueKind.Null, visitor.GetProperty("messengerUrl").ValueKind);
        Assert.Equal(JsonValueKind.Null, visitor.GetProperty("zaloUrl").ValueKind);
        Assert.DoesNotContain("updatedBy", visitor.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Save_is_atomic_normalized_immediately_public_and_stale_editor_is_refused()
    {
        using var session = await StartAsync();
        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Admin + "/save", new
        {
            expectedRevision = 1, phoneEnabled = true, phoneNumber = "+84 912 345 678",
            messengerEnabled = true, messengerUrl = "https://m.me/the.bha",
            zaloEnabled = true, zaloNumber = "+84 899 474 888", backToTopEnabled = false
        })));
        Assert.Equal(2, saved.GetProperty("revision").GetInt32());
        Assert.Equal("tel:+84912345678", saved.GetProperty("phoneHref").GetString());
        Assert.Equal("https://zalo.me/0899474888", saved.GetProperty("zaloUrl").GetString());

        var visitor = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(Public))));
        Assert.Equal("https://m.me/the.bha", visitor.GetProperty("messengerUrl").GetString());
        Assert.False(visitor.GetProperty("backToTopEnabled").GetBoolean());

        var stale = await session.PostAsync(Admin + "/save", new
        {
            expectedRevision = 1, phoneEnabled = false, phoneNumber = "", messengerEnabled = false,
            messengerUrl = (string?)null, zaloEnabled = false, zaloNumber = (string?)null, backToTopEnabled = true
        });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("stale-version", (await ProblemAsync(stale)).Code);
        Assert.Equal(2, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteSocialSettings" """));
    }

    [Theory]
    [InlineData("https://m.me.evil/page", "messengerUrl")]
    [InlineData("javascript:alert(1)", "messengerUrl")]
    [InlineData("https://www.messenger.com/home", "messengerUrl")]
    public async Task Unsafe_messenger_values_are_rejected_without_a_write(string link, string field)
    {
        using var session = await StartAsync();
        var response = await session.PostAsync(Admin + "/save", new
        {
            expectedRevision = 1, phoneEnabled = true, phoneNumber = "0899474888", messengerEnabled = true,
            messengerUrl = link, zaloEnabled = false, zaloNumber = (string?)null, backToTopEnabled = true
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(field, (await ProblemAsync(response)).Field);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteSocialSettings" """));
    }

    [Fact]
    public async Task Save_keeps_the_staff_origin_json_https_and_local_gate_boundaries()
    {
        var body = new
        {
            expectedRevision = 1, phoneEnabled = true, phoneNumber = "0899474888",
            messengerEnabled = false, messengerUrl = (string?)null,
            zaloEnabled = false, zaloNumber = (string?)null, backToTopEnabled = true
        };
        using (var session = await StartAsync())
        {
            await AssertStatusAsync(HttpStatusCode.Unauthorized, session.Client.SendAsync(Post(Admin + "/save", body)));
            var desk = await LoginAsync(session.Client, Desk);
            await AssertStatusAsync(HttpStatusCode.Forbidden, session.Client.SendAsync(Post(Admin + "/save", body, desk)));
            await AssertStatusAsync(HttpStatusCode.Forbidden, session.Client.SendAsync(Post(Admin + "/save", body, session.Cookie, origins: [])));
            await AssertStatusAsync(HttpStatusCode.Forbidden, session.Client.SendAsync(Post(Admin + "/save", body, session.Cookie, origins: ["https://evil.example"])));
            await AssertStatusAsync(HttpStatusCode.UnsupportedMediaType, session.Client.SendAsync(Post(Admin + "/save", body, session.Cookie, contentType: "text/plain")));

            using var plain = session.Host.CreateClient(new() { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false, HandleCookies = false });
            await AssertStatusAsync(HttpStatusCode.NotFound, plain.SendAsync(Post(Admin + "/save", body, session.Cookie)));
            Assert.Equal(1, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteSocialSettings" """));
        }

        using var localGate = CreateHost(AdminCalendarAccessMode.LocalGate);
        using var localClient = CreateHttpsClient(localGate);
        await AssertStatusAsync(HttpStatusCode.NotFound, localClient.SendAsync(Get(Admin)));
        await AssertStatusAsync(HttpStatusCode.NotFound, localClient.SendAsync(Post(Admin + "/save", body)));
        await AssertStatusAsync(HttpStatusCode.OK, localClient.SendAsync(Get(Public)));
    }
}
