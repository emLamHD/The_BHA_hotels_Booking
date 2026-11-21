using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using TheBha.Api;
using TheBha.Application.Activity;
using TheBha.Application.Website;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR14 P2 (ADR 0011 §E): the Newsletter's source switch on the real HTTP pipeline and real PostgreSQL. The badge, the unseen list, the history and the acknowledgement read the marker in the
/// same statement as their data; verification and Staff writes choose their source after the legacy-table lock; the one-time D2 exception keeps what existing Staff see; and the cutover interleaves with
/// writers without a deadlock or a timeout. Barriers are real SQL statements parked by <see cref="NewsletterSqlGate"/> and lock waits observed in <c>pg_locks</c>.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class NewsletterCutoverSourceTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Public = "/api/v1/website/newsletter-subscriptions";
    private const string Admin = "/api/admin/v1/website/newsletter-subscriptions";
    private const string Shared = "/api/admin/v1/menu-unseen";
    private const string Legacy = "/api/admin/v1/website/menu-unseen";
    private const string CustomerOrigin = "https://localhost:3000";
    private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-21T10:00:00Z");
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(30);

    private sealed record HintCall(string Menu, Guid? Property, bool TransactionOpen);

    /// <summary>Records every hint and whether the caller's transaction was still open when it was sent (it must never be).</summary>
    private sealed class RecordingHint(TheBhaDbContext database, ConcurrentQueue<HintCall> calls) : IAdminActivityHint
    {
        public Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken)
        {
            calls.Enqueue(new HintCall(menuKey, propertyId, database.Database.CurrentTransaction is not null));
            return Task.CompletedTask;
        }
    }

    private sealed class TransactionCounter : DbTransactionInterceptor
    {
        private int _started;
        public int Started => _started;

        public override ValueTask<DbTransaction> TransactionStartedAsync(DbConnection connection, TransactionEndEventData eventData, DbTransaction result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _started);
            return ValueTask.FromResult(result);
        }
    }

    private sealed class CommitFailure : DbTransactionInterceptor
    {
        public volatile bool Armed;

        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction, TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default) =>
            Armed ? throw new InvalidOperationException("COMMIT refused (test)") : ValueTask.FromResult(result);
    }

    private sealed class Env(WebApplicationFactory<Program> host, HttpClient client, string site, string desk, string manager, Guid propertyId, NewsletterSqlGate gate, TransactionCounter transactions, CommitFailure commit, ConcurrentQueue<HintCall> hints) : IDisposable
    {
        public WebApplicationFactory<Program> Host { get; } = host;
        public HttpClient Client { get; } = client;
        public string Site { get; } = site;               // Staff A: website permission
        public string Desk { get; } = desk;               // never has it
        public string Manager { get; set; } = manager;    // Staff B: website permission once granted
        public Guid PropertyId { get; } = propertyId;
        public NewsletterSqlGate Gate { get; } = gate;
        public TransactionCounter Transactions { get; } = transactions;
        public CommitFailure Commit { get; } = commit;
        public ConcurrentQueue<HintCall> Hints { get; } = hints;

        public void Dispose()
        {
            Gate.ReleaseAll();
            Client.Dispose();
            Host.Dispose();
        }
    }

    private async Task<Env> BeginAsync(int lockTimeoutMs = 30_000)
    {
        var gate = new NewsletterSqlGate();
        var transactions = new TransactionCounter();
        var commit = new CommitFailure();
        var hints = new ConcurrentQueue<HintCall>();
        var connectionString = new NpgsqlConnectionStringBuilder(Factory.ConnectionString) { Options = $"-c lock_timeout={lockTimeoutMs}" }.ConnectionString;
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, nameof(AdminCalendarAccessMode.Staff));
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", CustomerOrigin);
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.UseSetting("Website:Newsletter:RateLimiting:PermitLimit", "10000");
            builder.ConfigureLogging(logging => logging.SetMinimumLevel(LogLevel.Critical));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
                services.AddDbContext<TheBhaDbContext>(options => options
                    .UseNpgsql(connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
                    .AddInterceptors(gate, transactions, commit));
                services.RemoveAll<IAdminActivityHint>();
                services.AddScoped<IAdminActivityHint>(provider => new RecordingHint(provider.GetRequiredService<TheBhaDbContext>(), hints));
            });
        });
        Factory.Clock.UtcNow = T0;                                  // the Staff accounts are created at T0
        var property = await SeedStaffAsync(host);
        var client = CreateHttpsClient(host);
        return new Env(host, client, await LoginAsync(client, Site), await LoginAsync(client, Desk), await LoginAsync(client, Manager), property, gate, transactions, commit, hints);
    }

    // ---------------------------------------------------------------------------------------------------------- fixtures and probes

    private async Task ExecAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static Guid Sub(int i) => Guid.Parse($"c0000000-0000-0000-0000-0000000000{i:00}");

    /// <summary>A verification as the legacy side stored it (the fence is inert before the marker): a Verified subscription, its legacy row with that Sequence and the counter moved up to it.</summary>
    private async Task AddLegacyAsync(long sequence, Guid subscription, DateTimeOffset at)
    {
        await ExecAsync($"""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES ('{subscription}','{subscription:N}@example.com','homepage','Verified',now(),now()) ON CONFLICT DO NOTHING""");
        await ExecAsync($"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES ({sequence},'{subscription}','{at:O}')""");
        await ExecAsync($"""UPDATE "MenuActivityStreams" SET "LastSequence" = GREATEST("LastSequence", {sequence}) WHERE "MenuKey" = 'newsletter'""");
    }

    private Task SetCursorAsync(string email, long sequence) => ExecAsync(
        $"""INSERT INTO "StaffMenuSeen" ("StaffAccountId","MenuKey","LastSeenSequence","UpdatedAtUtc") SELECT "Id",'newsletter',{sequence},now() FROM "StaffAccounts" WHERE "NormalizedEmail" = '{email.ToUpperInvariant()}'""");

    /// <summary>A pending address with a confirmation link whose token the test knows: pressing it is one real verification.</summary>
    private async Task<(Guid Id, string Token)> PendingAsync(string email)
    {
        var id = Guid.NewGuid();
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
        var now = Factory.Clock.UtcNow;
        await ExecAsync($"""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES ('{id}','{email}','homepage','PendingVerification','{now:O}')""");
        await ExecAsync(
            $"""
            INSERT INTO "NewsletterVerificationRequests" ("Id","SubscriptionId","TokenHash","Language","Status","Attempts","CreatedAtUtc","ExpiresAtUtc","NextAttemptAtUtc")
            VALUES (gen_random_uuid(),'{id}','{hash}','vi','Pending',0,'{now:O}','{now.AddDays(1):O}','{now:O}')
            """);
        return (id, token);
    }

    private static Task<HttpResponseMessage> ConfirmAsync(Env e, string token) => e.Client.SendAsync(Post(Public + "/confirmations", new { token }, origins: [CustomerOrigin]));

    private async Task<string> VerifyAsync(Env e, string email)
    {
        var (_, token) = await PendingAsync(email);
        var response = await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, token));
        return (await JsonAsync(response)).GetProperty("status").GetString()!;
    }

    private static async Task<(int Count, string Last, string Current)> SharedAsync(Env e, string cookie)
    {
        var entry = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(Shared, cookie))))).GetProperty("menus").GetProperty("newsletter");
        return (entry.GetProperty("count").GetInt32(), entry.GetProperty("lastSeenWatermark").GetString()!, entry.GetProperty("currentWatermark").GetString()!);
    }

    private static async Task<(int Count, string Last, string Current)> LegacyAsync(Env e, string cookie)
    {
        var entry = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(Legacy, cookie))))).GetProperty("newsletter");
        return (entry.GetProperty("count").GetInt32(), entry.GetProperty("lastSeenWatermark").GetString()!, entry.GetProperty("currentWatermark").GetString()!);
    }

    /// <summary>The number as the shared route says it, after checking that the legacy route (the adapter) says exactly the same.</summary>
    private static async Task<(int Count, string Last, string Current)> NumberAsync(Env e, string cookie)
    {
        var shared = await SharedAsync(e, cookie);
        Assert.Equal(shared, await LegacyAsync(e, cookie));
        return shared;
    }

    private static async Task<NewsletterCutoverResult> CutoverAsync(Env e, TimeSpan? timeout = null) => await Task.Run(async () =>
    {
        await using var scope = e.Host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<INewsletterActivityCutover>().RunAsync(timeout ?? Wait, CancellationToken.None);
    });

    private async Task GrantManagerAsync(Env e) => await CliAsync(e.Host, ["--staff-website-access", "--email", Manager, "--enabled", "true"]);

    private async Task<int> VersionAsync(Guid id) => await ScalarAsync<int>($"""SELECT "Version" FROM "NewsletterSubscriptions" WHERE "Id" = '{id}' """);

    private Task<HttpResponseMessage> DeleteAsync(Env e, Guid id, int version, string? cookie = null) => e.Client.SendAsync(Post($"{Admin}/{id}/delete", new { expectedVersion = version }, cookie ?? e.Site));

    private Task<long> SharedRowsAsync() => ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' """);
    private Task<long> LegacyRowsAsync() => ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """);
    private Task<long> CounterAsync() => ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """);

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

    private static bool LegacyInsert(string sql) => sql.StartsWith("INSERT INTO \"NewsletterVerificationActivities\"", StringComparison.Ordinal);

    // ---------------------------------------------------------------------------------------------------------- group 1: deleted before the cutover

    [Fact]
    public async Task A_verification_deleted_before_the_cutover_reads_0_before_and_0_after_at_the_same_cursor_even_when_staged_and_no_event_is_written_for_the_delete()
    {
        using var e = await BeginAsync();
        await AddLegacyAsync(1, Sub(1), T0.AddHours(1));
        await ExecAsync("""CREATE TABLE "scratch_stage" AS SELECT * FROM "NewsletterVerificationActivities" """);   // a dry run staged it
        try
        {
            Assert.Equal((1, "0", "1"), await NumberAsync(e, e.Site));
            Assert.Equal(HttpStatusCode.NoContent, (await DeleteAsync(e, Sub(1), await VersionAsync(Sub(1)))).StatusCode);   // the cascade removes the legacy row; before the marker nothing else is written
            Assert.Equal(0L, await SharedRowsAsync());
            Assert.Empty(e.Hints);                                                                                              // nothing was recorded, so nothing is hinted
            Assert.Equal((0, "0", "1"), await NumberAsync(e, e.Site));                                                          // legacy count immediately before the cutover

            var result = await CutoverAsync(e);

            Assert.Equal((NewsletterCutoverStatus.Committed, 1L, 0), (result.Status, result.LegacyMaxSequence, result.CopiedRows));
            Assert.Equal((0, "0", "1"), await NumberAsync(e, e.Site));                                                          // shared count immediately after: the same
            Assert.Equal(0L, await SharedRowsAsync());
            Assert.Equal(1L, await ScalarAsync<long>("""SELECT count(*) FROM "scratch_stage" """));                              // staging was never an input
        }
        finally
        {
            await ExecAsync("""DROP TABLE IF EXISTS "scratch_stage" """);
        }
    }

    [Fact]
    public async Task A_delete_in_flight_when_the_cutover_starts_makes_it_wait_and_the_deleted_verification_is_not_copied()
    {
        using var e = await BeginAsync();
        await AddLegacyAsync(1, Sub(1), T0.AddHours(1));
        await AddLegacyAsync(2, Sub(2), T0.AddHours(1));
        var version = await VersionAsync(Sub(1));
        var parked = e.Gate.Arm(sql => sql.StartsWith("DELETE FROM \"NewsletterSubscriptions\"", StringComparison.Ordinal), afterRead: true);   // the cascade has run and holds the table lock; the commit has not happened

        var delete = DeleteAsync(e, Sub(1), version);
        await parked.Arrived.WaitAsync(Wait);
        var cutover = CutoverAsync(e);
        await WaitForTableLockWaitAsync("ShareRowExclusiveLock");
        Assert.False(cutover.IsCompleted);

        parked.Release();
        Assert.Equal(HttpStatusCode.NoContent, (await delete.WaitAsync(Wait)).StatusCode);
        var result = await cutover.WaitAsync(Wait);

        Assert.Equal((NewsletterCutoverStatus.Committed, 2L, 1), (result.Status, result.LegacyMaxSequence, result.CopiedRows));
        Assert.Equal(0L, await ScalarAsync<long>($"""SELECT count(*) FROM "AdminActivities" WHERE "EntityKey" = '{Sub(1)}' """));
        Assert.Equal(0L, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "ActorKind" = 'Staff' """));   // the delete decided "before the marker" after its wait, so it wrote nothing
        Assert.Equal((1, "0", "2"), await NumberAsync(e, e.Site));
    }

    // ---------------------------------------------------------------------------------------------------------- group 2: preserved for Staff who existed, plain D2 for later ones

    [Fact]
    public async Task Existing_Staff_keep_every_still_existing_legacy_event_with_or_without_a_cursor_and_a_later_Staff_member_follows_D2()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);                                                       // B: existed at T0, no cursor row ever
        await AddLegacyAsync(1, Sub(1), T0.AddDays(-10));                                 // older than every account
        await AddLegacyAsync(2, Sub(2), T0.AddDays(-5));
        await AddLegacyAsync(3, Sub(3), T0.AddHours(1));
        await SetCursorAsync(Site, 1);                                                    // A: a cursor at 1

        Assert.Equal((2, "1", "3"), await NumberAsync(e, e.Site));
        Assert.Equal((3, "0", "3"), await NumberAsync(e, e.Manager));
        Factory.Clock.UtcNow = T0.AddHours(2);

        var result = await CutoverAsync(e);

        Assert.Equal((NewsletterCutoverStatus.Committed, 3L, 3), (result.Status, result.LegacyMaxSequence, result.CopiedRows));
        Assert.Equal((2, "1", "3"), await NumberAsync(e, e.Site));                        // the same events, the same cursor, the same number
        Assert.Equal((3, "0", "3"), await NumberAsync(e, e.Manager));                     // an event older than the account is kept; a missing cursor row does not mean a new account
        Assert.Equal(1L, await ScalarAsync<long>("""SELECT count(*) FROM "StaffMenuSeen" """));   // no cursor was raised or created to get there
        Assert.Equal(3L, await ScalarAsync<long>("""SELECT count(DISTINCT "Sequence") FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' AND "Sequence" IN (1,2,3) """));

        // A Staff member created AFTER the cutover has no backlog, not even for the legacy Sequence values.
        Factory.Clock.UtcNow = T0.AddHours(3);
        await CliAsync(e.Host, ["--staff-create", "--email", "late@example.com", "--property-id", e.PropertyId.ToString(), "--role", StaffRole.FrontDesk], Password);
        await CliAsync(e.Host, ["--staff-website-access", "--email", "late@example.com", "--enabled", "true"]);
        var late = await LoginAsync(e.Client, "late@example.com");
        Assert.Equal((0, "0", "3"), await NumberAsync(e, late));

        // The sequence restarts from the old counter (no rewind, no collision), and the new event counts for everyone, the latecomer included (OccurredAtUtc ≥ their account).
        Factory.Clock.UtcNow = T0.AddHours(4);
        Assert.Equal("verified", await VerifyAsync(e, "after@example.com"));
        Assert.Equal(4L, await CounterAsync());
        Assert.Equal(4L, await ScalarAsync<long>("""SELECT max("Sequence") FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' """));
        Assert.Equal(0L, await LegacyRowsAsync() - 3);                                    // the legacy copy kept its three rows and took no fourth (the fence forbids it)
        Assert.Equal((3, "1", "4"), await NumberAsync(e, e.Site));
        Assert.Equal((4, "0", "4"), await NumberAsync(e, e.Manager));
        Assert.Equal((1, "0", "4"), await NumberAsync(e, late));
    }

    // ---------------------------------------------------------------------------------------------------------- group 3: deleted after the cutover

    [Fact]
    public async Task After_the_cutover_deleting_a_subscription_keeps_the_imported_record_and_adds_exactly_one_delete_event_without_personal_data()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);
        await AddLegacyAsync(1, Sub(1), T0.AddHours(1));
        Factory.Clock.UtcNow = T0.AddHours(2);
        await CutoverAsync(e);
        Assert.Equal((1, "0", "1"), await NumberAsync(e, e.Manager));                    // B: at a cursor below the verification, nothing else above it
        var subscriptionEmail = await ScalarAsync<string>($"""SELECT "Email" FROM "NewsletterSubscriptions" WHERE "Id" = '{Sub(1)}' """);
        var staffA = await StaffIdAsync(Site);

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAsync(e, Sub(1), await VersionAsync(Sub(1)))).StatusCode);

        Assert.Equal((2, "0", "2"), await NumberAsync(e, e.Manager));                    // the old verification AND the new delete, at the same cursor
        Assert.Equal((1, "0", "2"), await NumberAsync(e, e.Site));                       // A's own action does not count for A
        Assert.Equal(2L, await SharedRowsAsync());                                         // grown by exactly one
        Assert.Equal(0L, await LegacyRowsAsync());                                         // the cascade removed only the legacy copy
        Assert.Equal(1L, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' AND "Sequence" = 1 AND "ActorKind" = 'Public' """));   // the imported record is untouched
        Assert.Equal(1L, await ScalarAsync<long>(
            $"""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' AND "Sequence" = 2 AND "ActorKind" = 'Staff' AND "ActorStaffId" = '{staffA}' AND "Action" = 'Deleted' AND "EntityKind" = 'subscription' AND "EntityKey" = '{Sub(1)}' AND "TitleSnapshot" = 'a subscription' """));
        // The hint goes out once, after the commit, with nothing but the menu key.
        Assert.Equal([new HintCall("newsletter", null, false)], e.Hints.ToArray());
        // Nothing personal reaches the activity, the hint or either route's answer.
        Assert.Equal(0L, await ScalarAsync<long>($"""SELECT count(*) FROM "AdminActivities" a WHERE a::text ILIKE '%@%' OR a::text ILIKE '%{subscriptionEmail}%' """));
        foreach (var path in new[] { Shared, Legacy, $"{Shared}/newsletter/changes", $"/api/admin/v1/activity?menu=newsletter" })
            Assert.DoesNotContain("@", await (await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(path, e.Manager)))).Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Before_the_marker_Staff_changes_write_no_activity_and_send_no_hint_and_after_it_each_real_change_is_exactly_one_Staff_event()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);

        // Before: create, update and delete leave no activity row and no hint (the legacy table has no Staff column, and a shared row without a marker would make the cutover abort).
        var created = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, e.Client.SendAsync(Post(Admin, new { email = "pre@example.com", language = "vi" }, e.Site))));
        var preId = created.GetProperty("id").GetGuid();
        await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post($"{Admin}/{preId}/update", new { expectedVersion = created.GetProperty("version").GetInt32(), language = "en" }, e.Site)));
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAsync(e, preId, await VersionAsync(preId))).StatusCode);
        Assert.Equal(0L, await SharedRowsAsync());
        Assert.Empty(e.Hints);
        Assert.Equal((0, "0", "0"), await NumberAsync(e, e.Manager));
        await CutoverAsync(e);

        // After: one event per real change.
        var made = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Created, e.Client.SendAsync(Post(Admin, new { email = "post@example.com", language = "vi" }, e.Site))));
        var id = made.GetProperty("id").GetGuid();
        Assert.Equal(1L, await SharedRowsAsync());
        Assert.Equal((1, "0", "1"), await NumberAsync(e, e.Manager));                       // another person's add counts for B …
        Assert.Equal((0, "0", "1"), await NumberAsync(e, e.Site));                          // … and not for A, who did it

        var version = made.GetProperty("version").GetInt32();
        var noOp = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post($"{Admin}/{id}/update", new { expectedVersion = version, language = "vi" }, e.Site)));   // same value: nothing changed
        Assert.Equal(version, (await JsonAsync(noOp)).GetProperty("version").GetInt32());
        Assert.Equal(HttpStatusCode.Conflict, (await e.Client.SendAsync(Post($"{Admin}/{id}/update", new { expectedVersion = version + 7, language = "en" }, e.Site))).StatusCode);   // stale
        Assert.Equal(HttpStatusCode.Conflict, (await e.Client.SendAsync(Post(Admin, new { email = "post@example.com", language = "vi" }, e.Site))).StatusCode);                       // duplicate address
        Assert.Equal(1L, await SharedRowsAsync());                                          // none of the three wrote anything

        await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post($"{Admin}/{id}/update", new { expectedVersion = version, language = "fr" }, e.Site)));
        Assert.Equal(2L, await SharedRowsAsync());
        Assert.Equal("Updated", await ScalarAsync<string>("""SELECT "Action" FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' AND "Sequence" = 2 """));
        // Unsubscribe and archive are not in the ADR's list (add, update, delete): they record nothing.
        var current = await VersionAsync(id);
        await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post($"{Admin}/{id}/archive", new { expectedVersion = current }, e.Site)));
        Assert.Equal(2L, await SharedRowsAsync());

        // A commit that fails leaves the subscription, the counter and the hint count as they were.
        var hintsBefore = e.Hints.Count;
        var counterBefore = await CounterAsync();
        e.Commit.Armed = true;
        try
        {
            Assert.Equal(HttpStatusCode.InternalServerError, (await DeleteAsync(e, id, await VersionAsync(id))).StatusCode);
        }
        finally
        {
            e.Commit.Armed = false;
        }

        Assert.Equal(1L, await ScalarAsync<long>($"""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "Id" = '{id}' """));
        Assert.Equal((counterBefore, hintsBefore, 2L), (await CounterAsync(), e.Hints.Count, await SharedRowsAsync()));

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAsync(e, id, await VersionAsync(id))).StatusCode);
        Assert.Equal(3L, await SharedRowsAsync());
        Assert.Equal("Created,Updated,Deleted", await ScalarAsync<string>("""SELECT string_agg("Action", ',' ORDER BY "Sequence") FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' """));
        Assert.All(e.Hints, hint => Assert.Equal(new HintCall("newsletter", null, false), hint));
        Assert.Equal(0L, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "TitleSnapshot" <> 'a subscription' OR "ActorKind" <> 'Staff' """));
    }

    // ---------------------------------------------------------------------------------------------------------- the reads follow the marker, the legacy route agrees with the shared one

    [Fact]
    public async Task The_unseen_list_the_history_and_the_acknowledgement_follow_the_marker_and_agree_with_the_badge()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);
        await AddLegacyAsync(1, Sub(1), T0.AddHours(1));
        await AddLegacyAsync(2, Sub(2), T0.AddHours(2));

        async Task<System.Text.Json.JsonElement> Get_(string path, string cookie) => await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(path, cookie))));

        // Before the marker: the legacy table, no Staff actor (so an actor filter finds nothing).
        var before = await Get_($"{Shared}/newsletter/changes", e.Site);
        Assert.Equal((2, 2, "0", "2"), (before.GetProperty("unseenEvents").GetInt32(), before.GetProperty("groups").GetArrayLength(), before.GetProperty("lastSeenWatermark").GetString(), before.GetProperty("snapshotWatermark").GetString()));
        Assert.Equal(["2", "1"], (await Get_("/api/admin/v1/activity?menu=newsletter", e.Site)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("sequence").GetString()!).ToArray());
        Assert.Equal(0, (await Get_($"/api/admin/v1/activity?menu=newsletter&actorStaffId={await StaffIdAsync(Site)}", e.Site)).GetProperty("items").GetArrayLength());

        Factory.Clock.UtcNow = T0.AddHours(3);
        await CutoverAsync(e);
        Assert.Equal(2, (await Get_($"{Shared}/newsletter/changes", e.Site)).GetProperty("unseenEvents").GetInt32());     // the same list from the other source
        Assert.Equal(["2", "1"], (await Get_("/api/admin/v1/activity?menu=newsletter", e.Site)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("sequence").GetString()!).ToArray());

        // A's own add is in the history (the history keeps own events) and the actor filter now works, but it is not in A's unseen list or count; B sees it.
        Factory.Clock.UtcNow = T0.AddHours(4);
        await AssertStatusAsync(HttpStatusCode.Created, e.Client.SendAsync(Post(Admin, new { email = "own@example.com", language = "vi" }, e.Site)));
        var history = await Get_("/api/admin/v1/activity?menu=newsletter", e.Site);
        Assert.Equal(["3", "2", "1"], history.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("sequence").GetString()!).ToArray());
        Assert.Equal(("Staff", "Created"), (history.GetProperty("items")[0].GetProperty("actorKind").GetString()!, history.GetProperty("items")[0].GetProperty("action").GetString()!));
        Assert.Equal(1, (await Get_($"/api/admin/v1/activity?menu=newsletter&actorStaffId={await StaffIdAsync(Site)}", e.Site)).GetProperty("items").GetArrayLength());
        Assert.Equal(2, (await Get_($"{Shared}/newsletter/changes", e.Site)).GetProperty("unseenEvents").GetInt32());
        Assert.Equal(3, (await Get_($"{Shared}/newsletter/changes", e.Manager)).GetProperty("unseenEvents").GetInt32());
        Assert.Equal((2, "0", "3"), await NumberAsync(e, e.Site));
        Assert.Equal((3, "0", "3"), await NumberAsync(e, e.Manager));

        // Acknowledging uses only the watermark the client sends: "2" leaves nothing of A's unseen (the third is A's own), an older one never moves it back, one above the counter is refused.
        var seen = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post($"{Shared}/newsletter/seen", new { viewWatermark = "2" }, e.Site))));
        Assert.Equal((0, "2", "3"), (seen.GetProperty("count").GetInt32(), seen.GetProperty("lastSeenWatermark").GetString(), seen.GetProperty("currentWatermark").GetString()));
        await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post($"{Legacy}/newsletter/seen", new { viewWatermark = "1" }, e.Site)));     // the adapter: same code, the older mark changes nothing
        Assert.Equal((0, "2", "3"), await NumberAsync(e, e.Site));
        Assert.Equal(HttpStatusCode.BadRequest, (await e.Client.SendAsync(Post($"{Shared}/newsletter/seen", new { viewWatermark = "4" }, e.Site))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await e.Client.SendAsync(Post($"{Legacy}/newsletter/seen", new { viewWatermark = "4" }, e.Site))).StatusCode);
        Assert.Equal((3, "0", "3"), await NumberAsync(e, e.Manager));                       // B's cursor is B's

        // Who may read it did not change: a Staff member without the website permission has no entry, no list and no history.
        Assert.False((await Get_(Shared, e.Desk)).GetProperty("menus").TryGetProperty("newsletter", out _));
        Assert.Equal(HttpStatusCode.Forbidden, (await e.Client.SendAsync(Get(Legacy, e.Desk))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await e.Client.SendAsync(Get($"{Shared}/newsletter/changes", e.Desk))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await e.Client.SendAsync(Get("/api/admin/v1/activity?menu=newsletter", e.Desk))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await e.Client.SendAsync(Post($"{Shared}/newsletter/seen", new { viewWatermark = "0" }, e.Desk))).StatusCode);
    }

    [Fact]
    public async Task A_verification_after_the_cutover_is_written_to_the_shared_table_and_hinted_once_after_the_commit_beside_the_old_signal()
    {
        using var e = await BeginAsync();
        await CutoverAsync(e);
        Factory.Clock.UtcNow = T0.AddHours(1);

        Assert.Equal("verified", await VerifyAsync(e, "v@example.com"));

        Assert.Equal((0L, 1L, 1L), (await LegacyRowsAsync(), await SharedRowsAsync(), await CounterAsync()));
        Assert.Equal(1L, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' AND "Sequence" = 1 AND "ActorKind" = 'Public' AND "ActorStaffId" IS NULL AND "Action" = 'verified' AND "TitleSnapshot" = 'a subscription' """));
        Assert.Equal([new HintCall("newsletter", null, false)], e.Hints.ToArray());
    }

    // ---------------------------------------------------------------------------------------------------------- locks: both interleavings of a verification and the cutover, the fence, the retry

    [Fact]
    public async Task A_verification_holding_the_table_lock_before_the_cutover_makes_the_cutover_wait_and_both_commit_without_timeout_or_deadlock()
    {
        using var e = await BeginAsync();
        Assert.True(await ScalarAsync<double>("SELECT extract(epoch FROM current_setting('deadlock_timeout')::interval) * 1000") < 30_000);   // lock_timeout (30 s) is well above deadlock_timeout
        var (_, token) = await PendingAsync("a@example.com");
        Factory.Clock.UtcNow = T0.AddHours(1);
        var parked = e.Gate.Arm(LegacyInsert);                                                // the table lock and the sequence are taken; the legacy row is not written yet

        var verification = ConfirmAsync(e, token);
        await parked.Arrived.WaitAsync(Wait);
        Assert.Equal(0L, await CounterAsync());                                              // its number is uncommitted: a reader still sees 0
        var cutover = CutoverAsync(e);
        await WaitForTableLockWaitAsync("ShareRowExclusiveLock");
        Assert.False(cutover.IsCompleted);
        parked.Release();

        Assert.Equal(HttpStatusCode.OK, (await verification.WaitAsync(Wait)).StatusCode);
        var result = await cutover.WaitAsync(Wait);
        Assert.Equal((NewsletterCutoverStatus.Committed, 1L, 1), (result.Status, result.LegacyMaxSequence, result.CopiedRows));   // the cutover waited for it and then copied it
        Assert.Equal(1L, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' AND "Sequence" = 1 AND "ActorKind" = 'Public' """));
        Assert.Equal(1L, await LegacyRowsAsync());
    }

    [Fact]
    public async Task A_verification_that_starts_while_the_cutover_holds_the_table_waits_on_it_before_any_sequence_then_follows_the_new_source_and_both_commit()
    {
        using var e = await BeginAsync();
        await AddLegacyAsync(1, Sub(1), T0.AddHours(1));
        var (_, token) = await PendingAsync("b@example.com");
        Factory.Clock.UtcNow = T0.AddHours(2);
        var parked = e.Gate.Arm(sql => sql.StartsWith("INSERT INTO \"MenuActivityCutovers\"", StringComparison.Ordinal));   // the cutover holds the table and the counter and has copied

        var cutover = CutoverAsync(e);
        await parked.Arrived.WaitAsync(Wait);
        var verification = ConfirmAsync(e, token);
        await WaitForTableLockWaitAsync("RowExclusiveLock");                                  // it waits on the TABLE lock …
        Assert.False(verification.IsCompleted);
        Assert.Equal(1L, await CounterAsync());                                               // … before it issued any sequence
        Assert.Equal(0L, await ScalarAsync<long>("SELECT count(*) FROM pg_locks WHERE NOT granted AND locktype IN ('transactionid', 'tuple')"));   // and not on the counter row
        parked.Release();

        Assert.Equal(NewsletterCutoverStatus.Committed, (await cutover.WaitAsync(Wait)).Status);
        Assert.Equal(HttpStatusCode.OK, (await verification.WaitAsync(Wait)).StatusCode);
        Assert.Equal(1L, await LegacyRowsAsync());                                            // no new legacy row: it followed the new source
        Assert.Equal(1L, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" WHERE "MenuKey" = 'newsletter' AND "Sequence" = 2 AND "ActorKind" = 'Public' AND "Action" = 'verified' """));
        Assert.Equal(2L, await CounterAsync());
    }

    [Fact]
    public async Task A_late_legacy_insert_is_refused_by_the_fence_and_the_verification_runs_again_exactly_once_without_doubling_anything()
    {
        using var e = await BeginAsync();
        var (id, token) = await PendingAsync("late@example.com");
        Factory.Clock.UtcNow = T0.AddHours(1);
        var parked = e.Gate.Arm(LegacyInsert);
        var before = e.Transactions.Started;

        var verification = ConfirmAsync(e, token);
        await parked.Arrived.WaitAsync(Wait);
        // A boundary that did not wait for this writer (what a build older than this release, or a hand-made marker, looks like): the marker commits now, behind the writer's decision.
        await ExecAsync("""INSERT INTO "MenuActivityCutovers" ("MenuKey","LegacyMaxSequence","CutoverAtUtc") VALUES ('newsletter',0,now())""");
        parked.Release();

        Assert.Equal(HttpStatusCode.OK, (await verification.WaitAsync(Wait)).StatusCode);
        Assert.Equal(2, e.Transactions.Started - before);                                     // the first attempt, and ONE retry
        Assert.Equal((0L, 1L, 1L), (await LegacyRowsAsync(), await SharedRowsAsync(), await CounterAsync()));   // the first attempt's number went back with its rollback
        Assert.Equal("Verified", await ScalarAsync<string>($"""SELECT "Status" FROM "NewsletterSubscriptions" WHERE "Id" = '{id}' """));
        Assert.Equal(1L, await ScalarAsync<long>($"""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "SubscriptionId" = '{id}' AND "Purpose" = 'Welcome' """));   // one Welcome, not two
        Assert.Equal(1L, await ScalarAsync<long>($"""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "SubscriptionId" = '{id}' AND "Purpose" = 'Verification' AND "UsedAtUtc" IS NOT NULL """));
        Assert.Equal([new HintCall("newsletter", null, false)], e.Hints.ToArray());           // one hint, from the attempt that committed
    }

    [Fact]
    public async Task A_lock_timeout_is_not_retried_and_leaves_the_link_usable()
    {
        using var e = await BeginAsync(lockTimeoutMs: 1_000);
        var (id, token) = await PendingAsync("slow@example.com");
        Factory.Clock.UtcNow = T0.AddHours(1);
        await using var holder = new NpgsqlConnection(Factory.ConnectionString);
        await holder.OpenAsync();
        await using var transaction = await holder.BeginTransactionAsync();
        await using (var lockTable = new NpgsqlCommand("""LOCK TABLE "NewsletterVerificationActivities" IN SHARE ROW EXCLUSIVE MODE""", holder, transaction)) await lockTable.ExecuteNonQueryAsync();   // a cutover in flight
        var before = e.Transactions.Started;

        var refused = await ConfirmAsync(e, token);

        Assert.Equal(HttpStatusCode.InternalServerError, refused.StatusCode);                 // 55P03 reaches the caller …
        Assert.Equal(1, e.Transactions.Started - before);                                     // … and the transaction was not run a second time
        Assert.Equal("PendingVerification", await ScalarAsync<string>($"""SELECT "Status" FROM "NewsletterSubscriptions" WHERE "Id" = '{id}' """));
        Assert.Equal(0L, await SharedRowsAsync() + await LegacyRowsAsync());
        await transaction.RollbackAsync();

        Assert.Equal(HttpStatusCode.OK, (await ConfirmAsync(e, token)).StatusCode);           // the same link, once the lock is gone
        Assert.Equal(1L, await LegacyRowsAsync());
    }
}
