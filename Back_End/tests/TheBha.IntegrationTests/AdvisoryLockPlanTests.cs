using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// Characterizes <see cref="LockPlanBuilder"/>'s deterministic derive/dedupe/sort
/// contract (PMS-BE-001.2 §7.1 steps 1–3) and the new lock-key namespaces'
/// stability/uniqueness, in isolation from PostgreSQL — every write-path store
/// that builds a <see cref="LockPlan"/> relies on this ordering to avoid
/// deadlocks under concurrent, overlapping-key operations.
/// </summary>
public sealed class AdvisoryLockPlanTests
{
    [Fact]
    public void Build_deduplicates_reservation_unit_ids_and_sorts_ascending()
    {
        var lower = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var higher = Guid.Parse("00000000-0000-0000-0000-000000000002");

        var plan = new LockPlanBuilder()
            .WithReservationUnit(higher)
            .WithReservationUnit(lower)
            .WithReservationUnit(higher)
            .Build();

        Assert.Equal([lower, higher], plan.ReservationUnitIds);
    }

    [Fact]
    public void Build_deduplicates_room_type_scope_keys_and_sorts_by_property_then_room_type()
    {
        var propertyA = Guid.Parse("00000000-0000-0000-0000-0000000000a0");
        var propertyB = Guid.Parse("00000000-0000-0000-0000-0000000000b0");
        var roomTypeLow = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var roomTypeHigh = Guid.Parse("00000000-0000-0000-0000-000000000002");

        var plan = new LockPlanBuilder()
            .WithRoomTypeScope(propertyB, roomTypeLow)
            .WithRoomTypeScope(propertyA, roomTypeHigh)
            .WithRoomTypeScope(propertyA, roomTypeLow)
            .WithRoomTypeScope(propertyA, roomTypeLow)
            .Build();

        Assert.Equal(
            [
                new RoomTypeScopeLockKey(propertyA, roomTypeLow),
                new RoomTypeScopeLockKey(propertyA, roomTypeHigh),
                new RoomTypeScopeLockKey(propertyB, roomTypeLow)
            ],
            plan.RoomTypeScopeKeys);
    }

    [Fact]
    public void Build_deduplicates_inventory_keys_and_sorts_by_property_room_type_then_stay_date()
    {
        var propertyId = Guid.Parse("00000000-0000-0000-0000-0000000000a0");
        var roomTypeId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var earlier = new DateOnly(2026, 9, 1);
        var later = new DateOnly(2026, 9, 2);

        var plan = new LockPlanBuilder()
            .WithInventory(propertyId, roomTypeId, later)
            .WithInventory(propertyId, roomTypeId, earlier)
            .WithInventory(propertyId, roomTypeId, later)
            .Build();

        Assert.Equal(
            [
                new InventoryLockKey(propertyId, roomTypeId, earlier),
                new InventoryLockKey(propertyId, roomTypeId, later)
            ],
            plan.InventoryKeys);
    }

    [Fact]
    public void WithInventory_range_overload_adds_every_distinct_date_in_the_range()
    {
        var propertyId = Guid.NewGuid();
        var roomTypeId = Guid.NewGuid();
        var checkIn = new DateOnly(2026, 9, 1);
        var stayDates = Enumerable.Range(0, 3).Select(checkIn.AddDays);

        var plan = new LockPlanBuilder()
            .WithInventory(propertyId, roomTypeId, stayDates)
            .Build();

        Assert.Equal(3, plan.InventoryKeys.Count);
        Assert.Equal(
            stayDates.Order(),
            plan.InventoryKeys.Select(key => key.StayDate));
    }

    [Fact]
    public void ForReservationUnit_key_is_stable_and_distinct_per_unit()
    {
        var unitId = Guid.NewGuid();

        var first = BookingAdvisoryLockKeys.ForReservationUnit(unitId);
        var second = BookingAdvisoryLockKeys.ForReservationUnit(unitId);

        Assert.Equal(first, second);
        Assert.NotEqual(first, BookingAdvisoryLockKeys.ForReservationUnit(Guid.NewGuid()));
    }

    [Fact]
    public void ForRoomTypeInventoryScope_key_is_stable_distinct_per_room_type_and_distinct_from_daily_inventory_key()
    {
        var propertyId = Guid.NewGuid();
        var roomTypeId = Guid.NewGuid();
        var stayDate = new DateOnly(2026, 9, 1);

        var first = BookingAdvisoryLockKeys.ForRoomTypeInventoryScope(propertyId, roomTypeId);
        var second = BookingAdvisoryLockKeys.ForRoomTypeInventoryScope(propertyId, roomTypeId);

        Assert.Equal(first, second);
        Assert.NotEqual(
            first,
            BookingAdvisoryLockKeys.ForRoomTypeInventoryScope(propertyId, Guid.NewGuid()));
        Assert.NotEqual(
            first,
            BookingAdvisoryLockKeys.ForInventory(propertyId, roomTypeId, stayDate));
        Assert.NotEqual(
            first,
            BookingAdvisoryLockKeys.ForReservationUnit(roomTypeId));
    }

    [Fact]
    public void Empty_plan_has_no_keys_in_any_class()
    {
        var plan = LockPlan.Empty;

        Assert.Empty(plan.ReservationUnitIds);
        Assert.Empty(plan.RoomTypeScopeKeys);
        Assert.Empty(plan.InventoryKeys);
    }
}
