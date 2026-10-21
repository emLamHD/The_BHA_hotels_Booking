using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Application.Properties;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class AdminCatalogFailureTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private static string Route(Guid p, Guid? r = null) => $"/api/admin/v1/catalog/properties/{p}" + (r is null ? "" : $"/room-types/{r}");
    private static SaveCatalogContent Body(CatalogEditorDto dto, IReadOnlyList<CatalogGalleryInput>? images = null, IReadOnlyList<Guid>? amenities = null) =>
        new(dto.Version, dto.Name, dto.Description, dto.Address, dto.City, dto.Country, dto.AreaSquareMeters, dto.Bedrooms, dto.BedDescription,
            images ?? dto.Gallery.Select(x => new CatalogGalleryInput(x.MediaId, x.AltText, x.IsCover)).ToArray(), amenities ?? dto.AmenityIds);
    private static async Task<CatalogEditorDto> ReadAsync(Session session, string route)
    {
        var response = await session.GetAsync(route);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonSerializer.Deserialize<CatalogEditorDto>(await response.Content.ReadAsStringAsync(), Json)!;
    }
    private static HttpRequestMessage Upload(string route, string? cookie = null, string origin = AdminOrigin, byte[]? bytes = null)
    {
        var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(bytes ?? File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "catalog", "valid.webp"))), "file", "image.webp");
        var request = new HttpRequestMessage(HttpMethod.Post, route + "/media") { Content = form };
        request.Headers.Add("Origin", origin);
        if (cookie is not null) request.Headers.Add("Cookie", cookie);
        return request;
    }
    private async Task<Guid> PropertyAsync() => await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" WHERE "Slug" = 'website-cp02'""");

    [Fact]
    public async Task Link_alt_order_cover_and_unlink_keep_other_property_and_room_owners_and_global_records_intact()
    {
        using var session = await StartAsync();
        var p = await PropertyAsync(); var q = Guid.NewGuid(); var r = Guid.NewGuid(); var s = Guid.NewGuid(); var m = Guid.NewGuid(); var n = Guid.NewGuid(); var a = Guid.NewGuid();
        await using (var db = Factory.CreateDbContext())
        {
            var now = DateTimeOffset.UtcNow;
            db.Properties.Add(new Property(q, "Other", "other", null, "Other address", "City", "Country", "UTC", new(14, 0), new(12, 0), true, now));
            db.RoomTypes.AddRange(new RoomType(r, p, "R1", "Room1", "room1", null, 2, 4, true, now), new RoomType(s, q, "R2", "Room2", "room2", null, 2, 4, true, now));
            db.Media.AddRange(new Media(m, "https://example.test/one.webp", "Global alt", MediaType.Image, now), new Media(n, "https://example.test/two.webp", "Second", MediaType.Image, now));
            db.Amenities.Add(new Amenity(a, "SHARED", "Shared", "Room", true));
            db.PropertyMedia.AddRange(new PropertyMedia(p, m, 0, true), new PropertyMedia(q, m, 0, true));
            db.RoomTypeMedia.AddRange(new RoomTypeMedia(r, m, 0, true), new RoomTypeMedia(r, n, 1, false), new RoomTypeMedia(s, m, 0, true));
            db.PropertyAmenities.AddRange(new PropertyAmenity(p, a), new PropertyAmenity(q, a));
            db.RoomTypeAmenities.AddRange(new RoomTypeAmenity(r, a), new RoomTypeAmenity(s, a));
            await db.SaveChangesAsync();
        }
        var otherP = await ReadAsync(session, Route(q)); var otherR = await ReadAsync(session, Route(q, s));
        var ownRoom = await ReadAsync(session, Route(p, r));
        Assert.Equal(HttpStatusCode.OK, (await session.PostAsync(Route(p, r) + "/save", Body(ownRoom, [new(n, "Room alt", true), new(m, "Own alt", false)]))).StatusCode);
        ownRoom = await ReadAsync(session, Route(p, r));
        Assert.Equal(new[] { n, m }, ownRoom.Gallery.Select(x => x.MediaId));
        Assert.Equal("Room alt", ownRoom.Gallery[0].AltText); Assert.True(ownRoom.Gallery[0].IsCover);
        Assert.Equal(HttpStatusCode.OK, (await session.PostAsync(Route(p, r) + "/save", Body(ownRoom, [], []))).StatusCode);
        var ownProperty = await ReadAsync(session, Route(p));
        Assert.Equal(HttpStatusCode.OK, (await session.PostAsync(Route(p) + "/save", Body(ownProperty, [], []))).StatusCode);
        Assert.Empty((await ReadAsync(session, Route(p))).Gallery); Assert.Empty((await ReadAsync(session, Route(p, r))).AmenityIds);
        Assert.Equal(JsonSerializer.Serialize(otherP), JsonSerializer.Serialize(await ReadAsync(session, Route(q))));
        Assert.Equal(JsonSerializer.Serialize(otherR), JsonSerializer.Serialize(await ReadAsync(session, Route(q, s))));
        Assert.Equal("Global alt", await ScalarAsync<string>($"""SELECT "AltText" FROM "Media" WHERE "Id" = '{m}'"""));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "Media" """));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "Amenities" WHERE "Id" = '{a}'"""));
    }

    [Fact]
    public async Task Missing_file_blocks_gallery_save_without_changing_version_and_unlink_never_deletes_recorded_bytes()
    {
        using var session = await StartAsync(); var p = await PropertyAsync(); var route = Route(p);
        var uploaded = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Upload(route, session.Cookie))));
        var id = uploaded.GetProperty("mediaId").GetGuid();
        var key = await ScalarAsync<string>($"""SELECT "StorageKey" FROM "CatalogUploads" WHERE "MediaId" = '{id}'""");
        var path = Path.Combine(Factory.MediaRoot, key); var hidden = path + ".unavailable";
        File.Move(path, hidden);
        try
        {
            var dto = await ReadAsync(session, route);
            var saved = await session.PostAsync(route + "/save", Body(dto, [new(id, "New", true)]));
            Assert.Equal(HttpStatusCode.Conflict, saved.StatusCode);
            var after = await ReadAsync(session, route); Assert.Equal(dto.Version, after.Version); Assert.Empty(after.Gallery);
        }
        finally { File.Move(hidden, path); }
        var current = await ReadAsync(session, route);
        Assert.Equal(HttpStatusCode.OK, (await session.PostAsync(route + "/save", Body(current, [new(id, "New", true)]))).StatusCode);
        current = await ReadAsync(session, route);
        Assert.Equal(HttpStatusCode.OK, (await session.PostAsync(route + "/save", Body(current, []))).StatusCode);
        Assert.True(File.Exists(path)); Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "CatalogUploads" WHERE "MediaId" = '{id}'"""));
    }

    [Fact]
    public async Task Actual_storage_write_failure_creates_no_media_metadata_or_gallery()
    {
        var blockedRoot = Factory.MediaRoot + "-blocked";
        await File.WriteAllTextAsync(blockedRoot, "Existing canary");
        try
        {
            using var host = CreateHost().WithWebHostBuilder(b => b.UseSetting("WebsiteMedia:RootPath", blockedRoot));
            var p = await SeedStaffAsync(host); using var client = CreateHttpsClient(host); var cookie = await LoginAsync(client, Site);
            Assert.Equal(HttpStatusCode.InternalServerError, (await client.SendAsync(Upload(Route(p), cookie))).StatusCode);
            Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "CatalogUploads" """));
            Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "Media" """));
            Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "PropertyMedia" """));
            Assert.Equal("Existing canary", await File.ReadAllTextAsync(blockedRoot));
        }
        finally { File.Delete(blockedRoot); }
    }

    [Fact]
    public async Task Db_rejection_after_file_write_cleans_only_the_unrecorded_upload()
    {
        using var session = await StartAsync(); var p = await PropertyAsync(); var route = Route(p);
        await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Upload(route, session.Cookie)));
        var beforeFiles = Directory.GetFiles(Path.Combine(Factory.MediaRoot, "catalog")).Order().ToArray();
        await ExecuteAsync("""
            CREATE FUNCTION catalog_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected catalog metadata failure'; END $$;
            CREATE TRIGGER catalog_test_reject BEFORE INSERT ON "CatalogUploads" FOR EACH ROW EXECUTE FUNCTION catalog_test_reject();
            """);
        try
        {
            Assert.Equal(HttpStatusCode.InternalServerError, (await session.Client.SendAsync(Upload(route, session.Cookie))).StatusCode);
            Assert.Equal(beforeFiles, Directory.GetFiles(Path.Combine(Factory.MediaRoot, "catalog")).Order().ToArray());
            Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "CatalogUploads" """));
            Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "Media" """));
            Assert.Empty((await ReadAsync(session, route)).Gallery);
        }
        finally { await ExecuteAsync("""DROP TRIGGER catalog_test_reject ON "CatalogUploads"; DROP FUNCTION catalog_test_reject();"""); }
    }

    [Fact]
    public async Task A_lost_ack_after_a_committed_upload_must_not_delete_its_file()
    {
        using var host = CreateHost().WithWebHostBuilder(b => b.ConfigureTestServices(services =>
            services.AddScoped(_ => new TheBhaDbContext(new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(new LostUploadAcknowledgement()).Options))));
        var p = await SeedStaffAsync(host); using var client = CreateHttpsClient(host); var cookie = await LoginAsync(client, Site);
        Assert.Equal(HttpStatusCode.InternalServerError, (await client.SendAsync(Upload(Route(p), cookie))).StatusCode);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "CatalogUploads" """));
        var id = await ScalarAsync<Guid>("""SELECT "MediaId" FROM "CatalogUploads" """);
        var key = await ScalarAsync<string>("""SELECT "StorageKey" FROM "CatalogUploads" """);
        Assert.True(File.Exists(Path.Combine(Factory.MediaRoot, key)), "A committed upload must retain its bytes despite a lost acknowledgement.");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get(Route(p) + $"/media/{id}", cookie))).StatusCode);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "PropertyMedia" """));
    }
    private sealed class LostUploadAcknowledgement : SaveChangesInterceptor
    {
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<CatalogUpload>().Any()) throw new IOException("Injected lost acknowledgement after the real PostgreSQL commit.");
            return ValueTask.FromResult(result);
        }
    }

    [Fact]
    public async Task Catalog_boundaries_reject_bad_origin_localgate_disable_and_revoke_including_preview_and_upload()
    {
        using var session = await StartAsync(); var p = await PropertyAsync(); var route = Route(p);
        var body = Body(await ReadAsync(session, route));
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(Post(route + "/save", body, session.Cookie, ["https://wrong.example"])) ).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(Upload(route, session.Cookie, "https://wrong.example"))).StatusCode);
        await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Upload(route, session.Cookie)));
        var mediaId = await ScalarAsync<Guid>("""SELECT "MediaId" FROM "CatalogUploads" """);
        await CliAsync(session.Host, ["--staff-website-access", "--email", Site, "--enabled", "false"]);
        foreach (var path in new[] { route, route + $"/media/{mediaId}" }) Assert.Equal(HttpStatusCode.Forbidden, (await session.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.Client.SendAsync(Upload(route, session.Cookie))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await session.PostAsync(route + "/save", body)).StatusCode);
        await CliAsync(session.Host, ["--staff-website-access", "--email", Site, "--enabled", "true"]);
        await CliAsync(session.Host, ["--staff-disable", "--email", Site]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.GetAsync(route + $"/media/{mediaId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.Client.SendAsync(Upload(route, session.Cookie))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.PostAsync(route + "/save", body)).StatusCode);
        using var local = CreateHost(AdminCalendarAccessMode.LocalGate); using var client = CreateHttpsClient(local);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get(route))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get(route + $"/media/{mediaId}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Post(route + "/save", body))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Upload(route))).StatusCode);
    }
}
