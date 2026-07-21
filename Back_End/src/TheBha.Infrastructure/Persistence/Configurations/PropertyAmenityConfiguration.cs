using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class PropertyAmenityConfiguration : IEntityTypeConfiguration<PropertyAmenity>
{
    public void Configure(EntityTypeBuilder<PropertyAmenity> builder)
    {
        builder.ToTable("PropertyAmenities");
        builder.HasKey(link => new { link.PropertyId, link.AmenityId });
        builder.HasOne(link => link.Property).WithMany().HasForeignKey(link => link.PropertyId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(link => link.Amenity).WithMany().HasForeignKey(link => link.AmenityId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
