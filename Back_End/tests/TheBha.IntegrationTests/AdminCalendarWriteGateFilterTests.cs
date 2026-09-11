using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using TheBha.Api;
using TheBha.Api.Controllers;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.2-CP01: the gate examined directly, one condition at a time.
///
/// <para>
/// <see cref="AdminCalendarWriteGateApiTests"/> proves the gate through a real
/// host, which is the evidence that matters — but a hosted test cannot isolate
/// every condition. A cleartext request on a TestServer host, for example,
/// passes through <c>UseHttpsRedirection</c> first (it cannot discover an
/// HTTPS port and lets the request continue), so "the response was a 404"
/// there is only indirect evidence that the <em>gate</em> refused it. Calling
/// the filter directly removes that ambiguity: the refusal is observed as the
/// filter's own <see cref="ResourceExecutingContext.Result"/>, with no
/// middleware in between and nothing else that could have produced it.
/// </para>
///
/// <para>
/// These are also where the full condition matrix is cheap enough to be
/// exhaustive, and they need no database — so they are deliberately not part
/// of the PostgreSQL collection.
/// </para>
/// </summary>
public sealed class AdminCalendarWriteGateFilterTests
{
    private const string AllowedAdminOrigin = "https://localhost:3001";
    private const string DevelopmentEnvironment = "Development";
    private static readonly string[] AdminOrigins =
        ["https://localhost:3001", "https://admin.localhost:4001"];

    private static AdminCalendarWriteGateFilter CreateFilter(
        string environment = DevelopmentEnvironment,
        bool enableWrite = true,
        string[]? adminOrigins = null) =>
        new(
            new HostingEnvironment { EnvironmentName = environment },
            Options.Create(new AdminCalendarOptions { EnableUnauthenticatedWrite = enableWrite }),
            adminOrigins ?? AdminOrigins);

    private static ResourceExecutingContext CreateContext(
        bool https = true,
        string? localAddress = "127.0.0.1",
        string? remoteAddress = "127.0.0.1",
        string? origin = AllowedAdminOrigin,
        string? contentType = "application/json",
        params (string Name, string Value)[] headers)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = https ? "https" : "http";
        httpContext.Request.Method = HttpMethods.Post;
        httpContext.Request.Path = "/api/admin/v1/test-only/write-gate-probe";
        httpContext.Connection.LocalIpAddress =
            localAddress is null ? null : IPAddress.Parse(localAddress);
        httpContext.Connection.RemoteIpAddress =
            remoteAddress is null ? null : IPAddress.Parse(remoteAddress);

        if (origin is not null)
        {
            httpContext.Request.Headers.Origin = origin;
        }

        if (contentType is not null)
        {
            httpContext.Request.ContentType = contentType;
        }

        foreach (var (name, value) in headers)
        {
            httpContext.Request.Headers[name] = value;
        }

        var actionContext = new ActionContext(
            httpContext, new RouteData(), new ActionDescriptor(), new ModelStateDictionary());
        return new ResourceExecutingContext(actionContext, [], []);
    }

    private static void AssertClosed(ResourceExecutingContext context, string because)
    {
        Assert.Equal("no-store", context.HttpContext.Response.Headers.CacheControl);
        var result = Assert.IsType<NotFoundResult>(context.Result);
        Assert.True(StatusCodes.Status404NotFound == result.StatusCode, because);
    }

    private static void AssertRejected(ResourceExecutingContext context, int statusCode, string because)
    {
        Assert.Equal("no-store", context.HttpContext.Response.Headers.CacheControl);
        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.True(statusCode == result.StatusCode, $"{because}: got {result.StatusCode}");
        var problem = Assert.IsType<ProblemDetails>(result.Value);
        Assert.Equal(statusCode, problem.Status);
        Assert.Contains("application/problem+json", result.ContentTypes);

        // The body states the rule; it must never restate what the caller sent.
        Assert.DoesNotContain("127.0.0", problem.Detail ?? string.Empty, StringComparison.Ordinal);
        Assert.DoesNotContain("localhost:3001", problem.Detail ?? string.Empty, StringComparison.Ordinal);
    }

    // ---------------------------------------------------------------

    [Fact]
    public void An_https_development_loopback_json_request_from_an_admin_origin_is_allowed_through()
    {
        var context = CreateContext();

        CreateFilter().OnResourceExecuting(context);

        Assert.Null(context.Result);
        Assert.Equal("no-store", context.HttpContext.Response.Headers.CacheControl);
    }

    [Fact]
    public void Cleartext_is_refused_by_the_filter_itself()
    {
        var context = CreateContext(https: false);

        CreateFilter().OnResourceExecuting(context);

        AssertClosed(context, "http scheme");
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("Local")]
    [InlineData("development")] // IsDevelopment() is ordinal-ignore-case, so this one is Development
    public void Only_a_development_host_is_allowed_through(string environment)
    {
        var context = CreateContext();

        CreateFilter(environment).OnResourceExecuting(context);

        if (string.Equals(environment, DevelopmentEnvironment, StringComparison.OrdinalIgnoreCase))
        {
            Assert.Null(context.Result);
        }
        else
        {
            AssertClosed(context, environment);
        }
    }

    [Theory]
    [InlineData(null, "127.0.0.1")]
    [InlineData("127.0.0.1", null)]
    [InlineData(null, null)]
    [InlineData("127.0.0.1", "192.168.10.20")]
    [InlineData("192.168.10.20", "127.0.0.1")]
    [InlineData("127.0.0.1", "198.51.100.7")]
    [InlineData("::1", "2001:db8::1")]
    [InlineData("0.0.0.0", "127.0.0.1")]
    [InlineData("::", "::1")]
    [InlineData("172.17.0.1", "172.17.0.2")]
    public void A_connection_that_is_not_loopback_at_both_ends_is_refused(string? local, string? remote)
    {
        var context = CreateContext(localAddress: local, remoteAddress: remote);

        CreateFilter().OnResourceExecuting(context);

        AssertClosed(context, $"{local} -> {remote}");
    }

    [Theory]
    [InlineData("127.0.0.1", "127.0.0.1")]
    [InlineData("::1", "::1")]
    [InlineData("127.0.0.1", "::1")]
    [InlineData("127.0.0.53", "127.0.0.1")]
    [InlineData("::ffff:127.0.0.1", "127.0.0.1")]
    [InlineData("::ffff:127.0.0.1", "::ffff:127.0.0.1")]
    public void Every_loopback_representation_is_local(string local, string remote)
    {
        var context = CreateContext(localAddress: local, remoteAddress: remote);

        CreateFilter().OnResourceExecuting(context);

        Assert.Null(context.Result);
    }

    [Theory]
    [InlineData("Forwarded", "for=127.0.0.1")]
    [InlineData("forwarded", "for=127.0.0.1")]
    [InlineData("FORWARDED", "for=127.0.0.1")]
    [InlineData("X-Forwarded-For", "127.0.0.1")]
    [InlineData("x-forwarded-for", "10.0.0.1")]
    [InlineData("X-Forwarded-Proto", "https")]
    [InlineData("X-Forwarded-Host", "localhost")]
    [InlineData("X-Forwarded-Port", "443")]
    [InlineData("X-Forwarded-Prefix", "/api")]
    public void Any_forwarded_header_closes_the_gate(string name, string value)
    {
        var context = CreateContext(headers: [(name, value)]);

        CreateFilter().OnResourceExecuting(context);

        AssertClosed(context, name);
    }

    [Theory]
    [InlineData("X-Forwarded")]
    [InlineData("Forwarded-For")]
    [InlineData("X-Real-IP")]
    [InlineData("Via")]
    public void A_header_outside_the_forwarded_family_does_not_close_the_gate(string name)
    {
        var context = CreateContext(headers: [(name, "value")]);

        CreateFilter().OnResourceExecuting(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public void The_write_flag_is_required_and_is_read_last()
    {
        var context = CreateContext();

        CreateFilter(enableWrite: false).OnResourceExecuting(context);

        AssertClosed(context, "write flag off");
    }

    [Fact]
    public void An_environmental_failure_outranks_an_origin_or_media_type_failure()
    {
        // Wrong on every count: cleartext, remote, forwarded, write disabled,
        // unapproved origin and a form body. The answer must still be the plain
        // 404, never the 403 or 415 that would confirm the boundary exists.
        var context = CreateContext(
            https: false,
            localAddress: "198.51.100.7",
            remoteAddress: "198.51.100.9",
            origin: "https://evil.example",
            contentType: "application/x-www-form-urlencoded",
            headers: [("X-Forwarded-For", "127.0.0.1")]);

        CreateFilter("Production", enableWrite: false).OnResourceExecuting(context);

        AssertClosed(context, "everything wrong");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("https://localhost:3000")]
    [InlineData("https://localhost:3002")]
    [InlineData("https://localhost:3001.evil.example")]
    [InlineData("https://evil.example?x=https://localhost:3001")]
    [InlineData("xhttps://localhost:3001")]
    [InlineData("https://localhost:3001/")]
    [InlineData("https://localhost:3001 ")]
    [InlineData("http://localhost:3001")]
    [InlineData("HTTPS://LOCALHOST:3001")]
    public void Only_an_exact_approved_origin_is_accepted(string? origin)
    {
        var context = CreateContext(origin: origin);

        CreateFilter().OnResourceExecuting(context);

        AssertRejected(context, StatusCodes.Status403Forbidden, $"origin '{origin}'");
    }

    [Fact]
    public void A_multi_valued_origin_header_is_rejected_even_when_one_value_is_approved()
    {
        var context = CreateContext(origin: null);
        context.HttpContext.Request.Headers.Origin =
            new Microsoft.Extensions.Primitives.StringValues([AllowedAdminOrigin, "https://evil.example"]);

        CreateFilter().OnResourceExecuting(context);

        AssertRejected(context, StatusCodes.Status403Forbidden, "two Origin values");
    }

    [Fact]
    public void Every_configured_admin_origin_is_accepted()
    {
        foreach (var origin in AdminOrigins)
        {
            var context = CreateContext(origin: origin);

            CreateFilter().OnResourceExecuting(context);

            Assert.Null(context.Result);
        }
    }

    // A non-HTTPS entry cannot reach configuration — Program.cs refuses to
    // start with one — but the gate states its own rule rather than relying on
    // a check that lives in another file.
    [Fact]
    public void A_non_https_allowlist_entry_is_never_matched()
    {
        var context = CreateContext(origin: "http://localhost:3001");

        CreateFilter(adminOrigins: ["http://localhost:3001"]).OnResourceExecuting(context);

        AssertRejected(context, StatusCodes.Status403Forbidden, "http allowlist entry");
    }

    [Fact]
    public void An_empty_allowlist_accepts_nothing()
    {
        var context = CreateContext();

        CreateFilter(adminOrigins: []).OnResourceExecuting(context);

        AssertRejected(context, StatusCodes.Status403Forbidden, "empty allowlist");
    }

    [Theory]
    [InlineData("application/json")]
    [InlineData("application/json; charset=utf-8")]
    [InlineData("application/json;charset=UTF-8")]
    [InlineData("application/json; charset=\"utf-8\"")]
    [InlineData("Application/JSON")]
    [InlineData("application/json; charset=us-ascii")]
    public void A_json_content_type_with_an_optional_valid_charset_is_accepted(string contentType)
    {
        var context = CreateContext(contentType: contentType);

        CreateFilter().OnResourceExecuting(context);

        Assert.Null(context.Result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("text/plain")]
    [InlineData("text/json")]
    [InlineData("application/xml")]
    [InlineData("application/x-www-form-urlencoded")]
    [InlineData("multipart/form-data; boundary=x")]
    [InlineData("application/json-patch+json")]
    [InlineData("application/vnd.api+json")]
    [InlineData("application/json; charset=not-a-real-charset")]
    [InlineData("application/json; charset=")]
    [InlineData("application/json; boundary=x")]
    [InlineData("application/*")]
    [InlineData("*/*")]
    [InlineData("not a media type")]
    public void Anything_that_is_not_json_is_an_unsupported_media_type(string? contentType)
    {
        var context = CreateContext(contentType: contentType);

        CreateFilter().OnResourceExecuting(context);

        AssertRejected(context, StatusCodes.Status415UnsupportedMediaType, $"content type '{contentType}'");
    }

    [Fact]
    public void An_unapproved_origin_outranks_an_unsupported_media_type()
    {
        var context = CreateContext(origin: "https://evil.example", contentType: "text/plain");

        CreateFilter().OnResourceExecuting(context);

        AssertRejected(context, StatusCodes.Status403Forbidden, "origin before media type");
    }

    /// <summary>
    /// <see cref="IHostEnvironment"/> stand-in; the filter reads only
    /// <see cref="IHostEnvironment.EnvironmentName"/>.
    /// </summary>
    private sealed class HostingEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = DevelopmentEnvironment;
        public string ApplicationName { get; set; } = "TheBha.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
