using Microsoft.EntityFrameworkCore;
using TheBha.Application.Properties;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class DailyRoomRateStore(TheBhaDbContext dbContext) : IDailyRoomRateStore
{
    public Task<bool> PropertyExistsAsync(Guid id, CancellationToken ct) => dbContext.Properties.AnyAsync(x => x.Id == id, ct);
    public Task<bool> RoomTypeBelongsToPropertyAsync(Guid propertyId, Guid roomTypeId, CancellationToken ct) => dbContext.RoomTypes.AnyAsync(x => x.PropertyId == propertyId && x.Id == roomTypeId, ct);
    public Task<bool> RatePlanBelongsToPropertyAsync(Guid propertyId, Guid ratePlanId, CancellationToken ct) => dbContext.RatePlans.AnyAsync(x => x.PropertyId == propertyId && x.Id == ratePlanId, ct);
    public Task<DailyRoomRate?> FindAsync(Guid p, Guid r, Guid plan, DateOnly date, CancellationToken ct) => dbContext.DailyRoomRates.SingleOrDefaultAsync(x => x.PropertyId == p && x.RoomTypeId == r && x.RatePlanId == plan && x.StayDate == date, ct);
    public async Task SaveAsync(DailyRoomRate rate, CancellationToken ct) { if (dbContext.Entry(rate).State == EntityState.Detached) dbContext.DailyRoomRates.Add(rate); await dbContext.SaveChangesAsync(ct); }
}
