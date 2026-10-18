using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using TheBha.Domain.Properties;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class AdminCatalogApiTests : WebsiteTestSupport
{
    public AdminCatalogApiTests(PostgreSqlWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task StaffCatalogReadsAreGatedAndOwnerBound()
    {
        using var host = CreateHost();
        var propertyId = await SeedStaffAsync(host);
        using var client = CreateHttpsClient(host);
        var route = $"/api/admin/v1/catalog/properties/{propertyId}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(route)).StatusCode);
        var desk = await LoginAsync(client, Desk);
        using var noPermission = new HttpRequestMessage(HttpMethod.Get, route);
        noPermission.Headers.Add("Cookie", desk);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(noPermission)).StatusCode);
        var site = await LoginAsync(client, Site);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get("/api/admin/v1/catalog/properties", site))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get($"/api/admin/v1/catalog/properties/{Guid.NewGuid()}", site))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/api/admin/v1/catalog/properties/{propertyId}/products")).StatusCode);
        using var productRead = Get($"/api/admin/v1/catalog/properties/{propertyId}/products", site);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(productRead)).StatusCode);
        using var deskProductRead = Get($"/api/admin/v1/catalog/properties/{propertyId}/products", desk);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(deskProductRead)).StatusCode);
    }

    [Fact]
    public async Task ProductListReturnsSummaryWithoutGalleryPayloadAndStaysPropertyScoped()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");
        await using (var context = Factory.CreateDbContext())
        {
            var room = new RoomType(Guid.NewGuid(), propertyId, "SUMMARY", "Summary room", "summary-room", "Description", 2, 4, true, DateTimeOffset.Parse("2026-10-15T00:00:00Z"));
            context.RoomTypes.Add(room);
            context.Add(new PhysicalRoom(Guid.NewGuid(), propertyId, room, "SUMMARY-01", 0, OperationalStatus.Active, DateTimeOffset.Parse("2026-10-15T00:00:00Z")));
            context.Media.Add(new Media(Guid.NewGuid(), "https://media.example.test/summary.webp", "Cover", MediaType.Image, DateTimeOffset.UtcNow));
            await context.SaveChangesAsync();
            context.RoomTypeMedia.Add(new RoomTypeMedia(room.Id, context.Media.Local.Single().Id, 0, true));
            await context.SaveChangesAsync();
        }

        using var response = await session.GetAsync($"/api/admin/v1/catalog/properties/{propertyId}/products");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var item = Assert.Single(document.RootElement.EnumerateArray());
        Assert.Equal("SUMMARY", item.GetProperty("code").GetString());
        Assert.Equal(1, item.GetProperty("physicalRoomCount").GetInt32());
        Assert.Equal(1, item.GetProperty("galleryCount").GetInt32());
        Assert.True(item.GetProperty("coverMediaId").GetGuid() != Guid.Empty);
        Assert.False(item.TryGetProperty("gallery", out _));
    }

    [Fact]
    public async Task SeedImagePreviewResolvesByControlledUrlWhenDatabaseMediaIdDiffersFromManifest()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");
        var roomId = Guid.NewGuid();
        var mediaId = Guid.NewGuid();
        await using (var context = Factory.CreateDbContext())
        {
            var room = new RoomType(roomId, propertyId, "EMBEDDED", "Embedded room", "embedded-room", null, 2, 2, true, DateTimeOffset.UtcNow);
            context.RoomTypes.Add(room);
            context.Media.Add(new Media(mediaId, "https://localhost:3000/media/the-bha-riverside/one-bedroom-living.webp", "Cover", MediaType.Image, DateTimeOffset.UtcNow));
            context.RoomTypeMedia.Add(new RoomTypeMedia(roomId, mediaId, 0, true));
            await context.SaveChangesAsync();
        }

        using var response = await session.GetAsync($"/api/admin/v1/catalog/properties/{propertyId}/room-types/{roomId}/media/{mediaId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/webp", response.Content.Headers.ContentType?.MediaType);
        Assert.True((await response.Content.ReadAsByteArrayAsync()).Length > 100);
    }

    [Fact]
    public async Task SavePersistsContentAuditAndStaleVersionConflictsWithoutChangingOperations()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");
        await using (var context = Factory.CreateDbContext())
        {
            var room = new RoomType(Guid.NewGuid(), propertyId, "TEST-ROOM", "Test room", "test-room", "Before", 2, 2, true, DateTimeOffset.Parse("2026-10-15T00:00:00Z"));
            context.RoomTypes.Add(room);
            context.Add(new PhysicalRoom(Guid.NewGuid(), propertyId, room, "TEST-01", 0, OperationalStatus.Active, DateTimeOffset.Parse("2026-10-15T00:00:00Z")));
            await context.SaveChangesAsync();
        }
        var roomId = await ScalarAsync<Guid>("""SELECT "Id" FROM "RoomTypes" WHERE "Code" = 'TEST-ROOM'""");
        var path = $"/api/admin/v1/catalog/properties/{propertyId}/room-types/{roomId}";
        var initial = await JsonAsync(await session.GetAsync(path));
        Assert.Equal(1, initial.GetProperty("version").GetInt32());
        Assert.Equal(1, initial.GetProperty("physicalRoomCount").GetInt32());
        Assert.Equal(JsonValueKind.Null, initial.GetProperty("areaSquareMeters").ValueKind);
        var body = new
        {
            expectedVersion = 1, name = "Edited room", description = "Persisted", address = (string?)null, city = (string?)null, country = (string?)null,
            areaSquareMeters = 42.5m, bedrooms = 2, bedDescription = "1 queen + 2 single", amenityIds = Array.Empty<Guid>(), gallery = Array.Empty<object>()
        };
        var saved = await session.PostAsync($"{path}/save", body);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var result = await JsonAsync(saved);
        Assert.Equal("Edited room", result.GetProperty("name").GetString());
        Assert.Equal(2, result.GetProperty("version").GetInt32());
        Assert.Equal(HttpStatusCode.Conflict, (await session.PostAsync($"{path}/save", body)).StatusCode);
        var reread = await JsonAsync(await session.GetAsync(path));
        Assert.Equal("Edited room", reread.GetProperty("name").GetString());
        Assert.Equal(42.5m, reread.GetProperty("areaSquareMeters").GetDecimal());
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "CatalogContentAudits" WHERE "PropertyId" = '{propertyId}' AND "RoomTypeId" = '{roomId}' AND "ActorStaffId" = '{await StaffIdAsync(Site)}'"""));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "PhysicalRooms" WHERE "PropertyId" = '{propertyId}' AND "RoomTypeId" = '{roomId}'"""));
    }

    [Fact]
    public async Task GalleryRequiresOneCoverAndRetainsOwnerBoundary()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");
        var otherId = Guid.NewGuid();
        await using (var context = Factory.CreateDbContext())
        {
            context.Media.Add(new Media(otherId, "https://media.example.test/other.webp", "Other owner alt", MediaType.Image, DateTimeOffset.UtcNow));
            await context.SaveChangesAsync();
        }
        var path = $"/api/admin/v1/catalog/properties/{propertyId}/save";
        object Body(object[] gallery) => new { expectedVersion = 1, name = "Hotel Website", description = (string?)null, address = "1 Hotel Street", city = "Da Nang", country = "Vietnam", areaSquareMeters = (decimal?)null, bedrooms = (int?)null, bedDescription = (string?)null, amenityIds = Array.Empty<Guid>(), gallery };
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PostAsync(path, Body([new { mediaId = otherId, altText = "Should not persist globally", isCover = true }]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PostAsync(path, Body([new { mediaId = otherId, altText = (string?)null, isCover = false }]))).StatusCode);
        Assert.Equal("Other owner alt", await ScalarAsync<string>($"""SELECT "AltText" FROM "Media" WHERE "Id" = '{otherId}'"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "PropertyMedia" WHERE "PropertyId" = (SELECT "Id" FROM "Properties" WHERE "Slug"='website-cp02')"""));
    }

    [Fact]
    public async Task UploadRejectsScriptBytesBeforeCreatingMedia()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/admin/v1/catalog/properties/{propertyId}/media");
        var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("<svg onload=alert(1)>")), "file", "picture.svg");
        request.Content = form;
        request.Headers.Add("Origin", AdminOrigin);
        request.Headers.Add("Cookie", session.Cookie);
        Assert.Equal(HttpStatusCode.BadRequest, (await session.Client.SendAsync(request)).StatusCode);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "CatalogUploads" """));
    }

    [Fact]
    public async Task UploadIsPrivateUntilOneOwnerSaveLinksItAndThenSurvivesApiReads()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/admin/v1/catalog/properties/{propertyId}/media");
        var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "catalog", "valid.webp"))), "file", "picture.webp");
        request.Content = form;
        request.Headers.Add("Origin", AdminOrigin);
        request.Headers.Add("Cookie", session.Cookie);
        var uploaded = await session.Client.SendAsync(request);
        Assert.True(uploaded.StatusCode == HttpStatusCode.OK, await uploaded.Content.ReadAsStringAsync());
        var mediaId = (await JsonAsync(uploaded)).GetProperty("mediaId").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await session.GetAsync($"/api/admin/v1/catalog/properties/{propertyId}/media/{mediaId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await session.Client.GetAsync($"/api/v1/catalog-media/{mediaId}")).StatusCode);
        var body = new
        {
            expectedVersion = 1, name = "Hotel Website", description = (string?)null, address = "1 Hotel Street", city = "Da Nang", country = "Vietnam",
            areaSquareMeters = (decimal?)null, bedrooms = (int?)null, bedDescription = (string?)null, amenityIds = Array.Empty<Guid>(),
            gallery = new[] { new { mediaId, altText = "Entrance", isCover = true } }
        };
        Assert.Equal(HttpStatusCode.OK, (await session.PostAsync($"/api/admin/v1/catalog/properties/{propertyId}/save", body)).StatusCode);
        var publicImage = await session.Client.GetAsync($"/api/v1/catalog-media/{mediaId}");
        Assert.Equal(HttpStatusCode.OK, publicImage.StatusCode);
        Assert.Equal("image/webp", publicImage.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", publicImage.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "PropertyMedia" WHERE "PropertyId" = '{propertyId}' AND "MediaId" = '{mediaId}' AND "IsCover" """));
    }
}
