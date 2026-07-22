using TheBha.Domain.Properties;

namespace TheBha.Application.Properties;

public sealed record SetDailyInventoryControlCommand(Guid PropertyId, Guid RoomTypeId, DateOnly StayDate, int? SellableLimit, bool IsStopSell);
public sealed record DeleteDailyInventoryControlCommand(Guid PropertyId, Guid RoomTypeId, DateOnly StayDate);
public sealed record DailyInventoryControlDto(Guid Id, Guid PropertyId, Guid RoomTypeId, DateOnly StayDate, int? SellableLimit, bool IsStopSell, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public interface IDailyInventoryControlStore
{
    Task<bool> PropertyExistsAsync(Guid propertyId, CancellationToken cancellationToken);
    Task<bool> RoomTypeBelongsToPropertyAsync(Guid propertyId, Guid roomTypeId, CancellationToken cancellationToken);
    Task<DailyInventoryControl?> FindAsync(Guid propertyId, Guid roomTypeId, DateOnly stayDate, CancellationToken cancellationToken);
    Task SaveAsync(DailyInventoryControl control, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(DailyInventoryControl control, CancellationToken cancellationToken);
}

public interface IDailyInventoryControlCommands
{
    Task<DailyInventoryControlDto> SetAsync(SetDailyInventoryControlCommand command, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(DeleteDailyInventoryControlCommand command, CancellationToken cancellationToken);
}

public sealed class DailyInventoryControlCommands(IDailyInventoryControlStore store, TimeProvider timeProvider) : IDailyInventoryControlCommands
{
    public async Task<DailyInventoryControlDto> SetAsync(SetDailyInventoryControlCommand command, CancellationToken cancellationToken)
    {
        await ValidateOwnershipAsync(command.PropertyId, command.RoomTypeId, cancellationToken);
        var now = timeProvider.GetUtcNow();
        var control = await store.FindAsync(command.PropertyId, command.RoomTypeId, command.StayDate, cancellationToken);
        if (control is null) control = new DailyInventoryControl(Guid.NewGuid(), command.PropertyId, command.RoomTypeId, command.StayDate, command.SellableLimit, command.IsStopSell, now);
        else control.Update(command.SellableLimit, command.IsStopSell, now);
        await store.SaveAsync(control, cancellationToken);
        return ToDto(control);
    }

    public async Task<bool> DeleteAsync(DeleteDailyInventoryControlCommand command, CancellationToken cancellationToken)
    {
        await ValidateOwnershipAsync(command.PropertyId, command.RoomTypeId, cancellationToken);
        var control = await store.FindAsync(command.PropertyId, command.RoomTypeId, command.StayDate, cancellationToken);
        return control is not null && await store.DeleteAsync(control, cancellationToken);
    }

    private async Task ValidateOwnershipAsync(Guid propertyId, Guid roomTypeId, CancellationToken cancellationToken)
    {
        if (!await store.PropertyExistsAsync(propertyId, cancellationToken)) throw new InvalidOperationException("Property was not found.");
        if (!await store.RoomTypeBelongsToPropertyAsync(propertyId, roomTypeId, cancellationToken)) throw new InvalidOperationException("RoomType does not belong to Property.");
    }

    private static DailyInventoryControlDto ToDto(DailyInventoryControl value) => new(value.Id, value.PropertyId, value.RoomTypeId, value.StayDate, value.SellableLimit, value.IsStopSell, value.CreatedAt, value.UpdatedAt);
}

public sealed record EffectiveInventoryRangeQuery(Guid PropertyId, Guid RoomTypeId, DateOnly CheckIn, DateOnly CheckOut)
{
    public void Validate()
    {
        if (PropertyId == Guid.Empty || RoomTypeId == Guid.Empty) throw new ArgumentException("Property and RoomType identifiers are required.");
        if (CheckIn >= CheckOut) throw new ArgumentException("checkIn must be earlier than checkOut.");
    }
}
public sealed record DailyEffectiveInventoryDto(DateOnly StayDate, int BaseInventory, int? SellableLimit, bool IsStopSell, int EffectiveInventory);
public sealed record EffectiveInventoryRangeDto(Guid PropertyId, Guid RoomTypeId, DateOnly CheckIn, DateOnly CheckOut, int BaseInventory, int EffectiveInventory, IReadOnlyList<DailyEffectiveInventoryDto> Days);
public interface IDailyInventoryQueries
{
    Task<EffectiveInventoryRangeDto> GetEffectiveInventoryAsync(EffectiveInventoryRangeQuery query, CancellationToken cancellationToken);
}
