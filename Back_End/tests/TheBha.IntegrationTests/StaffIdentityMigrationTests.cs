using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP01 migration evidence: migration 9 applies to a fresh database,
/// upgrades a migration 8 database with Customer and Property rows intact, and its guarded
/// Down() refuses to drop Staff rows but succeeds when both new tables are empty.
/// Each test owns a disposable database so it controls which migration is applied.
/// </summary>
public sealed class StaffIdentityMigrationTests : IAsyncLifetime
{
    private const string V8Migration = "20260826035254_PhysicalRoomScheduleAvailabilityAuthority";
    private const string V9Migration = "20261001141847_AddStaffIdentityFoundation";
    private static readonly Guid PropertyId = Guid.Parse("90000000-0000-0000-0000-000000000011");
    private static readonly Guid CustomerId = Guid.Parse("90000000-0000-0000-0000-000000000012");

    private readonly NpgsqlConnectionStringBuilder _builder = new(
        Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")
        ?? throw new InvalidOperationException(
            "ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server."))
    {
        Database = $"thebha_staffidentity_{Guid.NewGuid():N}",
        Pooling = false
    };

    public Task InitializeAsync() => AdministerAsync($"CREATE DATABASE \"{_builder.Database}\"");

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await AdministerAsync($"DROP DATABASE IF EXISTS \"{_builder.Database}\" WITH (FORCE)");
    }

    [Fact]
    public async Task Fresh_database_applies_all_nine_migrations()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();

        Assert.Equal(9, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
        Assert.Equal(0, await CountAsync("StaffAccounts"));
        Assert.Equal(0, await CountAsync("StaffPropertyMemberships"));
    }

    [Fact]
    public async Task V8_database_upgrades_with_customer_and_property_rows_intact_and_downgrades_only_when_empty()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V8Migration);
        await ExecuteAsync(
            $"""
            INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
            VALUES ('{PropertyId}','Upgrade Property','upgrade-property',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,now(),now());
            INSERT INTO "AspNetUsers" ("Id","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
            VALUES ('{CustomerId}','c@example.com','C@EXAMPLE.COM','c@example.com','C@EXAMPLE.COM',false,false,false,true,0);
            """);

        await migrator.MigrateAsync(V9Migration);

        Assert.Equal(1, await CountAsync("Properties"));
        Assert.Equal(1, await CountAsync("AspNetUsers"));
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());

        await ExecuteAsync(
            $"""
            INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
            VALUES ('{CustomerId}',true,now(),'c@example.com','C@EXAMPLE.COM','c@example.com','C@EXAMPLE.COM',false,false,false,true,0)
            """);
        var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V8Migration));
        Assert.Equal("P0001", refused.SqlState);
        Assert.Equal(1, await CountAsync("StaffAccounts"));

        await ExecuteAsync("DELETE FROM \"StaffAccounts\"");
        await migrator.MigrateAsync(V8Migration);
        Assert.Equal([V9Migration], await context.Database.GetPendingMigrationsAsync());
        Assert.Equal(1, await CountAsync("AspNetUsers"));
    }

    private TheBhaDbContext CreateContext() => new(new DbContextOptionsBuilder<TheBhaDbContext>()
        .UseNpgsql(_builder.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
        .Options);

    private async Task<long> CountAsync(string table)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"SELECT COUNT(*) FROM \"{table}\"", connection);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private async Task AdministerAsync(string sql)
    {
        var administrative = new NpgsqlConnectionStringBuilder(_builder.ConnectionString) { Database = "postgres" };
        await using var connection = new NpgsqlConnection(administrative.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
