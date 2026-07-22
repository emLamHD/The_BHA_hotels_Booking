using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

public sealed class PostgreSqlWebApplicationFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _administrativeConnectionString;

    public PostgreSqlWebApplicationFactory()
    {
        var configuredConnectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase");
        if (string.IsNullOrWhiteSpace(configuredConnectionString))
        {
            throw new InvalidOperationException(
                "ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server.");
        }

        var applicationBuilder = new NpgsqlConnectionStringBuilder(configuredConnectionString);
        var databasePrefix = new string(
            (applicationBuilder.Database ?? "thebha")
                .Where(character => char.IsAsciiLetterOrDigit(character) || character == '_')
                .ToArray());
        databasePrefix = string.IsNullOrWhiteSpace(databasePrefix) ? "thebha" : databasePrefix;
        databasePrefix = databasePrefix[..Math.Min(databasePrefix.Length, 20)];

        DatabaseName = $"{databasePrefix}_be001_{Guid.NewGuid():N}";
        applicationBuilder.Database = DatabaseName;
        applicationBuilder.Pooling = false;
        ConnectionString = applicationBuilder.ConnectionString;

        var administrativeBuilder = new NpgsqlConnectionStringBuilder(configuredConnectionString)
        {
            Database = "postgres",
            Pooling = false
        };
        _administrativeConnectionString = administrativeBuilder.ConnectionString;
    }

    public string DatabaseName { get; }
    public string ConnectionString { get; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:TheBhaDatabase", ConnectionString);
    }

    async Task IAsyncLifetime.InitializeAsync()
    {
        await using (var connection = new NpgsqlConnection(_administrativeConnectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{DatabaseName}\"";
            await command.ExecuteNonQueryAsync();
        }

        await using var context = CreateDbContext();
        await context.Database.MigrateAsync();
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        Dispose();
        NpgsqlConnection.ClearAllPools();

        await using var connection = new NpgsqlConnection(_administrativeConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{DatabaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    public TheBhaDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<TheBhaDbContext>()
            .UseNpgsql(
                ConnectionString,
                options => options.MigrationsAssembly("TheBha.Infrastructure"))
            .Options;
        return new TheBhaDbContext(options);
    }

    public async Task ResetDatabaseAsync()
    {
        await using var context = CreateDbContext();
        await context.Database.ExecuteSqlRawAsync(
            """
            TRUNCATE TABLE
                "DailyInventoryControls",
                "DailyRoomRates",
                "RatePlans",
                "PhysicalRooms",
                "PropertyAmenities",
                "PropertyMedia",
                "RoomTypeAmenities",
                "RoomTypeMedia",
                "Amenities",
                "Media",
                "RoomTypes",
                "Properties"
            CASCADE;
            """);
    }
}
