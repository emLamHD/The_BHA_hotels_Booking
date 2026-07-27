using TheBha.Application.Bookings;
using TheBha.Application.Customers;

namespace TheBha.UnitTests;

public sealed class BookingHoldCancellationTests
{
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000011");
    private static readonly Guid HoldId = Guid.Parse("50000000-0000-0000-0000-000000000011");

    [Fact]
    public async Task Authenticated_request_uses_current_customer_and_no_guest_hash()
    {
        var store = new RecordingStore();
        var service = new BookingHoldCancellation(new StubCurrentCustomer(true, CustomerId), store);

        await service.CancelAsync(HoldId, null, CancellationToken.None);

        Assert.Equal(HoldId, store.HoldId);
        Assert.Equal(CustomerId, store.CustomerAccountId);
        Assert.Null(store.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Guest_request_with_valid_token_computes_hash_and_no_customer_id()
    {
        var store = new RecordingStore();
        var service = new BookingHoldCancellation(new StubCurrentCustomer(false, null), store);
        var token = new CryptographicGuestAccessTokenGenerator().Generate();

        await service.CancelAsync(HoldId, token, CancellationToken.None);

        Assert.Null(store.CustomerAccountId);
        Assert.Equal(BookingHoldRequestSecurity.Sha256Hex(token), store.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Missing_credential_is_unauthorized_before_store_work()
    {
        var store = new RecordingStore();
        var service = new BookingHoldCancellation(new StubCurrentCustomer(false, null), store);

        var result = await service.CancelAsync(HoldId, null, CancellationToken.None);

        Assert.Equal(BookingHoldCancellationStatus.Unauthorized, result.Status);
        Assert.False(store.Called);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-valid-token")]
    [InlineData("has spaces")]
    public async Task Malformed_guest_token_is_unauthorized_before_store_work(string token)
    {
        var store = new RecordingStore();
        var service = new BookingHoldCancellation(new StubCurrentCustomer(false, null), store);

        var result = await service.CancelAsync(HoldId, token, CancellationToken.None);

        Assert.Equal(BookingHoldCancellationStatus.Unauthorized, result.Status);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task Invalid_authenticated_principal_is_unauthorized_before_store_work()
    {
        var store = new RecordingStore();
        var service = new BookingHoldCancellation(new StubCurrentCustomer(true, null), store);

        var result = await service.CancelAsync(HoldId, null, CancellationToken.None);

        Assert.Equal(BookingHoldCancellationStatus.Unauthorized, result.Status);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task Authenticated_caller_with_valid_guest_token_forwards_both_credentials()
    {
        var store = new RecordingStore();
        var service = new BookingHoldCancellation(new StubCurrentCustomer(true, CustomerId), store);
        var token = new CryptographicGuestAccessTokenGenerator().Generate();

        await service.CancelAsync(HoldId, token, CancellationToken.None);

        Assert.Equal(CustomerId, store.CustomerAccountId);
        Assert.Equal(BookingHoldRequestSecurity.Sha256Hex(token), store.GuestAccessTokenHash);
    }

    private sealed class StubCurrentCustomer(
        bool isAuthenticated,
        Guid? customerAccountId) : ICurrentCustomer
    {
        public bool IsAuthenticated { get; } = isAuthenticated;
        public Guid? CustomerAccountId { get; } = customerAccountId;
        public string? Email => null;
    }

    private sealed class RecordingStore : IBookingHoldCancellationStore
    {
        public bool Called { get; private set; }
        public Guid HoldId { get; private set; }
        public Guid? CustomerAccountId { get; private set; }
        public string? GuestAccessTokenHash { get; private set; }

        public Task<BookingHoldCancellationResult> CancelAsync(
            Guid holdId,
            Guid? customerAccountId,
            string? guestAccessTokenHash,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Called = true;
            HoldId = holdId;
            CustomerAccountId = customerAccountId;
            GuestAccessTokenHash = guestAccessTokenHash;
            return Task.FromResult(BookingHoldCancellationResult.Conflict("recorded"));
        }
    }
}
