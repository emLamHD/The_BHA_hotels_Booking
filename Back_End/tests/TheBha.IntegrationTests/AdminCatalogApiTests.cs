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
        using var anonymousCreate = Post("/api/admin/v1/catalog/properties", new { });
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(anonymousCreate)).StatusCode);
        using var deskCreate = Post("/api/admin/v1/catalog/properties", new { }, desk);
        deskCreate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(deskCreate)).StatusCode);
    }

    [Fact]
    public async Task Catalog_create_preflights_allow_only_the_required_admin_headers_and_do_not_mutate()
    {
        using var host = CreateHost();
        var propertyId = await SeedStaffAsync(host);
        var roomTypeId = Guid.NewGuid();
        using var client = CreateHttpsClient(host);
        var routes = new[]
        {
            "/api/admin/v1/catalog/properties",
            $"/api/admin/v1/catalog/properties/{propertyId}/room-types",
            $"/api/admin/v1/catalog/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms",
        };
        var propertiesBefore = await ScalarAsync<int>("SELECT count(*) FROM \"Properties\"");
        var roomTypesBefore = await ScalarAsync<int>("SELECT count(*) FROM \"RoomTypes\"");
        var roomsBefore = await ScalarAsync<int>("SELECT count(*) FROM \"PhysicalRooms\"");
        var auditsBefore = await ScalarAsync<int>("SELECT count(*) FROM \"CatalogContentAudits\"");
        var operationsBefore = await ScalarAsync<int>("SELECT count(*) FROM \"AdminCatalogCreateOperations\"");

        foreach (var route in routes)
        {
            using var preflight = new HttpRequestMessage(HttpMethod.Options, route);
            preflight.Headers.Add("Origin", AdminOrigin);
            preflight.Headers.Add("Access-Control-Request-Method", "POST");
            preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type,idempotency-key");
            using var response = await client.SendAsync(preflight);

            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            Assert.Equal(AdminOrigin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Credentials")));
            Assert.Contains("POST", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Methods")), StringComparison.OrdinalIgnoreCase);
            var allowedHeaders = string.Join(",", response.Headers.GetValues("Access-Control-Allow-Headers"))
                .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            Assert.Contains("Content-Type", allowedHeaders, StringComparer.OrdinalIgnoreCase);
            Assert.Contains("Idempotency-Key", allowedHeaders, StringComparer.OrdinalIgnoreCase);
            Assert.False(response.Headers.Contains("Set-Cookie"));
        }

        using (var badOrigin = await SendPreflightAsync(client, routes[2], "https://evil.example", "POST", "content-type,idempotency-key"))
            Assert.False(badOrigin.Headers.Contains("Access-Control-Allow-Origin"));
        using (var badMethod = await SendPreflightAsync(client, routes[2], AdminOrigin, "PUT", "content-type,idempotency-key"))
            Assert.False(badMethod.Headers.Contains("Access-Control-Allow-Methods"));
        using (var badHeader = await SendPreflightAsync(client, routes[2], AdminOrigin, "POST", "content-type,idempotency-key,x-unlisted"))
        {
            var allowed = badHeader.Headers.TryGetValues("Access-Control-Allow-Headers", out var values) ? string.Join(",", values) : "";
            Assert.DoesNotContain("x-unlisted", allowed, StringComparison.OrdinalIgnoreCase);
        }
        using (var loginPolicy = await SendPreflightAsync(client, "/api/admin/v1/auth/login", AdminOrigin, "POST", "content-type,idempotency-key"))
        {
            var allowed = loginPolicy.Headers.TryGetValues("Access-Control-Allow-Headers", out var values) ? string.Join(",", values) : "";
            Assert.DoesNotContain("idempotency-key", allowed, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Equal(propertiesBefore, await ScalarAsync<int>("SELECT count(*) FROM \"Properties\""));
        Assert.Equal(roomTypesBefore, await ScalarAsync<int>("SELECT count(*) FROM \"RoomTypes\""));
        Assert.Equal(roomsBefore, await ScalarAsync<int>("SELECT count(*) FROM \"PhysicalRooms\""));
        Assert.Equal(auditsBefore, await ScalarAsync<int>("SELECT count(*) FROM \"CatalogContentAudits\""));
        Assert.Equal(operationsBefore, await ScalarAsync<int>("SELECT count(*) FROM \"AdminCatalogCreateOperations\""));

        using var deniedPost = Post(routes[2], new { roomNumber = "PREFLIGHT-MUST-NOT-CREATE", floor = 0, operationalStatus = "Inactive" }, origins: [AdminOrigin]);
        deniedPost.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var deniedResponse = await client.SendAsync(deniedPost);
        Assert.Equal(HttpStatusCode.Unauthorized, deniedResponse.StatusCode);
        Assert.Equal(AdminOrigin, Assert.Single(deniedResponse.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal(roomsBefore, await ScalarAsync<int>("SELECT count(*) FROM \"PhysicalRooms\""));

        var siteCookie = await LoginAsync(client, Site);
        using var invalidCreate = Post("/api/admin/v1/catalog/properties", new { name = "", slug = "", address = "", city = "", country = "", timeZone = "Asia/Ho_Chi_Minh", checkInTime = "14:00:00", checkOutTime = "12:00:00", isActive = false }, siteCookie, [AdminOrigin]);
        invalidCreate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var invalidResponse = await client.SendAsync(invalidCreate);
        Assert.Equal(HttpStatusCode.BadRequest, invalidResponse.StatusCode);
        Assert.Equal(AdminOrigin, Assert.Single(invalidResponse.Headers.GetValues("Access-Control-Allow-Origin")));

        using var wrongOriginCreate = Post("/api/admin/v1/catalog/properties", new { name = "Forbidden property", slug = "forbidden-property", address = "1 Sample Street", city = "Da Nang", country = "Vietnam", timeZone = "Asia/Ho_Chi_Minh", checkInTime = "14:00:00", checkOutTime = "12:00:00", isActive = false }, siteCookie, ["https://evil.example"]);
        wrongOriginCreate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var wrongOriginResponse = await client.SendAsync(wrongOriginCreate);
        Assert.Equal(HttpStatusCode.Forbidden, wrongOriginResponse.StatusCode);
        Assert.False(wrongOriginResponse.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal(propertiesBefore, await ScalarAsync<int>("SELECT count(*) FROM \"Properties\""));
        Assert.Equal(auditsBefore, await ScalarAsync<int>("SELECT count(*) FROM \"CatalogContentAudits\""));
        Assert.Equal(operationsBefore, await ScalarAsync<int>("SELECT count(*) FROM \"AdminCatalogCreateOperations\""));
    }

    private static async Task<HttpResponseMessage> SendPreflightAsync(HttpClient client, string route, string origin, string method, string headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, route);
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", method);
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", headers);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Property_room_type_and_physical_room_creates_are_parent_bound_audited_and_idempotent()
    {
        using var session = await StartAsync();
        var parentId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");

        var missingCheckIn = new { name = "Missing Time Property", slug = "missing-time-property", description = (string?)null, address = "1 Sample Street", city = "Da Nang", country = "Vietnam", timeZone = "Asia/Ho_Chi_Minh", checkOutTime = "12:00:00", isActive = false };
        Assert.Equal(HttpStatusCode.BadRequest, (await SendCreateAsync(session, "/api/admin/v1/catalog/properties", missingCheckIn, Guid.NewGuid())).StatusCode);

        var propertyBody = new { name = "New Sample Property", slug = "new-sample-property", description = (string?)null, address = "1 Sample Street", city = "Da Nang", country = "Vietnam", timeZone = "Asia/Ho_Chi_Minh", checkInTime = "14:00:00", checkOutTime = "12:00:00", isActive = false };
        var propertyKey = Guid.NewGuid();
        var createdProperty = await SendCreateAsync(session, "/api/admin/v1/catalog/properties", propertyBody, propertyKey);
        Assert.Equal(HttpStatusCode.OK, createdProperty.StatusCode);
        var propertyId = (await JsonAsync(createdProperty)).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await SendCreateAsync(session, "/api/admin/v1/catalog/properties", propertyBody, propertyKey)).StatusCode);
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "Properties" WHERE "Id" = '{propertyId}'"""));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "CatalogContentAudits" WHERE "PropertyId" = '{propertyId}' AND "Action" = 'create-property' AND "ActorStaffId" = '{await StaffIdAsync(Site)}'"""));
        var changedPropertyBody = new { name = "Changed Name", slug = propertyBody.slug, propertyBody.description, propertyBody.address, propertyBody.city, propertyBody.country, propertyBody.timeZone, propertyBody.checkInTime, propertyBody.checkOutTime, propertyBody.isActive };
        Assert.Equal(HttpStatusCode.Conflict, (await SendCreateAsync(session, "/api/admin/v1/catalog/properties", changedPropertyBody, propertyKey)).StatusCode);
        using (var noKey = Post("/api/admin/v1/catalog/properties", propertyBody, session.Cookie))
            Assert.Equal(HttpStatusCode.BadRequest, (await session.Client.SendAsync(noKey)).StatusCode);

        var roomBody = new { code = "NEW-ROOM", name = "New Sample Room", slug = "new-sample-room", description = (string?)null, baseOccupancy = 2, maxOccupancy = 3, areaSquareMeters = (decimal?)null, bedrooms = (int?)null, bedDescription = (string?)null, isActive = false };
        var roomKey = Guid.NewGuid();
        var createdType = await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types", roomBody, roomKey);
        Assert.Equal(HttpStatusCode.OK, createdType.StatusCode);
        var roomTypeId = (await JsonAsync(createdType)).GetProperty("roomTypeId").GetGuid();
        Assert.Equal(0, (await JsonAsync(await session.GetAsync($"/api/admin/v1/catalog/properties/{parentId}/products"))).EnumerateArray().Single(x => x.GetProperty("roomTypeId").GetGuid() == roomTypeId).GetProperty("physicalRoomCount").GetInt32());
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "CatalogContentAudits" WHERE "RoomTypeId" = '{roomTypeId}' AND "Action" = 'create-room-type'"""));
        Assert.Equal(HttpStatusCode.OK, (await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types", roomBody, roomKey)).StatusCode);
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "RoomTypes" WHERE "Id" = '{roomTypeId}'"""));
        var invalidRoomBody = new { code = "BAD-ROOM", name = roomBody.name, slug = "bad-room", roomBody.description, baseOccupancy = 3, maxOccupancy = 2, roomBody.areaSquareMeters, roomBody.bedrooms, roomBody.bedDescription, roomBody.isActive };
        Assert.Equal(HttpStatusCode.BadRequest, (await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types", invalidRoomBody, Guid.NewGuid())).StatusCode);

        var roomBody2 = new { code = "NEW-ROOM-2", name = "Second Sample Room", slug = "second-sample-room", roomBody.description, roomBody.baseOccupancy, roomBody.maxOccupancy, roomBody.areaSquareMeters, roomBody.bedrooms, roomBody.bedDescription, roomBody.isActive };
        var room2 = await JsonAsync(await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types", roomBody2, Guid.NewGuid()));
        var roomType2 = room2.GetProperty("roomTypeId").GetGuid();
        var physicalBody = new { roomNumber = "NEW-201", floor = -1, operationalStatus = "Inactive" };
        var missingFloor = new { roomNumber = "NEW-NO-FLOOR", operationalStatus = "Inactive" };
        Assert.Equal(HttpStatusCode.BadRequest, (await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types/{roomTypeId}/physical-rooms", missingFloor, Guid.NewGuid())).StatusCode);
        var physicalKey = Guid.NewGuid();
        var createdPhysical = await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types/{roomTypeId}/physical-rooms", physicalBody, physicalKey);
        Assert.Equal(HttpStatusCode.OK, createdPhysical.StatusCode);
        var physicalId = (await JsonAsync(createdPhysical)).GetProperty("id").GetGuid();
        var replay = await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types/{roomTypeId}/physical-rooms", physicalBody, physicalKey);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(physicalId, (await JsonAsync(replay)).GetProperty("id").GetGuid());
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "PhysicalRooms" WHERE "RoomNumber" = 'NEW-201'"""));
        Assert.Equal("Inactive", await ScalarAsync<string>($"""SELECT "OperationalStatus" FROM "PhysicalRooms" WHERE "Id" = '{physicalId}'"""));
        var physicalAudit = await ScalarAsync<string>($"""SELECT "After" FROM "CatalogContentAudits" WHERE "PropertyId" = '{parentId}' AND "RoomTypeId" = '{roomTypeId}' AND "Action" = 'create-physical-room'""");
        Assert.Equal(physicalId, JsonDocument.Parse(physicalAudit).RootElement.GetProperty("id").GetGuid());
        Assert.Equal(HttpStatusCode.Conflict, (await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types/{roomType2}/physical-rooms", physicalBody, Guid.NewGuid())).StatusCode);
        var mismatchedBody = new { roomNumber = "WRONG-PARENT", physicalBody.floor, physicalBody.operationalStatus };
        Assert.Equal(HttpStatusCode.NotFound, (await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms", mismatchedBody, Guid.NewGuid())).StatusCode);
        var listed = await JsonAsync(await session.GetAsync($"/api/admin/v1/catalog/properties/{parentId}/room-types/{roomTypeId}/physical-rooms"));
        var listedRoom = Assert.Single(listed.EnumerateArray());
        Assert.Equal(physicalId, listedRoom.GetProperty("id").GetGuid());
        Assert.Equal(-1, listedRoom.GetProperty("floor").GetInt32());
        foreach (var (number, status) in new[] { ("NEW-202", "Active"), ("NEW-203", "OutOfService") })
        {
            var response = await SendCreateAsync(session, $"/api/admin/v1/catalog/properties/{parentId}/room-types/{roomTypeId}/physical-rooms", new { roomNumber = number, floor = 2, operationalStatus = status }, Guid.NewGuid());
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        var allRooms = await JsonAsync(await session.GetAsync($"/api/admin/v1/catalog/properties/{parentId}/room-types/{roomTypeId}/physical-rooms"));
        Assert.Equal("Active", allRooms.EnumerateArray().Single(x => x.GetProperty("roomNumber").GetString() == "NEW-202").GetProperty("operationalStatus").GetString());
        Assert.Equal("OutOfService", allRooms.EnumerateArray().Single(x => x.GetProperty("roomNumber").GetString() == "NEW-203").GetProperty("operationalStatus").GetString());
        Assert.Equal(5, await ScalarAsync<int>($"""SELECT count(*) FROM "CatalogContentAudits" WHERE "PropertyId" = '{parentId}' AND "Action" IN ('create-room-type','create-physical-room')"""));
    }

    [Fact]
    public async Task Concurrent_replay_of_same_physical_room_operation_creates_one_room()
    {
        using var session = await StartAsync();
        var propertyId = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");
        var roomTypeId = Guid.NewGuid();
        await using (var context = Factory.CreateDbContext())
        {
            context.RoomTypes.Add(new RoomType(roomTypeId, propertyId, "RACE-ROOM", "Race Room", "race-room", null, 1, 2, false, DateTimeOffset.UtcNow));
            await context.SaveChangesAsync();
        }
        var operationId = Guid.NewGuid();
        var body = new { roomNumber = "RACE-01", floor = 0, operationalStatus = "Inactive" };
        var path = $"/api/admin/v1/catalog/properties/{propertyId}/room-types/{roomTypeId}/physical-rooms";
        var responses = await Task.WhenAll(SendCreateAsync(session, path, body, operationId), SendCreateAsync(session, path, body, operationId));
        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Equal((await JsonAsync(responses[0])).GetProperty("id").GetGuid(), (await JsonAsync(responses[1])).GetProperty("id").GetGuid());
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "PhysicalRooms" WHERE "PropertyId" = '{propertyId}' AND "RoomNumber" = 'RACE-01'"""));
    }

    private static Task<HttpResponseMessage> SendCreateAsync(Session session, string path, object body, Guid operationId)
    {
        var request = Post(path, body, session.Cookie);
        request.Headers.Add("Idempotency-Key", operationId.ToString());
        return session.Client.SendAsync(request);
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
