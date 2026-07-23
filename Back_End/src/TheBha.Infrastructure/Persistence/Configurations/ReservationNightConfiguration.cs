using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class ReservationNightConfiguration
    : IEntityTypeConfiguration<ReservationNight>
{
    public void Configure(EntityTypeBuilder<ReservationNight> builder)
    {
        builder.ToTable("ReservationNights", table =>
        {
            table.HasCheckConstraint(
                "CK_ReservationNights_ReservationId",
                "\"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint(
                "CK_ReservationNights_Rooms",
                "\"Rooms\" >= 1");
            table.HasCheckConstraint(
                "CK_ReservationNights_Amounts",
                "\"UnitAmount\" > 0 AND \"NightTotal\" > 0 AND " +
                "\"NightTotal\" = \"UnitAmount\" * \"Rooms\"");
        });

        builder.HasKey(night => new { night.ReservationId, night.StayDate });
        builder.Property(night => night.StayDate).HasColumnType("date");
        builder.Property(night => night.UnitAmount).HasPrecision(18, 2);
        builder.Property(night => night.NightTotal).HasPrecision(18, 2);
        builder.HasIndex(night => new { night.StayDate, night.ReservationId });
    }
}
