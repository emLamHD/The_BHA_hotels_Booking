using System.Text.RegularExpressions;
using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

/// <summary>
/// BHA-CHECKOUT-001-PR05 (S1 §3.4): remembers which Direct Reservation a guest's create request produced, so that sending the same request again returns that Reservation instead of making a second one.
/// The scope is the Property plus the verified owner (a customer account, or the guest's access-token hash): the same key under another owner or Property is another request. Only hashes are stored, never the
/// raw key, the token or the request. A row is written in the same transaction as its Reservation and is never deleted, because a retry arriving much later must still find it.
/// </summary>
public sealed partial class ReservationCreationRequest
{
    private ReservationCreationRequest()
    {
    }

    public ReservationCreationRequest(
        string scopeHash,
        string keyHash,
        string requestFingerprint,
        Guid propertyId,
        Guid reservationId,
        DateTimeOffset createdAtUtc)
    {
        ScopeHash = Hash(scopeHash, nameof(scopeHash));
        KeyHash = Hash(keyHash, nameof(keyHash));
        RequestFingerprint = Hash(requestFingerprint, nameof(requestFingerprint));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        ReservationId = DomainGuard.RequiredId(reservationId, nameof(reservationId));
        CreatedAtUtc = BookingGuard.RequireUtc(createdAtUtc, nameof(createdAtUtc));
    }

    /// <summary>SHA-256 (lower-case hex) of <c>direct:v1:{propertyId}:{customer:{id}|guest:{tokenHash}}</c>.</summary>
    public string ScopeHash { get; private set; } = string.Empty;

    /// <summary>SHA-256 (lower-case hex) of the Idempotency-Key.</summary>
    public string KeyHash { get; private set; } = string.Empty;

    /// <summary>SHA-256 over every normalized input that affects the booking, the expected price, the payment method and the owner.</summary>
    public string RequestFingerprint { get; private set; } = string.Empty;

    public Guid PropertyId { get; private set; }
    public Guid ReservationId { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }

    private static string Hash(string value, string name) =>
        value is not null && LowerHex64().IsMatch(value)
            ? value
            : throw new DomainException($"{name} must be a 64-character lower-case SHA-256 hex string.");

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex LowerHex64();
}
