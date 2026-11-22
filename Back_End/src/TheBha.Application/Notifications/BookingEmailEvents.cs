using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TheBha.Application.Notifications;

/// <summary>
/// BHA-CHECKOUT-001-PR05: the identity of the booking events written to the e-mail outbox (<see cref="IEmailOutbox"/>), so the writer and the handlers PR07 adds agree on them without sharing strings.
/// <para>
/// <b>ReservationConfirmed</b>, schema version 1: written once per Direct Reservation, in the transaction that creates it. The envelope carries the PropertyId; the payload is only
/// <c>{"reservationId":"&lt;guid&gt;"}</c>: no guest name, address, phone, amount or token. A handler reads whatever else it needs from the database. A Hold-sourced Reservation writes no such event in this release.
/// </para>
/// <para>
/// <b>EventId convention.</b> The id is derived from the business fact, not random, so the same fact can never be queued twice: the first 16 bytes of
/// SHA-256(<c>thebha:email-outbox:event:v1:{EventType}:{reservationId:D}</c>) with the UUID version-5 and variant bits set. It is not the reservation id itself, so a later event type about the same
/// reservation gets a different id by the same rule.
/// </para>
/// </summary>
public static class BookingEmailEvents
{
    public const string ReservationConfirmed = "ReservationConfirmed";
    public const int ReservationConfirmedSchemaVersion = 1;

    public static Guid EventId(string eventType, Guid reservationId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"thebha:email-outbox:event:v1:{eventType}:{reservationId:D}"));
        Span<byte> bytes = hash.AsSpan(0, 16).ToArray();
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes, bigEndian: true);
    }

    public static EmailOutboxEventRequest ReservationConfirmedEvent(Guid propertyId, Guid reservationId) => new(
        EventId(ReservationConfirmed, reservationId),
        ReservationConfirmed,
        ReservationConfirmedSchemaVersion,
        propertyId,
        JsonSerializer.Serialize(new Dictionary<string, string> { ["reservationId"] = reservationId.ToString("D") }));
}
