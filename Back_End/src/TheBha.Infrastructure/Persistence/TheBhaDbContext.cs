using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Identity;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

public sealed class TheBhaDbContext(DbContextOptions<TheBhaDbContext> options)
    : IdentityUserContext<CustomerAccount, Guid>(options)
{
    public DbSet<CustomerAccount> CustomerAccounts => Set<CustomerAccount>();
    public DbSet<InventoryHold> InventoryHolds => Set<InventoryHold>();
    public DbSet<InventoryHoldItem> InventoryHoldItems => Set<InventoryHoldItem>();
    public DbSet<InventoryHoldItemNight> InventoryHoldItemNights => Set<InventoryHoldItemNight>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<ReservationUnit> ReservationUnits => Set<ReservationUnit>();
    public DbSet<ReservationUnitNight> ReservationUnitNights => Set<ReservationUnitNight>();
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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(TheBhaDbContext).Assembly);
    }
}
