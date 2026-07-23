using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class ReservationConfiguration : IEntityTypeConfiguration<Reservation>
{
    public void Configure(EntityTypeBuilder<Reservation> builder)
    {
        builder.ToTable("Reservations", table =>
        {
            table.HasCheckConstraint(
                "CK_Reservations_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"SourceHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "(\"CustomerAccountId\" IS NULL OR \"CustomerAccountId\" <> " +
                "'00000000-0000-0000-0000-000000000000'::uuid)");
            table.HasCheckConstraint(
                "CK_Reservations_ConfirmationNumber",
                "\"ConfirmationNumber\" ~ '^[A-Z0-9-]+$'");
            table.HasCheckConstraint(
                "CK_Reservations_Contact",
                "btrim(\"FullName\") <> '' AND btrim(\"Email\") <> '' AND btrim(\"Phone\") <> ''");
            table.HasCheckConstraint(
                "CK_Reservations_Stay",
                "\"CheckIn\" < \"CheckOut\"");
            table.HasCheckConstraint(
                "CK_Reservations_Occupancy",
                "\"Adults\" >= 1 AND \"Children\" >= 0 AND \"Rooms\" >= 1");
            table.HasCheckConstraint(
                "CK_Reservations_Currency",
                "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
            table.HasCheckConstraint(
                "CK_Reservations_TotalAmount",
                "\"TotalAmount\" > 0");
            table.HasCheckConstraint(
                "CK_Reservations_Status",
                "\"Status\" IN ('Confirmed', 'Cancelled')");
            table.HasCheckConstraint(
                "CK_Reservations_Hash",
                "\"GuestAccessTokenHash\" IS NULL OR " +
                "\"GuestAccessTokenHash\" ~ '^[0-9a-f]{64}$'");
            table.HasCheckConstraint(
                "CK_Reservations_Ownership",
                "(\"CustomerAccountId\" IS NOT NULL AND \"GuestAccessTokenHash\" IS NULL) OR " +
                "(\"CustomerAccountId\" IS NULL AND \"GuestAccessTokenHash\" IS NOT NULL)");
            table.HasCheckConstraint(
                "CK_Reservations_Cancellation",
                "(\"Status\" = 'Confirmed' AND \"CancelledAtUtc\" IS NULL AND " +
                "\"CancellationReason\" IS NULL) OR " +
                "(\"Status\" = 'Cancelled' AND \"CancelledAtUtc\" IS NOT NULL AND " +
                "\"CancelledAtUtc\" >= \"ConfirmedAtUtc\" AND " +
                "\"CancellationReason\" IS NOT NULL AND btrim(\"CancellationReason\") <> '')");
        });

        builder.HasKey(reservation => reservation.Id);
        builder.Property(reservation => reservation.ConfirmationNumber)
            .HasMaxLength(BookingFieldLimits.ConfirmationNumber)
            .IsRequired();
        builder.Property(reservation => reservation.FullName)
            .HasMaxLength(BookingFieldLimits.FullName)
            .IsRequired();
        builder.Property(reservation => reservation.Email)
            .HasMaxLength(BookingFieldLimits.Email)
            .IsRequired();
        builder.Property(reservation => reservation.Phone)
            .HasMaxLength(BookingFieldLimits.Phone)
            .IsRequired();
        builder.Property(reservation => reservation.CheckIn).HasColumnType("date");
        builder.Property(reservation => reservation.CheckOut).HasColumnType("date");
        builder.Property(reservation => reservation.CurrencyCode)
            .HasMaxLength(3)
            .IsRequired();
        builder.Property(reservation => reservation.TotalAmount).HasPrecision(18, 2);
        builder.Property(reservation => reservation.Status)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(reservation => reservation.ConfirmedAtUtc)
            .HasColumnType("timestamp with time zone");
        builder.Property(reservation => reservation.CancelledAtUtc)
            .HasColumnType("timestamp with time zone");
        builder.Property(reservation => reservation.CancellationReason)
            .HasMaxLength(BookingFieldLimits.CancellationReason);
        builder.Property(reservation => reservation.GuestAccessTokenHash)
            .HasMaxLength(BookingFieldLimits.Sha256Hash)
            .IsFixedLength();

        builder.HasIndex(reservation => reservation.SourceHoldId).IsUnique();
        builder.HasIndex(reservation => reservation.ConfirmationNumber).IsUnique();
        builder.HasIndex(reservation => new
        {
            reservation.PropertyId,
            reservation.RoomTypeId,
            reservation.Status
        });

        builder.HasOne<BookingHold>()
            .WithOne()
            .HasForeignKey<Reservation>(reservation => reservation.SourceHoldId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Property>()
            .WithMany()
            .HasForeignKey(reservation => reservation.PropertyId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RoomType>()
            .WithMany()
            .HasForeignKey(reservation => new
            {
                reservation.PropertyId,
                reservation.RoomTypeId
            })
            .HasPrincipalKey(roomType => new { roomType.PropertyId, roomType.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RatePlan>()
            .WithMany()
            .HasForeignKey(reservation => new
            {
                reservation.PropertyId,
                reservation.RatePlanId
            })
            .HasPrincipalKey(ratePlan => new { ratePlan.PropertyId, ratePlan.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<CustomerAccount>()
            .WithMany()
            .HasForeignKey(reservation => reservation.CustomerAccountId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(reservation => reservation.Nights)
            .WithOne()
            .HasForeignKey(night => night.ReservationId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(reservation => reservation.Nights)
            .UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
