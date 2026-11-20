using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

// ADR 0011 §A (BHA-ADMIN-BADGE-001-PR02). The table is append-only and has no foreign key to any content table.
internal sealed class AdminActivityConfiguration : IEntityTypeConfiguration<AdminActivity>
{
    public void Configure(EntityTypeBuilder<AdminActivity> builder)
    {
        builder.ToTable("AdminActivities", table =>
        {
            table.HasCheckConstraint("CK_AdminActivities_Sequence", "\"Sequence\" >= 1");
            table.HasCheckConstraint("CK_AdminActivities_ItemCount", "\"ItemCount\" >= 1");
            table.HasCheckConstraint("CK_AdminActivities_ActorKind", "\"ActorKind\" IN ('Staff', 'Public', 'System')");
            table.HasCheckConstraint("CK_AdminActivities_ActorStaff", "(\"ActorKind\" = 'Staff') = (\"ActorStaffId\" IS NOT NULL)");
        });
        builder.HasKey(row => new { row.MenuKey, row.Sequence });
        builder.Property(row => row.MenuKey).HasMaxLength(40);
        builder.Property(row => row.Sequence).ValueGeneratedNever();
        builder.Property(row => row.ActorKind).HasConversion<string>().HasMaxLength(10);
        builder.Property(row => row.Action).HasMaxLength(40);
        builder.Property(row => row.EntityKind).HasMaxLength(40);
        builder.Property(row => row.EntityKey).HasMaxLength(80);
        builder.Property(row => row.TitleSnapshot).HasMaxLength(200);
        builder.Property(row => row.ItemCount).HasDefaultValue(1);
        builder.HasOne<MenuActivityStream>().WithMany().HasForeignKey(row => row.MenuKey).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Property>().WithMany().HasForeignKey(row => row.PropertyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.ActorStaffId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(row => row.Id).IsUnique().HasDatabaseName("UX_AdminActivities_Id");
        builder.HasIndex(row => new { row.MenuKey, row.PropertyId, row.Sequence }).HasDatabaseName("IX_AdminActivities_MenuKey_PropertyId_Sequence");
        builder.HasIndex(row => new { row.MenuKey, row.EntityKind, row.EntityKey, row.Sequence }).HasDatabaseName("IX_AdminActivities_MenuKey_EntityKind_EntityKey_Sequence");
        // Backstop only: the recorder decides, after it holds the counter row, which rows keep a CorrelationId (ADR 0011 §D).
        builder.HasIndex(row => new { row.MenuKey, row.CorrelationId, row.Action }).IsUnique().HasFilter("\"CorrelationId\" IS NOT NULL").HasDatabaseName("UX_AdminActivities_Correlation");
    }
}

internal sealed class StaffMenuPropertySeenConfiguration : IEntityTypeConfiguration<StaffMenuPropertySeen>
{
    public void Configure(EntityTypeBuilder<StaffMenuPropertySeen> builder)
    {
        builder.ToTable("StaffMenuPropertySeen", table => table.HasCheckConstraint("CK_StaffMenuPropertySeen_LastSeenSequence", "\"LastSeenSequence\" >= 0"));
        builder.HasKey(row => new { row.StaffAccountId, row.MenuKey, row.PropertyId });
        builder.Property(row => row.MenuKey).HasMaxLength(40);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.StaffAccountId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<MenuActivityStream>().WithMany().HasForeignKey(row => row.MenuKey).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Property>().WithMany().HasForeignKey(row => row.PropertyId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class StaffEntitySeenConfiguration : IEntityTypeConfiguration<StaffEntitySeen>
{
    public void Configure(EntityTypeBuilder<StaffEntitySeen> builder)
    {
        builder.ToTable("StaffEntitySeen", table => table.HasCheckConstraint("CK_StaffEntitySeen_LastSeenSequence", "\"LastSeenSequence\" >= 0"));
        builder.HasKey(row => new { row.StaffAccountId, row.PropertyId, row.EntityKind, row.EntityKey });
        builder.Property(row => row.EntityKind).HasMaxLength(40);
        builder.Property(row => row.EntityKey).HasMaxLength(80);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.StaffAccountId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Property>().WithMany().HasForeignKey(row => row.PropertyId).OnDelete(DeleteBehavior.Restrict);
    }
}
