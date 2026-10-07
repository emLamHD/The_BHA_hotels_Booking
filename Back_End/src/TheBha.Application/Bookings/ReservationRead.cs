using TheBha.Application.Customers;

namespace TheBha.Application.Bookings;

public enum ReservationReadStatus
{
    Found,
    Unauthorized,
    NotFound
}

public sealed record ReservationReadResult(
    ReservationReadStatus Status,
    ReservationDto? Reservation,
    string? Error)
{
    public static ReservationReadResult Found(ReservationDto reservation) =>
        new(ReservationReadStatus.Found, reservation, null);

    public static ReservationReadResult Unauthorized(string error) =>
        new(ReservationReadStatus.Unauthorized, null, error);

    public static ReservationReadResult NotFound(string error) =>
        new(ReservationReadStatus.NotFound, null, error);
}

public interface IReservationReadStore
{
    Task<ReservationReadResult> GetAsync(
        Guid reservationId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken);
}

public interface IReservationRead
{
    Task<ReservationReadResult> GetAsync(
        Guid reservationId,
        string? guestAccessToken,
        CancellationToken cancellationToken);
}

public sealed class ReservationRead(
    ICurrentCustomer currentCustomer,
    IReservationReadStore store) : IReservationRead
{
    public async Task<ReservationReadResult> GetAsync(
        Guid reservationId,
        string? guestAccessToken,
        CancellationToken cancellationToken)
    {
        Guid? customerAccountId = currentCustomer.IsAuthenticated
            ? currentCustomer.CustomerAccountId
            : null;
        if (currentCustomer.IsAuthenticated &&
            (customerAccountId is null || customerAccountId == Guid.Empty))
        {
            return ReservationReadResult.Unauthorized(
                "A valid customer session is required.");
        }

        string? guestAccessTokenHash = null;
        if (!string.IsNullOrEmpty(guestAccessToken))
        {
            if (!BookingAccessTokenValidator.TryHash(guestAccessToken, out var hash))
            {
                return ReservationReadResult.Unauthorized(
                    "The supplied booking access token is malformed.");
            }

            guestAccessTokenHash = hash;
        }

        if (customerAccountId is null && guestAccessTokenHash is null)
        {
            return ReservationReadResult.Unauthorized(
                "A customer session or booking access token is required.");
        }

        return await store.GetAsync(
            reservationId,
            customerAccountId,
            guestAccessTokenHash,
            cancellationToken);
    }
}
