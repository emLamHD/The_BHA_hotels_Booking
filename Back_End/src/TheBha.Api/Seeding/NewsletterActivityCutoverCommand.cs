using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Website;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Seeding;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR14 (ADR 0011 §E): the operator CLI that moves the Newsletter's activity to <c>AdminActivities</c>, once. It runs after the host is built and exits; it is never a startup step
/// and no migration runs it. It refuses to start unless the operator states, as explicit inputs, (1) the database it is allowed to touch (it must equal <c>current_database()</c>), (2) that every API
/// instance and worker that runs an older build is retired, and (3) that no Staff account is being created. Running it again after a timeout or a rollback is safe; after a commit it only reports
/// the marker that exists.
///
/// <code>
/// --newsletter-activity-cutover --expected-database NAME --confirm-older-api-retired --confirm-no-staff-creation [--lock-timeout-seconds N]
/// </code>
/// </summary>
public static class NewsletterActivityCutoverCommand
{
    public const string Verb = "--newsletter-activity-cutover";
    public const string ConfirmRetired = "--confirm-older-api-retired";
    public const string ConfirmNoStaff = "--confirm-no-staff-creation";

    private const int DefaultLockTimeoutSeconds = 30, MaxLockTimeoutSeconds = 600;

    public static bool IsCommand(string[] args) => args.Contains(Verb, StringComparer.Ordinal);

    public static async Task<int> RunAsync(string[] args, IServiceProvider services, string environmentName, TextWriter output, CancellationToken cancellationToken)
    {
        string? Value(string name) => Array.IndexOf(args, name) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        var expected = Value("--expected-database");
        var timeoutText = Value("--lock-timeout-seconds");
        var timeoutSeconds = DefaultLockTimeoutSeconds;
        if (string.IsNullOrWhiteSpace(expected) || !args.Contains(ConfirmRetired, StringComparer.Ordinal) || !args.Contains(ConfirmNoStaff, StringComparer.Ordinal)
            || (timeoutText is not null && (!int.TryParse(timeoutText, NumberStyles.None, CultureInfo.InvariantCulture, out timeoutSeconds) || timeoutSeconds is < 1 or > MaxLockTimeoutSeconds)))
        {
            output.WriteLine($"newsletter-cutover: usage: {Verb} --expected-database NAME {ConfirmRetired} {ConfirmNoStaff} [--lock-timeout-seconds 1..{MaxLockTimeoutSeconds}]");
            output.WriteLine("newsletter-cutover: REFUSED — the database, the retirement of every older API instance and worker, and that no Staff account is being created must all be stated. Nothing was changed.");
            return RiversideDemoSeedCommand.UsageError;
        }

        await using var scope = services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var connection = new NpgsqlConnectionStringBuilder(context.Database.GetConnectionString());
        try
        {
            var actual = await context.Database.SqlQuery<string>($"SELECT current_database() AS \"Value\"").SingleAsync(cancellationToken);
            output.WriteLine($"newsletter-cutover: target {connection.Host}:{connection.Port}/{actual} (environment {environmentName})");
            if (!string.Equals(expected, actual, StringComparison.Ordinal))
            {
                output.WriteLine($"newsletter-cutover: REFUSED — --expected-database is '{expected}' but this process is connected to '{actual}'. Nothing was changed.");
                return RiversideDemoSeedCommand.TargetRefused;
            }

            var result = await scope.ServiceProvider.GetRequiredService<INewsletterActivityCutover>().RunAsync(TimeSpan.FromSeconds(timeoutSeconds), cancellationToken);
            switch (result.Status)
            {
                case NewsletterCutoverStatus.Committed:
                    output.WriteLine($"newsletter-cutover: COMMITTED — copied {result.CopiedRows} legacy row(s); LegacyMaxSequence={result.LegacyMaxSequence}; CutoverAtUtc={result.CutoverAtUtc:O}.");
                    return RiversideDemoSeedCommand.Success;
                case NewsletterCutoverStatus.AlreadyCutOver:
                    output.WriteLine($"newsletter-cutover: ALREADY DONE — the marker exists (LegacyMaxSequence={result.LegacyMaxSequence}; CutoverAtUtc={result.CutoverAtUtc:O}). Nothing was copied or changed.");
                    return RiversideDemoSeedCommand.Success;
                case NewsletterCutoverStatus.SharedRowsWithoutMarker:
                    output.WriteLine("newsletter-cutover: ABORTED — AdminActivities already holds 'newsletter' rows but there is no marker. That state is never merged; nothing was written.");
                    return RiversideDemoSeedCommand.Conflict;
                default:
                    output.WriteLine($"newsletter-cutover: LOCK TIMEOUT after {timeoutSeconds}s — nothing was copied and no marker was written; legacy stays the source. Run it again later.");
                    return RiversideDemoSeedCommand.Failure;
            }
        }
        catch (Exception exception) when (exception is DbUpdateException or NpgsqlException or InvalidOperationException)
        {
            output.WriteLine($"newsletter-cutover: failed ({exception.GetType().Name}); the transaction rolled back, so no marker and no copied row exist. It is safe to run again.");
            return RiversideDemoSeedCommand.Failure;
        }
    }
}
