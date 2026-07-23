using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class BookingHoldConfiguration : IEntityTypeConfiguration<BookingHold>
{
    public void Configure(EntityTypeBuilder<BookingHold> builder)
    {
        builder.ToTable("BookingHolds", table =>
        {
            table.HasCheckConstraint(
                "CK_BookingHolds_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "(\"CustomerAccountId\" IS NULL OR \"CustomerAccountId\" <> " +
                "'00000000-0000-0000-0000-000000000000'::uuid)");
            table.HasCheckConstraint(
                "CK_BookingHolds_Contact",
                "btrim(\"FullName\") <> '' AND btrim(\"Email\") <> '' AND btrim(\"Phone\") <> ''");
            table.HasCheckConstraint(
                "CK_BookingHolds_Stay",
                "\"CheckIn\" < \"CheckOut\"");
            table.HasCheckConstraint(
                "CK_BookingHolds_Occupancy",
                "\"Adults\" >= 1 AND \"Children\" >= 0 AND \"Rooms\" >= 1");
            table.HasCheckConstraint(
                "CK_BookingHolds_Currency",
                "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
            table.HasCheckConstraint(
                "CK_BookingHolds_TotalAmount",
                "\"TotalAmount\" > 0");
            table.HasCheckConstraint(
                "CK_BookingHolds_Status",
                "\"Status\" IN ('Active', 'Confirmed', 'Cancelled')");
            table.HasCheckConstraint(
                "CK_BookingHolds_FixedLifetime",
                "\"ExpiresAtUtc\" = \"CreatedAtUtc\" + INTERVAL '15 minutes'");
            table.HasCheckConstraint(
                "CK_BookingHolds_Hashes",
                "\"IdempotencyKeyHash\" ~ '^[0-9a-f]{64}$' AND " +
                "\"RequestFingerprint\" ~ '^[0-9a-f]{64}$' AND " +
                "(\"GuestAccessTokenHash\" IS NULL OR " +
                "\"GuestAccessTokenHash\" ~ '^[0-9a-f]{64}$')");
            table.HasCheckConstraint(
                "CK_BookingHolds_Ownership",
                "(\"CustomerAccountId\" IS NOT NULL AND \"GuestAccessTokenHash\" IS NULL) OR " +
                "(\"CustomerAccountId\" IS NULL AND \"GuestAccessTokenHash\" IS NOT NULL)");
        });

        builder.HasKey(hold => hold.Id);
        builder.Property(hold => hold.FullName)
            .HasMaxLength(BookingFieldLimits.FullName)
            .IsRequired();
        builder.Property(hold => hold.Email)
            .HasMaxLength(BookingFieldLimits.Email)
            .IsRequired();
        builder.Property(hold => hold.Phone)
            .HasMaxLength(BookingFieldLimits.Phone)
            .IsRequired();
        builder.Property(hold => hold.CheckIn).HasColumnType("date");
        builder.Property(hold => hold.CheckOut).HasColumnType("date");
        builder.Property(hold => hold.CurrencyCode).HasMaxLength(3).IsRequired();
        builder.Property(hold => hold.TotalAmount).HasPrecision(18, 2);
        builder.Property(hold => hold.Status)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(hold => hold.CreatedAtUtc)
            .HasColumnType("timestamp with time zone");
        builder.Property(hold => hold.ExpiresAtUtc)
            .HasColumnType("timestamp with time zone");
        builder.Property(hold => hold.IdempotencyKeyHash)
            .HasMaxLength(BookingFieldLimits.Sha256Hash)
            .IsFixedLength()
            .IsRequired();
        builder.Property(hold => hold.RequestFingerprint)
            .HasMaxLength(BookingFieldLimits.Sha256Hash)
            .IsFixedLength()
            .IsRequired();
        builder.Property(hold => hold.GuestAccessTokenHash)
            .HasMaxLength(BookingFieldLimits.Sha256Hash)
            .IsFixedLength();

        builder.HasIndex(hold => hold.IdempotencyKeyHash).IsUnique();
        builder.HasIndex(hold => new
        {
            hold.PropertyId,
            hold.RoomTypeId,
            hold.Status,
            hold.ExpiresAtUtc
        });

        builder.HasOne<Property>()
            .WithMany()
            .HasForeignKey(hold => hold.PropertyId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RoomType>()
            .WithMany()
            .HasForeignKey(hold => new { hold.PropertyId, hold.RoomTypeId })
            .HasPrincipalKey(roomType => new { roomType.PropertyId, roomType.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RatePlan>()
            .WithMany()
            .HasForeignKey(hold => new { hold.PropertyId, hold.RatePlanId })
            .HasPrincipalKey(ratePlan => new { ratePlan.PropertyId, ratePlan.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<CustomerAccount>()
            .WithMany()
            .HasForeignKey(hold => hold.CustomerAccountId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(hold => hold.Nights)
            .WithOne()
            .HasForeignKey(night => night.BookingHoldId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(hold => hold.Nights)
            .UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
