using TheBha.Domain.Common;
using TheBha.Domain.Properties;

namespace TheBha.UnitTests;

public sealed class DailyInventoryControlDomainTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");

    [Fact]
    public void Creates_limit_zero_and_stop_sell_only_controls()
    {
        Assert.Equal(2, Create(2, false).SellableLimit);
        Assert.Equal(0, Create(0, false).SellableLimit);
        var stopSell = Create(null, true);
        Assert.True(stopSell.IsStopSell);
        Assert.Null(stopSell.SellableLimit);
    }

    [Fact]
    public void Rejects_negative_limit_and_no_effect_state()
    {
        Assert.Throws<DomainException>(() => Create(-1, false));
        Assert.Throws<DomainException>(() => Create(null, false));
    }

    [Theory]
    [InlineData("id")]
    [InlineData("property")]
    [InlineData("room")]
    public void Rejects_each_empty_identity(string empty)
    {
        Assert.Throws<DomainException>(() => new DailyInventoryControl(
            empty == "id" ? Guid.Empty : Guid.NewGuid(),
            empty == "property" ? Guid.Empty : Guid.NewGuid(),
            empty == "room" ? Guid.Empty : Guid.NewGuid(),
            new DateOnly(2026, 8, 1), 1, false, Now));
    }

    [Fact]
    public void Updates_preserve_identity_and_creation_and_allow_stop_sell_toggle_with_limit()
    {
        var control = Create(2, false); var id = control.Id;
        control.SetStopSell(true, Now.AddMinutes(1));
        Assert.True(control.IsStopSell);
        control.SetStopSell(false, Now.AddMinutes(2));
        Assert.False(control.IsStopSell);
        Assert.Equal(id, control.Id);
        Assert.Equal(Now, control.CreatedAt);
        Assert.Equal(Now.AddMinutes(2), control.UpdatedAt);
    }

    [Fact]
    public void Rejects_backward_timestamp_and_disabling_last_effect()
    {
        var control = Create(2, false);
        control.Update(3, false, Now.AddMinutes(2));
        Assert.Throws<DomainException>(() => control.Update(3, false, Now.AddMinutes(1)));
        Assert.Throws<DomainException>(() => control.Update(null, false, Now.AddMinutes(3)));
    }

    private static DailyInventoryControl Create(int? limit, bool stopSell) => new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 8, 1), limit, stopSell, Now);
}
