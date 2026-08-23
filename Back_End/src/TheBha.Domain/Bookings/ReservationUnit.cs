using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

/// <summary>
/// Exactly one commercially sold room (ADR 0005 item 4). Its
/// <see cref="CommitmentStatus"/> is the sole determinant of whether its nights
/// currently create demand; cancellation never deletes or rewrites the unit,
/// its nights, price, or RatePlan lineage — all remain immutable evidence.
/// </summary>
public sealed class ReservationUnit
{
    private readonly List<ReservationUnitNight> _nights = [];

    private ReservationUnit()
    {
    }

    internal ReservationUnit(
        Guid id,
        Guid reservationId,
        Guid propertyId,
        Guid roomTypeId,
        Guid? sourceInventoryHoldItemId,
        DateOnly checkIn,
        DateOnly checkOut,
        IEnumerable<NightlyCommitmentSnapshot> nights)
    {
        DomainGuard.RequiredId(id, nameof(id));
        DomainGuard.RequiredId(reservationId, nameof(reservationId));
        DomainGuard.RequiredId(propertyId, nameof(propertyId));
        DomainGuard.RequiredId(roomTypeId, nameof(roomTypeId));
        if (sourceInventoryHoldItemId == Guid.Empty)
        {
            throw new DomainException("sourceInventoryHoldItemId cannot be an empty guid.");
        }

        var ordered = BookingGuard.ValidateNightlySnapshots(checkIn, checkOut, nights);

        Id = id;
        ReservationId = reservationId;
        PropertyId = propertyId;
        RoomTypeId = roomTypeId;
        SourceInventoryHoldItemId = sourceInventoryHoldItemId;
        CommitmentStatus = CommitmentStatus.Committed;
        _nights.AddRange(ordered.Select(snapshot => new ReservationUnitNight(Id, propertyId, snapshot)));
    }

    public Guid Id { get; private set; }
    public Guid ReservationId { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid RoomTypeId { get; private set; }
    public Guid? SourceInventoryHoldItemId { get; private set; }
    public CommitmentStatus CommitmentStatus { get; private set; }
    public IReadOnlyList<ReservationUnitNight> Nights => _nights.AsReadOnly();

    /// <summary>
    /// Transitions this Unit from <see cref="CommitmentStatus.Committed"/> to
    /// <see cref="CommitmentStatus.Cancelled"/>, removing its demand. Already
    /// <see cref="CommitmentStatus.Cancelled"/> is an idempotent no-op — cancellation
    /// is terminal within this decision (ADR 0005 item 7). Never mutates nights, price,
    /// RatePlan lineage, or source lineage.
    /// </summary>
    internal void Cancel()
    {
        if (CommitmentStatus == CommitmentStatus.Cancelled)
        {
            return;
        }

        CommitmentStatus = CommitmentStatus.Cancelled;
    }
}
