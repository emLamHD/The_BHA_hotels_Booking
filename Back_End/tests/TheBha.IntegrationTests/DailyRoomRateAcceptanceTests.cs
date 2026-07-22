using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Properties;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class DailyRoomRateAcceptanceTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 8, 10);

    [Fact]
    public async Task Production_range_query_is_half_open_filtered_ordered_and_does_not_fallback()
    {
        await factory.ResetDatabaseAsync();
        await using var setup = factory.CreateDbContext();
        var data = await CreateRangeDataAsync(setup);

        await using var scope = factory.Services.CreateAsyncScope();
        var queries = scope.ServiceProvider.GetRequiredService<IDailyRoomRateQueries>();
        var queryContext = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var results = await queries.GetRangeAsync(
            new DailyRoomRateRangeQuery(data.PropertyId, data.RoomTypeId, data.RatePlanId, CheckIn, CheckIn.AddDays(5)),
            CancellationToken.None);

        Assert.Equal([CheckIn, CheckIn.AddDays(2), CheckIn.AddDays(3)], results.Select(item => item.StayDate));
        Assert.DoesNotContain(results, item => item.StayDate == CheckIn.AddDays(-1));
        Assert.DoesNotContain(results, item => item.StayDate == CheckIn.AddDays(5));
        Assert.DoesNotContain(results, item => item.PropertyId != data.PropertyId);
        Assert.DoesNotContain(results, item => item.RoomTypeId != data.RoomTypeId);
        Assert.DoesNotContain(results, item => item.RatePlanId != data.RatePlanId);
        Assert.Equal(3, results.Count);
        Assert.Empty(queryContext.ChangeTracker.Entries());
        Assert.Null(typeof(DailyRoomRateDto).GetProperty("CurrencyCode"));
        Assert.Equal(8, await setup.DailyRoomRates.CountAsync());
    }

    [Fact]
    public async Task Production_range_query_observes_cancellation_without_database_changes()
    {
        await factory.ResetDatabaseAsync();
        await using var setup = factory.CreateDbContext();
        var data = await CreateRangeDataAsync(setup);
        var before = await setup.DailyRoomRates.CountAsync();
        await using var scope = factory.Services.CreateAsyncScope();
        var queries = scope.ServiceProvider.GetRequiredService<IDailyRoomRateQueries>();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queries.GetRangeAsync(
            new DailyRoomRateRangeQuery(data.PropertyId, data.RoomTypeId, data.RatePlanId, CheckIn, CheckIn.AddDays(5)),
            cancellation.Token));

        setup.ChangeTracker.Clear();
        Assert.Equal(before, await setup.DailyRoomRates.CountAsync());
    }

    [Theory]
    [InlineData("equal")]
    [InlineData("reversed")]
    [InlineData("property")]
    [InlineData("room")]
    [InlineData("plan")]
    public async Task Production_range_query_rejects_invalid_contract(string invalidPart)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var queries = scope.ServiceProvider.GetRequiredService<IDailyRoomRateQueries>();
        var propertyId = invalidPart == "property" ? Guid.Empty : Guid.NewGuid();
        var roomTypeId = invalidPart == "room" ? Guid.Empty : Guid.NewGuid();
        var ratePlanId = invalidPart == "plan" ? Guid.Empty : Guid.NewGuid();
        var checkOut = invalidPart == "equal" ? CheckIn : invalidPart == "reversed" ? CheckIn.AddDays(-1) : CheckIn.AddDays(1);

        await Assert.ThrowsAsync<ArgumentException>(() => queries.GetRangeAsync(
            new DailyRoomRateRangeQuery(propertyId, roomTypeId, ratePlanId, CheckIn, checkOut),
            CancellationToken.None));
    }

    [Fact]
    public async Task Same_date_allows_different_room_types()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("rooms");
        var firstRoom = CreateRoomType(property.Id, "ONE", "one");
        var secondRoom = CreateRoomType(property.Id, "TWO", "two");
        var plan = CreateRatePlan(property.Id, "STANDARD");
        context.AddRange(property, firstRoom, secondRoom, plan);
        context.DailyRoomRates.AddRange(CreateRate(property.Id, firstRoom.Id, plan.Id, CheckIn), CreateRate(property.Id, secondRoom.Id, plan.Id, CheckIn));
        await context.SaveChangesAsync();
        Assert.Equal(2, await context.DailyRoomRates.CountAsync());
    }

    [Fact]
    public async Task Same_date_allows_different_rate_plans()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("plans");
        var room = CreateRoomType(property.Id, "ROOM", "room");
        var firstPlan = CreateRatePlan(property.Id, "STANDARD");
        var secondPlan = CreateRatePlan(property.Id, "FLEXIBLE");
        context.AddRange(property, room, firstPlan, secondPlan);
        context.DailyRoomRates.AddRange(CreateRate(property.Id, room.Id, firstPlan.Id, CheckIn), CreateRate(property.Id, room.Id, secondPlan.Id, CheckIn));
        await context.SaveChangesAsync();
        Assert.Equal(2, await context.DailyRoomRates.CountAsync());
    }

    [Fact]
    public async Task Exact_duplicate_nightly_tuple_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("duplicate");
        var room = CreateRoomType(property.Id, "ROOM", "room");
        var plan = CreateRatePlan(property.Id, "STANDARD");
        context.AddRange(property, room, plan);
        context.DailyRoomRates.AddRange(CreateRate(property.Id, room.Id, plan.Id, CheckIn), CreateRate(property.Id, room.Id, plan.Id, CheckIn));

        var exception = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.UniqueViolation, Assert.IsType<PostgresException>(exception.InnerException).SqlState);
    }

    [Fact]
    public async Task PostgreSql_schema_and_round_trip_preserve_date_amount_and_no_currency_column()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = CreateProperty("metadata");
        var room = CreateRoomType(property.Id, "ROOM", "room");
        var plan = CreateRatePlan(property.Id, "STANDARD");
        var rate = new DailyRoomRate(Guid.NewGuid(), property.Id, room.Id, plan.Id, CheckIn, 1234567.89m, Now);
        context.AddRange(property, room, plan, rate);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var saved = await context.DailyRoomRates.SingleAsync();
        Assert.Equal(CheckIn, saved.StayDate);
        Assert.Equal(1234567.89m, saved.Amount);

        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT "column_name", "data_type", "numeric_precision", "numeric_scale"
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'DailyRoomRates'
              AND column_name IN ('StayDate', 'Amount', 'CurrencyCode')
            ORDER BY column_name;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var columns = new Dictionary<string, (string Type, int? Precision, int? Scale)>(StringComparer.Ordinal);
        while (await reader.ReadAsync())
        {
            columns.Add(reader.GetString(0), (reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetInt32(2), reader.IsDBNull(3) ? null : reader.GetInt32(3)));
        }
        Assert.Equal(("date", null, null), columns["StayDate"]);
        Assert.Equal(("numeric", 18, 2), columns["Amount"]);
        Assert.DoesNotContain("CurrencyCode", columns.Keys);
    }

    private static async Task<RangeData> CreateRangeDataAsync(TheBhaDbContext context)
    {
        var property = CreateProperty("target");
        var otherProperty = CreateProperty("other");
        var room = CreateRoomType(property.Id, "TARGET", "target");
        var otherRoom = CreateRoomType(property.Id, "OTHER", "other");
        var otherPropertyRoom = CreateRoomType(otherProperty.Id, "REMOTE", "remote");
        var plan = CreateRatePlan(property.Id, "STANDARD");
        var otherPlan = CreateRatePlan(property.Id, "FLEXIBLE");
        var otherPropertyPlan = CreateRatePlan(otherProperty.Id, "STANDARD");
        context.AddRange(property, otherProperty, room, otherRoom, otherPropertyRoom, plan, otherPlan, otherPropertyPlan);
        context.DailyRoomRates.AddRange(
            CreateRate(property.Id, room.Id, plan.Id, CheckIn.AddDays(-1)),
            CreateRate(property.Id, room.Id, plan.Id, CheckIn),
            CreateRate(property.Id, room.Id, plan.Id, CheckIn.AddDays(2)),
            CreateRate(property.Id, room.Id, plan.Id, CheckIn.AddDays(3)),
            CreateRate(property.Id, room.Id, plan.Id, CheckIn.AddDays(5)),
            CreateRate(otherProperty.Id, otherPropertyRoom.Id, otherPropertyPlan.Id, CheckIn),
            CreateRate(property.Id, otherRoom.Id, plan.Id, CheckIn),
            CreateRate(property.Id, room.Id, otherPlan.Id, CheckIn));
        await context.SaveChangesAsync();
        return new RangeData(property.Id, room.Id, plan.Id);
    }

    private static Property CreateProperty(string slug) => new(Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Ho Chi Minh City", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
    private static RoomType CreateRoomType(Guid propertyId, string code, string slug) => new(Guid.NewGuid(), propertyId, code, code, slug, null, 2, 4, true, Now);
    private static RatePlan CreateRatePlan(Guid propertyId, string code) => new(Guid.NewGuid(), propertyId, code, code, null, "VND", true, Now);
    private static DailyRoomRate CreateRate(Guid propertyId, Guid roomTypeId, Guid ratePlanId, DateOnly date) => new(Guid.NewGuid(), propertyId, roomTypeId, ratePlanId, date, 100m, Now);
    private sealed record RangeData(Guid PropertyId, Guid RoomTypeId, Guid RatePlanId);
}
