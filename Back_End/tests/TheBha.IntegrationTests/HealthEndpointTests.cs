using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

public sealed class HealthEndpointTests : IClassFixture<PostgreSqlWebApplicationFactory>
{
    private const string UnavailableDatabaseConnectionString =
        "Host=127.0.0.1;Port=1;Database=unavailable;Username=unavailable;" +
        "Password=unavailable;Timeout=1;Command Timeout=1";

    private readonly PostgreSqlWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public HealthEndpointTests(PostgreSqlWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Get_health_stays_healthy_when_postgresql_is_unavailable()
    {
        using var factory = CreateFactoryWithUnavailableDatabase();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Get_readiness_returns_healthy_when_postgresql_is_healthy()
    {
        var response = await _client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Get_readiness_returns_service_unavailable_when_postgresql_is_unavailable()
    {
        using var factory = CreateFactoryWithUnavailableDatabase();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Get_health_returns_healthy_status()
    {
        var response = await _client.GetAsync("/health");
        var payload = await response.Content.ReadFromJsonAsync<HealthResponse>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", payload?.Status);
    }

    [Fact]
    public async Task Get_swagger_document_returns_openapi_document()
    {
        var response = await _client.GetAsync("/swagger/v1/swagger.json");
        await using var payload = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(payload);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(document.RootElement.TryGetProperty("openapi", out _));
    }

    private WebApplicationFactory<Program> CreateFactoryWithUnavailableDatabase()
    {
        return _factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
                services.RemoveAll<TheBhaDbContext>();
                services.AddDbContext<TheBhaDbContext>(options =>
                    options.UseNpgsql(UnavailableDatabaseConnectionString));
            }));
    }

    private sealed record HealthResponse(string Status);
}

public sealed class PostgreSqlWebApplicationFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
    }
}
