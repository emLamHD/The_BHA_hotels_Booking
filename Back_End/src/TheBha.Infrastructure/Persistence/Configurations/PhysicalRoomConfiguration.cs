using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class PhysicalRoomConfiguration : IEntityTypeConfiguration<PhysicalRoom>
{
    public void Configure(EntityTypeBuilder<PhysicalRoom> builder)
    {
        builder.ToTable(
            "PhysicalRooms",
            table => table.HasCheckConstraint(
                "CK_PhysicalRooms_OperationalStatus",
                "\"OperationalStatus\" IN ('Active', 'Inactive', 'OutOfService')"));
        builder.HasKey(room => room.Id);
        builder.Property(room => room.RoomNumber).HasMaxLength(50).IsRequired();
        builder.Property(room => room.OperationalStatus).HasConversion<string>().HasMaxLength(30);
        builder.Property(room => room.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(room => room.UpdatedAt).HasColumnType("timestamp with time zone");
        builder.HasIndex(room => new { room.PropertyId, room.RoomNumber }).IsUnique();
        builder.HasOne<Property>()
            .WithMany()
            .HasForeignKey(room => room.PropertyId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RoomType>()
            .WithMany()
            .HasForeignKey(room => new { room.PropertyId, room.RoomTypeId })
            .HasPrincipalKey(roomType => new { roomType.PropertyId, roomType.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
