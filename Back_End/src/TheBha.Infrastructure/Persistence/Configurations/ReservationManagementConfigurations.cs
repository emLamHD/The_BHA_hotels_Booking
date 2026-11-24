using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence.Configurations;

/// <summary>
/// BHA-CHECKOUT-001-PR06. A link or session row can only name a Reservation of its own Property (composite FK), carries only a hash, and a session belongs to exactly one consumed link (unique LinkId).
/// Nothing here can be deleted with its Reservation: a Reservation is never deleted, and Restrict keeps it that way.
/// </summary>
internal sealed class ReservationManagementLinkConfiguration : IEntityTypeConfiguration<ReservationManagementLink>
{
    public void Configure(EntityTypeBuilder<ReservationManagementLink> builder)
    {
        builder.ToTable("ReservationManagementLinks", table =>
        {
            table.HasCheckConstraint("CK_ReservationManagementLinks_Hash", "\"TokenHash\" ~ '^[0-9a-f]{64}$'");
            table.HasCheckConstraint(
                "CK_ReservationManagementLinks_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint("CK_ReservationManagementLinks_Times", "\"ExpiresAtUtc\" > \"CreatedAtUtc\" AND (\"ConsumedAtUtc\" IS NULL OR \"ConsumedAtUtc\" >= \"CreatedAtUtc\")");
        });

        builder.HasKey(link => link.Id);
        builder.Property(link => link.TokenHash).HasMaxLength(BookingFieldLimits.Sha256Hash).IsFixedLength().IsRequired();
        builder.Property(link => link.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(link => link.ExpiresAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(link => link.ConsumedAtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(link => link.TokenHash).IsUnique();
        builder.HasIndex(link => new { link.PropertyId, link.ReservationId });

        builder.HasOne<Reservation>()
            .WithMany()
            .HasForeignKey(link => new { link.PropertyId, link.ReservationId })
            .HasPrincipalKey(reservation => new { reservation.PropertyId, reservation.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class ReservationManagementSessionConfiguration : IEntityTypeConfiguration<ReservationManagementSession>
{
    public void Configure(EntityTypeBuilder<ReservationManagementSession> builder)
    {
        builder.ToTable("ReservationManagementSessions", table =>
        {
            table.HasCheckConstraint("CK_ReservationManagementSessions_Hash", "\"SessionHash\" ~ '^[0-9a-f]{64}$'");
            table.HasCheckConstraint(
                "CK_ReservationManagementSessions_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"LinkId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint("CK_ReservationManagementSessions_Times", "\"ExpiresAtUtc\" > \"CreatedAtUtc\"");
        });

        builder.HasKey(session => session.Id);
        builder.Property(session => session.SessionHash).HasMaxLength(BookingFieldLimits.Sha256Hash).IsFixedLength().IsRequired();
        builder.Property(session => session.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(session => session.ExpiresAtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(session => session.SessionHash).IsUnique();
        builder.HasIndex(session => session.LinkId).IsUnique();
        builder.HasIndex(session => new { session.PropertyId, session.ReservationId });

        builder.HasOne<ReservationManagementLink>()
            .WithMany()
            .HasForeignKey(session => session.LinkId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Reservation>()
            .WithMany()
            .HasForeignKey(session => new { session.PropertyId, session.ReservationId })
            .HasPrincipalKey(reservation => new { reservation.PropertyId, reservation.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class ReservationArrivalEstimateConfiguration : IEntityTypeConfiguration<ReservationArrivalEstimate>
{
    public void Configure(EntityTypeBuilder<ReservationArrivalEstimate> builder)
    {
        builder.ToTable("ReservationArrivalEstimates", table =>
        {
            table.HasCheckConstraint(
                "CK_ReservationArrivalEstimates_Ids",
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint("CK_ReservationArrivalEstimates_TimeZone", "btrim(\"TimeZoneId\") <> ''");
        });

        builder.HasKey(estimate => estimate.ReservationId);
        builder.Property(estimate => estimate.ArrivalDate).HasColumnType("date");
        builder.Property(estimate => estimate.ArrivalTime).HasColumnType("time without time zone");
        builder.Property(estimate => estimate.TimeZoneId).HasMaxLength(100).IsRequired();
        builder.Property(estimate => estimate.UpdatedAtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(estimate => new { estimate.PropertyId, estimate.ReservationId });

        builder.HasOne<Reservation>()
            .WithMany()
            .HasForeignKey(estimate => new { estimate.PropertyId, estimate.ReservationId })
            .HasPrincipalKey(reservation => new { reservation.PropertyId, reservation.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
