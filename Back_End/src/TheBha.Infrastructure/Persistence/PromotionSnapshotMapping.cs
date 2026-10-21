using TheBha.Application.Promotions;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence;

internal static class PromotionSnapshotMapping
{
    /// <summary>The promotion exactly as it was when the Hold was made (never the promotion's current state).</summary>
    public static AppliedPromotionDto? ToDto(BookingPromotionApplication? snapshot) => snapshot is null
        ? null
        : new(snapshot.PromotionId, snapshot.Slug, snapshot.Title, snapshot.Kind.ToString(), snapshot.Value, snapshot.CurrencyCode);
}
