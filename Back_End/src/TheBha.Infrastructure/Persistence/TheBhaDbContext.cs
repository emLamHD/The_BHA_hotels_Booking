using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

public sealed class TheBhaDbContext(DbContextOptions<TheBhaDbContext> options)
    : DbContext(options)
{
    public DbSet<Property> Properties => Set<Property>();
    public DbSet<RoomType> RoomTypes => Set<RoomType>();
    public DbSet<RatePlan> RatePlans => Set<RatePlan>();
    public DbSet<DailyRoomRate> DailyRoomRates => Set<DailyRoomRate>();
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
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(TheBhaDbContext).Assembly);
    }
}
