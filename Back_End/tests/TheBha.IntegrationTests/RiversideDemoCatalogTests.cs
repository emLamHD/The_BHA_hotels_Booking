using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using TheBha.Infrastructure.Persistence.Demo;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: the seeded catalog, the media manifest and the files Customer_Web
/// serves must be the same thing. A missing file, a changed byte or a published original whose
/// scan evidence is not "editor metadata present, no credentials, no generator marker" fails here — it
/// is never skipped. The evidence is a heuristic scan; no signature is validated.
/// </summary>
public sealed partial class RiversideDemoCatalogTests
{
    private static readonly string Root = FindRoot();
    private static readonly string MediaDirectory = Path.Combine(Root, "Front_End", "Customer_Web", "public", "media", "the-bha-riverside");
    private static readonly string ManifestPath = Path.Combine(Root, "Front_End", "Customer_Web", "scripts", "riverside-media", "manifest.json");

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*\\.webp$")]
    private static partial Regex StrictName();

    private static string FindRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "Front_End")) && Directory.Exists(Path.Combine(directory.FullName, "Back_End")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException("The repository root (Front_End and Back_End) was not found above " + AppContext.BaseDirectory);
    }

    private static JsonElement Manifest() => JsonDocument.Parse(File.ReadAllText(ManifestPath)).RootElement;

    [Fact]
    public void The_catalog_is_the_owner_stated_one()
    {
        Assert.Equal(["RIV-1BR", "RIV-1BR-OPEN", "RIV-2BR"], RiversideDemoCatalog.RoomTypes.Select(type => type.Code));
        Assert.Equal([3, 2, 6], RiversideDemoCatalog.RoomTypes.Select(type => type.Rooms));
        Assert.Equal(11, RiversideDemoCatalog.TotalRooms);
        Assert.Equal([2, 2, 4], RiversideDemoCatalog.RoomTypes.Select(type => type.MaxOccupancy));
        Assert.Equal([2, 2, 4], RiversideDemoCatalog.RoomTypes.Select(type => type.BaseOccupancy));
        Assert.Equal([1_000_000m, 1_100_000m, 1_600_000m], RiversideDemoCatalog.RoomTypes.Select(type => type.NightlyRate));
        Assert.Equal(3, RiversideDemoCatalog.RoomTypes.Select(type => type.Slug).Distinct().Count());
        Assert.Equal("VND", RiversideDemoCatalog.CurrencyCode);
        var numbers = RiversideDemoCatalog.RoomTypes
            .SelectMany(type => Enumerable.Range(1, type.Rooms).Select(ordinal => $"{type.RoomNumberPrefix}-{ordinal:00}")).ToList();
        Assert.Equal(11, numbers.Distinct().Count()); // every demo room number is distinct and none looks like a real unit
        Assert.All(numbers, number => Assert.StartsWith("DEMO-", number));
    }

    [Fact]
    public void Every_catalog_photo_equals_its_manifest_entry_and_its_file()
    {
        var manifest = Manifest();
        var published = manifest.GetProperty("published").EnumerateArray().ToList();
        Assert.Equal(RiversideDemoCatalog.Media.Count, published.Count);
        Assert.Equal(published.Count, manifest.GetProperty("originalsPublished").GetInt32());

        foreach (var (definition, entry) in RiversideDemoCatalog.Media.Zip(published))
        {
            Assert.Equal(definition.FileName, entry.GetProperty("derivative").GetString());
            Assert.Equal(definition.AltText, entry.GetProperty("altText").GetString());
            Assert.Equal(definition.SortOrder, entry.GetProperty("sortOrder").GetInt32());
            Assert.Equal(definition.IsCover, entry.GetProperty("isCover").GetBoolean());
            Assert.Equal(
                definition.OwnerType == RiversideMediaOwner.Property ? "property" : "room-type",
                entry.GetProperty("ownerType").GetString());
            Assert.Equal(definition.OwnerCode, entry.GetProperty("ownerCode").GetString());
            Assert.Matches(StrictName(), definition.FileName);

            var path = Path.Combine(MediaDirectory, definition.FileName);
            Assert.True(File.Exists(path), $"missing file {definition.FileName}");
            var bytes = File.ReadAllBytes(path);
            Assert.Equal(entry.GetProperty("bytes").GetInt64(), bytes.LongLength);
            Assert.Equal(entry.GetProperty("sha256").GetString(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
            Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4)); // a WebP container
            Assert.Equal("WEBP", System.Text.Encoding.ASCII.GetString(bytes, 8, 4));
            Assert.InRange(entry.GetProperty("width").GetInt32(), 1, 1600); // never larger than the bound, never upscaled
            Assert.InRange(entry.GetProperty("height").GetInt32(), 1, 1600);
        }
    }

    [Fact]
    public void Nothing_else_is_published_and_each_owner_has_one_cover()
    {
        var onDisk = Directory.GetFiles(MediaDirectory).Select(Path.GetFileName).OrderBy(name => name, StringComparer.Ordinal).ToList();
        Assert.Equal(RiversideDemoCatalog.Media.Select(item => item.FileName).OrderBy(name => name, StringComparer.Ordinal), onDisk!);
        Assert.False(Directory.GetDirectories(MediaDirectory).Any()); // no subfolders: the route policy serves one segment

        foreach (var owner in RiversideDemoCatalog.Media.GroupBy(item => (item.OwnerType, item.OwnerCode)))
        {
            Assert.Single(owner, item => item.IsCover);
            Assert.Equal(owner.Count(), owner.Select(item => item.SortOrder).Distinct().Count());
        }

        Assert.All(RiversideDemoCatalog.Media.Where(item => item.OwnerType == RiversideMediaOwner.RoomType),
            item => Assert.Contains(RiversideDemoCatalog.RoomTypes, type => type.Code == item.OwnerCode));
    }

    [Fact]
    public void Every_published_file_is_the_owners_selection_with_its_scan_evidence_recorded_and_no_original_twice()
    {
        var manifest = Manifest();
        var published = manifest.GetProperty("published").EnumerateArray().ToList();
        var excluded = manifest.GetProperty("excluded").EnumerateArray().ToList();

        Assert.Contains("NOT_RUN", manifest.GetProperty("evidenceLevel").GetString());
        Assert.Contains("UNVERIFIED", manifest.GetProperty("publicationPolicy").GetString());
        Assert.All(published, entry =>
        {
            // Publication is the Owner's decision; the scan result stays next to it, and provenance is never "verified".
            var evidence = entry.GetProperty("evidence");
            Assert.Equal("NOT_RUN", evidence.GetProperty("validation").GetString());
            Assert.Equal("UNVERIFIED", entry.GetProperty("provenanceStatus").GetString());
            Assert.StartsWith("owner-", entry.GetProperty("decision").GetString());
            if (evidence.GetProperty("classification").GetString() != "editor-metadata-present")
            {
                Assert.StartsWith("owner-authorized", entry.GetProperty("decision").GetString());
            }
        });

        // The same original is never published twice (an excluded file may be a duplicate of a published one:
        // the Owner filed the same picture in several folders).
        var publishedHashes = published.Select(entry => entry.GetProperty("sourceSha256").GetString()).ToList();
        Assert.Equal(publishedHashes.Count, publishedHashes.Distinct().Count());

        Assert.Equal(manifest.GetProperty("originalsAudited").GetInt32(), published.Count + excluded.Count);
        var byClassification = manifest.GetProperty("originalsByClassification");
        Assert.Equal(
            byClassification.EnumerateObject().Sum(item => item.Value.GetInt32()),
            manifest.GetProperty("originalsAudited").GetInt32());
    }

    [Fact]
    public void Every_room_type_has_an_interior_cover_and_at_least_five_pictures()
    {
        foreach (var type in RiversideDemoCatalog.RoomTypes)
        {
            var pictures = RiversideDemoCatalog.Media.Where(item => item.OwnerType == RiversideMediaOwner.RoomType && item.OwnerCode == type.Code).ToList();
            Assert.True(pictures.Count >= 5, $"{type.Code} has {pictures.Count} pictures");
            var cover = Assert.Single(pictures, item => item.IsCover);
            // the cover is an interior picture, not the skyline or balcony view the 2BR type started with
            Assert.DoesNotContain("balcony", cover.FileName);
            Assert.DoesNotContain("skyline", cover.FileName);
        }
    }

    [Fact]
    public void Earlier_media_ids_and_files_keep_their_position_when_pictures_are_appended()
    {
        // The first 13 definitions are the CP02 seed; their ids are derived from their position.
        var first = RiversideDemoCatalog.Media.Take(13).ToList();
        Assert.Equal(
            ["entrance-logo.webp", "rooftop-pool-day.webp", "rooftop-pool-night.webp", "rooftop-pool-seating.webp", "rooftop-pool-city-view.webp",
             "rooftop-pool-mural.webp", "lobby-sofa.webp", "lobby-logo-clocks.webp", "lobby-shelves.webp", "entrance-chairs.webp",
             "two-bedroom-balcony-view.webp", "two-bedroom-skyline-1.webp", "two-bedroom-skyline-2.webp"],
            first.Select(item => item.FileName));
        Assert.Equal(Guid.Parse("a5000000-0000-0000-0000-000000000011"), first[10].Id);
        Assert.Equal(Guid.Parse("a5000000-0000-0000-0000-000000000013"), first[12].Id);
        Assert.Equal(RiversideDemoCatalog.Media.Count, RiversideDemoCatalog.Media.Select(item => item.Id).Distinct().Count());
    }

    [Fact]
    public void The_link_migrations_are_exactly_the_old_2BR_cover_and_order_moving_behind_the_interior_cover()
    {
        Assert.Equal(4, RiversideDemoCatalog.LinkMigrations.Count);
        Assert.All(RiversideDemoCatalog.LinkMigrations, migration => Assert.Equal("RIV-2BR", migration.RoomTypeCode));
        var byFile = RiversideDemoCatalog.LinkMigrations.ToDictionary(item => item.FileName);
        Assert.Equal((0, true, 6, false), (byFile["two-bedroom-balcony-view.webp"].FromSortOrder, byFile["two-bedroom-balcony-view.webp"].FromIsCover, byFile["two-bedroom-balcony-view.webp"].ToSortOrder, byFile["two-bedroom-balcony-view.webp"].ToIsCover));
        Assert.True(byFile["two-bedroom-living.webp"].ToIsCover);
        // Each migration's target equals what the catalog now defines for that picture (so a fresh seed needs none).
        foreach (var migration in RiversideDemoCatalog.LinkMigrations)
        {
            var definition = RiversideDemoCatalog.Media.Single(item => item.FileName == migration.FileName);
            Assert.Equal((definition.SortOrder, definition.IsCover), (migration.ToSortOrder, migration.ToIsCover));
        }
    }
}
