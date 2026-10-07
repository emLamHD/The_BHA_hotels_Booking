using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class RoomTypeMediaConfiguration : IEntityTypeConfiguration<RoomTypeMedia>
{
    public void Configure(EntityTypeBuilder<RoomTypeMedia> builder)
    {
        builder.ToTable(
            "RoomTypeMedia",
            table => table.HasCheckConstraint("CK_RoomTypeMedia_SortOrder", "\"SortOrder\" >= 0"));
        builder.HasKey(link => new { link.RoomTypeId, link.MediaId });
        builder.HasIndex(link => link.RoomTypeId).IsUnique().HasFilter("\"IsCover\"");
        builder.HasOne(link => link.RoomType).WithMany().HasForeignKey(link => link.RoomTypeId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(link => link.Media).WithMany().HasForeignKey(link => link.MediaId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
