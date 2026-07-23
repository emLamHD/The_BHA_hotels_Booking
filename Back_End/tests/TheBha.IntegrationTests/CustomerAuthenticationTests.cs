using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class CustomerAuthenticationTests
{
    private static readonly string StrongPassword = $"A!a1{Guid.NewGuid():N}";
    private readonly PostgreSqlWebApplicationFactory _factory;

    public CustomerAuthenticationTests(PostgreSqlWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Complete_customer_cookie_session_flow_is_safe_and_csrf_protected()
    {
        await _factory.ResetDatabaseAsync();
        using var client = _factory.CreateClient();

        var anonymousMe = await client.GetAsync("/api/v1/auth/me");
        AssertProblem(anonymousMe, HttpStatusCode.Unauthorized);

        var csrf = await GetCsrfAsync(client);
        Assert.Equal("X-CSRF-TOKEN", csrf.HeaderName);

        var register = await client.PostAsJsonAsync(
            "/api/v1/auth/register",
            new { Email = "Customer@Example.com", Password = StrongPassword });
        Assert.Equal(HttpStatusCode.Created, register.StatusCode);
        var registered = await register.Content.ReadFromJsonAsync<CustomerResponse>();
        Assert.NotNull(registered);
        Assert.Equal("Customer@Example.com", registered.Email);

        var duplicate = await client.PostAsJsonAsync(
            "/api/v1/auth/register",
            new { Email = "customer@example.com", Password = StrongPassword });
        AssertProblem(duplicate, HttpStatusCode.Conflict);

        await using (var context = _factory.CreateDbContext())
        {
            Assert.Equal(1, await context.CustomerAccounts.CountAsync());
        }

        var invalidLogin = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { Email = "nobody@example.com", Password = "Wrong!Password123" });
        AssertProblem(invalidLogin, HttpStatusCode.Unauthorized);
        var invalidBody = await invalidLogin.Content.ReadAsStringAsync();
        Assert.DoesNotContain("nobody@example.com", invalidBody, StringComparison.OrdinalIgnoreCase);

        var login = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { Email = "customer@example.com", Password = StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var sessionCookie = Assert.Single(
            login.Headers.GetValues("Set-Cookie"),
            value => value.StartsWith(".TheBha.Customer=", StringComparison.Ordinal));
        Assert.Contains("httponly", sessionCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", sessionCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", sessionCookie, StringComparison.OrdinalIgnoreCase);

        var me = await client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var current = await me.Content.ReadFromJsonAsync<CustomerResponse>();
        Assert.Equal(registered.CustomerAccountId, current?.CustomerAccountId);
        Assert.Equal("Customer@Example.com", current?.Email);

        var missingCsrf = await client.PostAsync("/api/v1/auth/logout", null);
        AssertProblem(missingCsrf, HttpStatusCode.BadRequest);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);

        using var invalidCsrfRequest = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/logout");
        invalidCsrfRequest.Headers.Add("X-CSRF-TOKEN", "invalid-token");
        var invalidCsrf = await client.SendAsync(invalidCsrfRequest);
        AssertProblem(invalidCsrf, HttpStatusCode.BadRequest);

        csrf = await GetCsrfAsync(client);
        using var logoutRequest = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/logout");
        logoutRequest.Headers.Add(csrf.HeaderName, csrf.Token);
        var logout = await client.SendAsync(logoutRequest);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        AssertProblem(await client.GetAsync("/api/v1/auth/me"), HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Registration_uses_identity_validation_without_requiring_csrf()
    {
        await _factory.ResetDatabaseAsync();
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/register",
            new { Email = "customer@example.com", Password = "weak" });

        AssertProblem(response, HttpStatusCode.BadRequest);
        await using var context = _factory.CreateDbContext();
        Assert.Equal(0, await context.CustomerAccounts.CountAsync());
    }

    [Fact]
    public async Task PostgreSql_enforces_normalized_email_uniqueness()
    {
        await _factory.ResetDatabaseAsync();
        await using var scope = _factory.Services.CreateAsyncScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
        var first = new CustomerAccount
        {
            Id = Guid.NewGuid(),
            Email = "first@example.com",
            UserName = "first@example.com"
        };
        Assert.True((await userManager.CreateAsync(first, StrongPassword)).Succeeded);

        await using var context = _factory.CreateDbContext();
        context.CustomerAccounts.Add(new CustomerAccount
        {
            Id = Guid.NewGuid(),
            Email = "FIRST@example.com",
            NormalizedEmail = first.NormalizedEmail,
            UserName = "different@example.com",
            NormalizedUserName = "DIFFERENT@EXAMPLE.COM",
            SecurityStamp = Guid.NewGuid().ToString(),
            ConcurrencyStamp = Guid.NewGuid().ToString()
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task Registration_and_login_rate_limits_are_deterministic()
    {
        using var limitedFactory = _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Authentication:RateLimiting:RegisterPermitLimit", "2");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "2");
            builder.UseSetting("Authentication:RateLimiting:WindowSeconds", "300");
        });
        using var client = limitedFactory.CreateClient();

        for (var attempt = 0; attempt < 2; attempt++)
        {
            var response = await client.PostAsJsonAsync(
                "/api/v1/auth/register",
                new { Email = $"weak-{attempt}@example.com", Password = "weak" });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        AssertProblem(
            await client.PostAsJsonAsync(
                "/api/v1/auth/register",
                new { Email = "limited@example.com", Password = "weak" }),
            HttpStatusCode.TooManyRequests);

        for (var attempt = 0; attempt < 2; attempt++)
        {
            var response = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new { Email = "missing@example.com", Password = StrongPassword });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        AssertProblem(
            await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new { Email = "missing@example.com", Password = StrongPassword }),
            HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task Production_cookie_flags_and_credentialed_cors_are_explicit()
    {
        await _factory.ResetDatabaseAsync();
        await CreateCustomerAsync("secure@example.com");

        var keyPath = Path.Combine(
            Path.GetTempPath(),
            "thebha-data-protection-tests",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(keyPath);
        try
        {
            using var productionFactory = _factory.WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("DataProtection:KeysPath", keyPath);
            });
            using var client = productionFactory.CreateClient(
                new WebApplicationFactoryClientOptions
                {
                    BaseAddress = new Uri("https://localhost"),
                    HandleCookies = false
                });

            var login = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new { Email = "secure@example.com", Password = StrongPassword });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var cookie = Assert.Single(
                login.Headers.GetValues("Set-Cookie"),
                value => value.StartsWith(".TheBha.Customer=", StringComparison.Ordinal));
            Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("domain=", cookie, StringComparison.OrdinalIgnoreCase);

            var csrf = await client.GetAsync("/api/v1/auth/csrf");
            Assert.Equal(HttpStatusCode.OK, csrf.StatusCode);
            var antiforgeryCookie = Assert.Single(
                csrf.Headers.GetValues("Set-Cookie"),
                value => value.StartsWith(".TheBha.Antiforgery=", StringComparison.Ordinal));
            Assert.Contains("secure", antiforgeryCookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", antiforgeryCookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("samesite=lax", antiforgeryCookie, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("domain=", antiforgeryCookie, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            var expectedRoot = Path.GetFullPath(Path.Combine(
                Path.GetTempPath(),
                "thebha-data-protection-tests"));
            var resolvedKeyPath = Path.GetFullPath(keyPath);
            Assert.StartsWith(expectedRoot, resolvedKeyPath, StringComparison.OrdinalIgnoreCase);
            if (Directory.Exists(resolvedKeyPath))
            {
                Directory.Delete(resolvedKeyPath, recursive: true);
            }
        }

        using var developmentClient = _factory.CreateClient();
        using var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/v1/auth/login");
        preflight.Headers.Add("Origin", "http://localhost:3000");
        preflight.Headers.Add("Access-Control-Request-Method", "POST");
        var cors = await developmentClient.SendAsync(preflight);
        Assert.Equal("true", Assert.Single(cors.Headers.GetValues("Access-Control-Allow-Credentials")));
        Assert.Equal(
            "http://localhost:3000",
            Assert.Single(cors.Headers.GetValues("Access-Control-Allow-Origin")));
    }

    [Fact]
    public async Task OpenApi_documents_cookie_csrf_contract_and_auth_status_codes()
    {
        using var client = _factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json");
        await using var payload = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(payload);
        var root = document.RootElement;

        var cookieScheme = root.GetProperty("components")
            .GetProperty("securitySchemes")
            .GetProperty("CustomerCookie");
        Assert.Equal("apiKey", cookieScheme.GetProperty("type").GetString());
        Assert.Equal("cookie", cookieScheme.GetProperty("in").GetString());

        var paths = root.GetProperty("paths");
        Assert.True(paths.TryGetProperty("/api/v1/auth/csrf", out _));
        Assert.True(paths.TryGetProperty("/api/v1/auth/register", out var register));
        Assert.True(paths.TryGetProperty("/api/v1/auth/login", out var login));
        Assert.True(paths.TryGetProperty("/api/v1/auth/logout", out var logout));
        Assert.True(paths.TryGetProperty("/api/v1/auth/me", out var me));
        Assert.True(register.GetProperty("post").GetProperty("responses").TryGetProperty("409", out _));
        Assert.True(login.GetProperty("post").GetProperty("responses").TryGetProperty("429", out _));
        Assert.True(me.GetProperty("get").TryGetProperty("security", out _));

        var logoutParameters = logout.GetProperty("post").GetProperty("parameters");
        Assert.Contains(
            logoutParameters.EnumerateArray(),
            parameter =>
                parameter.GetProperty("name").GetString() == "X-CSRF-TOKEN" &&
                parameter.GetProperty("required").GetBoolean());
        Assert.False(register.GetProperty("post").TryGetProperty("parameters", out _));
    }

    private async Task CreateCustomerAsync(string email)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
        var result = await userManager.CreateAsync(
            new CustomerAccount { Id = Guid.NewGuid(), Email = email, UserName = email },
            StrongPassword);
        Assert.True(result.Succeeded);
    }

    private static async Task<CsrfResponse> GetCsrfAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/v1/auth/csrf");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CsrfResponse>())!;
    }

    private static void AssertProblem(HttpResponseMessage response, HttpStatusCode status)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    private sealed record CsrfResponse(string Token, string HeaderName);
    private sealed record CustomerResponse(Guid CustomerAccountId, string Email);
}
