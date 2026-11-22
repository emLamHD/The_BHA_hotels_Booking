using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence.Configurations;

/// <summary>
/// BHA-CHECKOUT-001-PR05. One row per Direct Reservation created through the API: the primary key (ScopeHash, KeyHash) is "the same key in the same scope", and the unique ReservationId plus the
/// (PropertyId, ReservationId) → Reservations(PropertyId, Id) key make a mapping to another Property's Reservation, or two Reservations for one request, impossible in the database.
/// </summary>
internal sealed class ReservationCreationRequestConfiguration : IEntityTypeConfiguration<ReservationCreationRequest>
{
    public void Configure(EntityTypeBuilder<ReservationCreationRequest> builder)
    {
        builder.ToTable("ReservationCreationRequests", table =>
        {
            table.HasCheckConstraint(
                "CK_ReservationCreationRequests_Hashes",
                "\"ScopeHash\" ~ '^[0-9a-f]{64}$' AND \"KeyHash\" ~ '^[0-9a-f]{64}$' AND \"RequestFingerprint\" ~ '^[0-9a-f]{64}$'");
            table.HasCheckConstraint(
                "CK_ReservationCreationRequests_Ids",
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
        });

        builder.HasKey(request => new { request.ScopeHash, request.KeyHash });
        builder.Property(request => request.ScopeHash).HasMaxLength(BookingFieldLimits.Sha256Hash).IsFixedLength();
        builder.Property(request => request.KeyHash).HasMaxLength(BookingFieldLimits.Sha256Hash).IsFixedLength();
        builder.Property(request => request.RequestFingerprint).HasMaxLength(BookingFieldLimits.Sha256Hash).IsFixedLength().IsRequired();
        builder.Property(request => request.CreatedAtUtc).HasColumnType("timestamp with time zone");

        builder.HasIndex(request => request.ReservationId).IsUnique();

        builder.HasOne<Reservation>()
            .WithMany()
            .HasForeignKey(request => new { request.PropertyId, request.ReservationId })
            .HasPrincipalKey(reservation => new { reservation.PropertyId, reservation.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
