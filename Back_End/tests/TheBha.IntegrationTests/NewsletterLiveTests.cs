using System.Data.Common;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Web;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Realtime;
using TheBha.Application.Website;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Newsletter;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-NEWSLETTER-LIVE-001: the signal sent after a verification, the Staff Hub that carries it, and the list order that lets a just-verified old address lead.
/// Real PostgreSQL and the real HTTP pipeline; the Hub is reached through TestServer's WebSocket client with the real Staff cookie and an <c>Origin</c> header, and
/// speaks the SignalR JSON protocol by hand (handshake, one invocation, close), so the framing the browser client relies on is what is asserted.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class NewsletterLiveTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Public = "/api/v1/website/newsletter-subscriptions";
    private const string Admin = "/api/admin/v1/website/newsletter-subscriptions";
    private const string Sender = "/api/admin/v1/website/newsletter-sender";
    private const string HubPath = StaffNewsletterLiveAccess.Path;
    private const string CustomerOrigin = "https://localhost:3000";
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(1200);

    /// <summary>Records what the verification told the Admin screens, and can be told to fail like a broken publisher.</summary>
    private sealed class Recorder : INewsletterLiveSignal
    {
        public List<NewsletterVerifiedSignal> Signals { get; } = [];
        public Exception? Fail { get; set; }

        public Task PublishVerifiedAsync(NewsletterVerifiedSignal signal, CancellationToken cancellationToken)
        {
            lock (Signals) Signals.Add(signal);
            return Fail is null ? Task.CompletedTask : Task.FromException(Fail);
        }
    }

    /// <summary>Fails the next commit of any transaction once armed (a database that refuses COMMIT).</summary>
    private sealed class CommitFailure : DbTransactionInterceptor
    {
        public volatile bool Armed;

        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction, TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            if (Armed) throw new InvalidOperationException("COMMIT refused (test)");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Env(Session staff, NewsletterGoogleStub google, Recorder recorder, CommitFailure commit, string desk, string manager) : IDisposable
    {
        public Session Staff { get; } = staff;
        public NewsletterGoogleStub Google { get; } = google;
        public Recorder Recorder { get; } = recorder;
        public CommitFailure Commit { get; } = commit;
        public string DeskCookie { get; } = desk;
        public string ManagerCookie { get; } = manager;
        public HttpClient Client => Staff.Client;
        public WebApplicationFactory<Program> Host => Staff.Host;
        public void Dispose() => Staff.Dispose();
    }

    private async Task<Env> BeginAsync(bool recordInsteadOfHub, AdminCalendarAccessMode mode = AdminCalendarAccessMode.Staff)
    {
        var google = new NewsletterGoogleStub();
        var recorder = new Recorder();
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
                if (recordInsteadOfHub)
                {
                    services.RemoveAll<INewsletterLiveSignal>();
                    services.AddSingleton<INewsletterLiveSignal>(recorder);
                }
            });
        });
        await SeedStaffAsync(host);
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var client = CreateHttpsClient(host);
        var site = await LoginAsync(client, Site);
        var env = new Env(new Session(host, client, site), google, recorder, commit, await LoginAsync(client, Desk), await LoginAsync(client, Manager));
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

    // ---------------------------------------------------------------------------------------------------------- the verification flow

    private static Task<HttpResponseMessage> SubscribeAsync(Env e, string email) =>
        e.Client.SendAsync(Post(Public, new { email, language = "vi" }, origins: [CustomerOrigin]));

    private static Task<HttpResponseMessage> ConfirmAsync(Env e, string token) =>
        e.Client.SendAsync(Post(Public + "/confirmations", new { token }, origins: [CustomerOrigin]));

    private static async Task DispatchAsync(Env e)
    {
        await using var scope = e.Host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<INewsletterVerificationDispatcher>().ProcessBatchAsync(20, CancellationToken.None);
    }

    /// <summary>The public form and the confirmation mail: returns the token of the link, without pressing it.</summary>
    private static async Task<string> RequestLinkAsync(Env e, string email)
    {
        await AssertStatusAsync(HttpStatusCode.Accepted, SubscribeAsync(e, email));
        var sends = e.Google.Sends.Count;
        await DispatchAsync(e);
        return NewsletterGoogleStub.Decode(e.Google.Sends[sends]).Token;
    }

    private static async Task<string> ConfirmStatusAsync(Env e, string token)
    {
        var response = await ConfirmAsync(e, token);
        return response.StatusCode == HttpStatusCode.OK ? (await JsonAsync(response)).GetProperty("status").GetString()! : ((int)response.StatusCode).ToString();
    }

    private static int Signals(Env e)
    {
        lock (e.Recorder.Signals) return e.Recorder.Signals.Count;
    }

    private async Task<JsonElement> RowAsync(Env e, string email)
    {
        var page = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync($"{Admin}?search={Uri.EscapeDataString(email)}&scope=all")));
        return page.GetProperty("items").EnumerateArray().Single(item => item.GetProperty("email").GetString() == email);
    }

    // ---------------------------------------------------------------------------------------------------------- the signal

    [Fact]
    public async Task Only_the_call_that_really_moves_a_row_to_verified_signals_and_a_returning_visitor_signals_again()
    {
        using var e = await BeginAsync(recordInsteadOfHub: true);

        // Typing the address, an invitation and a Staff addition are not verifications.
        var token = await RequestLinkAsync(e, "a@example.com");
        await AssertStatusAsync(HttpStatusCode.Created, e.Staff.PostAsync(Admin, new { email = "added@example.com", language = "vi" }));
        var added = await RowAsync(e, "added@example.com");
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{added.GetProperty("id").GetGuid()}/verification-invitations", new { expectedVersion = added.GetProperty("version").GetInt32() }));
        Assert.Equal(0, Signals(e));

        Assert.Equal("verified", await ConfirmStatusAsync(e, token));
        Assert.Equal(1, Signals(e));
        var first = e.Recorder.Signals[0];
        Assert.NotEqual(Guid.Empty, first.EventId);

        // A replay, an unknown token and a malformed one change nothing and say nothing.
        Assert.Equal("already-verified", await ConfirmStatusAsync(e, token));
        Assert.Equal("400", await ConfirmStatusAsync(e, new string('a', 43)));
        Assert.Equal("400", await ConfirmStatusAsync(e, "not-a-token"));
        Assert.Equal(1, Signals(e));

        // The visitor leaves, comes back and confirms the new link: a new verification, a new signal with its own id.
        Factory.Clock.UtcNow += TimeSpan.FromMinutes(5);                                      // a later moment: the clock of a test does not move by itself
        var row = await RowAsync(e, "a@example.com");
        await AssertStatusAsync(HttpStatusCode.OK, e.Staff.PostAsync($"{Admin}/{row.GetProperty("id").GetGuid()}/unsubscribe", new { expectedVersion = row.GetProperty("version").GetInt32() }));
        var again = await RequestLinkAsync(e, "a@example.com");
        Assert.Equal("verified", await ConfirmStatusAsync(e, again));
        Assert.Equal(2, Signals(e));
        Assert.NotEqual(first.EventId, e.Recorder.Signals[1].EventId);
    }

    [Fact]
    public async Task A_verification_whose_commit_fails_signals_nothing_and_can_be_pressed_again()
    {
        using var e = await BeginAsync(recordInsteadOfHub: true);
        var token = await RequestLinkAsync(e, "a@example.com");

        e.Commit.Armed = true;
        try
        {
            Assert.Equal(HttpStatusCode.InternalServerError, (await ConfirmAsync(e, token)).StatusCode);
        }
        finally
        {
            e.Commit.Armed = false;
        }

        Assert.Equal(0, Signals(e));
        Assert.Equal("PendingVerification", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" WHERE "Email" = 'a@example.com' """));
        Assert.Equal("verified", await ConfirmStatusAsync(e, token));
        Assert.Equal(1, Signals(e));
    }

    [Fact]
    public async Task A_failing_publisher_never_changes_the_verification_or_loses_the_welcome()
    {
        using var e = await BeginAsync(recordInsteadOfHub: true);
        var token = await RequestLinkAsync(e, "a@example.com");
        e.Recorder.Fail = new InvalidOperationException("publisher is down");

        Assert.Equal("verified", await ConfirmStatusAsync(e, token));

        Assert.Equal(1, Signals(e));
        Assert.Equal("Verified", await ScalarAsync<string>("""SELECT "Status" FROM "NewsletterSubscriptions" WHERE "Email" = 'a@example.com' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
        // The replay still answers already-verified and the Welcome is still one.
        Assert.Equal("already-verified", await ConfirmStatusAsync(e, token));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
    }

    // ---------------------------------------------------------------------------------------------------------- the Hub: who may connect

    private sealed record Connection(WebSocket? Socket, int Status);

    private static async Task<Connection> ConnectAsync(Env e, string? cookie, string? origin = AdminOrigin, string scheme = "wss", string[]? origins = null)
    {
        var client = e.Host.Server.CreateWebSocketClient();
        client.ConfigureRequest = request =>
        {
            if (cookie is not null) request.Headers["Cookie"] = cookie;
            var sent = origins ?? (origin is null ? [] : [origin]);
            if (sent.Length > 0) request.Headers["Origin"] = new StringValues(sent);
        };
        try
        {
            var socket = await client.ConnectAsync(new Uri($"{scheme}://localhost{HubPath}"), CancellationToken.None);
            await socket.SendAsync(Encoding.UTF8.GetBytes("{\"protocol\":\"json\",\"version\":1}\u001e"), WebSocketMessageType.Text, true, CancellationToken.None);
            var handshake = await ReadAsync(socket, Patience);
            Assert.Equal("{}", handshake);
            // The connection is registered when the Hub says so (the handshake alone is not enough): from here a verification reaches it.
            var ready = await ReadAsync(socket, Patience);
            Assert.Contains(NewsletterLiveHub.ReadyMethod, ready);
            return new Connection(socket, 101);
        }
        catch (InvalidOperationException exception) when (exception.Message.Contains("status code: ", StringComparison.Ordinal))
        {
            var code = exception.Message[(exception.Message.IndexOf("status code: ", StringComparison.Ordinal) + "status code: ".Length)..].Trim();
            return new Connection(null, int.Parse(code, System.Globalization.CultureInfo.InvariantCulture));
        }
    }

    /// <summary>One SignalR record (up to the 0x1e separator), or <c>null</c> when the server closed the socket or nothing came in time.</summary>
    private static async Task<string?> ReadAsync(WebSocket socket, TimeSpan within)
    {
        using var timeout = new CancellationTokenSource(within);
        var text = new StringBuilder();
        var buffer = new byte[4096];
        try
        {
            while (true)
            {
                var received = await socket.ReceiveAsync(buffer, timeout.Token);
                if (received.MessageType == WebSocketMessageType.Close) return null;
                text.Append(Encoding.UTF8.GetString(buffer, 0, received.Count));
                if (received.EndOfMessage && text.Length > 0 && text[^1] == '\u001e') return text.ToString(0, text.Length - 1);
            }
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        catch (WebSocketException)
        {
            return null;
        }
    }

    /// <summary>The server closed or aborted the socket: silence alone would not be a revocation.</summary>
    private static void AssertClosed(WebSocket socket) =>
        Assert.True(socket.State is WebSocketState.CloseReceived or WebSocketState.Closed or WebSocketState.Aborted, $"the socket is {socket.State}");

    /// <summary>The next <c>newsletterVerified</c> invocation (pings skipped), or <c>null</c> on close or silence.</summary>
    private static async Task<JsonElement?> NextSignalAsync(WebSocket socket, TimeSpan within)
    {
        var until = DateTime.UtcNow + within;
        while (DateTime.UtcNow < until)
        {
            var record = await ReadAsync(socket, until - DateTime.UtcNow);
            if (record is null) return null;
            var frame = JsonDocument.Parse(record).RootElement.Clone();
            if (frame.GetProperty("type").GetInt32() == 1 && frame.GetProperty("target").GetString() == NewsletterLiveHub.VerifiedMethod) return frame;
        }

        return null;
    }

    [Fact]
    public async Task Only_a_signed_in_Staff_member_with_the_website_permission_from_an_approved_origin_over_HTTPS_connects()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        var customer = await CustomerLoginAsync(e.Host, e.Client);

        using (var ok = (await ConnectAsync(e, e.Staff.Cookie)).Socket) Assert.NotNull(ok);
        Assert.Equal(401, (await ConnectAsync(e, null)).Status);
        Assert.Equal(401, (await ConnectAsync(e, customer)).Status);
        Assert.Equal(401, (await ConnectAsync(e, ".TheBha.Staff=garbage")).Status);
        Assert.Equal(403, (await ConnectAsync(e, e.DeskCookie)).Status);
        Assert.Equal(403, (await ConnectAsync(e, e.ManagerCookie)).Status);

        // The Origin is checked on the handshake itself (CORS does not apply to a WebSocket): wrong, missing, another port, a look-alike and two values.
        Assert.Equal(403, (await ConnectAsync(e, e.Staff.Cookie, "https://evil.example")).Status);
        Assert.Equal(403, (await ConnectAsync(e, e.Staff.Cookie, null)).Status);
        Assert.Equal(403, (await ConnectAsync(e, e.Staff.Cookie, "https://localhost:3000")).Status);
        Assert.Equal(403, (await ConnectAsync(e, e.Staff.Cookie, "https://LOCALHOST:3001")).Status);
        Assert.Equal(403, (await ConnectAsync(e, e.Staff.Cookie, origins: [AdminOrigin, AdminOrigin])).Status);
        // Never over cleartext, signed in or not: the Admin prefix does not exist there.
        Assert.Equal(404, (await ConnectAsync(e, e.Staff.Cookie, scheme: "ws")).Status);
    }

    [Fact]
    public async Task Negotiate_and_the_preflight_are_answered_for_the_Admin_origin_only_and_offer_WebSockets_alone()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        var negotiate = $"{HubPath}/negotiate?negotiateVersion=1";

        var ok = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Post(negotiate, "", e.Staff.Cookie, contentType: "text/plain;charset=UTF-8")));
        var body = await JsonAsync(ok);
        Assert.Equal(["WebSockets"], body.GetProperty("availableTransports").EnumerateArray().Select(t => t.GetProperty("transport").GetString()).ToArray());
        Assert.Equal(AdminOrigin, Assert.Single(ok.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal("true", Assert.Single(ok.Headers.GetValues("Access-Control-Allow-Credentials")));
        Assert.Contains("no-store", ok.Headers.CacheControl?.ToString());

        await AssertStatusAsync(HttpStatusCode.Unauthorized, e.Client.SendAsync(Post(negotiate, "", null, contentType: "text/plain;charset=UTF-8")));
        await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Post(negotiate, "", e.DeskCookie, contentType: "text/plain;charset=UTF-8")));
        await AssertStatusAsync(HttpStatusCode.Forbidden, e.Client.SendAsync(Post(negotiate, "", e.Staff.Cookie, ["https://evil.example"], "text/plain;charset=UTF-8")));

        HttpRequestMessage Preflight(string origin, string method, string headers)
        {
            var request = new HttpRequestMessage(HttpMethod.Options, negotiate);
            request.Headers.TryAddWithoutValidation("Origin", origin);
            request.Headers.TryAddWithoutValidation("Access-Control-Request-Method", method);
            request.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", headers);
            return request;
        }

        var preflight = await e.Client.SendAsync(Preflight(AdminOrigin, "POST", "x-requested-with,x-signalr-user-agent,content-type"));
        Assert.Equal(HttpStatusCode.NoContent, preflight.StatusCode);
        Assert.Equal(AdminOrigin, Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal("POST", Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Methods")));
        Assert.Equal("true", Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Credentials")));
        var allowed = string.Join(",", preflight.Headers.GetValues("Access-Control-Allow-Headers")).ToLowerInvariant();
        Assert.Contains("x-signalr-user-agent", allowed);
        Assert.Contains("x-requested-with", allowed);

        // Another origin, or a method or header the Hub does not use, is not allowed; no other Admin policy was widened to make this work.
        // A browser lets the call through only when the origin, the method and every requested header are all listed in the answer.
        async Task<bool> AllowsAsync(string origin, string method, string headers)
        {
            var answer = (await e.Client.SendAsync(Preflight(origin, method, headers))).Headers;
            string Values(string name) => answer.TryGetValues(name, out var values) ? string.Join(",", values).ToLowerInvariant() : "";
            return Values("Access-Control-Allow-Origin") == origin.ToLowerInvariant() &&
                Values("Access-Control-Allow-Methods").Split(',').Contains(method.ToLowerInvariant(), StringComparer.OrdinalIgnoreCase) &&
                headers.Split(',').All(header => Values("Access-Control-Allow-Headers").Split(',').Contains(header.Trim()));
        }
        Assert.True(await AllowsAsync(AdminOrigin, "POST", "content-type,x-signalr-user-agent"), "the real call");
        Assert.False(await AllowsAsync("https://evil.example", "POST", "content-type"), "another origin");
        Assert.False(await AllowsAsync(AdminOrigin, "DELETE", "content-type"), "DELETE");
        Assert.False(await AllowsAsync(AdminOrigin, "PUT", "content-type"), "PUT");
        Assert.False(await AllowsAsync(AdminOrigin, "POST", "authorization"), "authorization header");
        Assert.False(await AllowsAsync(AdminOrigin, "POST", "x-anything-else"), "another header");
    }

    [Fact]
    public async Task The_Hub_does_not_exist_in_LocalGate_and_is_open_only_where_the_policy_enforces_it()
    {
        using (var local = await BeginAsync(recordInsteadOfHub: false, AdminCalendarAccessMode.LocalGate))
        {
            Assert.Equal(404, (await ConnectAsync(local, null)).Status);
            await AssertStatusAsync(HttpStatusCode.NotFound, local.Client.SendAsync(Post($"{HubPath}/negotiate?negotiateVersion=1", "", null, contentType: "text/plain;charset=UTF-8")));
        }

        using var e = await BeginAsync(recordInsteadOfHub: false);
        var endpoints = e.Host.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(endpoint => ("/" + endpoint.RoutePattern.RawText!.TrimStart('/')).StartsWith(HubPath, StringComparison.Ordinal)).ToList();
        Assert.NotEmpty(endpoints);
        Assert.All(endpoints, endpoint => Assert.True(StaffCalendarModeGuard.IsOpenInStaffMode(endpoint) && StaffNewsletterLiveAccess.IsEnforcedHub(endpoint), endpoint.RoutePattern.RawText));
        // Only the connect and negotiate routes carry the marker: the metadata alone, without the policy, opens nothing.
        var marker = new RouteEndpoint(_ => Task.CompletedTask, RoutePatternFactory.Parse("/api/admin/x"), 0, new EndpointMetadataCollection(new StaffLiveHubEndpointMetadata()), "marker only");
        Assert.False(StaffCalendarModeGuard.IsOpenInStaffMode(marker));
    }

    // ---------------------------------------------------------------------------------------------------------- the Hub: what it carries

    [Fact]
    public async Task A_real_verification_reaches_the_connected_Staff_with_a_payload_that_names_nobody()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        var token = await RequestLinkAsync(e, "private.guest@example.com");
        using var first = (await ConnectAsync(e, e.Staff.Cookie)).Socket!;
        using var second = (await ConnectAsync(e, e.Staff.Cookie)).Socket!;

        Assert.Equal("verified", await ConfirmStatusAsync(e, token));

        foreach (var socket in new[] { first, second })
        {
            var frame = await NextSignalAsync(socket, Patience);
            Assert.NotNull(frame);
            var argument = Assert.Single(frame!.Value.GetProperty("arguments").EnumerateArray());
            Assert.Equal(["eventId", "occurredAtUtc"], argument.EnumerateObject().Select(p => p.Name).Order().ToArray());
            Assert.NotEqual(Guid.Empty, argument.GetProperty("eventId").GetGuid());
            Assert.DoesNotContain("private.guest", frame.Value.GetRawText(), StringComparison.Ordinal);
            Assert.DoesNotContain(token, frame.Value.GetRawText(), StringComparison.Ordinal);
        }

        // A replay is not a new verification: nothing more arrives.
        Assert.Equal("already-verified", await ConfirmStatusAsync(e, token));
        Assert.Null(await NextSignalAsync(first, Quiet));
    }

    [Fact]
    public async Task A_client_can_send_nothing_the_Hub_acts_on()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        using var socket = (await ConnectAsync(e, e.Staff.Cookie)).Socket!;
        // An invocation of any method is a protocol error for a Hub without methods; an oversized frame closes the socket. Neither produces a signal.
        await socket.SendAsync(Encoding.UTF8.GetBytes("{\"type\":1,\"target\":\"newsletterVerified\",\"arguments\":[{}]}\u001e"), WebSocketMessageType.Text, true, CancellationToken.None);
        Assert.Null(await NextSignalAsync(socket, Quiet));
    }

    // ---------------------------------------------------------------------------------------------------------- the Hub: a connection that outlives its right

    /// <summary>Two links are requested before anything changes, so the verification that follows is the only thing that happens after.</summary>
    private static async Task<(string Before, string After)> TwoLinksAsync(Env e) =>
        (await RequestLinkAsync(e, "before@example.com"), await RequestLinkAsync(e, "after@example.com"));

    [Fact]
    public async Task A_revoked_website_permission_stops_the_next_signal_to_that_connection_and_closes_it_until_it_is_granted_again()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        var (before, after) = await TwoLinksAsync(e);
        using var open = (await ConnectAsync(e, e.Staff.Cookie)).Socket!;
        Assert.Equal("verified", await ConfirmStatusAsync(e, before));
        Assert.NotNull(await NextSignalAsync(open, Patience));

        await CliAsync(e.Host, ["--staff-website-access", "--email", Site, "--enabled", "false"]);
        Assert.Equal("verified", await ConfirmStatusAsync(e, after));
        Assert.Null(await NextSignalAsync(open, Patience));                                       // nothing sent, and the socket was closed
        AssertClosed(open);
        Assert.Equal(403, (await ConnectAsync(e, e.Staff.Cookie)).Status);                          // and it cannot come back

        await CliAsync(e.Host, ["--staff-website-access", "--email", Site, "--enabled", "true"]);
        using var again = (await ConnectAsync(e, e.Staff.Cookie)).Socket;
        Assert.NotNull(again);
    }

    [Fact]
    public async Task A_disabled_account_and_a_changed_security_stamp_receive_nothing_more()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        var (disabled, stamped) = await TwoLinksAsync(e);
        var third = await RequestLinkAsync(e, "third@example.com");

        // Another Staff member keeps the permission and keeps receiving: the others' revocation is theirs alone.
        await CliAsync(e.Host, ["--staff-website-access", "--email", Manager, "--enabled", "true"]);
        var managerCookie = await LoginAsync(e.Client, Manager);
        using var manager = (await ConnectAsync(e, managerCookie)).Socket!;

        using var disabledSocket = (await ConnectAsync(e, e.Staff.Cookie)).Socket!;
        await CliAsync(e.Host, ["--staff-disable", "--email", Site]);
        Assert.Equal("verified", await ConfirmStatusAsync(e, disabled));
        Assert.Null(await NextSignalAsync(disabledSocket, Patience));
        AssertClosed(disabledSocket);
        Assert.NotNull(await NextSignalAsync(manager, Patience));
        Assert.Equal(WebSocketState.Open, manager.State);

        // A password reset rotates the security stamp: the session cookie that was valid a moment ago is not, and neither is its open connection.
        await CliAsync(e.Host, ["--staff-reset-password", "--email", Manager], Password + "x");
        Assert.Equal("verified", await ConfirmStatusAsync(e, stamped));
        Assert.Null(await NextSignalAsync(manager, Patience));
        AssertClosed(manager);
        Assert.Equal("verified", await ConfirmStatusAsync(e, third));
    }

    [Fact]
    public async Task A_session_that_has_ended_closes_its_connection_by_the_ticket_it_was_opened_with()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        var (before, after) = await TwoLinksAsync(e);
        using var open = (await ConnectAsync(e, e.Staff.Cookie)).Socket!;
        Assert.Equal("verified", await ConfirmStatusAsync(e, before));
        Assert.NotNull(await NextSignalAsync(open, Patience));

        // The ticket of the real login cookie lasts StaffAuthentication.Lifetime from the (test) clock; the connection is judged by that same moment.
        Factory.Clock.UtcNow += StaffAuthentication.Lifetime + TimeSpan.FromSeconds(1);
        Assert.Equal("verified", await ConfirmStatusAsync(e, after));
        Assert.Null(await NextSignalAsync(open, Patience));
        AssertClosed(open);
        Assert.Equal(401, (await ConnectAsync(e, e.Staff.Cookie)).Status);
    }

    [Fact]
    public async Task The_periodic_sweep_closes_a_connection_that_lost_its_right_without_any_signal_being_sent()
    {
        using var e = await BeginAsync(recordInsteadOfHub: false);
        var sweeper = e.Host.Services.GetRequiredService<NewsletterLiveBroadcaster>();
        using var open = (await ConnectAsync(e, e.Staff.Cookie)).Socket!;
        Assert.Single(await sweeper.SweepAsync(CancellationToken.None));                         // still entitled: kept
        Assert.Equal(WebSocketState.Open, open.State);

        await CliAsync(e.Host, ["--staff-website-access", "--email", Site, "--enabled", "false"]);
        Assert.Empty(await sweeper.SweepAsync(CancellationToken.None));
        Assert.Null(await NextSignalAsync(open, Patience));
        AssertClosed(open);
        Assert.Equal(0, e.Host.Services.GetRequiredService<NewsletterLiveConnections>().Count);
    }

    // ---------------------------------------------------------------------------------------------------------- the list order

    private async Task<string[]> EmailsAsync(Env e, string query)
    {
        var page = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Staff.GetAsync($"{Admin}?{query}")));
        return page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("email").GetString()!).ToArray();
    }

    [Fact]
    public async Task Recent_activity_puts_an_old_address_that_was_just_verified_first_and_the_default_order_is_unchanged()
    {
        using var e = await BeginAsync(recordInsteadOfHub: true);
        var start = new DateTimeOffset(Factory.Clock.UtcNow.UtcDateTime.Ticks / TimeSpan.TicksPerSecond * TimeSpan.TicksPerSecond, TimeSpan.Zero);   // whole seconds: PostgreSQL keeps microseconds
        Factory.Clock.UtcNow = start;
        var a = await RequestLinkAsync(e, "old@example.com");                       // received first
        Factory.Clock.UtcNow = start.AddHours(1);
        var b = await RequestLinkAsync(e, "newer@example.com");                     // received later
        Assert.Equal("verified", await ConfirmStatusAsync(e, b));                   // verified at +1h
        Factory.Clock.UtcNow = start.AddHours(2);
        Assert.Equal("verified", await ConfirmStatusAsync(e, a));                   // the older one is verified last (+2h)
        Factory.Clock.UtcNow = start.AddHours(3);
        await RequestLinkAsync(e, "pending@example.com");                           // newest request, still pending

        // No option (or an empty one): the order callers have always had, newest request first.
        Assert.Equal(["pending@example.com", "newer@example.com", "old@example.com"], await EmailsAsync(e, "pageSize=10"));
        Assert.Equal(["pending@example.com", "newer@example.com", "old@example.com"], await EmailsAsync(e, "pageSize=10&sort="));
        // recent-activity: VerifiedAtUtc ?? ReceivedAtUtc. pending (+3h received) > old (+2h verified) > newer (+1h verified).
        Assert.Equal(["pending@example.com", "old@example.com", "newer@example.com"], await EmailsAsync(e, "pageSize=10&sort=recent-activity"));

        // Filtering and paging stay the server's, and a page boundary does not duplicate or lose a row.
        Assert.Equal(["old@example.com", "newer@example.com"], await EmailsAsync(e, "pageSize=10&sort=recent-activity&status=Verified"));
        Assert.Equal(["pending@example.com", "old@example.com"], await EmailsAsync(e, "pageSize=2&page=1&sort=recent-activity"));
        Assert.Equal(["newer@example.com"], await EmailsAsync(e, "pageSize=2&page=2&sort=recent-activity"));
        Assert.Equal(["newer@example.com"], await EmailsAsync(e, "pageSize=10&sort=recent-activity&search=newer"));
        // ReceivedAtUtc is the real sign-up time: the sort did not rewrite it.
        var old = await RowAsync(e, "old@example.com");
        Assert.Equal(start, old.GetProperty("receivedAtUtc").GetDateTimeOffset());
    }

    [Fact]
    public async Task Equal_activity_is_ordered_by_id_as_the_database_orders_it_and_a_bad_sort_is_a_400()
    {
        using var e = await BeginAsync(recordInsteadOfHub: true);
        var now = Factory.Clock.UtcNow;
        // Ids that differ in their first byte (PostgreSQL orders a uuid bytewise, not like Guid.CompareTo) and the same moment.
        Guid[] ids = [Guid.Parse("f0000000-0000-0000-0000-000000000001"), Guid.Parse("0f000000-0000-0000-0000-000000000002"), Guid.Parse("80000000-0000-0000-0000-000000000003")];
        for (var i = 0; i < ids.Length; i++)
        {
            await ScalarAsync<int>($"""
                WITH inserted AS (INSERT INTO "NewsletterSubscriptions" ("Id", "Email", "Source", "Status", "ReceivedAtUtc", "Language")
                VALUES ('{ids[i]}', 'tie{i}@example.com', 'homepage', 'PendingVerification', '{now:O}', 'vi') RETURNING 1) SELECT count(*) FROM inserted
                """);
        }

        var expected = (await ScalarAsync<string>("""SELECT string_agg("Email", ',' ORDER BY COALESCE("VerifiedAtUtc", "ReceivedAtUtc") DESC, "Id" DESC) FROM "NewsletterSubscriptions" """)).Split(',');
        Assert.Equal(expected, await EmailsAsync(e, "pageSize=10&sort=recent-activity"));
        Assert.Equal(expected, await EmailsAsync(e, "pageSize=10"));       // ties in the first order are ordered the same way

        foreach (var bad in new[] { "sort=newest", "sort=Recent-Activity", "sort=received", "sort=recent-activity,id" })
        {
            var response = await AssertStatusAsync(HttpStatusCode.BadRequest, e.Staff.GetAsync($"{Admin}?{bad}"));
            Assert.Equal("newsletter-list-invalid", (await ProblemAsync(response)).Code);
        }
    }
}
