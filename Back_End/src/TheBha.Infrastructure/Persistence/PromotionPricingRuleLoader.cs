using Microsoft.EntityFrameworkCore;
using TheBha.Application.Promotions;
using TheBha.Domain.Promotions;

namespace TheBha.Infrastructure.Persistence;

/// <summary>The Active promotions of a Property as pricing rules. Quote and Hold read them through this one query.</summary>
internal static class PromotionPricingRuleLoader
{
    public static async Task<IReadOnlyList<PromotionPricingRule>> LoadActiveAsync(
        TheBhaDbContext dbContext,
        Guid propertyId,
        CancellationToken cancellationToken)
    {
        var rows = await dbContext.Promotions.AsNoTracking()
            .Where(x => x.PropertyId == propertyId && x.Status == PromotionStatus.Active)
            .Select(x => new
            {
                x.Id, x.Version, x.Slug, x.Title, x.Kind, x.Value, x.CurrencyCode, x.AllRoomTypes,
                RoomTypeIds = x.RoomTypes.Select(r => r.RoomTypeId).ToList(),
                x.BookingFrom, x.BookingTo, x.StayFrom, x.StayTo, x.MinNights, x.CreatedAtUtc
            })
            .ToListAsync(cancellationToken);
        return rows.Select(x => new PromotionPricingRule(
            x.Id, x.Version, x.Slug, x.Title, x.Kind, x.Value, x.CurrencyCode, x.AllRoomTypes, x.RoomTypeIds,
            x.BookingFrom, x.BookingTo, x.StayFrom, x.StayTo, x.MinNights, x.CreatedAtUtc)).ToList();
    }
}
