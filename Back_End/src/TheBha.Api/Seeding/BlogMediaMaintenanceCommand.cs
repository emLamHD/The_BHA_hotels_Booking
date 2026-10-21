using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Blog;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Seeding;

/// <summary>
/// BHA-BLOG-001-CP02: the operator CLI for the Blog pictures. It gives every picture uploaded before CP02 its variants (the backfill that is a required step of a deploy that
/// brings the pipeline) and finds — and with <c>--apply</c> removes — the files in <c>blog/</c> that no picture refers to. Unlike the demo seeds it runs in any environment,
/// because the data it fixes lives where Staff upload; the protection is the same: the operator names the database and it must equal <c>current_database()</c>, and nothing is
/// written or deleted without <c>--apply</c>. It runs after the host is built and exits; it is never a startup step.
///
/// <code>
/// --blog-media-maintain --expected-database NAME [--grace-minutes N] (--dry-run | --apply)
/// </code>
/// </summary>
public static class BlogMediaMaintenanceCommand
{
    public const string Verb = "--blog-media-maintain";

    private const int DefaultGraceMinutes = 60;

    public static bool IsCommand(string[] args) => args.Contains(Verb, StringComparer.Ordinal);

    public static async Task<int> RunAsync(string[] args, IServiceProvider services, string environmentName, TextWriter output, CancellationToken cancellationToken)
    {
        string? Value(string name) => Array.IndexOf(args, name) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        var expected = Value("--expected-database");
        var apply = args.Contains("--apply", StringComparer.Ordinal);
        var graceText = Value("--grace-minutes");
        var grace = DefaultGraceMinutes;
        if (expected is null || apply == args.Contains("--dry-run", StringComparer.Ordinal) || (graceText is not null && (!int.TryParse(graceText, out grace) || grace < 0)))
        {
            output.WriteLine("blog-media: usage: --blog-media-maintain --expected-database NAME [--grace-minutes N] (--dry-run | --apply)");
            return RiversideDemoSeedCommand.UsageError;
        }

        await using var scope = services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var connection = new NpgsqlConnectionStringBuilder(context.Database.GetConnectionString());
        try
        {
            var actual = await context.Database.SqlQuery<string>($"SELECT current_database() AS \"Value\"").SingleAsync(cancellationToken);
            output.WriteLine($"blog-media: target {connection.Host}:{connection.Port}/{actual} (environment {environmentName})");
            if (!string.Equals(expected, actual, StringComparison.Ordinal))
            {
                output.WriteLine($"blog-media: REFUSED — --expected-database is '{expected}' but this process is connected to '{actual}'. Nothing was changed.");
                return RiversideDemoSeedCommand.TargetRefused;
            }

            var report = await scope.ServiceProvider.GetRequiredService<IBlogMediaMaintenance>().RunAsync(apply, TimeSpan.FromMinutes(grace), cancellationToken);
            output.WriteLine($"blog-media: pictures before CP02 (no variants): {report.LegacyPictures}; processed: {report.LegacyProcessed}");
            output.WriteLine($"blog-media: files no picture refers to (older than {grace} min): {report.OrphanFiles}; removed: {report.OrphansRemoved}; stale half-written files: {report.StaleTemporaryFiles}");
            foreach (var problem in report.Problems)
            {
                output.WriteLine($"blog-media: PROBLEM: {problem}");
            }

            output.WriteLine(apply ? "blog-media: APPLIED." : "blog-media: DRY RUN — nothing was written or deleted.");
            return report.Problems.Count == 0 ? RiversideDemoSeedCommand.Success : RiversideDemoSeedCommand.Conflict;
        }
        catch (Exception exception) when (exception is DbUpdateException or NpgsqlException or InvalidOperationException or IOException)
        {
            output.WriteLine($"blog-media: failed ({exception.GetType().Name}); anything half done is safe to run again.");
            return RiversideDemoSeedCommand.Failure;
        }
    }
}
