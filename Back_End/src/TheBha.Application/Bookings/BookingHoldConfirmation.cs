using TheBha.Application.Customers;
using TheBha.Domain.Bookings;

namespace TheBha.Application.Bookings;

public sealed record ReservationNightDto(
    DateOnly StayDate,
    int Rooms,
    decimal UnitAmount,
    decimal NightTotal);

public sealed record ReservationDto(
    Guid ReservationId,
    string ConfirmationNumber,
    ReservationStatus Status,
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    string FullName,
    string Email,
    string Phone,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string CurrencyCode,
    decimal TotalAmount,
    DateTimeOffset ConfirmedAtUtc,
    DateTimeOffset? CancelledAtUtc,
    string? CancellationReason,
    IReadOnlyList<ReservationNightDto> Nights);

public enum BookingHoldConfirmationStatus
{
    Confirmed,
    Replayed,
    Unauthorized,
    NotFound,
    Conflict
}

public sealed record BookingHoldConfirmationResult(
    BookingHoldConfirmationStatus Status,
    ReservationDto? Reservation,
    string? Error)
{
    public static BookingHoldConfirmationResult Confirmed(ReservationDto reservation) =>
        new(BookingHoldConfirmationStatus.Confirmed, reservation, null);

    public static BookingHoldConfirmationResult Replayed(ReservationDto reservation) =>
        new(BookingHoldConfirmationStatus.Replayed, reservation, null);

    public static BookingHoldConfirmationResult Unauthorized(string error) =>
        new(BookingHoldConfirmationStatus.Unauthorized, null, error);

    public static BookingHoldConfirmationResult NotFound(string error) =>
        new(BookingHoldConfirmationStatus.NotFound, null, error);

    public static BookingHoldConfirmationResult Conflict(string error) =>
        new(BookingHoldConfirmationStatus.Conflict, null, error);
}

public interface IBookingHoldConfirmationStore
{
    Task<BookingHoldConfirmationResult> ConfirmAsync(
        Guid holdId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken);
}

public interface IBookingHoldConfirmation
{
    Task<BookingHoldConfirmationResult> ConfirmAsync(
        Guid holdId,
        string? guestAccessToken,
        CancellationToken cancellationToken);
}

public sealed class BookingHoldConfirmation(
    ICurrentCustomer currentCustomer,
    IBookingHoldConfirmationStore store) : IBookingHoldConfirmation
{
    public async Task<BookingHoldConfirmationResult> ConfirmAsync(
        Guid holdId,
        string? guestAccessToken,
        CancellationToken cancellationToken)
    {
        Guid? customerAccountId = currentCustomer.IsAuthenticated
            ? currentCustomer.CustomerAccountId
            : null;
        if (currentCustomer.IsAuthenticated &&
            (customerAccountId is null || customerAccountId == Guid.Empty))
        {
            return BookingHoldConfirmationResult.Unauthorized(
                "A valid customer session is required.");
        }

        string? guestAccessTokenHash = null;
        if (!string.IsNullOrEmpty(guestAccessToken))
        {
            if (!BookingAccessTokenValidator.TryHash(guestAccessToken, out var hash))
            {
                return BookingHoldConfirmationResult.Unauthorized(
                    "The supplied booking access token is malformed.");
            }

            guestAccessTokenHash = hash;
        }

        if (customerAccountId is null && guestAccessTokenHash is null)
        {
            return BookingHoldConfirmationResult.Unauthorized(
                "A customer session or booking access token is required.");
        }

        return await store.ConfirmAsync(
            holdId,
            customerAccountId,
            guestAccessTokenHash,
            cancellationToken);
    }
}
