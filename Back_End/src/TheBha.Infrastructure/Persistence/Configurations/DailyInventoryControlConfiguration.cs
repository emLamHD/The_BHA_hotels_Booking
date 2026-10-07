using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class DailyInventoryControlConfiguration : IEntityTypeConfiguration<DailyInventoryControl>
{
    public void Configure(EntityTypeBuilder<DailyInventoryControl> builder)
    {
        builder.ToTable("DailyInventoryControls", table =>
        {
            table.HasCheckConstraint("CK_DailyInventoryControls_SellableLimit", "\"SellableLimit\" IS NULL OR \"SellableLimit\" >= 0");
            table.HasCheckConstraint("CK_DailyInventoryControls_Effect", "\"SellableLimit\" IS NOT NULL OR \"IsStopSell\" = TRUE");
            table.HasCheckConstraint("CK_DailyInventoryControls_Timestamps", "\"UpdatedAt\" >= \"CreatedAt\"");
        });
        builder.HasKey(x => x.Id);
        builder.Property(x => x.StayDate).HasColumnType("date");
        builder.Property(x => x.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(x => x.UpdatedAt).HasColumnType("timestamp with time zone");
        builder.HasIndex(x => new { x.PropertyId, x.RoomTypeId, x.StayDate }).IsUnique();
        builder.HasIndex(x => new { x.PropertyId, x.StayDate });
        builder.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RoomType>().WithMany().HasForeignKey(x => new { x.PropertyId, x.RoomTypeId }).HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Restrict);
    }
}
