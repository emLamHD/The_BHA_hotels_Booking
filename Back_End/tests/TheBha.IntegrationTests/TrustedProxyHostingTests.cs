using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: the TLS-terminator trust boundary. A request that reaches Kestrel over
/// cleartext is treated as HTTPS, and its client address is read from <c>X-Forwarded-For</c>, only
/// when it comes from a proxy the configuration lists. Everything else is unchanged.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class TrustedProxyHostingTests(PostgreSqlWebApplicationFactory factory)
{
    private const string Email = "proxy-desk@example.com";
    private const string AdminOrigin = "https://localhost:3001";
    private const string LoginPath = "/api/admin/v1/auth/login";
    private const string MePath = "/api/admin/v1/me";
    private const string TrustedPeer = "172.28.0.3";
    private const string TrustedNetwork = "172.28.0.0/16";
    private const string StrangerPeer = "198.51.100.77";
    private static readonly string Password = $"A!a1{Guid.NewGuid():N}";
    private static readonly Guid PropertyId = Guid.Parse("94000000-0000-0000-0000-00000000000a");

    // ---- option validation -------------------------------------------------------------------

    [Fact]
    public void Disabled_options_trust_nothing_whatever_else_is_set()
    {
        var options = new TrustedProxyOptions { Enabled = false, KnownProxies = ["not an address"], ForwardLimit = 99 };

        Assert.Null(options.Build());
    }

    [Fact]
    public void Enabled_options_trust_exactly_the_configured_peers_and_two_headers()
    {
        var built = new TrustedProxyOptions
        {
            Enabled = true,
            KnownProxies = ["10.1.2.3", " ::1 "],
            KnownNetworks = ["172.28.0.0/16", "2001:db8::/48"],
            ForwardLimit = 2
        }.Build();

        Assert.NotNull(built);
        Assert.Equal(
            Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto,
            built.ForwardedHeaders);
        Assert.Equal(2, built.ForwardLimit);
        Assert.Equal([IPAddress.Parse("10.1.2.3"), IPAddress.IPv6Loopback], built.KnownProxies);
        Assert.Equal(2, built.KnownNetworks.Count);
        // The framework default (loopback) is replaced, not extended.
        Assert.DoesNotContain(IPAddress.Loopback, built.KnownProxies);
    }

    [Fact]
    public void Network_only_configuration_does_not_keep_the_default_loopback_proxy()
    {
        var built = new TrustedProxyOptions { Enabled = true, KnownNetworks = [TrustedNetwork] }.Build();

        Assert.NotNull(built);
        Assert.Empty(built.KnownProxies);
        Assert.Single(built.KnownNetworks);
    }

    public static TheoryData<string[], string[], int> InvalidEnabledConfigurations => new()
    {
        { [], [], 1 },                                     // nothing listed
        { ["nope"], [], 1 },                               // not an address
        { [""], [], 1 },                                   // blank entry
        { ["0.0.0.0"], [], 1 },                            // unspecified
        { ["::"], [], 1 },
        { [], ["172.28.0.0"], 1 },                         // no prefix length
        { [], ["172.28.0.0/abc"], 1 },
        { [], ["172.28.0.0/33"], 1 },                      // beyond the family
        { [], ["2001:db8::/129"], 1 },
        { [], ["0.0.0.0/0"], 1 },                          // trusts the whole internet
        { [], ["10.0.0.0/7"], 1 },                         // wider than /8
        { [], ["2001:db8::/16"], 1 },                      // wider than /32 for IPv6
        { [], ["0.0.0.0/16"], 1 },                         // unspecified prefix
        { ["10.0.0.1"], [], 0 },                           // limits outside 1..5
        { ["10.0.0.1"], [], 6 },
        { ["10.0.0.1"], [], -1 },
    };

    [Theory]
    [MemberData(nameof(InvalidEnabledConfigurations))]
    public void Enabled_configuration_that_is_empty_malformed_or_over_broad_is_refused(
        string[] proxies, string[] networks, int forwardLimit)
    {
        var options = new TrustedProxyOptions
        {
            Enabled = true,
            KnownProxies = proxies,
            KnownNetworks = networks,
            ForwardLimit = forwardLimit
        };

        var error = Assert.Throws<InvalidOperationException>(() => options.Build());
        Assert.StartsWith("Hosting:TrustedProxy is invalid", error.Message);
    }

    [Fact]
    public void A_host_with_an_enabled_but_empty_trust_list_refuses_to_start()
    {
        using var host = factory.WithWebHostBuilder(builder =>
            builder.UseSetting("Hosting:TrustedProxy:Enabled", "true"));

        var error = Assert.ThrowsAny<Exception>(() => host.CreateClient());
        Assert.Contains("Hosting:TrustedProxy is invalid", Flatten(error));
    }

    // ---- scheme boundary ---------------------------------------------------------------------

    [Fact]
    public async Task Trusted_proxy_forwarding_https_lets_a_cleartext_hop_sign_in_with_a_secure_cookie()
    {
        await SeedStaffAsync();
        using var host = CreateHost(peer: TrustedPeer, trust: true);
        using var client = CreateCleartextClient(host);

        var login = await client.SendAsync(Post(LoginPath, LoginBody(), proto: "https"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var setCookie = Assert.Single(login.Headers.GetValues("Set-Cookie"), v => v.StartsWith(".TheBha.Staff=", StringComparison.Ordinal));
        Assert.Contains("secure", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);

        var cookie = setCookie[..setCookie.IndexOf(';')];
        var me = await client.SendAsync(Get(MePath, cookie, proto: "https"));
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task Trusted_proxy_without_the_proto_header_is_still_cleartext_and_refused()
    {
        await SeedStaffAsync();
        using var host = CreateHost(peer: TrustedPeer, trust: true);
        using var client = CreateCleartextClient(host);

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Post(LoginPath, LoginBody()))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Post(LoginPath, LoginBody(), proto: "http"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get(MePath))).StatusCode);
    }

    [Fact]
    public async Task Peer_outside_the_trusted_list_cannot_claim_https()
    {
        await SeedStaffAsync();
        using var host = CreateHost(peer: StrangerPeer, trust: true);
        using var client = CreateCleartextClient(host);

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Post(LoginPath, LoginBody(), proto: "https"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get(MePath, proto: "https"))).StatusCode);
    }

    [Fact]
    public async Task With_the_feature_off_even_a_listed_address_cannot_claim_https()
    {
        await SeedStaffAsync();
        using var host = CreateHost(peer: TrustedPeer, trust: false);
        using var client = CreateCleartextClient(host);

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Post(LoginPath, LoginBody(), proto: "https"))).StatusCode);
    }

    [Fact]
    public async Task Loopback_is_not_trusted_unless_it_is_listed()
    {
        await SeedStaffAsync();
        using var host = CreateHost(peer: "127.0.0.1", trust: true);
        using var client = CreateCleartextClient(host);

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Post(LoginPath, LoginBody(), proto: "https"))).StatusCode);
    }

    [Fact]
    public async Task Forwarded_https_does_not_bypass_the_origin_check()
    {
        await SeedStaffAsync();
        using var host = CreateHost(peer: TrustedPeer, trust: true);
        using var client = CreateCleartextClient(host);

        var response = await client.SendAsync(Post(LoginPath, LoginBody(), proto: "https", origin: "https://evil.example"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(response.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task Forwarded_https_is_not_redirected_but_a_plain_cleartext_customer_request_still_is()
    {
        // A test server has no HTTPS port to redirect to; name one, as the deployment's does.
        using var host = CreateHost(peer: TrustedPeer, trust: true)
            .WithWebHostBuilder(builder => builder.UseSetting("HTTPS_PORT", "443"));
        using var client = CreateCleartextClient(host);

        var forwarded = await client.SendAsync(CustomerLogin(proto: "https"));
        Assert.Equal(HttpStatusCode.Unauthorized, forwarded.StatusCode);

        var plain = await client.SendAsync(CustomerLogin());
        Assert.Equal(HttpStatusCode.TemporaryRedirect, plain.StatusCode);
    }

    // ---- client address ----------------------------------------------------------------------

    [Fact]
    public async Task Rate_limiting_sees_the_forwarded_client_not_the_proxy()
    {
        using var host = CreateHost(peer: TrustedPeer, trust: true, customerLoginPermits: 1);
        using var client = CreateCleartextClient(host);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(CustomerLogin("https", "203.0.113.10"))).StatusCode);
        // A different client behind the same proxy has its own permit.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(CustomerLogin("https", "203.0.113.11"))).StatusCode);
        // The first client is out of permits.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.SendAsync(CustomerLogin("https", "203.0.113.10"))).StatusCode);
    }

    [Fact]
    public async Task Entries_the_client_prepended_to_the_forwarded_chain_are_ignored()
    {
        using var host = CreateHost(peer: TrustedPeer, trust: true, customerLoginPermits: 1);
        using var client = CreateCleartextClient(host);

        // ForwardLimit 1: only the entry the trusted proxy appended is read, so a client that
        // rotates the leading values still counts as one address.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(CustomerLogin("https", "1.1.1.1, 203.0.113.10"))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.SendAsync(CustomerLogin("https", "2.2.2.2, 203.0.113.10"))).StatusCode);
    }

    [Fact]
    public async Task A_forged_forwarded_for_from_an_untrusted_peer_does_not_buy_a_new_rate_limit_partition()
    {
        using var host = CreateHost(peer: StrangerPeer, trust: true, customerLoginPermits: 1);
        using var client = CreateCleartextClient(host, https: true);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(CustomerLogin(forwardedFor: "203.0.113.10"))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.SendAsync(CustomerLogin(forwardedFor: "203.0.113.11"))).StatusCode);
    }

    // ---- helpers -----------------------------------------------------------------------------

    private WebApplicationFactory<Program> CreateHost(
        string peer,
        bool trust,
        int customerLoginPermits = 10_000) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", customerLoginPermits.ToString());
            builder.UseSetting("Authentication:RateLimiting:WindowSeconds", "300");
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            if (trust)
            {
                builder.UseSetting("Hosting:TrustedProxy:Enabled", "true");
                builder.UseSetting("Hosting:TrustedProxy:KnownNetworks:0", TrustedNetwork);
            }

            builder.ConfigureTestServices(services =>
                services.AddSingleton(new TestConnectionAddresses { RemoteIpAddress = IPAddress.Parse(peer) }));
        });

    private static HttpClient CreateCleartextClient(WebApplicationFactory<Program> host, bool https = false) =>
        host.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri(https ? "https://localhost" : "http://localhost"),
            AllowAutoRedirect = false,
            HandleCookies = false
        });

    private async Task SeedStaffAsync()
    {
        await factory.ResetDatabaseAsync();
        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlAsync(
                $"""
                INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
                VALUES ({PropertyId},'Proxy Inn',{PropertyId.ToString()},NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,now(),now())
                """);
        }

        using var bootstrap = factory.WithWebHostBuilder(_ => { });
        using var output = new StringWriter();
        var exit = await StaffBootstrapCommand.RunAsync(
            ["--staff-create", "--email", Email, "--property-id", PropertyId.ToString(), "--role", StaffRole.Manager],
            bootstrap.Services, output, () => Password, CancellationToken.None);
        Assert.True(exit == 0, output.ToString());
    }

    private static string LoginBody() => JsonSerializer.Serialize(new { email = Email, password = Password });

    private static HttpRequestMessage Post(string path, string body, string? proto = null, string origin = AdminOrigin)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body))
        };
        request.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json");
        request.Headers.TryAddWithoutValidation("Origin", origin);
        Forward(request, proto, null);
        return request;
    }

    private static HttpRequestMessage Get(string path, string? cookie = null, string? proto = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        Forward(request, proto, null);
        return request;
    }

    private static HttpRequestMessage CustomerLogin(string? proto = null, string? forwardedFor = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new { Email = "nobody@example.com", Password = "x" })
        };
        Forward(request, proto, forwardedFor);
        return request;
    }

    private static void Forward(HttpRequestMessage request, string? proto, string? forwardedFor)
    {
        if (proto is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", proto);
        }

        if (forwardedFor is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);
        }
    }

    private static string Flatten(Exception error)
    {
        var text = new StringBuilder();
        for (var current = error; current is not null; current = current.InnerException)
        {
            text.AppendLine(current.Message);
        }

        return text.ToString();
    }
}
