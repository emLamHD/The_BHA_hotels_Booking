using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Demo;

namespace TheBha.Api.Seeding;

/// <summary>
/// BHA-BOOKING-PROMOTIONS-001: the operator CLI that seeds demo promotions for the Riverside Property, in the style of
/// <see cref="RiversideDemoSeedCommand"/> and under the same target rules: Development only, the operator names the database, and it must equal
/// <c>current_database()</c>; the database must be a demo or showcase one, or a local Development database named with
/// <c>--allow-existing-local-property --property-id GUID</c>. It runs after the host is built and exits, and writes nothing without <c>--apply</c>.
///
/// <code>
/// --seed-promotion-demo --expected-database NAME [--cover-dir PATH] [--property-id GUID --allow-existing-local-property] (--dry-run | --apply)
/// </code>
/// </summary>
public static class PromotionDemoSeedCommand
{
    public const string Verb = "--seed-promotion-demo";

    public static bool IsCommand(string[] args) => args.Contains(Verb, StringComparer.Ordinal);

    public static async Task<int> RunAsync(string[] args, IServiceProvider services, string environmentName, TextWriter output, CancellationToken cancellationToken)
    {
        string? Value(string name) => Array.IndexOf(args, name) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        var expected = Value("--expected-database");
        var coverDir = Value("--cover-dir");
        var apply = args.Contains("--apply", StringComparer.Ordinal);
        var allowExisting = args.Contains("--allow-existing-local-property", StringComparer.Ordinal);
        Guid? propertyId = Guid.TryParse(Value("--property-id"), out var parsedId) ? parsedId : null;
        if (expected is null || apply == args.Contains("--dry-run", StringComparer.Ordinal))
        {
            output.WriteLine("promotion-seed: usage: --seed-promotion-demo --expected-database NAME [--cover-dir PATH] (--dry-run | --apply)");
            return RiversideDemoSeedCommand.UsageError;
        }

        if (!string.Equals(environmentName, "Development", StringComparison.Ordinal))
        {
            output.WriteLine($"promotion-seed: {RiversideDemoSeedCommand.RefuseTarget(environmentName, expected, expected)}");
            return RiversideDemoSeedCommand.TargetRefused;
        }

        await using var scope = services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var seeder = scope.ServiceProvider.GetRequiredService<PromotionDemoSeeder>();
        var connection = new NpgsqlConnectionStringBuilder(context.Database.GetConnectionString());
        try
        {
            var actual = await context.Database.SqlQuery<string>($"SELECT current_database() AS \"Value\"").SingleAsync(cancellationToken);
            output.WriteLine($"promotion-seed: target {connection.Host}:{connection.Port}/{actual} (environment {environmentName})");
            if (RiversideDemoSeedCommand.RefuseTarget(environmentName, expected, actual, connection.Host, propertyId, allowExisting) is { } refusal)
            {
                output.WriteLine($"promotion-seed: {refusal}");
                return RiversideDemoSeedCommand.TargetRefused;
            }

            var result = apply ? await seeder.ApplyAsync(propertyId, coverDir, cancellationToken) : await seeder.PlanAsync(propertyId, coverDir, cancellationToken);
            foreach (var line in result.Lines) output.WriteLine($"promotion-seed:   {line.Slug,-26} {line.Action,-7} {line.Detail}");
            foreach (var conflict in result.Conflicts) output.WriteLine($"promotion-seed: CONFLICT: {conflict}");
            if (result.Conflicts.Count > 0)
            {
                output.WriteLine("promotion-seed: STOPPED — conflicts found; nothing was written.");
                return RiversideDemoSeedCommand.Conflict;
            }

            output.WriteLine(apply ? $"promotion-seed: APPLIED — {result.Inserted} promotions inserted." : $"promotion-seed: DRY RUN — nothing was written; {result.Inserted} promotions would be inserted.");
            return RiversideDemoSeedCommand.Success;
        }
        catch (Exception exception) when (exception is DbUpdateException or NpgsqlException or InvalidOperationException)
        {
            output.WriteLine($"promotion-seed: failed ({exception.GetType().Name}); the transaction was rolled back and nothing was changed.");
            return RiversideDemoSeedCommand.Failure;
        }
    }
}
