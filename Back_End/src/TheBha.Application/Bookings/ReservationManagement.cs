using System.Globalization;
using TheBha.Application.Customers;
using TheBha.Application.Promotions;
using TheBha.Domain.Bookings;

namespace TheBha.Application.Bookings;

/// <summary>
/// BHA-CHECKOUT-001-PR06: the secrets of guest reservation management. A link secret and a session secret are each 32 CSPRNG bytes in base64url (the shape of the guest booking token, so one validator checks the
/// shape), but a hash is never interchangeable: each kind is hashed under its own prefix, so a stored link hash can not be presented as a session and neither equals a booking-token hash.
/// </summary>
public static class ReservationManagementSecrets
{
    private const string LinkPrefix = "thebha:reservation-management:link:v1:";
    private const string SessionPrefix = "thebha:reservation-management:session:v1:";

    public static bool TryHashLink(string? secret, out string hash) => TryHash(LinkPrefix, secret, out hash);

    public static bool TryHashSession(string? secret, out string hash) => TryHash(SessionPrefix, secret, out hash);

    private static bool TryHash(string prefix, string? secret, out string hash)
    {
        hash = string.Empty;
        if (!BookingAccessTokenValidator.TryHash(secret, out _))
        {
            return false;
        }

        hash = BookingHoldRequestSecurity.Sha256Hex(prefix + secret);
        return true;
    }
}

public enum ReservationManagementLinkIssueStatus
{
    Issued,

    /// <summary>No such Reservation in this Property, or it is not a guest-owned Direct one (an account-owned or Hold-sourced Reservation never gets a link).</summary>
    NotEligible
}

/// <summary>The only place the raw link secret exists. <see cref="ToString"/> hides it so a log line or a debugger never prints it.</summary>
public sealed class ReservationManagementLinkIssue
{
    private ReservationManagementLinkIssue(ReservationManagementLinkIssueStatus status, string? secret, DateTimeOffset? expiresAtUtc)
    {
        Status = status;
        Secret = secret;
        ExpiresAtUtc = expiresAtUtc;
    }

    public ReservationManagementLinkIssueStatus Status { get; }

    /// <summary>The base64url secret to put in a URL <b>fragment</b> (never the path or query). Shown once; only its hash is stored.</summary>
    public string? Secret { get; }

    public DateTimeOffset? ExpiresAtUtc { get; }

    public static ReservationManagementLinkIssue Issued(string secret, DateTimeOffset expiresAtUtc) =>
        new(ReservationManagementLinkIssueStatus.Issued, secret, expiresAtUtc);

    public static ReservationManagementLinkIssue NotEligible() => new(ReservationManagementLinkIssueStatus.NotEligible, null, null);

    public override string ToString() => $"ReservationManagementLinkIssue({Status})";
}

/// <summary>
/// Internal issuance of a guest management link (for the e-mail work item PR07; no HTTP route exists for it). It runs on the caller's own <c>TheBhaDbContext</c> and <b>requires</b> the caller's explicit READ COMMITTED
/// transaction: it adds the link row to that transaction and never commits, rolls back or disposes it, so the secret can only be committed together with whatever the caller stores to deliver it, and a rolled-back caller
/// leaves no link. Calling it without a transaction throws. Each call issues a new link; links already issued stay valid until they expire or are used.
/// </summary>
public interface IReservationManagementLinkIssuer
{
    /// <param name="ttl">How long the link may be exchanged; <see cref="ReservationManagementRules.DefaultLinkTtl"/> (72 hours) when omitted, at most <see cref="ReservationManagementRules.MaxLinkTtl"/>.</param>
    Task<ReservationManagementLinkIssue> IssueAsync(Guid propertyId, Guid reservationId, TimeSpan? ttl, CancellationToken cancellationToken);
}

public enum ReservationManagementExchangeStatus
{
    Exchanged,

    /// <summary>Malformed, unknown, expired, already used, or for another reservation: one answer for all of them.</summary>
    Invalid
}

public sealed class ReservationManagementExchangeResult
{
    private ReservationManagementExchangeResult(ReservationManagementExchangeStatus status, string? sessionSecret, DateTimeOffset? expiresAtUtc)
    {
        Status = status;
        SessionSecret = sessionSecret;
        ExpiresAtUtc = expiresAtUtc;
    }

    public ReservationManagementExchangeStatus Status { get; }

    /// <summary>The raw session secret, for the cookie only. Never part of a response body.</summary>
    public string? SessionSecret { get; }

    public DateTimeOffset? ExpiresAtUtc { get; }

    public static ReservationManagementExchangeResult Exchanged(string sessionSecret, DateTimeOffset expiresAtUtc) =>
        new(ReservationManagementExchangeStatus.Exchanged, sessionSecret, expiresAtUtc);

    public static ReservationManagementExchangeResult Invalid() => new(ReservationManagementExchangeStatus.Invalid, null, null);

    public override string ToString() => $"ReservationManagementExchangeResult({Status})";
}

public interface IReservationManagementExchangeStore
{
    /// <summary>Consumes the link and creates the session in one transaction; <c>null</c> when no unused, unexpired link of that reservation has that hash.</summary>
    Task<DateTimeOffset?> ExchangeAsync(Guid reservationId, string linkHash, string sessionHash, CancellationToken cancellationToken);
}

public interface IReservationManagementExchange
{
    Task<ReservationManagementExchangeResult> ExchangeAsync(Guid reservationId, string? linkSecret, CancellationToken cancellationToken);
}

public sealed class ReservationManagementExchange(
    IReservationManagementExchangeStore store,
    IGuestAccessTokenGenerator generator) : IReservationManagementExchange
{
    public async Task<ReservationManagementExchangeResult> ExchangeAsync(Guid reservationId, string? linkSecret, CancellationToken cancellationToken)
    {
        if (reservationId == Guid.Empty || !ReservationManagementSecrets.TryHashLink(linkSecret, out var linkHash))
        {
            return ReservationManagementExchangeResult.Invalid();
        }

        var sessionSecret = generator.Generate();
        ReservationManagementSecrets.TryHashSession(sessionSecret, out var sessionHash);
        return await store.ExchangeAsync(reservationId, linkHash, sessionHash, cancellationToken) is { } expiresAtUtc
            ? ReservationManagementExchangeResult.Exchanged(sessionSecret, expiresAtUtc)
            : ReservationManagementExchangeResult.Invalid();
    }
}

/// <summary>Who is asking to manage a reservation: the customer account that is signed in and/or the hash of a guest management session secret. Either may open the reservation it exactly owns.</summary>
public sealed record ReservationManagementCaller(Guid? CustomerAccountId, string? SessionHash);

/// <summary>An arrival the guest stated: a wall-clock date and time at the Property, never an instant.</summary>
public sealed record EstimatedArrivalDto(DateOnly ArrivalDate, string ArrivalTime, string TimeZoneId, DateTimeOffset UpdatedAtUtc);

/// <summary>
/// What a guest sees of a Direct reservation they manage. Its own shape: <see cref="ReservationDto"/> is unchanged. It carries no e-mail address, phone number or secret. The balance is the folio's
/// (<see cref="LedgerState"/> NotRecorded means no amount is offered), the same numbers the Direct create answer gives.
/// </summary>
public sealed record ReservationManagementDto(
    Guid ReservationId,
    string ConfirmationNumber,
    ReservationStatus Status,
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    string FullName,
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
    long? BalanceDueAmount,
    string PropertyTimeZoneId,
    EstimatedArrivalDto? EstimatedArrival);

public enum ReservationManagementStatus
{
    Found,
    Updated,
    Invalid,

    /// <summary>The customer session does not name an account, or a guest has no valid session.</summary>
    Unauthorized,
    NotFound,
    Conflict
}

public sealed record ReservationManagementResult(ReservationManagementStatus Status, ReservationManagementDto? Reservation, string? Error)
{
    public static ReservationManagementResult Found(ReservationManagementDto reservation) => new(ReservationManagementStatus.Found, reservation, null);

    public static ReservationManagementResult Updated(ReservationManagementDto reservation) => new(ReservationManagementStatus.Updated, reservation, null);

    public static ReservationManagementResult Invalid(string error) => new(ReservationManagementStatus.Invalid, null, error);

    public static ReservationManagementResult Unauthorized(string error) => new(ReservationManagementStatus.Unauthorized, null, error);

    public static ReservationManagementResult NotFound(string error) => new(ReservationManagementStatus.NotFound, null, error);

    public static ReservationManagementResult Conflict(string error) => new(ReservationManagementStatus.Conflict, null, error);
}

public interface IReservationManagementStore
{
    Task<ReservationManagementResult> GetAsync(Guid reservationId, ReservationManagementCaller caller, CancellationToken cancellationToken);

    /// <summary>Under the reservation's transition lock: re-reads authorization and status, validates the window against the stay, and stores the arrival.</summary>
    Task<ReservationManagementResult> UpdateEstimatedArrivalAsync(
        Guid reservationId,
        ReservationManagementCaller caller,
        DateOnly arrivalDate,
        TimeOnly arrivalTime,
        CancellationToken cancellationToken);
}

public interface IReservationManagement
{
    Task<ReservationManagementResult> GetAsync(Guid reservationId, string? sessionSecret, CancellationToken cancellationToken);

    Task<ReservationManagementResult> UpdateEstimatedArrivalAsync(
        Guid reservationId,
        string? sessionSecret,
        string? arrivalDate,
        string? arrivalTime,
        CancellationToken cancellationToken);
}

/// <summary>
/// The estimated-arrival rules. The date is <c>yyyy-MM-dd</c> and the time <c>HH:mm</c>, both exactly, with no offset or zone: they are read as the Property's wall clock and never converted, so the server's own time
/// zone plays no part. The date must be the check-in date or the next day (a late or overnight arrival). A wall time that does not exist in the Property's zone (the hour skipped when clocks go forward) is refused;
/// one that occurs twice (clocks go back) is kept as stated, because no offset is stored to disagree about.
/// </summary>
public static class EstimatedArrivalRules
{
    public static bool TryParse(string? arrivalDate, string? arrivalTime, out DateOnly date, out TimeOnly time, out string error)
    {
        date = default;
        time = default;
        if (!DateOnly.TryParseExact(arrivalDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
        {
            error = "arrivalDate must be a date written yyyy-MM-dd.";
            return false;
        }

        if (!TimeOnly.TryParseExact(arrivalTime, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out time))
        {
            error = "arrivalTime must be a time written HH:mm (24 hours, no offset).";
            return false;
        }

        error = string.Empty;
        return true;
    }

    public static bool TryCheckWindow(DateOnly checkIn, string timeZoneId, DateOnly date, TimeOnly time, out string error)
    {
        if (date != checkIn && date != checkIn.AddDays(1))
        {
            error = "arrivalDate must be the check-in date or the day after it.";
            return false;
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        if (zone.IsInvalidTime(date.ToDateTime(time, DateTimeKind.Unspecified)))
        {
            error = "That time does not exist at the property on that date.";
            return false;
        }

        error = string.Empty;
        return true;
    }
}

public sealed class ReservationManagement(
    ICurrentCustomer currentCustomer,
    IReservationManagementStore store) : IReservationManagement
{
    public async Task<ReservationManagementResult> GetAsync(Guid reservationId, string? sessionSecret, CancellationToken cancellationToken)
    {
        if (!TryResolve(sessionSecret, out var caller, out var error))
        {
            return ReservationManagementResult.Unauthorized(error);
        }

        return Hide(await store.GetAsync(reservationId, caller, cancellationToken), caller);
    }

    public async Task<ReservationManagementResult> UpdateEstimatedArrivalAsync(
        Guid reservationId,
        string? sessionSecret,
        string? arrivalDate,
        string? arrivalTime,
        CancellationToken cancellationToken)
    {
        if (!TryResolve(sessionSecret, out var caller, out var error))
        {
            return ReservationManagementResult.Unauthorized(error);
        }

        if (!EstimatedArrivalRules.TryParse(arrivalDate, arrivalTime, out var date, out var time, out var invalid))
        {
            return ReservationManagementResult.Invalid(invalid);
        }

        return Hide(await store.UpdateEstimatedArrivalAsync(reservationId, caller, date, time, cancellationToken), caller);
    }

    private bool TryResolve(string? sessionSecret, out ReservationManagementCaller caller, out string error)
    {
        Guid? customerAccountId = null;
        if (currentCustomer.IsAuthenticated)
        {
            if (currentCustomer.CustomerAccountId is not { } resolvedId || resolvedId == Guid.Empty)
            {
                caller = new ReservationManagementCaller(null, null);
                error = "A valid customer session is required.";
                return false;
            }

            customerAccountId = resolvedId;
        }

        // A session secret that is malformed is no credential at all (it is never an error of its own).
        string? sessionHash = ReservationManagementSecrets.TryHashSession(sessionSecret, out var hash) ? hash : null;
        caller = new ReservationManagementCaller(customerAccountId, sessionHash);
        error = "A valid reservation management session is required.";
        return customerAccountId is not null || sessionHash is not null;
    }

    // A guest who holds no valid session for this reservation learns only "no valid session", whether or not the reservation exists.
    private static ReservationManagementResult Hide(ReservationManagementResult result, ReservationManagementCaller caller) =>
        result.Status == ReservationManagementStatus.NotFound && caller.CustomerAccountId is null
            ? ReservationManagementResult.Unauthorized("A valid reservation management session is required.")
            : result;
}
