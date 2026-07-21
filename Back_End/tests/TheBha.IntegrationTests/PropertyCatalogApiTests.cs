using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class PropertyCatalogApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid DeluxeRoomTypeId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid FamilyRoomTypeId = Guid.Parse("30000000-0000-0000-0000-000000000002");

    [Fact]
    public async Task Four_customer_endpoints_return_seeded_postgresql_data_without_physical_inventory()
    {
        await SeedFreshDatabaseAsync();
        using var client = factory.CreateClient();

        var responses = new[]
        {
            await client.GetAsync("/api/v1/properties"),
            await client.GetAsync($"/api/v1/properties/{PropertyId}"),
            await client.GetAsync($"/api/v1/properties/{PropertyId}/room-types"),
            await client.GetAsync($"/api/v1/room-types/{DeluxeRoomTypeId}")
        };

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        var payloads = await Task.WhenAll(responses.Select(response => response.Content.ReadAsStringAsync()));
        Assert.Contains("The BHA Hotel", payloads[0], StringComparison.Ordinal);
        Assert.Contains("the-bha-hotel", payloads[1], StringComparison.Ordinal);
        Assert.Contains("Deluxe King", payloads[2], StringComparison.Ordinal);
        Assert.Contains("DLX-KING", payloads[3], StringComparison.Ordinal);
        Assert.All(payloads, payload =>
        {
            Assert.DoesNotContain("physicalRoom", payload, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("roomNumber", payload, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("operationalStatus", payload, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public async Task Amenities_and_media_are_returned_with_stable_media_ordering()
    {
        await SeedFreshDatabaseAsync();
        using var client = factory.CreateClient();

        var firstPayload = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}");
        var secondPayload = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}");
        var roomTypePayload = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/room-types/{FamilyRoomTypeId}");

        var firstMedia = firstPayload.GetProperty("media").EnumerateArray().ToArray();
        var secondMedia = secondPayload.GetProperty("media").EnumerateArray().ToArray();
        Assert.Equal(new[] { 0, 10 }, firstMedia.Select(item => item.GetProperty("sortOrder").GetInt32()));
        Assert.Equal(
            firstMedia.Select(item => item.GetProperty("id").GetGuid()),
            secondMedia.Select(item => item.GetProperty("id").GetGuid()));
        Assert.Equal(3, firstPayload.GetProperty("amenities").GetArrayLength());
        Assert.Equal(3, roomTypePayload.GetProperty("amenities").GetArrayLength());
        Assert.Equal(1, roomTypePayload.GetProperty("media").GetArrayLength());
        Assert.Equal("Image", firstMedia[0].GetProperty("mediaType").GetString());
    }

    [Fact]
    public async Task Inactive_properties_and_room_types_are_not_public()
    {
        await SeedFreshDatabaseAsync();
        using var client = factory.CreateClient();
        await using var context = factory.CreateDbContext();
        var family = await context.RoomTypes.SingleAsync(roomType => roomType.Id == FamilyRoomTypeId);
        family.Deactivate(DateTimeOffset.UtcNow);
        await context.SaveChangesAsync();

        var roomTypes = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}/room-types");
        var inactiveRoomType = await client.GetAsync($"/api/v1/room-types/{FamilyRoomTypeId}");

        Assert.Equal(1, roomTypes.GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, inactiveRoomType.StatusCode);

        var property = await context.Properties.SingleAsync(item => item.Id == PropertyId);
        property.Deactivate(DateTimeOffset.UtcNow);
        await context.SaveChangesAsync();

        var properties = await client.GetFromJsonAsync<JsonElement>("/api/v1/properties");
        var inactiveProperty = await client.GetAsync($"/api/v1/properties/{PropertyId}");
        var childRoomTypes = await client.GetAsync($"/api/v1/properties/{PropertyId}/room-types");
        var childRoomType = await client.GetAsync($"/api/v1/room-types/{DeluxeRoomTypeId}");

        Assert.Equal(0, properties.GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, inactiveProperty.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, childRoomTypes.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, childRoomType.StatusCode);
    }

    [Fact]
    public async Task Not_found_and_invalid_identifiers_return_problem_details()
    {
        await SeedFreshDatabaseAsync();
        using var client = factory.CreateClient();

        var notFound = await client.GetAsync($"/api/v1/properties/{Guid.NewGuid()}");
        var invalid = await client.GetAsync("/api/v1/properties/not-a-guid");
        var notFoundProblem = await notFound.Content.ReadFromJsonAsync<JsonElement>();
        var invalidProblem = await invalid.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.NotFound, notFound.StatusCode);
        Assert.Equal("application/problem+json", notFound.Content.Headers.ContentType?.MediaType);
        Assert.Equal(404, notFoundProblem.GetProperty("status").GetInt32());
        Assert.Equal("Property not found", notFoundProblem.GetProperty("title").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("application/problem+json", invalid.Content.Headers.ContentType?.MediaType);
        Assert.Equal(400, invalidProblem.GetProperty("status").GetInt32());
        Assert.True(invalidProblem.TryGetProperty("errors", out _));
    }

    [Fact]
    public async Task Swagger_describes_all_customer_catalog_endpoints_and_responses()
    {
        await SeedFreshDatabaseAsync();
        using var client = factory.CreateClient();

        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var paths = swagger.GetProperty("paths");

        Assert.True(paths.TryGetProperty("/api/v1/properties", out _));
        Assert.True(paths.TryGetProperty("/api/v1/properties/{propertyId}", out var propertyPath));
        Assert.True(paths.TryGetProperty("/api/v1/properties/{propertyId}/room-types", out _));
        Assert.True(paths.TryGetProperty("/api/v1/room-types/{roomTypeId}", out _));
        Assert.True(propertyPath.GetProperty("get").GetProperty("responses").TryGetProperty("404", out _));
    }

    private async Task SeedFreshDatabaseAsync()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context).SeedAsync(CancellationToken.None);
    }
}
