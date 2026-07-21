using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using TheBha.Application.Properties;

namespace TheBha.Infrastructure.Persistence;

public static class InfrastructureServiceCollectionExtensions
{
    public const string DatabaseConnectionStringName = "TheBhaDatabase";
    public const string DatabaseReadinessTag = "database-ready";

    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration.GetConnectionString(DatabaseConnectionStringName);

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Connection string 'ConnectionStrings:TheBhaDatabase' is not configured.");
        }

        services.AddDbContext<TheBhaDbContext>(options =>
            options.UseNpgsql(
                connectionString,
                npgsqlOptions => npgsqlOptions.MigrationsAssembly("TheBha.Infrastructure")));

        services.AddScoped<IPropertyCatalogQueries, PropertyCatalogQueries>();
        services.AddScoped<DevelopmentDataSeeder>();

        services
            .AddHealthChecks()
            .AddDbContextCheck<TheBhaDbContext>(
                name: "postgresql",
                failureStatus: HealthStatus.Unhealthy,
                tags: [DatabaseReadinessTag]);

        return services;
    }
}
