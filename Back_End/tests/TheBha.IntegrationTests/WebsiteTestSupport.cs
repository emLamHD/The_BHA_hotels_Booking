using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: shared plumbing of the website-settings API tests — a Staff-mode host, Staff
/// created by the operator CLI (the only way they exist), sessions from the real login route, requests that carry
/// the Admin origin, and SQL probes for what the database really holds. Everything runs against real PostgreSQL.
/// </summary>
public abstract class WebsiteTestSupport(PostgreSqlWebApplicationFactory factory)
{
    protected const string AdminOrigin = "https://localhost:3001";
    protected const string Site = "site@example.com";
    protected const string Desk = "desk@example.com";
    protected const string Manager = "manager@example.com";

    protected static readonly string Password = $"A!a1{Guid.NewGuid():N}";
    protected static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-15T00:00:00Z");

    protected PostgreSqlWebApplicationFactory Factory => factory;

    protected WebApplicationFactory<Program> CreateHost(AdminCalendarAccessMode? mode = AdminCalendarAccessMode.Staff) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (mode is not null)
            {
                builder.UseSetting(AdminCalendarAccess.ModeKey, mode.ToString());
            }

            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
        });

    protected static HttpClient CreateHttpsClient(WebApplicationFactory<Program> host) =>
        host.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
            HandleCookies = false
        });

    /// <summary>Resets the database (website seed included) and creates one Property and three Staff: Site (FrontDesk + website flag), Desk (FrontDesk), Manager (Manager).</summary>
    protected async Task<Guid> SeedStaffAsync(WebApplicationFactory<Program> host)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Hotel Website", "website-cp02", null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        context.Add(property);
        await context.SaveChangesAsync();

        await CliAsync(host, ["--staff-create", "--email", Site, "--property-id", property.Id.ToString(), "--role", StaffRole.FrontDesk], Password);
        await CliAsync(host, ["--staff-create", "--email", Desk, "--property-id", property.Id.ToString(), "--role", StaffRole.FrontDesk], Password);
        await CliAsync(host, ["--staff-create", "--email", Manager, "--property-id", property.Id.ToString(), "--role", StaffRole.Manager], Password);
        await CliAsync(host, ["--staff-website-access", "--email", Site, "--enabled", "true"]);
        return property.Id;
    }

    protected static async Task<(int Exit, string Output)> RunCliAsync(WebApplicationFactory<Program> host, string[] args, string? password = null)
    {
        using var output = new StringWriter();
        var exit = await StaffBootstrapCommand.RunAsync(args, host.Services, output, () => password, CancellationToken.None);
        return (exit, output.ToString());
    }

    protected static async Task CliAsync(WebApplicationFactory<Program> host, string[] args, string? password = null)
    {
        var (exit, output) = await RunCliAsync(host, args, password);
        Assert.True(exit == 0, output);
    }

    protected static async Task<string> LoginAsync(HttpClient client, string email)
    {
        var login = await client.SendAsync(Post("/api/admin/v1/auth/login", new { email, password = Password }));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return CookieHeader(login, ".TheBha.Staff");
    }

    protected static string CookieHeader(HttpResponseMessage response, string name)
    {
        var setCookie = Assert.Single(response.Headers.GetValues("Set-Cookie"), value => value.StartsWith($"{name}=", StringComparison.Ordinal));
        return setCookie[..setCookie.IndexOf(';')];
    }

    protected static HttpRequestMessage Get(string path, string? cookie = null, string? origin = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (origin is not null)
        {
            request.Headers.TryAddWithoutValidation("Origin", origin);
        }

        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        return request;
    }

    protected static HttpRequestMessage Post(
        string path, object? body, string? cookie = null, string[]? origins = null, string? contentType = "application/json")
    {
        var text = body as string ?? JsonSerializer.Serialize(body ?? new { }, Json);
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(text)) };
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

    protected static async Task<HttpResponseMessage> AssertStatusAsync(HttpStatusCode status, Task<HttpResponseMessage> send)
    {
        var response = await send;
        Assert.True(status == response.StatusCode, $"expected {(int)status}, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return response;
    }

    protected static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    /// <summary>A host, an HTTPS client and the Staff cookie of one signed-in account.</summary>
    protected sealed class Session(WebApplicationFactory<Program> host, HttpClient client, string cookie) : IDisposable
    {
        public WebApplicationFactory<Program> Host { get; } = host;
        public HttpClient Client { get; } = client;
        public string Cookie { get; } = cookie;

        public Task<HttpResponseMessage> GetAsync(string path) => Client.SendAsync(Get(path, Cookie));

        public Task<HttpResponseMessage> PostAsync(string path, object? body) => Client.SendAsync(Post(path, body, Cookie));

        public void Dispose()
        {
            Client.Dispose();
            Host.Dispose();
        }
    }

    /// <summary>Seeds Staff and signs <paramref name="email"/> in (the website flag holder by default).</summary>
    protected async Task<Session> StartAsync(string email = Site)
    {
        var host = CreateHost();
        await SeedStaffAsync(host);
        var client = CreateHttpsClient(host);
        return new Session(host, client, await LoginAsync(client, email));
    }

    /// <summary>The problem a refusal carries: its machine-readable <c>code</c> and offending <c>field</c>.</summary>
    protected static async Task<(string? Code, string? Field)> ProblemAsync(HttpResponseMessage response)
    {
        var body = await JsonAsync(response);
        return (
            body.TryGetProperty("code", out var code) ? code.GetString() : null,
            body.TryGetProperty("field", out var field) ? field.GetString() : null);
    }

    protected async Task<T> ScalarAsync<T>(string sql)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)Convert.ChangeType((await command.ExecuteScalarAsync())!, typeof(T));
    }

    protected async Task<Guid> StaffIdAsync(string email)
    {
        await using var context = factory.CreateDbContext();
        return await context.StaffAccounts.AsNoTracking()
            .Where(account => account.NormalizedEmail == email.ToUpperInvariant())
            .Select(account => account.Id)
            .SingleAsync();
    }

    protected static async Task<string> CustomerLoginAsync(WebApplicationFactory<Program> host, HttpClient client)
    {
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var customers = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
            var customer = new CustomerAccount { Id = Guid.NewGuid(), Email = "guest@example.com", UserName = "guest@example.com" };
            Assert.True((await customers.CreateAsync(customer, Password)).Succeeded);
        }

        var login = await client.PostAsync(
            "/api/v1/auth/login",
            new StringContent(JsonSerializer.Serialize(new { Email = "guest@example.com", Password }), Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return CookieHeader(login, ".TheBha.Customer");
    }

    /// <summary>Counts of the invariants every website test may assert at any moment.</summary>
    protected async Task AssertInvariantsAsync()
    {
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "IsDefault" AND "IsActive" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "IsDefault" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "IsDefault" AND "IsActive" AND "VndPerUnit" IS NOT NULL """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "IsDefault" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "IsActive" AND "VndPerUnit" IS NULL"""));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "IsBase" AND "Code" = 'VND' AND "VndPerUnit" = 1 AND "IsActive" """));
        // The default language still has a text for every catalog key (static content included; a stored-content field is the database's, not the catalog's).
        Assert.Equal(
            TheBha.Application.Website.LocalizationAssets.Catalog.Count,
            await ScalarAsync<int>(
                $"""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."IsDefault" AND t."Key" !~ '^content\.(property|roomType|ratePlan|amenity|media)\.' """));
    }

    /// <summary>
    /// Gives <paramref name="code"/> a stored text for every stored-content field the database has right now (the test
    /// Property's name, address…), copied from the content column — the one thing the test seed leaves out — so a language that
    /// is complete in the catalog is complete overall.
    /// </summary>
    protected async Task CompleteContentAsync(string code)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var content = await scope.ServiceProvider.GetRequiredService<TheBha.Application.Website.IContentCatalog>().ListAsync(CancellationToken.None);
        var languageId = await ScalarAsync<Guid>($"""SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = '{code}' """);
        foreach (var entry in content)
        {
            await ExecuteAsync(
                $"""INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","IsManual") VALUES ('{languageId}','{entry.Key}','{entry.SourceText.Replace("'", "''")}',1,now(),false) ON CONFLICT DO NOTHING""");
        }
    }

    protected async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
