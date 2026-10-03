using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TheBha.Api.Authentication;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP03: the Staff cookie session against real PostgreSQL — login, logout
/// and <c>me</c>; isolation from the Customer session in both directions; the Origin/JSON
/// CSRF boundary; invalidation through the CP02 CLI; and the 8-hour absolute lifetime on the
/// handler's own clock. Cookies are handled by hand so every request states exactly which
/// cookies it carries.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StaffAuthenticationTests(PostgreSqlWebApplicationFactory factory)
{
    private const string AdminOrigin = "https://localhost:3001";
    private const string CustomerOrigin = "https://localhost:3000";
    private const string Email = "desk@example.com";
    private const string LoginPath = "/api/admin/v1/auth/login";
    private const string LogoutPath = "/api/admin/v1/auth/logout";
    private const string MePath = "/api/admin/v1/me";
    private static readonly string Password = $"A!a1{Guid.NewGuid():N}";
    private static readonly string NewPassword = $"B!b2{Guid.NewGuid():N}";
    private static readonly Guid PropertyA = Guid.Parse("93000000-0000-0000-0000-00000000000a");
    private static readonly Guid PropertyB = Guid.Parse("93000000-0000-0000-0000-00000000000b");

    [Fact]
    public async Task Login_me_and_logout_follow_the_contract_and_never_return_secrets()
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        await CliAsync(host, Grant(PropertyB, StaffRole.FrontDesk));
        var staff = await FindStaffAsync();
        using var client = CreateHttpsClient(host);

        var login = await client.SendAsync(Post(LoginPath, LoginBody(Email, Password)));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        AssertNoStore(login);
        var cookie = StaffCookieHeader(login);
        var setCookie = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        Assert.StartsWith(".TheBha.Staff=", setCookie, StringComparison.Ordinal);
        Assert.Contains("path=/api/admin", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("expires=", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("max-age", setCookie, StringComparison.OrdinalIgnoreCase);
        var loginBody = await login.Content.ReadAsStringAsync();
        AssertSessionBody(loginBody, staff);

        var me = await client.SendAsync(Get(MePath, cookie));
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        AssertNoStore(me);
        Assert.False(me.Headers.Contains("Set-Cookie"));
        Assert.Equal(loginBody, await me.Content.ReadAsStringAsync());

        var logout = await client.SendAsync(Post(LogoutPath, "{}", cookie));
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        AssertNoStore(logout);
        var cleared = Assert.Single(logout.Headers.GetValues("Set-Cookie"));
        Assert.StartsWith(".TheBha.Staff=;", cleared, StringComparison.Ordinal);
        Assert.Contains("expires=Thu, 01 Jan 1970", cleared, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/admin", cleared, StringComparison.OrdinalIgnoreCase);

        await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath)));
        await AssertUnauthorizedAsync(await client.SendAsync(Post(LogoutPath, "{}")));
    }

    [Fact]
    public async Task Every_login_failure_is_one_generic_401_and_lockout_is_enforced()
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.FrontDesk), Password);
        await CliAsync(host, Create(PropertyA, StaffRole.FrontDesk, "disabled@example.com"), Password);
        await CliAsync(host, ["--staff-disable", "--email", "disabled@example.com"]);
        using var client = CreateHttpsClient(host);

        var unknown = await AssertLoginRefusedAsync(client, "nobody@example.com", Password);
        var disabled = await AssertLoginRefusedAsync(client, "disabled@example.com", Password);
        var wrong = await AssertLoginRefusedAsync(client, Email, NewPassword);
        Assert.Equal(1, (await FindStaffAsync()).AccessFailedCount);
        Assert.Equal(unknown, disabled);
        Assert.Equal(unknown, wrong);

        // A success resets the failure count.
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post(LoginPath, LoginBody(Email, Password)))).StatusCode);
        Assert.Equal(0, (await FindStaffAsync()).AccessFailedCount);

        for (var attempt = 0; attempt < 5; attempt++)
        {
            Assert.Equal(wrong, await AssertLoginRefusedAsync(client, Email, NewPassword));
        }

        var locked = await FindStaffAsync();
        var earliest = factory.Clock.UtcNow < DateTimeOffset.UtcNow ? factory.Clock.UtcNow : DateTimeOffset.UtcNow;
        Assert.True(locked.LockoutEnd > earliest.AddMinutes(14));
        // The right password does not bypass lockout, and the answer is the same generic 401.
        Assert.Equal(unknown, await AssertLoginRefusedAsync(client, Email, Password));

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlRawAsync(
                "UPDATE \"StaffAccounts\" SET \"LockoutEnd\" = NULL");
        }

        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post(LoginPath, LoginBody(Email, Password)))).StatusCode);
    }

    [Fact]
    public async Task A_login_whose_failure_count_reset_loses_to_a_concurrent_lockout_issues_no_session()
    {
        await SeedAsync();
        var race = new ResetRace();
        using var host = CreateHost(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton(race);
            services.AddScoped<UserManager<StaffAccount>, ResetRaceUserManager>();
        }));
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        using var client = CreateHttpsClient(host);

        string wrong = "";
        for (var attempt = 0; attempt < 4; attempt++)
        {
            wrong = await AssertLoginRefusedAsync(client, Email, NewPassword);
        }

        var before = await FindStaffAsync();
        Assert.Equal(4, before.AccessFailedCount);
        Assert.Null(before.LockoutEnd);

        // The right password, while a separate scope records the fifth failure at the reset.
        race.Arm();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var response = await client.SendAsync(Post(LoginPath, LoginBody(Email, Password)), deadline.Token);

        // The race happened where it matters: the request had already loaded the account (4
        // failures, the old concurrency stamp), the other scope locked it through Identity, and
        // Identity then refused the request's stale reset.
        Assert.False(race.IsArmed);
        Assert.Equal(4, race.StaleAccessFailedCount);
        Assert.Equal(before.ConcurrencyStamp, race.StaleConcurrencyStamp);
        Assert.True(race.CompetingFailure?.Succeeded, "the competing AccessFailedAsync must succeed");
        Assert.True(race.CompetingLockedOut);
        Assert.False(race.ResetResult?.Succeeded ?? true, "the stale ResetAccessFailedCountAsync must fail");
        Assert.Equal(["ConcurrencyFailure"], race.ResetResult!.Errors.Select(error => error.Code).ToArray());

        // ...and no session came out of it: the same generic 401 as a wrong password.
        Assert.Equal(wrong, await AssertGenericLoginRefusalAsync(response, Email));
        Assert.DoesNotContain("concurren", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        var locked = await FindStaffAsync();
        Assert.NotEqual(race.StaleConcurrencyStamp, locked.ConcurrencyStamp);
        var earliest = factory.Clock.UtcNow < DateTimeOffset.UtcNow ? factory.Clock.UtcNow : DateTimeOffset.UtcNow;
        Assert.True(locked.LockoutEnd > earliest.AddMinutes(14));
        Assert.Equal(wrong, await AssertLoginRefusedAsync(client, Email, Password));
    }

    [Fact]
    public async Task Staff_and_customer_sessions_are_isolated_in_both_directions()
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        var staff = await FindStaffAsync();
        Guid customerId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            // The same email as the Staff member: a separate identity, never the same principal.
            var customers = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
            var customer = new CustomerAccount { Id = Guid.NewGuid(), Email = Email, UserName = Email };
            Assert.True((await customers.CreateAsync(customer, Password)).Succeeded);
            customerId = customer.Id;
        }

        using var client = CreateHttpsClient(host);
        var staffCookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));
        var customerLogin = await client.PostAsJsonAsync("/api/v1/auth/login", new { Email, Password });
        Assert.Equal(HttpStatusCode.OK, customerLogin.StatusCode);
        var customerCookie = CookieHeader(customerLogin, ".TheBha.Customer");
        var staffValue = staffCookie[(staffCookie.IndexOf('=') + 1)..];
        var customerValue = customerCookie[(customerCookie.IndexOf('=') + 1)..];

        // A Staff cookie is no Customer session, under either name, and the reverse.
        await AssertCustomerUnauthorizedAsync(await client.SendAsync(Get("/api/v1/auth/me", staffCookie)));
        await AssertCustomerUnauthorizedAsync(await client.SendAsync(Get("/api/v1/auth/me", $".TheBha.Customer={staffValue}")));
        await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath, customerCookie)));
        await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath, $".TheBha.Staff={customerValue}")));
        await AssertUnauthorizedAsync(await client.SendAsync(Post(LogoutPath, "{}", customerCookie)));

        var both = $"{staffCookie}; {customerCookie}";
        Assert.Equal(staff.Id, (await ReadSessionAsync(await client.SendAsync(Get(MePath, both)))).StaffAccountId);
        Assert.Equal(customerId, await CustomerIdAsync(client, both));

        // Staff logout clears the Staff cookie only; the Customer session continues.
        var staffLogout = await client.SendAsync(Post(LogoutPath, "{}", both));
        Assert.Equal(HttpStatusCode.NoContent, staffLogout.StatusCode);
        Assert.StartsWith(".TheBha.Staff=;", Assert.Single(staffLogout.Headers.GetValues("Set-Cookie")), StringComparison.Ordinal);
        Assert.Equal(customerId, await CustomerIdAsync(client, customerCookie));

        // Customer logout clears the Customer cookie only; the Staff session continues.
        staffCookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));
        var csrfResponse = await client.SendAsync(Get("/api/v1/auth/csrf", customerCookie));
        var antiforgeryCookie = CookieHeader(csrfResponse, ".TheBha.Antiforgery");
        var csrf = await csrfResponse.Content.ReadFromJsonAsync<JsonElement>();
        using var customerLogout = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/logout");
        customerLogout.Headers.Add("Cookie", $"{customerCookie}; {antiforgeryCookie}; {staffCookie}");
        customerLogout.Headers.Add("X-CSRF-TOKEN", csrf.GetProperty("token").GetString());
        var customerLogoutResponse = await client.SendAsync(customerLogout);
        Assert.Equal(HttpStatusCode.NoContent, customerLogoutResponse.StatusCode);
        Assert.DoesNotContain(
            customerLogoutResponse.Headers.GetValues("Set-Cookie"),
            value => value.StartsWith(".TheBha.Staff", StringComparison.Ordinal));
        Assert.Equal(staff.Id, (await ReadSessionAsync(await client.SendAsync(Get(MePath, staffCookie)))).StaffAccountId);
    }

    [Fact]
    public async Task Production_cookie_flags_are_strict_and_the_customer_surface_is_unchanged()
    {
        await SeedAsync();
        var keyPath = Path.Combine(Path.GetTempPath(), "thebha-data-protection-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(keyPath);
        try
        {
            using var host = CreateHost(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("DataProtection:KeysPath", keyPath);
                builder.UseSetting("Cors:AllowedOrigins:0", CustomerOrigin);
                builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            });
            await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
            await using (var scope = host.Services.CreateAsyncScope())
            {
                var customers = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
                Assert.True((await customers.CreateAsync(
                    new CustomerAccount { Id = Guid.NewGuid(), Email = "guest@example.com", UserName = "guest@example.com" },
                    Password)).Succeeded);
            }

            using var client = CreateHttpsClient(host);
            var staffLogin = await client.SendAsync(Post(LoginPath, LoginBody(Email, Password)));
            Assert.Equal(HttpStatusCode.OK, staffLogin.StatusCode);
            var staffCookie = Assert.Single(staffLogin.Headers.GetValues("Set-Cookie"));
            Assert.Equal(
                ["httponly", "path=/api/admin", "samesite=strict", "secure"],
                CookieAttributes(staffCookie));

            var customerLogin = await client.PostAsJsonAsync(
                "/api/v1/auth/login", new { Email = "guest@example.com", Password });
            Assert.Equal(HttpStatusCode.OK, customerLogin.StatusCode);
            Assert.Equal(
                ["httponly", "path=/", "samesite=lax", "secure"],
                CookieAttributes(Assert.Single(customerLogin.Headers.GetValues("Set-Cookie"))));

            // The Customer antiforgery requirement still applies to every Customer write.
            var customerCookie = CookieHeader(customerLogin, ".TheBha.Customer");
            var unprotectedLogout = await client.SendAsync(Post("/api/v1/auth/logout", "{}", customerCookie, origins: []));
            Assert.Equal(HttpStatusCode.BadRequest, unprotectedLogout.StatusCode);
            Assert.Equal("Invalid antiforgery token", (await unprotectedLogout.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());

            // The Customer CORS policy is still credentialed for the Customer origin only.
            var customerPreflight = await client.SendAsync(Preflight("/api/v1/auth/login", CustomerOrigin, "POST"));
            Assert.Equal(CustomerOrigin, Assert.Single(customerPreflight.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(customerPreflight.Headers.GetValues("Access-Control-Allow-Credentials")));
            Assert.False((await client.SendAsync(Preflight("/api/v1/auth/login", AdminOrigin, "POST")))
                .Headers.Contains("Access-Control-Allow-Origin"));
        }
        finally
        {
            Directory.Delete(keyPath, recursive: true);
        }
    }

    [Fact]
    public async Task The_ticket_holds_only_id_and_stamp_and_the_staff_path_never_reads_identity_claim_tables()
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        await CliAsync(host, Grant(PropertyB, StaffRole.FrontDesk));
        var staff = await FindStaffAsync();
        using var client = CreateHttpsClient(host);

        string cookie;
        using (var recorder = new SqlCommandRecorder(factory.DatabaseName))
        {
            cookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, cookie))).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(Post(LogoutPath, "{}", cookie))).StatusCode);

            var commands = recorder.Commands;
            // Positive control: the recorder sees this database's Staff queries.
            Assert.Contains(commands, command => command.Contains("\"StaffAccounts\"", StringComparison.Ordinal));
            Assert.Contains(commands, command => command.Contains("\"StaffPropertyMemberships\"", StringComparison.Ordinal));
            foreach (var table in new[] { "AspNetUserClaims", "AspNetUserLogins", "AspNetUserTokens", "AspNetUsers" })
            {
                Assert.DoesNotContain(commands, command => command.Contains($"\"{table}\"", StringComparison.Ordinal));
            }
        }

        var ticket = Unprotect(host, cookie);
        Assert.Equal(StaffAuthentication.Scheme, ticket.AuthenticationScheme);
        var identity = Assert.Single(ticket.Principal.Identities);
        Assert.Equal(StaffAuthentication.Scheme, identity.AuthenticationType);
        Assert.Equal(
            new[] { (StaffAuthentication.StaffIdClaimType, staff.Id.ToString()), (StaffAuthentication.SecurityStampClaimType, staff.SecurityStamp!) },
            identity.Claims.Select(claim => (claim.Type, claim.Value)).ToArray());
        Assert.False(ticket.Properties.IsPersistent);
        Assert.False(ticket.Properties.AllowRefresh);
        Assert.Equal(TimeSpan.FromHours(8), ticket.Properties.ExpiresUtc - ticket.Properties.IssuedUtc);
    }

    [Fact]
    public async Task Disable_and_password_reset_through_the_cli_reject_the_old_cookie_on_the_next_request()
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        await CliAsync(host, Create(PropertyA, StaffRole.FrontDesk, "night@example.com"), Password);
        using var client = CreateHttpsClient(host);

        var resetCookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, resetCookie))).StatusCode);
        await CliAsync(host, ["--staff-reset-password", "--email", Email], NewPassword);
        var afterReset = await client.SendAsync(Get(MePath, resetCookie));
        await AssertUnauthorizedAsync(afterReset);
        Assert.StartsWith(".TheBha.Staff=;", Assert.Single(afterReset.Headers.GetValues("Set-Cookie")), StringComparison.Ordinal);
        await AssertUnauthorizedAsync(await client.SendAsync(Post(LogoutPath, "{}", resetCookie)));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post(LoginPath, LoginBody(Email, NewPassword)))).StatusCode);

        var disableCookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody("night@example.com", Password))));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, disableCookie))).StatusCode);
        await CliAsync(host, ["--staff-disable", "--email", "night@example.com"]);
        await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath, disableCookie)));

        // Disabled is the only change: an unchanged stamp is still refused for an inactive account.
        await using (var context = factory.CreateDbContext())
        {
            var night = await context.StaffAccounts.SingleAsync(account => account.Email == "night@example.com");
            Assert.False(night.IsActive);
        }

        var stillActiveCookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, NewPassword))));
        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlRawAsync(
                "UPDATE \"StaffAccounts\" SET \"IsActive\" = false, \"DisabledAtUtc\" = now() WHERE \"NormalizedEmail\" = 'DESK@EXAMPLE.COM'");
        }

        await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath, stillActiveCookie)));
    }

    [Fact]
    public async Task A_password_longer_than_128_characters_provisioned_by_the_cli_signs_in()
    {
        await SeedAsync();
        using var host = CreateHost();
        var created = StrongPassword('C', 256);
        var reset = StrongPassword('R', 256);
        var output = await CliAsync(host, Create(PropertyA, StaffRole.Manager), created);
        using var client = CreateHttpsClient(host);

        var login = await client.SendAsync(Post(LoginPath, LoginBody(Email, created)));
        var cookie = StaffCookieHeader(login);
        var me = await client.SendAsync(Get(MePath, cookie));
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var bodies = new List<string> { await login.Content.ReadAsStringAsync(), await me.Content.ReadAsStringAsync() };

        output += await CliAsync(host, ["--staff-reset-password", "--email", Email], reset);
        await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath, cookie)));
        // A long credential that is wrong is the ordinary generic 401, never a 400 from the contract.
        var wrong = await AssertLoginRefusedAsync(client, Email, created);
        Assert.Equal(wrong, await AssertLoginRefusedAsync(client, Email, StrongPassword('W', 1024)));
        Assert.Equal(wrong, await AssertLoginRefusedAsync(client, Email, NewPassword));

        var relogin = await client.SendAsync(Post(LoginPath, LoginBody(Email, reset)));
        var newCookie = StaffCookieHeader(relogin);
        var newMe = await client.SendAsync(Get(MePath, newCookie));
        Assert.Equal(HttpStatusCode.OK, newMe.StatusCode);
        bodies.Add(await relogin.Content.ReadAsStringAsync());
        bodies.Add(await newMe.Content.ReadAsStringAsync());

        var staff = await FindStaffAsync();
        Assert.Equal(0, staff.AccessFailedCount);
        foreach (var secret in new[] { created, reset, staff.PasswordHash!, staff.SecurityStamp!, cookie, newCookie })
        {
            Assert.DoesNotContain(secret, output, StringComparison.Ordinal);
            Assert.All(bodies, body => Assert.DoesNotContain(secret, body, StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task Me_reads_memberships_from_the_database_on_every_request()
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.FrontDesk), Password);
        using var client = CreateHttpsClient(host);
        var cookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));

        Assert.Equal([(PropertyA, StaffRole.FrontDesk)], await MembershipsAsync(client, cookie));

        await CliAsync(host, Grant(PropertyA, StaffRole.Manager));
        Assert.Equal([(PropertyA, StaffRole.Manager)], await MembershipsAsync(client, cookie));

        await CliAsync(host, Grant(PropertyB, StaffRole.FrontDesk));
        // Ordered by Property name: "Alpha Inn" (B) before "Beta Resort" (A).
        Assert.Equal([(PropertyB, StaffRole.FrontDesk), (PropertyA, StaffRole.Manager)], await MembershipsAsync(client, cookie));

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlRawAsync("DELETE FROM \"StaffPropertyMemberships\"");
        }

        Assert.Empty(await MembershipsAsync(client, cookie));
    }

    [Fact]
    public async Task The_session_ends_eight_hours_after_login_on_the_handler_clock_and_is_never_renewed()
    {
        await SeedAsync();
        var original = factory.Clock.UtcNow;
        var issued = new DateTimeOffset(2026, 10, 3, 1, 0, 0, TimeSpan.Zero);
        try
        {
            using var host = CreateHost();
            await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
            using var client = CreateHttpsClient(host);

            factory.Clock.UtcNow = issued;
            var cookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));
            var ticket = Unprotect(host, cookie);
            Assert.Equal(issued, ticket.Properties.IssuedUtc);
            Assert.Equal(issued.AddHours(8), ticket.Properties.ExpiresUtc);
            Assert.Same(factory.Clock, host.Services
                .GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
                .Get(StaffAuthentication.Scheme).TimeProvider);

            foreach (var elapsed in new[] { TimeSpan.FromHours(4), TimeSpan.FromHours(8) - TimeSpan.FromSeconds(1) })
            {
                factory.Clock.UtcNow = issued + elapsed;
                var me = await client.SendAsync(Get(MePath, cookie));
                Assert.Equal(HttpStatusCode.OK, me.StatusCode);
                Assert.False(me.Headers.Contains("Set-Cookie"), $"{elapsed}: the ticket is never renewed");
            }

            foreach (var elapsed in new[] { TimeSpan.FromHours(8), TimeSpan.FromHours(8) + TimeSpan.FromSeconds(1), TimeSpan.FromDays(2) })
            {
                factory.Clock.UtcNow = issued + elapsed;
                await AssertUnauthorizedAsync(await client.SendAsync(Get(MePath, cookie)));
                await AssertUnauthorizedAsync(await client.SendAsync(Post(LogoutPath, "{}", cookie)));
            }
        }
        finally
        {
            factory.Clock.UtcNow = original;
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("null")]
    [InlineData(CustomerOrigin)]
    [InlineData("https://localhost:3001.evil.example")]
    [InlineData("https://evil.example?x=https://localhost:3001")]
    [InlineData("https://localhost:3001/")]
    [InlineData("http://localhost:3001")]
    [InlineData("HTTPS://LOCALHOST:3001")]
    [InlineData("https://localhost:3001,https://localhost:3001")]
    public async Task A_staff_post_without_exactly_one_approved_origin_is_refused_before_anything_else(string? origin)
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        using var client = CreateHttpsClient(host);
        var origins = origin is null ? [] : origin.Split(',');

        var login = await client.SendAsync(Post(LoginPath, LoginBody(Email, Password), origins: origins));
        await AssertRefusedAsync(login, HttpStatusCode.Forbidden, "Origin not allowed");
        // A malformed body is not reached: the Origin answer comes first.
        await AssertRefusedAsync(
            await client.SendAsync(Post(LoginPath, "{not json", origins: origins)), HttpStatusCode.Forbidden, "Origin not allowed");

        var cookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));
        await AssertRefusedAsync(
            await client.SendAsync(Post(LogoutPath, "{}", cookie, origins: origins)), HttpStatusCode.Forbidden, "Origin not allowed");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, cookie))).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("text/plain")]
    [InlineData("text/json")]
    [InlineData("application/x-www-form-urlencoded")]
    [InlineData("multipart/form-data; boundary=x")]
    [InlineData("application/merge-patch+json")]
    [InlineData("application/json; charset=us-ascii")]
    [InlineData("application/json; charset=utf-16")]
    [InlineData("application/json; charset=utf-8; charset=utf-8")]
    [InlineData("application/json; foo=bar")]
    public async Task A_staff_post_that_is_not_utf8_json_is_refused_with_415(string? contentType)
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        using var client = CreateHttpsClient(host);

        await AssertRefusedAsync(
            await client.SendAsync(Post(LoginPath, LoginBody(Email, Password), contentType: contentType)),
            HttpStatusCode.UnsupportedMediaType,
            "Unsupported media type");

        var cookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password), contentType: "application/json; charset=utf-8")));
        await AssertRefusedAsync(
            await client.SendAsync(Post(LogoutPath, "{}", cookie, contentType: contentType)),
            HttpStatusCode.UnsupportedMediaType,
            "Unsupported media type");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(MePath, cookie))).StatusCode);
    }

    [Fact]
    public async Task A_malformed_login_body_with_an_approved_origin_is_a_validation_problem_without_a_session()
    {
        await SeedAsync();
        using var host = CreateHost();
        using var client = CreateHttpsClient(host);

        foreach (var body in new[] { "{not json", "{}", "{\"email\":\"not-an-email\",\"password\":\"x\"}" })
        {
            var response = await client.SendAsync(Post(LoginPath, body));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            AssertNoStore(response);
            Assert.False(response.Headers.Contains("Set-Cookie"));
        }
    }

    [Fact]
    public async Task Only_the_admin_staff_policy_is_credentialed_and_only_for_admin_origins()
    {
        await SeedAsync();
        using var host = CreateHost();
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        using var client = CreateHttpsClient(host);

        foreach (var (path, method) in new[] { (LoginPath, "POST"), (LogoutPath, "POST"), (MePath, "GET") })
        {
            var allowed = await client.SendAsync(Preflight(path, AdminOrigin, method, "content-type"));
            Assert.Equal(HttpStatusCode.NoContent, allowed.StatusCode);
            Assert.Equal(AdminOrigin, Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Credentials")));
            Assert.Contains(method, Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Methods")), StringComparison.Ordinal);
            Assert.Equal("Content-Type", Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Headers")), ignoreCase: true);

            foreach (var origin in new[] { CustomerOrigin, "https://evil.example", "null" })
            {
                var refused = await client.SendAsync(Preflight(path, origin, method));
                Assert.False(refused.Headers.Contains("Access-Control-Allow-Origin"), $"{path} from {origin}");
                Assert.False(refused.Headers.Contains("Access-Control-Allow-Credentials"), $"{path} from {origin}");
            }
        }

        var csrfHeader = await client.SendAsync(Preflight(LoginPath, AdminOrigin, "POST", "x-csrf-token"));
        Assert.DoesNotContain(
            csrfHeader.Headers.TryGetValues("Access-Control-Allow-Headers", out var allowedHeaders) ? allowedHeaders : [],
            value => value.Contains("x-csrf-token", StringComparison.OrdinalIgnoreCase));

        var login = await client.SendAsync(Post(LoginPath, LoginBody(Email, Password)));
        Assert.Equal(AdminOrigin, Assert.Single(login.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal("true", Assert.Single(login.Headers.GetValues("Access-Control-Allow-Credentials")));

        // The two admin-calendar policies stay uncredentialed.
        var board = await client.SendAsync(Preflight($"/api/admin/v1/properties/{PropertyA}/reservation-board", AdminOrigin, "GET"));
        Assert.Equal(AdminOrigin, Assert.Single(board.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(board.Headers.Contains("Access-Control-Allow-Credentials"));
        var write = await client.SendAsync(Preflight($"/api/admin/v1/properties/{PropertyA}/operational-blocks", AdminOrigin, "POST", "content-type"));
        Assert.Equal(AdminOrigin, Assert.Single(write.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(write.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task Cleartext_staff_routes_are_refused_before_https_redirection_and_leak_nothing()
    {
        await SeedAsync();
        using var host = CreateHost(builder => builder.ConfigureServices(services =>
            services.Configure<HttpsRedirectionOptions>(options => options.HttpsPort = 443)));
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        var cookie = StaffCookieHeader(await CreateHttpsClient(host).SendAsync(Post(LoginPath, LoginBody(Email, Password))));

        foreach (var follow in new[] { false, true })
        {
            using var cleartext = host.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = follow,
                HandleCookies = false
            });

            // Control: redirection is active on this host, so the refusals below are not vacuous.
            var control = await host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false })
                .GetAsync("/api/v1/properties");
            Assert.Equal(HttpStatusCode.TemporaryRedirect, control.StatusCode);

            foreach (var request in new[]
                     {
                         Post(LoginPath, LoginBody(Email, Password)),
                         Post(LogoutPath, "{}", cookie),
                         Get(MePath, cookie),
                         Get("/api/admin/v1/ME", cookie)
                     })
            {
                var response = await cleartext.SendAsync(request);
                Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
                Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
                AssertNoStore(response);
                Assert.False(response.Headers.Contains("Location"));
                Assert.False(response.Headers.Contains("Set-Cookie"));
                Assert.DoesNotContain("staffAccountId", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    [Fact]
    public async Task The_staff_login_limiter_is_its_own_and_answers_429_problem_details()
    {
        await SeedAsync();
        using var host = CreateHost(builder =>
        {
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "2");
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:WindowSeconds", "300");
            // A different Customer budget, so the Staff limit provably comes from its own setting.
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "3");
            builder.UseSetting("Authentication:RateLimiting:WindowSeconds", "300");
        });
        using var client = CreateHttpsClient(host);

        for (var attempt = 0; attempt < 2; attempt++)
        {
            await AssertLoginRefusedAsync(client, "nobody@example.com", Password);
        }

        var limited = await client.SendAsync(Post(LoginPath, LoginBody("nobody@example.com", Password)));
        await AssertRefusedAsync(limited, HttpStatusCode.TooManyRequests, "Too many requests");

        // The Customer login limiter still has its own budget, and exhausting it changes nothing for Staff.
        for (var attempt = 0; attempt < 3; attempt++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { Email, Password })).StatusCode);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/auth/login", new { Email, Password })).StatusCode);

        using var customerFirst = CreateHost(builder =>
        {
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "1");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "1");
        });
        using var second = CreateHttpsClient(customerFirst);
        Assert.Equal(HttpStatusCode.Unauthorized, (await second.PostAsJsonAsync("/api/v1/auth/login", new { Email, Password })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await second.PostAsJsonAsync("/api/v1/auth/login", new { Email, Password })).StatusCode);
        await AssertLoginRefusedAsync(second, "nobody@example.com", Password);
    }

    [Theory]
    [InlineData("0", "60")]
    [InlineData("10", "0")]
    [InlineData("-1", "60")]
    public void The_host_refuses_to_start_with_a_non_positive_staff_login_limit(string permitLimit, string windowSeconds)
    {
        using var host = CreateHost(builder =>
        {
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", permitLimit);
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:WindowSeconds", windowSeconds);
        });

        var exception = Assert.Throws<InvalidOperationException>(() => host.CreateClient());
        Assert.Equal("Staff login rate-limit values must be positive.", exception.Message);
    }

    [Fact]
    public async Task Staff_challenge_and_forbid_are_json_problems_without_a_redirect()
    {
        await SeedAsync();
        using var host = CreateHost(builder => builder.ConfigureServices(services =>
            services.AddControllers().AddApplicationPart(typeof(StaffForbidProbeController).Assembly)));
        await CliAsync(host, Create(PropertyA, StaffRole.Manager), Password);
        using var client = CreateHttpsClient(host);

        await AssertUnauthorizedAsync(await client.SendAsync(Get(StaffForbidProbeController.Route)));

        var cookie = StaffCookieHeader(await client.SendAsync(Post(LoginPath, LoginBody(Email, Password))));
        var forbidden = await client.SendAsync(Get(StaffForbidProbeController.Route, cookie));
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.Equal("application/problem+json", forbidden.Content.Headers.ContentType?.MediaType);
        AssertNoStore(forbidden);
        Assert.False(forbidden.Headers.Contains("Location"));
        Assert.Equal("Access denied", (await forbidden.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());
    }

    [Fact]
    public async Task OpenApi_documents_the_staff_cookie_and_the_json_only_contract()
    {
        using var host = CreateHost();
        using var client = CreateHttpsClient(host);
        using var document = JsonDocument.Parse(await client.GetStringAsync("/swagger/v1/swagger.json"));
        var root = document.RootElement;

        var scheme = root.GetProperty("components").GetProperty("securitySchemes").GetProperty("StaffCookie");
        Assert.Equal("cookie", scheme.GetProperty("in").GetString());
        Assert.Equal(".TheBha.Staff", scheme.GetProperty("name").GetString());

        var paths = root.GetProperty("paths");
        var login = paths.GetProperty(LoginPath).GetProperty("post");
        Assert.False(login.TryGetProperty("security", out _));
        Assert.Equal(
            ["application/json"],
            login.GetProperty("requestBody").GetProperty("content").EnumerateObject().Select(property => property.Name).ToArray());
        foreach (var status in new[] { "200", "400", "401", "403", "415", "429" })
        {
            Assert.True(login.GetProperty("responses").TryGetProperty(status, out _), status);
        }

        foreach (var operation in new[] { paths.GetProperty(LogoutPath).GetProperty("post"), paths.GetProperty(MePath).GetProperty("get") })
        {
            var requirement = Assert.Single(operation.GetProperty("security").EnumerateArray());
            Assert.Equal("StaffCookie", Assert.Single(requirement.EnumerateObject()).Name);
            Assert.False(operation.TryGetProperty("parameters", out _));
        }

        var customerMe = paths.GetProperty("/api/v1/auth/me").GetProperty("get");
        Assert.Equal("CustomerCookie", Assert.Single(Assert.Single(customerMe.GetProperty("security").EnumerateArray()).EnumerateObject()).Name);
    }

    private WebApplicationFactory<Program> CreateHost(Action<IWebHostBuilder>? configure = null) =>
        factory.WithWebHostBuilder(builder =>
        {
            // Generous by default so the limiter never masks a lockout or boundary assertion;
            // the limiter test sets its own values.
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            configure?.Invoke(builder);
        });

    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> host) =>
        host.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
            HandleCookies = false
        });

    private async Task SeedAsync()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        foreach (var (id, name, timeZone) in new[]
                 {
                     (PropertyA, "Beta Resort", "Asia/Ho_Chi_Minh"),
                     (PropertyB, "Alpha Inn", "Asia/Bangkok")
                 })
        {
            await context.Database.ExecuteSqlAsync(
                $"""
                INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
                VALUES ({id},{name},{id.ToString()},NULL,'1 Test St','Da Nang','Vietnam',{timeZone},'14:00:00','12:00:00',true,now(),now())
                """);
        }
    }

    /// <summary>Runs the CP02 CLI in-process (the password as the env/prompt would supply it) and returns its output.</summary>
    private static async Task<string> CliAsync(WebApplicationFactory<Program> host, string[] args, string? password = null)
    {
        using var output = new StringWriter();
        var exit = await StaffBootstrapCommand.RunAsync(args, host.Services, output, () => password, CancellationToken.None);
        Assert.True(exit == 0, output.ToString());
        return output.ToString();
    }

    /// <summary>A password the Identity policy accepts, of exactly <paramref name="length"/> characters.</summary>
    private static string StrongPassword(char lead, int length)
    {
        var password = new StringBuilder($"{lead}!a1");
        while (password.Length < length)
        {
            password.Append(Guid.NewGuid().ToString("N"));
        }

        return password.ToString(0, length);
    }

    private static string[] Create(Guid propertyId, string role, string email = Email) =>
        ["--staff-create", "--email", email, "--property-id", propertyId.ToString(), "--role", role];

    private static string[] Grant(Guid propertyId, string role) =>
        ["--staff-grant", "--email", Email, "--property-id", propertyId.ToString(), "--role", role];

    private async Task<StaffAccount> FindStaffAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.StaffAccounts.AsNoTracking().SingleAsync(account => account.NormalizedEmail == "DESK@EXAMPLE.COM");
    }

    private static string LoginBody(string email, string password) =>
        JsonSerializer.Serialize(new { email, password });

    private static HttpRequestMessage Post(
        string path,
        string body,
        string? cookie = null,
        string[]? origins = null,
        string? contentType = "application/json")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body))
        };
        if (contentType is not null)
        {
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

    private static HttpRequestMessage Get(string path, string? cookie = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        return request;
    }

    private static HttpRequestMessage Preflight(string path, string origin, string method, string? requestHeaders = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, path);
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", method);
        if (requestHeaders is not null)
        {
            request.Headers.Add("Access-Control-Request-Headers", requestHeaders);
        }

        return request;
    }

    private static string StaffCookieHeader(HttpResponseMessage login)
    {
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return CookieHeader(login, ".TheBha.Staff");
    }

    private static string CookieHeader(HttpResponseMessage response, string name)
    {
        var setCookie = Assert.Single(
            response.Headers.GetValues("Set-Cookie"),
            value => value.StartsWith($"{name}=", StringComparison.Ordinal));
        return setCookie[..setCookie.IndexOf(';')];
    }

    private static string[] CookieAttributes(string setCookie) =>
        setCookie.Split(';').Skip(1).Select(part => part.Trim().ToLowerInvariant()).Order(StringComparer.Ordinal).ToArray();

    private static Microsoft.AspNetCore.Authentication.AuthenticationTicket Unprotect(WebApplicationFactory<Program> host, string cookie)
    {
        var value = cookie[(cookie.IndexOf('=') + 1)..];
        Assert.False(value.StartsWith("chunks-", StringComparison.Ordinal));
        var options = host.Services
            .GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(StaffAuthentication.Scheme);
        return Assert.IsType<Microsoft.AspNetCore.Authentication.AuthenticationTicket>(options.TicketDataFormat.Unprotect(value));
    }

    // Sign-in and sign-out responses also carry the cookie handler's own "no-cache".
    private static void AssertNoStore(HttpResponseMessage response) =>
        Assert.True(response.Headers.CacheControl?.NoStore, $"Cache-Control: {response.Headers.CacheControl}");

    private static async Task AssertUnauthorizedAsync(HttpResponseMessage response) =>
        await AssertRefusedAsync(response, HttpStatusCode.Unauthorized, "Authentication required");

    private static async Task AssertCustomerUnauthorizedAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("A valid customer session is required.", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString());
    }

    private static async Task<string> AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string title)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        AssertNoStore(response);
        Assert.False(response.Headers.Contains("Location"));
        Assert.DoesNotContain(
            response.Headers.TryGetValues("Set-Cookie", out var cookies) ? cookies : [],
            value => value.StartsWith(".TheBha.Staff=", StringComparison.Ordinal) && !value.StartsWith(".TheBha.Staff=;", StringComparison.Ordinal));
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(title, JsonDocument.Parse(body).RootElement.GetProperty("title").GetString());
        return body;
    }

    /// <summary>Returns the refusal's title and detail, so callers can prove failures are indistinguishable.</summary>
    private static async Task<string> AssertLoginRefusedAsync(HttpClient client, string email, string password) =>
        await AssertGenericLoginRefusalAsync(await client.SendAsync(Post(LoginPath, LoginBody(email, password))), email);

    private static async Task<string> AssertGenericLoginRefusalAsync(HttpResponseMessage response, string email)
    {
        var body = await AssertRefusedAsync(response, HttpStatusCode.Unauthorized, "Authentication failed");
        Assert.False(response.Headers.Contains("Set-Cookie"));
        Assert.DoesNotContain(email, body, StringComparison.OrdinalIgnoreCase);
        foreach (var word in new[] { "lock", "disabled", "inactive", "unknown", "password" })
        {
            Assert.DoesNotContain(word, body, StringComparison.OrdinalIgnoreCase);
        }

        var problem = JsonDocument.Parse(body).RootElement;
        return $"{problem.GetProperty("title").GetString()}|{problem.GetProperty("detail").GetString()}";
    }

    private static void AssertSessionBody(string body, StaffAccount staff)
    {
        foreach (var secret in new[] { Password, staff.SecurityStamp!, staff.PasswordHash!, staff.ConcurrencyStamp! })
        {
            Assert.DoesNotContain(secret, body, StringComparison.Ordinal);
        }

        var root = JsonDocument.Parse(body).RootElement;
        Assert.Equal(["staffAccountId", "email", "memberships"], root.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.Equal(staff.Id, root.GetProperty("staffAccountId").GetGuid());
        Assert.Equal(Email, root.GetProperty("email").GetString());
        var memberships = root.GetProperty("memberships").EnumerateArray().ToArray();
        Assert.Equal(2, memberships.Length);
        Assert.All(memberships, membership => Assert.Equal(
            ["propertyId", "propertyName", "timeZone", "role"],
            membership.EnumerateObject().Select(property => property.Name).ToArray()));
        Assert.Equal(
            [(PropertyB, "Alpha Inn", "Asia/Bangkok", StaffRole.FrontDesk), (PropertyA, "Beta Resort", "Asia/Ho_Chi_Minh", StaffRole.Manager)],
            memberships.Select(membership => (
                membership.GetProperty("propertyId").GetGuid(),
                membership.GetProperty("propertyName").GetString(),
                membership.GetProperty("timeZone").GetString(),
                membership.GetProperty("role").GetString())).ToArray());
    }

    private static async Task<StaffSessionResponse> ReadSessionAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<StaffSessionResponse>())!;
    }

    private static async Task<(Guid, string)[]> MembershipsAsync(HttpClient client, string cookie)
    {
        var response = await client.SendAsync(Get(MePath, cookie));
        Assert.False(response.Headers.Contains("Set-Cookie"));
        return (await ReadSessionAsync(response)).Memberships
            .Select(membership => (membership.PropertyId, membership.Role))
            .ToArray();
    }

    private static async Task<Guid> CustomerIdAsync(HttpClient client, string cookie)
    {
        var response = await client.SendAsync(Get("/api/v1/auth/me", cookie));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("customerAccountId").GetGuid();
    }

    /// <summary>
    /// One armed race for <see cref="ResetRaceUserManager"/>: what the login request held when it
    /// reached the reset, what the competing scope did, and what Identity answered the reset.
    /// </summary>
    private sealed class ResetRace
    {
        private int _armed;

        public bool IsArmed => Volatile.Read(ref _armed) == 1;
        public int? StaleAccessFailedCount { get; set; }
        public string? StaleConcurrencyStamp { get; set; }
        public IdentityResult? CompetingFailure { get; set; }
        public bool CompetingLockedOut { get; set; }
        public IdentityResult? ResetResult { get; set; }

        public void Arm() => Volatile.Write(ref _armed, 1);

        public bool TryFire() => Interlocked.Exchange(ref _armed, 0) == 1;
    }

    /// <summary>
    /// Test-host-only <see cref="UserManager{TUser}"/> for Staff. When the race is armed, the first
    /// <c>ResetAccessFailedCountAsync</c> — reached only after a correct password, with the account
    /// the request loaded before it — first lets a separate DI scope record one more failure
    /// through Identity, then runs Identity's own reset on the now-stale account. Everything else
    /// is Identity's unchanged behaviour.
    /// </summary>
    private sealed class ResetRaceUserManager(
        ResetRace race,
        IServiceScopeFactory scopes,
        IUserStore<StaffAccount> store,
        IOptions<IdentityOptions> optionsAccessor,
        IPasswordHasher<StaffAccount> passwordHasher,
        IEnumerable<IUserValidator<StaffAccount>> userValidators,
        IEnumerable<IPasswordValidator<StaffAccount>> passwordValidators,
        ILookupNormalizer keyNormalizer,
        IdentityErrorDescriber errors,
        IServiceProvider services,
        ILogger<UserManager<StaffAccount>> logger)
        : UserManager<StaffAccount>(
            store, optionsAccessor, passwordHasher, userValidators, passwordValidators, keyNormalizer, errors, services, logger)
    {
        public override async Task<IdentityResult> ResetAccessFailedCountAsync(StaffAccount user)
        {
            if (!race.TryFire())
            {
                return await base.ResetAccessFailedCountAsync(user);
            }

            race.StaleAccessFailedCount = user.AccessFailedCount;
            race.StaleConcurrencyStamp = user.ConcurrencyStamp;
            await RecordCompetingFailureAsync(user.Id).WaitAsync(TimeSpan.FromSeconds(30));
            race.ResetResult = await base.ResetAccessFailedCountAsync(user);
            return race.ResetResult;
        }

        private async Task RecordCompetingFailureAsync(Guid staffId)
        {
            await using var scope = scopes.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
            var account = await users.FindByIdAsync(staffId.ToString())
                ?? throw new InvalidOperationException("The competing scope could not load the Staff account.");
            race.CompetingFailure = await users.AccessFailedAsync(account);
            race.CompetingLockedOut = await users.IsLockedOutAsync(account);
        }
    }

    /// <summary>
    /// Records the SQL text EF Core sends to this test's database, from EF's own
    /// <c>CommandExecuting</c> diagnostic event — every command the application runs, not a
    /// claims collection read after the fact.
    /// </summary>
    private sealed class SqlCommandRecorder : IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>, IDisposable
    {
        private readonly string _database;
        private readonly List<IDisposable> _subscriptions = [];
        private readonly ConcurrentQueue<string> _commands = new();

        public SqlCommandRecorder(string database)
        {
            _database = database;
            _subscriptions.Add(DiagnosticListener.AllListeners.Subscribe(this));
        }

        public string[] Commands => _commands.ToArray();

        void IObserver<DiagnosticListener>.OnNext(DiagnosticListener listener)
        {
            if (listener.Name == DbLoggerCategory.Name)
            {
                lock (_subscriptions)
                {
                    _subscriptions.Add(listener.Subscribe(this));
                }
            }
        }

        void IObserver<KeyValuePair<string, object?>>.OnNext(KeyValuePair<string, object?> value)
        {
            if (value.Key == RelationalEventId.CommandExecuting.Name &&
                value.Value is CommandEventData data &&
                data.Command.Connection?.Database == _database)
            {
                _commands.Enqueue(data.Command.CommandText);
            }
        }

        void IObserver<DiagnosticListener>.OnCompleted()
        {
        }

        void IObserver<DiagnosticListener>.OnError(Exception error)
        {
        }

        void IObserver<KeyValuePair<string, object?>>.OnCompleted()
        {
        }

        void IObserver<KeyValuePair<string, object?>>.OnError(Exception error)
        {
        }

        public void Dispose()
        {
            lock (_subscriptions)
            {
                _subscriptions.ForEach(subscription => subscription.Dispose());
            }
        }
    }
}

/// <summary>
/// Test-assembly-only probe for the Staff scheme's Forbid response. Reachable only from a host
/// that adds this assembly as an application part; <c>TheBha.Api</c> has no such route.
/// </summary>
[ApiController]
[Route(Route)]
public sealed class StaffForbidProbeController : ControllerBase
{
    public const string Route = "/api/admin/v1/test-only/staff-forbid-probe";

    [HttpGet]
    [Authorize(AuthenticationSchemes = StaffAuthentication.Scheme)]
    public IActionResult Probe() => Forbid(StaffAuthentication.Scheme);
}
