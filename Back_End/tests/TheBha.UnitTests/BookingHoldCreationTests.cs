using System.Globalization;
using TheBha.Application.Bookings;
using TheBha.Application.Customers;

namespace TheBha.UnitTests;

public sealed class BookingHoldCreationTests
{
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid RoomTypeId = Guid.Parse("20000000-0000-0000-0000-000000000002");
    private static readonly Guid RatePlanId = Guid.Parse("30000000-0000-0000-0000-000000000003");
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000004");

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("bad\u0001key")]
    public void Rejects_missing_blank_and_control_character_idempotency_keys(string? key)
    {
        Assert.NotNull(BookingHoldRequestSecurity.ValidateIdempotencyKey(key));
    }

    [Fact]
    public void Rejects_idempotency_key_above_bounded_utf8_length()
    {
        var key = string.Concat(Enumerable.Repeat("é", 129));
        var error = BookingHoldRequestSecurity.ValidateIdempotencyKey(key);
        Assert.Contains("256 UTF-8 bytes", error);
    }

    [Fact]
    public void Idempotency_hash_is_deterministic_case_sensitive_and_lowercase_hex()
    {
        var first = BookingHoldRequestSecurity.Sha256Hex("Case-Sensitive-Key");
        Assert.Equal(first, BookingHoldRequestSecurity.Sha256Hex("Case-Sensitive-Key"));
        Assert.NotEqual(first, BookingHoldRequestSecurity.Sha256Hex("case-sensitive-key"));
        Assert.Matches("^[0-9a-f]{64}$", first);
    }

    [Fact]
    public void Fingerprint_is_versioned_culture_invariant_and_uses_semantic_contact_normalization()
    {
        var request = ValidRequest();
        var error = BookingHoldRequestSecurity.TryNormalizeRequest(
            request with
            {
                FullName = "  Guest Name ",
                Email = " guest@example.com ",
                Phone = " +84 123 4567 "
            },
            out var normalized);
        Assert.Null(error);

        var originalCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("ar-SA");
            var first = BookingHoldRequestSecurity.CreateFingerprint(normalized, null);
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("vi-VN");
            var second = BookingHoldRequestSecurity.CreateFingerprint(
                ValidRequest(),
                null);
            Assert.Equal(first, second);
            Assert.Matches("^[0-9a-f]{64}$", first);
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }

    [Fact]
    public void Fingerprint_changes_for_each_business_field_and_authenticated_owner()
    {
        var request = ValidRequest();
        var baseline = BookingHoldRequestSecurity.CreateFingerprint(request, null);
        var variants = new[]
        {
            request with { PropertyId = Guid.NewGuid() },
            request with { RoomTypeId = Guid.NewGuid() },
            request with { RatePlanId = Guid.NewGuid() },
            request with { CheckIn = request.CheckIn.AddDays(1) },
            request with { CheckOut = request.CheckOut.AddDays(1) },
            request with { Adults = 2 },
            request with { Children = 1 },
            request with { Rooms = 2 },
            request with { FullName = "Other Guest" },
            request with { Email = "other@example.com" },
            request with { Phone = "+84 765 4321" }
        };

        Assert.All(
            variants,
            variant => Assert.NotEqual(
                baseline,
                BookingHoldRequestSecurity.CreateFingerprint(variant, null)));
        Assert.NotEqual(
            baseline,
            BookingHoldRequestSecurity.CreateFingerprint(request, CustomerId));
        Assert.NotEqual(
            BookingHoldRequestSecurity.CreateFingerprint(request, CustomerId),
            BookingHoldRequestSecurity.CreateFingerprint(request, Guid.NewGuid()));
    }

    [Fact]
    public async Task Guest_request_is_normalized_and_prepared_with_one_time_token_hash()
    {
        var store = new RecordingStore();
        var token = new StubTokenGenerator("opaque-guest-token");
        var service = new BookingHoldCreation(
            new StubCurrentCustomer(false, null),
            store,
            token);

        await service.CreateAsync(
            "Key",
            ValidRequest() with { FullName = " Guest Name " },
            CancellationToken.None);

        Assert.NotNull(store.Request);
        Assert.Null(store.Request.CustomerAccountId);
        Assert.Equal("Guest Name", store.Request.FullName);
        Assert.Equal("opaque-guest-token", store.Request.GuestAccessToken);
        Assert.Equal(
            BookingHoldRequestSecurity.Sha256Hex("opaque-guest-token"),
            store.Request.GuestAccessTokenHash);
        Assert.Equal(1, token.Calls);
    }

    [Fact]
    public async Task Authenticated_request_uses_current_customer_and_generates_no_guest_token()
    {
        var store = new RecordingStore();
        var token = new StubTokenGenerator("must-not-be-used");
        var service = new BookingHoldCreation(
            new StubCurrentCustomer(true, CustomerId),
            store,
            token);

        await service.CreateAsync("Key", ValidRequest(), CancellationToken.None);

        Assert.Equal(CustomerId, store.Request!.CustomerAccountId);
        Assert.Null(store.Request.GuestAccessToken);
        Assert.Null(store.Request.GuestAccessTokenHash);
        Assert.Equal(0, token.Calls);
    }

    [Fact]
    public async Task Invalid_authenticated_principal_is_unauthorized_before_store_work()
    {
        var store = new RecordingStore();
        var service = new BookingHoldCreation(
            new StubCurrentCustomer(true, null),
            store,
            new StubTokenGenerator("unused"));

        var result = await service.CreateAsync(
            "Key",
            ValidRequest(),
            CancellationToken.None);

        Assert.Equal(BookingHoldCreationStatus.Unauthorized, result.Status);
        Assert.Null(store.Request);
    }

    [Theory]
    [InlineData("property")]
    [InlineData("room")]
    [InlineData("plan")]
    [InlineData("range")]
    [InlineData("stay")]
    [InlineData("adults")]
    [InlineData("children")]
    [InlineData("rooms")]
    [InlineData("room-limit")]
    [InlineData("name")]
    [InlineData("email")]
    [InlineData("phone")]
    public async Task Invalid_request_is_rejected_before_store_work(string invalid)
    {
        var request = ValidRequest();
        request = invalid switch
        {
            "property" => request with { PropertyId = Guid.Empty },
            "room" => request with { RoomTypeId = Guid.Empty },
            "plan" => request with { RatePlanId = Guid.Empty },
            "range" => request with { CheckOut = request.CheckIn },
            "stay" => request with { CheckOut = request.CheckIn.AddDays(31) },
            "adults" => request with { Adults = 0 },
            "children" => request with { Children = -1 },
            "rooms" => request with { Rooms = 0 },
            "room-limit" => request with { Rooms = 11 },
            "name" => request with { FullName = " " },
            "email" => request with { Email = "invalid" },
            _ => request with { Phone = "letters" }
        };
        var store = new RecordingStore();
        var result = await new BookingHoldCreation(
                new StubCurrentCustomer(false, null),
                store,
                new StubTokenGenerator("unused"))
            .CreateAsync("Key", request, CancellationToken.None);

        Assert.Equal(BookingHoldCreationStatus.Invalid, result.Status);
        Assert.Null(store.Request);
    }

    [Fact]
    public void Guest_token_has_256_bits_of_entropy_encoding_and_expected_hash_shape()
    {
        var token = new CryptographicGuestAccessTokenGenerator().Generate();
        var padded = token.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight((padded.Length + 3) / 4 * 4, '=');

        Assert.Equal(32, Convert.FromBase64String(padded).Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", token);
        Assert.Matches("^[0-9a-f]{64}$", BookingHoldRequestSecurity.Sha256Hex(token));
    }

    [Fact]
    public void Public_response_contract_exposes_no_ownership_hash_or_inventory_internals()
    {
        var names = typeof(BookingHoldDto).GetProperties()
            .Select(property => property.Name)
            .ToArray();
        Assert.DoesNotContain(names, name =>
            name.Contains("Customer", StringComparison.Ordinal) ||
            name.Contains("Hash", StringComparison.Ordinal) ||
            name.Contains("Fingerprint", StringComparison.Ordinal) ||
            name.Contains("Physical", StringComparison.Ordinal) ||
            name.Contains("Inventory", StringComparison.Ordinal));
    }

    private static CreateBookingHoldRequest ValidRequest() =>
        new(
            PropertyId,
            RoomTypeId,
            RatePlanId,
            new DateOnly(2026, 8, 10),
            new DateOnly(2026, 8, 12),
            1,
            0,
            1,
            "Guest Name",
            "guest@example.com",
            "+84 123 4567");

    private sealed class StubCurrentCustomer(
        bool isAuthenticated,
        Guid? customerAccountId) : ICurrentCustomer
    {
        public bool IsAuthenticated { get; } = isAuthenticated;
        public Guid? CustomerAccountId { get; } = customerAccountId;
        public string? Email => null;
    }

    private sealed class StubTokenGenerator(string token) : IGuestAccessTokenGenerator
    {
        public int Calls { get; private set; }
        public string Generate()
        {
            Calls++;
            return token;
        }
    }

    private sealed class RecordingStore : IBookingHoldCreationStore
    {
        public PreparedBookingHoldRequest? Request { get; private set; }

        public Task<BookingHoldCreationResult> CreateAsync(
            PreparedBookingHoldRequest request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(
                BookingHoldCreationResult.Conflict("recorded"));
        }
    }
}
