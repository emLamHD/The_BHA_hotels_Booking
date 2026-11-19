using System.Net;
using System.Text.Json;
using System.Web;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using System.Data.Common;
using TheBha.Api;
using TheBha.Application.Website;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Newsletter;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: the per-Staff count of verifications not yet seen. Real PostgreSQL and the real HTTP pipeline. What these pin: only a real Pending→Verified move is an
/// activity (written in the same transaction, gone with a rollback), numbers commit in the order they were given (so a watermark never skips a late commit), a list's watermark and its
/// rows are one snapshot, and the cursor is per Staff, only ever moves up, and survives sessions and hosts.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class NewsletterUnseenTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Public = "/api/v1/website/newsletter-subscriptions";
    private const string Admin = "/api/admin/v1/website/newsletter-subscriptions";
    private const string Sender = "/api/admin/v1/website/newsletter-sender";
    private const string Unseen = "/api/admin/v1/website/menu-unseen";
    private const string CustomerOrigin = "https://localhost:3000";

    private sealed class CommitFailure : DbTransactionInterceptor
    {
        public volatile bool Armed;

        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction, TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            if (Armed) throw new InvalidOperationException("COMMIT refused (test)");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Env(Session staff, NewsletterGoogleStub google, CommitFailure commit, string manager, string desk) : IDisposable
    {
        public Session Staff { get; } = staff;                       // Site: has the website permission
        public NewsletterGoogleStub Google { get; } = google;
        public CommitFailure Commit { get; } = commit;
        public string ManagerCookie { get; set; } = manager;         // gets the website permission in tests that need a second member
        public string DeskCookie { get; } = desk;                    // never has it
        public HttpClient Client => Staff.Client;
        public WebApplicationFactory<Program> Host => Staff.Host;
        public void Dispose() => Staff.Dispose();
    }

    private async Task<Env> BeginAsync(AdminCalendarAccessMode mode = AdminCalendarAccessMode.Staff)
    {
        var google = new NewsletterGoogleStub();
        var commit = new CommitFailure();
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, mode.ToString());
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", CustomerOrigin);
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.UseSetting("Website:Newsletter:RateLimiting:PermitLimit", "10000");
            builder.ConfigureLogging(logging => logging.SetMinimumLevel(LogLevel.Critical));
            builder.ConfigureServices(services =>
            {
                services.AddHttpClient(GoogleMailGateway.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => google);
                services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
                services.AddDbContext<TheBhaDbContext>(options => options
                    .UseNpgsql(Factory.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
                    .AddInterceptors(commit));
            });
        });
        await SeedStaffAsync(host);
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var client = CreateHttpsClient(host);
        var site = await LoginAsync(client, Site);
        var env = new Env(new Session(host, client, site), google, commit, await LoginAsync(client, Manager), await LoginAsync(client, Desk));
        if (mode == AdminCalendarAccessMode.Staff) await ConnectSenderAsync(env);
        return env;
    }

    private async Task ConnectSenderAsync(Env e)
    {
        e.Google.Email = "sender@gmail.test";
        var start = await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/connect", new { clientId = "client-1.apps.googleusercontent.com", clientSecret = "GOCSPX-client-secret-1", switchAccount = false }));
        var state = HttpUtility.ParseQueryString(new Uri((await JsonAsync(start)).GetProperty("authorizationUrl").GetString()!).Query)["state"];
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/connect/complete", new { state, code = "auth-code-1", error = (string?)null }));
    }

    /// <summary>The Manager becomes a second website Staff member (the permission is read from the database on every request).</summary>
    private Task GrantManagerAsync(Env e) => CliAsync(e.Host, ["--staff-website-access", "--email", Manager, "--enabled", "true"]);

    private static Task<HttpResponseMessage> ConfirmAsync(Env e, string token) =>
        e.Client.SendAsync(Post(Public + "/confirmations", new { token }, origins: [CustomerOrigin]));

    private static async Task DispatchAsync(Env e)
    {
        await using var scope = e.Host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<INewsletterVerificationDispatcher>().ProcessBatchAsync(20, CancellationToken.None);
    }

    private static async Task<string> RequestLinkAsync(Env e, string email)
    {
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Post(Public, new { email, language = "vi" }, origins: [CustomerOrigin])));
        var sends = e.Google.Sends.Count;
        await DispatchAsync(e);
        // The dispatcher also sends the Welcome of an earlier verification: take the confirmation mail addressed to THIS address.
        return e.Google.Sends.Skip(sends).Select(NewsletterGoogleStub.Decode)
            .Last(message => message.Headers["To"].Contains(email, StringComparison.Ordinal) && message.Link.Contains("/confirm", StringComparison.Ordinal)).Token;
    }

    private static async Task<string> ConfirmStatusAsync(Env e, string token)
    {
        var response = await ConfirmAsync(e, token);
        return response.StatusCode == HttpStatusCode.OK ? (await JsonAsync(response)).GetProperty("status").GetString()! : ((int)response.StatusCode).ToString();
    }

    /// <summary>A visitor subscribes and presses the link: one real verification.</summary>
    private async Task VerifyAsync(Env e, string email)
    {
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);                                       // the test clock does not move by itself (one Welcome per VerifiedAtUtc)
        Assert.Equal("verified", await ConfirmStatusAsync(e, await RequestLinkAsync(e, email)));
    }

    private static async Task<(int Count, string LastSeen, string Current)> UnseenAsync(Env e, string? cookie = null)
    {
        var body = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(Unseen, cookie ?? e.Staff.Cookie))));
        var entry = body.GetProperty("newsletter");
        return (entry.GetProperty("count").GetInt32(), entry.GetProperty("lastSeenWatermark").GetString()!, entry.GetProperty("currentWatermark").GetString()!);
    }

    private static Task<HttpResponseMessage> SeenAsync(Env e, object? body, string? cookie = null, string menu = "newsletter") =>
        e.Client.SendAsync(Post($"{Unseen}/{menu}/seen", body, cookie ?? e.Staff.Cookie));

    private static async Task<(string ViewWatermark, int Total)> ListAsync(Env e, string query = "", string? cookie = null)
    {
        var page = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get($"{Admin}?scope=all&sort=recent-activity{query}", cookie ?? e.Staff.Cookie))));
        return (page.GetProperty("viewWatermark").GetString()!, page.GetProperty("total").GetInt32());
    }

    private Task<long> CounterAsync() => ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """);
    private Task<long> ActivitiesAsync() => ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """);

    // ---------------------------------------------------------------------------------------------------------- what counts

    [Fact]
    public async Task Only_a_real_move_to_verified_is_an_activity_and_a_returning_visitor_makes_a_new_one()
    {
        using var e = await BeginAsync();

        // Typing the address, a Staff addition and an invitation are not verifications.
        var token = await RequestLinkAsync(e, "a@example.com");
        await AssertStatusAsync(HttpStatusCode.Created, e.Staff.PostAsync(Admin, new { email = "added@example.com", language = "vi" }));
        var added = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync($"{Admin}?search=added@example.com&scope=all")))).GetProperty("items")[0];
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{added.GetProperty("id").GetGuid()}/verification-invitations", new { expectedVersion = added.GetProperty("version").GetInt32() }));
        Assert.Equal((0, "0", "0"), await UnseenAsync(e));

        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);
        Assert.Equal("verified", await ConfirmStatusAsync(e, token));
        Assert.Equal((1, "0", "1"), await UnseenAsync(e));
        Assert.Equal(1L, await ActivitiesAsync());

        // A replay, a malformed token and an unknown one change nothing.
        Assert.Equal("already-verified", await ConfirmStatusAsync(e, token));
        Assert.Equal("400", await ConfirmStatusAsync(e, "not-a-token"));
        Assert.Equal("400", await ConfirmStatusAsync(e, new string('a', 43)));
        Assert.Equal((1, "0", "1"), await UnseenAsync(e));

        // Leaves, comes back and confirms again: a new verification, a new number.
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(5);
        var row = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync($"{Admin}?search=a@example.com&scope=all")))).GetProperty("items")[0];
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{row.GetProperty("id").GetGuid()}/unsubscribe", new { expectedVersion = row.GetProperty("version").GetInt32() }));
        Assert.Equal((1, "0", "1"), await UnseenAsync(e));                                    // unsubscribing is not one either
        await VerifyAsync(e, "a@example.com");
        Assert.Equal((2, "0", "2"), await UnseenAsync(e));
        Assert.Equal(new long[] { 1, 2 }, (await ScalarAsync<string>("""SELECT string_agg("Sequence"::text, ',' ORDER BY "Sequence") FROM "NewsletterVerificationActivities" """)).Split(',').Select(long.Parse).ToArray());
    }

    [Fact]
    public async Task The_activity_holds_no_address_token_or_mail_data_and_no_response_names_one()
    {
        using var e = await BeginAsync();
        var token = await RequestLinkAsync(e, "private.person@example.com");
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);
        await ConfirmStatusAsync(e, token);

        var columns = await ScalarAsync<string>("""SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'NewsletterVerificationActivities' """);
        Assert.Equal("OccurredAtUtc,Sequence,SubscriptionId", columns);
        var seen = await (await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = "1" }))).Content.ReadAsStringAsync();
        var get = await (await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync(Unseen))).Content.ReadAsStringAsync();
        foreach (var body in new[] { seen, get })
        {
            Assert.DoesNotContain("private.person", body, StringComparison.Ordinal);
            Assert.DoesNotContain(token, body, StringComparison.Ordinal);
            Assert.DoesNotContain("@", body, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task A_verification_whose_commit_fails_leaves_no_activity_and_gives_back_its_number()
    {
        using var e = await BeginAsync();
        var token = await RequestLinkAsync(e, "a@example.com");
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);

        e.Commit.Armed = true;
        try
        {
            Assert.Equal(HttpStatusCode.InternalServerError, (await ConfirmAsync(e, token)).StatusCode);
        }
        finally
        {
            e.Commit.Armed = false;
        }

        Assert.Equal(0L, await ActivitiesAsync());
        Assert.Equal(0L, await CounterAsync());
        Assert.Equal("verified", await ConfirmStatusAsync(e, token));
        Assert.Equal((1, "0", "1"), await UnseenAsync(e));                                    // number 1, not 2
    }

    [Fact]
    public async Task The_same_link_pressed_twice_at_once_counts_once()
    {
        using var e = await BeginAsync();
        var token = await RequestLinkAsync(e, "a@example.com");
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);

        var answers = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ConfirmStatusAsync(e, token)));

        Assert.Equal(1, answers.Count(answer => answer == "verified"));
        Assert.All(answers.Where(answer => answer != "verified"), answer => Assert.Equal("already-verified", answer));
        Assert.Equal(1L, await ActivitiesAsync());
        Assert.Equal(1L, await CounterAsync());
    }

    [Fact]
    public async Task Deleting_a_verified_unseen_subscription_takes_its_activity_with_it()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e, "keep@example.com");
        await VerifyAsync(e, "drop@example.com");
        Assert.Equal((2, "0", "2"), await UnseenAsync(e));

        var drop = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync($"{Admin}?search=drop@example.com&scope=all")))).GetProperty("items")[0];
        await AssertStatusAsync(HttpStatusCode.NoContent, e.Staff.PostAsync($"{Admin}/{drop.GetProperty("id").GetGuid()}/delete", new { expectedVersion = drop.GetProperty("version").GetInt32() }));

        Assert.Equal((1, "0", "2"), await UnseenAsync(e));                                    // the watermark never goes back; the count only counts what still exists
        Assert.Equal(1L, await ActivitiesAsync());
    }

    // ---------------------------------------------------------------------------------------------------------- per Staff, and bound to what the list showed

    [Fact]
    public async Task Each_Staff_member_has_their_own_cursor_and_it_survives_a_new_session_and_a_new_host()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);
        for (var i = 1; i <= 3; i++) await VerifyAsync(e, $"v{i}@example.com");

        Assert.Equal((3, "0", "3"), await UnseenAsync(e));
        Assert.Equal((3, "0", "3"), await UnseenAsync(e, e.ManagerCookie));

        var list = await ListAsync(e);                                                          // A opens the screen: the list answers with its watermark …
        Assert.Equal(("3", 3), list);
        var after = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = list.ViewWatermark })));   // … and A says so
        Assert.Equal(0, after.GetProperty("newsletter").GetProperty("count").GetInt32());

        Assert.Equal((0, "3", "3"), await UnseenAsync(e));
        Assert.Equal((3, "0", "3"), await UnseenAsync(e, e.ManagerCookie));                    // B still has all three

        // A new session of A (another device) and a second API host on the same database see the stored state.
        var again = await LoginAsync(e.Client, Site);
        Assert.Equal((0, "3", "3"), await UnseenAsync(e, again));
        using var second = Factory.WithWebHostBuilder(builder => builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000"));
        var secondClient = CreateHttpsClient(second);
        var cookie = await LoginAsync(secondClient, Site);
        var body = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, secondClient.SendAsync(Get(Unseen, cookie))));
        Assert.Equal(0, body.GetProperty("newsletter").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task A_Staff_member_with_no_cursor_counts_from_the_start_and_reading_writes_nothing()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);
        await VerifyAsync(e, "v1@example.com");

        Assert.Equal((1, "0", "1"), await UnseenAsync(e, e.ManagerCookie));
        await ListAsync(e, cookie: e.ManagerCookie);                                            // opening the list alone is not "seen" either
        Assert.Equal((1, "0", "1"), await UnseenAsync(e, e.ManagerCookie));
        Assert.Equal(0L, await ScalarAsync<long>("""SELECT count(*) FROM "StaffMenuSeen" """));
    }

    [Fact]
    public async Task A_verification_that_commits_after_the_list_snapshot_is_still_unseen_after_the_acknowledgement()
    {
        using var e = await BeginAsync();
        for (var i = 1; i <= 3; i++) await VerifyAsync(e, $"v{i}@example.com");
        var list = await ListAsync(e);
        Assert.Equal("3", list.ViewWatermark);

        await VerifyAsync(e, "late@example.com");                                               // commits between the list and the acknowledgement
        var after = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = list.ViewWatermark })));

        var entry = after.GetProperty("newsletter");
        Assert.Equal(1, entry.GetProperty("count").GetInt32());
        Assert.Equal("3", entry.GetProperty("lastSeenWatermark").GetString());
        Assert.Equal("4", entry.GetProperty("currentWatermark").GetString());
    }

    [Fact]
    public async Task The_list_answers_with_the_watermark_of_its_own_snapshot_also_for_an_empty_or_past_the_end_page()
    {
        using var e = await BeginAsync();
        Assert.Equal(("0", 0), await ListAsync(e));
        for (var i = 1; i <= 2; i++) await VerifyAsync(e, $"v{i}@example.com");
        Assert.Equal(("2", 2), await ListAsync(e));
        Assert.Equal("2", (await ListAsync(e, "&page=50")).ViewWatermark);
        Assert.Equal("2", (await ListAsync(e, "&search=zzz")).ViewWatermark);                  // a filter does not narrow the menu's watermark
    }

    // ---------------------------------------------------------------------------------------------------------- the hard part: numbers commit in order

    [Fact]
    public async Task A_transaction_that_holds_an_earlier_number_blocks_a_later_one_so_a_reader_never_sees_a_higher_number_without_it()
    {
        using var e = await BeginAsync();
        await AssertStatusAsync(HttpStatusCode.Created, e.Staff.PostAsync(Admin, new { email = "inflight@example.com", language = "vi" }));
        var inflightId = await ScalarAsync<Guid>("""SELECT "Id" FROM "NewsletterSubscriptions" WHERE "Email" = 'inflight@example.com' """);
        var token = await RequestLinkAsync(e, "second@example.com");
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);

        // T1 takes number 1 exactly as a verification does and has not committed yet.
        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var t1 = await connection.BeginTransactionAsync();
        await using (var take = new NpgsqlCommand(
            """
            WITH next AS (UPDATE "MenuActivityStreams" SET "LastSequence" = "LastSequence" + 1 WHERE "MenuKey" = 'newsletter' RETURNING "LastSequence")
            INSERT INTO "NewsletterVerificationActivities" ("Sequence", "SubscriptionId", "OccurredAtUtc") SELECT "LastSequence", @id, now() FROM next
            """, connection, t1))
        {
            take.Parameters.AddWithValue("id", inflightId);
            Assert.Equal(1, await take.ExecuteNonQueryAsync());
        }

        // A real verification now wants number 2: it must WAIT for T1 (it cannot commit 2 before 1).
        var second = ConfirmStatusAsync(e, token);
        await Task.Delay(1500);
        Assert.False(second.IsCompleted, "number 2 committed while number 1 was still open");

        // A reader that looks now sees neither: watermark 0. Acknowledging it must not hide what is about to commit.
        var list = await ListAsync(e);
        Assert.Equal("0", list.ViewWatermark);
        await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = list.ViewWatermark }));
        Assert.Equal((0, "0", "0"), await UnseenAsync(e));

        await t1.CommitAsync();
        Assert.Equal("verified", await second.WaitAsync(TimeSpan.FromSeconds(20)));

        // Both are after the acknowledged watermark, so both count: nothing was skipped.
        Assert.Equal((2, "0", "2"), await UnseenAsync(e));
    }

    [Fact]
    public async Task Acknowledgements_that_arrive_out_of_order_keep_the_higher_cursor_and_concurrent_first_ones_do_not_clash()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);
        for (var i = 1; i <= 3; i++) await VerifyAsync(e, $"v{i}@example.com");

        await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = "2" }));
        await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = "1" }));   // an older one arrives late
        Assert.Equal((1, "2", "3"), await UnseenAsync(e));

        // The first call of a Staff member, made by several tabs at once (the same and different numbers): all 200, the highest wins, no duplicate-key 500.
        var calls = await Task.WhenAll(new[] { "3", "3", "2", "1", "3" }.Select(mark => SeenAsync(e, new { viewWatermark = mark }, e.ManagerCookie)));
        Assert.All(calls, call => Assert.Equal(HttpStatusCode.OK, call.StatusCode));
        Assert.Equal((0, "3", "3"), await UnseenAsync(e, e.ManagerCookie));
        Assert.Equal(2L, await ScalarAsync<long>("""SELECT count(*) FROM "StaffMenuSeen" """));

        // The same call again changes nothing.
        await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = "3" }));
        Assert.Equal((0, "3", "3"), await UnseenAsync(e));
    }

    [Fact]
    public async Task Verifications_lists_and_acknowledgements_at_once_deadlock_nothing_and_count_exactly()
    {
        using var e = await BeginAsync();
        await GrantManagerAsync(e);
        var tokens = new List<string>();
        for (var i = 0; i < 8; i++) tokens.Add(await RequestLinkAsync(e, $"c{i}@example.com"));
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);

        var verifications = tokens.Select(token => Task.Run(() => ConfirmStatusAsync(e, token))).ToArray();
        var readers = Enumerable.Range(0, 12).Select(i => Task.Run(async () =>
        {
            var cookie = i % 2 == 0 ? e.Staff.Cookie : e.ManagerCookie;
            var list = await ListAsync(e, cookie: cookie);
            await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = list.ViewWatermark }, cookie));
        })).ToArray();
        await Task.WhenAll(readers).WaitAsync(TimeSpan.FromSeconds(60));
        var answers = await Task.WhenAll(verifications).WaitAsync(TimeSpan.FromSeconds(60));

        Assert.All(answers, answer => Assert.Equal("verified", answer));
        Assert.Equal(8L, await ActivitiesAsync());
        Assert.Equal(8L, await CounterAsync());
        var distinct = await ScalarAsync<long>("""SELECT count(DISTINCT "Sequence") FROM "NewsletterVerificationActivities" WHERE "Sequence" BETWEEN 1 AND 8 """);
        Assert.Equal(8L, distinct);                                                             // numbers 1..8, none repeated, none skipped
        var final = await UnseenAsync(e);
        Assert.Equal("8", final.Current);
        Assert.Equal(8 - long.Parse(final.LastSeen), final.Count);                              // whatever was acknowledged, the rest is counted
    }

    // ---------------------------------------------------------------------------------------------------------- contract

    [Fact]
    public async Task A_watermark_that_is_not_a_plain_valid_integer_string_or_is_in_the_future_is_refused_and_moves_nothing()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e, "v1@example.com");
        await VerifyAsync(e, "v2@example.com");

        foreach (var bad in new[] { "-1", "01", "1.5", " 1", "1 ", "1e1", "+1", "", "abc", "9223372036854775808", "99999999999999999999" })
        {
            var response = await SeenAsync(e, new { viewWatermark = bad });
            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"'{bad}' gave {(int)response.StatusCode}");
            Assert.Equal(("menu-unseen-watermark-invalid", "viewWatermark"), await ProblemAsync(response));
        }

        Assert.Equal(HttpStatusCode.BadRequest, (await SeenAsync(e, new { viewWatermark = "3" })).StatusCode);    // above the newest committed number: not clamped to "everything"
        Assert.Equal(HttpStatusCode.BadRequest, (await SeenAsync(e, "{\"viewWatermark\":1}")).StatusCode);        // a JSON number never binds
        Assert.Equal(HttpStatusCode.BadRequest, (await SeenAsync(e, "{}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SeenAsync(e, "{\"viewWatermark\":null}")).StatusCode);
        Assert.Equal((2, "0", "2"), await UnseenAsync(e));
        Assert.Equal(0L, await ScalarAsync<long>("""SELECT count(*) FROM "StaffMenuSeen" """));

        // A Staff id in the body is ignored: the cursor that moves is the signed-in one.
        await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, "{\"viewWatermark\":\"2\",\"staffAccountId\":\"" + Guid.NewGuid() + "\"}"));
        Assert.Equal(await StaffIdAsync(Site), await ScalarAsync<Guid>("""SELECT "StaffAccountId" FROM "StaffMenuSeen" """));
    }

    [Fact]
    public async Task A_menu_that_has_no_badge_is_a_404_and_stores_nothing()
    {
        using var e = await BeginAsync();
        foreach (var menu in new[] { "blog", "calendar", "Newsletter", "newsletter%20", "..", "0" })
        {
            var response = await SeenAsync(e, new { viewWatermark = "0" }, menu: menu);
            Assert.True(response.StatusCode == HttpStatusCode.NotFound, $"'{menu}' gave {(int)response.StatusCode}");
        }

        Assert.Equal(0L, await ScalarAsync<long>("""SELECT count(*) FROM "StaffMenuSeen" """));
    }

    [Fact]
    public async Task Only_a_signed_in_Staff_member_with_the_website_permission_from_an_approved_origin_reaches_the_counts()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e, "v1@example.com");
        string[] noPermission = [e.DeskCookie, e.ManagerCookie];                                 // neither has the site-wide permission

        Assert.Equal(HttpStatusCode.Unauthorized, (await e.Client.SendAsync(Get(Unseen))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await e.Client.SendAsync(Post($"{Unseen}/newsletter/seen", new { viewWatermark = "1" }))).StatusCode);
        foreach (var cookie in noPermission)
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await e.Client.SendAsync(Get(Unseen, cookie))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await SeenAsync(e, new { viewWatermark = "1" }, cookie)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await SeenAsync(e, "{not json", cookie)).StatusCode);   // the permission is judged before the body
        }

        // A foreign Origin, a missing Content-Type and a different method are refused by the Admin boundary as for every other Admin route.
        Assert.Equal(HttpStatusCode.Forbidden, (await e.Client.SendAsync(Post($"{Unseen}/newsletter/seen", new { viewWatermark = "1" }, e.Staff.Cookie, origins: ["https://evil.example"]))).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, (await e.Client.SendAsync(Post($"{Unseen}/newsletter/seen", "{\"viewWatermark\":\"1\"}", e.Staff.Cookie, contentType: "text/plain"))).StatusCode);
        Assert.False((await e.Client.SendAsync(new HttpRequestMessage(HttpMethod.Put, Unseen) { Headers = { { "Cookie", e.Staff.Cookie }, { "Origin", AdminOrigin } } })).IsSuccessStatusCode);
        Assert.Equal((1, "0", "1"), await UnseenAsync(e));
        Assert.Equal(0L, await ScalarAsync<long>("""SELECT count(*) FROM "StaffMenuSeen" """));
    }

    [Fact]
    public async Task The_local_gate_does_not_open_the_counts()
    {
        using var e = await BeginAsync(AdminCalendarAccessMode.LocalGate);
        Assert.Equal(HttpStatusCode.NotFound, (await e.Client.SendAsync(Get(Unseen))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await e.Client.SendAsync(Post($"{Unseen}/newsletter/seen", new { viewWatermark = "0" }))).StatusCode);
    }

    [Fact]
    public async Task Counts_are_never_cached()
    {
        using var e = await BeginAsync();
        var get = await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync(Unseen));
        var post = await AssertStatusAsync(HttpStatusCode.OK, SeenAsync(e, new { viewWatermark = "0" }));
        Assert.Contains("no-store", get.Headers.CacheControl!.ToString());
        Assert.Contains("no-store", post.Headers.CacheControl!.ToString());
    }
}
