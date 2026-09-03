using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.1 correction C9: the connection addresses a test host should
/// present to the application.
///
/// <para>
/// TestServer never populates <c>HttpContext.Connection</c> — both addresses
/// are <c>null</c> — whereas real Kestrel always populates both. The board
/// gate now fails closed on a null or non-loopback address, so leaving the
/// TestServer default in place would mean every board test exercised a
/// connection shape that cannot occur in production, and the loopback rule
/// would be untestable. This models the real thing instead: loopback to
/// loopback by default, and whatever a boundary test explicitly asks for
/// otherwise (including <c>null</c>, which must fail closed).
/// </para>
///
/// <para>
/// This type lives in the test assembly and is applied only by the test
/// factory below. Production code has no knowledge of it: there is no header,
/// no configuration key and no branch in <c>TheBha.Api</c> that a caller could
/// use to declare its own address.
/// </para>
/// </summary>
public sealed class TestConnectionAddresses
{
    public IPAddress? LocalIpAddress { get; init; } = IPAddress.Loopback;
    public IPAddress? RemoteIpAddress { get; init; } = IPAddress.Loopback;
}

/// <summary>
/// Applies <see cref="TestConnectionAddresses"/> to every request before the
/// application's own pipeline runs, which is the only place a TestServer host
/// can stand in for what Kestrel would have set from the real socket.
/// </summary>
internal sealed class TestConnectionAddressStartupFilter(TestConnectionAddresses addresses) : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) =>
        app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                context.Connection.LocalIpAddress = addresses.LocalIpAddress;
                context.Connection.RemoteIpAddress = addresses.RemoteIpAddress;
                await nextMiddleware(context);
            });

            next(app);
        };
}

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

        // PMS-CAL-001.1 correction C9: model the supported local launch. The
        // Development configuration no longer enables the unauthenticated board
        // read on its own — the local HTTPS launch profile opts in explicitly —
        // so a test host that wants the board must opt in the same way, rather
        // than inheriting it from an environment name.
        //
        // This is applied as real configuration, and only when the host really
        // is Development, so a derived factory that switches to Production or
        // Staging is unaffected: it still starts from the shipped default, and
        // Program.cs's startup guard (which reads configuration, not options)
        // still sees false. Tests asserting gate-off behaviour override the
        // bound option instead.
        builder.ConfigureAppConfiguration((context, configuration) =>
        {
            if (context.HostingEnvironment.IsDevelopment())
            {
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["AdminCalendar:EnableUnauthenticatedRead"] = "true",
                });
            }
        });

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);

            // Loopback to loopback unless a boundary test replaces it.
            services.TryAddSingleton(new TestConnectionAddresses());
            services.AddSingleton<IStartupFilter, TestConnectionAddressStartupFilter>();
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
                "ReservationUnitNights",
                "ReservationUnits",
                "Reservations",
                "InventoryHoldItemNights",
                "InventoryHoldItems",
                "InventoryHolds",
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
