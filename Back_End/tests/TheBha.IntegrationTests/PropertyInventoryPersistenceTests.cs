using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class PropertyInventoryPersistenceTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");

    [Fact]
    public async Task Migration_applies_to_clean_postgresql_17_database()
    {
        await using var context = factory.CreateDbContext();
        var applied = await context.Database.GetAppliedMigrationsAsync();
        var pending = await context.Database.GetPendingMigrationsAsync();
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SHOW server_version", connection);
        var version = (string?)await command.ExecuteScalarAsync();

        Assert.Contains(applied, migration => migration.EndsWith("_InitialPropertyRoomInventory"));
        Assert.Contains(applied, migration => migration.EndsWith("_AddRatePlanFoundation"));
        Assert.Empty(pending);
        Assert.StartsWith("17.", version, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Property_slug_is_unique()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        context.Properties.AddRange(CreateProperty("hotel"), CreateProperty("hotel"));

        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.UniqueViolation);
    }

    [Fact]
    public async Task Amenity_code_is_unique()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        context.Amenities.AddRange(
            new Amenity(Guid.NewGuid(), "WIFI", "Wi-Fi", "Connectivity", true),
            new Amenity(Guid.NewGuid(), "WIFI", "Wireless Internet", "Connectivity", true));

        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.UniqueViolation);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Room_type_code_and_slug_are_unique_within_property(bool duplicateCode)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("hotel");
        context.Add(property);
        context.RoomTypes.AddRange(
            CreateRoomType(property.Id, "DLX", "deluxe"),
            CreateRoomType(
                property.Id,
                duplicateCode ? "DLX" : "SUITE",
                duplicateCode ? "suite" : "deluxe"));

        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.UniqueViolation);
    }

    [Fact]
    public async Task Room_type_code_and_slug_can_be_reused_by_another_property()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var first = CreateProperty("first-hotel");
        var second = CreateProperty("second-hotel");
        context.AddRange(first, second);
        context.RoomTypes.AddRange(
            CreateRoomType(first.Id, "DLX", "deluxe"),
            CreateRoomType(second.Id, "DLX", "deluxe"));

        await context.SaveChangesAsync();

        Assert.Equal(2, await context.RoomTypes.CountAsync());
    }

    [Fact]
    public async Task Rate_plan_persists_and_its_code_is_unique_within_property()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("hotel");
        context.Add(property);
        context.RatePlans.Add(new RatePlan(
            Guid.NewGuid(), property.Id, "STANDARD", "Standard Rate", null, "VND", true, Now));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var saved = await context.RatePlans.SingleAsync();
        Assert.Equal("STANDARD", saved.Code);
        Assert.Equal("VND", saved.CurrencyCode);

        context.RatePlans.Add(new RatePlan(
            Guid.NewGuid(), property.Id, "STANDARD", "Another Standard", null, "VND", true, Now));
        await AssertDatabaseErrorAsync(() => context.SaveChangesAsync(), PostgresErrorCodes.UniqueViolation);
    }

    [Fact]
    public async Task Rate_plan_code_can_be_reused_by_another_property_and_foreign_key_is_enforced()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var first = CreateProperty("first-hotel");
        var second = CreateProperty("second-hotel");
        context.AddRange(first, second);
        context.RatePlans.AddRange(
            new RatePlan(Guid.NewGuid(), first.Id, "STANDARD", "Standard Rate", null, "VND", true, Now),
            new RatePlan(Guid.NewGuid(), second.Id, "STANDARD", "Standard Rate", null, "VND", true, Now));
        await context.SaveChangesAsync();
        Assert.Equal(2, await context.RatePlans.CountAsync());

        var action = () => context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "RatePlans" ("Id", "PropertyId", "Code", "Name", "CurrencyCode", "IsActive", "CreatedAt", "UpdatedAt")
            VALUES ({Guid.NewGuid()}, {Guid.NewGuid()}, {"INVALID"}, {"Invalid"}, {"VND"}, {true}, {Now}, {Now});
            """);
        await AssertPostgresErrorAsync(action, PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Rate_plan_check_constraints_reject_invalid_currency_and_timestamp_order()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("hotel");
        context.Add(property);
        await context.SaveChangesAsync();

        var invalidCurrency = () => context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "RatePlans" ("Id", "PropertyId", "Code", "Name", "CurrencyCode", "IsActive", "CreatedAt", "UpdatedAt")
            VALUES ({Guid.NewGuid()}, {property.Id}, {"INVALID"}, {"Invalid"}, {"VN1"}, {true}, {Now}, {Now});
            """);
        await AssertPostgresErrorAsync(invalidCurrency, PostgresErrorCodes.CheckViolation);

        var invalidTimestamp = () => context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "RatePlans" ("Id", "PropertyId", "Code", "Name", "CurrencyCode", "IsActive", "CreatedAt", "UpdatedAt")
            VALUES ({Guid.NewGuid()}, {property.Id}, {"INVALID2"}, {"Invalid"}, {"VND"}, {true}, {Now}, {Now.AddMinutes(-1)});
            """);
        await AssertPostgresErrorAsync(invalidTimestamp, PostgresErrorCodes.CheckViolation);
    }

    [Fact]
    public async Task Room_number_is_unique_within_property()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("hotel");
        var roomType = CreateRoomType(property.Id, "DLX", "deluxe");
        context.AddRange(property, roomType);
        context.PhysicalRooms.AddRange(
            new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, "101", 1, OperationalStatus.Active, Now),
            new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, "101", 1, OperationalStatus.Inactive, Now));

        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.UniqueViolation);
    }

    [Fact]
    public async Task Database_rejects_physical_room_and_room_type_from_different_properties()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var first = CreateProperty("first-hotel");
        var second = CreateProperty("second-hotel");
        var roomType = CreateRoomType(first.Id, "DLX", "deluxe");
        context.AddRange(first, second, roomType);
        await context.SaveChangesAsync();

        var roomId = Guid.NewGuid();
        var action = () => context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "PhysicalRooms"
                ("Id", "PropertyId", "RoomTypeId", "RoomNumber", "Floor", "OperationalStatus", "CreatedAt", "UpdatedAt")
            VALUES
                ({roomId}, {second.Id}, {roomType.Id}, {"101"}, {1}, {"Active"}, {Now}, {Now});
            """);

        await AssertPostgresErrorAsync(action, PostgresErrorCodes.ForeignKeyViolation);
    }

    [Theory]
    [InlineData(0, 2)]
    [InlineData(3, 2)]
    public async Task Occupancy_check_constraints_reject_invalid_values(int baseOccupancy, int maxOccupancy)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("hotel");
        context.Add(property);
        await context.SaveChangesAsync();
        var roomTypeId = Guid.NewGuid();

        var action = () => context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "RoomTypes"
                ("Id", "PropertyId", "Code", "Name", "Slug", "Description", "BaseOccupancy", "MaxOccupancy", "IsActive", "CreatedAt", "UpdatedAt")
            VALUES
                ({roomTypeId}, {property.Id}, {"INVALID"}, {"Invalid"}, {"invalid"}, {(string?)null}, {baseOccupancy}, {maxOccupancy}, {true}, {Now}, {Now});
            """);

        await AssertPostgresErrorAsync(action, PostgresErrorCodes.CheckViolation);
    }

    [Fact]
    public async Task Amenity_and_media_associations_are_relational_and_queryable()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("hotel");
        var roomType = CreateRoomType(property.Id, "DLX", "deluxe");
        var amenity = new Amenity(Guid.NewGuid(), "WIFI", "Wi-Fi", "Connectivity", true);
        var media = new Media(
            Guid.NewGuid(),
            "https://images.example.com/hotel.jpg",
            "Hotel",
            MediaType.Image,
            Now);
        context.AddRange(property, roomType, amenity, media);
        context.AddRange(
            new PropertyAmenity(property.Id, amenity.Id),
            new RoomTypeAmenity(roomType.Id, amenity.Id),
            new PropertyMedia(property.Id, media.Id, 0, true),
            new RoomTypeMedia(roomType.Id, media.Id, 0, true));

        await context.SaveChangesAsync();

        Assert.Equal(1, await context.PropertyAmenities.CountAsync());
        Assert.Equal(1, await context.RoomTypeAmenities.CountAsync());
        Assert.Equal(1, await context.PropertyMedia.CountAsync());
        Assert.Equal(1, await context.RoomTypeMedia.CountAsync());
    }

    [Fact]
    public async Task Development_seed_is_idempotent()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var seeder = new DevelopmentDataSeeder(context);

        await seeder.SeedAsync(CancellationToken.None);
        var first = await ReadCountsAsync(context);
        var ratePlan = await context.RatePlans.SingleAsync();
        context.ChangeTracker.Clear();
        await seeder.SeedAsync(CancellationToken.None);
        var second = await ReadCountsAsync(context);

        Assert.Equal(new SeedCounts(1, 2, 1, 3, 4, 4, 3, 5, 2, 2), first);
        Assert.Equal("STANDARD", ratePlan.Code);
        Assert.Equal("Standard Rate", ratePlan.Name);
        Assert.Equal("VND", ratePlan.CurrencyCode);
        Assert.True(ratePlan.IsActive);
        Assert.Equal(first, second);
    }

    private static Property CreateProperty(string slug)
    {
        return new Property(
            Guid.NewGuid(),
            $"Hotel {slug}",
            slug,
            null,
            "1 Hotel Street",
            "Ho Chi Minh City",
            "Vietnam",
            "Asia/Ho_Chi_Minh",
            new TimeOnly(14, 0),
            new TimeOnly(12, 0),
            true,
            Now);
    }

    private static RoomType CreateRoomType(Guid propertyId, string code, string slug)
    {
        return new RoomType(
            Guid.NewGuid(),
            propertyId,
            code,
            $"Room {code}",
            slug,
            null,
            2,
            4,
            true,
            Now);
    }

    private static async Task AssertDatabaseErrorAsync(Func<Task> action, string sqlState)
    {
        var exception = await Assert.ThrowsAsync<DbUpdateException>(action);
        var postgresException = Assert.IsType<PostgresException>(exception.InnerException);
        Assert.Equal(sqlState, postgresException.SqlState);
    }

    private static async Task AssertPostgresErrorAsync(Func<Task> action, string sqlState)
    {
        var exception = await Assert.ThrowsAsync<PostgresException>(action);
        Assert.Equal(sqlState, exception.SqlState);
    }

    private static async Task<SeedCounts> ReadCountsAsync(TheBhaDbContext context)
    {
        return new SeedCounts(
            await context.Properties.CountAsync(),
            await context.RoomTypes.CountAsync(),
            await context.RatePlans.CountAsync(),
            await context.PhysicalRooms.CountAsync(),
            await context.Amenities.CountAsync(),
            await context.Media.CountAsync(),
            await context.PropertyAmenities.CountAsync(),
            await context.RoomTypeAmenities.CountAsync(),
            await context.PropertyMedia.CountAsync(),
            await context.RoomTypeMedia.CountAsync());
    }

    private sealed record SeedCounts(
        int Properties,
        int RoomTypes,
        int RatePlans,
        int PhysicalRooms,
        int Amenities,
        int Media,
        int PropertyAmenities,
        int RoomTypeAmenities,
        int PropertyMedia,
        int RoomTypeMedia);
}
