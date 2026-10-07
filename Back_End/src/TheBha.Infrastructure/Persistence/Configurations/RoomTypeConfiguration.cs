using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class RoomTypeConfiguration : IEntityTypeConfiguration<RoomType>
{
    public void Configure(EntityTypeBuilder<RoomType> builder)
    {
        builder.ToTable(
            "RoomTypes",
            table =>
            {
                table.HasCheckConstraint("CK_RoomTypes_BaseOccupancy", "\"BaseOccupancy\" > 0");
                table.HasCheckConstraint(
                    "CK_RoomTypes_MaxOccupancy",
                    "\"MaxOccupancy\" >= \"BaseOccupancy\"");
            });
        builder.HasKey(roomType => roomType.Id);
        builder.HasAlternateKey(roomType => new { roomType.PropertyId, roomType.Id });
        builder.Property(roomType => roomType.Code).HasMaxLength(50).IsRequired();
        builder.Property(roomType => roomType.Name).HasMaxLength(200).IsRequired();
        builder.Property(roomType => roomType.Slug).HasMaxLength(200).IsRequired();
        builder.Property(roomType => roomType.Description).HasMaxLength(4000);
        builder.Property(roomType => roomType.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(roomType => roomType.UpdatedAt).HasColumnType("timestamp with time zone");
        builder.HasIndex(roomType => new { roomType.PropertyId, roomType.Code }).IsUnique();
        builder.HasIndex(roomType => new { roomType.PropertyId, roomType.Slug }).IsUnique();
        builder.HasOne<Property>()
            .WithMany()
            .HasForeignKey(roomType => roomType.PropertyId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
