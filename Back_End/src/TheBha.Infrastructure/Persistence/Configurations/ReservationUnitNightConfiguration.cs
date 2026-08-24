using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class ReservationUnitNightConfiguration
    : IEntityTypeConfiguration<ReservationUnitNight>
{
    public void Configure(EntityTypeBuilder<ReservationUnitNight> builder)
    {
        builder.ToTable("ReservationUnitNights", table =>
        {
            table.HasCheckConstraint(
                "CK_ReservationUnitNights_Ids",
                "\"ReservationUnitId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint(
                "CK_ReservationUnitNights_Amount",
                "\"UnitAmount\" > 0");
        });

        builder.HasKey(night => new { night.ReservationUnitId, night.StayDate });
        builder.Property(night => night.StayDate).HasColumnType("date");
        builder.Property(night => night.UnitAmount).HasPrecision(18, 2);
        builder.HasIndex(night => new { night.StayDate, night.ReservationUnitId });

        builder.HasOne<RatePlan>()
            .WithMany()
            .HasForeignKey(night => new { night.PropertyId, night.RatePlanId })
            .HasPrincipalKey(ratePlan => new { ratePlan.PropertyId, ratePlan.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
