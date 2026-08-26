using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class RoomBlockConfiguration : IEntityTypeConfiguration<RoomBlock>
{
    public void Configure(EntityTypeBuilder<RoomBlock> builder)
    {
        builder.ToTable("RoomBlocks", table =>
        {
            table.HasCheckConstraint(
                "CK_RoomBlocks_Ids",
                "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND " +
                "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
            table.HasCheckConstraint(
                "CK_RoomBlocks_Reason",
                "btrim(\"Reason\") <> ''");
            table.HasCheckConstraint(
                "CK_RoomBlocks_CreatedByActorReference",
                "btrim(\"CreatedByActorReference\") <> ''");
        });

        builder.HasKey(block => block.Id);
        builder.HasAlternateKey(block => new { block.PropertyId, block.Id });
        builder.Property(block => block.Reason)
            .HasMaxLength(SchedulingFieldLimits.Reason)
            .IsRequired();
        builder.Property(block => block.CreatedByActorReference)
            .HasMaxLength(SchedulingFieldLimits.ActorReference)
            .IsRequired();
        builder.Property(block => block.CreatedAtUtc).HasColumnType("timestamp with time zone");

        builder.HasIndex(block => new { block.PropertyId, block.CreatedAtUtc });

        builder.HasOne<Property>()
            .WithMany()
            .HasForeignKey(block => block.PropertyId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
