using TheBha.Application.Customers;
using TheBha.Application.Promotions;
using TheBha.Domain.Bookings;

namespace TheBha.Application.Bookings;

/// <summary>The only payment method a Direct Reservation supports (BHA-CHECKOUT-001-PR05): nothing is collected at booking, the whole room charge is due at the property.</summary>
public static class DirectReservationPaymentMethods
{
    public const string PayAtProperty = "PayAtProperty";
}

/// <summary>
/// What the guest sends to book directly. Both expected values are required: they are the price the guest saw and confirmed, never an amount the server takes on trust. There is deliberately no field for a
/// deposit, a fee or an amount to collect.
/// </summary>
public sealed record CreateDirectReservationRequest(
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string? FullName,
    string? Email,
    string? Phone,
    decimal? ExpectedTotalAmount,
    string? ExpectedCurrencyCode,
    string? PaymentMethod);

/// <summary>
/// The Direct create/replay answer: everything <see cref="ReservationDto"/> says (same names and values), plus how it is paid and where the folio stands. The extra fields exist only on this route's answer; the
/// read and cancel routes keep their shape. <see cref="LedgerState"/> is <c>NotRecorded</c> (and the amounts null) only if a Reservation has no room charge, which a Direct one made through this route always has.
/// </summary>
public sealed record DirectReservationDto(
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
    IReadOnlyList<ReservationNightDto> Nights,
    decimal? ListTotalAmount,
    decimal? DiscountTotalAmount,
    AppliedPromotionDto? AppliedPromotion,
    string PaymentMethod,
    LedgerState LedgerState,
    long? ReceivableAmount,
    long? CollectedAmount,
    long? BalanceDueAmount)
{
    public static DirectReservationDto From(ReservationDto reservation, ReservationBalance balance) => new(
        reservation.ReservationId, reservation.ConfirmationNumber, reservation.Status, reservation.PropertyId, reservation.RoomTypeId, reservation.RatePlanId,
        reservation.FullName, reservation.Email, reservation.Phone, reservation.CheckIn, reservation.CheckOut, reservation.Adults, reservation.Children, reservation.Rooms,
        reservation.CurrencyCode, reservation.TotalAmount, reservation.ConfirmedAtUtc, reservation.CancelledAtUtc, reservation.CancellationReason, reservation.Nights,
        reservation.ListTotalAmount, reservation.DiscountTotalAmount, reservation.AppliedPromotion,
        DirectReservationPaymentMethods.PayAtProperty, balance.State, balance.ReceivableAmount, balance.CollectedAmount, balance.BalanceDueAmount);
}

public enum DirectReservationCreationStatus
{
    Created,
    Replayed,
    Invalid,

    /// <summary>The customer session does not name a customer account.</summary>
    Unauthorized,

    /// <summary>A guest request without a usable booking access token (missing or malformed).</summary>
    CredentialInvalid,
    NotFound,
    Conflict,
    PriceChanged,

    /// <summary>Booking:AcceptingNewReservations is off.</summary>
    Closed,

    /// <summary>The Property is not in Booking:DirectCheckout:PropertyIds.</summary>
    DirectUnavailable
}

public sealed record DirectReservationCreationResult(
    DirectReservationCreationStatus Status,
    DirectReservationDto? Reservation,
    string? Error,
    PriceQuoteDto? Quote = null)
{
    public static DirectReservationCreationResult Created(DirectReservationDto reservation) => new(DirectReservationCreationStatus.Created, reservation, null);

    public static DirectReservationCreationResult Replayed(DirectReservationDto reservation) => new(DirectReservationCreationStatus.Replayed, reservation, null);

    public static DirectReservationCreationResult Invalid(string error) => new(DirectReservationCreationStatus.Invalid, null, error);

    public static DirectReservationCreationResult Unauthorized(string error) => new(DirectReservationCreationStatus.Unauthorized, null, error);

    public static DirectReservationCreationResult CredentialInvalid(string error) => new(DirectReservationCreationStatus.CredentialInvalid, null, error);

    public static DirectReservationCreationResult NotFound(string error) => new(DirectReservationCreationStatus.NotFound, null, error);

    public static DirectReservationCreationResult Conflict(string error) => new(DirectReservationCreationStatus.Conflict, null, error);

    public static DirectReservationCreationResult PriceChanged(PriceQuoteDto quote) =>
        new(DirectReservationCreationStatus.PriceChanged, null, "The price changed since it was shown.", quote);

    public static DirectReservationCreationResult Closed(string error) => new(DirectReservationCreationStatus.Closed, null, error);

    public static DirectReservationCreationResult DirectUnavailable(string error) => new(DirectReservationCreationStatus.DirectUnavailable, null, error);
}

/// <summary>
/// A normalized, owner-resolved request. Exactly one of <see cref="CustomerAccountId"/> and <see cref="GuestAccessTokenHash"/> is set. <see cref="ScopeHash"/> and <see cref="KeyHash"/> locate the request in the
/// idempotency table; <see cref="RequestFingerprint"/> says whether a repeat is the same request.
/// </summary>
public sealed record PreparedDirectReservationRequest(
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string FullName,
    string Email,
    string Phone,
    Guid? CustomerAccountId,
    string? GuestAccessTokenHash,
    string ScopeHash,
    string KeyHash,
    string RequestFingerprint,
    decimal ExpectedTotalAmount,
    string ExpectedCurrencyCode);

public interface IDirectReservationCreationStore
{
    Task<DirectReservationCreationResult> CreateAsync(PreparedDirectReservationRequest request, CancellationToken cancellationToken);
}

public interface IDirectReservationCreation
{
    Task<DirectReservationCreationResult> CreateAsync(
        string? idempotencyKey,
        string? bookingAccessToken,
        CreateDirectReservationRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// BHA-CHECKOUT-001-PR05. Validates and normalizes the request with the rules the Hold uses, resolves who the owner is, and hands the store a request that already carries everything needed to find a replay.
/// <list type="bullet">
/// <item>A valid customer session owns the reservation (its CustomerAccountId); sending a guest token as well is refused, never merged.</item>
/// <item>Without a session, the guest owns it by an access token the client made itself (32 random bytes, base64url) and sends in <c>X-Booking-Access-Token</c>; only its hash is kept. The server never issues or returns one.</item>
/// <item>The idempotency scope is the Property plus that owner, so two guests with different tokens never share a key space.</item>
/// </list>
/// </summary>
public sealed class DirectReservationCreation(
    ICurrentCustomer currentCustomer,
    IDirectReservationCreationStore store) : IDirectReservationCreation
{
    public async Task<DirectReservationCreationResult> CreateAsync(
        string? idempotencyKey,
        string? bookingAccessToken,
        CreateDirectReservationRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var keyError = BookingHoldRequestSecurity.ValidateIdempotencyKey(idempotencyKey);
        if (keyError is not null)
        {
            return DirectReservationCreationResult.Invalid(keyError);
        }

        if (!string.Equals(request.PaymentMethod, DirectReservationPaymentMethods.PayAtProperty, StringComparison.Ordinal))
        {
            return DirectReservationCreationResult.Invalid($"paymentMethod must be {DirectReservationPaymentMethods.PayAtProperty}.");
        }

        if (request.ExpectedTotalAmount is null || request.ExpectedCurrencyCode is null)
        {
            return DirectReservationCreationResult.Invalid("expectedTotalAmount and expectedCurrencyCode are required: they are the price the guest confirmed.");
        }

        var requestError = BookingHoldRequestSecurity.TryNormalizeRequest(
            new CreateBookingHoldRequest(
                request.PropertyId, request.RoomTypeId, request.RatePlanId, request.CheckIn, request.CheckOut, request.Adults, request.Children, request.Rooms,
                request.FullName, request.Email, request.Phone, request.ExpectedTotalAmount, request.ExpectedCurrencyCode),
            out var normalized);
        if (requestError is not null)
        {
            return DirectReservationCreationResult.Invalid(requestError);
        }

        Guid? customerAccountId = null;
        string? guestAccessTokenHash = null;
        string ownerScope;
        if (currentCustomer.IsAuthenticated)
        {
            if (currentCustomer.CustomerAccountId is not { } resolvedId || resolvedId == Guid.Empty)
            {
                return DirectReservationCreationResult.Unauthorized("A valid customer session is required.");
            }

            if (!string.IsNullOrEmpty(bookingAccessToken))
            {
                return DirectReservationCreationResult.Invalid("A booking access token cannot be sent together with a customer session.");
            }

            customerAccountId = resolvedId;
            ownerScope = $"customer:{resolvedId:D}";
        }
        else
        {
            if (string.IsNullOrEmpty(bookingAccessToken))
            {
                return DirectReservationCreationResult.CredentialInvalid("A customer session or a booking access token is required.");
            }

            if (!BookingAccessTokenValidator.TryHash(bookingAccessToken, out var tokenHash))
            {
                return DirectReservationCreationResult.CredentialInvalid("The supplied booking access token is malformed.");
            }

            guestAccessTokenHash = tokenHash;
            ownerScope = $"guest:{tokenHash}";
        }

        return await store.CreateAsync(
            new PreparedDirectReservationRequest(
                normalized.PropertyId, normalized.RoomTypeId, normalized.RatePlanId, normalized.CheckIn, normalized.CheckOut, normalized.Adults, normalized.Children, normalized.Rooms,
                normalized.FullName!, normalized.Email!, normalized.Phone!, customerAccountId, guestAccessTokenHash,
                BookingHoldRequestSecurity.Sha256Hex($"direct:v1:{normalized.PropertyId:D}:{ownerScope}"),
                BookingHoldRequestSecurity.Sha256Hex($"direct:v1:key:{idempotencyKey}"),
                BookingHoldRequestSecurity.CreateDirectFingerprint(normalized, ownerScope),
                normalized.ExpectedTotalAmount!.Value,
                normalized.ExpectedCurrencyCode!),
            cancellationToken);
    }
}
