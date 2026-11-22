using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>Ids of the rows <see cref="FolioTestSupport.SeedAsync"/> wrote: two Properties, a Hold-sourced, a Direct and a USD Direct Reservation in the first, a Direct one in the second, and one Staff account.</summary>
internal sealed record FolioSeed(Guid PropertyId, Guid OtherPropertyId, Guid DirectId, Guid HoldSourcedId, Guid UsdDirectId, Guid OtherPropertyDirectId, Guid StaffId);

internal static class FolioTestSupport
{
    public static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-11-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 12, 20);
    private static readonly DateOnly CheckOut = new(2026, 12, 22);

    public static async Task<FolioSeed> SeedAsync(Func<TheBhaDbContext> createContext)
    {
        await using var context = createContext();
        var (property, roomType, ratePlan) = Catalog(context, "Folio Hotel");
        var (other, otherRoomType, otherRatePlan) = Catalog(context, "Other Folio Hotel");
        var staff = new StaffAccount
        {
            Id = Guid.NewGuid(),
            Email = "folio.staff@example.com",
            UserName = "folio.staff@example.com",
            NormalizedEmail = "FOLIO.STAFF@EXAMPLE.COM",
            NormalizedUserName = "FOLIO.STAFF@EXAMPLE.COM",
            SecurityStamp = Guid.NewGuid().ToString(),
            ConcurrencyStamp = Guid.NewGuid().ToString(),
            CreatedAtUtc = Now
        };
        context.StaffAccounts.Add(staff);
        await context.SaveChangesAsync();

        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomType.Id, 1, null, "Guest", "guest@example.com", "+84 900 000 000", CheckIn, CheckOut, 1, 0, "VND", Now,
            Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant().PadRight(64, '1'), new string('d', 64), new string('c', 64), Nights(ratePlan));
        context.InventoryHolds.Add(hold);
        var holdSourced = hold.Confirm(Guid.NewGuid(), "BHA-FOLIO-HOLD", Now);
        var direct = Direct(property, roomType, ratePlan, "BHA-FOLIO-DIRECT", "VND");
        var usd = Direct(property, roomType, ratePlan, "BHA-FOLIO-USD", "USD");
        var otherDirect = Direct(other, otherRoomType, otherRatePlan, "BHA-FOLIO-OTHER", "VND");
        context.Reservations.AddRange(holdSourced, direct, usd, otherDirect);
        await context.SaveChangesAsync();
        return new FolioSeed(property.Id, other.Id, direct.Id, holdSourced.Id, usd.Id, otherDirect.Id, staff.Id);
    }

    private static (Property, RoomType, RatePlan) Catalog(TheBhaDbContext context, string name)
    {
        var property = new Property(
            Guid.NewGuid(), name, $"folio-{Guid.NewGuid():N}", null, "1 Hotel Street", "Da Nang", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(Guid.NewGuid(), property.Id, "FOL", "Folio room", $"folio-{Guid.NewGuid():N}", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "FOLPLAN", "Folio plan", null, "VND", true, Now);
        context.AddRange(property, roomType, ratePlan);
        return (property, roomType, ratePlan);
    }

    private static NightlyCommitmentSnapshot[] Nights(RatePlan ratePlan) =>
        [new(CheckIn, ratePlan.Id, 100m, null), new(CheckIn.AddDays(1), ratePlan.Id, 100m, null)];

    private static Reservation Direct(Property property, RoomType roomType, RatePlan ratePlan, string number, string currency) =>
        Reservation.CreateDirect(
            Guid.NewGuid(), number, property.Id, null, "Direct Guest", "direct@example.com", "+84 900 000 777", CheckIn, CheckOut, 2, 0, currency, Now,
            Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant().PadRight(64, '2'), [new ReservationUnitPlan(null, roomType.Id, Nights(ratePlan))]);

    /// <summary>One raw INSERT with every column, for the tests that go around the application on purpose.</summary>
    public static async Task<(string SqlState, string? Constraint)?> RawAsync(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        try
        {
            await command.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException error)
        {
            return (error.SqlState, error.ConstraintName);
        }
    }

    public static async Task<T> ScalarAsync<T>(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)(await command.ExecuteScalarAsync())!;
    }
}
