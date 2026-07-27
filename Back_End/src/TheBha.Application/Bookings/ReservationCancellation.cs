using TheBha.Application.Customers;
using TheBha.Domain.Bookings;

namespace TheBha.Application.Bookings;

public sealed record CancelReservationRequest(string? Reason);

public enum ReservationCancellationStatus
{
    Cancelled,
    Replayed,
    Invalid,
    Unauthorized,
    NotFound,
    Conflict
}

public sealed record ReservationCancellationResult(
    ReservationCancellationStatus Status,
    ReservationDto? Reservation,
    string? Error)
{
    public static ReservationCancellationResult Cancelled(ReservationDto reservation) =>
        new(ReservationCancellationStatus.Cancelled, reservation, null);

    public static ReservationCancellationResult Replayed(ReservationDto reservation) =>
        new(ReservationCancellationStatus.Replayed, reservation, null);

    public static ReservationCancellationResult Invalid(string error) =>
        new(ReservationCancellationStatus.Invalid, null, error);

    public static ReservationCancellationResult Unauthorized(string error) =>
        new(ReservationCancellationStatus.Unauthorized, null, error);

    public static ReservationCancellationResult NotFound(string error) =>
        new(ReservationCancellationStatus.NotFound, null, error);

    public static ReservationCancellationResult Conflict(string error) =>
        new(ReservationCancellationStatus.Conflict, null, error);
}

public interface IReservationCancellationStore
{
    Task<ReservationCancellationResult> CancelAsync(
        Guid reservationId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        string reason,
        CancellationToken cancellationToken);
}

public interface IReservationCancellation
{
    Task<ReservationCancellationResult> CancelAsync(
        Guid reservationId,
        string? guestAccessToken,
        CancelReservationRequest request,
        CancellationToken cancellationToken);
}

public sealed class ReservationCancellation(
    ICurrentCustomer currentCustomer,
    IReservationCancellationStore store) : IReservationCancellation
{
    public async Task<ReservationCancellationResult> CancelAsync(
        Guid reservationId,
        string? guestAccessToken,
        CancelReservationRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var reason = request.Reason?.Trim();
        if (string.IsNullOrEmpty(reason))
        {
            return ReservationCancellationResult.Invalid("reason is required.");
        }

        if (reason.Length > BookingFieldLimits.CancellationReason)
        {
            return ReservationCancellationResult.Invalid(
                $"reason cannot exceed {BookingFieldLimits.CancellationReason} characters.");
        }

        if (!BookingCredentialResolver.TryResolve(
                currentCustomer,
                guestAccessToken,
                out var customerAccountId,
                out var guestAccessTokenHash,
                out var error))
        {
            return ReservationCancellationResult.Unauthorized(error!);
        }

        return await store.CancelAsync(
            reservationId,
            customerAccountId,
            guestAccessTokenHash,
            reason,
            cancellationToken);
    }
}
