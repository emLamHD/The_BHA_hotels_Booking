using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class RoomOccupancySegmentAuditConfiguration : IEntityTypeConfiguration<RoomOccupancySegmentAudit>
{
    public void Configure(EntityTypeBuilder<RoomOccupancySegmentAudit> builder)
    {
        builder.ToTable("RoomOccupancySegmentAudits", table =>
        {
            table.HasCheckConstraint(
                "CK_RoomOccupancySegmentAudits_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"SegmentId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"MutationGroupId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint(
                "CK_RoomOccupancySegmentAudits_EventType",
                "\"EventType\" IN ('Created', 'Cancelled')");
            table.HasCheckConstraint(
                "CK_RoomOccupancySegmentAudits_ActorReference",
                "btrim(\"ActorReference\") <> ''");
        });

        builder.HasKey(audit => audit.Id);
        builder.HasAlternateKey(audit => new { audit.PropertyId, audit.Id });
        builder.Property(audit => audit.EventType)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(audit => audit.ActorReference)
            .HasMaxLength(SchedulingFieldLimits.ActorReference)
            .IsRequired();
        builder.Property(audit => audit.AuthorizationEvidence)
            .HasMaxLength(SchedulingFieldLimits.AuthorizationEvidence);
        builder.Property(audit => audit.Reason)
            .HasMaxLength(SchedulingFieldLimits.Reason);
        builder.Property(audit => audit.OccurredAtUtc).HasColumnType("timestamp with time zone");

        builder.HasIndex(audit => audit.SegmentId);
        builder.HasIndex(audit => audit.MutationGroupId);
        builder.HasIndex(audit => new { audit.PropertyId, audit.OccurredAtUtc });

        builder.HasOne<RoomOccupancySegment>()
            .WithMany()
            .HasForeignKey(audit => new { audit.PropertyId, audit.SegmentId })
            .HasPrincipalKey(segment => new { segment.PropertyId, segment.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
