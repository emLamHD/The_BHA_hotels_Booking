using TheBha.Application.Bookings;
using TheBha.Application.Customers;
using TheBha.Domain.Bookings;

namespace TheBha.UnitTests;

public sealed class ReservationCancellationTests
{
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000012");
    private static readonly Guid ReservationId = Guid.Parse("50000000-0000-0000-0000-000000000012");

    [Fact]
    public async Task Authenticated_request_uses_current_customer_and_no_guest_hash()
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(true, CustomerId), store);

        await service.CancelAsync(
            ReservationId,
            null,
            new CancelReservationRequest("Guest requested cancellation."),
            CancellationToken.None);

        Assert.Equal(ReservationId, store.ReservationId);
        Assert.Equal(CustomerId, store.CustomerAccountId);
        Assert.Null(store.GuestAccessTokenHash);
        Assert.Equal("Guest requested cancellation.", store.Reason);
    }

    [Fact]
    public async Task Guest_request_with_valid_token_computes_hash_and_no_customer_id()
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(false, null), store);
        var token = new CryptographicGuestAccessTokenGenerator().Generate();

        await service.CancelAsync(
            ReservationId,
            token,
            new CancelReservationRequest("Reason"),
            CancellationToken.None);

        Assert.Null(store.CustomerAccountId);
        Assert.Equal(BookingHoldRequestSecurity.Sha256Hex(token), store.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Missing_credential_is_unauthorized_before_store_work()
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(false, null), store);

        var result = await service.CancelAsync(
            ReservationId,
            null,
            new CancelReservationRequest("Reason"),
            CancellationToken.None);

        Assert.Equal(ReservationCancellationStatus.Unauthorized, result.Status);
        Assert.False(store.Called);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-valid-token")]
    [InlineData("has spaces")]
    public async Task Malformed_guest_token_is_unauthorized_before_store_work(string token)
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(false, null), store);

        var result = await service.CancelAsync(
            ReservationId,
            token,
            new CancelReservationRequest("Reason"),
            CancellationToken.None);

        Assert.Equal(ReservationCancellationStatus.Unauthorized, result.Status);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task Authenticated_caller_with_valid_guest_token_forwards_both_credentials()
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(true, CustomerId), store);
        var token = new CryptographicGuestAccessTokenGenerator().Generate();

        await service.CancelAsync(
            ReservationId,
            token,
            new CancelReservationRequest("Reason"),
            CancellationToken.None);

        Assert.Equal(CustomerId, store.CustomerAccountId);
        Assert.Equal(BookingHoldRequestSecurity.Sha256Hex(token), store.GuestAccessTokenHash);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Missing_or_blank_reason_is_invalid_before_credential_resolution(string? reason)
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(false, null), store);

        var result = await service.CancelAsync(
            ReservationId,
            null,
            new CancelReservationRequest(reason),
            CancellationToken.None);

        Assert.Equal(ReservationCancellationStatus.Invalid, result.Status);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task Reason_over_limit_is_invalid()
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(true, CustomerId), store);
        var overLimit = new string('x', BookingFieldLimits.CancellationReason + 1);

        var result = await service.CancelAsync(
            ReservationId,
            null,
            new CancelReservationRequest(overLimit),
            CancellationToken.None);

        Assert.Equal(ReservationCancellationStatus.Invalid, result.Status);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task Reason_at_exact_limit_is_valid()
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(true, CustomerId), store);
        var atLimit = new string('x', BookingFieldLimits.CancellationReason);

        await service.CancelAsync(
            ReservationId,
            null,
            new CancelReservationRequest(atLimit),
            CancellationToken.None);

        Assert.True(store.Called);
        Assert.Equal(atLimit, store.Reason);
    }

    [Fact]
    public async Task Reason_is_trimmed_before_reaching_the_store()
    {
        var store = new RecordingStore();
        var service = new ReservationCancellation(new StubCurrentCustomer(true, CustomerId), store);

        await service.CancelAsync(
            ReservationId,
            null,
            new CancelReservationRequest("  Trimmed reason.  "),
            CancellationToken.None);

        Assert.Equal("Trimmed reason.", store.Reason);
    }

    [Fact]
    public void Response_contract_exposes_no_ownership_or_credential_material()
    {
        var names = typeof(ReservationDto).GetProperties()
            .Select(property => property.Name)
            .ToArray();
        Assert.DoesNotContain(names, name =>
            name.Contains("Customer", StringComparison.Ordinal) ||
            name.Contains("Hash", StringComparison.Ordinal) ||
            name.Contains("Token", StringComparison.Ordinal));
    }

    private sealed class StubCurrentCustomer(
        bool isAuthenticated,
        Guid? customerAccountId) : ICurrentCustomer
    {
        public bool IsAuthenticated { get; } = isAuthenticated;
        public Guid? CustomerAccountId { get; } = customerAccountId;
        public string? Email => null;
    }

    private sealed class RecordingStore : IReservationCancellationStore
    {
        public bool Called { get; private set; }
        public Guid ReservationId { get; private set; }
        public Guid? CustomerAccountId { get; private set; }
        public string? GuestAccessTokenHash { get; private set; }
        public string? Reason { get; private set; }

        public Task<ReservationCancellationResult> CancelAsync(
            Guid reservationId,
            Guid? customerAccountId,
            string? guestAccessTokenHash,
            string reason,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Called = true;
            ReservationId = reservationId;
            CustomerAccountId = customerAccountId;
            GuestAccessTokenHash = guestAccessTokenHash;
            Reason = reason;
            return Task.FromResult(ReservationCancellationResult.Conflict("recorded"));
        }
    }
}
