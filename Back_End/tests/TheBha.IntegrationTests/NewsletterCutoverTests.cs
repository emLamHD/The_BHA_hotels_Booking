using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
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

    private WebApplicationFactory<Program> Host() => Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
    {
        services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
        services.AddDbContext<TheBhaDbContext>(options => options
            .UseNpgsql(Factory.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
            .AddInterceptors(_gate));
    }));

    private async Task<WebApplicationFactory<Program>> StartAsync(int counter = 0, params (long Sequence, Guid Subscription, DateTimeOffset At)[] legacy)
    {
        await Factory.ResetDatabaseAsync();
        Factory.Clock.UtcNow = T0;
        foreach (var subscription in legacy.Select(row => row.Subscription).Distinct())
            await ExecAsync($"""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES ('{subscription}','{subscription:N}@example.com','homepage','Verified',now(),now())""");
        foreach (var (sequence, subscription, at) in legacy)
            await ExecAsync($"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES ({sequence},'{subscription}','{at:O}')""");
        await ExecAsync($"""UPDATE "MenuActivityStreams" SET "LastSequence" = {Math.Max(counter, legacy.Length == 0 ? 0 : (int)legacy.Max(row => row.Sequence))} WHERE "MenuKey" = 'newsletter'""");
        return Host();
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
}
