namespace TheBha.Domain.Bookings;

/// <summary>
/// One room's worth of Unit construction input for the <see cref="Reservation"/>
/// constructor. <see cref="SourceInventoryHoldItemId"/> is null only for a future
/// Admin/walk-in/OTA direct-creation path with no source Hold (ADR 0005 item 3) —
/// this work item's only creation path (Hold confirmation) always supplies it.
/// </summary>
public sealed record ReservationUnitPlan(
    Guid? SourceInventoryHoldItemId,
    Guid RoomTypeId,
    IEnumerable<NightlyCommitmentSnapshot> Nights);
