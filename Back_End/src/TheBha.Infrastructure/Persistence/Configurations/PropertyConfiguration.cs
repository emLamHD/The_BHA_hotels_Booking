using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class PropertyConfiguration : IEntityTypeConfiguration<Property>
{
    public void Configure(EntityTypeBuilder<Property> builder)
    {
        builder.ToTable("Properties");
        builder.HasKey(property => property.Id);
        builder.Property(property => property.Name).HasMaxLength(200).IsRequired();
        builder.Property(property => property.Slug).HasMaxLength(200).IsRequired();
        builder.Property(property => property.Description).HasMaxLength(4000);
        builder.Property(property => property.Address).HasMaxLength(500).IsRequired();
        builder.Property(property => property.City).HasMaxLength(120).IsRequired();
        builder.Property(property => property.Country).HasMaxLength(120).IsRequired();
        builder.Property(property => property.TimeZone).HasMaxLength(100).IsRequired();
        builder.Property(property => property.CheckInTime).HasColumnType("time without time zone");
        builder.Property(property => property.CheckOutTime).HasColumnType("time without time zone");
        builder.Property(property => property.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(property => property.UpdatedAt).HasColumnType("timestamp with time zone");
        builder.HasIndex(property => property.Slug).IsUnique();
    }
}
