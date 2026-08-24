using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class InventoryHoldItemConfiguration : IEntityTypeConfiguration<InventoryHoldItem>
{
    public void Configure(EntityTypeBuilder<InventoryHoldItem> builder)
    {
        builder.ToTable("InventoryHoldItems", table =>
        {
            table.HasCheckConstraint(
                "CK_InventoryHoldItems_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"InventoryHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
        });

        builder.HasKey(item => item.Id);
        builder.HasAlternateKey(item => new { item.PropertyId, item.Id });
        builder.HasIndex(item => item.InventoryHoldId);
        builder.HasIndex(item => new { item.PropertyId, item.RoomTypeId });

        builder.HasOne<RoomType>()
            .WithMany()
            .HasForeignKey(item => new { item.PropertyId, item.RoomTypeId })
            .HasPrincipalKey(roomType => new { roomType.PropertyId, roomType.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(item => item.Nights)
            .WithOne()
            .HasPrincipalKey(item => new { item.PropertyId, item.Id })
            .HasForeignKey(night => new { night.PropertyId, night.InventoryHoldItemId })
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(item => item.Nights)
            .UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
