using TheBha.Application.Customers;

namespace TheBha.Application.Bookings;

public enum BookingHoldReadStatus
{
    Found,
    Unauthorized,
    NotFound
}

public sealed record BookingHoldReadResult(
    BookingHoldReadStatus Status,
    BookingHoldDto? Hold,
    string? Error)
{
    public static BookingHoldReadResult Found(BookingHoldDto hold) =>
        new(BookingHoldReadStatus.Found, hold, null);

    public static BookingHoldReadResult Unauthorized(string error) =>
        new(BookingHoldReadStatus.Unauthorized, null, error);

    public static BookingHoldReadResult NotFound(string error) =>
        new(BookingHoldReadStatus.NotFound, null, error);
}

public interface IBookingHoldReadStore
{
    Task<BookingHoldReadResult> GetAsync(
        Guid holdId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken);
}

public interface IBookingHoldRead
{
    Task<BookingHoldReadResult> GetAsync(
        Guid holdId,
        string? guestAccessToken,
        CancellationToken cancellationToken);
}

public sealed class BookingHoldRead(
    ICurrentCustomer currentCustomer,
    IBookingHoldReadStore store) : IBookingHoldRead
{
    public async Task<BookingHoldReadResult> GetAsync(
        Guid holdId,
        string? guestAccessToken,
        CancellationToken cancellationToken)
    {
        if (!BookingCredentialResolver.TryResolve(
                currentCustomer,
                guestAccessToken,
                out var customerAccountId,
                out var guestAccessTokenHash,
                out var error))
        {
            return BookingHoldReadResult.Unauthorized(error!);
        }

        return await store.GetAsync(
            holdId,
            customerAccountId,
            guestAccessTokenHash,
            cancellationToken);
    }
}
