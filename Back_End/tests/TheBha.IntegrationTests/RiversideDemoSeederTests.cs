using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Demo;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: the Riverside demo seeder against real PostgreSQL — fresh seed,
/// dry run, rerun, window extension, operator edits that must survive, conflicts, rollback and
/// the date rule, then the catalog read back through the real availability API.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class RiversideDemoSeederTests(PostgreSqlWebApplicationFactory factory)
{
    private const string Origin = "https://demo.example.test:3000";
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-06T03:00:00Z"); // 10:00 in Ho Chi Minh City
    private static readonly DateOnly From = new(2026, 10, 7);

    private static RiversideSeedOptions Options(int days = 14, DateOnly? from = null)
    {
        Assert.True(RiversideSeedOptions.TryCreate(Origin, from ?? From, days, out var options, out var error), error);
        return options!;
    }

    private async Task<RiversideSeedPlan> ApplyAsync(RiversideSeedOptions options)
    {
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        return await new RiversideDemoSeeder(context, factory.Clock).ApplyAsync(options, CancellationToken.None);
    }

    private async Task<RiversideSeedPlan> PlanAsync(RiversideSeedOptions options)
    {
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        return await new RiversideDemoSeeder(context, factory.Clock).PlanAsync(options, CancellationToken.None);
    }

    private async Task<string> SnapshotAsync()
    {
        await using var context = factory.CreateDbContext();
        var builder = new StringBuilder();
        foreach (var row in await context.Properties.AsNoTracking().OrderBy(x => x.Id).ToListAsync())
            builder.Append($"P|{row.Id}|{row.Name}|{row.Description}|{row.IsActive}|{row.UpdatedAt:O}\n");
        foreach (var row in await context.RoomTypes.AsNoTracking().OrderBy(x => x.Id).ToListAsync())
            builder.Append($"T|{row.Id}|{row.Code}|{row.Name}|{row.Description}|{row.IsActive}|{row.MaxOccupancy}\n");
        foreach (var row in await context.PhysicalRooms.AsNoTracking().OrderBy(x => x.Id).ToListAsync())
            builder.Append($"R|{row.Id}|{row.RoomNumber}|{row.RoomTypeId}|{row.OperationalStatus}|{row.Floor}\n");
        foreach (var row in await context.RatePlans.AsNoTracking().OrderBy(x => x.Id).ToListAsync())
            builder.Append($"RP|{row.Id}|{row.Code}|{row.IsActive}|{row.CurrencyCode}\n");
        foreach (var row in await context.DailyRoomRates.AsNoTracking().OrderBy(x => x.Id).ToListAsync())
            builder.Append($"D|{row.Id}|{row.RoomTypeId}|{row.StayDate:O}|{row.Amount}\n");
        foreach (var row in await context.Amenities.AsNoTracking().OrderBy(x => x.Id).ToListAsync())
            builder.Append($"A|{row.Id}|{row.Code}|{row.Name}\n");
        foreach (var row in await context.Media.AsNoTracking().OrderBy(x => x.Id).ToListAsync())
            builder.Append($"M|{row.Id}|{row.Url}|{row.AltText}\n");
        foreach (var row in await context.PropertyMedia.AsNoTracking().OrderBy(x => x.MediaId).ToListAsync())
            builder.Append($"PM|{row.PropertyId}|{row.MediaId}|{row.SortOrder}|{row.IsCover}\n");
        foreach (var row in await context.RoomTypeMedia.AsNoTracking().OrderBy(x => x.MediaId).ToListAsync())
            builder.Append($"TM|{row.RoomTypeId}|{row.MediaId}|{row.SortOrder}|{row.IsCover}\n");
        foreach (var row in await context.PropertyAmenities.AsNoTracking().OrderBy(x => x.AmenityId).ToListAsync())
            builder.Append($"PA|{row.PropertyId}|{row.AmenityId}\n");
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())));
    }

    private async Task<int> TotalRowsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.Properties.CountAsync() + await context.RoomTypes.CountAsync() +
               await context.PhysicalRooms.CountAsync() + await context.RatePlans.CountAsync() +
               await context.DailyRoomRates.CountAsync() + await context.Amenities.CountAsync() +
               await context.Media.CountAsync() + await context.PropertyMedia.CountAsync() +
               await context.RoomTypeMedia.CountAsync() + await context.PropertyAmenities.CountAsync();
    }

    [Fact]
    public async Task Fresh_apply_creates_exactly_the_owner_catalog_and_nothing_from_the_old_seed()
    {
        await factory.ResetDatabaseAsync();
        var plan = await ApplyAsync(Options(14));

        Assert.True(plan.Applied);
        Assert.False(plan.HasConflicts);
        await using var context = factory.CreateDbContext();

        var property = await context.Properties.AsNoTracking().SingleAsync();
        Assert.Equal("the-bha-riverside", property.Slug);
        Assert.Equal("The BHA Riverside", property.Name);
        Assert.Equal("Asia/Ho_Chi_Minh", property.TimeZone);
        Assert.Equal(RiversideDemoCatalog.PendingAddress, property.Address); // not invented
        Assert.Equal(RiversideDemoCatalog.PendingCity, property.City);
        Assert.Equal(new TimeOnly(14, 0), property.CheckInTime);
        Assert.False(await context.Properties.AnyAsync(item => item.Slug == "the-bha-hotel"));

        var types = await context.RoomTypes.AsNoTracking().OrderBy(item => item.Code).ToListAsync();
        Assert.Equal(["RIV-1BR", "RIV-1BR-OPEN", "RIV-2BR"], types.Select(item => item.Code));
        Assert.Equal(
            [("Căn hộ một phòng ngủ", 2, 2), ("Căn hộ một phòng ngủ view thoáng", 2, 2), ("Căn hộ hai phòng ngủ", 4, 4)],
            types.Select(item => (item.Name, item.BaseOccupancy, item.MaxOccupancy)));
        Assert.Equal(3, types.Select(item => item.Slug).Distinct().Count());

        var rooms = await context.PhysicalRooms.AsNoTracking().ToListAsync();
        Assert.Equal(11, rooms.Count);
        Assert.All(rooms, room => Assert.Equal(OperationalStatus.Active, room.OperationalStatus));
        Assert.All(rooms, room => Assert.StartsWith("DEMO-", room.RoomNumber)); // not presented as real numbers
        var byType = rooms.GroupBy(room => types.Single(type => type.Id == room.RoomTypeId).Code).ToDictionary(group => group.Key, group => group.Count());
        Assert.Equal(new Dictionary<string, int> { ["RIV-1BR"] = 3, ["RIV-1BR-OPEN"] = 2, ["RIV-2BR"] = 6 }, byType);

        var ratePlan = await context.RatePlans.AsNoTracking().SingleAsync();
        Assert.Equal("VND", ratePlan.CurrencyCode);
        var rates = await context.DailyRoomRates.AsNoTracking().ToListAsync();
        Assert.Equal(3 * 14, rates.Count);
        foreach (var (code, price) in new[] { ("RIV-1BR", 1_000_000m), ("RIV-1BR-OPEN", 1_100_000m), ("RIV-2BR", 1_600_000m) })
        {
            var typeId = types.Single(item => item.Code == code).Id;
            var nights = rates.Where(item => item.RoomTypeId == typeId).OrderBy(item => item.StayDate).ToList();
            Assert.Equal(14, nights.Count);
            Assert.All(nights, item => Assert.Equal(price, item.Amount));
            Assert.Equal(Enumerable.Range(0, 14).Select(offset => From.AddDays(offset)), nights.Select(item => item.StayDate));
        }

        Assert.Empty(await context.DailyInventoryControls.ToListAsync()); // no demo stop-sell or sellable limit
        Assert.Equal(["RIV-POOL", "RIV-ROOFTOP"], (await context.Amenities.AsNoTracking().OrderBy(item => item.Code).ToListAsync()).Select(item => item.Code));
        Assert.Equal(2, await context.PropertyAmenities.CountAsync());
        Assert.Empty(await context.RoomTypeAmenities.ToListAsync()); // no per-room amenity is claimed

        var media = await context.Media.AsNoTracking().ToListAsync();
        Assert.Equal(RiversideDemoCatalog.Media.Count, media.Count);
        Assert.All(media, item => Assert.StartsWith(Origin + "/media/the-bha-riverside/", item.Url));
        Assert.All(media, item => Assert.EndsWith(".webp", item.Url));
        var propertyLinks = await context.PropertyMedia.AsNoTracking().ToListAsync();
        Assert.Equal(10, propertyLinks.Count);
        var propertyCover = Assert.Single(propertyLinks, link => link.IsCover);
        Assert.EndsWith("/entrance-logo.webp", media.Single(item => item.Id == propertyCover.MediaId).Url);
        var typeLinks = await context.RoomTypeMedia.AsNoTracking().ToListAsync();
        Assert.Equal(RiversideDemoCatalog.Media.Count - 10, typeLinks.Count); // every room type picture; the other ten belong to the property
        foreach (var type in types)
        {
            var links = typeLinks.Where(link => link.RoomTypeId == type.Id).ToList();
            Assert.True(links.Count >= 5, $"{type.Code} has {links.Count} pictures");
            var cover = Assert.Single(links, link => link.IsCover);
            Assert.DoesNotContain("balcony", media.Single(item => item.Id == cover.MediaId).Url);
        }

        Assert.EndsWith("/two-bedroom-living.webp", media.Single(item => item.Id == Assert.Single(typeLinks, link => link.IsCover && link.RoomTypeId == types.Single(item => item.Code == "RIV-2BR").Id).MediaId).Url);
    }

    [Fact]
    public async Task Dry_run_reports_the_plan_and_writes_nothing()
    {
        await factory.ResetDatabaseAsync();
        var before = await SnapshotAsync();

        var plan = await PlanAsync(Options(14));

        Assert.False(plan.Applied);
        Assert.False(plan.HasConflicts);
        Assert.False(plan.PropertyExists);
        // property 1, amenities 2, room types 3, rate plan 1, rooms 11, rates 3x14, every picture and its link, 2 amenity links;
        // a fresh database needs no link migration
        var media = RiversideDemoCatalog.Media.Count;
        Assert.Equal(1 + 2 + 3 + 1 + 11 + 42 + media + media + 2, plan.TotalInserts);
        Assert.Equal(0, plan.Tables.Single(table => table.Table == "Link order/cover migrations").ToInsert);
        Assert.Equal(0, await TotalRowsAsync());
        Assert.Equal(before, await SnapshotAsync());
    }

    [Fact]
    public async Task Rerun_with_the_same_options_inserts_nothing_and_changes_nothing()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(14));
        var rows = await TotalRowsAsync();
        var snapshot = await SnapshotAsync();

        var again = await ApplyAsync(Options(14));

        Assert.True(again.Applied);
        Assert.Equal(0, again.TotalInserts);
        Assert.Empty(again.Warnings);
        // The report counts every link the first run staged (every photograph + 2 amenities) as existing.
        Assert.Equal(RiversideDemoCatalog.Media.Count + 2, again.Tables.Single(table => table.Table == "Property/RoomType/Amenity links").Existing);
        Assert.Equal(rows, await TotalRowsAsync());
        Assert.Equal(snapshot, await SnapshotAsync());
        Assert.Equal(0, (await PlanAsync(Options(14))).TotalInserts);
    }

    [Fact]
    public async Task Extending_the_window_adds_only_the_missing_nights()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(14));
        await using var before = factory.CreateDbContext();
        var originalIds = await before.DailyRoomRates.AsNoTracking().Select(item => item.Id).ToListAsync();
        var rowsBefore = await TotalRowsAsync();

        var plan = await ApplyAsync(Options(30));

        Assert.Equal(3 * 16, plan.TotalInserts);
        Assert.Equal(rowsBefore + 48, await TotalRowsAsync());
        await using var after = factory.CreateDbContext();
        var ids = await after.DailyRoomRates.AsNoTracking().Select(item => item.Id).ToListAsync();
        Assert.Equal(3 * 30, ids.Count);
        Assert.Empty(originalIds.Except(ids)); // the first 42 rows are the same rows
    }

    [Fact]
    public async Task Operator_edits_survive_a_rerun_and_are_never_duplicated_or_reverted()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(14));
        Guid editedRateId, otherCoverMediaId = Guid.NewGuid();
        await using (var edit = factory.CreateDbContext())
        {
            var property = await edit.Properties.SingleAsync();
            var type = await edit.RoomTypes.SingleAsync(item => item.Code == "RIV-1BR");
            var rate = await edit.DailyRoomRates.FirstAsync(item => item.RoomTypeId == type.Id);
            editedRateId = rate.Id;
            await edit.Database.ExecuteSqlRawAsync("UPDATE \"Properties\" SET \"Name\" = 'The BHA Riverside (edited)', \"Description\" = 'edited by an operator', \"City\" = 'Da Nang'");
            await edit.Database.ExecuteSqlRawAsync("UPDATE \"RoomTypes\" SET \"Description\" = 'edited type' WHERE \"Code\" = 'RIV-1BR'");
            await edit.Database.ExecuteSqlAsync($"UPDATE \"DailyRoomRates\" SET \"Amount\" = 1234567 WHERE \"Id\" = {rate.Id}");
            await edit.Database.ExecuteSqlRawAsync("UPDATE \"PhysicalRooms\" SET \"OperationalStatus\" = 'Inactive' WHERE \"RoomNumber\" = 'DEMO-1BR-02'");
            await edit.Database.ExecuteSqlRawAsync("UPDATE \"RatePlans\" SET \"IsActive\" = false");
            // the operator makes their own photograph the cover and demotes ours
            edit.Media.Add(new Media(otherCoverMediaId, "https://operator.example.test/own.webp", "own", MediaType.Image, Now));
            await edit.SaveChangesAsync();
            await edit.Database.ExecuteSqlRawAsync("UPDATE \"PropertyMedia\" SET \"IsCover\" = false");
            edit.PropertyMedia.Add(new PropertyMedia(property.Id, otherCoverMediaId, 99, true));
            await edit.SaveChangesAsync();
        }

        var rows = await TotalRowsAsync();
        var snapshot = await SnapshotAsync();
        var again = await ApplyAsync(Options(14));

        Assert.Equal(0, again.TotalInserts);
        Assert.Equal(rows, await TotalRowsAsync());
        Assert.Equal(snapshot, await SnapshotAsync()); // every edit intact, nothing re-created or reverted
        Assert.Contains(again.Warnings, text => text.Contains("DEMO-1BR-02") && text.Contains("not reactivated"));
        Assert.Contains(again.Warnings, text => text.Contains("inactive"));
        await using var check = factory.CreateDbContext();
        Assert.Equal(1_234_567m, (await check.DailyRoomRates.SingleAsync(item => item.Id == editedRateId)).Amount);
        Assert.Equal("The BHA Riverside (edited)", (await check.Properties.SingleAsync()).Name);
        Assert.Equal(1, await check.PropertyMedia.CountAsync(link => link.IsCover));
        Assert.Equal(11, await check.PhysicalRooms.CountAsync());
    }

    [Fact]
    public async Task An_existing_cover_is_never_made_a_second_cover()
    {
        await factory.ResetDatabaseAsync();
        var propertyId = Guid.NewGuid();
        await using (var setup = factory.CreateDbContext())
        {
            var mediaId = Guid.NewGuid();
            setup.Properties.Add(new Property(propertyId, "The BHA Riverside", "the-bha-riverside", null, "a", "c", "Vietnam",
                "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now));
            setup.Media.Add(new Media(mediaId, "https://operator.example.test/cover.webp", "cover", MediaType.Image, Now));
            await setup.SaveChangesAsync();
            setup.PropertyMedia.Add(new PropertyMedia(propertyId, mediaId, 0, true));
            await setup.SaveChangesAsync();
        }

        var plan = await ApplyAsync(Options(7));

        Assert.True(plan.Applied);
        Assert.Contains(plan.Warnings, text => text.Contains("already has a cover"));
        await using var check = factory.CreateDbContext();
        Assert.Equal(1, await check.PropertyMedia.CountAsync(link => link.IsCover));
        Assert.Equal(11, await check.PropertyMedia.CountAsync()); // the operator's link plus our ten
        Assert.Equal(propertyId, (await check.Properties.SingleAsync()).Id); // the existing property was reused
    }

    [Fact]
    public async Task A_conflict_stops_the_run_before_any_write()
    {
        await factory.ResetDatabaseAsync();
        var propertyId = Guid.NewGuid();
        await using (var setup = factory.CreateDbContext())
        {
            var other = new RoomType(Guid.NewGuid(), propertyId, "OTHER", "Other", "other", null, 2, 2, true, Now);
            var squatter = new RoomType(Guid.NewGuid(), propertyId, "SQUAT", "Squat", "can-ho-hai-phong-ngu", null, 2, 2, true, Now); // takes a slug
            setup.Properties.Add(new Property(propertyId, "The BHA Riverside", "the-bha-riverside", null, "a", "c", "Vietnam",
                "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now));
            await setup.SaveChangesAsync();
            setup.RoomTypes.AddRange(other, squatter);
            await setup.SaveChangesAsync();
            setup.PhysicalRooms.Add(new PhysicalRoom(Guid.NewGuid(), propertyId, other, "DEMO-1BR-01", 3, OperationalStatus.Active, Now)); // demo number, wrong type
            await setup.SaveChangesAsync();
        }

        var rows = await TotalRowsAsync();
        var snapshot = await SnapshotAsync();
        var dry = await PlanAsync(Options(14));
        var apply = await ApplyAsync(Options(14));

        foreach (var plan in new[] { dry, apply })
        {
            Assert.True(plan.HasConflicts);
            Assert.False(plan.Applied);
            Assert.Contains(plan.Conflicts, text => text.Contains("slug 'can-ho-hai-phong-ngu'"));
            Assert.Contains(plan.Conflicts, text => text.Contains("DEMO-1BR-01") && text.Contains("another room type"));
        }

        Assert.Equal(rows, await TotalRowsAsync());
        Assert.Equal(snapshot, await SnapshotAsync()); // no duplicate room was created to force 3 / 2 / 6
    }

    [Fact]
    public async Task A_failure_in_the_middle_of_apply_rolls_everything_back()
    {
        await factory.ResetDatabaseAsync();
        await using (var install = factory.CreateDbContext())
        {
            await install.Database.ExecuteSqlRawAsync(
                """
                CREATE FUNCTION riverside_probe_fail() RETURNS trigger LANGUAGE plpgsql AS
                    $$ BEGIN RAISE EXCEPTION 'probe: rate insert refused'; END $$;
                CREATE TRIGGER riverside_probe_fail BEFORE INSERT ON "DailyRoomRates"
                    FOR EACH ROW EXECUTE FUNCTION riverside_probe_fail();
                """);
        }

        try
        {
            await Assert.ThrowsAnyAsync<Exception>(() => ApplyAsync(Options(14)));
            Assert.Equal(0, await TotalRowsAsync()); // the property, types, rooms and media saved before the failure are gone
        }
        finally
        {
            await using var remove = factory.CreateDbContext();
            await remove.Database.ExecuteSqlRawAsync(
                "DROP TRIGGER IF EXISTS riverside_probe_fail ON \"DailyRoomRates\"; DROP FUNCTION IF EXISTS riverside_probe_fail();");
        }
    }

    [Theory]
    [InlineData("2026-10-05T03:00:00Z", "2026-10-05", false)] // 10:00 on the 5th in Ho Chi Minh City: today is allowed
    [InlineData("2026-10-05T03:00:00Z", "2026-10-04", true)] // ...yesterday is the past
    [InlineData("2026-10-05T18:00:00Z", "2026-10-06", false)] // 01:00 on the 6th there, though still the 5th in UTC
    [InlineData("2026-10-05T18:00:00Z", "2026-10-05", true)] // the 5th is already past locally
    public async Task Only_future_nights_by_the_property_local_date_are_accepted(string utcNow, string from, bool refused)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = DateTimeOffset.Parse(utcNow);
        await using var context = factory.CreateDbContext();
        var seeder = new RiversideDemoSeeder(context, factory.Clock);
        var options = Options(7, DateOnly.Parse(from));

        if (refused)
        {
            await Assert.ThrowsAsync<RiversideSeedValidationException>(() => seeder.ApplyAsync(options, CancellationToken.None));
            Assert.Equal(0, await TotalRowsAsync());
        }
        else
        {
            Assert.True((await seeder.ApplyAsync(options, CancellationToken.None)).Applied);
        }
    }

    [Theory]
    [InlineData("https://demo.example.test", true)]
    [InlineData("https://demo.example.test/", true)]
    [InlineData("https://127.0.0.1:3000", true)]
    [InlineData("http://demo.example.test", false)] // https only
    [InlineData("https://demo.example.test/media", false)] // origin only
    [InlineData("https://user:pw@demo.example.test", false)]
    [InlineData("https://demo.example.test/?x=1", false)]
    [InlineData("https://demo.example.test/#x", false)]
    [InlineData("demo.example.test", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Media_base_url_must_be_an_https_origin(string? url, bool valid)
    {
        Assert.Equal(valid, RiversideSeedOptions.TryCreate(url, From, 30, out var options, out _));
        if (valid)
        {
            Assert.DoesNotContain("/", options!.MediaOrigin[8..]); // normalized: no trailing slash
        }
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(366, true)]
    [InlineData(367, false)]
    [InlineData(-5, false)]
    public void Days_are_bounded(int days, bool valid) =>
        Assert.Equal(valid, RiversideSeedOptions.TryCreate(Origin, From, days, out _, out _));

    [Fact]
    public async Task The_real_availability_api_reports_3_2_6_and_the_owner_prices_from_stock()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(30));
        Guid propertyId;
        await using (var read = factory.CreateDbContext())
        {
            propertyId = (await read.Properties.SingleAsync()).Id;
        }

        using var client = factory.CreateClient();
        async Task<Dictionary<string, JsonElement>> OffersAsync(int adults, int rooms)
        {
            var response = await client.GetAsync(
                $"/api/v1/properties/{propertyId}/availability?checkIn=2026-10-08&checkOut=2026-10-10&adults={adults}&children=0&rooms={rooms}");
            response.EnsureSuccessStatusCode();
            var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            return payload.EnumerateArray().ToDictionary(item => item.GetProperty("roomTypeCode").GetString()!, item => item.Clone());
        }

        var one = await OffersAsync(adults: 2, rooms: 1);
        Assert.Equal(3, one.Count);
        Assert.Equal(3, one["RIV-1BR"].GetProperty("availableRooms").GetInt32());
        Assert.Equal(2, one["RIV-1BR-OPEN"].GetProperty("availableRooms").GetInt32());
        Assert.Equal(6, one["RIV-2BR"].GetProperty("availableRooms").GetInt32());
        Assert.Equal(2_000_000m, one["RIV-1BR"].GetProperty("totalAmount").GetDecimal());
        Assert.Equal(2_200_000m, one["RIV-1BR-OPEN"].GetProperty("totalAmount").GetDecimal());
        Assert.Equal(3_200_000m, one["RIV-2BR"].GetProperty("totalAmount").GetDecimal());
        Assert.All(one.Values, offer => Assert.Equal("VND", offer.GetProperty("currencyCode").GetString()));
        Assert.Equal(["2026-10-08", "2026-10-09"], one["RIV-1BR"].GetProperty("nightlyRates").EnumerateArray().Select(item => item.GetProperty("stayDate").GetString()));
        Assert.Equal(1_000_000m, one["RIV-1BR"].GetProperty("nightlyRates")[0].GetProperty("amount").GetDecimal());

        // Asking for more units than exist removes that type; the server decides, not a number in the UI.
        Assert.False((await OffersAsync(adults: 8, rooms: 4)).ContainsKey("RIV-1BR")); // 4 one-bedrooms: only 3 exist
        Assert.False((await OffersAsync(adults: 6, rooms: 3)).ContainsKey("RIV-1BR-OPEN")); // 3 open-view: only 2 exist
        Assert.True((await OffersAsync(adults: 12, rooms: 3)).ContainsKey("RIV-2BR"));
        Assert.False((await OffersAsync(adults: 28, rooms: 7)).ContainsKey("RIV-2BR")); // 7 two-bedrooms: only 6 exist
        Assert.False((await OffersAsync(adults: 5, rooms: 1)).ContainsKey("RIV-2BR")); // one two-bedroom holds at most 4 guests
    }

    // ---- CP02-C3: the media-only patch of an earlier seed ---------------------------------------

    /// <summary>Puts a fresh seed back into the state the CP02 seed (13 pictures) left it in.</summary>
    private async Task MakeLegacyAsync()
    {
        await using var context = factory.CreateDbContext();
        var newIds = RiversideDemoCatalog.Media.Skip(13).Select(item => item.Id).ToArray();
        await context.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM \"RoomTypeMedia\" WHERE \"MediaId\" = ANY({newIds})");
        await context.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM \"Media\" WHERE \"Id\" = ANY({newIds})");
        var balcony = RiversideDemoCatalog.Media.Single(item => item.FileName == "two-bedroom-balcony-view.webp").Id;
        var skyline1 = RiversideDemoCatalog.Media.Single(item => item.FileName == "two-bedroom-skyline-1.webp").Id;
        var skyline2 = RiversideDemoCatalog.Media.Single(item => item.FileName == "two-bedroom-skyline-2.webp").Id;
        await context.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"RoomTypeMedia\" SET \"SortOrder\" = 0, \"IsCover\" = true WHERE \"MediaId\" = {balcony}");
        await context.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"RoomTypeMedia\" SET \"SortOrder\" = 1 WHERE \"MediaId\" = {skyline1}");
        await context.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"RoomTypeMedia\" SET \"SortOrder\" = 2 WHERE \"MediaId\" = {skyline2}");
    }

    private async Task<List<(string File, int Order, bool Cover)>> TwoBedroomLinksAsync()
    {
        await using var context = factory.CreateDbContext();
        var typeId = await context.RoomTypes.Where(item => item.Code == "RIV-2BR").Select(item => item.Id).SingleAsync();
        return (await context.RoomTypeMedia.AsNoTracking().Where(link => link.RoomTypeId == typeId).Include(link => link.Media).ToListAsync())
            .Select(link => (link.Media.Url[(link.Media.Url.LastIndexOf('/') + 1)..], link.SortOrder, link.IsCover))
            .OrderBy(item => item.Item2).ThenBy(item => item.Item1, StringComparer.Ordinal).ToList();
    }

    [Fact]
    public async Task A_database_seeded_with_the_earlier_catalog_gets_the_new_pictures_and_the_cover_move_and_a_rerun_changes_nothing()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(14));
        await MakeLegacyAsync();
        var before = await TwoBedroomLinksAsync();
        Assert.Equal(("two-bedroom-balcony-view.webp", 0, true), before.Single(item => item.Cover));
        var legacyRows = await TotalRowsAsync();

        var plan = await PlanAsync(Options(14));
        var migrations = plan.Tables.Single(table => table.Table == "Link order/cover migrations");
        Assert.Equal((0, 4), (migrations.Existing, migrations.ToInsert));
        Assert.Empty(plan.Warnings); // the interior cover going in as a regular image first is expected, not a warning
        Assert.Equal(legacyRows, await TotalRowsAsync()); // dry-run wrote nothing
        Assert.Equal(before, await TwoBedroomLinksAsync());

        var applied = await ApplyAsync(Options(14));
        Assert.True(applied.Applied);
        Assert.Equal(legacyRows + 2 * (RiversideDemoCatalog.Media.Count - 13), await TotalRowsAsync()); // 18 media + 18 links, nothing else
        var after = await TwoBedroomLinksAsync();
        Assert.Equal(("two-bedroom-living.webp", 0, true), after.Single(item => item.Cover));
        Assert.Equal(["two-bedroom-balcony-view.webp", "two-bedroom-skyline-1.webp", "two-bedroom-skyline-2.webp"],
            after.Where(item => item.Order >= 6).OrderBy(item => item.Order).Select(item => item.File));
        Assert.Equal((6, 7, 8), (after.Single(item => item.File == "two-bedroom-balcony-view.webp").Order,
            after.Single(item => item.File == "two-bedroom-skyline-1.webp").Order, after.Single(item => item.File == "two-bedroom-skyline-2.webp").Order));

        var snapshot = await SnapshotAsync();
        var again = await ApplyAsync(Options(14));
        Assert.Equal(0, again.TotalInserts);
        Assert.Empty(again.Warnings);
        Assert.Equal(snapshot, await SnapshotAsync());
    }

    [Fact]
    public async Task A_cover_the_operator_changed_is_left_alone_and_reported_while_everything_else_is_added()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(14));
        await MakeLegacyAsync();
        var skyline1 = RiversideDemoCatalog.Media.Single(item => item.FileName == "two-bedroom-skyline-1.webp").Id;
        await using (var edit = factory.CreateDbContext())
        {
            // the operator re-ordered one picture by hand
            await edit.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"RoomTypeMedia\" SET \"SortOrder\" = 5 WHERE \"MediaId\" = {skyline1}");
        }

        var applied = await ApplyAsync(Options(14));

        Assert.True(applied.Applied);
        Assert.Contains(applied.Warnings, warning => warning.Contains("two-bedroom-skyline-1.webp") && warning.Contains("left alone"));
        var after = await TwoBedroomLinksAsync();
        Assert.Equal(5, after.Single(item => item.File == "two-bedroom-skyline-1.webp").Order); // untouched
        Assert.Equal(("two-bedroom-living.webp", 0, true), after.Single(item => item.Cover));
        Assert.Equal(6, after.Single(item => item.File == "two-bedroom-balcony-view.webp").Order); // the guarded ones did move
    }

    [Fact]
    public async Task An_operator_chosen_cover_is_never_replaced_by_the_migration()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(14));
        await MakeLegacyAsync();
        var skyline2 = RiversideDemoCatalog.Media.Single(item => item.FileName == "two-bedroom-skyline-2.webp").Id;
        var balcony = RiversideDemoCatalog.Media.Single(item => item.FileName == "two-bedroom-balcony-view.webp").Id;
        await using (var edit = factory.CreateDbContext())
        {
            // the operator made the second skyline the cover and demoted ours
            await edit.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"RoomTypeMedia\" SET \"IsCover\" = false WHERE \"MediaId\" = {balcony}");
            await edit.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"RoomTypeMedia\" SET \"IsCover\" = true WHERE \"MediaId\" = {skyline2}");
        }

        var applied = await ApplyAsync(Options(14));

        Assert.True(applied.Applied);
        var after = await TwoBedroomLinksAsync();
        var cover = Assert.Single(after, item => item.Cover);
        Assert.Equal("two-bedroom-skyline-2.webp", cover.File); // still the operator's choice
        Assert.NotEmpty(applied.Warnings);
    }

    [Fact]
    public async Task The_migration_never_touches_reservations_holds_rates_or_rooms()
    {
        await factory.ResetDatabaseAsync();
        await ApplyAsync(Options(14));
        await MakeLegacyAsync();
        string Counts() => "";
        await using (var before = factory.CreateDbContext())
        {
            var rates = await before.DailyRoomRates.AsNoTracking().OrderBy(item => item.Id).Select(item => new { item.Id, item.Amount }).ToListAsync();
            var rooms = await before.PhysicalRooms.AsNoTracking().OrderBy(item => item.Id).Select(item => new { item.Id, item.OperationalStatus }).ToListAsync();
            var reservations = await before.Reservations.CountAsync();
            var holds = await before.InventoryHolds.CountAsync();

            await ApplyAsync(Options(14));

            await using var after = factory.CreateDbContext();
            Assert.Equal(rates, await after.DailyRoomRates.AsNoTracking().OrderBy(item => item.Id).Select(item => new { item.Id, item.Amount }).ToListAsync());
            Assert.Equal(rooms, await after.PhysicalRooms.AsNoTracking().OrderBy(item => item.Id).Select(item => new { item.Id, item.OperationalStatus }).ToListAsync());
            Assert.Equal(reservations, await after.Reservations.CountAsync());
            Assert.Equal(holds, await after.InventoryHolds.CountAsync());
        }
        _ = Counts();
    }
}
