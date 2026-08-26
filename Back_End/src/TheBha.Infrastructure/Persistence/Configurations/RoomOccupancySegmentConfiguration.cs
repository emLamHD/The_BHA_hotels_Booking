using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class RoomOccupancySegmentConfiguration : IEntityTypeConfiguration<RoomOccupancySegment>
{
    public void Configure(EntityTypeBuilder<RoomOccupancySegment> builder)
    {
        builder.ToTable("RoomOccupancySegments", table =>
        {
            table.HasCheckConstraint(
                "CK_RoomOccupancySegments_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PhysicalRoomId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "(\"ReservationUnitId\" IS NULL OR \"ReservationUnitId\" <> " +
                "'00000000-0000-0000-0000-000000000000'::uuid) AND " +
                "(\"RoomBlockId\" IS NULL OR \"RoomBlockId\" <> " +
                "'00000000-0000-0000-0000-000000000000'::uuid)");
            table.HasCheckConstraint(
                "CK_RoomOccupancySegments_Type",
                "\"Type\" IN ('ReservationAssignment', 'OperationalBlock')");
            table.HasCheckConstraint(
                "CK_RoomOccupancySegments_Status",
                "\"Status\" IN ('Effective', 'Cancelled')");
            table.HasCheckConstraint(
                "CK_RoomOccupancySegments_DateRange",
                "\"StartDate\" < \"EndDate\"");
            table.HasCheckConstraint(
                "CK_RoomOccupancySegments_TypeReference",
                "(\"Type\" = 'ReservationAssignment' AND \"ReservationUnitId\" IS NOT NULL AND " +
                "\"RoomBlockId\" IS NULL) OR " +
                "(\"Type\" = 'OperationalBlock' AND \"RoomBlockId\" IS NOT NULL AND " +
                "\"ReservationUnitId\" IS NULL)");
        });

        builder.HasKey(segment => segment.Id);
        builder.HasAlternateKey(segment => new { segment.PropertyId, segment.Id });
        builder.Property(segment => segment.Type)
            .HasConversion<string>()
            .HasMaxLength(30)
            .IsRequired();
        builder.Property(segment => segment.Status)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(segment => segment.StartDate).HasColumnType("date");
        builder.Property(segment => segment.EndDate).HasColumnType("date");
        builder.Property(segment => segment.CreatedAtUtc).HasColumnType("timestamp with time zone");

        // Optimistic concurrency from day one (PMS-BE-001.2 §7.5), via PostgreSQL's
        // built-in xmin system column rather than an extra application-managed column.
        builder.Property<uint>("xmin")
            .HasColumnName("xmin")
            .HasColumnType("xid")
            .ValueGeneratedOnAddOrUpdate()
            .IsRowVersion();

        builder.HasIndex(segment => new { segment.PropertyId, segment.PhysicalRoomId, segment.Status });
        builder.HasIndex(segment => new { segment.PropertyId, segment.ReservationUnitId, segment.Status });
        builder.HasIndex(segment => new { segment.PropertyId, segment.RoomBlockId, segment.Status });
        builder.HasIndex(segment => new { segment.PropertyId, segment.Type, segment.Status });

        builder.HasOne<PhysicalRoom>()
            .WithMany()
            .HasForeignKey(segment => new { segment.PropertyId, segment.PhysicalRoomId })
            .HasPrincipalKey(room => new { room.PropertyId, room.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ReservationUnit>()
            .WithMany()
            .HasForeignKey(segment => new { segment.PropertyId, segment.ReservationUnitId })
            .HasPrincipalKey(unit => new { unit.PropertyId, unit.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RoomBlock>()
            .WithMany()
            .HasForeignKey(segment => new { segment.PropertyId, segment.RoomBlockId })
            .HasPrincipalKey(block => new { block.PropertyId, block.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
