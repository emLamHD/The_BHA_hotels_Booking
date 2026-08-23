using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class ReservationUnitConfiguration : IEntityTypeConfiguration<ReservationUnit>
{
    public void Configure(EntityTypeBuilder<ReservationUnit> builder)
    {
        builder.ToTable("ReservationUnits", table =>
        {
            table.HasCheckConstraint(
                "CK_ReservationUnits_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "(\"SourceInventoryHoldItemId\" IS NULL OR \"SourceInventoryHoldItemId\" <> " +
                "'00000000-0000-0000-0000-000000000000'::uuid)");
            table.HasCheckConstraint(
                "CK_ReservationUnits_CommitmentStatus",
                "\"CommitmentStatus\" IN ('Committed', 'Cancelled')");
        });

        builder.HasKey(unit => unit.Id);
        builder.HasAlternateKey(unit => new { unit.PropertyId, unit.Id });
        builder.Property(unit => unit.CommitmentStatus)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.HasIndex(unit => unit.ReservationId);
        builder.HasIndex(unit => unit.SourceInventoryHoldItemId).IsUnique();
        builder.HasIndex(unit => new { unit.PropertyId, unit.RoomTypeId, unit.CommitmentStatus });

        builder.HasOne<RoomType>()
            .WithMany()
            .HasForeignKey(unit => new { unit.PropertyId, unit.RoomTypeId })
            .HasPrincipalKey(roomType => new { roomType.PropertyId, roomType.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InventoryHoldItem>()
            .WithOne()
            .HasForeignKey<ReservationUnit>(unit => new
            {
                unit.PropertyId,
                unit.SourceInventoryHoldItemId
            })
            .HasPrincipalKey<InventoryHoldItem>(item => new { item.PropertyId, item.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(unit => unit.Nights)
            .WithOne()
            .HasPrincipalKey(unit => new { unit.PropertyId, unit.Id })
            .HasForeignKey(night => new { night.PropertyId, night.ReservationUnitId })
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(unit => unit.Nights)
            .UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
