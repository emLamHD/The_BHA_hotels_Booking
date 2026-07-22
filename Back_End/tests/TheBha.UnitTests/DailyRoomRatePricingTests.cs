using TheBha.Application.Properties;
using TheBha.Domain.Properties;

namespace TheBha.UnitTests;

public sealed class DailyRoomRatePricingTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T23:30:00Z");
    private readonly Guid _propertyId = Guid.NewGuid();
    private readonly Guid _roomTypeId = Guid.NewGuid();
    private readonly Guid _ratePlanId = Guid.NewGuid();

    [Fact]
    public async Task Creates_new_rate_with_fixed_clock_and_saves()
    {
        var store = new Store(); var service = CreateService(store); var command = Command(100m);
        var result = await service.SetAsync(command, CancellationToken.None);
        Assert.True(store.Saved); Assert.Equal(command.Amount, result.Amount); Assert.Equal(Now, result.CreatedAt); Assert.Equal(Now, result.UpdatedAt);
    }

    [Fact]
    public async Task Updates_existing_rate_preserving_identity_and_creation()
    {
        var existing = new DailyRoomRate(Guid.NewGuid(), _propertyId, _roomTypeId, _ratePlanId, new DateOnly(2026, 8, 1), 100m, Now.AddDays(-1));
        var store = new Store { Existing = existing }; var result = await CreateService(store).SetAsync(Command(200m), CancellationToken.None);
        Assert.Equal(existing.Id, result.Id); Assert.Equal(Now.AddDays(-1), result.CreatedAt); Assert.Equal(Now, result.UpdatedAt); Assert.Equal(200m, result.Amount);
    }

    [Theory]
    [InlineData("property")]
    [InlineData("room")]
    [InlineData("plan")]
    public async Task Rejects_invalid_ownership_without_saving(string missing)
    {
        var store = new Store { PropertyExists = missing != "property", RoomBelongs = missing != "room", PlanBelongs = missing != "plan" };
        await Assert.ThrowsAsync<InvalidOperationException>(() => CreateService(store).SetAsync(Command(1m), CancellationToken.None));
        Assert.False(store.Saved);
    }

    [Fact]
    public async Task Propagates_cancellation_without_saving()
    {
        using var source = new CancellationTokenSource(); source.Cancel(); var store = new Store { ThrowOnPropertyCheck = true };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => CreateService(store).SetAsync(Command(1m), source.Token));
        Assert.False(store.Saved); Assert.Equal(source.Token, store.LastToken);
    }

    private DailyRoomRatePricing CreateService(Store store) => new(store, new FixedTimeProvider(Now));
    private SetDailyRoomRateCommand Command(decimal amount) => new(_propertyId, _roomTypeId, _ratePlanId, new DateOnly(2026, 8, 1), amount);

    private sealed class Store : IDailyRoomRateStore
    {
        public bool PropertyExists { get; init; } = true; public bool RoomBelongs { get; init; } = true; public bool PlanBelongs { get; init; } = true; public bool ThrowOnPropertyCheck { get; init; }
        public DailyRoomRate? Existing { get; init; } public bool Saved { get; private set; } public CancellationToken LastToken { get; private set; }
        public Task<bool> PropertyExistsAsync(Guid id, CancellationToken ct) { LastToken = ct; ct.ThrowIfCancellationRequested(); return Task.FromResult(PropertyExists); }
        public Task<bool> RoomTypeBelongsToPropertyAsync(Guid p, Guid r, CancellationToken ct) { LastToken = ct; return Task.FromResult(RoomBelongs); }
        public Task<bool> RatePlanBelongsToPropertyAsync(Guid p, Guid r, CancellationToken ct) { LastToken = ct; return Task.FromResult(PlanBelongs); }
        public Task<DailyRoomRate?> FindAsync(Guid p, Guid r, Guid plan, DateOnly d, CancellationToken ct) { LastToken = ct; return Task.FromResult(Existing); }
        public Task SaveAsync(DailyRoomRate r, CancellationToken ct) { LastToken = ct; Saved = true; return Task.CompletedTask; }
    }

    private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider { public override DateTimeOffset GetUtcNow() => value; }
}
