using System.Data.Common;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using TheBha.Api.Seeding;
using TheBha.Application.Website;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR14 P1 (ADR 0011 §E): the cutover transaction and its operator command against real PostgreSQL. What these pin: the table lock comes first and the clock only after it, exactly the
/// surviving legacy rows are copied with their Sequence, the marker commits with the copy or not at all, a timeout or a failure leaves nothing behind, and a run after a commit changes nothing.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class NewsletterCutoverTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-21T10:00:00Z");
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(30);

    private readonly NewsletterSqlGate _gate = new();
    private readonly CommandTimeoutProbe _probe = new();
    private readonly CommitAnswerLost _lost = new();

    /// <summary>Records the ADO.NET timeout each real command carries when it is executed (the setting that is actually in force, not the one the code meant to set).</summary>
    private sealed class CommandTimeoutProbe : DbCommandInterceptor
    {
        public readonly List<(string Sql, int Timeout)> Seen = [];

        private void Note(DbCommand command) { lock (Seen) Seen.Add((command.CommandText, command.CommandTimeout)); }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }

        public (string Sql, int Timeout)[] Of(string startsWith) { lock (Seen) return [.. Seen.Where(entry => entry.Sql.TrimStart().StartsWith(startsWith, StringComparison.Ordinal))]; }
    }

    /// <summary>
    /// Simulates "PostgreSQL committed, the caller never got the answer": <c>TransactionCommitted</c> runs AFTER the server confirmed COMMIT, and throwing there makes <c>CommitAsync</c> fail in the caller
    /// exactly as a connection lost on the way back would, while the row is really committed (a test reads it on its own connection).
    /// </summary>
    private sealed class CommitAnswerLost : DbTransactionInterceptor
    {
        public volatile Exception? Throw;

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default) =>
            Throw is { } exception ? Task.FromException(exception) : Task.CompletedTask;
    }

    private WebApplicationFactory<Program> Host(string? connectionString = null) => Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
    {
        services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
        services.AddDbContext<TheBhaDbContext>(options => options
            .UseNpgsql(connectionString ?? Factory.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
            .AddInterceptors(_gate, _probe, _lost));
    }));

    private async Task<WebApplicationFactory<Program>> StartAsync(int counter = 0, params (long Sequence, Guid Subscription, DateTimeOffset At)[] legacy) =>
        await StartWithAsync(null, counter, legacy);

    private async Task<WebApplicationFactory<Program>> StartWithAsync(string? connectionString, int counter, params (long Sequence, Guid Subscription, DateTimeOffset At)[] legacy)
    {
        await Factory.ResetDatabaseAsync();
        Factory.Clock.UtcNow = T0;
        foreach (var subscription in legacy.Select(row => row.Subscription).Distinct())
            await ExecAsync($"""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES ('{subscription}','{subscription:N}@example.com','homepage','Verified',now(),now())""");
        foreach (var (sequence, subscription, at) in legacy)
            await ExecAsync($"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES ({sequence},'{subscription}','{at:O}')""");
        await ExecAsync($"""UPDATE "MenuActivityStreams" SET "LastSequence" = {Math.Max(counter, legacy.Length == 0 ? 0 : (int)legacy.Max(row => row.Sequence))} WHERE "MenuKey" = 'newsletter'""");
        return Host(connectionString);
    }

    private static Task<NewsletterCutoverResult> RunAsync(WebApplicationFactory<Program> host, TimeSpan? timeout = null) => Task.Run(async () =>
    {
        await using var scope = host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<INewsletterActivityCutover>().RunAsync(timeout ?? Wait, CancellationToken.None);
    });

    private async Task<DateTimeOffset> InstantAsync(string sql) => new(DateTime.SpecifyKind(await ScalarAsync<DateTime>(sql), DateTimeKind.Utc));

    private async Task ExecAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>A writer that is "in flight": it holds the legacy table's ROW EXCLUSIVE lock (an uncommitted insert) until the test ends it.</summary>
    private async Task<(NpgsqlConnection Connection, NpgsqlTransaction Transaction)> InFlightWriterAsync(long sequence, Guid subscription, bool bumpCounter)
    {
        var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        var transaction = await connection.BeginTransactionAsync();
        if (bumpCounter) await using (var counter = new NpgsqlCommand($"""UPDATE "MenuActivityStreams" SET "LastSequence" = {sequence} WHERE "MenuKey" = 'newsletter'""", connection, transaction)) await counter.ExecuteNonQueryAsync();
        await using var insert = new NpgsqlCommand($"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES ({sequence},'{subscription}',now())""", connection, transaction);
        await insert.ExecuteNonQueryAsync();
        return (connection, transaction);
    }

    /// <summary>Waits until a transaction is parked on the legacy table's lock queue in that mode (never granted).</summary>
    private async Task WaitForTableLockWaitAsync(string mode)
    {
        var deadline = DateTime.UtcNow + Wait;
        while (DateTime.UtcNow < deadline)
        {
            if (await ScalarAsync<long>($"""SELECT count(*) FROM pg_locks WHERE locktype = 'relation' AND NOT granted AND relation = '"NewsletterVerificationActivities"'::regclass AND mode = '{mode}' """) > 0) return;
            await Task.Delay(50);
        }

        Assert.Fail($"nothing is waiting for {mode} on the legacy table");
    }

    private static Guid Sub(int i) => Guid.Parse($"c0000000-0000-0000-0000-0000000000{i:00}");

    [Fact]
    public async Task The_cutover_copies_exactly_the_surviving_legacy_rows_with_their_sequence_and_time_and_writes_the_marker()
    {
        // Sequences 1, 3, 5 survive; 6 was issued to a verification whose subscription was deleted (cascade), so the counter is 6 and the highest surviving row is 5.
        var host = await StartAsync(6, (1, Sub(1), T0.AddDays(-3)), (3, Sub(2), T0.AddDays(-2)), (5, Sub(3), T0.AddDays(-1)));

        var result = await RunAsync(host);

        Assert.Equal(new NewsletterCutoverResult(NewsletterCutoverStatus.Committed, 6, T0, 3), result);
        Assert.Equal(("1,3,5", 3L), (await ScalarAsync<string>("""SELECT string_agg("Sequence"::text, ',' ORDER BY "Sequence") FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' """), await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """)));
        // Every column is the one the ADR names: Public, no Staff id, no Property, verified, the subscription as the entity (canonical lower-case), a generic title, one item, no correlation, the original time.
        Assert.Equal(3, await ScalarAsync<long>(
            """
            SELECT count(*) FROM "AdminActivities" a JOIN "NewsletterVerificationActivities" n ON n."Sequence" = a."Sequence"
            WHERE a."ActorKind" = 'Public' AND a."ActorStaffId" IS NULL AND a."PropertyId" IS NULL AND a."Action" = 'verified' AND a."EntityKind" = 'subscription'
              AND a."EntityKey" = n."SubscriptionId"::text AND a."TitleSnapshot" = 'a subscription' AND a."ItemCount" = 1 AND a."CorrelationId" IS NULL AND a."OccurredAtUtc" = n."OccurredAtUtc"
            """));
        // The legacy copy, the counter and the cursors are untouched: the cutover moves nothing and acknowledges nothing.
        Assert.Equal(3, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
        Assert.Equal(6, await ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "StaffMenuSeen" """));
        // The marker keeps the counter's value under the lock (a deleted tail does not lower it) and the clock's reading.
        Assert.Equal((6L, T0), (await ScalarAsync<long>("""SELECT "LegacyMaxSequence" FROM "MenuActivityCutovers" WHERE "MenuKey" = 'newsletter' """),
            await InstantAsync("""SELECT "CutoverAtUtc" FROM "MenuActivityCutovers" WHERE "MenuKey" = 'newsletter' """)));
    }

    [Fact]
    public async Task A_run_after_the_commit_finds_the_marker_imports_nothing_and_moves_neither_value()
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)), (2, Sub(2), T0.AddDays(-1)));
        var first = await RunAsync(host);
        Factory.Clock.UtcNow = T0.AddHours(5);

        var again = await RunAsync(host);

        Assert.Equal(NewsletterCutoverStatus.AlreadyCutOver, again.Status);
        Assert.Equal((first.LegacyMaxSequence, first.CutoverAtUtc, 0), (again.LegacyMaxSequence, again.CutoverAtUtc, again.CopiedRows));
        Assert.Equal(T0, await InstantAsync("""SELECT "CutoverAtUtc" FROM "MenuActivityCutovers" """));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
    }

    [Fact]
    public async Task A_verification_deleted_before_the_cutover_is_not_copied_even_when_a_staging_copy_once_held_it()
    {
        var host = await StartAsync(2, (1, Sub(1), T0.AddDays(-1)), (2, Sub(2), T0.AddDays(-1)));
        // A dry run staged both rows in a scratch table that nothing reads …
        await ExecAsync("""CREATE TABLE "scratch_stage" AS SELECT * FROM "NewsletterVerificationActivities" """);
        // … then the second subscription is deleted: the cascade removes its legacy row.
        await ExecAsync($"""DELETE FROM "NewsletterSubscriptions" WHERE "Id" = '{Sub(2)}' """);
        try
        {
            var result = await RunAsync(host);

            Assert.Equal((NewsletterCutoverStatus.Committed, 2L, 1), (result.Status, result.LegacyMaxSequence, result.CopiedRows));
            Assert.Equal(0, await ScalarAsync<long>($"""SELECT count(*) FROM "AdminActivities" WHERE "EntityKey" = '{Sub(2)}' """));
            Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "scratch_stage" """));          // staging was never an input
        }
        finally
        {
            await ExecAsync("""DROP TABLE IF EXISTS "scratch_stage" """);
        }
    }

    [Fact]
    public async Task A_writer_in_flight_makes_the_cutover_wait_and_is_then_included_and_the_clock_is_read_after_the_lock()
    {
        var host = await StartAsync(1, (1, Sub(1), T0.AddDays(-1)));
        await ExecAsync($"""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES ('{Sub(9)}','late@example.com','homepage','Verified',now(),now())""");
        var (connection, transaction) = await InFlightWriterAsync(2, Sub(9), bumpCounter: true);   // a verification that took number 2 and has not committed
        await using var _ = connection;
        await using var __ = transaction;

        var cutover = RunAsync(host);
        await WaitForTableLockWaitAsync("ShareRowExclusiveLock");
        Assert.False(cutover.IsCompleted);
        Factory.Clock.UtcNow = T0.AddMinutes(7);                                                    // time passes while the cutover waits for the lock
        await transaction.CommitAsync();

        var result = await cutover.WaitAsync(Wait);
        Assert.Equal((NewsletterCutoverStatus.Committed, 2L, 2), (result.Status, result.LegacyMaxSequence, result.CopiedRows));
        Assert.Equal(T0.AddMinutes(7), result.CutoverAtUtc);                                       // read after the table lock was granted, not at the start of the transaction
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
    }

    [Fact]
    public async Task A_lock_timeout_rolls_back_cleanly_and_a_later_run_succeeds()
    {
        var host = await StartAsync(1, (1, Sub(1), T0.AddDays(-1)));
        await ExecAsync($"""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES ('{Sub(9)}','late@example.com','homepage','Verified',now(),now())""");
        var (connection, transaction) = await InFlightWriterAsync(2, Sub(9), bumpCounter: false);
        await using var _ = connection;
        await using var __ = transaction;

        var timedOut = await RunAsync(host, TimeSpan.FromSeconds(1));

        Assert.Equal(new NewsletterCutoverResult(NewsletterCutoverStatus.LockTimeout, null, null, 0), timedOut);
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
        await transaction.RollbackAsync();                                                           // the in-flight writer gives up: its row never existed

        var later = await RunAsync(host);
        Assert.Equal((NewsletterCutoverStatus.Committed, 1L, 1), (later.Status, later.LegacyMaxSequence, later.CopiedRows));
    }

    [Fact]
    public async Task Shared_Newsletter_rows_without_a_marker_abort_and_nothing_is_merged()
    {
        var host = await StartAsync(1, (1, Sub(1), T0.AddDays(-1)));
        await ExecAsync(
            """INSERT INTO "AdminActivities" ("MenuKey","Sequence","Id","ActorKind","Action","EntityKind","EntityKey","TitleSnapshot","ItemCount","OccurredAtUtc") VALUES ('newsletter',99,gen_random_uuid(),'Public','verified','subscription','x','a subscription',1,now())""");

        var result = await RunAsync(host);

        Assert.Equal(new NewsletterCutoverResult(NewsletterCutoverStatus.SharedRowsWithoutMarker, null, null, 0), result);
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));          // still only the stray row: the legacy row was not copied beside it
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
    }

    [Fact]
    public async Task A_failure_after_the_copy_and_before_the_marker_rolls_back_both_and_a_run_again_succeeds()
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)), (2, Sub(2), T0.AddDays(-1)));
        await ExecAsync(
            """
            CREATE FUNCTION "test_refuse_marker"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'marker refused (test)'; END $$;
            CREATE TRIGGER "test_refuse_marker" BEFORE INSERT ON "MenuActivityCutovers" FOR EACH ROW EXECUTE FUNCTION "test_refuse_marker"();
            """);
        try
        {
            await Assert.ThrowsAsync<PostgresException>(() => RunAsync(host));
            Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));      // the copy is gone with the marker that never came
            Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
            Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
        }
        finally
        {
            await ExecAsync("""DROP TRIGGER "test_refuse_marker" ON "MenuActivityCutovers"; DROP FUNCTION "test_refuse_marker"();""");
        }

        var again = await RunAsync(host);
        Assert.Equal((NewsletterCutoverStatus.Committed, 2), (again.Status, again.CopiedRows));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
    }

    [Fact]
    public async Task A_reader_sees_the_marker_and_the_copy_together_or_not_at_all()
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)), (2, Sub(2), T0.AddDays(-1)));
        var parked = _gate.Arm(sql => sql.StartsWith("INSERT INTO \"MenuActivityCutovers\"", StringComparison.Ordinal));   // after the copy, before the marker
        const string both = """SELECT (SELECT count(*) FROM "MenuActivityCutovers")::text || '/' || (SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter')::text""";
        try
        {
            var cutover = RunAsync(host);
            await parked.Arrived.WaitAsync(Wait);

            Assert.Equal("0/0", await ScalarAsync<string>(both));                                    // neither: the copy is uncommitted too
            parked.Release();
            await cutover.WaitAsync(Wait);
            Assert.Equal("1/2", await ScalarAsync<string>(both));                                    // both
        }
        finally
        {
            _gate.ReleaseAll();
        }
    }

    [Fact]
    public async Task The_command_refuses_without_every_confirmation_and_for_another_database_and_touches_nothing()
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)));
        var database = Factory.DatabaseName;
        string[] full = [NewsletterActivityCutoverCommand.Verb, "--expected-database", database, NewsletterActivityCutoverCommand.ConfirmRetired, NewsletterActivityCutoverCommand.ConfirmNoStaff];

        async Task<(int, string)> Run(string[] args)
        {
            var writer = new StringWriter();
            return (await NewsletterActivityCutoverCommand.RunAsync(args, host.Services, "Production", writer, CancellationToken.None), writer.ToString());
        }

        var refusals = new[]
        {
            full.Where(a => a != "--expected-database" && a != database).ToArray(),                                      // no database named
            full.Where(a => a != NewsletterActivityCutoverCommand.ConfirmRetired).ToArray(),                              // older API instances not confirmed retired
            full.Where(a => a != NewsletterActivityCutoverCommand.ConfirmNoStaff).ToArray(),                              // Staff creation not ruled out
            [.. full, "--lock-timeout-seconds", "0"], [.. full, "--lock-timeout-seconds", "601"], [.. full, "--lock-timeout-seconds", "x"],
            [NewsletterActivityCutoverCommand.Verb],
        };
        foreach (var args in refusals)
        {
            var (exit, output) = await Run(args);
            Assert.Equal(RiversideDemoSeedCommand.UsageError, exit);
            Assert.Contains("Nothing was changed", output, StringComparison.Ordinal);
        }

        var (wrongExit, wrongOutput) = await Run([NewsletterActivityCutoverCommand.Verb, "--expected-database", "some_other_db", NewsletterActivityCutoverCommand.ConfirmRetired, NewsletterActivityCutoverCommand.ConfirmNoStaff]);
        Assert.Equal(RiversideDemoSeedCommand.TargetRefused, wrongExit);
        Assert.Contains("Nothing was changed", wrongOutput, StringComparison.Ordinal);
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));

        // Every confirmation given: it runs once, and a second run only reports the marker.
        var (okExit, okOutput) = await Run(full);
        Assert.Equal(RiversideDemoSeedCommand.Success, okExit);
        Assert.Contains("COMMITTED", okOutput, StringComparison.Ordinal);
        Assert.DoesNotContain("Password", okOutput, StringComparison.OrdinalIgnoreCase);
        var (againExit, againOutput) = await Run(full);
        Assert.Equal(RiversideDemoSeedCommand.Success, againExit);
        Assert.Contains("ALREADY DONE", againOutput, StringComparison.Ordinal);
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
    }

    [Fact]
    public async Task Neither_startup_nor_a_host_that_serves_requests_runs_the_cutover()
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)));
        using var client = CreateHttpsClient(host);
        await client.GetAsync("/health");
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
    }

    // ---------------------------------------------------------------------------------------------------------- C1: command timeout

    [Theory]
    [InlineData(45)]
    [InlineData(600)]
    public async Task The_ADO_command_timeout_is_longer_than_the_lock_timeout_for_the_lock_and_the_counter_and_is_restored_afterwards(int lockSeconds)
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)));
        await using var scope = host.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        context.Database.SetCommandTimeout(7);                                                                     // a value in use before the cutover: it must come back

        var result = await scope.ServiceProvider.GetRequiredService<INewsletterActivityCutover>().RunAsync(TimeSpan.FromSeconds(lockSeconds), CancellationToken.None);

        Assert.Equal(NewsletterCutoverStatus.Committed, result.Status);
        var expected = lockSeconds + 30;                                                                           // the documented 30 s buffer
        Assert.All(_probe.Of("LOCK TABLE"), entry => Assert.Equal(expected, entry.Timeout));
        Assert.All(_probe.Of("SELECT \"LastSequence\""), entry => Assert.Equal(expected, entry.Timeout));        // SELECT … FOR UPDATE on the counter
        Assert.Single(_probe.Of("LOCK TABLE"));
        Assert.Single(_probe.Of("SELECT \"LastSequence\""));
        Assert.All(_probe.Of("SET LOCAL lock_timeout"), entry => Assert.Equal(expected, entry.Timeout));
        Assert.True(expected > lockSeconds);
        Assert.Equal(7, context.Database.GetCommandTimeout());                                                     // restored for a context that is used again
        await context.Database.ExecuteSqlRawAsync("SELECT 1");
        Assert.Equal(7, _probe.Of("SELECT 1").Last().Timeout);
    }

    [Fact]
    public async Task The_server_gives_up_first_with_55P03_even_when_the_application_default_command_timeout_is_shorter_than_the_lock_wait()
    {
        // The whole application runs with a 1 s command timeout here; the cutover asks for a 3 s lock wait. Without its own longer command timeout the CLIENT would cut the wait at 1 s (a transport
        // error); with it the SERVER answers 55P03 at 3 s and the command reports LOCK TIMEOUT.
        var connectionString = new NpgsqlConnectionStringBuilder(Factory.ConnectionString) { CommandTimeout = 1 }.ConnectionString;
        var host = await StartWithAsync(connectionString, 1, (1, Sub(1), T0.AddDays(-1)));
        await ExecAsync($"""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES ('{Sub(9)}','late@example.com','homepage','Verified',now(),now())""");
        var (connection, transaction) = await InFlightWriterAsync(2, Sub(9), bumpCounter: false);
        await using var _ = connection;
        await using var __ = transaction;

        var writer = new StringWriter();
        var started = DateTime.UtcNow;
        var exit = await NewsletterActivityCutoverCommand.RunAsync(
            [NewsletterActivityCutoverCommand.Verb, "--expected-database", Factory.DatabaseName, NewsletterActivityCutoverCommand.ConfirmRetired, NewsletterActivityCutoverCommand.ConfirmNoStaff, "--lock-timeout-seconds", "3"],
            host.Services, "Development", writer, CancellationToken.None);

        Assert.Equal(RiversideDemoSeedCommand.Failure, exit);
        Assert.Contains("LOCK TIMEOUT after 3s", writer.ToString(), StringComparison.Ordinal);
        Assert.Contains("55P03", writer.ToString(), StringComparison.Ordinal);
        Assert.True(DateTime.UtcNow - started >= TimeSpan.FromSeconds(2.5), "the lock wait was cut short by something other than the server's lock_timeout");
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
    }

    // ---------------------------------------------------------------------------------------------------------- C1: an unknown COMMIT outcome

    [Fact]
    public async Task A_commit_that_PostgreSQL_made_but_whose_answer_was_lost_is_reported_UNKNOWN_and_a_run_again_finds_the_marker_and_changes_nothing()
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)), (2, Sub(2), T0.AddDays(-1)));
        string[] args = [NewsletterActivityCutoverCommand.Verb, "--expected-database", Factory.DatabaseName, NewsletterActivityCutoverCommand.ConfirmRetired, NewsletterActivityCutoverCommand.ConfirmNoStaff];
        async Task<(int, string)> Run()
        {
            var writer = new StringWriter();
            return (await NewsletterActivityCutoverCommand.RunAsync(args, host.Services, "Production", writer, CancellationToken.None), writer.ToString());
        }

        _lost.Throw = new NpgsqlException("connection lost after COMMIT (test)", new IOException("broken pipe"));
        var (exit, output) = await Run();
        _lost.Throw = null;

        Assert.Equal(NewsletterActivityCutoverCommand.OutcomeUnknown, exit);
        Assert.NotEqual(RiversideDemoSeedCommand.Success, exit);
        Assert.Contains("OUTCOME UNKNOWN", output, StringComparison.Ordinal);
        Assert.Contains("does NOT retry", output, StringComparison.Ordinal);
        Assert.Contains("MenuActivityCutovers", output, StringComparison.Ordinal);                                 // tells the operator what to check, on a new connection
        Assert.DoesNotContain("COMMITTED", output, StringComparison.Ordinal);
        Assert.DoesNotContain("rolled back", output, StringComparison.OrdinalIgnoreCase);
        // The simulation is faithful: the server really committed (read here on a separate connection).
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' """));
        var marker = (await ScalarAsync<long>("""SELECT "LegacyMaxSequence" FROM "MenuActivityCutovers" """), await InstantAsync("""SELECT "CutoverAtUtc" FROM "MenuActivityCutovers" """));

        Factory.Clock.UtcNow = T0.AddHours(5);
        var (againExit, againOutput) = await Run();

        Assert.Equal(RiversideDemoSeedCommand.Success, againExit);
        Assert.Contains("ALREADY DONE", againOutput, StringComparison.Ordinal);
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' """));      // nothing copied twice
        Assert.Equal(marker, (await ScalarAsync<long>("""SELECT "LegacyMaxSequence" FROM "MenuActivityCutovers" """), await InstantAsync("""SELECT "CutoverAtUtc" FROM "MenuActivityCutovers" """)));
    }

    [Fact]
    public async Task Every_way_the_COMMIT_answer_can_fail_to_arrive_is_unknown_never_committed_and_never_rolled_back()
    {
        foreach (Exception failure in new Exception[] { new NpgsqlException("lost", new IOException("reset")), new TimeoutException("commit timed out"), new OperationCanceledException("cancelled") })
        {
            var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)));
            _lost.Throw = failure;
            NewsletterCutoverResult result;
            try
            {
                result = await RunAsync(host);
            }
            finally
            {
                _lost.Throw = null;
            }

            Assert.Equal(new NewsletterCutoverResult(NewsletterCutoverStatus.OutcomeUnknown, null, null, 0), result);
            Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));            // it did commit; the status makes no claim either way
        }
    }

    [Fact]
    public async Task A_rollback_the_server_confirmed_is_reported_as_not_committed_with_its_SQLSTATE_and_never_as_unknown()
    {
        var host = await StartAsync(0, (1, Sub(1), T0.AddDays(-1)));
        await ExecAsync(
            """
            CREATE FUNCTION "test_refuse_marker"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'marker refused (test)'; END $$;
            CREATE TRIGGER "test_refuse_marker" BEFORE INSERT ON "MenuActivityCutovers" FOR EACH ROW EXECUTE FUNCTION "test_refuse_marker"();
            """);
        try
        {
            var writer = new StringWriter();
            var exit = await NewsletterActivityCutoverCommand.RunAsync(
                [NewsletterActivityCutoverCommand.Verb, "--expected-database", Factory.DatabaseName, NewsletterActivityCutoverCommand.ConfirmRetired, NewsletterActivityCutoverCommand.ConfirmNoStaff],
                host.Services, "Development", writer, CancellationToken.None);

            Assert.Equal(RiversideDemoSeedCommand.Failure, exit);
            Assert.Contains("SQLSTATE P0001", writer.ToString(), StringComparison.Ordinal);
            Assert.Contains("was not committed", writer.ToString(), StringComparison.Ordinal);
            Assert.DoesNotContain("OUTCOME UNKNOWN", writer.ToString(), StringComparison.Ordinal);
            Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
            Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
        }
        finally
        {
            await ExecAsync("""DROP TRIGGER "test_refuse_marker" ON "MenuActivityCutovers"; DROP FUNCTION "test_refuse_marker"();""");
        }
    }
}
