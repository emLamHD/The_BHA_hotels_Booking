using TheBha.Application.Bookings;
using TheBha.Application.Customers;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;

namespace TheBha.UnitTests;

/// <summary>BHA-CHECKOUT-001-PR06: the pure rules of guest reservation management (secrets, expiry boundaries, the estimated-arrival window and wall-clock parsing, who may ask) with no database.</summary>
public sealed class ReservationManagementTests
{
    private static readonly Guid ReservationId = Guid.Parse("60000000-0000-0000-0000-000000000006");
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T18:30:00Z");

    [Fact]
    public void A_link_hash_a_session_hash_and_a_booking_token_hash_of_the_same_text_are_three_different_values()
    {
        var secret = new CryptographicGuestAccessTokenGenerator().Generate();

        Assert.True(ReservationManagementSecrets.TryHashLink(secret, out var link));
        Assert.True(ReservationManagementSecrets.TryHashSession(secret, out var session));
        Assert.True(BookingAccessTokenValidator.TryHash(secret, out var booking));

        Assert.Equal(3, new[] { link, session, booking }.Distinct().Count());
        Assert.All(new[] { link, session }, hash => Assert.Matches("^[0-9a-f]{64}$", hash));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("has space and symbols!!has space and symbols!!has spa")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")] // 47 chars: not 32 bytes
    public void A_secret_that_is_not_32_base64url_bytes_has_no_hash(string? secret)
    {
        Assert.False(ReservationManagementSecrets.TryHashLink(secret, out _));
        Assert.False(ReservationManagementSecrets.TryHashSession(secret, out _));
    }

    [Fact]
    public void A_secret_is_live_strictly_before_its_expiry_and_instants_are_whole_microseconds()
    {
        var expiry = Now.AddHours(72);
        Assert.True(ReservationManagementRules.IsLive(expiry, expiry - TimeSpan.FromTicks(10)));
        Assert.False(ReservationManagementRules.IsLive(expiry, expiry));
        Assert.False(ReservationManagementRules.IsLive(expiry, expiry + TimeSpan.FromTicks(1)));

        var precise = new DateTimeOffset(2026, 7, 22, 18, 30, 0, TimeSpan.Zero).AddTicks(1234567);
        var truncated = ReservationManagementRules.TruncateToMicroseconds(precise);
        Assert.Equal(precise.AddTicks(-7), truncated);
        Assert.Equal(0, truncated.UtcTicks % 10);
        Assert.Equal(TimeSpan.FromHours(72), ReservationManagementRules.DefaultLinkTtl);
        Assert.Equal(TimeSpan.FromHours(24), ReservationManagementRules.SessionTtl);
    }

    [Theory]
    [InlineData("2026-07-26", "21:30", true)]
    [InlineData("2026-07-26", "00:00", true)]
    [InlineData("2026-07-26", "23:59", true)]
    [InlineData("2026-7-26", "21:30", false)]
    [InlineData("26/07/2026", "21:30", false)]
    [InlineData("2026-07-26T21:30:00Z", "21:30", false)]
    [InlineData("2026-07-26", "9:30", false)]
    [InlineData("2026-07-26", "21:30:00", false)]
    [InlineData("2026-07-26", "21:30+07:00", false)]
    [InlineData("2026-07-26", "21:30Z", false)]
    [InlineData("2026-07-26", "24:00", false)]
    [InlineData("2026-07-26", "9:30 PM", false)]
    [InlineData(null, "21:30", false)]
    [InlineData("2026-07-26", null, false)]
    public void Only_a_date_and_a_time_written_exactly_are_accepted(string? date, string? time, bool accepted)
    {
        Assert.Equal(accepted, EstimatedArrivalRules.TryParse(date, time, out var parsedDate, out var parsedTime, out var error));
        if (accepted)
        {
            Assert.Equal((new DateOnly(2026, 7, 26), TimeOnly.Parse(time!)), (parsedDate, parsedTime));
            Assert.Empty(error);
        }
        else
        {
            Assert.NotEmpty(error);
        }
    }

    [Fact]
    public void The_arrival_date_must_be_the_check_in_date_or_the_day_after()
    {
        var checkIn = new DateOnly(2026, 7, 26);
        const string Zone = "Asia/Ho_Chi_Minh";

        Assert.True(EstimatedArrivalRules.TryCheckWindow(checkIn, Zone, checkIn, new TimeOnly(21, 30), out _));
        Assert.True(EstimatedArrivalRules.TryCheckWindow(checkIn, Zone, checkIn.AddDays(1), new TimeOnly(1, 15), out _)); // overnight
        Assert.False(EstimatedArrivalRules.TryCheckWindow(checkIn, Zone, checkIn.AddDays(-1), new TimeOnly(12, 0), out var before));
        Assert.False(EstimatedArrivalRules.TryCheckWindow(checkIn, Zone, checkIn.AddDays(2), new TimeOnly(12, 0), out _));
        Assert.StartsWith("arrivalDate must be the check-in date", before);
    }

    [Fact]
    public void A_wall_time_that_does_not_exist_in_the_property_zone_is_refused_and_one_that_occurs_twice_is_kept_as_stated()
    {
        // New York, 2026: clocks go forward at 02:00 on March 8 (02:30 never happens) and back at 02:00 on November 1 (01:30 happens twice).
        Assert.False(EstimatedArrivalRules.TryCheckWindow(new DateOnly(2026, 3, 8), "America/New_York", new DateOnly(2026, 3, 8), new TimeOnly(2, 30), out var error));
        Assert.Equal("That time does not exist at the property on that date.", error);
        Assert.True(EstimatedArrivalRules.TryCheckWindow(new DateOnly(2026, 3, 8), "America/New_York", new DateOnly(2026, 3, 8), new TimeOnly(3, 30), out _));
        Assert.True(EstimatedArrivalRules.TryCheckWindow(new DateOnly(2026, 11, 1), "America/New_York", new DateOnly(2026, 11, 1), new TimeOnly(1, 30), out _)); // ambiguous: no offset is stored, so nothing is guessed
    }

    [Fact]
    public void A_link_and_a_session_must_expire_after_they_are_made_and_carry_a_hash()
    {
        Assert.Throws<DomainException>(() => new ReservationManagementLink(Guid.NewGuid(), PropertyId, ReservationId, new string('a', 64), Now, Now));
        Assert.Throws<DomainException>(() => new ReservationManagementLink(Guid.NewGuid(), PropertyId, ReservationId, "not-a-hash", Now, Now.AddHours(1)));
        Assert.Throws<DomainException>(() => new ReservationManagementLink(Guid.NewGuid(), PropertyId, ReservationId, new string('a', 64), Now.ToOffset(TimeSpan.FromHours(7)), Now.AddHours(1)));
        Assert.Throws<DomainException>(() => new ReservationManagementSession(Guid.NewGuid(), PropertyId, ReservationId, Guid.NewGuid(), new string('b', 64), Now, Now.AddSeconds(-1)));
        Assert.Throws<DomainException>(() => new ReservationManagementSession(Guid.NewGuid(), PropertyId, ReservationId, Guid.Empty, new string('b', 64), Now, Now.AddHours(1)));
        var link = new ReservationManagementLink(Guid.NewGuid(), PropertyId, ReservationId, new string('a', 64), Now, Now.AddHours(72));
        Assert.Null(link.ConsumedAtUtc);
    }

    [Fact]
    public void An_arrival_estimate_keeps_whole_minutes_only_and_can_be_replaced()
    {
        var estimate = new ReservationArrivalEstimate(PropertyId, ReservationId, new DateOnly(2026, 7, 26), new TimeOnly(21, 30), "Asia/Ho_Chi_Minh", Now);
        estimate.Replace(new DateOnly(2026, 7, 27), new TimeOnly(0, 15), "Asia/Ho_Chi_Minh", Now.AddMinutes(1));

        Assert.Equal((new DateOnly(2026, 7, 27), new TimeOnly(0, 15), Now.AddMinutes(1)), (estimate.ArrivalDate, estimate.ArrivalTime, estimate.UpdatedAtUtc));
        Assert.Throws<DomainException>(() => estimate.Replace(new DateOnly(2026, 7, 27), new TimeOnly(0, 15, 30), "Asia/Ho_Chi_Minh", Now));
        Assert.Throws<DomainException>(() => new ReservationArrivalEstimate(PropertyId, ReservationId, new DateOnly(2026, 7, 26), new TimeOnly(10, 0), " ", Now));
    }

    [Fact]
    public async Task The_exchange_never_asks_the_store_about_a_malformed_secret_and_hands_it_only_hashes()
    {
        var store = new RecordingExchangeStore();
        var service = new ReservationManagementExchange(store, new CryptographicGuestAccessTokenGenerator());

        Assert.Equal(ReservationManagementExchangeStatus.Invalid, (await service.ExchangeAsync(ReservationId, "short", CancellationToken.None)).Status);
        Assert.Equal(ReservationManagementExchangeStatus.Invalid, (await service.ExchangeAsync(Guid.Empty, new CryptographicGuestAccessTokenGenerator().Generate(), CancellationToken.None)).Status);
        Assert.Equal(0, store.Calls);

        var link = new CryptographicGuestAccessTokenGenerator().Generate();
        store.Answer = Now.AddHours(24);
        var result = await service.ExchangeAsync(ReservationId, link, CancellationToken.None);

        Assert.Equal(ReservationManagementExchangeStatus.Exchanged, result.Status);
        Assert.Equal(Now.AddHours(24), result.ExpiresAtUtc);
        Assert.True(ReservationManagementSecrets.TryHashLink(link, out var linkHash));
        Assert.Equal(linkHash, store.LinkHash);
        Assert.True(ReservationManagementSecrets.TryHashSession(result.SessionSecret, out var sessionHash));
        Assert.Equal(sessionHash, store.SessionHash);
        Assert.DoesNotContain(result.SessionSecret!, result.ToString(), StringComparison.Ordinal); // a log line never carries it

        store.Answer = null;
        Assert.Equal(ReservationManagementExchangeStatus.Invalid, (await service.ExchangeAsync(ReservationId, link, CancellationToken.None)).Status);
    }

    [Fact]
    public async Task Access_needs_a_signed_in_account_or_a_well_formed_session_and_never_mixes_them_up()
    {
        var store = new RecordingManagementStore();
        var guest = new ReservationManagement(new StubCustomer(false, null), store);
        var account = new ReservationManagement(new StubCustomer(true, Guid.NewGuid()), store);
        var brokenAccount = new ReservationManagement(new StubCustomer(true, null), store);
        var secret = new CryptographicGuestAccessTokenGenerator().Generate();

        // Nobody, or a malformed secret: no valid credential, and the store is never asked.
        Assert.Equal(ReservationManagementStatus.Unauthorized, (await guest.GetAsync(ReservationId, null, CancellationToken.None)).Status);
        Assert.Equal(ReservationManagementStatus.Unauthorized, (await guest.GetAsync(ReservationId, "garbage", CancellationToken.None)).Status);
        Assert.Equal(ReservationManagementStatus.Unauthorized, (await brokenAccount.GetAsync(ReservationId, secret, CancellationToken.None)).Status);
        Assert.Equal(0, store.Calls);

        // A guest session: only the session hash goes down. A guest with no valid session learns nothing about the reservation.
        store.Answer = ReservationManagementResult.NotFound("x");
        var refused = await guest.GetAsync(ReservationId, secret, CancellationToken.None);
        Assert.Equal(ReservationManagementStatus.Unauthorized, refused.Status);
        Assert.Null(store.Caller!.CustomerAccountId);
        Assert.True(ReservationManagementSecrets.TryHashSession(secret, out var hash));
        Assert.Equal(hash, store.Caller.SessionHash);

        // A signed-in account that does not own it: plain not found (the existing contract for owners).
        Assert.Equal(ReservationManagementStatus.NotFound, (await account.GetAsync(ReservationId, null, CancellationToken.None)).Status);
        Assert.NotNull(store.Caller!.CustomerAccountId);
        Assert.Null(store.Caller.SessionHash);
        // A malformed secret next to a signed-in account is ignored, not an error.
        Assert.Equal(ReservationManagementStatus.NotFound, (await account.GetAsync(ReservationId, "garbage", CancellationToken.None)).Status);
        Assert.Null(store.Caller.SessionHash);
    }

    [Fact]
    public async Task A_malformed_arrival_is_refused_before_the_store_is_asked()
    {
        var store = new RecordingManagementStore { Answer = ReservationManagementResult.NotFound("x") };
        var service = new ReservationManagement(new StubCustomer(true, Guid.NewGuid()), store);

        var bad = await service.UpdateEstimatedArrivalAsync(ReservationId, null, "2026-07-26", "9:30", CancellationToken.None);
        Assert.Equal(ReservationManagementStatus.Invalid, bad.Status);
        Assert.Equal(0, store.Calls);

        await service.UpdateEstimatedArrivalAsync(ReservationId, null, "2026-07-26", "21:30", CancellationToken.None);
        Assert.Equal((new DateOnly(2026, 7, 26), new TimeOnly(21, 30)), (store.Date, store.Time));
    }

    private sealed class StubCustomer(bool isAuthenticated, Guid? accountId) : ICurrentCustomer
    {
        public bool IsAuthenticated => isAuthenticated;
        public Guid? CustomerAccountId => accountId;
        public string? Email => null;
    }

    private sealed class RecordingExchangeStore : IReservationManagementExchangeStore
    {
        public int Calls;
        public string? LinkHash;
        public string? SessionHash;
        public DateTimeOffset? Answer;

        public Task<DateTimeOffset?> ExchangeAsync(Guid reservationId, string linkHash, string sessionHash, CancellationToken cancellationToken)
        {
            Calls++;
            LinkHash = linkHash;
            SessionHash = sessionHash;
            return Task.FromResult(Answer);
        }
    }

    private sealed class RecordingManagementStore : IReservationManagementStore
    {
        public int Calls;
        public ReservationManagementCaller? Caller;
        public ReservationManagementResult Answer = ReservationManagementResult.NotFound("x");
        public DateOnly Date;
        public TimeOnly Time;

        public Task<ReservationManagementResult> GetAsync(Guid reservationId, ReservationManagementCaller caller, CancellationToken cancellationToken)
        {
            Calls++;
            Caller = caller;
            return Task.FromResult(Answer);
        }

        public Task<ReservationManagementResult> UpdateEstimatedArrivalAsync(Guid reservationId, ReservationManagementCaller caller, DateOnly arrivalDate, TimeOnly arrivalTime, CancellationToken cancellationToken)
        {
            Calls++;
            Caller = caller;
            Date = arrivalDate;
            Time = arrivalTime;
            return Task.FromResult(Answer);
        }
    }
}
