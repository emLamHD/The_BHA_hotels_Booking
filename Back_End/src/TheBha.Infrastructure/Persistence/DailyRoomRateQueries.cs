using Microsoft.EntityFrameworkCore;
using TheBha.Application.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class DailyRoomRateQueries(TheBhaDbContext dbContext) : IDailyRoomRateQueries
{
    public async Task<IReadOnlyList<DailyRoomRateDto>> GetRangeAsync(DailyRoomRateRangeQuery query, CancellationToken cancellationToken)
    {
        query.Validate();
        return await dbContext.DailyRoomRates.AsNoTracking()
            .Where(x => x.PropertyId == query.PropertyId && x.RoomTypeId == query.RoomTypeId && x.RatePlanId == query.RatePlanId && x.StayDate >= query.CheckIn && x.StayDate < query.CheckOut)
            .OrderBy(x => x.StayDate)
            .Select(x => new DailyRoomRateDto(x.Id, x.PropertyId, x.RoomTypeId, x.RatePlanId, x.StayDate, x.Amount, x.CreatedAt, x.UpdatedAt))
            .ToListAsync(cancellationToken);
    }
}
