using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
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

        DatabaseName = $"{databasePrefix}_integration_{Guid.NewGuid():N}";
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
    public MutableTimeProvider Clock { get; } = new(TimeProvider.System.GetUtcNow());

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:TheBhaDatabase", ConnectionString);
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
        });
    }

    public sealed class MutableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = utcNow;
        public override DateTimeOffset GetUtcNow() => UtcNow;
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
                "AspNetUsers",
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
