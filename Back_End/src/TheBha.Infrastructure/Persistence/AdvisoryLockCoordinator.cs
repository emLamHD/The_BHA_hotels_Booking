using Microsoft.EntityFrameworkCore;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// One RoomType's coarse-grained capacity-scope lock key components
/// (PMS-BE-001.2 §7.1). Deduplicated and sorted ascending by
/// <see cref="LockPlanBuilder"/> before any lock in this class is acquired.
/// </summary>
public readonly record struct RoomTypeScopeLockKey(Guid PropertyId, Guid RoomTypeId)
    : IComparable<RoomTypeScopeLockKey>
{
    public int CompareTo(RoomTypeScopeLockKey other)
    {
        var propertyComparison = PropertyId.CompareTo(other.PropertyId);
        return propertyComparison != 0 ? propertyComparison : RoomTypeId.CompareTo(other.RoomTypeId);
    }
}

/// <summary>
/// One (Property, RoomType, StayDate) daily-inventory lock key. Deduplicated
/// and sorted ascending by <see cref="LockPlanBuilder"/> before any lock in
/// this class is acquired.
/// </summary>
public readonly record struct InventoryLockKey(Guid PropertyId, Guid RoomTypeId, DateOnly StayDate)
    : IComparable<InventoryLockKey>
{
    public int CompareTo(InventoryLockKey other)
    {
        var propertyComparison = PropertyId.CompareTo(other.PropertyId);
        if (propertyComparison != 0)
        {
            return propertyComparison;
        }

        var roomTypeComparison = RoomTypeId.CompareTo(other.RoomTypeId);
        return roomTypeComparison != 0 ? roomTypeComparison : StayDate.CompareTo(other.StayDate);
    }
}

/// <summary>
/// The deterministic, deduplicated, sorted set of ReservationUnit/RoomType-scope/
/// daily-inventory lock keys for one capacity/demand-changing operation, in the
/// three lock classes <see cref="AdvisoryLockCoordinator"/> acquires in fixed
/// order (PMS-BE-001.2 §7.1 classes 2–4; class 1, an operation-specific
/// idempotency/aggregate-transition key, is acquired directly by the caller
/// before this plan is built, since several callers must inspect state under
/// that lock alone before the rest of the plan is even known).
/// </summary>
public sealed record LockPlan(
    IReadOnlyList<Guid> ReservationUnitIds,
    IReadOnlyList<RoomTypeScopeLockKey> RoomTypeScopeKeys,
    IReadOnlyList<InventoryLockKey> InventoryKeys)
{
    public static readonly LockPlan Empty = new([], [], []);
}

/// <summary>
/// Derives, deduplicates, and sorts one operation's ReservationUnit/RoomType-scope/
/// daily-inventory lock keys ascending within each class (PMS-BE-001.2 §7.1
/// steps 1–3), ready for <see cref="AdvisoryLockCoordinator.AcquireAsync"/> to
/// acquire them in fixed class order.
/// </summary>
public sealed class LockPlanBuilder
{
    private readonly SortedSet<Guid> _reservationUnitIds = [];
    private readonly SortedSet<RoomTypeScopeLockKey> _roomTypeScopeKeys = [];
    private readonly SortedSet<InventoryLockKey> _inventoryKeys = [];

    public LockPlanBuilder WithReservationUnit(Guid reservationUnitId)
    {
        _reservationUnitIds.Add(reservationUnitId);
        return this;
    }

    public LockPlanBuilder WithReservationUnits(IEnumerable<Guid> reservationUnitIds)
    {
        ArgumentNullException.ThrowIfNull(reservationUnitIds);
        foreach (var id in reservationUnitIds)
        {
            WithReservationUnit(id);
        }

        return this;
    }

    public LockPlanBuilder WithRoomTypeScope(Guid propertyId, Guid roomTypeId)
    {
        _roomTypeScopeKeys.Add(new RoomTypeScopeLockKey(propertyId, roomTypeId));
        return this;
    }

    public LockPlanBuilder WithInventory(Guid propertyId, Guid roomTypeId, DateOnly stayDate)
    {
        _inventoryKeys.Add(new InventoryLockKey(propertyId, roomTypeId, stayDate));
        return this;
    }

    public LockPlanBuilder WithInventory(Guid propertyId, Guid roomTypeId, IEnumerable<DateOnly> stayDates)
    {
        ArgumentNullException.ThrowIfNull(stayDates);
        foreach (var stayDate in stayDates)
        {
            WithInventory(propertyId, roomTypeId, stayDate);
        }

        return this;
    }

    public LockPlan Build() => new(
        [.. _reservationUnitIds],
        [.. _roomTypeScopeKeys],
        [.. _inventoryKeys]);
}

/// <summary>
/// Shared PostgreSQL advisory-lock acquisition for every capacity/demand writer
/// (PMS-BE-001.2 §7.1). The one fixed lock-class order used across every write
/// path in this repository is:
/// 1. an operation-specific idempotency/aggregate-transition key, when
///    required — acquired directly via <see cref="AcquireKeyAsync"/>, before a
///    <see cref="LockPlan"/> is even built, because several callers must
///    inspect state under that lock alone (e.g. an idempotency replay check)
///    before the rest of the plan is known;
/// 2. ReservationUnit locks, sorted;
/// 3. RoomType inventory-scope locks, sorted;
/// 4. daily inventory locks, sorted.
/// No path may acquire an earlier class after a later one. All locks are
/// transaction-scoped (<c>pg_advisory_xact_lock</c>) and release automatically
/// on commit or rollback.
/// </summary>
internal static class AdvisoryLockCoordinator
{
    public static async Task AcquireKeyAsync(
        TheBhaDbContext dbContext,
        long lockKey,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({lockKey})",
            cancellationToken);
    }

    public static async Task AcquireAsync(
        TheBhaDbContext dbContext,
        LockPlan plan,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(plan);

        foreach (var reservationUnitId in plan.ReservationUnitIds)
        {
            await AcquireKeyAsync(
                dbContext,
                BookingAdvisoryLockKeys.ForReservationUnit(reservationUnitId),
                cancellationToken);
        }

        foreach (var scope in plan.RoomTypeScopeKeys)
        {
            await AcquireKeyAsync(
                dbContext,
                BookingAdvisoryLockKeys.ForRoomTypeInventoryScope(scope.PropertyId, scope.RoomTypeId),
                cancellationToken);
        }

        foreach (var inventory in plan.InventoryKeys)
        {
            await AcquireKeyAsync(
                dbContext,
                BookingAdvisoryLockKeys.ForInventory(inventory.PropertyId, inventory.RoomTypeId, inventory.StayDate),
                cancellationToken);
        }
    }
}
