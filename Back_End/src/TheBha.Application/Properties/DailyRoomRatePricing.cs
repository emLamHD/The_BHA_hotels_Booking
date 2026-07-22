using TheBha.Domain.Properties;

namespace TheBha.Application.Properties;

public sealed record SetDailyRoomRateCommand(Guid PropertyId, Guid RoomTypeId, Guid RatePlanId, DateOnly StayDate, decimal Amount);
public sealed record DailyRoomRateDto(Guid Id, Guid PropertyId, Guid RoomTypeId, Guid RatePlanId, DateOnly StayDate, decimal Amount, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public interface IDailyRoomRateStore
{
    Task<bool> PropertyExistsAsync(Guid propertyId, CancellationToken cancellationToken);
    Task<bool> RoomTypeBelongsToPropertyAsync(Guid propertyId, Guid roomTypeId, CancellationToken cancellationToken);
    Task<bool> RatePlanBelongsToPropertyAsync(Guid propertyId, Guid ratePlanId, CancellationToken cancellationToken);
    Task<DailyRoomRate?> FindAsync(Guid propertyId, Guid roomTypeId, Guid ratePlanId, DateOnly stayDate, CancellationToken cancellationToken);
    Task SaveAsync(DailyRoomRate rate, CancellationToken cancellationToken);
}

public interface IDailyRoomRatePricing
{
    Task<DailyRoomRateDto> SetAsync(SetDailyRoomRateCommand command, CancellationToken cancellationToken);
}

public sealed class DailyRoomRatePricing(IDailyRoomRateStore store, TimeProvider timeProvider) : IDailyRoomRatePricing
{
    public async Task<DailyRoomRateDto> SetAsync(SetDailyRoomRateCommand command, CancellationToken cancellationToken)
    {
        if (!await store.PropertyExistsAsync(command.PropertyId, cancellationToken)) throw new InvalidOperationException("Property was not found.");
        if (!await store.RoomTypeBelongsToPropertyAsync(command.PropertyId, command.RoomTypeId, cancellationToken)) throw new InvalidOperationException("RoomType does not belong to Property.");
        if (!await store.RatePlanBelongsToPropertyAsync(command.PropertyId, command.RatePlanId, cancellationToken)) throw new InvalidOperationException("RatePlan does not belong to Property.");
        var now = timeProvider.GetUtcNow();
        var rate = await store.FindAsync(command.PropertyId, command.RoomTypeId, command.RatePlanId, command.StayDate, cancellationToken);
        if (rate is null) rate = new DailyRoomRate(Guid.NewGuid(), command.PropertyId, command.RoomTypeId, command.RatePlanId, command.StayDate, command.Amount, now);
        else rate.UpdateAmount(command.Amount, now);
        await store.SaveAsync(rate, cancellationToken);
        return new DailyRoomRateDto(rate.Id, rate.PropertyId, rate.RoomTypeId, rate.RatePlanId, rate.StayDate, rate.Amount, rate.CreatedAt, rate.UpdatedAt);
    }
}
