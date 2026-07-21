using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class RoomTypeAmenityConfiguration : IEntityTypeConfiguration<RoomTypeAmenity>
{
    public void Configure(EntityTypeBuilder<RoomTypeAmenity> builder)
    {
        builder.ToTable("RoomTypeAmenities");
        builder.HasKey(link => new { link.RoomTypeId, link.AmenityId });
        builder.HasOne(link => link.RoomType).WithMany().HasForeignKey(link => link.RoomTypeId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(link => link.Amenity).WithMany().HasForeignKey(link => link.AmenityId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
