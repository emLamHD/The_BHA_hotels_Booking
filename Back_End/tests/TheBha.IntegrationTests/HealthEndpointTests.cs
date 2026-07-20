using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace TheBha.IntegrationTests;

public sealed class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
    {
        _client = factory
            .WithWebHostBuilder(builder => builder.UseEnvironment("Development"))
            .CreateClient();
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

    private sealed record HealthResponse(string Status);
}
