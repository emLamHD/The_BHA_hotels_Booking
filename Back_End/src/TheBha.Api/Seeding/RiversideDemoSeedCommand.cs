using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Demo;

namespace TheBha.Api.Seeding;

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: the operator CLI that seeds the Riverside demo catalog, in the
/// style of the Staff CLI. It runs after the host is built and exits; it never starts a listener,
/// is never a startup step and writes nothing without an explicit <c>--apply</c>.
///
/// <code>
/// --seed-riverside-demo --expected-database NAME --media-base-url https://ORIGIN
///                       --from YYYY-MM-DD [--days 60] (--dry-run | --apply)
/// </code>
///
/// <para>
/// The target is checked before anything is read: the environment must be Development, the
/// operator names the database (<c>--expected-database</c>), that name must be a demo or
/// showcase database, and it must equal <c>current_database()</c> of the connection actually in
/// use. Production, Staging and any other environment are refused. The public API that serves
/// the seeded data still runs Production; the seeder is a separate operator process.
/// </para>
/// </summary>
public static class RiversideDemoSeedCommand
{
    public const string Verb = "--seed-riverside-demo";

    public const int Success = 0;
    public const int Failure = 1;
    public const int UsageError = 2;
    public const int TargetRefused = 3;
    public const int Conflict = 4;

    public const int DefaultDays = 60;

    private static readonly string[] ValueOptions = ["--expected-database", "--media-base-url", "--from", "--days"];
    private static readonly string[] FlagOptions = ["--dry-run", "--apply"];

    public static bool IsCommand(string[] args) => args.Contains(Verb, StringComparer.Ordinal);

    /// <summary>The environment and name rules; <c>null</c> means the target is acceptable.</summary>
    public static string? RefuseTarget(string environmentName, string expectedDatabase, string actualDatabase)
    {
        if (!string.Equals(environmentName, "Development", StringComparison.Ordinal))
        {
            return $"refused: the Riverside demo seed runs only with ASPNETCORE_ENVIRONMENT=Development (this process is '{environmentName}').";
        }

        if (string.IsNullOrWhiteSpace(expectedDatabase) ||
            (!expectedDatabase.Contains("demo", StringComparison.OrdinalIgnoreCase) &&
             !expectedDatabase.Contains("showcase", StringComparison.OrdinalIgnoreCase)))
        {
            return "refused: --expected-database must name a demo or showcase database (its name must contain 'demo' or 'showcase').";
        }

        if (!string.Equals(expectedDatabase, actualDatabase, StringComparison.Ordinal))
        {
            return "refused: --expected-database does not match the database this process is connected to.";
        }

        return null;
    }

    public static async Task<int> RunAsync(
        string[] args,
        IServiceProvider services,
        string environmentName,
        TextWriter output,
        CancellationToken cancellationToken)
    {
        var parsed = Parse(args);
        if (parsed.Error is not null)
        {
            output.WriteLine($"riverside-seed: {parsed.Error}");
            output.WriteLine($"usage: {Verb} --expected-database NAME --media-base-url https://ORIGIN --from YYYY-MM-DD [--days {DefaultDays}] (--dry-run | --apply)");
            return UsageError;
        }

        // The environment is refused before the database is touched at all.
        if (!string.Equals(environmentName, "Development", StringComparison.Ordinal))
        {
            output.WriteLine($"riverside-seed: {RefuseTarget(environmentName, parsed.ExpectedDatabase!, parsed.ExpectedDatabase!)}");
            return TargetRefused;
        }

        await using var scope = services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var seeder = scope.ServiceProvider.GetRequiredService<RiversideDemoSeeder>();
        var connection = new NpgsqlConnectionStringBuilder(context.Database.GetConnectionString());

        try
        {
            var actual = await context.Database.SqlQuery<string>($"SELECT current_database() AS \"Value\"").SingleAsync(cancellationToken);
            var refusal = RefuseTarget(environmentName, parsed.ExpectedDatabase!, actual);
            output.WriteLine($"riverside-seed: target {connection.Host}:{connection.Port}/{actual} (environment {environmentName})");
            if (refusal is not null)
            {
                output.WriteLine($"riverside-seed: {refusal}");
                return TargetRefused;
            }

            var options = parsed.Options!;
            var plan = parsed.Apply
                ? await seeder.ApplyAsync(options, cancellationToken)
                : await seeder.PlanAsync(options, cancellationToken);
            Print(plan, parsed.Apply, output);

            if (plan.HasConflicts)
            {
                output.WriteLine("riverside-seed: STOPPED — conflicts found; nothing was written.");
                return Conflict;
            }

            output.WriteLine(parsed.Apply
                ? $"riverside-seed: APPLIED — {plan.TotalInserts} rows inserted."
                : $"riverside-seed: DRY RUN — nothing was written; {plan.TotalInserts} rows would be inserted.");
            return Success;
        }
        catch (RiversideSeedValidationException exception)
        {
            output.WriteLine($"riverside-seed: {exception.Message}");
            return UsageError;
        }
        catch (Exception exception) when (exception is DbUpdateException or NpgsqlException or InvalidOperationException)
        {
            // Database messages can quote row values; report the kind of failure only.
            output.WriteLine($"riverside-seed: failed ({exception.GetType().Name}); the transaction was rolled back and nothing was changed.");
            return Failure;
        }
    }

    private static void Print(RiversideSeedPlan plan, bool apply, TextWriter output)
    {
        output.WriteLine($"riverside-seed: mode {(apply ? "apply" : "dry-run")}, nights {plan.From:yyyy-MM-dd}..{plan.ToExclusive.AddDays(-1):yyyy-MM-dd} ({(plan.ToExclusive.DayNumber - plan.From.DayNumber)}), media origin {plan.MediaOrigin}, property {(plan.PropertyExists ? "exists" : "will be created")}");
        foreach (var table in plan.Tables)
        {
            output.WriteLine($"riverside-seed:   {table.Table,-34} existing {table.Existing,5}   insert {table.ToInsert,5}");
        }

        foreach (var warning in plan.Warnings)
        {
            output.WriteLine($"riverside-seed: warning: {warning}");
        }

        foreach (var conflict in plan.Conflicts)
        {
            output.WriteLine($"riverside-seed: CONFLICT: {conflict}");
        }
    }

    private sealed record Parsed(string? Error, string? ExpectedDatabase, RiversideSeedOptions? Options, bool Apply);

    private static Parsed Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var flags = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Length; index++)
        {
            var argument = args[index];
            if (argument == Verb)
            {
                continue;
            }

            if (FlagOptions.Contains(argument, StringComparer.Ordinal))
            {
                flags.Add(argument);
            }
            else if (ValueOptions.Contains(argument, StringComparer.Ordinal))
            {
                if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
                {
                    return Fail($"{argument} needs a value.");
                }

                if (!values.TryAdd(argument, args[++index]))
                {
                    return Fail($"{argument} was given twice.");
                }
            }
            else if (argument.StartsWith("--seed", StringComparison.Ordinal) || argument.StartsWith("--staff", StringComparison.Ordinal))
            {
                return Fail($"{argument} cannot be combined with {Verb}.");
            }
        }

        if (flags.Contains("--dry-run") == flags.Contains("--apply"))
        {
            return Fail("give exactly one of --dry-run and --apply.");
        }

        foreach (var required in new[] { "--expected-database", "--media-base-url", "--from" })
        {
            if (!values.ContainsKey(required))
            {
                return Fail($"{required} is required.");
            }
        }

        if (!DateOnly.TryParseExact(values["--from"], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var from))
        {
            return Fail("--from must be a date as YYYY-MM-DD.");
        }

        var days = DefaultDays;
        if (values.TryGetValue("--days", out var rawDays) &&
            !int.TryParse(rawDays, NumberStyles.None, CultureInfo.InvariantCulture, out days))
        {
            return Fail("--days must be a whole number.");
        }

        if (!RiversideSeedOptions.TryCreate(values["--media-base-url"], from, days, out var options, out var error))
        {
            return Fail(error!);
        }

        return new Parsed(null, values["--expected-database"], options, flags.Contains("--apply"));

        static Parsed Fail(string message) => new(message, null, null, false);
    }
}
