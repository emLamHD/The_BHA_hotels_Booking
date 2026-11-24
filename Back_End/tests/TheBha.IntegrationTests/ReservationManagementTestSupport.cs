using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR06: shared setup for the guest reservation management tests. Real PostgreSQL, a fixed clock, a Direct-enabled host, and an HTTPS client (a Secure cookie is never stored or sent over http, so a client
/// on http would turn every cookie assertion into a confusing 401). Synthetic data only.
/// </summary>
public abstract class ReservationManagementTestSupport(PostgreSqlWebApplicationFactory factory) : DirectReservationTestSupport(factory)
{
    protected const string CustomerOrigin = "https://localhost:3000";
    protected const string SessionCookie = ".TheBha.ReservationManagement";

    /// <summary>A Direct-enabled host whose exchange limit is high enough not to 429 an unrelated test.</summary>
    protected WebApplicationFactory<Program> ManageHost(Action<IWebHostBuilder>? configure = null, params (string Key, string Value)[] settings) =>
        Host(true, configure, [("Booking:ReservationManagement:RateLimiting:PermitLimit", "100000"), .. settings]); // a later setting of the same key wins

    protected static HttpClient Https(WebApplicationFactory<Program> host) =>
        host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = true });

    protected async Task<(Guid Id, string Token)> BookGuestAsync(WebApplicationFactory<Program> host, string key = "manage-key-1", int startOffset = 3, string name = "Guest Name")
    {
        using var client = Https(host);
        var token = NewToken();
        var response = await PostAsync(client, key, Body(startOffset: startOffset, name: name), token);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return ((await JsonAsync(response)).GetProperty("reservationId").GetGuid(), token);
    }

    /// <summary>Issues a link the way the e-mail work item will: inside the caller's transaction, committed by the caller.</summary>
    protected async Task<string> IssueLinkAsync(WebApplicationFactory<Program> host, Guid reservationId, TimeSpan? ttl = null)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        await using var transaction = await context.Database.BeginTransactionAsync();
        var issue = await scope.ServiceProvider.GetRequiredService<IReservationManagementLinkIssuer>().IssueAsync(PropertyId, reservationId, ttl, CancellationToken.None);
        Assert.Equal(ReservationManagementLinkIssueStatus.Issued, issue.Status);
        await transaction.CommitAsync();
        return issue.Secret!;
    }

    protected static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string url,
        object? body = null,
        bool csrf = true,
        string? origin = null,
        string? cookie = null)
    {
        using var request = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        if (csrf && method != HttpMethod.Get)
        {
            var pair = (await (await client.GetAsync("/api/v1/auth/csrf")).Content.ReadFromJsonAsync<Csrf>())!;
            request.Headers.Add(pair.HeaderName, pair.Token);
        }

        if (origin is not null)
        {
            request.Headers.Add("Origin", origin);
        }

        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        return await client.SendAsync(request);
    }

    protected static Task<HttpResponseMessage> ExchangeAsync(HttpClient client, Guid reservationId, string? token, bool csrf = true, string? origin = null) =>
        SendAsync(client, HttpMethod.Post, $"/api/v1/reservations/{reservationId}/manage/exchange", new { token }, csrf, origin);

    protected static Task<HttpResponseMessage> GetManageAsync(HttpClient client, Guid reservationId, string? cookie = null) =>
        SendAsync(client, HttpMethod.Get, $"/api/v1/reservations/{reservationId}/manage", cookie: cookie);

    protected static Task<HttpResponseMessage> SetArrivalAsync(HttpClient client, Guid reservationId, object body, bool csrf = true, string? cookie = null) =>
        SendAsync(client, HttpMethod.Post, $"/api/v1/reservations/{reservationId}/manage/estimated-arrival", body, csrf, cookie: cookie);

    /// <summary>The value of the management cookie a response set, or null.</summary>
    protected static string? CookieValue(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.Where(value => value.StartsWith(SessionCookie + "=", StringComparison.Ordinal)).Select(value => value[(SessionCookie.Length + 1)..].Split(';')[0]).SingleOrDefault()
            : null;

    protected static string CookieHeader(string secret) => $"{SessionCookie}={secret}";

    protected static void AssertNoStore(HttpResponseMessage response) =>
        Assert.Equal("no-store", Assert.Single(response.Headers.GetValues("Cache-Control")));

    /// <summary>Everything the guest-facing tables, the reservation and its side-effect tables hold, as one text, so a test can prove a secret is nowhere in it.</summary>
    protected async Task<string> StorageDumpAsync()
    {
        var parts = new List<string>();
        foreach (var table in new[] { "ReservationManagementLinks", "ReservationManagementSessions", "ReservationArrivalEstimates", "Reservations", "ReservationCreationRequests", "FolioEntries", "EmailOutboxEvents", "AdminActivities" })
        {
            parts.Add(await ScalarAsync<string>($"""SELECT coalesce(string_agg(to_jsonb(t)::text, '|'), '') AS "Value" FROM "{table}" t"""));
        }

        return string.Join('\n', parts);
    }

    /// <summary>Exact fingerprint of everything an arrival update must not touch.</summary>
    protected async Task<string> UntouchedStateAsync()
    {
        var parts = new List<string>();
        foreach (var table in new[] { "Reservations", "ReservationUnits", "ReservationUnitNights", "FolioEntries", "EmailOutboxEvents", "EmailOutboxDeliveries", "AdminActivities", "InventoryHolds", "RoomOccupancySegments", "DailyInventoryControls", "ReservationCreationRequests" })
        {
            parts.Add($"{table}={await ScalarAsync<string>($"""SELECT count(*) || ':' || coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text)), '') AS "Value" FROM "{table}" t""")}");
        }

        return string.Join(", ", parts);
    }

    protected static string Time(JsonElement dto) => dto.GetProperty("estimatedArrival").GetProperty("arrivalTime").GetString()!;

    /// <summary>Captures every log message so a test can prove a secret was never logged.</summary>
    protected sealed class CapturingLogs : ILoggerProvider
    {
        private readonly List<string> _messages = [];

        public string All
        {
            get
            {
                lock (_messages)
                {
                    return string.Join('\n', _messages);
                }
            }
        }

        public ILogger CreateLogger(string categoryName) => new Capture(this);

        public void Dispose()
        {
        }

        private sealed class Capture(CapturingLogs owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                lock (owner._messages)
                {
                    owner._messages.Add(formatter(state, exception) + (exception?.ToString() ?? string.Empty));
                }
            }
        }
    }

    protected static void WithLogs(IWebHostBuilder builder, ILoggerProvider provider) =>
        builder.ConfigureLogging(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Trace);
            logging.AddProvider(provider);
        });
}
