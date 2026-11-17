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
/// BHA-NEWSLETTER-002: connecting the Gmail sender (OAuth authorization code + PKCE), queueing and sending the confirmation mail, and
/// confirming the address. Real PostgreSQL and the real HTTP pipeline; Google is replaced only at the network (<see cref="NewsletterGoogleStub"/>),
/// so request building, answer parsing, protection of secrets and every state change run for real. The outbox is driven by hand
/// (<see cref="DispatchAsync"/>) and by the clock, except in the one test that starts the real worker.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class NewsletterVerificationTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Public = "/api/v1/website/newsletter-subscriptions";
    private const string Confirmations = Public + "/confirmations";
    private const string Sender = "/api/admin/v1/website/newsletter-sender";
    private const string CustomerOrigin = "https://localhost:3000";
    private const string ClientId = "client-1.apps.googleusercontent.com";
    private const string ClientSecret = "GOCSPX-client-secret-1";
    private const string Guest = "guest@example.com";

    private sealed class Env(Session staff, NewsletterGoogleStub google, CapturingLoggerProvider logs) : IDisposable
    {
        public Session Staff { get; } = staff;
        public NewsletterGoogleStub Google { get; } = google;
        public CapturingLoggerProvider Logs { get; } = logs;
        public HttpClient Client => Staff.Client;
        public WebApplicationFactory<Program> Host => Staff.Host;
        public string? State { get; set; }
        public Uri? AuthorizationUrl { get; set; }
        public void Dispose() => Staff.Dispose();
    }

    /// <summary>BHA-NEWSLETTER-002-C1: parks chosen statements of the real application (nothing unless a test arms a rule).</summary>
    private readonly NewsletterSqlGate _gate = new();

    private WebApplicationFactory<Program> BuildHost(NewsletterGoogleStub google, CapturingLoggerProvider logs, Action<IWebHostBuilder>? configure) =>
        Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, "Staff");
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", CustomerOrigin);
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.UseSetting("Website:Newsletter:RateLimiting:PermitLimit", "10000");
            configure?.Invoke(builder);
            builder.ConfigureLogging(logging => { logging.SetMinimumLevel(LogLevel.Trace); logging.AddProvider(logs); });
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

    private async Task<Env> BeginAsync(Action<IWebHostBuilder>? configure = null)
    {
        var google = new NewsletterGoogleStub();
        var logs = new CapturingLoggerProvider();
        var host = BuildHost(google, logs, configure);
        await SeedStaffAsync(host);
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var client = CreateHttpsClient(host);
        return new Env(new Session(host, client, await LoginAsync(client, Site)), google, logs);
    }

    /// <summary>A second host over the same database and key ring, as after a restart or on another node.</summary>
    private Env Restart(Env previous, Action<IWebHostBuilder>? configure = null)
    {
        var google = new NewsletterGoogleStub();
        var logs = new CapturingLoggerProvider();
        var host = BuildHost(google, logs, configure);
        var client = CreateHttpsClient(host);
        return new Env(new Session(host, client, previous.Staff.Cookie), google, logs);
    }

    private async Task<(Uri Url, string State)> BeginConnectAsync(Env e, bool switchAccount = false, string? secret = ClientSecret, string clientId = ClientId)
    {
        var response = await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/connect", new { clientId, clientSecret = secret, switchAccount }));
        var url = new Uri((await JsonAsync(response)).GetProperty("authorizationUrl").GetString()!);
        e.AuthorizationUrl = url;
        e.State = HttpUtility.ParseQueryString(url.Query)["state"]!;
        return (url, e.State);
    }

    private static Task<HttpResponseMessage> PutAsync(Env e, string path, object body)
    {
        return e.Client.SendAsync(Post(path, body, e.Staff.Cookie));
    }

    private Task<HttpResponseMessage> CompleteAsync(Env e, string? state = null, string? code = "auth-code-1", string? error = null) =>
        e.Staff.PostAsync(Sender + "/connect/complete", new { state = state ?? e.State, code, error });

    private async Task ConnectAsync(Env e, string email = "sender@gmail.test", bool switchAccount = false, string? secret = ClientSecret)
    {
        e.Google.Email = email;
        await BeginConnectAsync(e, switchAccount, secret);
        await AssertStatusAsync(HttpStatusCode.OK, CompleteAsync(e));
    }

    private static HttpRequestMessage Subscribe(string email, string? language = null) =>
        Post(Public, new { email, language }, origins: [CustomerOrigin]);

    private async Task<string> SubscribeOkAsync(Env e, string email = Guest, string? language = null)
    {
        var response = await AssertStatusAsync(HttpStatusCode.Accepted, e.Client.SendAsync(Subscribe(email, language)));
        return await response.Content.ReadAsStringAsync();
    }

    private static async Task<int> DispatchAsync(WebApplicationFactory<Program> host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<INewsletterVerificationDispatcher>().ProcessBatchAsync(20, CancellationToken.None);
    }

    private async Task<JsonElement> SenderAsync(Env e) => await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync(Sender)));

    private Task<string> RequestStatusAsync(string email = Guest) => ScalarAsync<string>(
        $"""SELECT r."Status" FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = '{email}' ORDER BY r."CreatedAtUtc" DESC, r."Id" LIMIT 1""");

    private Task<int> RequestsAsync() => ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" """);

    // ---------------------------------------------------------------------------------------------------------------- connect

    [Fact]
    public async Task Connect_sends_the_browser_to_Google_with_PKCE_offline_consent_and_a_state_stored_only_as_a_hash()
    {
        using var e = await BeginAsync();
        var before = await SenderAsync(e);
        Assert.Equal("NotConnected", before.GetProperty("status").GetString());
        Assert.False(before.GetProperty("hasClientSecret").GetBoolean());
        Assert.Equal(AdminOrigin + "/website/newsletter/sender/callback", before.GetProperty("redirectUri").GetString());
        Assert.Contains("https://www.googleapis.com/auth/gmail.send", before.GetProperty("scopes").EnumerateArray().Select(s => s.GetString()));
        Assert.True(before.GetProperty("customerOriginReady").GetBoolean());

        var (url, state) = await BeginConnectAsync(e);
        var query = HttpUtility.ParseQueryString(url.Query);
        Assert.Equal("accounts.google.com", url.Host);
        Assert.Equal(ClientId, query["client_id"]);
        Assert.Equal(AdminOrigin + "/website/newsletter/sender/callback", query["redirect_uri"]);
        Assert.Equal("code", query["response_type"]);
        Assert.Equal("S256", query["code_challenge_method"]);
        Assert.Equal("offline", query["access_type"]);
        Assert.Equal("consent", query["prompt"]);
        Assert.Equal(new[] { "email", "https://www.googleapis.com/auth/gmail.send", "openid" }, query["scope"]!.Split(' ').Order().ToArray());
        Assert.True(state.Length >= 40);

        // Only the hash of the state is stored, and the secret is a protected payload.
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterOAuthStates" """));
        Assert.Equal(NewsletterGoogleStub.Sha256Hex(state), await ScalarAsync<string>("""SELECT "StateHash" FROM "NewsletterOAuthStates" """));
        Assert.DoesNotContain("GOCSPX", await ScalarAsync<string>("""SELECT "ProtectedClientSecret" FROM "NewsletterOAuthStates" """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "NewsletterOAuthStates" WHERE "StateHash" = '{state}' """));

        var (switchUrl, _) = await BeginConnectAsync(e, switchAccount: true);
        Assert.Equal("select_account consent", HttpUtility.ParseQueryString(switchUrl.Query)["prompt"]);
    }

    [Fact]
    public async Task Completing_the_connection_stores_only_protected_secrets_and_the_read_never_returns_them()
    {
        using var e = await BeginAsync();
        await BeginConnectAsync(e);
        var completed = await AssertStatusAsync(HttpStatusCode.OK, CompleteAsync(e));
        var body = await completed.Content.ReadAsStringAsync();

        var dto = JsonDocument.Parse(body).RootElement;
        Assert.Equal("Connected", dto.GetProperty("status").GetString());
        Assert.Equal("sender@gmail.test", dto.GetProperty("connectedEmail").GetString());
        Assert.Equal(ClientId, dto.GetProperty("clientId").GetString());
        Assert.True(dto.GetProperty("hasClientSecret").GetBoolean());
        foreach (var text in new[] { body, await (await e.Staff.GetAsync(Sender)).Content.ReadAsStringAsync() })
        {
            Assert.DoesNotContain("GOCSPX", text);
            Assert.DoesNotContain("refresh-token", text);
            Assert.DoesNotContain("access-token", text);
        }

        Assert.DoesNotContain("GOCSPX", await ScalarAsync<string>("""SELECT "ProtectedClientSecret" FROM "NewsletterSenderSettings" """));
        Assert.DoesNotContain("refresh-token", await ScalarAsync<string>("""SELECT "ProtectedRefreshToken" FROM "NewsletterSenderSettings" """));

        // The exchange carried the authorization code, the secret, the exact redirect URI and a verifier that matches the challenge.
        var exchange = HttpUtility.ParseQueryString(e.Google.Of("/token").Single().Body);
        Assert.Equal("authorization_code", exchange["grant_type"]);
        Assert.Equal("auth-code-1", exchange["code"]);
        Assert.Equal(ClientSecret, exchange["client_secret"]);
        Assert.Equal(AdminOrigin + "/website/newsletter/sender/callback", exchange["redirect_uri"]);
        Assert.Equal(HttpUtility.ParseQueryString(e.AuthorizationUrl!.Query)["code_challenge"], NewsletterGoogleStub.S256(exchange["code_verifier"]!));
        Assert.Equal("Bearer access-token-1", e.Google.Of("/userinfo").Single().Authorization);
    }

    [Fact]
    public async Task A_wrong_reused_expired_or_foreign_state_connects_nothing()
    {
        using var e = await BeginAsync();
        await CliAsync(e.Host, ["--staff-website-access", "--email", Manager, "--enabled", "true"]);
        using var other = new Session(e.Host, e.Client, await LoginAsync(e.Client, Manager));

        await BeginConnectAsync(e);
        await AssertStatusAsync(HttpStatusCode.BadRequest, CompleteAsync(e, state: "A".PadRight(43, 'x')));
        await AssertStatusAsync(HttpStatusCode.BadRequest, CompleteAsync(e, state: "short"));
        // Another Staff member cannot finish this member's attempt, and trying does not burn it.
        var foreign = await AssertStatusAsync(HttpStatusCode.BadRequest, other.PostAsync(Sender + "/connect/complete", new { state = e.State, code = "auth-code-1" }));
        Assert.Equal(("newsletter-connect-state-invalid", null), await ProblemAsync(foreign));
        Assert.Empty(e.Google.Of("/token"));
        Assert.Equal("NotConnected", (await SenderAsync(e)).GetProperty("status").GetString());

        await AssertStatusAsync(HttpStatusCode.OK, CompleteAsync(e));
        var reuse = await AssertStatusAsync(HttpStatusCode.BadRequest, CompleteAsync(e));
        Assert.Equal(("newsletter-connect-state-invalid", null), await ProblemAsync(reuse));
        Assert.Single(e.Google.Of("/token"));

        await BeginConnectAsync(e);
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(11);
        await AssertStatusAsync(HttpStatusCode.BadRequest, CompleteAsync(e));
        Assert.Single(e.Google.Of("/token"));
    }

    [Theory]
    [InlineData("scope")]
    [InlineData("refresh")]
    [InlineData("unverified")]
    [InlineData("exchange")]
    [InlineData("cancelled")]
    public async Task A_connection_that_cannot_be_proved_leaves_the_current_one_untouched(string failure)
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "first@gmail.test");
        var before = await SenderAsync(e);
        var generation = await ScalarAsync<int>("""SELECT "SenderGeneration" FROM "NewsletterSenderSettings" """);

        e.Google.Email = "second@gmail.test";
        switch (failure)
        {
            case "scope": e.Google.Scope = "openid email"; break;            // the user unticked "send email"
            case "refresh": e.Google.IssueRefreshToken = false; break;
            case "unverified": e.Google.EmailVerified = false; break;
            case "exchange": e.Google.ExchangeStatus = 400; break;
        }

        await BeginConnectAsync(e, switchAccount: true, secret: "GOCSPX-another-secret");
        var response = await AssertStatusAsync(HttpStatusCode.BadRequest,
            failure == "cancelled" ? CompleteAsync(e, code: null, error: "access_denied") : CompleteAsync(e));
        var expected = failure switch
        {
            "scope" => "newsletter-connect-scope-missing", "refresh" => "newsletter-connect-no-refresh-token",
            "unverified" => "newsletter-connect-email-unverified", "exchange" => "newsletter-connect-exchange-failed", _ => "newsletter-connect-cancelled"
        };
        Assert.Equal((expected, null), await ProblemAsync(response));

        var after = await SenderAsync(e);
        Assert.Equal("first@gmail.test", after.GetProperty("connectedEmail").GetString());
        Assert.Equal("Connected", after.GetProperty("status").GetString());
        Assert.Equal(before.GetProperty("version").GetInt32(), after.GetProperty("version").GetInt32());
        Assert.Equal(generation, await ScalarAsync<int>("""SELECT "SenderGeneration" FROM "NewsletterSenderSettings" """));
        // The attempt is over whatever happened: its state cannot be used again.
        await AssertStatusAsync(HttpStatusCode.BadRequest, CompleteAsync(e));
        // And the old secret is the one still stored: the pending one was only applied after a proved connection.
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSenderSettings" WHERE "ClientId" = 'client-1.apps.googleusercontent.com' """));
    }

    [Fact]
    public async Task Connect_validates_the_client_and_keeps_the_stored_secret_only_for_the_same_client_id()
    {
        using var e = await BeginAsync();
        var invalid = await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.PostAsync(Sender + "/connect", new { clientId = " ", clientSecret = ClientSecret }));
        Assert.Equal(("newsletter-sender-client-id-invalid", "clientId"), await ProblemAsync(invalid));
        var noSecret = await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.PostAsync(Sender + "/connect", new { clientId = ClientId }));
        Assert.Equal(("newsletter-sender-client-secret-required", "clientSecret"), await ProblemAsync(noSecret));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterOAuthStates" """));

        await ConnectAsync(e);
        // Reconnect or change account without typing the secret again: allowed for the same Client ID, refused for another.
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/connect", new { clientId = ClientId, switchAccount = true }));
        var other = await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.PostAsync(Sender + "/connect", new { clientId = "other.apps.googleusercontent.com" }));
        Assert.Equal("newsletter-sender-client-secret-required", (await ProblemAsync(other)).Code);
    }

    [Fact]
    public async Task Disconnect_revokes_at_Google_deletes_the_tokens_and_keeps_the_account_for_a_later_reconnect()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);

        var dto = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync(Sender + "/disconnect", new { })));
        Assert.Equal("NotConnected", dto.GetProperty("status").GetString());
        Assert.Equal("refresh-token-AAAA", HttpUtility.ParseQueryString(e.Google.Of("/revoke").Single().Body)["token"]);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSenderSettings" WHERE "ProtectedRefreshToken" IS NOT NULL """));

        // Gmail not connected: the form is V1 again.
        Assert.Equal("{\"status\":\"received\",\"confirmation\":\"none\"}", await SubscribeOkAsync(e));
        Assert.Equal(0, await RequestsAsync());
    }

    // ---------------------------------------------------------------------------------------------------------------- subscribe and send

    [Fact]
    public async Task Without_a_connected_sender_the_form_is_V1_it_records_the_address_and_queues_nothing()
    {
        using var e = await BeginAsync();

        var body = await SubscribeOkAsync(e);

        Assert.Equal("{\"status\":\"received\",\"confirmation\":\"none\"}", body);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "Status" = 'PendingVerification' AND "LastVerificationRequestedAtUtc" IS NULL """));
        Assert.Equal(0, await RequestsAsync());
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Empty(e.Google.Sends);
    }

    [Fact]
    public async Task With_a_sender_one_request_is_queued_and_sent_once_from_the_connected_account_with_a_link_that_is_stored_hashed()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "sender@gmail.test");
        await AssertStatusAsync(HttpStatusCode.OK, PutAsync(e, Sender + "/profile", new { expectedVersion = (await SenderAsync(e)).GetProperty("version").GetInt32(), senderName = "The BHA Hotel", replyTo = "Reception@Example.com" }));

        var body = await SubscribeOkAsync(e, "  Guest@Example.COM ", "fr");
        Assert.Equal("{\"status\":\"received\",\"confirmation\":\"email\"}", body);
        Assert.Equal("Pending", await RequestStatusAsync());
        Assert.Equal("fr", await ScalarAsync<string>("""SELECT "Language" FROM "NewsletterVerificationRequests" """));

        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal(0, await DispatchAsync(e.Host));
        var send = Assert.Single(e.Google.Sends);
        Assert.Equal("Bearer access-token-2", send.Authorization);
        var message = NewsletterGoogleStub.Decode(send);
        Assert.Equal("\"The BHA Hotel\" <sender@gmail.test>", message.Headers["From"]);
        Assert.Equal("guest@example.com", message.Headers["To"]);
        Assert.Equal("reception@example.com", message.Headers["Reply-To"]);
        Assert.Contains("Confirmez", message.Text);
        Assert.StartsWith("https://localhost:3000/newsletter/confirm#t=", message.Link);
        Assert.Contains(message.Link, message.Html);

        Assert.Equal("Sent", await RequestStatusAsync());
        // The token is only a hash in the database, and its protected copy is gone once the mail has left.
        Assert.Equal(NewsletterGoogleStub.Sha256Hex(message.Token), await ScalarAsync<string>("""SELECT "TokenHash" FROM "NewsletterVerificationRequests" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "ProtectedToken" IS NOT NULL """));
        Assert.Equal("sender@gmail.test", await ScalarAsync<string>("""SELECT "FromEmail" FROM "NewsletterVerificationRequests" """));
        var refresh = e.Google.Of("/token").Last();
        Assert.Equal("refresh_token", HttpUtility.ParseQueryString(refresh.Body)["grant_type"]);
        Assert.Equal("refresh-token-AAAA", HttpUtility.ParseQueryString(refresh.Body)["refresh_token"]);
    }

    [Fact]
    public async Task The_answer_does_not_depend_on_the_address_and_a_resend_waits_for_the_cooldown_then_replaces_the_unsent_mail()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        var start = Factory.Clock.UtcNow;

        var first = await SubscribeOkAsync(e);
        Factory.Clock.UtcNow = start.AddSeconds(60);
        Assert.Equal(first, await SubscribeOkAsync(e));
        Assert.Equal(first, await SubscribeOkAsync(e, "someone.else@example.com"));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = '{Guest}' """));

        Factory.Clock.UtcNow = start.AddSeconds(301);
        Assert.Equal(first, await SubscribeOkAsync(e));
        Assert.Equal(2, await ScalarAsync<int>($"""SELECT count(*) FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = '{Guest}' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Cancelled' AND "LastOutcome" = 'superseded' """));
        Assert.Equal(2, await DispatchAsync(e.Host));                        // the replaced mail is not sent: one for each address
        Assert.Equal(new[] { Guest, "someone.else@example.com" }, e.Google.Sends.Select(NewsletterGoogleStub.Decode).Select(m => m.Headers["To"]).Order().ToArray());
    }

    [Fact]
    public async Task A_cooldown_is_not_spent_while_no_sender_exists()
    {
        using var e = await BeginAsync();
        await SubscribeOkAsync(e);
        Assert.Equal(0, await RequestsAsync());

        await ConnectAsync(e);
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(5);
        Assert.Equal("{\"status\":\"received\",\"confirmation\":\"email\"}", await SubscribeOkAsync(e));
        Assert.Equal(1, await RequestsAsync());
    }

    [Fact]
    public async Task Concurrent_requests_for_one_address_queue_exactly_one_mail()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);

        var responses = await Task.WhenAll(Enumerable.Range(0, 24).Select(i => e.Client.SendAsync(Subscribe(i % 2 == 0 ? Guest : "  GUEST@example.com "))));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Accepted, response.StatusCode));
        Assert.Equal(1, await RequestsAsync());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSubscriptions" """));
    }

    // ---------------------------------------------------------------------------------------------------------------- confirm

    private async Task<string> QueueAndSendAsync(Env e, string email = Guest)
    {
        await SubscribeOkAsync(e, email);
        await DispatchAsync(e.Host);
        return NewsletterGoogleStub.Decode(e.Google.Sends.Last()).Token;
    }

    [Fact]
    public async Task Confirming_the_link_verifies_the_address_once_and_a_replay_changes_nothing()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        var token = await QueueAndSendAsync(e);
        // Whole seconds: PostgreSQL keeps microseconds, a .NET clock keeps ticks.
        var at = Factory.Clock.UtcNow = DateTimeOffset.FromUnixTimeSeconds(Factory.Clock.UtcNow.AddMinutes(3).ToUnixTimeSeconds());

        var first = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin])));
        Assert.Equal("{\"status\":\"verified\"}", await first.Content.ReadAsStringAsync());
        Assert.Equal("Verified", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));
        Assert.Equal(at.UtcDateTime, await ScalarAsync<DateTime>("""SELECT "VerifiedAtUtc" FROM "NewsletterSubscriptions" """));

        Factory.Clock.UtcNow = at.AddHours(1);
        var replay = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin])));
        Assert.Equal("{\"status\":\"already-verified\"}", await replay.Content.ReadAsStringAsync());
        Assert.Equal(at.UtcDateTime, await ScalarAsync<DateTime>("""SELECT "VerifiedAtUtc" FROM "NewsletterSubscriptions" """));

        // A verified address is never asked again, and the Admin list shows who and when.
        Factory.Clock.UtcNow = at.AddDays(1);
        await SubscribeOkAsync(e);
        Assert.Equal(1, await RequestsAsync());
        // A day later the first Staff session may have expired: a fresh sign-in reads the list.
        using var later = new Session(e.Host, e.Client, await LoginAsync(e.Client, Site));
        var list = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, later.GetAsync("/api/admin/v1/website/newsletter-subscriptions")));
        var row = list.GetProperty("items")[0];
        Assert.Equal("Verified", row.GetProperty("status").GetString());
        Assert.Equal(at.UtcDateTime, row.GetProperty("verifiedAtUtc").GetDateTimeOffset().UtcDateTime);
    }

    [Fact]
    public async Task Concurrent_confirmations_make_one_state_change()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        var token = await QueueAndSendAsync(e);

        var responses = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin]))));
        var bodies = await Task.WhenAll(responses.Select(r => r.Content.ReadAsStringAsync()));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, bodies.Count(b => b == "{\"status\":\"verified\"}"));
        Assert.Equal(11, bodies.Count(b => b == "{\"status\":\"already-verified\"}"));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "Status" = 'Verified' """));
    }

    [Fact]
    public async Task An_expired_unknown_or_malformed_token_is_refused_and_changes_nothing()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        var token = await QueueAndSendAsync(e);

        foreach (var bad in new[] { "", "short", new string('x', 100), "has space and !!", token + "a", new string('A', 43) })
        {
            var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, e.Client.SendAsync(Post(Confirmations, new { token = bad }, origins: [CustomerOrigin])));
            Assert.Equal(("newsletter-confirmation-invalid", null), await ProblemAsync(refused));
        }

        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Client.SendAsync(Post(Confirmations, new { }, origins: [CustomerOrigin])));
        Factory.Clock.UtcNow += TimeSpan.FromHours(49);
        var expired = await AssertStatusAsync(HttpStatusCode.Gone, e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin])));
        Assert.Equal(("newsletter-confirmation-expired", null), await ProblemAsync(expired));
        Assert.Equal("PendingVerification", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));
        // The link only opens a page: the API has no GET for it.
        Assert.NotEqual(HttpStatusCode.OK, (await e.Client.SendAsync(Get(Confirmations + "?token=" + token))).StatusCode);
    }

    // ---------------------------------------------------------------------------------------------------------------- failures and retries

    [Fact]
    public async Task An_unknown_outcome_is_retried_later_with_the_same_link_and_gives_up_as_uncertain()
    {
        using var e = await BeginAsync(b => b.UseSetting("Website:Newsletter:MaxAttempts", "3"));
        await ConnectAsync(e);
        await SubscribeOkAsync(e);

        e.Google.SendThrows = true;
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Pending", await RequestStatusAsync());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT "Attempts" FROM "NewsletterVerificationRequests" """));
        Assert.Equal(0, await DispatchAsync(e.Host));                       // not due yet: no hammering

        Factory.Clock.UtcNow += TimeSpan.FromMinutes(2);
        e.Google.SendThrows = false;
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", await RequestStatusAsync());
        var tokens = e.Google.Sends.Select(NewsletterGoogleStub.Decode).Select(m => m.Token).Distinct().ToList();
        Assert.Equal(2, e.Google.Sends.Count);
        Assert.Single(tokens);                                               // the same link in every attempt

        // Out of attempts with the outcome still unknown: stop, and say so.
        await SubscribeAfterCooldownAsync(e, "second@example.com");
        e.Google.SendThrows = true;
        for (var i = 0; i < 3; i++)
        {
            await DispatchAsync(e.Host);
            Factory.Clock.UtcNow += TimeSpan.FromMinutes(61);
        }

        Assert.Equal("Failed", await RequestStatusAsync("second@example.com"));
        Assert.Equal("uncertain", await ScalarAsync<string>("""SELECT r."LastOutcome" FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = 'second@example.com' """));
    }

    private async Task SubscribeAfterCooldownAsync(Env e, string email)
    {
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(1);
        await SubscribeOkAsync(e, email);
    }

    [Fact]
    public async Task A_refusal_by_Google_is_a_failure_that_is_not_retried()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);
        e.Google.SendStatus = 400;

        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Failed", await RequestStatusAsync());
        Assert.Equal("rejected", await ScalarAsync<string>("""SELECT "LastOutcome" FROM "NewsletterVerificationRequests" """));
        Factory.Clock.UtcNow += TimeSpan.FromHours(2);
        Assert.Equal(0, await DispatchAsync(e.Host));
        Assert.Single(e.Google.Sends);
    }

    [Theory]
    [InlineData("send-401")]
    [InlineData("send-403")]
    [InlineData("refresh-invalid-grant")]
    public async Task A_revoked_permission_marks_the_sender_for_reconnection_keeps_the_mail_and_gives_the_attempt_back(string cause)
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);
        switch (cause)
        {
            case "send-401": e.Google.SendStatus = 401; break;
            case "send-403": e.Google.SendStatus = 403; e.Google.SendReason = "insufficientPermissions"; break;
            default: e.Google.RefreshStatus = 400; break;
        }

        Assert.Equal(1, await DispatchAsync(e.Host));

        Assert.Equal("NeedsReconnect", (await SenderAsync(e)).GetProperty("status").GetString());
        Assert.Equal("Pending", await RequestStatusAsync());
        Assert.Equal(0, await ScalarAsync<int>("""SELECT "Attempts" FROM "NewsletterVerificationRequests" """));
        var calls = e.Google.Calls.Count;
        Assert.Equal(0, await DispatchAsync(e.Host));                        // queued, not attempted
        Assert.Equal(calls, e.Google.Calls.Count);

        // The form still records, and says a mail is expected only when one can be sent.
        Assert.Equal("{\"status\":\"received\",\"confirmation\":\"none\"}", await SubscribeOkAsync(e, "late@example.com"));

        e.Google.SendStatus = 200;
        e.Google.RefreshStatus = 200;
        await ConnectAsync(e);                                               // the same account again
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", await RequestStatusAsync());
    }

    [Fact]
    public async Task A_rate_limit_from_Google_is_a_later_retry_not_a_broken_connection()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);
        e.Google.SendStatus = 403;
        e.Google.SendReason = "rateLimitExceeded";

        await DispatchAsync(e.Host);

        Assert.Equal("Connected", (await SenderAsync(e)).GetProperty("status").GetString());
        Assert.Equal("Pending", await RequestStatusAsync());
    }

    // ---------------------------------------------------------------------------------------------------------------- identity of the sender

    [Fact]
    public async Task A_mail_already_tried_is_not_silently_sent_from_a_new_account_and_its_address_may_ask_again_at_once()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "old@gmail.test");
        await SubscribeOkAsync(e);
        e.Google.SendThrows = true;
        await DispatchAsync(e.Host);                                         // tried under the old account: outcome unknown
        e.Google.SendThrows = false;
        await SubscribeOkAsync(e, "untried@example.com");                    // never tried: it may go out from the new account

        await ConnectAsync(e, "new@gmail.test", switchAccount: true);

        Assert.Equal("new@gmail.test", (await SenderAsync(e)).GetProperty("connectedEmail").GetString());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT "SenderGeneration" FROM "NewsletterSenderSettings" """));
        Assert.Equal("Cancelled", await RequestStatusAsync());
        Assert.Equal("sender-changed", await ScalarAsync<string>($"""SELECT r."LastOutcome" FROM "NewsletterVerificationRequests" r JOIN "NewsletterSubscriptions" s ON s."Id" = r."SubscriptionId" WHERE s."Email" = '{Guest}' """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "Email" = '{Guest}' AND "LastVerificationRequestedAtUtc" IS NOT NULL """));

        Assert.Equal(1, await DispatchAsync(e.Host));
        var sent = NewsletterGoogleStub.Decode(e.Google.Sends.Last());
        Assert.Equal("untried@example.com", sent.Headers["To"]);
        Assert.Contains("new@gmail.test", sent.Headers["From"]);

        // No cooldown for the cancelled one: the same address asks again at once and is mailed from the new account.
        await SubscribeOkAsync(e);
        Assert.Equal(1, await DispatchAsync(e.Host));
        var again = NewsletterGoogleStub.Decode(e.Google.Sends.Last());
        Assert.Equal(Guest, again.Headers["To"]);
        Assert.Contains("new@gmail.test", again.Headers["From"]);
        // Everything that left after the switch left from the new account; the only mail from the old one is the single attempt made before it.
        Assert.Equal(1, e.Google.Sends.Select(NewsletterGoogleStub.Decode).Count(m => m.Headers["From"].Contains("old@gmail.test", StringComparison.Ordinal)));
        Assert.Equal(2, e.Google.Sends.Select(NewsletterGoogleStub.Decode).Count(m => m.Headers["From"].Contains("new@gmail.test", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Connecting_the_same_account_again_keeps_the_identity_and_the_pending_mail()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "same@gmail.test");
        await SubscribeOkAsync(e);
        e.Google.SendThrows = true;
        await DispatchAsync(e.Host);
        e.Google.SendThrows = false;

        await ConnectAsync(e, "same@gmail.test", switchAccount: true);

        Assert.Equal(0, await ScalarAsync<int>("""SELECT "SenderGeneration" FROM "NewsletterSenderSettings" """));
        Assert.Equal("Pending", await RequestStatusAsync());
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(2);
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", await RequestStatusAsync());
    }

    [Fact]
    public async Task The_sender_name_and_reply_to_are_pinned_at_the_first_attempt_and_later_mails_use_the_new_ones()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        async Task Profile(string name) => await AssertStatusAsync(HttpStatusCode.OK, PutAsync(e, Sender + "/profile", new { expectedVersion = (await SenderAsync(e)).GetProperty("version").GetInt32(), senderName = name, replyTo = "" }));
        await Profile("Old Name");
        await SubscribeOkAsync(e);
        e.Google.SendThrows = true;
        await DispatchAsync(e.Host);

        await Profile("New Name");
        await SubscribeOkAsync(e, "fresh@example.com");
        e.Google.SendThrows = false;
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(2);
        Assert.Equal(2, await DispatchAsync(e.Host));

        var sends = e.Google.Sends.Select(NewsletterGoogleStub.Decode).ToList();
        Assert.Equal(3, sends.Count);
        Assert.All(sends.Where(m => m.Headers["To"] == Guest), m => Assert.StartsWith("\"Old Name\"", m.Headers["From"]));
        Assert.StartsWith("\"New Name\"", sends.Single(m => m.Headers["To"] == "fresh@example.com").Headers["From"]);
    }

    [Fact]
    public async Task Profile_edits_are_versioned_and_a_name_that_could_inject_a_header_is_refused()
    {
        using var e = await BeginAsync();

        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PutAsync(e, Sender + "/profile", new { expectedVersion = 0, senderName = "  The BHA  ", replyTo = "Front@Example.com" })));
        Assert.Equal("The BHA", saved.GetProperty("senderName").GetString());
        Assert.Equal("front@example.com", saved.GetProperty("replyTo").GetString());
        Assert.Equal(1, saved.GetProperty("version").GetInt32());

        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, PutAsync(e, Sender + "/profile", new { expectedVersion = 0, senderName = "Other" }));
        Assert.Equal("newsletter-sender-version-conflict", (await ProblemAsync(stale)).Code);
        foreach (var name in new[] { "Evil\r\nBcc: x@y.test", "Tab\there", new string('n', 101) })
        {
            var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, PutAsync(e, Sender + "/profile", new { expectedVersion = 1, senderName = name }));
            Assert.Equal(("newsletter-sender-name-invalid", "senderName"), await ProblemAsync(refused));
        }

        var bad = await AssertStatusAsync(HttpStatusCode.BadRequest, PutAsync(e, Sender + "/profile", new { expectedVersion = 1, senderName = "ok", replyTo = "not-an-email" }));
        Assert.Equal(("newsletter-sender-reply-to-invalid", "replyTo"), await ProblemAsync(bad));
        var cleared = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, PutAsync(e, Sender + "/profile", new { expectedVersion = 1, senderName = "", replyTo = "" })));
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("senderName").ValueKind);
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("replyTo").ValueKind);
    }

    // ---------------------------------------------------------------------------------------------------------------- the outbox itself

    [Fact]
    public async Task Two_workers_never_send_one_request_twice_and_a_lease_that_ran_out_is_taken_over()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);
        e.Google.SendDelay = TimeSpan.FromMilliseconds(400);

        var results = await Task.WhenAll(DispatchAsync(e.Host), DispatchAsync(e.Host), DispatchAsync(e.Host));

        Assert.Equal(1, results.Sum());
        Assert.Single(e.Google.Sends);

        // A worker that died after taking a request: its lease runs out and another worker sends it.
        await SubscribeAfterCooldownAsync(e, "stuck@example.com");
        await ScalarAsync<int>("""UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "LeaseUntilUtc" = now() - interval '1 hour', "Attempts" = 1 WHERE "Status" = 'Pending' RETURNING 1""");
        e.Google.SendDelay = TimeSpan.Zero;
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", await RequestStatusAsync("stuck@example.com"));
    }

    [Fact]
    public async Task A_secret_that_cannot_be_read_any_more_asks_for_a_new_connection_instead_of_failing()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);
        await ScalarAsync<int>("""UPDATE "NewsletterSenderSettings" SET "ProtectedRefreshToken" = 'not-a-protected-payload' RETURNING 1""");

        Assert.Equal(1, await DispatchAsync(e.Host));

        Assert.Equal("NeedsReconnect", (await SenderAsync(e)).GetProperty("status").GetString());
        Assert.Empty(e.Google.Sends);
        Assert.Equal("Pending", await RequestStatusAsync());
    }

    [Theory]
    [InlineData("used")]
    [InlineData("unreadable")]
    public async Task A_request_whose_own_token_is_spent_or_unreadable_is_finished_and_never_disables_the_sender(string state)
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);
        // A worker took the request and died; the visitor confirmed meanwhile (token spent and cleared) — or the token cannot be read.
        await ScalarAsync<int>(state == "used"
            ? """UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "LeaseUntilUtc" = now() - interval '1 hour', "Attempts" = 1, "UsedAtUtc" = now(), "ProtectedToken" = NULL RETURNING 1"""
            : """UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "LeaseUntilUtc" = now() - interval '1 hour', "Attempts" = 1, "ProtectedToken" = 'not-a-protected-payload' RETURNING 1""");

        await DispatchAsync(e.Host);

        Assert.Equal("Connected", (await SenderAsync(e)).GetProperty("status").GetString());
        Assert.Empty(e.Google.Sends);
        Assert.Equal("Cancelled", await RequestStatusAsync());
        Assert.Equal(state == "used" ? "verified" : "token-unavailable", await ScalarAsync<string>("""SELECT "LastOutcome" FROM "NewsletterVerificationRequests" """));
        // A mail for an address nobody confirmed can be asked for again at once; the other mails of the site still go out.
        Assert.Equal(state == "used" ? 1 : 0, await ScalarAsync<int>($"""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "Email" = '{Guest}' AND "LastVerificationRequestedAtUtc" IS NOT NULL """));
        await SubscribeOkAsync(e, "next@example.com");
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Single(e.Google.Sends);
    }

    [Fact]
    public async Task Confirming_withdraws_a_request_a_worker_is_holding()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        var token = await QueueAndSendAsync(e);
        // The same address asked again and a worker holds the new request right now; the first link is confirmed.
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(400);
        await SubscribeOkAsync(e);
        await ScalarAsync<int>("""UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "LeaseUntilUtc" = now() + interval '1 hour', "Attempts" = 1 WHERE "Status" = 'Pending' RETURNING 1""");

        await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin])));

        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Sending' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Cancelled' AND "LastOutcome" = 'verified' """));
    }

    [Fact]
    public async Task What_one_host_protected_a_restarted_host_can_use_with_the_same_key_ring()
    {
        using var first = await BeginAsync();
        await ConnectAsync(first);
        await SubscribeOkAsync(first);

        using var second = Restart(first);
        Assert.Equal(1, await DispatchAsync(second.Host));

        Assert.Equal("Sent", await RequestStatusAsync());
        Assert.Equal("refresh-token-AAAA", HttpUtility.ParseQueryString(second.Google.Of("/token").Single().Body)["refresh_token"]);
        Assert.Equal("Connected", (await SenderAsync(second)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task The_real_worker_sends_a_queued_mail_on_its_own()
    {
        using var e = await BeginAsync(b => { b.UseSetting("Website:Newsletter:WorkerEnabled", "true"); b.UseSetting("Website:Newsletter:WorkerPollSeconds", "1"); });
        await ConnectAsync(e);
        await SubscribeOkAsync(e);

        for (var i = 0; i < 40 && await RequestStatusAsync() != "Sent"; i++) await Task.Delay(500);

        Assert.Equal("Sent", await RequestStatusAsync());
        Assert.Single(e.Google.Sends);
    }

    [Fact]
    public async Task Subscribers_from_before_this_version_stay_pending_and_nothing_is_mailed_to_them_when_the_worker_starts()
    {
        using var e = await BeginAsync(b => { b.UseSetting("Website:Newsletter:WorkerEnabled", "true"); b.UseSetting("Website:Newsletter:WorkerPollSeconds", "1"); });
        await ScalarAsync<int>("""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),'v1@example.com','homepage','PendingVerification', now()) RETURNING 1""");
        await ConnectAsync(e);

        await Task.Delay(3500);

        Assert.Empty(e.Google.Sends);
        Assert.Equal(0, await RequestsAsync());
        Assert.Equal("PendingVerification", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "VerifiedAtUtc" IS NOT NULL OR "LastVerificationRequestedAtUtc" IS NOT NULL """));
    }

    // ---------------------------------------------------------------------------------------------------------------- secrets stay out of logs and configuration is safe

    [Fact]
    public async Task No_secret_token_code_or_state_reaches_a_log_line()
    {
        using var e = await BeginAsync();
        e.Google.SendThrows = true;
        await ConnectAsync(e);
        var state = e.State!;
        await SubscribeOkAsync(e);
        await DispatchAsync(e.Host);
        e.Google.SendThrows = false;
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(2);
        await DispatchAsync(e.Host);
        var token = NewsletterGoogleStub.Decode(e.Google.Sends.Last()).Token;
        await e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin]));
        await e.Staff.PostAsync(Sender + "/disconnect", new { });

        var log = string.Join('\n', e.Logs.Lines);
        Assert.NotEmpty(log);
        foreach (var secret in new[] { ClientSecret, "refresh-token-AAAA", "access-token-1", "access-token-2", "auth-code-1", state, token, "A!a1" })
        {
            Assert.DoesNotContain(secret, log);
        }
    }

    [Fact]
    public async Task Google_endpoints_can_be_overridden_only_in_Development_and_only_with_https()
    {
        var production = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("Website:Newsletter:Google:TokenEndpoint", "https://stub.example/token");
        });
        var refused = Record.Exception(() => production.CreateClient());
        Assert.NotNull(refused);
        Assert.Contains("only in Development", refused.ToString());

        var plain = Factory.WithWebHostBuilder(builder => builder.UseSetting("Website:Newsletter:Google:TokenEndpoint", "http://stub.example/token"));
        var plainRefused = Record.Exception(() => plain.CreateClient());
        Assert.NotNull(plainRefused);
        Assert.Contains("must be absolute https URLs", plainRefused.ToString());
    }

    // ---------------------------------------------------------------------------------------------------------------- C1: concurrency
    // BHA-NEWSLETTER-002-C1. Each test puts two real requests in one known order (a parked Google answer, a parked SQL statement) and
    // checks the end state; none of them depends on timing.

    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(30);

    private static bool IsSend(NewsletterGoogleStub.Call call) => call.Path.EndsWith("/messages/send", StringComparison.Ordinal);

    private static bool IsRefresh(NewsletterGoogleStub.Call call) =>
        call.Path.EndsWith("/token", StringComparison.Ordinal) && !call.Body.Contains("authorization_code", StringComparison.Ordinal);

    /// <summary>Waits until some session of this database is blocked on a lock: the signal that the second request has reached the first one.</summary>
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

    // ---- P2 #1: an answer of the OLD connection that arrives after the Admin connected again

    [Theory]
    [InlineData("send-401", false)]
    [InlineData("send-401", true)]
    [InlineData("refresh-invalid-grant", false)]
    [InlineData("refresh-invalid-grant", true)]
    public async Task A_late_failure_of_the_old_connection_never_breaks_the_new_one(string cause, bool otherAccount)
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "old@gmail.test");
        await SubscribeOkAsync(e);

        var parked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var answer = new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = 0;
        e.Google.Hold = call =>
        {
            if (!(cause == "send-401" ? IsSend(call) : IsRefresh(call)) || Interlocked.Increment(ref first) != 1) return Task.FromResult<int?>(null);
            parked.TrySetResult();
            return answer.Task;
        };
        var worker = DispatchAsync(e.Host);
        await parked.Task.WaitAsync(Patience);

        // Google is still thinking. Meanwhile the Admin connects again (the same Gmail address, or another one).
        await ConnectAsync(e, otherAccount ? "new@gmail.test" : "old@gmail.test", switchAccount: true);
        answer.SetResult(cause == "send-401" ? 401 : 400);
        await worker.WaitAsync(Patience);

        // The old answer says nothing about the new connection.
        Assert.Equal("Connected", (await SenderAsync(e)).GetProperty("status").GetString());
        await SubscribeAfterCooldownAsync(e, "next@example.com");
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(5);
        await DispatchAsync(e.Host);
        Assert.Equal("Sent", await RequestStatusAsync("next@example.com"));
        Assert.Equal("Connected", (await SenderAsync(e)).GetProperty("status").GetString());
        if (!otherAccount) Assert.Equal("Sent", await RequestStatusAsync());      // the mail the old worker gave back goes out too
    }

    // ---- P2 #2: two saves of one version

    [Fact]
    public async Task Two_profile_saves_of_one_version_cannot_both_win()
    {
        using var e = await BeginAsync();
        await AssertStatusAsync(HttpStatusCode.OK, PutAsync(e, Sender + "/profile", new { expectedVersion = 0, senderName = "Seed" }));
        var version = (await SenderAsync(e)).GetProperty("version").GetInt32();

        // Both saves are parked just before they write, so both have seen the same version when either writes.
        var both = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterSenderSettings\"", StringComparison.Ordinal), parties: 2);
        var a = PutAsync(e, Sender + "/profile", new { expectedVersion = version, senderName = "From A", replyTo = "a@example.com" });
        var b = PutAsync(e, Sender + "/profile", new { expectedVersion = version, senderName = "From B", replyTo = "b@example.com" });
        await both.Arrived.WaitAsync(Patience);
        both.Release();
        var responses = await Task.WhenAll(a, b);

        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Conflict], responses.Select(r => r.StatusCode).Order().ToArray());
        var winner = responses.Single(r => r.StatusCode == HttpStatusCode.OK);
        var loser = responses.Single(r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal("newsletter-sender-version-conflict", (await ProblemAsync(loser)).Code);
        var won = (await JsonAsync(winner)).GetProperty("senderName").GetString();
        Assert.Contains(won, new[] { "From A", "From B" });
        Assert.Equal(won, await ScalarAsync<string>("""SELECT "SenderName" FROM "NewsletterSenderSettings" """));
        Assert.Equal(won == "From A" ? "a@example.com" : "b@example.com", await ScalarAsync<string>("""SELECT "ReplyTo" FROM "NewsletterSenderSettings" """));
        Assert.Equal(version + 1, await ScalarAsync<int>("""SELECT "Version" FROM "NewsletterSenderSettings" """));
    }

    [Fact]
    public async Task Two_first_profile_saves_leave_one_row_and_one_conflict()
    {
        using var e = await BeginAsync();
        var both = _gate.Arm(sql => sql.StartsWith("INSERT INTO \"NewsletterSenderSettings\"", StringComparison.Ordinal), parties: 2);
        var a = PutAsync(e, Sender + "/profile", new { expectedVersion = 0, senderName = "First A" });
        var b = PutAsync(e, Sender + "/profile", new { expectedVersion = 0, senderName = "First B" });
        await both.Arrived.WaitAsync(Patience);
        both.Release();
        var responses = await Task.WhenAll(a, b);

        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Conflict], responses.Select(r => r.StatusCode).Order().ToArray());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSenderSettings" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT "Version" FROM "NewsletterSenderSettings" """));
    }

    // ---- P2 #3: a worker whose lease ran out

    [Theory]
    [InlineData(200)]   // its late mail was accepted
    [InlineData(500)]   // its late answer is "unknown"
    [InlineData(400)]   // its late answer is a refusal
    [InlineData(401)]   // its late answer says the permission is gone
    public async Task A_worker_whose_lease_ran_out_cannot_touch_what_the_next_worker_holds(int lateAnswer)
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);

        var arrived = new[] { new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously), new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously) };
        var answers = new[] { new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously), new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously) };
        var sends = -1;
        e.Google.Hold = call =>
        {
            if (!IsSend(call)) return Task.FromResult<int?>(null);
            var n = Interlocked.Increment(ref sends);
            arrived[n].TrySetResult();
            return answers[n].Task;
        };

        var workerA = DispatchAsync(e.Host);
        await arrived[0].Task.WaitAsync(Patience);
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(200);                   // A's lease (120 s) is over
        var workerB = DispatchAsync(e.Host);
        await arrived[1].Task.WaitAsync(Patience);
        var leaseOfB = await ScalarAsync<DateTime>("""SELECT "LeaseUntilUtc" FROM "NewsletterVerificationRequests" """);
        var claimOfB = await ScalarAsync<Guid>("""SELECT "ClaimId" FROM "NewsletterVerificationRequests" """);

        answers[0].SetResult(lateAnswer);                                    // A finally hears back
        await workerA.WaitAsync(Patience);

        // B still holds the request, with everything it had.
        Assert.Equal("Sending", await RequestStatusAsync());
        Assert.Equal(leaseOfB, await ScalarAsync<DateTime>("""SELECT "LeaseUntilUtc" FROM "NewsletterVerificationRequests" """));
        Assert.Equal(claimOfB, await ScalarAsync<Guid>("""SELECT "ClaimId" FROM "NewsletterVerificationRequests" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "ProtectedToken" IS NOT NULL AND "Attempts" = 2 AND "SentAtUtc" IS NULL """));
        Assert.Equal("Connected", (await SenderAsync(e)).GetProperty("status").GetString());

        answers[1].SetResult(200);                                           // B finishes by itself
        await workerB.WaitAsync(Patience);
        Assert.Equal("Sent", await RequestStatusAsync());
        Assert.Equal("Connected", (await SenderAsync(e)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_worker_that_lost_its_claim_before_pinning_the_identity_neither_pins_nor_sends()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await AssertStatusAsync(HttpStatusCode.OK, PutAsync(e, Sender + "/profile", new { expectedVersion = (await SenderAsync(e)).GetProperty("version").GetInt32(), senderName = "Name One" }));
        await SubscribeOkAsync(e);

        // A has taken the request and read "Name One"; it is parked just before it pins that identity.
        var pin = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterVerificationRequests\"", StringComparison.Ordinal) && sql.Contains("\"FromEmail\"", StringComparison.Ordinal));
        var workerA = DispatchAsync(e.Host);
        await pin.Arrived.WaitAsync(Patience);
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(200);
        await AssertStatusAsync(HttpStatusCode.OK, PutAsync(e, Sender + "/profile", new { expectedVersion = (await SenderAsync(e)).GetProperty("version").GetInt32(), senderName = "Name Two" }));

        // B takes the request over, pins "Name Two" and is parked inside its Gmail call.
        var parked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var answer = new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var sends = 0;
        e.Google.Hold = call =>
        {
            if (!IsSend(call) || Interlocked.Increment(ref sends) != 1) return Task.FromResult<int?>(null);
            parked.TrySetResult();
            return answer.Task;
        };
        var workerB = DispatchAsync(e.Host);
        await parked.Task.WaitAsync(Patience);

        pin.Release();                                                       // A now tries to pin "Name One" over B's
        await workerA.WaitAsync(Patience);

        Assert.Equal("Name Two", await ScalarAsync<string>("""SELECT "FromName" FROM "NewsletterVerificationRequests" """));
        Assert.Equal("Sending", await RequestStatusAsync());
        Assert.Single(e.Google.Sends);                                       // A sent nothing

        answer.SetResult(200);
        await workerB.WaitAsync(Patience);
        Assert.Equal("Sent", await RequestStatusAsync());
        Assert.StartsWith("\"Name Two\"", NewsletterGoogleStub.Decode(e.Google.Sends.Single()).Headers["From"]);
    }

    // ---- the connection epoch must be unique (P2 #1 relies on it)

    [Fact]
    public async Task Two_connections_that_overlap_each_advance_the_epoch_and_the_version()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "same@gmail.test");
        var epoch = await ScalarAsync<int>("""SELECT "ConnectionEpoch" FROM "NewsletterSenderSettings" """);
        var version = await ScalarAsync<int>("""SELECT "Version" FROM "NewsletterSenderSettings" """);
        var (_, first) = await BeginConnectAsync(e, switchAccount: true);
        var (_, second) = await BeginConnectAsync(e, switchAccount: true);

        // The first completion is parked just before it writes the sender; the second completes meanwhile (or waits for the first).
        var writing = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterSenderSettings\"", StringComparison.Ordinal));
        var a = CompleteAsync(e, state: first);
        await writing.Arrived.WaitAsync(Patience);
        var b = CompleteAsync(e, state: second);
        await Task.WhenAny(b, WaitForLockWaitAsync()).WaitAsync(Patience);
        writing.Release();
        var responses = await Task.WhenAll(a, b);

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(epoch + 2, await ScalarAsync<int>("""SELECT "ConnectionEpoch" FROM "NewsletterSenderSettings" """));
        Assert.Equal(version + 2, await ScalarAsync<int>("""SELECT "Version" FROM "NewsletterSenderSettings" """));
    }

    // ---- P2 #4: one lock order

    private async Task<string> MailDeliveredButUnansweredAsync(Env e)
    {
        // Gmail took the mail but the answer was lost: the request stays Pending, and the visitor holds a working link.
        e.Google.SendThrows = true;
        await SubscribeOkAsync(e);
        await DispatchAsync(e.Host);
        e.Google.SendThrows = false;
        Assert.Equal("Pending", await RequestStatusAsync());
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(400);                   // past the resend cooldown (300 s)
        return NewsletterGoogleStub.Decode(e.Google.Sends.Last()).Token;
    }

    [Fact]
    public async Task A_confirmation_and_a_resend_after_the_cooldown_never_deadlock_and_leave_no_mail_for_the_verified_address()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        var token = await MailDeliveredButUnansweredAsync(e);

        // The confirmation has taken what it needs and is parked just before it marks the address verified.
        var verifying = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterSubscriptions\"", StringComparison.Ordinal) && sql.Contains("'Verified'", StringComparison.Ordinal));
        var confirm = e.Client.SendAsync(Post(Confirmations, new { token }, origins: [CustomerOrigin]));
        await verifying.Arrived.WaitAsync(Patience);
        var resend = e.Client.SendAsync(Subscribe(Guest));
        await WaitForLockWaitAsync();                                        // the resend has run into the confirmation
        verifying.Release();
        var responses = await Task.WhenAll(confirm, resend);

        Assert.DoesNotContain(e.Logs.Lines, line => line.Contains("deadlock detected", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(HttpStatusCode.OK, responses[0].StatusCode);
        Assert.Equal("{\"status\":\"verified\"}", await responses[0].Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Accepted, responses[1].StatusCode);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "Status" = 'Verified' AND "VerifiedAtUtc" IS NOT NULL """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" IN ('Pending', 'Sending') """));
        Assert.Equal(0, await DispatchAsync(e.Host));
    }

    [Fact]
    public async Task A_change_of_sender_and_a_resend_after_the_cooldown_never_deadlock()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "old@gmail.test");
        await MailDeliveredButUnansweredAsync(e);

        // The new account's connection has withdrawn the old mail and is parked just before it frees the address's cooldown.
        e.Google.Email = "new@gmail.test";
        await BeginConnectAsync(e, switchAccount: true);
        var releasing = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterSubscriptions\"", StringComparison.Ordinal) && sql.Contains("\"LastVerificationRequestedAtUtc\" = NULL", StringComparison.Ordinal));
        var connect = CompleteAsync(e);
        await releasing.Arrived.WaitAsync(Patience);
        var resend = e.Client.SendAsync(Subscribe(Guest));
        await WaitForLockWaitAsync();
        releasing.Release();
        var responses = await Task.WhenAll(connect, resend);

        Assert.DoesNotContain(e.Logs.Lines, line => line.Contains("deadlock detected", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(HttpStatusCode.OK, responses[0].StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, responses[1].StatusCode);
        Assert.Equal("new@gmail.test", (await SenderAsync(e)).GetProperty("connectedEmail").GetString());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Cancelled' AND "LastOutcome" = 'sender-changed' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Pending' """));   // the resend is not lost
    }


    // ---------------------------------------------------------------------------------------------------------------- C2

    // ---- C2 #1: nothing is sent with a claim or a connection that is no longer current. These tests count the calls Google received.

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_worker_that_waited_for_its_token_sends_nothing_after_the_connection_changed(bool otherAccount)
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "old@gmail.test");
        await SubscribeOkAsync(e);

        var parked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var answer = new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = 0;
        e.Google.Hold = call =>
        {
            if (!IsRefresh(call) || Interlocked.Increment(ref first) != 1) return Task.FromResult<int?>(null);
            parked.TrySetResult();
            return answer.Task;
        };
        var worker = DispatchAsync(e.Host);
        await parked.Task.WaitAsync(Patience);

        // The worker is waiting for Google's token. The Admin connects again (another Gmail address, or the same one with a new grant).
        e.Google.RefreshToken = "refresh-token-NEW";
        await ConnectAsync(e, otherAccount ? "new@gmail.test" : "old@gmail.test", switchAccount: true);
        answer.SetResult(200);                                               // the OLD token now arrives
        await worker.WaitAsync(Patience);

        if (otherAccount)
        {
            Assert.Empty(e.Google.Sends);                                    // nothing left from the old account, and the mail is not sent from the new one either
            Assert.Equal("Cancelled", await RequestStatusAsync());
            Assert.Equal("sender-changed", await ScalarAsync<string>("""SELECT "LastOutcome" FROM "NewsletterVerificationRequests" """));
        }
        else
        {
            // The mail goes out once, and only after a token was made from the NEW grant.
            var calls = e.Google.Calls.ToList();
            var sendAt = calls.FindIndex(IsSend);
            Assert.Single(e.Google.Sends);
            Assert.True(calls.Take(sendAt).Any(c => IsRefresh(c) && c.Body.Contains("refresh-token-NEW", StringComparison.Ordinal)), "the send used a token of the old connection");
            Assert.Equal("Sent", await RequestStatusAsync());
            Assert.Equal(1, await ScalarAsync<int>("""SELECT "Attempts" FROM "NewsletterVerificationRequests" """));   // the attempt of the abandoned try was given back
        }
    }

    [Fact]
    public async Task A_worker_with_a_token_already_in_hand_sends_nothing_after_the_connection_changed()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e, "old@gmail.test");
        await SubscribeOkAsync(e);
        await SubscribeAfterCooldownAsync(e, "second@example.com");

        // The first mail goes out and leaves the worker with an access token. The worker is parked just before it pins the SECOND request.
        var pin = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterVerificationRequests\"", StringComparison.Ordinal) && sql.Contains("\"FromEmail\"", StringComparison.Ordinal), parties: 1, skip: 1);
        var worker = DispatchAsync(e.Host);
        await pin.Arrived.WaitAsync(Patience);
        Assert.Single(e.Google.Sends);
        await ConnectAsync(e, "new@gmail.test", switchAccount: true);
        pin.Release();
        await worker.WaitAsync(Patience);

        Assert.Single(e.Google.Sends);                                       // only the mail that left before the switch
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Sent' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Cancelled' AND "LastOutcome" = 'sender-changed' """));
    }

    [Fact]
    public async Task A_worker_that_waited_for_its_token_while_another_took_the_lease_over_sends_nothing()
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);

        var parked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var answer = new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = 0;
        e.Google.Hold = call =>
        {
            if (!IsRefresh(call) || Interlocked.Increment(ref first) != 1) return Task.FromResult<int?>(null);
            parked.TrySetResult();
            return answer.Task;
        };
        var workerA = DispatchAsync(e.Host);
        await parked.Task.WaitAsync(Patience);
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(200);                   // A's lease is over; B takes the request and sends it
        Assert.Equal(1, await DispatchAsync(e.Host));
        Assert.Equal("Sent", await RequestStatusAsync());

        answer.SetResult(200);                                               // A's token arrives late
        await workerA.WaitAsync(Patience);

        Assert.Single(e.Google.Sends);                                       // B's mail only: the address got one mail, not two
        Assert.Equal("Sent", await RequestStatusAsync());
    }

    // ---- C2 #2: the very first connection(s), when the sender table is empty

    [Fact]
    public async Task Two_first_connections_on_an_empty_table_leave_one_row_and_each_advances_the_epoch()
    {
        using var e = await BeginAsync();
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSenderSettings" """));
        var (_, first) = await BeginConnectAsync(e);
        var (_, second) = await BeginConnectAsync(e);

        // Both completions are parked just before they create the row: both have found the table empty.
        var creating = _gate.Arm(sql => sql.StartsWith("INSERT INTO \"NewsletterSenderSettings\"", StringComparison.Ordinal), parties: 2);
        var a = CompleteAsync(e, state: first);
        var b = CompleteAsync(e, state: second);
        await creating.Arrived.WaitAsync(Patience);
        creating.Release();
        var responses = await Task.WhenAll(a, b);

        Assert.DoesNotContain(e.Logs.Lines, line => line.Contains("duplicate key", StringComparison.OrdinalIgnoreCase));
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSenderSettings" """));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT "ConnectionEpoch" FROM "NewsletterSenderSettings" """));
        Assert.Equal("Connected", (await SenderAsync(e)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_first_connection_and_a_first_profile_save_share_one_row_and_one_rule()
    {
        using var e = await BeginAsync();
        var (_, state) = await BeginConnectAsync(e);

        var creating = _gate.Arm(sql => sql.StartsWith("INSERT INTO \"NewsletterSenderSettings\"", StringComparison.Ordinal), parties: 2);
        var connect = CompleteAsync(e, state: state);
        var profile = PutAsync(e, Sender + "/profile", new { expectedVersion = 0, senderName = "Profile Name" });
        await creating.Arrived.WaitAsync(Patience);
        creating.Release();
        var responses = await Task.WhenAll(connect, profile);

        Assert.Equal(HttpStatusCode.OK, responses[0].StatusCode);            // the connection always lands
        Assert.Contains(responses[1].StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict });
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSenderSettings" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT "ConnectionEpoch" FROM "NewsletterSenderSettings" """));
        Assert.Equal("Connected", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSenderSettings" """));
        if (responses[1].StatusCode == HttpStatusCode.OK)
            Assert.Equal("Profile Name", await ScalarAsync<string>("""SELECT "SenderName" FROM "NewsletterSenderSettings" """));   // a profile that won is kept by the connection
    }

    // ---------------------------------------------------------------------------------------------------------------- C3

    // ---- C3: cancelling an old request frees the cooldown only if THAT request still owns it (the stamp equals its own creation time)

    private async Task<int> CooldownsHeldAsync() =>
        await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "LastVerificationRequestedAtUtc" IS NOT NULL """);

    /// <summary>The cooldown must still be the replacement's: untouched, an immediate resend queues nothing, and after the cooldown a resend works.</summary>
    private async Task AssertReplacementKeepsItsCooldownAsync(Env e, DateTimeOffset replacementAt, string replacementStatus)
    {
        Assert.Equal(1, await CooldownsHeldAsync());
        Assert.Equal(replacementAt.UtcDateTime, await ScalarAsync<DateTime>("""SELECT "LastVerificationRequestedAtUtc" FROM "NewsletterSubscriptions" """));
        Assert.Equal(2, await RequestsAsync());                                                  // the cancelled one and its replacement
        Assert.Equal(replacementStatus, await RequestStatusAsync());
        await SubscribeOkAsync(e);                                                               // asked again at once: the cooldown still holds
        Assert.Equal(2, await RequestsAsync());
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(301);
        await SubscribeOkAsync(e);                                                               // and when it has run out, a resend works as usual
        Assert.Equal(3, await RequestsAsync());
    }

    [Theory]
    [InlineData("token-unavailable", false)]
    [InlineData("token-unavailable", true)]
    [InlineData("sender-changed", false)]
    [InlineData("sender-changed", true)]
    public async Task A_worker_cancelling_an_old_request_leaves_the_cooldown_of_its_replacement(string cause, bool replacementSent)
    {
        using var e = await BeginAsync();
        Factory.Clock.UtcNow = DateTimeOffset.FromUnixTimeSeconds(Factory.Clock.UtcNow.ToUnixTimeSeconds());   // whole seconds: PostgreSQL keeps microseconds
        await ConnectAsync(e);
        await SubscribeOkAsync(e);                                                               // request A, which owns the cooldown
        if (cause == "token-unavailable")
        {
            await ScalarAsync<int>("""UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "LeaseUntilUtc" = now() - interval '1 hour', "Attempts" = 1, "ProtectedToken" = 'not-a-protected-payload' RETURNING 1""");
        }
        else
        {
            e.Google.SendThrows = true;
            await DispatchAsync(e.Host);                                                         // A was tried under generation 0 and waits
            e.Google.SendThrows = false;
            await ScalarAsync<int>("""UPDATE "NewsletterSenderSettings" SET "SenderGeneration" = 1 RETURNING 1""");
            Factory.Clock.UtcNow += TimeSpan.FromSeconds(120);                                   // A is due again
        }

        // The worker has cancelled A and is parked just before it frees the cooldown.
        var releasing = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterSubscriptions\"", StringComparison.Ordinal) && sql.Contains("\"LastVerificationRequestedAtUtc\" = NULL", StringComparison.Ordinal));
        var worker = DispatchAsync(e.Host);
        await releasing.Arrived.WaitAsync(Patience);
        Assert.Equal("Cancelled", await RequestStatusAsync());

        // A's cooldown has run out; the address asks again and request B is queued and committed.
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(400);
        var replacementAt = Factory.Clock.UtcNow;
        await SubscribeOkAsync(e);
        if (!replacementSent) await ScalarAsync<int>("""UPDATE "NewsletterVerificationRequests" SET "NextAttemptAtUtc" = now() + interval '1 day' WHERE "Status" = 'Pending' RETURNING 1""");
        releasing.Release();
        await worker.WaitAsync(Patience);

        await AssertReplacementKeepsItsCooldownAsync(e, replacementAt, replacementSent ? "Sent" : "Pending");
    }

    /// <summary>
    /// The case that must still release: A owns the cooldown and nothing replaced it. NOT a reproduction (old code passes it): a guard that the
    /// conditional release still fires. The default test clock is NOT rounded to whole seconds, so it also shows that the stamp and the request's
    /// creation time stay equal with sub-microsecond ticks through PostgreSQL.
    /// </summary>
    [Theory]
    [InlineData("token-unavailable")]
    [InlineData("sender-changed")]
    public async Task A_worker_cancelling_a_request_nothing_replaced_frees_its_cooldown_at_once(string cause)
    {
        using var e = await BeginAsync();
        await ConnectAsync(e);
        await SubscribeOkAsync(e);
        if (cause == "token-unavailable")
        {
            await ScalarAsync<int>("""UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "LeaseUntilUtc" = now() - interval '1 hour', "Attempts" = 1, "ProtectedToken" = 'not-a-protected-payload' RETURNING 1""");
        }
        else
        {
            e.Google.SendThrows = true;
            await DispatchAsync(e.Host);
            e.Google.SendThrows = false;
            await ScalarAsync<int>("""UPDATE "NewsletterSenderSettings" SET "SenderGeneration" = 1 RETURNING 1""");
            Factory.Clock.UtcNow += TimeSpan.FromSeconds(120);
        }

        await DispatchAsync(e.Host);                                                             // nothing parked: A is cancelled and its cooldown freed

        Assert.Equal("Cancelled", await RequestStatusAsync());
        Assert.Equal(0, await CooldownsHeldAsync());
        await SubscribeOkAsync(e);                                                               // the same address asks again at once
        Assert.Equal(2, await RequestsAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_change_of_sender_that_withdraws_an_old_request_leaves_the_cooldown_of_its_replacement(bool replacementSent)
    {
        using var e = await BeginAsync();
        Factory.Clock.UtcNow = DateTimeOffset.FromUnixTimeSeconds(Factory.Clock.UtcNow.ToUnixTimeSeconds());
        await ConnectAsync(e, "old@gmail.test");
        e.Google.SendThrows = true;
        await SubscribeOkAsync(e);
        await DispatchAsync(e.Host);                                                             // request A: tried under the old account
        e.Google.SendThrows = false;
        await ScalarAsync<int>("""UPDATE "NewsletterVerificationRequests" SET "Status" = 'Sending', "LeaseUntilUtc" = now() + interval '1 hour' RETURNING 1""");   // a worker holds A right now

        // The new account's connection is parked at its write of the sender row, BEFORE it looks up and locks the affected subscriptions (those two are
        // raw commands the gate cannot see). B is queued and committed first; B has no pinned generation, so it is never withdrawn, and the release
        // keys only on the requests that were: the outcome is the same as with B arriving between the lookup and the lock.
        e.Google.Email = "new@gmail.test";
        var (_, state) = await BeginConnectAsync(e, switchAccount: true);
        var writing = _gate.Arm(sql => sql.StartsWith("UPDATE \"NewsletterSenderSettings\"", StringComparison.Ordinal));
        var connect = CompleteAsync(e, state: state);
        await writing.Arrived.WaitAsync(Patience);
        Factory.Clock.UtcNow += TimeSpan.FromSeconds(400);
        var replacementAt = Factory.Clock.UtcNow;
        await SubscribeOkAsync(e);
        if (!replacementSent) await ScalarAsync<int>("""UPDATE "NewsletterVerificationRequests" SET "NextAttemptAtUtc" = now() + interval '1 day' WHERE "Status" = 'Pending' RETURNING 1""");
        writing.Release();
        Assert.Equal(HttpStatusCode.OK, (await connect.WaitAsync(Patience)).StatusCode);
        if (replacementSent) Assert.Equal(1, await DispatchAsync(e.Host));

        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Status" = 'Cancelled' AND "LastOutcome" = 'sender-changed' """));
        await AssertReplacementKeepsItsCooldownAsync(e, replacementAt, replacementSent ? "Sent" : "Pending");
    }

    // ---------------------------------------------------------------------------------------------------------------- who may do what

    [Fact]
    public async Task Every_sender_route_needs_the_website_permission_a_staff_session_and_the_admin_origin()
    {
        using var e = await BeginAsync();
        var desk = await LoginAsync(e.Client, Desk);
        var manager = await LoginAsync(e.Client, Manager);
        var customer = await CustomerLoginAsync(e.Host, e.Client);
        var routes = new (string Path, object Body)[]
        {
            (Sender + "/profile", new { expectedVersion = 0, senderName = "x" }),
            (Sender + "/connect", new { clientId = ClientId, clientSecret = ClientSecret }),
            (Sender + "/connect/complete", new { state = "short" }),
            (Sender + "/disconnect", new { }),
        };

        foreach (var (path, body) in routes)
        {
            HttpRequestMessage Make(string? cookie, string[]? origins = null) => Post(path, body, cookie, origins);

            await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Client.SendAsync(Make(null)));
            await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Client.SendAsync(Make(customer)));
            await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Make(desk)));
            await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Make(manager)));
            await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Make(e.Staff.Cookie, ["https://evil.example"])));   // Origin
            var allowed = await e.Client.SendAsync(Make(e.Staff.Cookie));
            Assert.NotEqual(HttpStatusCode.Unauthorized, allowed.StatusCode);
            Assert.NotEqual(HttpStatusCode.Forbidden, allowed.StatusCode);
        }
    }
}

/// <summary>Collects every line the host logs (message and exception text), so a test can prove a secret is nowhere in it.</summary>
public sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly System.Collections.Concurrent.ConcurrentQueue<string> _lines = new();
    public IReadOnlyCollection<string> Lines => _lines.ToArray();
    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, _lines);
    public void Dispose() { }

    private sealed class Logger(string category, System.Collections.Concurrent.ConcurrentQueue<string> lines) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            lines.Enqueue($"{category}: {formatter(state, exception)} {exception}");
    }
}
