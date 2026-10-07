using TheBha.Application.Customers;

namespace TheBha.Application.Bookings;

public enum BookingHoldCancellationStatus
{
    Cancelled,
    Replayed,
    Unauthorized,
    NotFound,
    Conflict
}

public sealed record BookingHoldCancellationResult(
    BookingHoldCancellationStatus Status,
    BookingHoldDto? Hold,
    string? Error)
{
    public static BookingHoldCancellationResult Cancelled(BookingHoldDto hold) =>
        new(BookingHoldCancellationStatus.Cancelled, hold, null);

    public static BookingHoldCancellationResult Replayed(BookingHoldDto hold) =>
        new(BookingHoldCancellationStatus.Replayed, hold, null);

    public static BookingHoldCancellationResult Unauthorized(string error) =>
        new(BookingHoldCancellationStatus.Unauthorized, null, error);

    public static BookingHoldCancellationResult NotFound(string error) =>
        new(BookingHoldCancellationStatus.NotFound, null, error);

    public static BookingHoldCancellationResult Conflict(string error) =>
        new(BookingHoldCancellationStatus.Conflict, null, error);
}

public interface IBookingHoldCancellationStore
{
    Task<BookingHoldCancellationResult> CancelAsync(
        Guid holdId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken);
}

public interface IBookingHoldCancellation
{
    Task<BookingHoldCancellationResult> CancelAsync(
        Guid holdId,
        string? guestAccessToken,
        CancellationToken cancellationToken);
}

public sealed class BookingHoldCancellation(
    ICurrentCustomer currentCustomer,
    IBookingHoldCancellationStore store) : IBookingHoldCancellation
{
    public async Task<BookingHoldCancellationResult> CancelAsync(
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
            return BookingHoldCancellationResult.Unauthorized(error!);
        }

        return await store.CancelAsync(
            holdId,
            customerAccountId,
            guestAccessTokenHash,
            cancellationToken);
    }
}
