using TheBha.Domain.Common;
using TheBha.Domain.Promotions;

namespace TheBha.Domain.Bookings;

/// <summary>What a Hold needs to remember about the promotion that priced it, copied at the moment of the Hold.</summary>
public sealed record AppliedPromotionSnapshot(
    Guid PromotionId,
    int PromotionVersion,
    string Slug,
    string Title,
    PromotionDiscountKind Kind,
    decimal Value,
    string? CurrencyCode);

/// <summary>
/// The promotion snapshot of one Hold, linked to its Reservation at confirmation. It is copied, never recalculated: editing,
/// disabling or expiring the promotion afterwards changes nothing here. The totals are derived from the nights by the Hold.
/// </summary>
public sealed class BookingPromotionApplication
{
    private BookingPromotionApplication()
    {
    }

    internal BookingPromotionApplication(Guid holdId, AppliedPromotionSnapshot promotion, decimal listTotalAmount, decimal discountTotalAmount)
    {
        HoldId = DomainGuard.RequiredId(holdId, nameof(holdId));
        PromotionId = DomainGuard.RequiredId(promotion.PromotionId, nameof(promotion.PromotionId));
        PromotionVersion = promotion.PromotionVersion >= 1 ? promotion.PromotionVersion : throw new DomainException("promotionVersion is out of range.");
        Slug = DomainGuard.Required(promotion.Slug, nameof(promotion.Slug), PromotionLimits.Slug);
        Title = DomainGuard.Required(promotion.Title, nameof(promotion.Title), PromotionLimits.Title);
        Kind = promotion.Kind;
        Value = promotion.Value > 0 ? promotion.Value : throw new DomainException("value must be greater than zero.");
        CurrencyCode = promotion.CurrencyCode;
        ListTotalAmount = listTotalAmount;
        DiscountTotalAmount = discountTotalAmount > 0 ? discountTotalAmount : throw new DomainException("discountTotalAmount must be greater than zero.");
    }

    public Guid HoldId { get; private set; }
    public Guid? ReservationId { get; private set; }
    public Guid PromotionId { get; private set; }
    public int PromotionVersion { get; private set; }
    public string Slug { get; private set; } = string.Empty;
    public string Title { get; private set; } = string.Empty;
    public PromotionDiscountKind Kind { get; private set; }
    public decimal Value { get; private set; }
    public string? CurrencyCode { get; private set; }
    public decimal ListTotalAmount { get; private set; }
    public decimal DiscountTotalAmount { get; private set; }

    internal void LinkReservation(Guid reservationId)
    {
        ReservationId = DomainGuard.RequiredId(reservationId, nameof(reservationId));
    }
}
