using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

/// <summary>What a <see cref="FolioEntry"/> is. Persisted as text; <c>CK_FolioEntries_Kind</c> closes the set. The direction (adds to or reduces a total) is decided by the kind, never by a sign: <see cref="FolioEntry.Amount"/> is always positive.</summary>
public enum FolioEntryKind
{
    /// <summary>A sum the guest owes for the stay.</summary>
    RoomCharge,

    /// <summary>Takes back (part of) a <see cref="RoomCharge"/>; references it and needs a reason.</summary>
    RoomChargeReversal,

    /// <summary>Money received from the guest.</summary>
    Payment,

    /// <summary>Money given back from a <see cref="Payment"/>; references it and needs a reason.</summary>
    Refund,

    /// <summary>A fee the payment gateway deducted from a <see cref="Payment"/>; references it. Reconciliation only: never part of what the guest owes.</summary>
    GatewayFee
}

/// <summary>Who caused a <see cref="FolioEntry"/>. Its own set (not <c>AdminActorKind</c>): a Gateway posts payments and fees.</summary>
public enum FolioActorKind
{
    System,
    Staff,
    Public,
    Gateway
}

/// <summary>
/// The actor of a posting. <see cref="Staff"/> is the only way to name a Staff member and it takes the id of an already authenticated session (ADR 0007), so a caller cannot invent one;
/// the other kinds cannot carry a Staff id. There is no client-supplied actor over HTTP yet.
/// </summary>
public readonly record struct FolioActor
{
    private FolioActor(FolioActorKind kind, Guid? staffId)
    {
        Kind = kind;
        StaffId = staffId;
    }

    public FolioActorKind Kind { get; }
    public Guid? StaffId { get; }

    public static FolioActor System => new(FolioActorKind.System, null);
    public static FolioActor Public => new(FolioActorKind.Public, null);
    public static FolioActor Gateway => new(FolioActorKind.Gateway, null);

    public static FolioActor Staff(Guid authenticatedStaffId) =>
        new(FolioActorKind.Staff, DomainGuard.RequiredId(authenticatedStaffId, nameof(authenticatedStaffId)));
}

/// <summary>
/// One immutable line of a Reservation's folio (BHA-CHECKOUT-001-PR02, S1 §2.2): append-only, VND only, whole đồng, always positive. Nothing here is ever updated or deleted (a database trigger refuses both);
/// a correction is a new entry of the opposite kind. It carries no running balance: the balance is derived by <see cref="ReservationBalance.From"/> and never stored.
/// </summary>
public sealed class FolioEntry
{
    public const string Vnd = "VND";

    private FolioEntry()
    {
    }

    public FolioEntry(
        Guid id,
        Guid propertyId,
        Guid reservationId,
        FolioEntryKind kind,
        decimal amount,
        string currencyCode,
        string postingKey,
        Guid? referenceEntryId,
        FolioActor actor,
        string? reason,
        DateTimeOffset occurredAtUtc,
        DateTimeOffset recordedAtUtc)
    {
        if (!Enum.IsDefined(kind))
        {
            throw new DomainException("kind is invalid.");
        }

        if (!Enum.IsDefined(actor.Kind) || (actor.Kind == FolioActorKind.Staff) != actor.StaffId.HasValue)
        {
            throw new DomainException("actor is invalid: only a Staff actor carries a Staff id, and a Staff actor must.");
        }

        var needsReference = kind is not (FolioEntryKind.RoomCharge or FolioEntryKind.Payment);
        if (needsReference != referenceEntryId.HasValue)
        {
            throw new DomainException(needsReference
                ? $"{kind} must reference an earlier entry."
                : $"{kind} cannot reference another entry.");
        }

        var needsReason = kind is FolioEntryKind.RoomChargeReversal or FolioEntryKind.Refund;
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        ReservationId = DomainGuard.RequiredId(reservationId, nameof(reservationId));
        if (referenceEntryId == Id)
        {
            throw new DomainException("An entry cannot reference itself.");
        }

        Kind = kind;
        Amount = ToVnd(amount);
        CurrencyCode = BookingGuard.NormalizeCurrency(currencyCode);
        if (CurrencyCode != Vnd)
        {
            throw new DomainException("currencyCode must be VND: the folio holds whole đồng only.");
        }

        PostingKey = DomainGuard.Required(postingKey, nameof(postingKey), BookingFieldLimits.PostingKey);
        ReferenceEntryId = referenceEntryId;
        ActorKind = actor.Kind;
        ActorStaffId = actor.StaffId;
        Reason = needsReason
            ? DomainGuard.Required(reason!, nameof(reason), BookingFieldLimits.FolioReason)
            : DomainGuard.Optional(reason, nameof(reason), BookingFieldLimits.FolioReason);
        OccurredAtUtc = CanonicalInstant(occurredAtUtc, nameof(occurredAtUtc));
        RecordedAtUtc = CanonicalInstant(recordedAtUtc, nameof(recordedAtUtc));
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid ReservationId { get; private set; }
    public FolioEntryKind Kind { get; private set; }

    /// <summary>Whole đồng, greater than zero.</summary>
    public long Amount { get; private set; }

    public string CurrencyCode { get; private set; } = string.Empty;

    /// <summary>The caller's de-duplication key, unique per Reservation (trimmed, compared ordinally). The same key with the same business payload is a no-op; with a different one it is a conflict.</summary>
    public string PostingKey { get; private set; } = string.Empty;

    public Guid? ReferenceEntryId { get; private set; }
    public FolioActorKind ActorKind { get; private set; }
    public Guid? ActorStaffId { get; private set; }
    public string? Reason { get; private set; }

    /// <summary>Business time: when the money moved or the charge arose, as the caller states it. Part of the replay comparison.</summary>
    public DateTimeOffset OccurredAtUtc { get; private set; }

    /// <summary>Server time of the write. Generated each call, so it is never part of the replay comparison.</summary>
    public DateTimeOffset RecordedAtUtc { get; private set; }

    /// <summary>
    /// The replay comparison. Equal means "the same posting again": Kind, Amount, CurrencyCode, ReferenceEntryId, ActorKind, ActorStaffId, Reason (trimmed) and OccurredAtUtc (microsecond precision, as stored).
    /// Property and Reservation are the scope the key lives in; the generated <see cref="Id"/> and the new <see cref="RecordedAtUtc"/> are excluded.
    /// </summary>
    public bool HasSamePostingAs(FolioEntry other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return Kind == other.Kind
            && Amount == other.Amount
            && CurrencyCode == other.CurrencyCode
            && ReferenceEntryId == other.ReferenceEntryId
            && ActorKind == other.ActorKind
            && ActorStaffId == other.ActorStaffId
            && string.Equals(Reason, other.Reason, StringComparison.Ordinal)
            && OccurredAtUtc == other.OccurredAtUtc;
    }

    /// <summary>
    /// The one decimal → bigint conversion. The amount must already be a positive whole number inside the bigint range; anything else is rejected before any conversion, never rounded
    /// (PostgreSQL's own numeric → bigint cast rounds silently, so the database cannot be the guard).
    /// </summary>
    public static long ToVnd(decimal amount)
    {
        if (amount <= 0)
        {
            throw new DomainException("amount must be greater than zero.");
        }

        if (amount != decimal.Truncate(amount))
        {
            throw new DomainException("amount must be a whole number of đồng; it is not rounded.");
        }

        if (amount > long.MaxValue)
        {
            throw new DomainException("amount is outside the supported range.");
        }

        return (long)amount;
    }

    // PostgreSQL stores microseconds and .NET carries 100 ns ticks: cutting to the stored precision up front keeps "what was asked" equal to "what was stored" on a retry.
    private static DateTimeOffset CanonicalInstant(DateTimeOffset value, string parameterName)
    {
        BookingGuard.RequireUtc(value, parameterName);
        return new DateTimeOffset(value.Ticks - (value.Ticks % 10), TimeSpan.Zero);
    }
}
