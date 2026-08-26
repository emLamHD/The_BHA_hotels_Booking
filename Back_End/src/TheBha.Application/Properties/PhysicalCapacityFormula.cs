namespace TheBha.Application.Properties;

/// <summary>
/// The one shared, order-fixed arithmetic (PMS-BE-001.2 §8, blueprint §7 rule 13,
/// ADR 0006 Decision item 10) for turning base physical inventory into sellable
/// capacity: blocks reduce usable physical capacity first, daily controls then cap
/// that already-reduced capacity, and operational demand is subtracted last. Every
/// caller (public availability projection, Hold creation, assignment/block mutation
/// validation) must go through these three steps in this order — never a materially
/// different duplicated formula.
/// </summary>
public static class PhysicalCapacityFormula
{
    /// <summary>
    /// <c>UsablePhysicalCapacity = max(0, BaseInventory - OperationalBlockedRooms)</c>.
    /// </summary>
    public static int UsablePhysicalCapacity(int baseInventory, int operationalBlockedRooms) =>
        Math.Max(0, baseInventory - operationalBlockedRooms);

    /// <summary>
    /// <c>ControlledCapacity</c>: zero under stop-sell; otherwise
    /// <c>min(UsablePhysicalCapacity, SellableLimit)</c> when a limit is present, or
    /// <c>UsablePhysicalCapacity</c> unchanged otherwise. Applied to the
    /// already-block-reduced capacity, never to the un-reduced BaseInventory.
    /// </summary>
    public static int ControlledCapacity(int usablePhysicalCapacity, int? sellableLimit, bool isStopSell) =>
        isStopSell ? 0 : Math.Min(usablePhysicalCapacity, sellableLimit ?? usablePhysicalCapacity);

    /// <summary>
    /// <c>AvailableToSell = max(0, ControlledCapacity - OperationalCapacityDemand)</c>.
    /// </summary>
    public static int AvailableToSell(int controlledCapacity, int operationalCapacityDemand) =>
        Math.Max(0, controlledCapacity - operationalCapacityDemand);
}
