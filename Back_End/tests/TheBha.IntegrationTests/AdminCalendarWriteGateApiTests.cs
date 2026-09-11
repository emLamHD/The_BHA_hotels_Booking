using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using TheBha.Api;
using TheBha.Api.Controllers;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.2-CP01 acceptance: the local Admin Calendar write gate, proven
/// end to end against a real host through the test-only probe controller (see
/// <see cref="AdminCalendarWriteGateProbeController"/>). The application itself
/// exposes no write endpoint in CP01, and the probe route stays inside this
/// test assembly, which
/// <see cref="The_ordinary_host_neither_serves_nor_publishes_the_test_only_probe_route"/>
/// asserts rather than assumes.
///
/// <para>
/// Every refusal is checked twice: the status code the caller sees, and the
/// probe spy's invocation count. A status code alone would not distinguish
/// "refused" from "ran the action and then failed" — and for a write boundary
/// the second one would already have mutated something.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminCalendarWriteGateApiTests(PostgreSqlWebApplicationFactory factory)
{
    private const string ProbeUrl = "/api/admin/v1/test-only/write-gate-probe";
    private const string AllowedAdminOrigin = "https://localhost:3001";
    private const string CustomerOrigin = "https://localhost:3000";
    private const string JsonMediaType = "application/json";
    private const string ValidBody = """{"marker":"cp01"}""";

    // ---------------------------------------------------------------
    // Host and request helpers
    // ---------------------------------------------------------------

    /// <summary>
    /// A host that additionally serves the test-only probe controller. The
    /// probe assembly is added as an MVC application part here and nowhere
    /// else, which is what keeps the route out of every ordinary host.
    /// </summary>
    private WebApplicationFactory<Program> CreateProbeHost(
        WriteGateProbeSpy spy,
        bool enableWriteAtStartup = true,
        string? environment = null,
        string? dataProtectionKeysPath = null,
        TestConnectionAddresses? connection = null,
        Action<AdminCalendarOptions>? lateOptionChange = null) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (environment is not null)
            {
                builder.UseEnvironment(environment);
            }

            if (dataProtectionKeysPath is not null)
            {
                builder.UseSetting("DataProtection:KeysPath", dataProtectionKeysPath);
            }

            if (enableWriteAtStartup)
            {
                builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true");
            }

            builder.ConfigureServices(services =>
            {
                services.AddSingleton(spy);
                services.AddControllers()
                    .AddApplicationPart(typeof(AdminCalendarWriteGateProbeController).Assembly);

                if (connection is not null)
                {
                    services.AddSingleton(connection);
                }

                if (lateOptionChange is not null)
                {
                    services.Configure<AdminCalendarOptions>(lateOptionChange);
                }
            });
        });

    /// <summary>
    /// The write gate refuses cleartext, so an HTTPS base address is what makes
    /// a TestServer request represent a real TLS connection
    /// (<c>Request.IsHttps</c> is derived from the request URI). Redirects are
    /// never followed, so <c>UseHttpsRedirection</c> can never answer for the
    /// gate and be mistaken for it.
    /// </summary>
    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });

    private static HttpClient CreateCleartextClient(WebApplicationFactory<Program> target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

    private static HttpRequestMessage ProbePost(
        string? origin = AllowedAdminOrigin,
        string? contentType = JsonMediaType,
        string body = ValidBody,
        IEnumerable<KeyValuePair<string, string>>? extraHeaders = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, ProbeUrl)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)),
        };

        request.Content.Headers.ContentType =
            contentType is null ? null : MediaTypeHeaderValue.Parse(contentType);

        if (origin is not null)
        {
            request.Headers.TryAddWithoutValidation("Origin", origin);
        }

        foreach (var header in extraHeaders ?? Array.Empty<KeyValuePair<string, string>>())
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        return request;
    }

    private static void AssertNoStore(HttpResponseMessage response, string because) =>
        Assert.True(
            "no-store" == response.Headers.CacheControl?.ToString(),
            $"{because}: expected Cache-Control: no-store, got '{response.Headers.CacheControl}'");

    /// <summary>
    /// Every closed answer must be identical to every other closed answer: the
    /// framework's own generic 404 Problem Details — the same shape the read
    /// gate produces — carrying nothing that says which condition failed or
    /// what was sent.
    ///
    /// <para>
    /// Correction C1, finding 2: this is deliberately <em>not</em> an
    /// assertion that a closed route is indistinguishable from an absent one.
    /// CORS headers are governed by endpoint metadata, outside this filter, and
    /// an approved Admin origin does see them on a closed response — see
    /// <see cref="A_closed_gate_may_still_carry_cors_headers_for_an_approved_admin_origin"/>
    /// for the contract as it actually stands. A wildcard allow-origin is still
    /// refused, because that would hand the boundary to any origin at all.
    /// </para>
    /// </summary>
    private static async Task AssertClosedGateResponseAsync(HttpResponseMessage response, string because)
    {
        Assert.True(
            HttpStatusCode.NotFound == response.StatusCode,
            $"{because}: expected 404, got {(int)response.StatusCode}");
        AssertNoStore(response, because);

        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("\"errors\"", body, StringComparison.Ordinal);
        Assert.DoesNotContain("marker", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("origin", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("media type", body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(GenericNotFound, ClosedGateShape(body));
        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Origin") &&
            response.Headers.GetValues("Access-Control-Allow-Origin").Contains("*"),
            because);
    }

    /// <summary>
    /// What <c>[ApiController]</c>'s client-error filter turns the gate's bare
    /// <c>NotFoundResult</c> into. Only <c>traceId</c> varies per request, so
    /// it is deliberately excluded: everything in the body that could
    /// distinguish one refused request from another is compared.
    /// </summary>
    private static readonly (string? Type, string? Title, string? Status, string? Detail) GenericNotFound =
        ("https://tools.ietf.org/html/rfc9110#section-15.5.5", "Not Found", "404", null);

    private static (string? Type, string? Title, string? Status, string? Detail) ClosedGateShape(string body)
    {
        if (string.IsNullOrEmpty(body))
        {
            return (null, null, null, null);
        }

        var root = JsonDocument.Parse(body).RootElement;
        return (
            root.TryGetProperty("type", out var type) ? type.ToString() : null,
            root.TryGetProperty("title", out var title) ? title.ToString() : null,
            root.TryGetProperty("status", out var status) ? status.ToString() : null,
            root.TryGetProperty("detail", out var detail) ? detail.ToString() : null);
    }

    // ---------------------------------------------------------------
    // Open gate: the one combination that is allowed to reach the action
    // ---------------------------------------------------------------

    [Fact]
    public async Task Https_development_loopback_write_enabled_admin_origin_and_json_reaches_the_action_once()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        using var request = ProbePost();
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        AssertNoStore(response, "open gate success");
        Assert.Equal(1, spy.Invocations);
        Assert.Equal("cp01", Assert.Single(spy.Markers));

        // No Customer session cookie and no CSRF token were supplied, and none
        // was demanded: the scoped IgnoreAntiforgeryToken is what makes the
        // Admin write surface usable without the Customer cookie flow.
        Assert.Null(request.Headers.Authorization);
        Assert.False(request.Headers.Contains("Cookie"));
        Assert.False(request.Headers.Contains("X-CSRF-TOKEN"));
    }

    // Cases that share one host configuration are run against one host on
    // purpose: every WebApplicationFactory build puts an inotify watch on the
    // content root, and Linux allows 128 per user.
    [Fact]
    public async Task A_valid_json_content_type_with_or_without_a_utf8_charset_is_accepted()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        string[] contentTypes =
        [
            JsonMediaType,
            "application/json; charset=utf-8",
            "application/json;charset=UTF-8",
            "application/json; charset=\"utf-8\"",
            "APPLICATION/JSON",
        ];

        var expected = 0;
        foreach (var contentType in contentTypes)
        {
            using var request = ProbePost(contentType: contentType);
            var response = await client.SendAsync(request);

            Assert.True(
                HttpStatusCode.NoContent == response.StatusCode,
                $"content type '{contentType}': expected 204, got {(int)response.StatusCode}");
            Assert.Equal(++expected, spy.Invocations);
        }
    }

    // ---------------------------------------------------------------
    // Write opt-in is separate from the read opt-in
    // ---------------------------------------------------------------

    [Fact]
    public async Task The_read_opt_in_does_not_enable_the_write_boundary()
    {
        await factory.ResetDatabaseAsync();
        var spy = new WriteGateProbeSpy();

        // The base test host models the supported local launch: the read flag
        // is on. The write flag is left at its shipped default.
        await using var host = CreateProbeHost(spy, enableWriteAtStartup: false);
        using var client = CreateHttpsClient(host);

        var readOptions = host.Services.GetRequiredService<IOptions<AdminCalendarOptions>>().Value;
        Assert.True(readOptions.EnableUnauthenticatedRead);
        Assert.False(readOptions.EnableUnauthenticatedWrite);

        using var request = ProbePost();
        var response = await client.SendAsync(request);

        await AssertClosedGateResponseAsync(response, "read enabled, write default");
        Assert.Equal(0, spy.Invocations);

        // …and the read endpoint is still open, so this is a real separation
        // rather than a host where nothing works.
        var board = await client.GetAsync(
            $"/api/admin/v1/properties/{Guid.NewGuid()}/reservation-board?from=2026-09-01&to=2026-09-03");
        Assert.Equal(HttpStatusCode.NotFound, board.StatusCode);
        // The read gate let the action run and the action reported the missing
        // property, so the read really is on while the write stays closed.
        var boardProblem = await board.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Property not found", boardProblem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Enabling_the_write_opt_in_does_not_change_the_read_flag()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(
            spy,
            lateOptionChange: options => options.EnableUnauthenticatedRead = false);
        using var client = CreateHttpsClient(host);

        var options = host.Services.GetRequiredService<IOptions<AdminCalendarOptions>>().Value;
        Assert.True(options.EnableUnauthenticatedWrite);
        Assert.False(options.EnableUnauthenticatedRead);

        using var request = ProbePost();
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(request)).StatusCode);

        var board = await client.GetAsync(
            $"/api/admin/v1/properties/{Guid.NewGuid()}/reservation-board?from=2026-09-01&to=2026-09-03");
        Assert.Equal(HttpStatusCode.NotFound, board.StatusCode);
        // The read gate's own closed 404 — the generic shape, not the action's
        // "Property not found", so the read really is off on this host.
        Assert.Equal(GenericNotFound, ClosedGateShape(await board.Content.ReadAsStringAsync()));
    }

    // Correction C1, finding 1. The gate reads a value frozen from
    // configuration at startup, so an options registration applied afterwards —
    // which is how a reloadable configuration source would surface — cannot
    // move the boundary in either direction. The pre-C1 filter resolved
    // IOptions<T> per request, and IOptions<T> materializes lazily, so a
    // Development host started with the opt-in off could be opened by a later
    // value: environment-first ordering protects every host except the one this
    // gate actually runs on.
    [Fact]
    public async Task A_late_option_value_cannot_open_a_development_host_that_started_closed()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(
            spy,
            enableWriteAtStartup: false,
            lateOptionChange: options => options.EnableUnauthenticatedWrite = true);
        using var client = CreateHttpsClient(host);

        // The bound option really does say true — the gate simply never reads it.
        Assert.True(host.Services.GetRequiredService<IOptions<AdminCalendarOptions>>()
            .Value.EnableUnauthenticatedWrite);
        Assert.Equal(
            "Development",
            host.Services.GetRequiredService<IHostEnvironment>().EnvironmentName);

        using var request = ProbePost();
        await AssertClosedGateResponseAsync(
            await client.SendAsync(request), "Development, started closed, late option says open");
        Assert.Equal(0, spy.Invocations);
    }

    // The counterpart, so the frozen value is not merely "always closed": a
    // host that started open stays open even when a later value says otherwise.
    [Fact]
    public async Task A_late_option_value_cannot_close_a_development_host_that_started_open()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(
            spy,
            lateOptionChange: options => options.EnableUnauthenticatedWrite = false);
        using var client = CreateHttpsClient(host);

        Assert.False(host.Services.GetRequiredService<IOptions<AdminCalendarOptions>>()
            .Value.EnableUnauthenticatedWrite);

        using var request = ProbePost();
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(1, spy.Invocations);
    }

    [Fact]
    public void No_checked_in_configuration_or_launch_profile_enables_the_write_boundary()
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(ApiContentRoot())
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.Development.json", optional: false)
            .Build();

        Assert.False(
            configuration.GetSection(AdminCalendarOptions.SectionName)
                .Get<AdminCalendarOptions>()?.EnableUnauthenticatedWrite ?? false);

        using var document = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(ApiContentRoot(), "Properties", "launchSettings.json")));

        foreach (var profile in document.RootElement.GetProperty("profiles").EnumerateObject())
        {
            if (profile.Value.TryGetProperty("environmentVariables", out var variables))
            {
                Assert.False(
                    variables.TryGetProperty("AdminCalendar__EnableUnauthenticatedWrite", out _),
                    profile.Name);
            }
        }
    }

    private static string ApiContentRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && directory.GetDirectories("Back_End").Length == 0)
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "Back_End", "src", "TheBha.Api");
    }

    // ---------------------------------------------------------------
    // Transport
    // ---------------------------------------------------------------

    // UseHttpsRedirection cannot discover an HTTPS port on this host, so it
    // logs a warning and passes the request through — which is exactly why the
    // gate must refuse cleartext itself. Redirects are disabled on the client,
    // so a 307 would fail this test rather than pass it.
    [Fact]
    public async Task Cleartext_requests_are_refused_by_the_gate_and_never_reach_the_action()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateCleartextClient(host);
        Assert.Equal("http", client.BaseAddress!.Scheme);

        foreach (var (shape, body) in new[] { ("valid body", ValidBody), ("malformed body", "{ not json") })
        {
            using var request = ProbePost(body: body);
            var response = await client.SendAsync(request);

            await AssertClosedGateResponseAsync(response, $"cleartext, {shape}");
            Assert.Equal(0, spy.Invocations);
        }
    }

    [Fact]
    public async Task An_allowed_origin_does_not_make_a_cleartext_request_acceptable()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateCleartextClient(host);

        using var request = ProbePost(origin: AllowedAdminOrigin);
        await AssertClosedGateResponseAsync(await client.SendAsync(request), "cleartext with allowed origin");
        Assert.Equal(0, spy.Invocations);
    }

    // ---------------------------------------------------------------
    // Forwarded headers
    // ---------------------------------------------------------------

    // A caller writes these headers, so they are never evidence of anything.
    // Their presence means the request was relayed, and an unauthenticated
    // write boundary refuses a relayed request rather than reasoning about it.
    [Fact]
    public async Task A_forwarded_header_closes_the_gate()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        (string Name, string Value)[] headers =
        [
            ("X-Forwarded-For", "127.0.0.1"),
            ("X-Forwarded-Proto", "https"),
            ("X-Forwarded-Host", "localhost"),
            ("x-forwarded-for", "127.0.0.1"),
            ("X-FORWARDED-PORT", "7145"),
            ("Forwarded", "for=127.0.0.1;proto=https"),
            ("forwarded", "for=127.0.0.1"),
        ];

        foreach (var (name, value) in headers)
        {
            using var request = ProbePost(extraHeaders: [new KeyValuePair<string, string>(name, value)]);
            var response = await client.SendAsync(request);

            await AssertClosedGateResponseAsync(response, $"forwarded header {name}");
            Assert.Equal(0, spy.Invocations);
        }
    }

    [Fact]
    public async Task An_unrelated_x_header_does_not_close_the_gate()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        using var request = ProbePost(extraHeaders:
        [
            new KeyValuePair<string, string>("X-Forwarded", "not-a-forwarded-family-header"),
            new KeyValuePair<string, string>("X-Requested-With", "XMLHttpRequest"),
        ]);

        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(request)).StatusCode);
        Assert.Equal(1, spy.Invocations);
    }

    // ---------------------------------------------------------------
    // Connection locality
    // ---------------------------------------------------------------

    public static TheoryData<string, string?, string?> NonLoopbackMatrix() => new()
    {
        { "loopback / private LAN", "127.0.0.1", "192.168.10.20" },
        { "private LAN / loopback", "192.168.10.20", "127.0.0.1" },
        { "container bridge / loopback", "172.17.0.1", "127.0.0.1" },
        { "loopback / public test-net", "127.0.0.1", "198.51.100.7" },
        { "loopback v6 / public v6", "::1", "2001:db8::1" },
        { "wildcard 0.0.0.0 / loopback", "0.0.0.0", "127.0.0.1" },
        { "wildcard :: / loopback", "::", "127.0.0.1" },
        { "null local / loopback", null, "127.0.0.1" },
        { "loopback / null remote", "127.0.0.1", null },
        { "null / null", null, null },
    };

    [Theory]
    [MemberData(nameof(NonLoopbackMatrix))]
    public async Task A_non_local_connection_closes_the_gate(
        string description, string? local, string? remote)
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy, connection: new TestConnectionAddresses
        {
            LocalIpAddress = local is null ? null : IPAddress.Parse(local),
            RemoteIpAddress = remote is null ? null : IPAddress.Parse(remote),
        });
        using var client = CreateHttpsClient(host);

        using var request = ProbePost();
        await AssertClosedGateResponseAsync(await client.SendAsync(request), description);
        Assert.Equal(0, spy.Invocations);
    }

    [Theory]
    [InlineData("127.0.0.1", "127.0.0.1")]
    [InlineData("::1", "::1")]
    [InlineData("127.0.0.1", "127.0.0.53")]
    [InlineData("::ffff:127.0.0.1", "::ffff:127.0.0.1")]
    [InlineData("::1", "::ffff:127.0.0.1")]
    public async Task Every_loopback_representation_is_accepted(string local, string remote)
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy, connection: new TestConnectionAddresses
        {
            LocalIpAddress = IPAddress.Parse(local),
            RemoteIpAddress = IPAddress.Parse(remote),
        });
        using var client = CreateHttpsClient(host);

        using var request = ProbePost();
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(request)).StatusCode);
        Assert.Equal(1, spy.Invocations);
    }

    [Fact]
    public async Task Local_looking_headers_do_not_make_a_remote_connection_acceptable()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy, connection: new TestConnectionAddresses
        {
            LocalIpAddress = IPAddress.Parse("198.51.100.7"),
            RemoteIpAddress = IPAddress.Parse("198.51.100.9"),
        });
        using var client = CreateHttpsClient(host);

        using var request = ProbePost(extraHeaders:
        [
            new KeyValuePair<string, string>("Host", "localhost"),
            new KeyValuePair<string, string>("Referer", "https://localhost:3001/board"),
        ]);

        await AssertClosedGateResponseAsync(await client.SendAsync(request), "spoofed local headers");
        Assert.Equal(0, spy.Invocations);
    }

    // ---------------------------------------------------------------
    // Environment
    // ---------------------------------------------------------------

    private static string CreateDataProtectionKeysPath()
    {
        var path = Path.Combine(Path.GetTempPath(), "thebha-cp01-keys", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    [Fact]
    public async Task A_staging_host_with_the_write_flag_enabled_at_startup_still_closes_the_gate()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(
            spy,
            environment: "Staging",
            dataProtectionKeysPath: CreateDataProtectionKeysPath());
        using var client = CreateHttpsClient(host);

        Assert.Equal("Staging", host.Services.GetRequiredService<IHostEnvironment>().EnvironmentName);
        Assert.True(host.Services.GetRequiredService<IOptions<AdminCalendarOptions>>()
            .Value.EnableUnauthenticatedWrite);

        using var request = ProbePost();
        await AssertClosedGateResponseAsync(await client.SendAsync(request), "Staging");
        Assert.Equal(0, spy.Invocations);
    }

    // The startup guard binds one configuration snapshot; IOptions<T> binds
    // lazily on first use, so a reloadable source could supply `true` after the
    // guard had already passed. The gate is environment-first, so that later
    // value can never matter outside Development.
    [Fact]
    public async Task A_configuration_flip_after_startup_cannot_open_a_production_host()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(
            spy,
            enableWriteAtStartup: false,
            environment: "Production",
            dataProtectionKeysPath: CreateDataProtectionKeysPath(),
            lateOptionChange: options => options.EnableUnauthenticatedWrite = true);
        using var client = CreateHttpsClient(host);

        Assert.True(host.Services.GetRequiredService<IOptions<AdminCalendarOptions>>()
            .Value.EnableUnauthenticatedWrite);

        using var request = ProbePost();
        await AssertClosedGateResponseAsync(await client.SendAsync(request), "Production, late flip");
        Assert.Equal(0, spy.Invocations);
    }

    [Fact]
    public void A_production_host_refuses_to_start_with_the_write_flag_enabled()
    {
        using var productionHost = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting(
                "ConnectionStrings:TheBhaDatabase",
                "Host=localhost;Database=unused;Username=unused;Password=unused");
            builder.UseSetting("AdminCalendar:EnableUnauthenticatedWrite", "true");
            builder.UseSetting("DataProtection:KeysPath", Path.GetTempPath());
        });

        var exception = Assert.ThrowsAny<Exception>(() => productionHost.Server);
        var root = exception;
        while (root.InnerException is not null)
        {
            root = root.InnerException;
        }

        Assert.Contains("AdminCalendar:EnableUnauthenticatedWrite", root.Message, StringComparison.Ordinal);
    }

    // ---------------------------------------------------------------
    // Origin
    // ---------------------------------------------------------------

    [Fact]
    public async Task A_request_without_exactly_one_approved_origin_is_forbidden_before_binding()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        (string Description, string[] Origins)[] cases =
        [
            ("missing", []),
            ("empty", [""]),
            ("literal null", ["null"]),
            ("customer origin", [CustomerOrigin]),
            ("unknown origin", ["https://evil.example"]),
            ("suffix lookalike", ["https://localhost:3001.evil.example"]),
            ("prefix lookalike", ["https://evil.example/https://localhost:3001"]),
            ("path suffix", ["https://localhost:3001/"]),
            ("scheme downgrade", ["http://localhost:3001"]),
            ("case-different host", ["https://LOCALHOST:3001"]),
            ("comma-joined pair", [AllowedAdminOrigin + ", https://evil.example"]),
            ("two header values", [AllowedAdminOrigin, "https://evil.example"]),
            ("duplicated allowed origin", [AllowedAdminOrigin, AllowedAdminOrigin]),
        ];

        foreach (var (description, origins) in cases)
        {
            // A malformed body proves the order: the origin decision is made
            // before model binding, so it can never degrade into a 400 that
            // describes the body instead.
            using var request = ProbePost(origin: null, body: "{ not json");
            foreach (var origin in origins)
            {
                request.Headers.TryAddWithoutValidation("Origin", origin);
            }

            var response = await client.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            Assert.True(
                HttpStatusCode.Forbidden == response.StatusCode,
                $"{description}: expected 403, got {(int)response.StatusCode}");
            AssertNoStore(response, description);
            Assert.Equal(0, spy.Invocations);
            Assert.DoesNotContain("\"errors\"", body, StringComparison.Ordinal);
            Assert.DoesNotContain("marker", body, StringComparison.OrdinalIgnoreCase);

            // A Problem Details body, not a Customer cookie challenge: the
            // Admin surface must never answer with the Customer authentication
            // scheme.
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            Assert.Equal(403, JsonDocument.Parse(body).RootElement.GetProperty("status").GetInt32());
            Assert.False(response.Headers.Contains("WWW-Authenticate"));
            Assert.False(response.Headers.Contains("Location"));
        }
    }

    [Fact]
    public async Task An_approved_origin_does_not_survive_the_environmental_checks()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(
            spy,
            enableWriteAtStartup: false,
            lateOptionChange: options => options.EnableUnauthenticatedWrite = false);
        using var client = CreateHttpsClient(host);

        // The environmental refusal wins: the caller cannot tell from the
        // answer whether its origin was approved.
        using var request = ProbePost(origin: AllowedAdminOrigin);
        await AssertClosedGateResponseAsync(await client.SendAsync(request), "approved origin, write off");
        Assert.Equal(0, spy.Invocations);
    }

    // ---------------------------------------------------------------
    // Content type
    // ---------------------------------------------------------------

    [Fact]
    public async Task A_non_json_content_type_is_rejected_as_unsupported_media_type()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        string?[] contentTypes =
        [
            null,
            "text/plain",
            "text/json",
            "application/xml",
            "application/x-www-form-urlencoded",
            "application/merge-patch+json",
            "application/json-patch+json",
            "application/json; charset=not-a-charset",
            "application/json; boundary=x",
            "*/*",

            // Correction C1, finding 3: encodings the gate used to accept
            // because Encoding.GetEncoding recognized them, which MVC's
            // System.Text.Json input formatter would then have refused with its
            // own 415 — the gate governing a wider contract than the action
            // behind it could honour. `us-ascii` is the case Codex named.
            "application/json; charset=us-ascii",
            "application/json; charset=utf-16",
            "application/json; charset=iso-8859-1",
            "application/json; charset=utf-8; charset=utf-8",
            "application/json; charset=utf-8; boundary=x",
        ];

        foreach (var contentType in contentTypes)
        {
            using var request = ProbePost(contentType: contentType);
            var response = await client.SendAsync(request);

            Assert.True(
                HttpStatusCode.UnsupportedMediaType == response.StatusCode,
                $"content type '{contentType}': expected 415, got {(int)response.StatusCode}");
            AssertNoStore(response, $"content type '{contentType}'");
            Assert.Equal(0, spy.Invocations);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        }
    }

    [Fact]
    public async Task A_non_json_content_type_is_still_a_closed_gate_404_when_the_environment_fails()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateCleartextClient(host);

        using var request = ProbePost(contentType: "text/plain");
        await AssertClosedGateResponseAsync(await client.SendAsync(request), "cleartext, non-JSON");
        Assert.Equal(0, spy.Invocations);
    }

    // ---------------------------------------------------------------
    // After the gate opens: ordinary model binding, and nothing leaked before
    // ---------------------------------------------------------------

    [Fact]
    public async Task An_open_gate_hands_an_invalid_body_to_model_binding_without_running_the_action()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        (string Description, string Body)[] cases =
        [
            ("malformed json", "{ not json"),
            ("empty body", ""),
            ("missing required field", """{"other":"value"}"""),
            ("null required field", """{"marker":null}"""),
            ("empty required field", """{"marker":""}"""),
        ];

        foreach (var (description, body) in cases)
        {
            using var request = ProbePost(body: body);
            var response = await client.SendAsync(request);

            Assert.True(
                HttpStatusCode.BadRequest == response.StatusCode,
                $"{description}: expected 400, got {(int)response.StatusCode}");
            AssertNoStore(response, description);
            Assert.Equal(0, spy.Invocations);
        }
    }

    // The same bodies, with the gate closed, must return the gate's own answer:
    // a closed boundary never reveals that a body would have failed validation.
    [Fact]
    public async Task A_closed_gate_answers_every_body_identically()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy, enableWriteAtStartup: false);
        using var client = CreateHttpsClient(host);

        string[] bodies = ["{ not json", "", """{"other":"value"}""", ValidBody];

        foreach (var body in bodies)
        {
            using var request = ProbePost(body: body);
            await AssertClosedGateResponseAsync(
                await client.SendAsync(request), $"closed gate, body '{body}'");
            Assert.Equal(0, spy.Invocations);
        }
    }

    // ---------------------------------------------------------------
    // CORS composition
    // ---------------------------------------------------------------

    [Fact]
    public async Task The_write_policy_answers_an_admin_preflight_without_credentials()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        using var preflight = new HttpRequestMessage(HttpMethod.Options, ProbeUrl);
        preflight.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
        preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type");
        var response = await client.SendAsync(preflight);

        Assert.Equal(
            AllowedAdminOrigin,
            Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Contains(
            "POST",
            Assert.Single(response.Headers.GetValues("Access-Control-Allow-Methods")),
            StringComparison.OrdinalIgnoreCase);
        Assert.Contains(
            "Content-Type",
            Assert.Single(response.Headers.GetValues("Access-Control-Allow-Headers")),
            StringComparison.OrdinalIgnoreCase);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
        Assert.DoesNotContain("*", response.Headers.GetValues("Access-Control-Allow-Origin"));
        Assert.Equal(0, spy.Invocations);
    }

    [Fact]
    public async Task The_write_policy_does_not_answer_a_preflight_from_another_origin()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        foreach (var origin in new[] { CustomerOrigin, "https://evil.example" })
        {
            using var preflight = new HttpRequestMessage(HttpMethod.Options, ProbeUrl);
            preflight.Headers.TryAddWithoutValidation("Origin", origin);
            preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
            var response = await client.SendAsync(preflight);

            Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"), origin);
            Assert.Equal(0, spy.Invocations);
        }
    }

    // Correction C1, finding 2. The original suite claimed a closed route was
    // indistinguishable from an absent one. It is not: CORS headers come from
    // endpoint metadata, outside this filter, so an approved Admin origin sees
    // Access-Control-Allow-Origin even on a closed 404, while an absent route
    // has no endpoint CORS metadata and gets none. Route existence is therefore
    // observable to an origin that is already explicitly configured as an Admin
    // origin — it is not an authorization boundary, and that origin knows the
    // API contract anyway. This test pins the contract that does hold: the POST
    // is refused, nothing behind the gate runs, and an unapproved origin is
    // granted nothing.
    [Fact]
    public async Task A_closed_gate_may_still_carry_cors_headers_for_an_approved_admin_origin()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy, enableWriteAtStartup: false);
        using var client = CreateHttpsClient(host);

        using var approved = ProbePost();
        var approvedResponse = await client.SendAsync(approved);

        await AssertClosedGateResponseAsync(approvedResponse, "closed gate, approved origin");
        Assert.Equal(0, spy.Invocations);

        // Whatever CORS decided to say, it may only ever name the one
        // configured origin — never a wildcard, never credentials.
        // Asserted as fact, not tolerated as a possibility: the approved origin
        // really does receive this header on a closed 404, which is precisely
        // why the "indistinguishable from an absent route" claim was wrong and
        // has been removed. It may only ever name the one configured origin.
        Assert.Equal(
            AllowedAdminOrigin,
            Assert.Single(approvedResponse.Headers.GetValues("Access-Control-Allow-Origin")));

        Assert.False(approvedResponse.Headers.Contains("Access-Control-Allow-Credentials"));

        using var unapproved = ProbePost(origin: "https://evil.example");
        var unapprovedResponse = await client.SendAsync(unapproved);

        Assert.False(unapprovedResponse.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal(0, spy.Invocations);
    }

    // A preflight is a browser-side question, never a decision: CORS answers it
    // from middleware, before the gate runs. The POST that follows still goes
    // through the whole gate.
    [Fact]
    public async Task An_answered_preflight_does_not_make_the_post_succeed()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy, enableWriteAtStartup: false);
        using var client = CreateHttpsClient(host);

        using var preflight = new HttpRequestMessage(HttpMethod.Options, ProbeUrl);
        preflight.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
        var preflightResponse = await client.SendAsync(preflight);
        Assert.Equal(
            AllowedAdminOrigin,
            Assert.Single(preflightResponse.Headers.GetValues("Access-Control-Allow-Origin")));

        using var post = ProbePost();
        await AssertClosedGateResponseAsync(await client.SendAsync(post), "POST after answered preflight");
        Assert.Equal(0, spy.Invocations);
    }

    [Fact]
    public async Task The_write_policy_does_not_apply_to_customer_or_read_routes()
    {
        await factory.ResetDatabaseAsync();
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        // The Admin origin may POST the probe, but the write policy grants it
        // nothing on a Customer route.
        using var customerPreflight = new HttpRequestMessage(HttpMethod.Options, "/api/v1/auth/login");
        customerPreflight.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        customerPreflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
        var customerResponse = await client.SendAsync(customerPreflight);
        Assert.False(customerResponse.Headers.Contains("Access-Control-Allow-Origin"));

        // The Customer catalog route keeps its own credentialed policy.
        using var catalog = new HttpRequestMessage(HttpMethod.Get, "/api/v1/properties");
        catalog.Headers.TryAddWithoutValidation("Origin", CustomerOrigin);
        var catalogResponse = await client.SendAsync(catalog);
        Assert.Equal(
            CustomerOrigin,
            Assert.Single(catalogResponse.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal(
            "true",
            Assert.Single(catalogResponse.Headers.GetValues("Access-Control-Allow-Credentials")));

        // The read board keeps its own GET-only, uncredentialed policy.
        using var board = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/admin/v1/properties/{Guid.NewGuid()}/reservation-board?from=2026-09-01&to=2026-09-03");
        board.Headers.TryAddWithoutValidation("Origin", AllowedAdminOrigin);
        var boardResponse = await client.SendAsync(board);
        Assert.Equal(
            AllowedAdminOrigin,
            Assert.Single(boardResponse.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(boardResponse.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    // ---------------------------------------------------------------
    // Antiforgery composition
    // ---------------------------------------------------------------

    // The scoped IgnoreAntiforgeryToken must not have become a global opt-out:
    // the Customer surface still demands a CSRF token for an unsafe method, on
    // the very host that also serves the Admin probe.
    [Fact]
    public async Task The_global_customer_antiforgery_policy_is_unchanged_on_the_same_host()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        // An anonymous, antiforgery-protected Customer POST: it must still be
        // rejected for the missing token, on the same host that serves the
        // Admin probe without one.
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/booking-holds")
        {
            Content = new StringContent("{}", Encoding.UTF8, JsonMediaType),
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString("N"));
        var response = await client.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid antiforgery token", body.GetProperty("title").GetString());
    }

    // Each of the three attributes is load-bearing. This is the control for the
    // third: the identical route without the scoped opt-out is rejected by the
    // global Customer antiforgery policy before the gate can run at all, so the
    // opt-out cannot be dropped from a future write action without the suite
    // noticing.
    [Fact]
    public async Task Without_the_scoped_opt_out_the_global_antiforgery_policy_rejects_the_request_first()
    {
        var spy = new WriteGateProbeSpy();
        await using var host = CreateProbeHost(spy);
        using var client = CreateHttpsClient(host);

        using var request = ProbePost();
        request.RequestUri = new Uri("/api/admin/v1/test-only/write-gate-antiforgery-control", UriKind.Relative);
        var response = await client.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid antiforgery token", body.GetProperty("title").GetString());
        Assert.Equal(0, spy.Invocations);

        // The gate never ran, so it never set its header — which is what makes
        // this a genuine "before the gate" rejection rather than a coincidence.
        Assert.Null(response.Headers.CacheControl);
    }

    // ---------------------------------------------------------------
    // The test-only probe never escapes the test assembly
    // ---------------------------------------------------------------

    /// <summary>
    /// The probe route exists only where this suite adds the probe assembly as
    /// an MVC application part, so an ordinary host must neither serve it nor
    /// publish it.
    ///
    /// <para>
    /// PMS-CAL-001.2-CP02-C1: this test used to also forbid every
    /// <c>POST/PUT/PATCH/DELETE</c> under <c>/api/admin/</c>. That was a true
    /// statement about CP01, whose acceptance was precisely that no production
    /// mutation route existed yet — but it would have made this CP01 test a
    /// permanent registry of every Admin mutation route added afterwards, and
    /// CP02's first authorized one already falsified it. The exact Admin
    /// mutation surface is now owned by
    /// <see cref="AdminCalendarAssignmentApiTests.OpenApi_publishes_exactly_this_one_admin_write_route_and_no_actor_fields"/>,
    /// which is the checkpoint that adds it. What belongs here, and stays
    /// here, is probe isolation.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_ordinary_host_neither_serves_nor_publishes_the_test_only_probe_route()
    {
        using var client = CreateHttpsClient(factory);

        using var request = ProbePost();
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        // An absent route, not a closed gate: the probe controller is not part
        // of this host at all, so nothing set the gate's no-store header.
        Assert.Null(response.Headers.CacheControl);

        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        foreach (var path in swagger.GetProperty("paths").EnumerateObject())
        {
            Assert.DoesNotContain("write-gate-probe", path.Name, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("test-only", path.Name, StringComparison.OrdinalIgnoreCase);
        }
    }
}
