using TheBha.Application.Bookings;
using TheBha.Application.Customers;

namespace TheBha.UnitTests;

public sealed class ReservationReadTests
{
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000004");
    private static readonly Guid ReservationId = Guid.Parse("60000000-0000-0000-0000-000000000006");

    [Fact]
    public async Task Authenticated_request_uses_current_customer_and_no_guest_hash()
    {
        var store = new RecordingStore();
        var service = new ReservationRead(
            new StubCurrentCustomer(true, CustomerId),
            store);

        await service.GetAsync(ReservationId, null, CancellationToken.None);

        Assert.Equal(ReservationId, store.ReservationId);
        Assert.Equal(CustomerId, store.CustomerAccountId);
        Assert.Null(store.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Guest_request_with_valid_token_computes_hash()
    {
        var store = new RecordingStore();
        var service = new ReservationRead(
            new StubCurrentCustomer(false, null),
            store);
        var token = new CryptographicGuestAccessTokenGenerator().Generate();

        await service.GetAsync(ReservationId, token, CancellationToken.None);

        Assert.Null(store.CustomerAccountId);
        Assert.Equal(BookingHoldRequestSecurity.Sha256Hex(token), store.GuestAccessTokenHash);
    }

    [Fact]
    public async Task Missing_credential_is_unauthorized_before_store_work()
    {
        var store = new RecordingStore();
        var service = new ReservationRead(
            new StubCurrentCustomer(false, null),
            store);

        var result = await service.GetAsync(ReservationId, null, CancellationToken.None);

        Assert.Equal(ReservationReadStatus.Unauthorized, result.Status);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task Malformed_guest_token_is_unauthorized_before_store_work()
    {
        var store = new RecordingStore();
        var service = new ReservationRead(
            new StubCurrentCustomer(false, null),
            store);

        var result = await service.GetAsync(
            ReservationId,
            "not-a-valid-token",
            CancellationToken.None);

        Assert.Equal(ReservationReadStatus.Unauthorized, result.Status);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task Authenticated_caller_with_valid_guest_token_forwards_both_credentials()
    {
        var store = new RecordingStore();
        var service = new ReservationRead(
            new StubCurrentCustomer(true, CustomerId),
            store);
        var token = new CryptographicGuestAccessTokenGenerator().Generate();

        await service.GetAsync(ReservationId, token, CancellationToken.None);

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

    private sealed class RecordingStore : IReservationReadStore
    {
        public bool Called { get; private set; }
        public Guid ReservationId { get; private set; }
        public Guid? CustomerAccountId { get; private set; }
        public string? GuestAccessTokenHash { get; private set; }

        public Task<ReservationReadResult> GetAsync(
            Guid reservationId,
            Guid? customerAccountId,
            string? guestAccessTokenHash,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Called = true;
            ReservationId = reservationId;
            CustomerAccountId = customerAccountId;
            GuestAccessTokenHash = guestAccessTokenHash;
            return Task.FromResult(
                ReservationReadResult.NotFound("recorded"));
        }
    }
}
