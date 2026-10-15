using System.Net;
using Microsoft.Extensions.DependencyInjection;
using System.Reflection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Controllers;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 acceptance A2: who may read and write the website settings. The permission is the
/// site-wide <c>WebsiteSettingsManage</c> flag of the Staff account, set only by the operator CLI and read from the
/// database on every request: neither a Property membership nor a role grants it, a revoke ends it at the next
/// request even for a cookie that is still valid, and the Staff request boundary (Origin, JSON, HTTPS) applies.
/// Real PostgreSQL, Staff from the CLI, sessions from the real login route.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteSettingsAuthorizationTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string LanguagesUrl = "/api/admin/v1/website/languages";
    private const string TranslationsUrl = "/api/admin/v1/website/translations?locale=vi";
    private const string CurrenciesUrl = "/api/admin/v1/website/currencies";

    private static readonly string[] AllReads = [LanguagesUrl, TranslationsUrl, CurrenciesUrl];

    [Fact]
    public async Task Only_a_staff_account_with_the_website_flag_reads_or_writes_regardless_of_membership_or_role()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);
        var site = await LoginAsync(client, Site);
        var desk = await LoginAsync(client, Desk);
        var manager = await LoginAsync(client, Manager);
        var customer = await CustomerLoginAsync(host, client);

        foreach (var url in AllReads)
        {
            await AssertStatusAsync(HttpStatusCode.Unauthorized, client.SendAsync(Get(url)));                 // anonymous
            await AssertStatusAsync(HttpStatusCode.Unauthorized, client.SendAsync(Get(url, customer)));       // a Customer session is not Staff
            await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Get(url, desk)));              // FrontDesk membership
            await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Get(url, manager)));           // Manager membership
            await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get(url, site)));                     // the flag, with a FrontDesk membership
        }

        var body = new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false };
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
        await AssertStatusAsync(HttpStatusCode.Unauthorized, client.SendAsync(Post(LanguagesUrl, body)));
        await AssertStatusAsync(HttpStatusCode.Unauthorized, client.SendAsync(Post(LanguagesUrl, body, customer)));
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Post(LanguagesUrl, body, desk)));
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Post(LanguagesUrl, body, manager)));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
        await AssertStatusAsync(HttpStatusCode.Created, client.SendAsync(Post(LanguagesUrl, body, site)));
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
    }

    [Fact]
    public async Task A_flagged_staff_without_any_property_authority_over_a_route_still_works_and_calendar_roles_gain_nothing()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        await CliAsync(host, ["--staff-website-access", "--email", Desk, "--enabled", "true"]);
        using var client = CreateHttpsClient(host);
        var desk = await LoginAsync(client, Desk);
        var manager = await LoginAsync(client, Manager);

        // Desk gained the flag (and kept FrontDesk); Manager did not become a website admin by being a Manager.
        await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get(LanguagesUrl, desk)));
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Get(LanguagesUrl, manager)));
        // The flag changed nothing about the Calendar matrix: a Property route still needs its role.
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" LIMIT 1""");
        await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get($"/api/admin/v1/properties/{propertyId}/reservation-board?from=2026-10-01&to=2026-10-02", desk)));
    }

    [Fact]
    public async Task A_revoke_takes_effect_on_the_next_request_with_the_same_cookie_and_a_grant_restores_it()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);
        var site = await LoginAsync(client, Site);
        await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get(LanguagesUrl, site)));

        var (exit, output) = await RunCliAsync(host, ["--staff-website-access", "--email", Site, "--enabled", "false"]);
        Assert.Equal(0, exit);
        Assert.Contains("revoked", output);
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Get(LanguagesUrl, site)));
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Post(LanguagesUrl, new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false }, site)));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));

        await CliAsync(host, ["--staff-website-access", "--email", Site, "--enabled", "true"]);
        await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get(LanguagesUrl, site)));
    }

    [Fact]
    public async Task A_disabled_staff_account_is_refused_even_with_the_flag()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);
        var site = await LoginAsync(client, Site);

        await CliAsync(host, ["--staff-disable", "--email", Site]);
        var response = await client.SendAsync(Get(LanguagesUrl, site));
        Assert.True(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden, $"got {(int)response.StatusCode}");
        Assert.True(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'SITE@EXAMPLE.COM' """));

        // The flag is also unusable through the evaluator for a disabled account (cookie or not).
        await using var scope = host.Services.CreateAsyncScope();
        var evaluator = (IStaffAccessEvaluator)scope.ServiceProvider.GetService(typeof(IStaffAccessEvaluator))!;
        Assert.False(await evaluator.HasGlobalPermissionAsync(await StaffIdAsync(Site), StaffGlobalPermission.WebsiteSettingsManage, CancellationToken.None));
        Assert.False(await evaluator.HasGlobalPermissionAsync(Guid.NewGuid(), StaffGlobalPermission.WebsiteSettingsManage, CancellationToken.None));
        Assert.False(await evaluator.HasGlobalPermissionAsync(await StaffIdAsync(Desk), (StaffGlobalPermission)42, CancellationToken.None));
    }

    [Fact]
    public async Task The_cli_grants_and_revokes_exactly_one_account_and_refuses_bad_targets()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);

        Assert.True(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'SITE@EXAMPLE.COM' """));
        Assert.False(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'DESK@EXAMPLE.COM' """));
        Assert.False(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'MANAGER@EXAMPLE.COM' """));

        var (exit, output) = await RunCliAsync(host, ["--staff-website-access", "--email", Desk, "--enabled", "TRUE"]);
        Assert.Equal(0, exit);
        Assert.Contains("granted", output);
        Assert.DoesNotContain(Desk, output);
        Assert.True(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'DESK@EXAMPLE.COM' """));
        Assert.False(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'MANAGER@EXAMPLE.COM' """));
        // Granting again changes nothing; no membership or role was touched.
        Assert.Contains("unchanged", (await RunCliAsync(host, ["--staff-website-access", "--email", Desk, "--enabled", "true"])).Output);
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "StaffPropertyMemberships" """));
        Assert.Equal("FrontDesk", await ScalarAsync<string>("""SELECT "Role" FROM "StaffPropertyMemberships" m JOIN "StaffAccounts" a ON a."Id" = m."StaffAccountId" WHERE a."NormalizedEmail" = 'DESK@EXAMPLE.COM' """));

        Assert.Contains("revoked", (await RunCliAsync(host, ["--staff-website-access", "--email", Desk, "--enabled", "false"])).Output);
        Assert.False(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'DESK@EXAMPLE.COM' """));

        // Refusals change nothing and say why.
        Assert.Equal(1, (await RunCliAsync(host, ["--staff-website-access", "--email", "nobody@example.com", "--enabled", "true"])).Exit);
        await CliAsync(host, ["--staff-disable", "--email", Manager]);
        var disabled = await RunCliAsync(host, ["--staff-website-access", "--email", Manager, "--enabled", "true"]);
        Assert.Equal(1, disabled.Exit);
        Assert.Contains("disabled", disabled.Output);
        Assert.False(await ScalarAsync<bool>("""SELECT "CanManageWebsite" FROM "StaffAccounts" WHERE "NormalizedEmail" = 'MANAGER@EXAMPLE.COM' """));
        Assert.Equal(2, (await RunCliAsync(host, ["--staff-website-access", "--email", Desk, "--enabled", "maybe"])).Exit);
        Assert.Equal(2, (await RunCliAsync(host, ["--staff-website-access", "--email", Desk])).Exit);
        Assert.Equal(2, (await RunCliAsync(host, ["--staff-website-access", "--enabled", "true"])).Exit);
        Assert.Equal(2, (await RunCliAsync(host, ["--staff-website-access", "--email", Desk, "--enabled", "true", "--role", "Manager"])).Exit);
        // It never asks for or accepts a password: no account is created.
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "StaffAccounts" """));
    }

    [Fact]
    public async Task Login_and_me_report_the_permissions_the_database_grants_now()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);

        var siteLogin = await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Post("/api/admin/v1/auth/login", new { email = Site, password = Password })));
        var siteCookie = CookieHeader(siteLogin, ".TheBha.Staff");
        Assert.Equal(["WebsiteSettingsManage"], (await JsonAsync(siteLogin)).GetProperty("permissions").EnumerateArray().Select(item => item.GetString()).ToArray());
        var me = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get("/api/admin/v1/me", siteCookie))));
        Assert.Equal(["WebsiteSettingsManage"], me.GetProperty("permissions").EnumerateArray().Select(item => item.GetString()).ToArray());
        Assert.Equal(1, me.GetProperty("memberships").GetArrayLength());

        var deskLogin = await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Post("/api/admin/v1/auth/login", new { email = Desk, password = Password })));
        Assert.Empty((await JsonAsync(deskLogin)).GetProperty("permissions").EnumerateArray());

        // A revoke shows in `me` on the next call; the response never carries the flag's storage name or any secret.
        await CliAsync(host, ["--staff-website-access", "--email", Site, "--enabled", "false"]);
        var after = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get("/api/admin/v1/me", siteCookie))));
        Assert.Empty(after.GetProperty("permissions").EnumerateArray());
        Assert.DoesNotContain("CanManageWebsite", after.GetRawText());
        Assert.DoesNotContain("passwordHash", after.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Origin_content_type_and_cleartext_are_refused_by_the_staff_boundary_before_any_change()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);
        var site = await LoginAsync(client, Site);
        var body = new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false };

        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Post(LanguagesUrl, body, site, origins: ["https://evil.example"])));
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Post(LanguagesUrl, body, site, origins: [])));
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Post(LanguagesUrl, body, site, origins: [AdminOrigin, "https://evil.example"])));
        await AssertStatusAsync(HttpStatusCode.Forbidden, client.SendAsync(Post(LanguagesUrl, body, site, origins: ["https://localhost:3000"])));      // the Customer origin
        await AssertStatusAsync(HttpStatusCode.UnsupportedMediaType, client.SendAsync(Post(LanguagesUrl, body, site, contentType: "text/plain")));
        await AssertStatusAsync(HttpStatusCode.UnsupportedMediaType, client.SendAsync(Post(LanguagesUrl, body, site, contentType: "application/x-www-form-urlencoded")));
        await AssertStatusAsync(HttpStatusCode.UnsupportedMediaType, client.SendAsync(Post(LanguagesUrl, body, site, contentType: "application/json; charset=utf-16")));
        await AssertStatusAsync(HttpStatusCode.UnsupportedMediaType, client.SendAsync(Post(LanguagesUrl, body, site, contentType: null)));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));

        // A read needs no Origin, and the refusals are never cached.
        var read = await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get(LanguagesUrl, site)));
        Assert.Contains("no-store", read.Headers.CacheControl?.ToString());
        var refused = await client.SendAsync(Post(LanguagesUrl, body, site, origins: ["https://evil.example"]));
        Assert.Contains("no-store", refused.Headers.CacheControl?.ToString());

        // Cleartext: a write is answered 404 before anything else, with no redirect that could replay it.
        using var cleartext = host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false, HandleCookies = false });
        await AssertStatusAsync(HttpStatusCode.NotFound, cleartext.SendAsync(Post(LanguagesUrl, body, site)));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
    }

    [Fact]
    public async Task Cors_allows_only_the_admin_origin_with_credentials_and_only_the_methods_in_use()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);

        var write = await Preflight(client, LanguagesUrl, AdminOrigin, "POST");
        Assert.Equal(AdminOrigin, write.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("true", write.Headers.GetValues("Access-Control-Allow-Credentials").Single());
        var allowedMethods = string.Join(",", write.Headers.GetValues("Access-Control-Allow-Methods"));
        Assert.Contains("POST", allowedMethods);
        Assert.DoesNotContain("DELETE", allowedMethods);
        Assert.DoesNotContain("PUT", allowedMethods);
        Assert.NotEqual("*", write.Headers.GetValues("Access-Control-Allow-Origin").Single());

        var read = await Preflight(client, LanguagesUrl, AdminOrigin, "GET");
        Assert.Equal(AdminOrigin, read.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("true", read.Headers.GetValues("Access-Control-Allow-Credentials").Single());

        foreach (var origin in new[] { "https://evil.example", "https://localhost:3000", "http://localhost:3001" })
        {
            Assert.False((await Preflight(client, LanguagesUrl, origin, "POST")).Headers.Contains("Access-Control-Allow-Origin"), origin);
        }

        // The actual response carries the same, with the Staff cookie.
        var site = await LoginAsync(client, Site);
        var response = await client.SendAsync(Get(LanguagesUrl, site, AdminOrigin));
        Assert.Equal(AdminOrigin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("true", response.Headers.GetValues("Access-Control-Allow-Credentials").Single());
    }

    [Fact]
    public async Task LocalGate_has_no_path_to_the_website_settings()
    {
        using var host = Factory.WithLocalGate(builder =>
        {
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedRead", "true");
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true");
        });
        await Factory.ResetDatabaseAsync();
        using var client = CreateHttpsClient(host);
        var body = new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false };

        foreach (var url in AllReads)
        {
            await AssertStatusAsync(HttpStatusCode.NotFound, client.SendAsync(Get(url, origin: AdminOrigin)));
        }

        await AssertStatusAsync(HttpStatusCode.NotFound, client.SendAsync(Post(LanguagesUrl, body)));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
        // The public read does not depend on the Admin mode.
        await AssertStatusAsync(HttpStatusCode.OK, client.SendAsync(Get("/api/v1/website/config")));
    }

    [Fact]
    public async Task Admin_routes_that_do_not_carry_the_website_permission_stay_closed_in_staff_mode()
    {
        using var host = CreateHost();
        await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);
        var site = await LoginAsync(client, Site);

        // Opening is per action by metadata: a path next to the website routes, or a sibling, is closed.
        await AssertStatusAsync(HttpStatusCode.NotFound, client.SendAsync(Get("/api/admin/v1/website", site)));
        await AssertStatusAsync(HttpStatusCode.NotFound, client.SendAsync(Get("/api/admin/v1/website/anything", site)));
        await AssertStatusAsync(HttpStatusCode.NotFound, client.SendAsync(Get("/api/admin/v1/website/languages/vi", site)));
        await AssertStatusAsync(HttpStatusCode.NotFound, client.SendAsync(Post("/api/admin/v1/website/languages/vi/promote", new { }, site)));
        await AssertStatusAsync(HttpStatusCode.NotFound, client.SendAsync(Post("/api/admin/v1/staff/grant", new { }, site)));
    }

    [Fact]
    public void Every_website_admin_action_carries_the_permission_per_action_and_nothing_is_applied_per_controller()
    {
        var controllers = new[]
        {
            typeof(AdminWebsiteLanguagesController), typeof(AdminWebsiteTranslationsController), typeof(AdminWebsiteCurrenciesController)
        };
        var actions = 0;
        foreach (var controller in controllers)
        {
            Assert.Null(controller.GetCustomAttribute<StaffWebsitePermissionAttribute>());
            Assert.Null(controller.GetCustomAttribute<StaffCalendarPermissionAttribute>());
            foreach (var action in controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                var permission = action.GetCustomAttribute<StaffWebsitePermissionAttribute>();
                Assert.True(permission is not null, $"{controller.Name}.{action.Name} has no website permission");
                Assert.Equal(StaffGlobalPermission.WebsiteSettingsManage, permission!.Permission);
                Assert.Null(action.GetCustomAttribute<StaffCalendarPermissionAttribute>());
                // Every mutation is a POST (one credentialed write CORS policy); reads are GET.
                Assert.True(action.GetCustomAttributes().Any(attribute => attribute is HttpGetAttribute or HttpPostAttribute), $"{controller.Name}.{action.Name} has no verb");
                Assert.DoesNotContain(action.GetCustomAttributes(), attribute => attribute is HttpPutAttribute or HttpDeleteAttribute or HttpPatchAttribute);
                actions++;
            }
        }

        // 5 language, 3 translation and 7 currency actions: adding an action means deciding its permission here.
        Assert.Equal(15, actions);
    }

    private static async Task<HttpResponseMessage> Preflight(HttpClient client, string url, string origin, string method)
    {
        using var request = new HttpRequestMessage(HttpMethod.Options, url);
        request.Headers.TryAddWithoutValidation("Origin", origin);
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Method", method);
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type");
        return await client.SendAsync(request);
    }
}
