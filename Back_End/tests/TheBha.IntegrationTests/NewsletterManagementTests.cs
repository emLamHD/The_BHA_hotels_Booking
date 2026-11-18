using System.Net;
using System.Text.Json;
using System.Web;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using TheBha.Api;
using TheBha.Application.Website;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Newsletter;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-NEWSLETTER-003: what Staff can do to a subscription (add, edit, invite, unsubscribe, archive, restore, delete), the unsubscribe link, and the Welcome that follows a
/// verification. Real PostgreSQL and the real HTTP pipeline; Google is replaced only at the network (<see cref="NewsletterGoogleStub"/>). The outbox is driven by hand, and a
/// worker is parked at Google's token answer to put a Staff action exactly between "the worker holds the mail" and "the mail leaves".
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class NewsletterManagementTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Public = "/api/v1/website/newsletter-subscriptions";
    private const string Confirmations = Public + "/confirmations";
    private const string Unsubscriptions = Public + "/unsubscriptions";
    private const string Admin = "/api/admin/v1/website/newsletter-subscriptions";
    private const string Sender = "/api/admin/v1/website/newsletter-sender";
    private const string CustomerOrigin = "https://localhost:3000";
    private const string Guest = "guest@example.com";
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(30);

    /// <summary>BHA-NEWSLETTER-003-C1: parks one chosen statement of the real application (nothing unless a test arms a rule).</summary>
    private readonly NewsletterSqlGate _gate = new();

    private sealed class Env(Session staff, NewsletterGoogleStub google, string desk, Action release) : IDisposable
    {
        public Session Staff { get; } = staff;
        public NewsletterGoogleStub Google { get; } = google;
        public string DeskCookie { get; } = desk;
        public HttpClient Client => Staff.Client;
        public WebApplicationFactory<Program> Host => Staff.Host;
        public void Dispose()
        {
            release();
            Staff.Dispose();
        }
    }

    private async Task<Env> BeginAsync(bool connected = true)
    {
        var google = new NewsletterGoogleStub();
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, "Staff");
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", CustomerOrigin);
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.UseSetting("Website:Newsletter:RateLimiting:PermitLimit", "10000");
            builder.ConfigureLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));
            builder.ConfigureServices(services =>
            {
                services.AddHttpClient(GoogleMailGateway.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => google);
                // The application's own DbContext registration, plus the gate (EF only takes interceptors from the options it is built with).
                services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
                services.AddDbContext<TheBhaDbContext>(options => options
                    .UseNpgsql(Factory.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
                    .AddInterceptors(_gate));
            });
        });
        await SeedStaffAsync(host);
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var client = CreateHttpsClient(host);
        var e = new Env(new Session(host, client, await LoginAsync(client, Site)), google, await LoginAsync(client, Desk), _gate.ReleaseAll);
        if (connected) await ConnectAsync(e);
        return e;
    }

    private async Task ConnectAsync(Env e, string email = "sender@gmail.test")
    {
        e.Google.Email = email;
        var start = await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/connect", new { clientId = "client-1.apps.googleusercontent.com", clientSecret = "GOCSPX-client-secret-1", switchAccount = false }));
        var state = HttpUtility.ParseQueryString(new Uri((await JsonAsync(start)).GetProperty("authorizationUrl").GetString()!).Query)["state"];
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/connect/complete", new { state, code = "auth-code-1", error = (string?)null }));
    }

    // ------------------------------------------------------------------------------------------------------------ helpers

    private static HttpRequestMessage Subscribe(string email, string? language = null) => Post(Public, new { email, language }, origins: [CustomerOrigin]);

    private static Task<HttpResponseMessage> ConfirmAsync(Env e, string token) => e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin]));

    private static Task<HttpResponseMessage> UnsubscribeLinkAsync(Env e, string token) => e.Client.SendAsync(Post(Unsubscriptions, new { token }, origins: [CustomerOrigin]));

    private static async Task<int> DispatchAsync(WebApplicationFactory<Program> host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<INewsletterVerificationDispatcher>().ProcessBatchAsync(20, CancellationToken.None);
    }

    private async Task<JsonElement> AddAsync(Env e, string email = Guest, string? language = null)
    {
        var response = await AssertStatusAsync(HttpStatusCode.Created, e.Staff.PostAsync(Admin, new { email, language }));
        return await JsonAsync(response);
    }

    private static Guid IdOf(JsonElement dto) => dto.GetProperty("id").GetGuid();

    private static int VersionOf(JsonElement dto) => dto.GetProperty("version").GetInt32();

    private async Task<JsonElement> ReadAsync(Env e, string email = Guest)
    {
        var page = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync($"{Admin}?search={Uri.EscapeDataString(email)}&scope=all")));
        return page.GetProperty("items").EnumerateArray().Single(item => item.GetProperty("email").GetString() == email);
    }

    private Task<HttpResponseMessage> PostRowAsync(Env e, JsonElement row, string action, object? body = null) =>
        e.Staff.PostAsync($"{Admin}/{IdOf(row)}/{action}", body ?? new { expectedVersion = VersionOf(row) });

    private Task<int> Count(string table, string where = "TRUE") => ScalarAsync<int>($"""SELECT count(*) FROM "{table}" WHERE {where}""");

    private Task<int> Welcomes(string email = Guest) => ScalarAsync<int>(
        $"""SELECT count(*) FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = '{email}' AND r."Purpose" = 'Welcome'""");

    private Task<string> StatusOf(string purpose, string email = Guest) => ScalarAsync<string>(
        $"""SELECT r."Status" FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = '{email}' AND r."Purpose" = '{purpose}' ORDER BY r."CreatedAtUtc" DESC LIMIT 1""");

    private static NewsletterGoogleStub.Message Mail(NewsletterGoogleStub.Call call) => NewsletterGoogleStub.Decode(call);

    /// <summary>The public form, the confirmation mail, the visitor's press of the button: leaves the address verified and the Welcome waiting.</summary>
    private async Task<string> VerifyAsync(Env e, string email = Guest, string? language = null)
    {
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(email, language)));
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var token = Mail(e.Google.Sends[sends]).Token;
        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, token));
        return token;
    }

    private static bool IsRefresh(NewsletterGoogleStub.Call call) =>
        call.Path.EndsWith("/token", StringComparison.Ordinal) && !call.Body.Contains("authorization_code", StringComparison.Ordinal);

    // ------------------------------------------------------------------------------------------------------------ add

    [Fact]
    public async Task Staff_add_an_address_as_pending_from_admin_naming_who_added_it_and_nothing_is_sent()
    {
        using var e = await BeginAsync();
        var dto = await AddAsync(e, "  New.Guest@Example.COM ", "fr");

        Assert.Equal("new.guest@example.com", dto.GetProperty("email").GetString());
        Assert.Equal("PendingVerification", dto.GetProperty("status").GetString());
        Assert.Equal("fr", dto.GetProperty("language").GetString());
        Assert.Equal(1, VersionOf(dto));
        Assert.Equal(JsonValueKind.Null, dto.GetProperty("verifiedAtUtc").ValueKind);
        Assert.Equal(JsonValueKind.Null, dto.GetProperty("verificationMail").ValueKind);
        Assert.Equal("admin", await ScalarAsync<string>("""SELECT "Source" FROM "NewsletterSubscriptions" """));
        Assert.Equal(await ScalarAsync<Guid>($"""SELECT "Id" FROM "StaffAccounts" WHERE "Email" = '{Site}' """), await ScalarAsync<Guid>("""SELECT "CreatedByStaffId" FROM "NewsletterSubscriptions" """));
        // The owner of the mailbox has to verify it: no mail is queued by adding, and the Worker has nothing to send.
        Assert.Equal(0, await Count("NewsletterVerificationRequests"));
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Empty(e.Google.Sends);
    }

    [Fact]
    public async Task A_known_address_is_a_conflict_that_names_the_row_and_a_bad_request_is_a_400()
    {
        using var e = await BeginAsync();
        var first = await AddAsync(e, Guest);
        // Same address in another case and with spaces; also an address that came from the public form and one that is hidden.
        var dup = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, e.Staff.PostAsync(Admin, new { email = " GUEST@example.com ", language = "vi" })));
        Assert.Equal("newsletter-subscription-duplicate", dup.GetProperty("code").GetString());
        Assert.Equal(IdOf(first), dup.GetProperty("existingId").GetGuid());
        Assert.False(dup.GetProperty("existingArchived").GetBoolean());

        await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, first, "archive"));
        var hidden = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, e.Staff.PostAsync(Admin, new { email = Guest })));
        Assert.True(hidden.GetProperty("existingArchived").GetBoolean());

        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe("public@example.com")));
        var fromForm = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, e.Staff.PostAsync(Admin, new { email = "public@example.com" })));
        Assert.Equal(await ScalarAsync<Guid>("""SELECT "Id" FROM "NewsletterSubscriptions" WHERE "Email" = 'public@example.com' """), fromForm.GetProperty("existingId").GetGuid());

        foreach (var bad in new object[] { new { email = "not-an-email" }, new { email = "" }, new { email = (string?)null }, new { email = "ok@example.com", language = "de" } })
            await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.PostAsync(Admin, bad));
        Assert.Equal(2, await Count("NewsletterSubscriptions"));
    }

    // ------------------------------------------------------------------------------------------------------------ invite

    [Fact]
    public async Task An_invitation_says_what_it_did_and_follows_the_cooldown_of_the_public_form()
    {
        using var e = await BeginAsync(connected: false);
        var row = await AddAsync(e);

        // No sender: nothing is queued and no cooldown is written, so connecting Gmail later does not make this address wait.
        var none = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, row, "verification-invitations", new { })));
        Assert.Equal("not-connected", none.GetProperty("status").GetString());
        Assert.Equal(0, await Count("NewsletterVerificationRequests"));
        Assert.Equal(JsonValueKind.Null, (await ReadAsync(e)).GetProperty("verificationMail").ValueKind);

        await ConnectAsync(e);
        var queued = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, row, "verification-invitations", new { })));
        Assert.Equal("queued", queued.GetProperty("status").GetString());
        Assert.Equal("Pending", queued.GetProperty("subscription").GetProperty("verificationMail").GetString());
        Assert.Equal(1, await Count("NewsletterVerificationRequests", "\"Purpose\" = 'Verification'"));

        var cooling = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, row, "verification-invitations", new { })));
        Assert.Equal("cooldown", cooling.GetProperty("status").GetString());
        Assert.InRange(cooling.GetProperty("retryAfterSeconds").GetInt32(), 1, 300);
        Assert.Equal(1, await Count("NewsletterVerificationRequests"));

        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", (await ReadAsync(e)).GetProperty("verificationMail").GetString());
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(6);
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, row, "verification-invitations", new { })));
        Assert.Equal("queued", again.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Only_a_pending_visible_address_can_be_invited()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var verified = await ReadAsync(e);
        var refused = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, PostRowAsync(e, verified, "verification-invitations", new { })));
        Assert.Equal("newsletter-invite-not-pending", refused.GetProperty("code").GetString());

        var hidden = await AddAsync(e, "hidden@example.com");
        var archived = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, hidden, "archive")));
        Assert.Equal("newsletter-subscription-archived", (await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, PostRowAsync(e, archived, "verification-invitations", new { })))).GetProperty("code").GetString());

        var stopped = await AddAsync(e, "stopped@example.com");
        var unsub = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, stopped, "unsubscribe")));
        Assert.Equal("newsletter-invite-not-pending", (await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, PostRowAsync(e, unsub, "verification-invitations", new { })))).GetProperty("code").GetString());
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Staff.PostAsync($"{Admin}/{Guid.NewGuid()}/verification-invitations", new { }));
    }

    // ------------------------------------------------------------------------------------------------------------ edit

    [Fact]
    public async Task Changing_the_language_keeps_the_verification_and_rewrites_a_mail_still_waiting()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e, language: "vi");
        var row = await ReadAsync(e);
        Assert.Equal("Pending", await StatusOf("Welcome"));

        var changed = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), language = "en" })));
        Assert.Equal("Verified", changed.GetProperty("status").GetString());
        Assert.Equal("en", changed.GetProperty("language").GetString());
        Assert.Equal(VersionOf(row) + 1, VersionOf(changed));
        Assert.Equal(JsonValueKind.String, changed.GetProperty("verifiedAtUtc").ValueKind);
        Assert.Equal("en", await ScalarAsync<string>("""SELECT "Language" FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));

        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Welcome to the BHA", Mail(e.Google.Sends[sends]).Headers["Subject"]);
        Assert.Contains("Welcome to The BHA", Mail(e.Google.Sends[sends]).Text);

        // Nothing to change: no new version and no audit row.
        var same = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(changed), language = "en" })));
        Assert.Equal(VersionOf(changed), VersionOf(same));
        Assert.Equal(1, await Count("NewsletterSubscriptionAudits", "\"Action\" = 'edited'"));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(same), language = "de" }));
    }

    [Fact]
    public async Task Changing_the_address_returns_to_pending_voids_every_old_link_and_withdraws_the_old_mails()
    {
        using var e = await BeginAsync();
        var confirmToken = await VerifyAsync(e);
        // The Welcome (with its unsubscribe token) goes out to the OLD address.
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var welcomeToken = Mail(e.Google.Sends[sends]).Token;
        var row = await ReadAsync(e);

        var edited = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email = "Other@Example.com" })));
        Assert.Equal("other@example.com", edited.GetProperty("email").GetString());
        Assert.Equal("PendingVerification", edited.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, edited.GetProperty("verifiedAtUtc").ValueKind);
        Assert.Equal(0, await Count("NewsletterVerificationRequests", "\"RevokedAtUtc\" IS NULL"));

        // A link sent to the old address verifies nothing and unsubscribes nothing for the new one.
        Assert.Equal("newsletter-confirmation-invalid", (await JsonAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, ConfirmAsync(e, confirmToken)))).GetProperty("code").GetString());
        await AssertStatusAsync(HttpStatusCode.BadRequest, UnsubscribeLinkAsync(e, welcomeToken));
        Assert.Equal("PendingVerification", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));

        // The new address is invited like any other.
        var invite = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, edited, "verification-invitations", new { })));
        Assert.Equal("queued", invite.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Changing_the_address_withdraws_the_mails_that_have_not_gone_out()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var row = await ReadAsync(e);
        Assert.Equal("Pending", await StatusOf("Welcome"));
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email = "moved@example.com" }));

        Assert.Equal("Cancelled", await StatusOf("Welcome", "moved@example.com"));
        Assert.Equal("email-changed", await ScalarAsync<string>("""SELECT "LastOutcome" FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Single(e.Google.Sends);        // only the confirmation that verified the old address
    }

    [Fact]
    public async Task Changing_to_a_taken_address_is_a_409_naming_the_row_and_the_database_enforces_it_too()
    {
        using var e = await BeginAsync();
        var a = await AddAsync(e, "a@example.com");
        var b = await AddAsync(e, "b@example.com");

        var conflict = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, e.Staff.PostAsync($"{Admin}/{IdOf(b)}/update", new { expectedVersion = VersionOf(b), email = "A@example.com" })));
        Assert.Equal("newsletter-subscription-duplicate", conflict.GetProperty("code").GetString());
        Assert.Equal(IdOf(a), conflict.GetProperty("existingId").GetGuid());
        Assert.Equal("b@example.com", (await ReadAsync(e, "b@example.com")).GetProperty("email").GetString());
        Assert.Equal(VersionOf(b), VersionOf(await ReadAsync(e, "b@example.com")));

        // Whatever the application does, the database refuses a second row for the address.
        await Assert.ThrowsAnyAsync<Exception>(() => ExecuteAsync(
            """INSERT INTO "NewsletterSubscriptions" ("Id", "Email", "Source", "Status", "ReceivedAtUtc") VALUES (gen_random_uuid(), 'a@example.com', 'homepage', 'PendingVerification', now())"""));
    }

    [Fact]
    public async Task Two_edits_of_one_version_cannot_both_win()
    {
        using var e = await BeginAsync();
        var row = await AddAsync(e);
        var calls = new[] { "one@example.com", "two@example.com", "three@example.com", "four@example.com" }
            .Select(email => e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email })).ToArray();
        var statuses = (await Task.WhenAll(calls)).Select(r => r.StatusCode).ToArray();

        Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.OK));
        Assert.Equal(3, statuses.Count(s => s == HttpStatusCode.Conflict));
        Assert.Equal(VersionOf(row) + 1, await ScalarAsync<int>("""SELECT "Version" FROM "NewsletterSubscriptions" """));
        Assert.Equal(1, await Count("NewsletterSubscriptions"));
    }

    [Fact]
    public async Task A_stale_version_is_a_409_for_every_staff_write_and_changes_nothing()
    {
        using var e = await BeginAsync();
        var row = await AddAsync(e);
        var stale = new { expectedVersion = VersionOf(row) + 5 };
        foreach (var action in new[] { "unsubscribe", "archive", "restore", "delete" })
        {
            var refused = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/{action}", stale)));
            Assert.Equal("newsletter-version-conflict", refused.GetProperty("code").GetString());
        }

        await AssertStatusAsync(HttpStatusCode.Conflict, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row) + 5, language = "en" }));
        var after = await ReadAsync(e);
        Assert.Equal(VersionOf(row), VersionOf(after));
        Assert.Equal("vi", after.GetProperty("language").GetString());
        Assert.Equal(0, await Count("NewsletterSubscriptionAudits", "\"Action\" <> 'created'"));
        // A request body without a version is a 400, never a silent overwrite.
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/delete", new { }));
    }

    // ------------------------------------------------------------------------------------------------------------ unsubscribe, archive, delete

    [Fact]
    public async Task Staff_unsubscribe_stops_the_mail_and_only_the_visitors_own_request_brings_the_address_back_pending()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var row = await ReadAsync(e);
        var stopped = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, row, "unsubscribe")));
        Assert.Equal("Unsubscribed", stopped.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.String, stopped.GetProperty("unsubscribedAtUtc").ValueKind);
        Assert.Equal("Cancelled", await StatusOf("Welcome"));
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Single(e.Google.Sends);

        // Repeating it changes nothing.
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, stopped, "unsubscribe")));
        Assert.Equal(VersionOf(stopped), VersionOf(again));

        // The visitor asks again: pending, and a confirmation is queued (double opt-in). Confirming gives a NEW Welcome.
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));
        var back = await ReadAsync(e);
        Assert.Equal("PendingVerification", back.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, back.GetProperty("unsubscribedAtUtc").ValueKind);
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, Mail(e.Google.Sends[sends]).Token));
        Assert.Equal(2, await Welcomes());
    }

    [Fact]
    public async Task Archive_hides_the_row_withdraws_its_mail_and_restore_brings_it_back_while_the_visitors_request_un_hides_it()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var row = await ReadAsync(e);
        var archived = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, row, "archive")));
        Assert.Equal(JsonValueKind.String, archived.GetProperty("archivedAtUtc").ValueKind);
        Assert.Equal("Verified", archived.GetProperty("status").GetString());          // hiding is not consent
        Assert.Equal("Cancelled", await StatusOf("Welcome"));

        Assert.Equal(0, (await JsonAsync(await e.Staff.GetAsync($"{Admin}?search={Guest}"))).GetProperty("total").GetInt32());                         // default list
        Assert.Equal(1, (await JsonAsync(await e.Staff.GetAsync($"{Admin}?search={Guest}&scope=archived"))).GetProperty("total").GetInt32());
        Assert.Equal(1, (await JsonAsync(await e.Staff.GetAsync($"{Admin}?search={Guest}&scope=all"))).GetProperty("total").GetInt32());

        var restored = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, archived, "restore")));
        Assert.Equal(JsonValueKind.Null, restored.GetProperty("archivedAtUtc").ValueKind);

        var hiddenAgain = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, restored, "archive")));
        Assert.Equal(JsonValueKind.String, hiddenAgain.GetProperty("archivedAtUtc").ValueKind);
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));
        Assert.Equal(JsonValueKind.Null, (await ReadAsync(e)).GetProperty("archivedAtUtc").ValueKind);
    }

    [Fact]
    public async Task Delete_removes_the_row_its_tokens_and_its_mail_for_good_and_the_audit_keeps_no_address()
    {
        using var e = await BeginAsync();
        var confirmToken = await VerifyAsync(e);
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var welcomeToken = Mail(e.Google.Sends[sends]).Token;
        var row = await ReadAsync(e);

        await AssertStatusAsync(HttpStatusCode.NoContent, PostRowAsync(e, row, "delete"));
        Assert.Equal(0, await Count("NewsletterSubscriptions"));
        Assert.Equal(0, await Count("NewsletterVerificationRequests"));
        // The old links do not rebuild the subscriber they belonged to.
        await AssertStatusAsync(HttpStatusCode.BadRequest, ConfirmAsync(e, confirmToken));
        await AssertStatusAsync(HttpStatusCode.BadRequest, UnsubscribeLinkAsync(e, welcomeToken));
        Assert.Equal(0, await Count("NewsletterSubscriptions"));
        await AssertStatusAsync(HttpStatusCode.NotFound, PostRowAsync(e, row, "delete"));

        var audit = await ScalarAsync<string>($"""SELECT string_agg("Action", ',' ORDER BY "OccurredAtUtc") FROM "NewsletterSubscriptionAudits" WHERE "SubscriptionId" = '{IdOf(row)}' """);
        Assert.Equal("deleted", audit);
        Assert.DoesNotContain(Guest, await ScalarAsync<string>("""SELECT coalesce(string_agg(a::text, ' '), '') FROM "NewsletterSubscriptionAudits" a"""), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Every_staff_action_is_recorded_with_who_and_when_and_never_the_address()
    {
        using var e = await BeginAsync();
        var row = await AddAsync(e);
        var edited = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email = "second@example.com", language = "en" })));
        await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, edited, "verification-invitations", new { }));
        var current = await ReadAsync(e, "second@example.com");
        var stopped = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, current, "unsubscribe")));
        var archived = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, stopped, "archive")));
        var restored = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, archived, "restore")));
        await AssertStatusAsync(HttpStatusCode.NoContent, PostRowAsync(e, restored, "delete"));

        Assert.Equal("archived,created,deleted,edited,invited,restored,unsubscribed",
            await ScalarAsync<string>("""SELECT string_agg(DISTINCT "Action", ',' ORDER BY "Action") FROM "NewsletterSubscriptionAudits" """));
        Assert.Equal("email,language", await ScalarAsync<string>("""SELECT "Detail" FROM "NewsletterSubscriptionAudits" WHERE "Action" = 'edited' """));
        var staffId = await ScalarAsync<Guid>($"""SELECT "Id" FROM "StaffAccounts" WHERE "Email" = '{Site}' """);
        Assert.Equal(7, await Count("NewsletterSubscriptionAudits", $"\"ActorStaffId\" = '{staffId}'"));
        var everything = await ScalarAsync<string>("""SELECT string_agg(a::text, ' ') FROM "NewsletterSubscriptionAudits" a""");
        Assert.DoesNotContain("example.com", everything);
    }

    [Fact]
    public async Task The_list_filters_by_status_and_scope_and_refuses_values_it_does_not_know()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e, "ok@example.com");
        var pending = await AddAsync(e, "pending@example.com");
        var hidden = await AddAsync(e, "hidden@example.com");
        await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, hidden, "archive"));

        async Task<string[]> EmailsAsync(string query) =>
            (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync($"{Admin}?{query}")))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("email").GetString()!).Order().ToArray();

        Assert.Equal(new[] { "ok@example.com", "pending@example.com" }, await EmailsAsync(""));
        Assert.Equal(new[] { "ok@example.com" }, await EmailsAsync("status=Verified"));
        Assert.Equal(new[] { "pending@example.com" }, await EmailsAsync("status=PendingVerification"));
        Assert.Empty(await EmailsAsync("status=Unsubscribed"));
        Assert.Equal(new[] { "hidden@example.com" }, await EmailsAsync("scope=archived"));
        Assert.Equal(3, (await EmailsAsync("scope=all")).Length);
        Assert.Equal(new[] { pending.GetProperty("email").GetString()! }, await EmailsAsync("search=PENDING"));
        foreach (var bad in new[] { "status=Nope", "scope=Nope", "page=0", "pageSize=101" })
            await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.GetAsync($"{Admin}?{bad}"));
    }

    [Fact]
    public async Task Only_staff_with_the_website_flag_reach_the_new_routes()
    {
        using var e = await BeginAsync();
        var row = await AddAsync(e);
        var routes = new (string Path, object Body)[]
        {
            (Admin, new { email = "x@example.com" }),
            ($"{Admin}/{IdOf(row)}/update", new { expectedVersion = 1, language = "en" }),
            ($"{Admin}/{IdOf(row)}/verification-invitations", new { }),
            ($"{Admin}/{IdOf(row)}/unsubscribe", new { expectedVersion = 1 }),
            ($"{Admin}/{IdOf(row)}/archive", new { expectedVersion = 1 }),
            ($"{Admin}/{IdOf(row)}/restore", new { expectedVersion = 1 }),
            ($"{Admin}/{IdOf(row)}/delete", new { expectedVersion = 1 })
        };
        foreach (var (path, body) in routes)
        {
            await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Client.SendAsync(Post(path, body)));
            await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Post(path, body, e.DeskCookie)));
        }

        Assert.Equal("PendingVerification", (await ReadAsync(e)).GetProperty("status").GetString());
        Assert.Equal(1, await Count("NewsletterSubscriptions"));
        // A Staff write also needs the approved Origin and a JSON body.
        await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Post($"{Admin}/{IdOf(row)}/archive", new { expectedVersion = 1 }, e.Staff.Cookie, origins: ["https://evil.example"])));
    }

    // ------------------------------------------------------------------------------------------------------------ the Welcome

    [Fact]
    public async Task A_verification_makes_exactly_one_Welcome_whatever_is_replayed_or_pressed_together()
    {
        using var e = await BeginAsync();
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));
        Assert.Equal(1, await DispatchAsync(e.Host));
        var first = Mail(e.Google.Sends[0]).Token;
        // A second confirmation mail while the first link is still good: one address, two valid links.
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(6);
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));
        Assert.Equal(1, await DispatchAsync(e.Host));
        var second = Mail(e.Google.Sends[1]).Token;
        Assert.NotEqual(first, second);

        // Both links, pressed at once, and again afterwards: one change of state, one Welcome.
        var presses = await Task.WhenAll(Enumerable.Range(0, 12).Select(i => ConfirmAsync(e, i % 2 == 0 ? first : second)));
        Assert.All(presses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, await Welcomes());
        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, first));
        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, second));
        Assert.Equal(1, await Welcomes());
        Assert.Equal(1, await Count("NewsletterSubscriptions", "\"Status\" = 'Verified'"));
        Assert.Equal(2, VersionOf(await ReadAsync(e)));      // created at 1, verified once

        // The Welcome is not a confirmation mail: the verification did not cancel it, and the worker sends it.
        Assert.Equal("Pending", await StatusOf("Welcome"));
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", await StatusOf("Welcome"));
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Equal(3, e.Google.Sends.Count);
    }

    [Theory]
    [InlineData("vi", "Xin chào,", "Khám phá The BHA", "Hủy nhận tin")]
    [InlineData("en", "Hello,", "Discover The BHA", "Unsubscribe")]
    [InlineData("fr", "Bonjour,", "Découvrir The BHA", "Se désabonner")]
    public async Task The_Welcome_has_the_same_subject_in_every_language_and_its_content_in_the_visitors(string language, string greeting, string cta, string unsubscribe)
    {
        using var e = await BeginAsync();
        await VerifyAsync(e, language: language);
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var mail = Mail(e.Google.Sends[sends]);

        Assert.Equal("Welcome to the BHA", mail.Headers["Subject"]);
        Assert.Equal(Guest, mail.Headers["To"]);
        Assert.Contains(greeting, mail.Text);
        Assert.Contains(Guest, mail.Text);                                                         // says which address was verified
        Assert.Contains($"{cta}: {CustomerOrigin}/", mail.Text);                                    // the CTA is a plain line when images are blocked
        foreach (var page in new[] { "/offers", "/riverside", "/blog" }) Assert.Contains($"{CustomerOrigin}{page}", mail.Text);
        // Exactly one line begins with https and it carries the token: the unsubscribe link, in the text, the HTML and the List-Unsubscribe header.
        Assert.StartsWith($"{CustomerOrigin}/newsletter/unsubscribe#t=", mail.Link);
        Assert.Contains(mail.Link, mail.Html);
        Assert.Equal($"<{mail.Link}>", mail.Headers["List-Unsubscribe"]);
        Assert.Contains(WebUtility.HtmlEncode(unsubscribe), mail.Html);          // the HTML part carries accented Latin-1 letters as entities
        Assert.Contains($"lang=\"{language}\"", mail.Html);
        Assert.Contains("<title>Welcome to the BHA</title>", mail.Html);
        Assert.Contains($"href=\"{CustomerOrigin}/\"", mail.Html);
        foreach (var page in new[] { "/offers", "/riverside", "/blog" }) Assert.Contains($"href=\"{CustomerOrigin}{page}\"", mail.Html);
        Assert.Contains("max-width:600px", mail.Html);
        // Pictures: inline parts the HTML refers to, each with alt text (the banner is decorative).
        var raw = Raw(e.Google.Sends[sends]);
        foreach (var cid in new[] { "bha-logo", "bha-welcome-hero", "bha-card-offers", "bha-card-riverside", "bha-card-blog" })
        {
            Assert.Contains($"src=\"cid:{cid}\"", mail.Html);
            Assert.Contains($"Content-ID: <{cid}>", raw);
        }

        Assert.DoesNotContain("<img src=\"http", mail.Html);
        Assert.DoesNotMatch("<img(?![^>]*alt=)", mail.Html);
    }

    [Fact]
    public async Task The_confirmation_mail_keeps_its_one_link_and_the_Welcome_token_only_unsubscribes()
    {
        using var e = await BeginAsync();
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));
        Assert.Equal(1, await DispatchAsync(e.Host));
        var confirm = Mail(e.Google.Sends[0]);
        Assert.StartsWith($"{CustomerOrigin}/newsletter/confirm#t=", confirm.Link);
        Assert.DoesNotContain("List-Unsubscribe", confirm.Headers.Keys);
        // A confirmation's token never unsubscribes.
        await AssertStatusAsync(HttpStatusCode.BadRequest, UnsubscribeLinkAsync(e, confirm.Token));
        Assert.Equal("PendingVerification", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));

        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, confirm.Token));
        Assert.Equal(1, await DispatchAsync(e.Host));
        var welcome = Mail(e.Google.Sends[1]);
        // A Welcome's token never confirms.
        var refused = await JsonAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, ConfirmAsync(e, welcome.Token)));
        Assert.Equal("newsletter-confirmation-invalid", refused.GetProperty("code").GetString());
        Assert.Equal(1, await Welcomes());
        foreach (var junk in new[] { "", "short", new string('a', 70), "not a token at all!!!!!!!!!!" })
            await AssertStatusAsync(HttpStatusCode.BadRequest, UnsubscribeLinkAsync(e, junk));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Client.SendAsync(Post(Unsubscriptions, new { }, origins: [CustomerOrigin])));
    }

    [Fact]
    public async Task The_unsubscribe_link_works_once_repeats_harmlessly_and_outlives_the_deadline_for_sending()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var token = Mail(e.Google.Sends[sends]).Token;
        // Long after the Welcome could still have been sent.
        Factory.Clock.UtcNow += TimeSpan.FromDays(30);

        var done = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, UnsubscribeLinkAsync(e, token)));
        Assert.Equal("unsubscribed", done.GetProperty("status").GetString());
        Factory.Clock.UtcNow -= TimeSpan.FromDays(30);          // the Staff session is only valid on the real clock
        var row = await ReadAsync(e);
        Assert.Equal("Unsubscribed", row.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.String, row.GetProperty("unsubscribedAtUtc").ValueKind);
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, UnsubscribeLinkAsync(e, token)));
        Assert.Equal("already-unsubscribed", again.GetProperty("status").GetString());
        Assert.Equal(VersionOf(row), VersionOf(await ReadAsync(e)));
        Assert.Equal("no-store", (await UnsubscribeLinkAsync(e, token)).Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Twelve_unsubscribes_at_once_change_the_row_once()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var token = Mail(e.Google.Sends[sends]).Token;
        var before = VersionOf(await ReadAsync(e));
        var answers = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => UnsubscribeLinkAsync(e, token)));
        var bodies = await Task.WhenAll(answers.Select(JsonAsync));

        Assert.All(answers, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, bodies.Count(b => b.GetProperty("status").GetString() == "unsubscribed"));
        Assert.Equal(before + 1, VersionOf(await ReadAsync(e)));
    }

    [Fact]
    public async Task A_Welcome_waits_while_Gmail_is_disconnected_and_goes_out_once_after_reconnecting()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/disconnect", new { }));
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Equal("Pending", await StatusOf("Welcome"));
        Assert.Single(e.Google.Sends);

        await ConnectAsync(e);
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", await StatusOf("Welcome"));
        Assert.Equal(2, e.Google.Sends.Count);
        Assert.Equal(0, await DispatchAsync(e.Host));
    }

    [Fact]
    public async Task A_Welcome_that_missed_its_deadline_is_dropped_but_the_address_stays_verified()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        Factory.Clock.UtcNow += TimeSpan.FromHours(169);
        Assert.Equal(0, await DispatchAsync(e.Host));
        Factory.Clock.UtcNow -= TimeSpan.FromHours(169);        // the Staff session is only valid on the real clock
        Assert.Equal("Cancelled", await StatusOf("Welcome"));
        Assert.Equal("expired", await ScalarAsync<string>("""SELECT "LastOutcome" FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
        Assert.Equal("Verified", (await ReadAsync(e)).GetProperty("status").GetString());
        Assert.Single(e.Google.Sends);
    }

    [Fact]
    public async Task An_address_verified_before_the_upgrade_gets_no_Welcome_after_it()
    {
        using var e = await BeginAsync();
        await ExecuteAsync(
            """
            INSERT INTO "NewsletterSubscriptions" ("Id", "Email", "Source", "Status", "ReceivedAtUtc", "VerifiedAtUtc")
            VALUES (gen_random_uuid(), 'old@example.com', 'homepage', 'Verified', now() - interval '3 days', now() - interval '2 days')
            """);
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Empty(e.Google.Sends);
        Assert.Equal(0, await Welcomes("old@example.com"));
        var row = await ReadAsync(e, "old@example.com");
        Assert.Equal("Verified", row.GetProperty("status").GetString());
        Assert.Equal("vi", row.GetProperty("language").GetString());
        Assert.Equal(1, VersionOf(row));
        // Asking again from the form changes nothing about a verified address: no Welcome, no new confirmation.
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe("old@example.com")));
        Assert.Equal(0, await Count("NewsletterVerificationRequests"));
    }

    // ------------------------------------------------------------------------------------------------------------ BHA-NEWSLETTER-003-C1

    /// <summary>The visitor's request has READ the Welcome token (and so knows the address) and is parked; it has not yet asked for the subscription's lock.</summary>
    private NewsletterSqlGate.Rule ParkUnsubscribeAfterTokenLookup() => _gate.Arm(
        sql => sql.StartsWith("SELECT", StringComparison.Ordinal) && sql.Contains("\"TokenHash\"", StringComparison.Ordinal) && sql.Contains("'Welcome'", StringComparison.Ordinal), afterRead: true);

    private async Task<string> SentWelcomeTokenAsync(Env e)
    {
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        return Mail(e.Google.Sends[sends]).Token;
    }

    [Fact]
    public async Task An_unsubscribe_link_read_before_Staff_changed_the_address_is_void_when_it_gets_the_lock()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var token = await SentWelcomeTokenAsync(e);                       // the Welcome went to guest@example.com
        var row = await ReadAsync(e);
        var parked = ParkUnsubscribeAfterTokenLookup();

        var press = UnsubscribeLinkAsync(e, token);
        await parked.Arrived.WaitAsync(Patience);                         // the link is known to be A's; nothing is locked or written yet
        var edited = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email = "b@example.com" })));
        await AssertStatusAsync(HttpStatusCode.OK, PostRowAsync(e, edited, "verification-invitations", new { }));   // B's confirmation is waiting in the outbox
        var before = await ReadAsync(e, "b@example.com");
        parked.Release();

        var answer = await JsonAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, press.WaitAsync(Patience)));
        Assert.Equal("newsletter-unsubscribe-invalid", answer.GetProperty("code").GetString());
        var after = await ReadAsync(e, "b@example.com");
        Assert.Equal("PendingVerification", after.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, after.GetProperty("unsubscribedAtUtc").ValueKind);
        Assert.Equal(VersionOf(before), VersionOf(after));                // the stale link changed nothing
        Assert.Equal(1, await Count("NewsletterVerificationRequests", "\"Purpose\" = 'Verification' AND \"Status\" = 'Pending' AND \"RevokedAtUtc\" IS NULL"));   // B's mail is intact
        Assert.Equal(0, await Count("NewsletterVerificationRequests", "\"LastOutcome\" = 'unsubscribed'"));
        Assert.Equal(1, await DispatchAsync(e.Host));                    // and it still goes out, to B
        Assert.Equal("b@example.com", Mail(e.Google.Sends.Last()).Headers["To"]);
    }

    [Fact]
    public async Task A_valid_unsubscribe_link_still_works_when_an_unrelated_edit_lands_between_its_lookup_and_its_lock()
    {
        using var e = await BeginAsync();
        await VerifyAsync(e);
        var token = await SentWelcomeTokenAsync(e);
        var row = await ReadAsync(e);
        var parked = ParkUnsubscribeAfterTokenLookup();

        var press = UnsubscribeLinkAsync(e, token);
        await parked.Arrived.WaitAsync(Patience);
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), language = "en" }));   // same address: its links stay valid
        parked.Release();

        var done = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, press.WaitAsync(Patience)));
        Assert.Equal("unsubscribed", done.GetProperty("status").GetString());
        Assert.Equal("Unsubscribed", (await ReadAsync(e)).GetProperty("status").GetString());
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, UnsubscribeLinkAsync(e, token)));
        Assert.Equal("already-unsubscribed", again.GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_used_confirmation_link_answers_for_the_state_the_address_is_in_now()
    {
        using var e = await BeginAsync();
        var first = await VerifyAsync(e);
        Assert.Equal(1, await Welcomes());

        // Still verified: the replay is "already confirmed" and makes no second Welcome.
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, first)));
        Assert.Equal("already-verified", again.GetProperty("status").GetString());
        Assert.Equal(1, await Welcomes());

        // The visitor leaves through the Welcome's link: the old confirmation link must not claim the address is confirmed.
        var welcome = await SentWelcomeTokenAsync(e);
        await AssertStatusAsync(HttpStatusCode.OK, UnsubscribeLinkAsync(e, welcome));
        var gone = await JsonAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, ConfirmAsync(e, first)));
        Assert.Equal("newsletter-confirmation-invalid", gone.GetProperty("code").GetString());
        Assert.Equal("Unsubscribed", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));
        Assert.Equal(1, await Welcomes());

        // Subscribing again (time has passed: the test clock stands still, and one verification instant is one Welcome) makes it pending, and the old (used) link still confirms nothing.
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(10);
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var second = Mail(e.Google.Sends[sends]).Token;
        Assert.NotEqual(first, second);
        await AssertStatusAsync(HttpStatusCode.BadRequest, ConfirmAsync(e, first));
        Assert.Equal("PendingVerification", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));
        Assert.Equal(1, await Welcomes());

        // The new link of this round confirms, and makes exactly one more Welcome.
        var done = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, second)));
        Assert.Equal("verified", done.GetProperty("status").GetString());
        Assert.Equal(2, await Welcomes());
        Assert.Equal(1, await Count("NewsletterVerificationRequests", "\"Purpose\" = 'Welcome' AND \"Status\" = 'Pending'"));
        var replay = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, second)));
        Assert.Equal("already-verified", replay.GetProperty("status").GetString());
        Assert.Equal(2, await Welcomes());
    }

    [Theory]
    [InlineData("en", "Hello,")]
    [InlineData("fr", "Bonjour,")]
    public async Task A_confirmation_link_written_before_the_upgrade_makes_its_Welcome_in_the_language_the_upgrade_gave_the_address(string language, string greeting)
    {
        using var e = await BeginAsync();
        // The state the upgrade leaves behind for an address with a pending mail of this language (see the V23 migration test for the upgrade itself).
        var token = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');   // what the application itself issues
        await ExecuteAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","Language") VALUES ('{Guid.NewGuid()}','old-{language}@example.com','homepage','PendingVerification',now() - interval '1 day','{language}');
            INSERT INTO "NewsletterVerificationRequests" ("Id","SubscriptionId","TokenHash","Language","Status","Attempts","CreatedAtUtc","ExpiresAtUtc","NextAttemptAtUtc")
            SELECT gen_random_uuid(), "Id", '{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token))).ToLowerInvariant()}', '{language}', 'Sent', 1, now() - interval '1 hour', now() + interval '47 hours', now() - interval '1 hour' FROM "NewsletterSubscriptions";
            """);
        Assert.Equal(language, (await ReadAsync(e, $"old-{language}@example.com")).GetProperty("language").GetString());

        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, token));
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var mail = Mail(e.Google.Sends[sends]);
        Assert.Equal("Welcome to the BHA", mail.Headers["Subject"]);
        Assert.Contains(greeting, mail.Text);
        Assert.Contains($"lang=\"{language}\"", mail.Html);
        Assert.Equal(language, await ScalarAsync<string>("""SELECT "Language" FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
    }

    // ------------------------------------------------------------------------------------------------------------ BHA-NEWSLETTER-003-C2

    private static bool IsInsert(string sql) => sql.StartsWith("INSERT INTO \"NewsletterSubscriptions\"", StringComparison.Ordinal);

    /// <summary>The visitor's request has done everything up to and including "un-hide an archived row" (a statement that matches nothing for a visible row) and is parked.</summary>
    private static bool IsUnhide(string sql) =>
        sql.StartsWith("UPDATE \"NewsletterSubscriptions\"", StringComparison.Ordinal) && sql.Contains("\"ArchivedAtUtc\" = NULL", StringComparison.Ordinal) && sql.Contains("\"ArchivedAtUtc\" IS NOT NULL", StringComparison.Ordinal);

    private async Task WaitForLockWaitAsync()
    {
        var until = DateTime.UtcNow + Patience;
        while (DateTime.UtcNow < until)
        {
            if (await ScalarAsync<int>("""SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' """) > 0) return;
            await Task.Delay(25);
        }

        throw new TimeoutException("No session ever waited on a lock.");
    }

    private Task<int> MailsFor(string email) => ScalarAsync<int>(
        $"""SELECT count(*) FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = '{email}' """);

    [Theory]
    [InlineData("rename")]
    [InlineData("delete")]
    public async Task A_visitor_asking_for_an_address_Staff_just_renamed_or_deleted_gets_a_fresh_row_not_a_500_and_nothing_goes_to_the_replacement(string change)
    {
        using var e = await BeginAsync();
        var row = await AddAsync(e);                                                   // visible, pending, nothing sent
        var parked = _gate.Arm(IsInsert, afterRead: true);

        var visitor = e.Client.SendAsync(Subscribe(Guest));
        await parked.Arrived.WaitAsync(Patience);                                      // the visitor's INSERT found the address and did nothing; it holds no lock on the row
        var staff = change == "rename"
            ? e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email = "other@example.com" })
            : PostRowAsync(e, row, "delete");
        Assert.True((await staff.WaitAsync(Patience)).IsSuccessStatusCode);
        parked.Release();

        var answer = await JsonAsync(await AssertStatusAsync(HttpStatusCode.Accepted, visitor.WaitAsync(Patience)));
        Assert.Equal("email", answer.GetProperty("confirmation").GetString());
        // The address the visitor typed is a subscription again, with ITS mail; the one it was renamed to has none; nothing is left without a row.
        Assert.Equal(1, await Count("NewsletterSubscriptions", $"\"Email\" = '{Guest}' AND \"Source\" = 'homepage' AND \"Status\" = 'PendingVerification'"));
        Assert.Equal(1, await MailsFor(Guest));
        Assert.Equal(1, await Count("NewsletterVerificationRequests"));
        if (change == "rename")
        {
            Assert.Equal(0, await MailsFor("other@example.com"));
            Assert.Equal("PendingVerification", (await ReadAsync(e, "other@example.com")).GetProperty("status").GetString());
        }

        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal(Guest, Mail(e.Google.Sends[sends]).Headers["To"]);
        Assert.Equal(0, await DispatchAsync(e.Host));
    }

    [Fact]
    public async Task Two_visitors_asking_for_one_visible_address_at_once_queue_one_mail_and_keep_the_cooldown()
    {
        using var e = await BeginAsync();
        await AddAsync(e);
        var both = _gate.Arm(IsInsert, parties: 2, afterRead: true);

        var first = e.Client.SendAsync(Subscribe(Guest));
        var second = e.Client.SendAsync(Subscribe(Guest));
        await both.Arrived.WaitAsync(Patience);                                        // both have found the row and neither holds a lock yet
        both.Release();
        var answers = await Task.WhenAll(first, second).WaitAsync(Patience);

        Assert.All(answers, r => Assert.Equal(HttpStatusCode.Accepted, r.StatusCode));
        Assert.Equal(1, await Count("NewsletterSubscriptions"));
        Assert.Equal(1, await Count("NewsletterVerificationRequests"));
        Assert.Equal(1, await Count("NewsletterSubscriptions", "\"LastVerificationRequestedAtUtc\" IS NOT NULL"));
        Assert.Equal(1, await DispatchAsync(e.Host));
    }

    [Theory]
    [InlineData("rename")]
    [InlineData("delete")]
    public async Task While_the_visitor_holds_the_address_Staff_wait_for_it_and_then_withdraw_what_it_queued(string change)
    {
        using var e = await BeginAsync();
        var row = await AddAsync(e);
        var parked = _gate.Arm(IsUnhide, afterRead: true);

        var visitor = e.Client.SendAsync(Subscribe(Guest));
        await parked.Arrived.WaitAsync(Patience);                                      // the visitor has locked the row (and has not queued its mail yet)
        var staff = change == "rename"
            ? e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email = "other@example.com" })
            : PostRowAsync(e, row, "delete");
        await WaitForLockWaitAsync();                                                  // Staff are waiting for the visitor's lock
        Assert.False(staff.IsCompleted);
        parked.Release();

        await AssertStatusAsync(HttpStatusCode.Accepted, visitor.WaitAsync(Patience));
        Assert.True((await staff.WaitAsync(Patience)).IsSuccessStatusCode);
        // The mail the visitor queued for the address is withdrawn by Staff's change, in that order: nothing waits for the replacement or for a row that is gone.
        Assert.Equal(0, await Count("NewsletterVerificationRequests", "\"Status\" IN ('Pending', 'Sending')"));
        if (change == "rename")
        {
            Assert.Equal(1, await Count("NewsletterVerificationRequests", "\"Status\" = 'Cancelled' AND \"LastOutcome\" = 'email-changed' AND \"RevokedAtUtc\" IS NOT NULL"));
            Assert.Equal(0, await DispatchAsync(e.Host));
        }
        else
        {
            Assert.Equal(0, await Count("NewsletterSubscriptions"));
            Assert.Equal(0, await Count("NewsletterVerificationRequests"));
        }
    }

    [Theory]
    [InlineData("en", "Hello,")]
    [InlineData("fr", "Bonjour,")]
    public async Task A_resend_in_another_language_changes_the_subscription_with_the_mail_and_the_Welcome_follows(string language, string greeting)
    {
        using var e = await BeginAsync(connected: false);
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));          // recorded in Vietnamese while Gmail is disconnected
        Assert.Equal(0, await Count("NewsletterVerificationRequests"));
        var before = await ReadAsync(e);
        Assert.Equal("vi", before.GetProperty("language").GetString());
        await ConnectAsync(e);

        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest, language)));
        var row = await ReadAsync(e);
        Assert.Equal(language, row.GetProperty("language").GetString());
        Assert.Equal(VersionOf(before) + 1, VersionOf(row));
        Assert.Equal(language, await ScalarAsync<string>("""SELECT "Language" FROM "NewsletterVerificationRequests" """));
        var sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var confirmation = Mail(e.Google.Sends[sends]);
        Assert.Contains($"lang=\"{language}\"", confirmation.Html);                   // the confirmation mail itself is in the language the subscription now has
        var token = confirmation.Token;

        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, token));
        sends = e.Google.Sends.Count;
        Assert.Equal(1, await DispatchAsync(e.Host));
        var welcome = Mail(e.Google.Sends[sends]);
        Assert.Equal("Welcome to the BHA", welcome.Headers["Subject"]);
        Assert.Contains(greeting, welcome.Text);
        Assert.Equal(language, await ScalarAsync<string>("""SELECT "Language" FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
        // The used link again: still one Welcome.
        await AssertStatusAsync(HttpStatusCode.OK, ConfirmAsync(e, token));
        Assert.Equal(1, await Welcomes());
    }

    [Fact]
    public async Task A_resend_inside_the_cooldown_changes_neither_the_language_nor_the_mail_and_a_Staff_version_taken_before_a_language_change_conflicts()
    {
        using var e = await BeginAsync();
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest, "en")));    // queued: the cooldown is running
        var settled = await ReadAsync(e);
        Assert.Equal("en", settled.GetProperty("language").GetString());

        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest, "fr")));    // blocked by the cooldown
        var same = await ReadAsync(e);
        Assert.Equal("en", same.GetProperty("language").GetString());
        Assert.Equal(VersionOf(settled), VersionOf(same));
        Assert.Equal(1, await Count("NewsletterVerificationRequests"));
        Assert.Equal("en", await ScalarAsync<string>("""SELECT "Language" FROM "NewsletterVerificationRequests" """));

        // Staff read the row, then the cooldown ran out and the visitor asked again in French: the mail and the subscription are French, the Staff version is stale.
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(400);
        await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest, "fr")));
        Factory.Clock.UtcNow -= TimeSpan.FromSeconds(400);                                                  // the Staff session is only valid on the real clock
        var moved = await ReadAsync(e);
        Assert.Equal("fr", moved.GetProperty("language").GetString());
        Assert.Equal(VersionOf(same) + 1, VersionOf(moved));
        Assert.Equal("newsletter-version-conflict", (await JsonAsync(await AssertStatusAsync(HttpStatusCode.Conflict,
            e.Staff.PostAsync($"{Admin}/{IdOf(same)}/update", new { expectedVersion = VersionOf(same), language = "vi" })))).GetProperty("code").GetString());
        Assert.Equal("fr", (await ReadAsync(e)).GetProperty("language").GetString());
    }

    // ------------------------------------------------------------------------------------------------------------ a Staff action while the worker holds the mail

    /// <summary>
    /// The worker has taken the mail and is waiting for Google's answer to its token request; THEN Staff act on the address; THEN Google answers.
    /// The mail must not leave, and what the worker finds afterwards must make sense (a cancelled request, never an exception or a resurrected row).
    /// </summary>
    [Theory]
    [InlineData("confirmation", "delete")]
    [InlineData("confirmation", "unsubscribe")]
    [InlineData("confirmation", "archive")]
    [InlineData("confirmation", "email")]
    [InlineData("welcome", "delete")]
    [InlineData("welcome", "unsubscribe")]
    [InlineData("welcome", "archive")]
    [InlineData("welcome", "email")]
    public async Task A_staff_action_while_the_worker_holds_the_mail_stops_that_mail(string kind, string action)
    {
        using var e = await BeginAsync();
        if (kind == "welcome") await VerifyAsync(e);
        else await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(Guest)));
        var sendsBefore = e.Google.Sends.Count;
        var purpose = kind == "welcome" ? "Welcome" : "Verification";

        var parked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var answer = new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = 0;
        e.Google.Hold = call =>
        {
            if (!IsRefresh(call) || Interlocked.Increment(ref first) != 1) return Task.FromResult<int?>(null);
            parked.TrySetResult();
            return answer.Task;
        };
        var running = DispatchAsync(e.Host);
        await parked.Task.WaitAsync(Patience);
        Assert.Equal("Sending", await StatusOf(purpose));

        var row = await ReadAsync(e);
        var staff = action switch
        {
            "delete" => PostRowAsync(e, row, "delete"),
            "unsubscribe" => PostRowAsync(e, row, "unsubscribe"),
            "archive" => PostRowAsync(e, row, "archive"),
            _ => e.Staff.PostAsync($"{Admin}/{IdOf(row)}/update", new { expectedVersion = VersionOf(row), email = "elsewhere@example.com" })
        };
        var response = await staff.WaitAsync(Patience);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());

        answer.SetResult(null);
        await running.WaitAsync(Patience);
        Assert.Equal(sendsBefore, e.Google.Sends.Count);                          // nothing left for the address the mail was written for
        Assert.Empty(e.Google.Sends.Skip(sendsBefore));
        if (action == "delete")
        {
            Assert.Equal(0, await Count("NewsletterSubscriptions"));
            Assert.Equal(0, await Count("NewsletterVerificationRequests"));       // not brought back by the worker's late writes
        }
        else
        {
            Assert.Equal(0, await Count("NewsletterVerificationRequests", $"\"Purpose\" = '{purpose}' AND \"Status\" IN ('Pending', 'Sending') AND \"CreatedAtUtc\" >= now() - interval '1 day'"));
        }
    }

    private static string Raw(NewsletterGoogleStub.Call send)
    {
        var raw = JsonDocument.Parse(send.Body).RootElement.GetProperty("raw").GetString()!.Replace('-', '+').Replace('_', '/');
        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(raw.PadRight(raw.Length + (4 - raw.Length % 4) % 4, '=')));
    }
}
