using Microsoft.EntityFrameworkCore;
using TheBha.Application.Properties;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class DailyInventoryControlStore(TheBhaDbContext dbContext) : IDailyInventoryControlStore
{
    public Task<bool> PropertyExistsAsync(Guid id, CancellationToken ct) => dbContext.Properties.AnyAsync(x => x.Id == id, ct);
    public Task<bool> RoomTypeBelongsToPropertyAsync(Guid propertyId, Guid roomTypeId, CancellationToken ct) => dbContext.RoomTypes.AnyAsync(x => x.PropertyId == propertyId && x.Id == roomTypeId, ct);
    public Task<DailyInventoryControl?> FindAsync(Guid propertyId, Guid roomTypeId, DateOnly date, CancellationToken ct) => dbContext.DailyInventoryControls.SingleOrDefaultAsync(x => x.PropertyId == propertyId && x.RoomTypeId == roomTypeId && x.StayDate == date, ct);
    public async Task SaveAsync(DailyInventoryControl control, CancellationToken ct) { if (dbContext.Entry(control).State == EntityState.Detached) dbContext.DailyInventoryControls.Add(control); await dbContext.SaveChangesAsync(ct); }
    public async Task<bool> DeleteAsync(DailyInventoryControl control, CancellationToken ct) { dbContext.DailyInventoryControls.Remove(control); return await dbContext.SaveChangesAsync(ct) > 0; }
}
