using TheBha.Application.Properties;
using TheBha.Domain.Common;
using TheBha.Domain.Properties;

namespace TheBha.UnitTests;

public sealed class DailyInventoryControlCommandTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private readonly Guid propertyId = Guid.NewGuid();
    private readonly Guid roomTypeId = Guid.NewGuid();
    private readonly DateOnly stayDate = new(2026, 8, 1);

    [Fact]
    public async Task Creates_control_and_saves_with_fixed_clock()
    {
        var store = new Store(); var result = await Service(store).SetAsync(Command(2, false), CancellationToken.None);
        Assert.True(store.Saved); Assert.Equal(2, result.SellableLimit); Assert.Equal(Now, result.CreatedAt);
    }

    [Fact]
    public async Task Updates_limit_and_stop_sell_while_preserving_identity()
    {
        var existing = new DailyInventoryControl(Guid.NewGuid(), propertyId, roomTypeId, stayDate, 2, false, Now.AddDays(-1));
        var store = new Store { Existing = existing };
        var stopped = await Service(store).SetAsync(Command(1, true), CancellationToken.None);
        Assert.Equal(existing.Id, stopped.Id); Assert.Equal(1, stopped.SellableLimit); Assert.True(stopped.IsStopSell);
        store.Saved = false;
        var reopened = await Service(store).SetAsync(Command(1, false), CancellationToken.None);
        Assert.Equal(existing.Id, reopened.Id); Assert.False(reopened.IsStopSell); Assert.Equal(Now.AddDays(-1), reopened.CreatedAt);
    }

    [Fact]
    public async Task Rejects_no_effect_without_saving()
    {
        var store = new Store(); await Assert.ThrowsAsync<DomainException>(() => Service(store).SetAsync(Command(null, false), CancellationToken.None)); Assert.False(store.Saved);
    }

    [Theory]
    [InlineData("property")]
    [InlineData("room")]
    public async Task Rejects_invalid_ownership_without_saving(string invalid)
    {
        var store = new Store { PropertyExists = invalid != "property", RoomBelongs = invalid != "room" };
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(store).SetAsync(Command(1, false), CancellationToken.None));
        Assert.False(store.Saved);
    }

    [Fact]
    public async Task Delete_is_idempotent_and_deletes_existing_control()
    {
        var store = new Store(); var service = Service(store); var command = new DeleteDailyInventoryControlCommand(propertyId, roomTypeId, stayDate);
        Assert.False(await service.DeleteAsync(command, CancellationToken.None));
        store.Existing = new DailyInventoryControl(Guid.NewGuid(), propertyId, roomTypeId, stayDate, 1, false, Now);
        Assert.True(await service.DeleteAsync(command, CancellationToken.None)); Assert.True(store.Deleted);
    }

    [Fact]
    public async Task Cancellation_is_propagated_without_save()
    {
        using var source = new CancellationTokenSource(); source.Cancel(); var store = new Store();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Service(store).SetAsync(Command(1, false), source.Token));
        Assert.False(store.Saved); Assert.Equal(source.Token, store.LastToken);
    }

    private DailyInventoryControlCommands Service(Store store) => new(store, new FixedTimeProvider(Now));
    private SetDailyInventoryControlCommand Command(int? limit, bool stopSell) => new(propertyId, roomTypeId, stayDate, limit, stopSell);

    private sealed class Store : IDailyInventoryControlStore
    {
        public bool PropertyExists { get; init; } = true; public bool RoomBelongs { get; init; } = true;
        public DailyInventoryControl? Existing { get; set; } public bool Saved { get; set; } public bool Deleted { get; private set; } public CancellationToken LastToken { get; private set; }
        public Task<bool> PropertyExistsAsync(Guid id, CancellationToken token) { LastToken = token; token.ThrowIfCancellationRequested(); return Task.FromResult(PropertyExists); }
        public Task<bool> RoomTypeBelongsToPropertyAsync(Guid p, Guid r, CancellationToken token) { LastToken = token; return Task.FromResult(RoomBelongs); }
        public Task<DailyInventoryControl?> FindAsync(Guid p, Guid r, DateOnly d, CancellationToken token) { LastToken = token; return Task.FromResult(Existing); }
        public Task SaveAsync(DailyInventoryControl control, CancellationToken token) { LastToken = token; Saved = true; Existing = control; return Task.CompletedTask; }
        public Task<bool> DeleteAsync(DailyInventoryControl control, CancellationToken token) { LastToken = token; Deleted = true; Existing = null; return Task.FromResult(true); }
    }
    private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider { public override DateTimeOffset GetUtcNow() => value; }
}
