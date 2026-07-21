using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class PropertyMediaConfiguration : IEntityTypeConfiguration<PropertyMedia>
{
    public void Configure(EntityTypeBuilder<PropertyMedia> builder)
    {
        builder.ToTable(
            "PropertyMedia",
            table => table.HasCheckConstraint("CK_PropertyMedia_SortOrder", "\"SortOrder\" >= 0"));
        builder.HasKey(link => new { link.PropertyId, link.MediaId });
        builder.HasIndex(link => link.PropertyId).IsUnique().HasFilter("\"IsCover\"");
        builder.HasOne(link => link.Property).WithMany().HasForeignKey(link => link.PropertyId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(link => link.Media).WithMany().HasForeignKey(link => link.MediaId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
