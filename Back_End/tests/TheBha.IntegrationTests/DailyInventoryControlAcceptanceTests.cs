using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Properties;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class DailyInventoryControlAcceptanceTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 8, 10);

    [Fact]
    public async Task PostgreSql_round_trip_metadata_update_and_delete_are_correct()
    {
        await factory.ResetDatabaseAsync(); await using var context = factory.CreateDbContext();
        var data = await CreateCatalogAsync(context, "metadata");
        var control = new DailyInventoryControl(Guid.NewGuid(), data.Property.Id, data.RoomType.Id, CheckIn, 2, false, Now);
        context.Add(control); await context.SaveChangesAsync(); context.ChangeTracker.Clear();
        var saved = await context.DailyInventoryControls.SingleAsync();
        Assert.Equal(CheckIn, saved.StayDate); Assert.Equal(2, saved.SellableLimit);
        var id = saved.Id; saved.Update(1, true, Now.AddMinutes(1)); await context.SaveChangesAsync(); context.ChangeTracker.Clear();
        var updated = await context.DailyInventoryControls.SingleAsync(); Assert.Equal(id, updated.Id); Assert.Equal(1, updated.SellableLimit); Assert.True(updated.IsStopSell);

        await using var connection = new NpgsqlConnection(factory.ConnectionString); await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='DailyInventoryControls' AND column_name IN ('StayDate','SellableLimit') ORDER BY column_name", connection);
        await using var reader = await command.ExecuteReaderAsync(); var columns = new Dictionary<string, (string Type, string Nullable)>();
        while (await reader.ReadAsync()) columns.Add(reader.GetString(0), (reader.GetString(1), reader.GetString(2)));
        Assert.Equal(("integer", "YES"), columns["SellableLimit"]); Assert.Equal(("date", "NO"), columns["StayDate"]);
        context.DailyInventoryControls.Remove(updated); await context.SaveChangesAsync(); Assert.Empty(await context.DailyInventoryControls.ToListAsync());
    }

    [Fact]
    public async Task Exact_duplicate_control_tuple_is_rejected()
    {
        await factory.ResetDatabaseAsync(); await using var context = factory.CreateDbContext(); var data = await CreateCatalogAsync(context, "duplicate");
        context.AddRange(Control(data, CheckIn, 1, false), Control(data, CheckIn, 2, false));
        await AssertDatabaseErrorAsync(() => context.SaveChangesAsync(), PostgresErrorCodes.UniqueViolation);
    }

    [Theory]
    [InlineData("negative")]
    [InlineData("noop")]
    [InlineData("timestamp")]
    public async Task PostgreSql_check_constraints_reject_each_invalid_state(string invalid)
    {
        await factory.ResetDatabaseAsync(); await using var context = factory.CreateDbContext(); var data = await CreateCatalogAsync(context, invalid);
        var limit = invalid == "negative" ? -1 : (int?)null; var stopSell = invalid == "noop" ? false : true; var updated = invalid == "timestamp" ? Now.AddMinutes(-1) : Now;
        var action = () => context.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "DailyInventoryControls" ("Id","PropertyId","RoomTypeId","StayDate","SellableLimit","IsStopSell","CreatedAt","UpdatedAt") VALUES ({Guid.NewGuid()},{data.Property.Id},{data.RoomType.Id},{CheckIn},{limit},{stopSell},{Now},{updated});""");
        await AssertPostgresErrorAsync(action, PostgresErrorCodes.CheckViolation);
    }

    [Fact]
    public async Task Composite_room_type_foreign_key_rejects_cross_property()
    {
        await factory.ResetDatabaseAsync(); await using var context = factory.CreateDbContext(); var a = await CreateCatalogAsync(context, "a"); var b = await CreateCatalogAsync(context, "b");
        var action = () => context.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "DailyInventoryControls" ("Id","PropertyId","RoomTypeId","StayDate","SellableLimit","IsStopSell","CreatedAt","UpdatedAt") VALUES ({Guid.NewGuid()},{b.Property.Id},{a.RoomType.Id},{CheckIn},{1},{false},{Now},{Now});""");
        await AssertPostgresErrorAsync(action, PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Same_date_allows_other_room_type_and_other_property()
    {
        await factory.ResetDatabaseAsync(); await using var context = factory.CreateDbContext(); var a = await CreateCatalogAsync(context, "a"); var b = await CreateCatalogAsync(context, "b");
        var secondRoom = CreateRoomType(a.Property.Id, "SECOND", "second"); context.Add(secondRoom); await context.SaveChangesAsync();
        context.AddRange(Control(a, CheckIn, 1, false), new DailyInventoryControl(Guid.NewGuid(), a.Property.Id, secondRoom.Id, CheckIn, 1, false, Now), Control(b, CheckIn, 1, false));
        await context.SaveChangesAsync(); Assert.Equal(3, await context.DailyInventoryControls.CountAsync());
    }

    [Fact]
    public async Task Effective_inventory_uses_active_rooms_controls_half_open_range_and_stay_minimum()
    {
        await factory.ResetDatabaseAsync(); await using var setup = factory.CreateDbContext(); var target = await CreateCatalogAsync(setup, "target");
        setup.PhysicalRooms.AddRange(
            Room(target, "101", OperationalStatus.Active), Room(target, "102", OperationalStatus.Active), Room(target, "103", OperationalStatus.Active),
            Room(target, "104", OperationalStatus.Inactive), Room(target, "105", OperationalStatus.OutOfService));
        setup.DailyInventoryControls.AddRange(
            Control(target, CheckIn.AddDays(1), 2, false),
            Control(target, CheckIn.AddDays(2), 5, false),
            Control(target, CheckIn.AddDays(3), 0, false),
            Control(target, CheckIn.AddDays(4), 2, true),
            Control(target, CheckIn.AddDays(5), null, true));
        var other = await CreateCatalogAsync(setup, "other"); setup.PhysicalRooms.Add(Room(other, "201", OperationalStatus.Active)); setup.DailyInventoryControls.Add(Control(other, CheckIn, 0, false));
        var otherRoom = CreateRoomType(target.Property.Id, "OTHER", "other-room"); setup.Add(otherRoom); await setup.SaveChangesAsync();
        setup.PhysicalRooms.Add(new PhysicalRoom(Guid.NewGuid(), target.Property.Id, otherRoom, "301", 3, OperationalStatus.Active, Now)); setup.DailyInventoryControls.Add(new DailyInventoryControl(Guid.NewGuid(), target.Property.Id, otherRoom.Id, CheckIn, 0, false, Now)); await setup.SaveChangesAsync();

        await using var scope = factory.Services.CreateAsyncScope(); var queries = scope.ServiceProvider.GetRequiredService<IDailyInventoryQueries>(); var queryContext = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var result = await queries.GetEffectiveInventoryAsync(new EffectiveInventoryRangeQuery(target.Property.Id, target.RoomType.Id, CheckIn, CheckIn.AddDays(5)), CancellationToken.None);
        Assert.Equal(3, result.BaseInventory); Assert.Equal(0, result.EffectiveInventory);
        Assert.Equal([3, 2, 3, 0, 0], result.Days.Select(day => day.EffectiveInventory));
        Assert.Equal(Enumerable.Range(0, 5).Select(offset => CheckIn.AddDays(offset)), result.Days.Select(day => day.StayDate));
        Assert.False(result.Days[0].IsStopSell); Assert.Null(result.Days[0].SellableLimit);
        Assert.True(result.Days[4].IsStopSell); Assert.Equal(2, result.Days[4].SellableLimit);
        Assert.DoesNotContain(result.Days, day => day.StayDate == CheckIn.AddDays(5));
        Assert.Empty(queryContext.ChangeTracker.Entries());
        Assert.Null(typeof(DailyEffectiveInventoryDto).GetProperty("PhysicalRoomId")); Assert.Null(typeof(DailyEffectiveInventoryDto).GetProperty("RoomNumber"));
        Assert.Null(typeof(DailyEffectiveInventoryDto).GetProperty("BookedQuantity")); Assert.Null(typeof(DailyEffectiveInventoryDto).GetProperty("ReservedQuantity"));
    }

    [Fact]
    public async Task Effective_inventory_query_observes_cancellation_and_validates_contract()
    {
        await factory.ResetDatabaseAsync(); await using var setup = factory.CreateDbContext(); var data = await CreateCatalogAsync(setup, "validation");
        await using var scope = factory.Services.CreateAsyncScope(); var queries = scope.ServiceProvider.GetRequiredService<IDailyInventoryQueries>(); using var source = new CancellationTokenSource(); source.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queries.GetEffectiveInventoryAsync(new EffectiveInventoryRangeQuery(data.Property.Id, data.RoomType.Id, CheckIn, CheckIn.AddDays(1)), source.Token));
        await Assert.ThrowsAsync<ArgumentException>(() => queries.GetEffectiveInventoryAsync(new EffectiveInventoryRangeQuery(Guid.Empty, data.RoomType.Id, CheckIn, CheckIn.AddDays(1)), CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => queries.GetEffectiveInventoryAsync(new EffectiveInventoryRangeQuery(data.Property.Id, data.RoomType.Id, CheckIn, CheckIn), CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() => queries.GetEffectiveInventoryAsync(new EffectiveInventoryRangeQuery(data.Property.Id, Guid.NewGuid(), CheckIn, CheckIn.AddDays(1)), CancellationToken.None));
    }

    private static async Task<Catalog> CreateCatalogAsync(TheBhaDbContext context, string slug)
    {
        var property = CreateProperty(slug); var roomType = CreateRoomType(property.Id, slug.ToUpperInvariant(), slug); context.AddRange(property, roomType); await context.SaveChangesAsync(); return new Catalog(property, roomType);
    }
    private static Property CreateProperty(string slug) => new(Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Ho Chi Minh City", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
    private static RoomType CreateRoomType(Guid propertyId, string code, string slug) => new(Guid.NewGuid(), propertyId, code, code, slug, null, 2, 4, true, Now);
    private static DailyInventoryControl Control(Catalog data, DateOnly date, int? limit, bool stop) => new(Guid.NewGuid(), data.Property.Id, data.RoomType.Id, date, limit, stop, Now);
    private static PhysicalRoom Room(Catalog data, string number, OperationalStatus status) => new(Guid.NewGuid(), data.Property.Id, data.RoomType, number, 1, status, Now);
    private static async Task AssertDatabaseErrorAsync(Func<Task> action, string state) { var exception = await Assert.ThrowsAsync<DbUpdateException>(action); Assert.Equal(state, Assert.IsType<PostgresException>(exception.InnerException).SqlState); }
    private static async Task AssertPostgresErrorAsync(Func<Task> action, string state) { var exception = await Assert.ThrowsAsync<PostgresException>(action); Assert.Equal(state, exception.SqlState); }
    private sealed record Catalog(Property Property, RoomType RoomType);
}
