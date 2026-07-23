using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class BookingHoldNightConfiguration
    : IEntityTypeConfiguration<BookingHoldNight>
{
    public void Configure(EntityTypeBuilder<BookingHoldNight> builder)
    {
        builder.ToTable("BookingHoldNights", table =>
        {
            table.HasCheckConstraint(
                "CK_BookingHoldNights_BookingHoldId",
                "\"BookingHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint(
                "CK_BookingHoldNights_Rooms",
                "\"Rooms\" >= 1");
            table.HasCheckConstraint(
                "CK_BookingHoldNights_Amounts",
                "\"UnitAmount\" > 0 AND \"NightTotal\" > 0 AND " +
                "\"NightTotal\" = \"UnitAmount\" * \"Rooms\"");
        });

        builder.HasKey(night => new { night.BookingHoldId, night.StayDate });
        builder.Property(night => night.StayDate).HasColumnType("date");
        builder.Property(night => night.UnitAmount).HasPrecision(18, 2);
        builder.Property(night => night.NightTotal).HasPrecision(18, 2);
        builder.HasIndex(night => new { night.StayDate, night.BookingHoldId });
    }
}
