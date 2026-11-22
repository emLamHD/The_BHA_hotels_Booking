using TheBha.Application.Bookings;
using TheBha.Application.Customers;
using TheBha.Application.Notifications;

namespace TheBha.UnitTests;

/// <summary>BHA-CHECKOUT-001-PR05: the owner, scope, fingerprint, intake-switch and event-identity rules that need no database.</summary>
public sealed class DirectReservationCreationTests
{
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid OtherPropertyId = Guid.Parse("10000000-0000-0000-0000-000000000002");
    private static readonly Guid RoomTypeId = Guid.Parse("20000000-0000-0000-0000-000000000002");
    private static readonly Guid RatePlanId = Guid.Parse("30000000-0000-0000-0000-000000000003");
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000004");
    private static readonly string TokenA = new CryptographicGuestAccessTokenGenerator().Generate();
    private static readonly string TokenB = new CryptographicGuestAccessTokenGenerator().Generate();

    private static CreateDirectReservationRequest Valid() => new(
        PropertyId, RoomTypeId, RatePlanId, new DateOnly(2026, 12, 20), new DateOnly(2026, 12, 22), 2, 0, 1,
        "Guest Name", "guest@example.com", "+84 123 4567", 3_000_000m, "vnd", "PayAtProperty");

    private static async Task<(PreparedDirectReservationRequest? Prepared, DirectReservationCreationResult Result)> RunAsync(
        CreateDirectReservationRequest request, string? key = "key-1", string? token = null, bool authenticated = false)
    {
        var store = new RecordingStore();
        var service = new DirectReservationCreation(new StubCurrentCustomer(authenticated, authenticated ? CustomerId : null), store);
        var result = await service.CreateAsync(key, token, request, CancellationToken.None);
        return (store.Request, result);
    }

    [Fact]
    public async Task A_guest_request_is_scoped_by_the_hash_of_its_own_token_and_never_stores_the_raw_token()
    {
        var (prepared, _) = await RunAsync(Valid(), token: TokenA);

        Assert.NotNull(prepared);
        Assert.Null(prepared.CustomerAccountId);
        Assert.True(BookingAccessTokenValidator.TryHash(TokenA, out var hash));
        Assert.Equal(hash, prepared.GuestAccessTokenHash);
        Assert.Equal("VND", prepared.ExpectedCurrencyCode); // normalized like a Hold's
        var everything = string.Join('|', prepared.ScopeHash, prepared.KeyHash, prepared.RequestFingerprint);
        Assert.DoesNotContain(TokenA, everything, StringComparison.Ordinal);
        Assert.DoesNotContain("key-1", everything, StringComparison.Ordinal);
        Assert.All(new[] { prepared.ScopeHash, prepared.KeyHash, prepared.RequestFingerprint }, value => Assert.Matches("^[0-9a-f]{64}$", value));
    }

    [Fact]
    public async Task The_scope_separates_owners_and_properties_while_the_same_request_always_gives_the_same_scope_key_and_fingerprint()
    {
        var (a1, _) = await RunAsync(Valid(), token: TokenA);
        var (a2, _) = await RunAsync(Valid(), token: TokenA);
        var (b, _) = await RunAsync(Valid(), token: TokenB);
        var (account, _) = await RunAsync(Valid(), authenticated: true);
        var (otherProperty, _) = await RunAsync(Valid() with { PropertyId = OtherPropertyId }, token: TokenA);

        Assert.Equal((a1!.ScopeHash, a1.KeyHash, a1.RequestFingerprint), (a2!.ScopeHash, a2.KeyHash, a2.RequestFingerprint));
        Assert.Equal(4, new[] { a1.ScopeHash, b!.ScopeHash, account!.ScopeHash, otherProperty!.ScopeHash }.Distinct().Count()); // two guests, an account and another Property never share a key space
        Assert.Equal(a1.KeyHash, b.KeyHash); // the key text alone is the same; it is the scope that keeps results apart
        Assert.NotEqual(a1.RequestFingerprint, b.RequestFingerprint); // and the owner is part of what a repeat must match
        Assert.NotEqual(a1.RequestFingerprint, account.RequestFingerprint);
        Assert.NotEqual((await RunAsync(Valid(), key: "key-2", token: TokenA)).Prepared!.KeyHash, a1.KeyHash);
    }

    [Fact]
    public async Task Every_input_that_affects_the_booking_changes_the_fingerprint_and_so_does_the_price_and_the_method_is_fixed()
    {
        var baseline = (await RunAsync(Valid(), token: TokenA)).Prepared!.RequestFingerprint;
        var changes = new Func<CreateDirectReservationRequest, CreateDirectReservationRequest>[]
        {
            r => r with { RoomTypeId = Guid.NewGuid() }, r => r with { RatePlanId = Guid.NewGuid() }, r => r with { CheckIn = r.CheckIn.AddDays(1) },
            r => r with { CheckOut = r.CheckOut.AddDays(1) }, r => r with { Adults = 1 }, r => r with { Children = 1 }, r => r with { Rooms = 2 },
            r => r with { FullName = "Other Name" }, r => r with { Email = "other@example.com" }, r => r with { Phone = "+84 999 9999" },
            r => r with { ExpectedTotalAmount = 3_000_001m }, r => r with { ExpectedCurrencyCode = "USD" }
        };
        var fingerprints = new List<string> { baseline };
        foreach (var change in changes)
        {
            fingerprints.Add((await RunAsync(change(Valid()), token: TokenA)).Prepared!.RequestFingerprint);
        }

        Assert.Equal(fingerprints.Count, fingerprints.Distinct().Count());
        // Whitespace around text is normalized away, so it is not a different request.
        Assert.Equal(baseline, (await RunAsync(Valid() with { FullName = "  Guest Name  ", Email = " guest@example.com " }, token: TokenA)).Prepared!.RequestFingerprint);
    }

    [Fact]
    public async Task The_fingerprint_of_a_Direct_request_can_never_equal_the_fingerprint_of_a_Hold_request()
    {
        var (prepared, _) = await RunAsync(Valid(), token: TokenA);
        var hold = new CreateBookingHoldRequest(
            PropertyId, RoomTypeId, RatePlanId, new DateOnly(2026, 12, 20), new DateOnly(2026, 12, 22), 2, 0, 1, "Guest Name", "guest@example.com", "+84 123 4567", 3_000_000m, "VND");

        Assert.NotEqual(BookingHoldRequestSecurity.CreateFingerprint(hold, null), prepared!.RequestFingerprint);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("payatproperty")]
    [InlineData("PayOnline")]
    [InlineData("Deposit")]
    public async Task Only_PayAtProperty_is_accepted_and_nothing_reaches_the_store_otherwise(string? method)
    {
        var (prepared, result) = await RunAsync(Valid() with { PaymentMethod = method });

        Assert.Equal(DirectReservationCreationStatus.Invalid, result.Status);
        Assert.StartsWith("paymentMethod", result.Error, StringComparison.Ordinal);
        Assert.Null(prepared);
    }

    [Fact]
    public async Task The_expected_price_is_required_and_a_malformed_one_is_refused_before_the_store()
    {
        foreach (var request in new[] { Valid() with { ExpectedTotalAmount = null }, Valid() with { ExpectedCurrencyCode = null }, Valid() with { ExpectedTotalAmount = -1m }, Valid() with { ExpectedTotalAmount = 1.005m }, Valid() with { ExpectedCurrencyCode = "VN" } })
        {
            var (prepared, result) = await RunAsync(request, token: TokenA);
            Assert.Equal(DirectReservationCreationStatus.Invalid, result.Status);
            Assert.StartsWith("expected", result.Error, StringComparison.Ordinal);
            Assert.Null(prepared);
        }
    }

    [Fact]
    public async Task Owner_rules_a_session_never_with_a_token_no_session_needs_a_well_formed_token()
    {
        var both = await RunAsync(Valid(), token: TokenA, authenticated: true);
        Assert.Equal(DirectReservationCreationStatus.Invalid, both.Result.Status);
        Assert.StartsWith("A booking access token cannot be sent", both.Result.Error, StringComparison.Ordinal);
        Assert.Null(both.Prepared);

        var session = await RunAsync(Valid(), authenticated: true);
        Assert.Equal(CustomerId, session.Prepared!.CustomerAccountId);
        Assert.Null(session.Prepared.GuestAccessTokenHash);

        foreach (var token in new string?[] { null, "", "short", new string('A', 43) + "!", TokenA + "A" })
        {
            var guest = await RunAsync(Valid(), token: token);
            Assert.Equal(DirectReservationCreationStatus.CredentialInvalid, guest.Result.Status);
            Assert.Null(guest.Prepared);
        }
    }

    [Fact]
    public async Task A_session_that_names_no_account_is_unauthorized()
    {
        var store = new RecordingStore();
        var service = new DirectReservationCreation(new StubCurrentCustomer(true, Guid.Empty), store);

        var result = await service.CreateAsync("key-1", null, Valid(), CancellationToken.None);

        Assert.Equal(DirectReservationCreationStatus.Unauthorized, result.Status);
        Assert.Null(store.Request);
    }

    [Fact]
    public void Intake_defaults_are_open_and_Direct_off_and_bad_values_are_named()
    {
        var defaults = new BookingIntakeOptions().Build();
        Assert.True(defaults.AcceptingNewReservations);
        Assert.False(defaults.AllowsDirect(PropertyId));
        Assert.Empty(BookingIntake.Default.DirectPropertyIds);

        var listed = new BookingIntakeOptions { DirectCheckout = new() { PropertyIds = [PropertyId.ToString(), $" {OtherPropertyId} "] } }.Build();
        Assert.True(listed.AllowsDirect(PropertyId));
        Assert.True(listed.AllowsDirect(OtherPropertyId));
        Assert.False(listed.AllowsDirect(Guid.NewGuid()));

        foreach (var bad in new[] { "", "nope", Guid.Empty.ToString() })
        {
            var error = Assert.Throws<InvalidOperationException>(() => new BookingIntakeOptions { DirectCheckout = new() { PropertyIds = [bad] } }.Build());
            Assert.Contains("Booking:DirectCheckout:PropertyIds", error.Message);
        }

        Assert.Throws<InvalidOperationException>(() => new BookingIntakeOptions { DirectCheckout = new() { PropertyIds = [PropertyId.ToString(), PropertyId.ToString()] } }.Build());
    }

    [Fact]
    public void The_confirmed_event_has_a_stable_id_from_the_reservation_only_and_a_payload_of_nothing_but_its_id()
    {
        var reservation = Guid.Parse("50000000-0000-0000-0000-000000000005");
        var first = BookingEmailEvents.ReservationConfirmedEvent(PropertyId, reservation);
        var again = BookingEmailEvents.ReservationConfirmedEvent(PropertyId, reservation);
        var other = BookingEmailEvents.ReservationConfirmedEvent(PropertyId, Guid.NewGuid());

        Assert.Equal(first, again); // the same fact is the same event: a replayed enqueue is a no-op
        Assert.NotEqual(first.EventId, other.EventId);
        Assert.NotEqual(reservation, first.EventId); // not the reservation id itself: another event type about it gets another id by the same rule
        Assert.NotEqual(first.EventId, BookingEmailEvents.EventId("ReservationCancelled", reservation));
        Assert.Equal(("ReservationConfirmed", 1, PropertyId), (first.EventType, first.SchemaVersion, first.PropertyId));
        Assert.Equal($$"""{"reservationId":"{{reservation}}"}""", first.PayloadJson);
        Assert.Equal(5, first.EventId.ToString("D")[14] - '0'); // UUID version 5
        Assert.Contains(first.EventId.ToString("D")[19], "89ab"); // RFC 4122 variant
    }

    private sealed class RecordingStore : IDirectReservationCreationStore
    {
        public PreparedDirectReservationRequest? Request { get; private set; }

        public Task<DirectReservationCreationResult> CreateAsync(PreparedDirectReservationRequest request, CancellationToken cancellationToken)
        {
            Request = request;
            return Task.FromResult(DirectReservationCreationResult.Invalid("recorded"));
        }
    }

    private sealed class StubCurrentCustomer(bool isAuthenticated, Guid? customerAccountId) : ICurrentCustomer
    {
        public bool IsAuthenticated => isAuthenticated;

        public Guid? CustomerAccountId => customerAccountId;

        public string? Email => null;
    }
}
