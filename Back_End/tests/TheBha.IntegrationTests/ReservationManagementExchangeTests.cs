using System.Data.Common;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR06 M-01 and M-02 (HTTP side): issuing a link, exchanging it for the session cookie, and what must never happen to a secret. Runs against the in-process host over an https:// base address with real
/// PostgreSQL; the live-Kestrel HTTPS run is separate evidence.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ReservationManagementExchangeTests(PostgreSqlWebApplicationFactory factory) : ReservationManagementTestSupport(factory)
{
    [Fact]
    public async Task A_guest_link_is_exchanged_once_for_a_scoped_cookie_a_read_does_not_consume_it_and_no_secret_is_stored_returned_or_logged()
    {
        await SeedAsync();
        var logs = new CapturingLogs();
        using var host = ManageHost(builder => WithLogs(builder, logs));
        var (reservationId, bookingToken) = await BookGuestAsync(host);
        var link = await IssueLinkAsync(host, reservationId);
        using var client = Https(host);

        // A read without a session answers and consumes nothing.
        var before = await GetManageAsync(client, reservationId);
        Assert.Equal(HttpStatusCode.Unauthorized, before.StatusCode);
        Assert.Null((await factory.CreateDbContext().ReservationManagementLinks.AsNoTracking().SingleAsync()).ConsumedAtUtc);

        var exchange = await ExchangeAsync(client, reservationId, link);

        Assert.Equal(HttpStatusCode.OK, exchange.StatusCode);
        AssertNoStore(exchange);
        var body = await JsonAsync(exchange);
        Assert.Equal(["expiresAtUtc", "reservationId"], body.EnumerateObject().Select(property => property.Name).Order().ToArray());
        Assert.Equal(reservationId, body.GetProperty("reservationId").GetGuid());
        Assert.Equal(FixedUtc.AddHours(24), body.GetProperty("expiresAtUtc").GetDateTimeOffset());

        var secret = CookieValue(exchange)!;
        Assert.Equal(43, secret.Length);
        var setCookie = exchange.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith(SessionCookie, StringComparison.Ordinal)).ToLowerInvariant();
        Assert.Contains("httponly", setCookie);
        Assert.Contains("secure", setCookie);
        Assert.Contains("samesite=lax", setCookie);
        Assert.Contains($"path=/api/v1/reservations/{reservationId:D}/manage", setCookie);
        Assert.DoesNotContain("domain=", setCookie); // host-only
        Assert.Contains("max-age=86400", setCookie);
        Assert.Contains("expires=", setCookie);

        // The link is spent in the same transaction that made the session: one of each.
        await using (var context = factory.CreateDbContext())
        {
            var link1 = await context.ReservationManagementLinks.AsNoTracking().SingleAsync();
            var session = await context.ReservationManagementSessions.AsNoTracking().SingleAsync();
            Assert.Equal(FixedUtc, link1.ConsumedAtUtc);
            Assert.Equal(link1.Id, session.LinkId);
            Assert.Equal(reservationId, session.ReservationId);
            Assert.Equal(PropertyId, session.PropertyId);
            Assert.Equal(FixedUtc.AddHours(24), session.ExpiresAtUtc);
            Assert.True(ReservationManagementSecrets.TryHashLink(link, out var linkHash));
            Assert.True(ReservationManagementSecrets.TryHashSession(secret, out var sessionHash));
            Assert.Equal(linkHash, link1.TokenHash);
            Assert.Equal(sessionHash, session.SessionHash);
        }

        // The cookie manages it. (The fixed test clock is in the real past, so the client's own cookie jar would drop this Expires-dated cookie: the value is sent by hand.)
        var read = await GetManageAsync(client, reservationId, CookieHeader(secret));
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        AssertNoStore(read);

        // The link is used up: the same secret again is the one generic refusal.
        var again = await ExchangeAsync(Https(host), reservationId, link);
        Assert.Equal(HttpStatusCode.Unauthorized, again.StatusCode);
        Assert.Equal("reservation.manage-link-invalid", Code(await JsonAsync(again)));

        // Neither secret is in any response body, in storage or in any log line.
        var everything = await StorageDumpAsync() + logs.All + await exchange.Content.ReadAsStringAsync() + await read.Content.ReadAsStringAsync();
        Assert.DoesNotContain(link, everything, StringComparison.Ordinal);
        Assert.DoesNotContain(secret, everything, StringComparison.Ordinal);
        Assert.DoesNotContain(bookingToken, logs.All + await exchange.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.DoesNotContain(link, string.Join(';', exchange.Headers.Select(header => string.Join(',', header.Value)).Where(value => !value.StartsWith(SessionCookie, StringComparison.Ordinal))), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Every_unusable_link_gets_the_same_401_and_a_wrong_reservation_does_not_spend_the_link()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host, "key-a");
        var (otherId, _) = await BookGuestAsync(host, "key-b", startOffset: 5);
        var link = await IssueLinkAsync(host, reservationId);
        var otherLink = await IssueLinkAsync(host, otherId);
        var expiredLink = await IssueLinkAsync(host, reservationId, TimeSpan.FromHours(1));
        var usedLink = await IssueLinkAsync(host, reservationId);
        using var client = Https(host);
        Assert.Equal(HttpStatusCode.OK, (await ExchangeAsync(Https(host), reservationId, usedLink)).StatusCode);
        factory.Clock.UtcNow = FixedUtc.AddHours(2); // the 1-hour link has expired; the 72-hour ones have not

        var refusals = new List<HttpResponseMessage>
        {
            await ExchangeAsync(client, reservationId, null), // missing
            await ExchangeAsync(client, reservationId, "not-a-token"), // malformed
            await ExchangeAsync(client, reservationId, NewToken()), // well-formed, unknown
            await ExchangeAsync(client, reservationId, expiredLink), // expired
            await ExchangeAsync(client, reservationId, usedLink), // already used
            await ExchangeAsync(client, reservationId, otherLink), // another reservation's link
            await ExchangeAsync(client, Guid.NewGuid(), link) // a reservation that does not exist
        };

        var bodies = new List<string>();
        foreach (var refusal in refusals)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, refusal.StatusCode);
            AssertNoStore(refusal);
            Assert.Null(CookieValue(refusal));
            var problem = await JsonAsync(refusal);
            Assert.Equal("reservation.manage-link-invalid", Code(problem));
            bodies.Add($"{problem.GetProperty("title")}|{problem.GetProperty("detail")}|{problem.GetProperty("status")}");
        }

        Assert.Single(bodies.Distinct()); // nothing says which of the seven it was

        // The refused tries spent nothing: the wrong-reservation and the unknown-reservation attempts left both real links usable.
        Assert.Equal(HttpStatusCode.OK, (await ExchangeAsync(client, reservationId, link)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ExchangeAsync(Https(host), otherId, otherLink)).StatusCode);
        Assert.Equal(3, await CountAsync("ReservationManagementSessions"));
    }

    [Fact]
    public async Task A_link_is_live_strictly_before_its_expiry_and_a_session_strictly_before_its_own()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var atExpiry = await IssueLinkAsync(host, reservationId, TimeSpan.FromHours(5));
        var justBefore = await IssueLinkAsync(host, reservationId, TimeSpan.FromHours(5));
        var expires = FixedUtc.AddHours(5);

        factory.Clock.UtcNow = expires; // exactly the expiry instant: already expired
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync(Https(host), reservationId, atExpiry)).StatusCode);

        factory.Clock.UtcNow = expires - TimeSpan.FromTicks(10); // one microsecond earlier: still live
        using var client = Https(host);
        var ok = await ExchangeAsync(client, reservationId, justBefore);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var sessionExpires = factory.Clock.UtcNow + TimeSpan.FromHours(24);
        var cookie = CookieHeader(CookieValue(ok)!);

        factory.Clock.UtcNow = sessionExpires - TimeSpan.FromTicks(10);
        Assert.Equal(HttpStatusCode.OK, (await GetManageAsync(client, reservationId, cookie)).StatusCode);
        factory.Clock.UtcNow = sessionExpires;
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetManageAsync(client, reservationId, cookie)).StatusCode);
    }

    [Fact]
    public async Task Concurrent_exchanges_of_one_link_have_exactly_one_winner_and_one_session()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var link = await IssueLinkAsync(host, reservationId);
        var clients = Enumerable.Range(0, 8).Select(_ => Https(host)).ToList();

        var responses = await Task.WhenAll(clients.Select(client => ExchangeAsync(client, reservationId, link)));

        Assert.Equal(1, responses.Count(response => response.StatusCode == HttpStatusCode.OK));
        Assert.Equal(7, responses.Count(response => response.StatusCode == HttpStatusCode.Unauthorized));
        Assert.Equal(1, responses.Count(response => CookieValue(response) is not null));
        Assert.Equal(1, await CountAsync("ReservationManagementSessions"));
        Assert.NotNull((await factory.CreateDbContext().ReservationManagementLinks.AsNoTracking().SingleAsync()).ConsumedAtUtc);
    }

    [Fact]
    public async Task A_failure_after_the_link_was_consumed_rolls_the_consumption_back_no_session_and_the_link_still_works()
    {
        await SeedAsync();
        var failing = new FailSessionInsert();
        using var host = ManageHost(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
            services.RemoveAll<DbContextOptions>();
            services.AddDbContext<TheBhaDbContext>(options => options
                .UseNpgsql(factory.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
                .AddInterceptors(failing));
        }));
        var (reservationId, _) = await BookGuestAsync(host);
        var link = await IssueLinkAsync(host, reservationId);
        using var client = Https(host);

        failing.Armed = true;
        var failed = await ExchangeAsync(client, reservationId, link);
        failing.Armed = false;

        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        Assert.Null(CookieValue(failed));
        Assert.Equal(0, await CountAsync("ReservationManagementSessions"));
        Assert.Null((await factory.CreateDbContext().ReservationManagementLinks.AsNoTracking().SingleAsync()).ConsumedAtUtc);

        Assert.Equal(HttpStatusCode.OK, (await ExchangeAsync(client, reservationId, link)).StatusCode);
        Assert.Equal(1, await CountAsync("ReservationManagementSessions"));
    }

    [Fact]
    public async Task The_exchange_needs_the_antiforgery_token_answers_only_the_customer_origin_and_is_rate_limited_before_it_touches_the_link()
    {
        await SeedAsync();
        using var host = ManageHost(settings: [("Booking:ReservationManagement:RateLimiting:PermitLimit", "3"), ("Booking:ReservationManagement:RateLimiting:WindowSeconds", "600")]);
        var (reservationId, _) = await BookGuestAsync(host);
        var link = await IssueLinkAsync(host, reservationId);
        using var client = Https(host);

        // CSRF (does not count against the token: a refusal before the action consumes nothing).
        var noCsrf = await ExchangeAsync(client, reservationId, link, csrf: false);
        Assert.Equal(HttpStatusCode.BadRequest, noCsrf.StatusCode);
        Assert.Equal("auth.csrf-invalid", Code(await JsonAsync(noCsrf)));
        AssertNoStore(noCsrf);

        // CORS: the configured customer origin gets credentials; any other origin gets no allowance.
        var good = await ExchangeAsync(client, reservationId, NewToken(), origin: CustomerOrigin);
        Assert.Equal(CustomerOrigin, Assert.Single(good.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal("true", Assert.Single(good.Headers.GetValues("Access-Control-Allow-Credentials")));
        var evil = await ExchangeAsync(client, reservationId, NewToken(), origin: "https://evil.example");
        Assert.False(evil.Headers.Contains("Access-Control-Allow-Origin"));

        // Rate limit: the fourth request from this address is refused before anything is read, even with the real link.
        var limited = await ExchangeAsync(client, reservationId, link);
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("booking.rate-limited", Code(await JsonAsync(limited)));
        AssertNoStore(limited);
        Assert.Equal(0, await CountAsync("ReservationManagementSessions"));
        Assert.Null((await factory.CreateDbContext().ReservationManagementLinks.AsNoTracking().SingleAsync()).ConsumedAtUtc);
    }

    [Fact]
    public async Task A_non_positive_rate_limit_stops_the_host_from_starting()
    {
        await SeedAsync();
        using var host = ManageHost(settings: [("Booking:ReservationManagement:RateLimiting:PermitLimit", "0")]);

        var failure = Assert.ThrowsAny<Exception>(() => host.CreateClient());

        Assert.Contains("Booking:ReservationManagement:RateLimiting values must be positive.", failure.ToString());
    }

    [Fact]
    public async Task Issuing_a_link_joins_the_callers_transaction_sends_nothing_and_only_serves_a_guest_owned_direct_reservation()
    {
        await SeedAsync();
        using var host = ManageHost();
        var (reservationId, _) = await BookGuestAsync(host);
        var footprint = await UntouchedStateAsync();

        await using (var scope = host.Services.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
            var issuer = scope.ServiceProvider.GetRequiredService<IReservationManagementLinkIssuer>();

            // No transaction: refused outright (a link committed alone would be a secret nobody holds).
            await Assert.ThrowsAsync<InvalidOperationException>(() => issuer.IssueAsync(PropertyId, reservationId, null, CancellationToken.None));
            Assert.Equal(0, await CountAsync("ReservationManagementLinks"));

            // A rolled-back caller leaves no link.
            await using (var rolledBack = await context.Database.BeginTransactionAsync())
            {
                var issue = await issuer.IssueAsync(PropertyId, reservationId, null, CancellationToken.None);
                Assert.Equal(ReservationManagementLinkIssueStatus.Issued, issue.Status);
                Assert.DoesNotContain(issue.Secret!, issue.ToString(), StringComparison.Ordinal);
                await rolledBack.RollbackAsync();
            }

            Assert.Equal(0, await CountAsync("ReservationManagementLinks"));

            // Default 72 hours to the microsecond; a committed link is the one row.
            await using (var committed = await context.Database.BeginTransactionAsync())
            {
                var issue = await issuer.IssueAsync(PropertyId, reservationId, null, CancellationToken.None);
                Assert.Equal(FixedUtc.AddHours(72), issue.ExpiresAtUtc);
                await committed.CommitAsync();
            }

            var link = await factory.CreateDbContext().ReservationManagementLinks.AsNoTracking().SingleAsync();
            Assert.Equal(FixedUtc, link.CreatedAtUtc);
            Assert.Equal(FixedUtc.AddHours(72), link.ExpiresAtUtc);

            // A lifetime out of range is a caller bug, not a link.
            await using var bad = await context.Database.BeginTransactionAsync();
            await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => issuer.IssueAsync(PropertyId, reservationId, TimeSpan.Zero, CancellationToken.None));
            await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => issuer.IssueAsync(PropertyId, reservationId, TimeSpan.FromDays(31), CancellationToken.None));

            // Not this Property, not a reservation: nothing issued.
            Assert.Equal(ReservationManagementLinkIssueStatus.NotEligible, (await issuer.IssueAsync(Guid.NewGuid(), reservationId, null, CancellationToken.None)).Status);
            Assert.Equal(ReservationManagementLinkIssueStatus.NotEligible, (await issuer.IssueAsync(PropertyId, Guid.NewGuid(), null, CancellationToken.None)).Status);
        }

        // Issuing sent no mail and wrote no event, charge or Calendar row: the footprint is unchanged apart from the link itself.
        Assert.Equal(footprint, await UntouchedStateAsync());
    }

    [Fact]
    public async Task An_account_owned_or_hold_sourced_reservation_never_gets_a_link()
    {
        await SeedAsync();
        using var host = ManageHost();
        using var accountClient = Https(host);
        var accountId = await CreateCustomerAsync(host, accountClient, "owner@example.com");
        var accountBooking = await PostAsync(accountClient, "acct-key", Body());
        Assert.Equal(HttpStatusCode.Created, accountBooking.StatusCode);
        var accountReservation = (await JsonAsync(accountBooking)).GetProperty("reservationId").GetGuid();
        using var holdClient = Https(host);
        var hold = await PostHoldAsync(holdClient, "hold-key", HoldBody(startOffset: 6));
        Assert.Equal(HttpStatusCode.Created, hold.StatusCode);
        var holdBody = await JsonAsync(hold);
        var confirmed = await ConfirmAsync(holdClient, holdBody.GetProperty("holdId").GetGuid(), holdBody.GetProperty("guestAccessToken").GetString()!);
        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var holdReservation = (await JsonAsync(confirmed)).GetProperty("reservationId").GetGuid();

        await using var scope = host.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        await using var transaction = await context.Database.BeginTransactionAsync();
        var issuer = scope.ServiceProvider.GetRequiredService<IReservationManagementLinkIssuer>();
        Assert.Equal(ReservationManagementLinkIssueStatus.NotEligible, (await issuer.IssueAsync(PropertyId, accountReservation, null, CancellationToken.None)).Status);
        Assert.Equal(ReservationManagementLinkIssueStatus.NotEligible, (await issuer.IssueAsync(PropertyId, holdReservation, null, CancellationToken.None)).Status);
        await transaction.RollbackAsync();
        Assert.Equal(0, await CountAsync("ReservationManagementLinks"));
        Assert.NotEqual(Guid.Empty, accountId);
    }

    private sealed class FailSessionInsert : DbCommandInterceptor
    {
        public volatile bool Armed;

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Check(command);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Check(command);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        private void Check(DbCommand command)
        {
            if (Armed && command.CommandText.Contains("INSERT INTO \"ReservationManagementSessions\"", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("forced failure after the link was consumed");
            }
        }
    }
}
