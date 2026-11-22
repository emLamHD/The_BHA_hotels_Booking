using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Notifications;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

/// <summary>
/// BHA-CHECKOUT-001-PR04. One Staff member's booking-notification choice at one Property. The foreign keys go to the Staff account and to the Property only, never to the membership: a membership revoked by the operator
/// must not be blocked by (Restrict) or silently delete (Cascade) the preference; the resolver reads the live membership instead. The address is a separate column of its own, never the login email.
/// </summary>
internal sealed class StaffBookingNotificationPreferenceConfiguration : IEntityTypeConfiguration<StaffBookingNotificationPreference>
{
    public void Configure(EntityTypeBuilder<StaffBookingNotificationPreference> builder)
    {
        builder.ToTable("StaffBookingNotificationPreferences", table =>
        {
            table.HasCheckConstraint("CK_StaffBookingNotificationPreferences_Email", "\"NotificationEmail\" IS NULL OR (btrim(\"NotificationEmail\") <> '' AND \"NotificationEmail\" !~ '[[:cntrl:]]')");
            table.HasCheckConstraint("CK_StaffBookingNotificationPreferences_Version", "\"Version\" >= 1");
        });
        builder.HasKey(row => new { row.PropertyId, row.StaffAccountId });
        builder.Property(row => row.NotificationEmail).HasMaxLength(BookingNotificationLimits.Email);
        builder.Property(row => row.Version).IsConcurrencyToken();
        builder.Property(row => row.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(row => row.UpdatedAtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(row => row.StaffAccountId);

        builder.HasOne<Property>().WithMany().HasForeignKey(row => row.PropertyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.StaffAccountId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>The Property's front-desk fallback address (one row per Property; the row stays when the address is cleared so the version keeps counting).</summary>
internal sealed class BookingNotificationFallbackConfiguration : IEntityTypeConfiguration<BookingNotificationFallback>
{
    public void Configure(EntityTypeBuilder<BookingNotificationFallback> builder)
    {
        builder.ToTable("BookingNotificationFallbacks", table =>
        {
            table.HasCheckConstraint("CK_BookingNotificationFallbacks_Email", "\"Email\" IS NULL OR (btrim(\"Email\") <> '' AND \"Email\" !~ '[[:cntrl:]]')");
            table.HasCheckConstraint("CK_BookingNotificationFallbacks_Version", "\"Version\" >= 1");
        });
        builder.HasKey(row => row.PropertyId);
        builder.Property(row => row.Email).HasMaxLength(BookingNotificationLimits.Email);
        builder.Property(row => row.Version).IsConcurrencyToken();
        builder.Property(row => row.UpdatedAtUtc).HasColumnType("timestamp with time zone");

        builder.HasOne<Property>().WithMany().HasForeignKey(row => row.PropertyId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>Who changed what, where and when. No address column exists, so none can leak from here.</summary>
internal sealed class BookingNotificationAuditConfiguration : IEntityTypeConfiguration<BookingNotificationAudit>
{
    public void Configure(EntityTypeBuilder<BookingNotificationAudit> builder)
    {
        builder.ToTable("BookingNotificationAudits");
        builder.HasKey(row => row.Id);
        builder.Property(row => row.Action).HasMaxLength(BookingNotificationLimits.Action).IsRequired();
        builder.Property(row => row.AtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(row => new { row.PropertyId, row.AtUtc });

        builder.HasOne<Property>().WithMany().HasForeignKey(row => row.PropertyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.ActorStaffId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.TargetStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}
