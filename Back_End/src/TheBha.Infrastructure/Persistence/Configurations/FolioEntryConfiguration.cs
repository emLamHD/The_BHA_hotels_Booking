using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

/// <summary>
/// BHA-CHECKOUT-001-PR02 (S1 §2.2). The one folio table: append-only (the migration adds a row-level trigger that refuses UPDATE and DELETE, and an insert check that the Reservation is VND and that a reference has the
/// right kind), whole đồng in a bigint, no stored balance. A reference can only point into the same Reservation: the self-FK is (ReservationId, ReferenceEntryId) → (ReservationId, Id).
/// </summary>
internal sealed class FolioEntryConfiguration : IEntityTypeConfiguration<FolioEntry>
{
    private const string NoUuid = "'00000000-0000-0000-0000-000000000000'::uuid";

    public void Configure(EntityTypeBuilder<FolioEntry> builder)
    {
        builder.ToTable("FolioEntries", table =>
        {
            table.HasCheckConstraint(
                "CK_FolioEntries_Ids",
                $"\"Id\" <> {NoUuid} AND \"PropertyId\" <> {NoUuid} AND \"ReservationId\" <> {NoUuid} AND \"ReferenceEntryId\" IS DISTINCT FROM \"Id\"");
            table.HasCheckConstraint(
                "CK_FolioEntries_Kind",
                "\"Kind\" IN ('RoomCharge', 'RoomChargeReversal', 'Payment', 'Refund', 'GatewayFee')");
            table.HasCheckConstraint("CK_FolioEntries_Amount", "\"Amount\" > 0");
            table.HasCheckConstraint("CK_FolioEntries_Currency", "\"CurrencyCode\" = 'VND'");
            table.HasCheckConstraint("CK_FolioEntries_PostingKey", "btrim(\"PostingKey\") <> ''");
            table.HasCheckConstraint(
                "CK_FolioEntries_Reference",
                "(\"Kind\" IN ('RoomChargeReversal', 'Refund', 'GatewayFee')) = (\"ReferenceEntryId\" IS NOT NULL)");
            table.HasCheckConstraint(
                "CK_FolioEntries_Reason",
                "(\"Reason\" IS NULL OR btrim(\"Reason\") <> '') AND (\"Kind\" NOT IN ('RoomChargeReversal', 'Refund') OR \"Reason\" IS NOT NULL)");
            table.HasCheckConstraint(
                "CK_FolioEntries_Actor",
                "\"ActorKind\" IN ('System', 'Staff', 'Public', 'Gateway') AND (\"ActorKind\" = 'Staff') = (\"ActorStaffId\" IS NOT NULL)");
        });

        builder.HasKey(entry => entry.Id);
        builder.HasAlternateKey(entry => new { entry.ReservationId, entry.Id });
        builder.Property(entry => entry.Kind).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(entry => entry.Amount).HasColumnType("bigint");
        builder.Property(entry => entry.CurrencyCode).HasMaxLength(3).IsFixedLength().IsRequired();
        builder.Property(entry => entry.PostingKey).HasMaxLength(BookingFieldLimits.PostingKey).IsRequired();
        builder.Property(entry => entry.ActorKind).HasConversion<string>().HasMaxLength(10).IsRequired();
        builder.Property(entry => entry.Reason).HasMaxLength(BookingFieldLimits.FolioReason);
        builder.Property(entry => entry.OccurredAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(entry => entry.RecordedAtUtc).HasColumnType("timestamp with time zone");

        builder.HasIndex(entry => new { entry.ReservationId, entry.PostingKey }).IsUnique();

        builder.HasOne<Reservation>()
            .WithMany()
            .HasForeignKey(entry => new { entry.PropertyId, entry.ReservationId })
            .HasPrincipalKey(reservation => new { reservation.PropertyId, reservation.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FolioEntry>()
            .WithMany()
            .HasForeignKey(entry => new { entry.ReservationId, entry.ReferenceEntryId })
            .HasPrincipalKey(entry => new { entry.ReservationId, entry.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffAccount>()
            .WithMany()
            .HasForeignKey(entry => entry.ActorStaffId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
