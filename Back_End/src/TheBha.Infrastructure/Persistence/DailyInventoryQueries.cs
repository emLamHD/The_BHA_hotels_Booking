using Microsoft.EntityFrameworkCore;
using TheBha.Application.Properties;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class DailyInventoryQueries(TheBhaDbContext dbContext) : IDailyInventoryQueries
{
    public async Task<EffectiveInventoryRangeDto> GetEffectiveInventoryAsync(EffectiveInventoryRangeQuery query, CancellationToken cancellationToken)
    {
        query.Validate();
        if (!await dbContext.Properties.AsNoTracking().AnyAsync(x => x.Id == query.PropertyId, cancellationToken)) throw new InvalidOperationException("Property was not found.");
        if (!await dbContext.RoomTypes.AsNoTracking().AnyAsync(x => x.PropertyId == query.PropertyId && x.Id == query.RoomTypeId, cancellationToken)) throw new InvalidOperationException("RoomType does not belong to Property.");
        var baseInventory = await dbContext.PhysicalRooms.AsNoTracking().CountAsync(x => x.PropertyId == query.PropertyId && x.RoomTypeId == query.RoomTypeId && x.OperationalStatus == OperationalStatus.Active, cancellationToken);
        var controls = await dbContext.DailyInventoryControls.AsNoTracking().Where(x => x.PropertyId == query.PropertyId && x.RoomTypeId == query.RoomTypeId && x.StayDate >= query.CheckIn && x.StayDate < query.CheckOut).ToDictionaryAsync(x => x.StayDate, cancellationToken);
        var days = new List<DailyEffectiveInventoryDto>();
        for (var date = query.CheckIn; date < query.CheckOut; date = date.AddDays(1))
        {
            controls.TryGetValue(date, out var control);
            var effective = control?.IsStopSell == true ? 0 : Math.Min(baseInventory, control?.SellableLimit ?? baseInventory);
            days.Add(new DailyEffectiveInventoryDto(date, baseInventory, control?.SellableLimit, control?.IsStopSell ?? false, effective));
        }
        return new EffectiveInventoryRangeDto(query.PropertyId, query.RoomTypeId, query.CheckIn, query.CheckOut, baseInventory, days.Min(x => x.EffectiveInventory), days);
    }
}
