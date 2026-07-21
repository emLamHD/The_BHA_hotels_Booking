using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class AmenityConfiguration : IEntityTypeConfiguration<Amenity>
{
    public void Configure(EntityTypeBuilder<Amenity> builder)
    {
        builder.ToTable("Amenities");
        builder.HasKey(amenity => amenity.Id);
        builder.Property(amenity => amenity.Code).HasMaxLength(50).IsRequired();
        builder.Property(amenity => amenity.Name).HasMaxLength(200).IsRequired();
        builder.Property(amenity => amenity.Category).HasMaxLength(100).IsRequired();
        builder.HasIndex(amenity => amenity.Code).IsUnique();
    }
}
