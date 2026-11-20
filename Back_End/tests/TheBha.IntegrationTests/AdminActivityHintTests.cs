using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Realtime;
using TheBha.Application.Activity;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR03 (ADR 0011 §E): the shared activity hint. Who may connect, what a hint carries (the menu key and, for a Property-scoped menu, the Property id, nothing else), and that
/// every recipient is judged again at every send — so a member who just lost a permission, or never had a menu or Property, hears nothing. Real PostgreSQL, real Staff cookies, TestServer sockets.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminActivityHintTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string HubPath = StaffAdminActivityLiveAccess.Path;
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(800);

    private sealed record Env(WebApplicationFactory<Program> Host, HttpClient Client, string Site, string Desk, string Manager, Guid A) : IDisposable
    {
        public void Dispose()
        {
            Client.Dispose();
            Host.Dispose();
        }
    }

    private async Task<Env> BeginAsync(AdminCalendarAccessMode mode = AdminCalendarAccessMode.Staff)
    {
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, mode.ToString());
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", "https://localhost:3000");
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
        });
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var property = await SeedStaffAsync(host);
        var client = CreateHttpsClient(host);
        return new Env(host, client, await LoginAsync(client, Site), await LoginAsync(client, Desk), await LoginAsync(client, Manager), property);
    }

    private sealed record Connection(WebSocket? Socket, int Status);

    private static async Task<Connection> ConnectAsync(Env e, string? cookie, string? origin = AdminOrigin)
    {
        var client = e.Host.Server.CreateWebSocketClient();
        client.ConfigureRequest = request =>
        {
            if (cookie is not null) request.Headers["Cookie"] = cookie;
            if (origin is not null) request.Headers["Origin"] = new StringValues(origin);
        };
        try
        {
            var socket = await client.ConnectAsync(new Uri($"wss://localhost{HubPath}"), CancellationToken.None);
            await socket.SendAsync(Encoding.UTF8.GetBytes("{\"protocol\":\"json\",\"version\":1}\u001e"), WebSocketMessageType.Text, true, CancellationToken.None);
            Assert.Equal("{}", await ReadAsync(socket, Patience));
            Assert.Contains(AdminActivityHub.ReadyMethod, await ReadAsync(socket, Patience));     // registered: from here a hint reaches it
            return new Connection(socket, 101);
        }
        catch (InvalidOperationException exception) when (exception.Message.Contains("status code: ", StringComparison.Ordinal))
        {
            var code = exception.Message[(exception.Message.IndexOf("status code: ", StringComparison.Ordinal) + "status code: ".Length)..].Trim();
            return new Connection(null, int.Parse(code, System.Globalization.CultureInfo.InvariantCulture));
        }
    }

    // Records are cut at the 0x1e separator, never at a WebSocket message boundary (the server may pack several records into one message).
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<WebSocket, StringBuilder> Unread = new();

    private static async Task<string?> ReadAsync(WebSocket socket, TimeSpan within)
    {
        using var timeout = new CancellationTokenSource(within);
        var text = Unread.GetOrCreateValue(socket);
        var buffer = new byte[4096];
        try
        {
            while (true)
            {
                var end = text.ToString().IndexOf('\u001e');
                if (end >= 0)
                {
                    var record = text.ToString(0, end);
                    text.Remove(0, end + 1);
                    return record;
                }

                var received = await socket.ReceiveAsync(buffer, timeout.Token);
                if (received.MessageType == WebSocketMessageType.Close) return null;
                text.Append(Encoding.UTF8.GetString(buffer, 0, received.Count));
            }
        }
        catch (Exception exception) when (exception is OperationCanceledException or WebSocketException)
        {
            return null;
        }
    }

    /// <summary>The argument of the next <c>menuActivity</c> invocation (pings skipped), or <c>null</c> on close or silence.</summary>
    private static async Task<JsonElement?> NextHintAsync(WebSocket socket, TimeSpan within)
    {
        var until = DateTime.UtcNow + within;
        while (DateTime.UtcNow < until)
        {
            var record = await ReadAsync(socket, until - DateTime.UtcNow);
            if (record is null) return null;
            var frame = JsonDocument.Parse(record).RootElement.Clone();
            if (frame.GetProperty("type").GetInt32() == 1 && frame.GetProperty("target").GetString() == AdminActivityHub.HintMethod) return frame.GetProperty("arguments")[0];
        }

        return null;
    }

    private static async Task PublishAsync(Env e, string menu, Guid? property = null)
    {
        await using var scope = e.Host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IAdminActivityHint>().PublishAsync(menu, property, CancellationToken.None);
    }

    [Fact]
    public async Task Only_an_active_Staff_member_who_may_read_a_menu_connects_from_an_approved_origin_and_LocalGate_has_no_Hub()
    {
        using (var e = await BeginAsync())
        {
            await ExecuteAsync($"""DELETE FROM "StaffPropertyMemberships" WHERE "StaffAccountId" = '{await StaffIdAsync(Desk)}' """);      // Desk: no menu left to read
            Assert.Equal(401, (await ConnectAsync(e, null)).Status);
            Assert.Equal(403, (await ConnectAsync(e, e.Site, origin: null)).Status);
            Assert.Equal(403, (await ConnectAsync(e, e.Site, origin: "https://evil.example")).Status);
            Assert.Equal(403, (await ConnectAsync(e, e.Desk)).Status);
            using var open = (await ConnectAsync(e, e.Site)).Socket!;
            Assert.Equal(WebSocketState.Open, open.State);

            var endpoints = e.Host.Services.GetRequiredService<Microsoft.AspNetCore.Routing.EndpointDataSource>().Endpoints.OfType<Microsoft.AspNetCore.Routing.RouteEndpoint>()
                .Where(endpoint => ("/" + endpoint.RoutePattern.RawText!.TrimStart('/')).StartsWith(HubPath, StringComparison.Ordinal)).ToList();
            Assert.NotEmpty(endpoints);
            Assert.All(endpoints, endpoint => Assert.True(StaffCalendarModeGuard.IsOpenInStaffMode(endpoint) && StaffAdminActivityLiveAccess.IsEnforcedHub(endpoint), endpoint.RoutePattern.RawText));
            // The marker alone opens nothing: the policy that enforces it must be there too.
            var marker = new Microsoft.AspNetCore.Routing.RouteEndpoint(_ => Task.CompletedTask, Microsoft.AspNetCore.Routing.Patterns.RoutePatternFactory.Parse("/api/admin/x"), 0,
                new EndpointMetadataCollection(new StaffLiveHubEndpointMetadata()), "marker only");
            Assert.False(StaffAdminActivityLiveAccess.IsEnforcedHub(marker) || StaffCalendarModeGuard.IsOpenInStaffMode(marker));
        }

        using var local = await BeginAsync(AdminCalendarAccessMode.LocalGate);
        await AssertStatusAsync(HttpStatusCode.NotFound, local.Client.SendAsync(Post($"{HubPath}/negotiate?negotiateVersion=1", "", null, contentType: "text/plain;charset=UTF-8")));
    }

    [Fact]
    public async Task A_hint_carries_only_the_menu_and_Property_and_reaches_only_the_members_who_may_read_that_menu_and_Property_now()
    {
        using var e = await BeginAsync();
        var b = await AddPropertyAsync("hotel-b");
        await CliAsync(e.Host, ["--staff-blog-access", "--email", Desk, "--edit", "true", "--publish", "false"]);
        await ExecuteAsync($"""DELETE FROM "StaffPropertyMemberships" WHERE "StaffAccountId" = '{await StaffIdAsync(Desk)}' """);      // Desk: Blog only
        using var site = (await ConnectAsync(e, e.Site)).Socket!;          // website flag, FrontDesk at A
        using var desk = (await ConnectAsync(e, e.Desk)).Socket!;          // Blog only
        using var manager = (await ConnectAsync(e, e.Manager)).Socket!;    // Manager at A

        async Task<string> Heard(WebSocket socket) => (await NextHintAsync(socket, Quiet))?.GetRawText() ?? "-";
        async Task<string[]> Everyone() => await Task.WhenAll(Heard(site), Heard(desk), Heard(manager));

        await PublishAsync(e, "blog-posts");
        Assert.Equal(["-", """{"menuKey":"blog-posts"}""", "-"], await Everyone());                                                        // no propertyId key for a global menu
        await PublishAsync(e, "newsletter");
        Assert.Equal(["""{"menuKey":"newsletter"}""", "-", "-"], await Everyone());
        await PublishAsync(e, "promotions", e.A);
        Assert.Equal(["-", "-", $$"""{"menuKey":"promotions","propertyId":"{{e.A}}"}"""], await Everyone());                              // Manager only (ADR 0009)
        await PublishAsync(e, "calendar", e.A);
        Assert.Equal([$$"""{"menuKey":"calendar","propertyId":"{{e.A}}"}""", "-", $$"""{"menuKey":"calendar","propertyId":"{{e.A}}"}"""], await Everyone());
        await PublishAsync(e, "calendar", b);
        Assert.Equal(["-", "-", "-"], await Everyone());                                                                                   // nobody is a member of B

        // A permission revoked a moment ago is not heard on: the connection stays open (the session is fine) but the hint does not come.
        await CliAsync(e.Host, ["--staff-blog-access", "--email", Desk, "--edit", "false", "--publish", "false"]);
        await PublishAsync(e, "blog-posts");
        Assert.Equal(["-", "-", "-"], await Everyone());
        Assert.Equal(WebSocketState.Open, desk.State);

        // A disabled account loses its connection at the next send.
        await CliAsync(e.Host, ["--staff-disable", "--email", Manager]);
        await PublishAsync(e, "calendar", e.A);
        Assert.Equal([$$"""{"menuKey":"calendar","propertyId":"{{e.A}}"}""", "-", "-"], await Everyone());
        Assert.True(manager.State is WebSocketState.CloseReceived or WebSocketState.Closed or WebSocketState.Aborted, $"the socket is {manager.State}");
    }

    [Fact]
    public async Task The_publisher_refuses_a_call_made_inside_an_open_transaction_and_a_hint_that_names_the_wrong_scope()
    {
        using var e = await BeginAsync();
        await using var scope = e.Host.Services.CreateAsyncScope();
        var hint = scope.ServiceProvider.GetRequiredService<IAdminActivityHint>();
        await using (await scope.ServiceProvider.GetRequiredService<TheBhaDbContext>().Database.BeginTransactionAsync())
            await Assert.ThrowsAsync<InvalidOperationException>(() => hint.PublishAsync("blog-posts", null, CancellationToken.None));

        await Assert.ThrowsAsync<ArgumentException>(() => hint.PublishAsync("no-such-menu", null, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => hint.PublishAsync("promotions", null, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => hint.PublishAsync("blog-posts", e.A, CancellationToken.None));
        await hint.PublishAsync("blog-posts", null, CancellationToken.None);          // after the commit: fine, even with nobody connected
    }

    private async Task<Guid> AddPropertyAsync(string slug)
    {
        await using var context = Factory.CreateDbContext();
        var property = new Property(Guid.NewGuid(), "Hotel " + slug, slug, null, "2 Street", "Hue", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, DateTimeOffset.UtcNow);
        context.Add(property);
        await context.SaveChangesAsync();
        return property.Id;
    }
}
