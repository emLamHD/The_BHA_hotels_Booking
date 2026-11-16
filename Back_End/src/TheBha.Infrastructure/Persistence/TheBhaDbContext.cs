using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Blog;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Identity;
using TheBha.Domain.Promotions;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

public sealed class TheBhaDbContext(DbContextOptions<TheBhaDbContext> options)
    : IdentityUserContext<CustomerAccount, Guid>(options)
{
    public DbSet<CustomerAccount> CustomerAccounts => Set<CustomerAccount>();
    public DbSet<StaffAccount> StaffAccounts => Set<StaffAccount>();
    public DbSet<StaffPropertyMembership> StaffPropertyMemberships => Set<StaffPropertyMembership>();
    public DbSet<InventoryHold> InventoryHolds => Set<InventoryHold>();
    public DbSet<InventoryHoldItem> InventoryHoldItems => Set<InventoryHoldItem>();
    public DbSet<InventoryHoldItemNight> InventoryHoldItemNights => Set<InventoryHoldItemNight>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<ReservationUnit> ReservationUnits => Set<ReservationUnit>();
    public DbSet<ReservationUnitNight> ReservationUnitNights => Set<ReservationUnitNight>();
    public DbSet<CatalogContentAudit> CatalogContentAudits => Set<CatalogContentAudit>();
    public DbSet<AdminCatalogCreateOperation> AdminCatalogCreateOperations => Set<AdminCatalogCreateOperation>();
    public DbSet<CatalogUpload> CatalogUploads => Set<CatalogUpload>();
    public DbSet<Property> Properties => Set<Property>();
    public DbSet<RoomType> RoomTypes => Set<RoomType>();
    public DbSet<RatePlan> RatePlans => Set<RatePlan>();
    public DbSet<DailyRoomRate> DailyRoomRates => Set<DailyRoomRate>();
    public DbSet<DailyInventoryControl> DailyInventoryControls => Set<DailyInventoryControl>();
    public DbSet<PhysicalRoom> PhysicalRooms => Set<PhysicalRoom>();
    public DbSet<Amenity> Amenities => Set<Amenity>();
    public DbSet<Media> Media => Set<Media>();
    public DbSet<PropertyAmenity> PropertyAmenities => Set<PropertyAmenity>();
    public DbSet<RoomTypeAmenity> RoomTypeAmenities => Set<RoomTypeAmenity>();
    public DbSet<PropertyMedia> PropertyMedia => Set<PropertyMedia>();
    public DbSet<RoomTypeMedia> RoomTypeMedia => Set<RoomTypeMedia>();
    public DbSet<RoomBlock> RoomBlocks => Set<RoomBlock>();
    public DbSet<RoomOccupancySegment> RoomOccupancySegments => Set<RoomOccupancySegment>();
    public DbSet<RoomOccupancySegmentAudit> RoomOccupancySegmentAudits => Set<RoomOccupancySegmentAudit>();
    public DbSet<WebsiteLanguage> WebsiteLanguages => Set<WebsiteLanguage>();
    public DbSet<WebsiteTranslation> WebsiteTranslations => Set<WebsiteTranslation>();
    public DbSet<WebsiteCurrency> WebsiteCurrencies => Set<WebsiteCurrency>();
    public DbSet<WebsiteMenuItem> WebsiteMenuItems => Set<WebsiteMenuItem>();
    public DbSet<WebsiteMenuState> WebsiteMenuState => Set<WebsiteMenuState>();
    public DbSet<WebsiteHeroMedia> WebsiteHeroMedia => Set<WebsiteHeroMedia>();
    public DbSet<WebsiteHeroSlide> WebsiteHeroSlides => Set<WebsiteHeroSlide>();
    public DbSet<WebsiteHeroSettings> WebsiteHero => Set<WebsiteHeroSettings>();
    public DbSet<WebsiteSocialSettings> WebsiteSocialSettings => Set<WebsiteSocialSettings>();
    public DbSet<Promotion> Promotions => Set<Promotion>();
    public DbSet<PromotionMedia> PromotionMedia => Set<PromotionMedia>();
    public DbSet<PromotionAudit> PromotionAudits => Set<PromotionAudit>();
    public DbSet<BookingPromotionApplication> BookingPromotionApplications => Set<BookingPromotionApplication>();
    public DbSet<BlogCategory> BlogCategories => Set<BlogCategory>();
    public DbSet<BlogCategoryTranslation> BlogCategoryTranslations => Set<BlogCategoryTranslation>();
    public DbSet<BlogCategorySlug> BlogCategorySlugs => Set<BlogCategorySlug>();
    public DbSet<BlogCategoryPin> BlogCategoryPins => Set<BlogCategoryPin>();
    public DbSet<BlogPost> BlogPosts => Set<BlogPost>();
    public DbSet<BlogPostTranslation> BlogPostTranslations => Set<BlogPostTranslation>();
    public DbSet<BlogPostRevision> BlogPostRevisions => Set<BlogPostRevision>();
    public DbSet<BlogRevisionCategory> BlogRevisionCategories => Set<BlogRevisionCategory>();
    public DbSet<BlogRevisionMedia> BlogRevisionMedia => Set<BlogRevisionMedia>();
    public DbSet<BlogPostSlug> BlogPostSlugs => Set<BlogPostSlug>();
    public DbSet<BlogMedia> BlogMedia => Set<BlogMedia>();
    public DbSet<BlogMediaVariant> BlogMediaVariants => Set<BlogMediaVariant>();
    public DbSet<BlogSettings> BlogSettings => Set<BlogSettings>();

    /// <summary>BHA-CONTENT-PERSIST-001-C1: which content-pack rows an import has placed; see <see cref="ContentPack.ContentPackLedgerEntry"/>.</summary>
    public DbSet<ContentPack.ContentPackLedgerEntry> ContentPackLedger => Set<ContentPack.ContentPackLedgerEntry>();
    public DbSet<BlogAudit> BlogAudits => Set<BlogAudit>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(TheBhaDbContext).Assembly);
    }
}
