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

    /// <summary>COMMIT was requested and its answer never arrived: the cutover may or may not have committed. Distinct from every other code so a script never treats it as success or as a safe failure.</summary>
    public const int OutcomeUnknown = 5;

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
                case NewsletterCutoverStatus.OutcomeUnknown:
                    output.WriteLine("newsletter-cutover: OUTCOME UNKNOWN — COMMIT was requested but its answer was not received, so the cutover may or may not have committed. This command does NOT retry on its own.");
                    output.WriteLine("newsletter-cutover: Run the SAME command again against THIS database. It takes its locks first, then checks the marker, and is idempotent: ALREADY DONE means the earlier run committed; COMMITTED means it did not. If that run times out before it reads the marker (LOCK TIMEOUT), the earlier outcome is still unknown.");
                    output.WriteLine("newsletter-cutover: Optionally, on a NEW connection to this same database: SELECT * FROM \"MenuActivityCutovers\" WHERE \"MenuKey\" = 'newsletter'. A row means the cutover committed. NO row proves nothing (the earlier transaction may still be completing): do not conclude that it rolled back.");
                    return OutcomeUnknown;
                default:
                    output.WriteLine($"newsletter-cutover: LOCK TIMEOUT after {timeoutSeconds}s — the server answered 55P03 before THIS run requested any COMMIT, so this run committed nothing. It does not say whether an earlier run committed (for example one that ended in OUTCOME UNKNOWN): that stays unknown until a run gets past the lock and reads the marker. Run the same command again later.");
                    return RiversideDemoSeedCommand.Failure;
            }
        }
        catch (PostgresException exception)
        {
            output.WriteLine($"newsletter-cutover: failed — the server answered with an error (SQLSTATE {exception.SqlState}), so THIS run's transaction was not committed. It does not say whether an earlier run committed. Run the same command again (it is idempotent).");
            return RiversideDemoSeedCommand.Failure;
        }
        catch (Exception exception) when (exception is DbUpdateException or NpgsqlException or InvalidOperationException)
        {
            // Only exceptions that happened BEFORE a COMMIT was requested reach here (the operation reports a lost COMMIT answer as OUTCOME UNKNOWN). Nothing is said about a rollback this process cannot see.
            output.WriteLine($"newsletter-cutover: failed ({exception.GetType().Name}) before COMMIT was requested, so this run committed nothing. It does not say whether an earlier run committed. Run the same command again (it is idempotent).");
            return RiversideDemoSeedCommand.Failure;
        }
    }
}
