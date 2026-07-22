using TheBha.Domain.Common;
using TheBha.Domain.Properties;

namespace TheBha.UnitTests;

public sealed class DailyRoomRateDomainTests
{
    private static readonly DateTimeOffset CreatedAt = DateTimeOffset.Parse("2026-07-22T00:00:00Z");

    [Fact]
    public void Creates_valid_rate_and_preserves_date_only()
    {
        var rate = Create();
        Assert.Equal(new DateOnly(2026, 8, 1), rate.StayDate);
        Assert.Equal(CreatedAt, rate.CreatedAt);
        Assert.Equal(CreatedAt, rate.UpdatedAt);
        Assert.Null(typeof(DailyRoomRate).GetProperty("CurrencyCode"));
    }

    [Theory]
    [InlineData("Id")]
    [InlineData("PropertyId")]
    [InlineData("RoomTypeId")]
    [InlineData("RatePlanId")]
    public void Rejects_each_empty_identity(string identity)
    {
        var id = identity == "Id" ? Guid.Empty : Guid.NewGuid();
        var propertyId = identity == "PropertyId" ? Guid.Empty : Guid.NewGuid();
        var roomTypeId = identity == "RoomTypeId" ? Guid.Empty : Guid.NewGuid();
        var ratePlanId = identity == "RatePlanId" ? Guid.Empty : Guid.NewGuid();
        Assert.Throws<DomainException>(() => new DailyRoomRate(id, propertyId, roomTypeId, ratePlanId, new DateOnly(2026, 8, 1), 1m, CreatedAt));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_invalid_create_amount(decimal amount) => Assert.Throws<DomainException>(() => Create(amount));

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_invalid_update_amount(decimal amount) => Assert.Throws<DomainException>(() => Create().UpdateAmount(amount, CreatedAt.AddMinutes(1)));

    [Fact]
    public void Update_preserves_identity_and_created_at_and_advances_timestamp()
    {
        var rate = Create(); var id = rate.Id;
        rate.UpdateAmount(200m, CreatedAt.AddMinutes(1));
        Assert.Equal(id, rate.Id); Assert.Equal(CreatedAt, rate.CreatedAt); Assert.Equal(200m, rate.Amount); Assert.Equal(CreatedAt.AddMinutes(1), rate.UpdatedAt);
    }

    [Fact]
    public void Rejects_timestamps_before_created_and_current_update()
    {
        var rate = Create();
        Assert.Throws<DomainException>(() => rate.UpdateAmount(2m, CreatedAt.AddTicks(-1)));
        rate.UpdateAmount(2m, CreatedAt.AddMinutes(2));
        Assert.Throws<DomainException>(() => rate.UpdateAmount(3m, CreatedAt.AddMinutes(1)));
    }

    private static DailyRoomRate Create(decimal amount = 100m) => new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 8, 1), amount, CreatedAt);
}
