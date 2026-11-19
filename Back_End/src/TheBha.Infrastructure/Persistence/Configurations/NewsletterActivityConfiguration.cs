using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

// BHA-NEWSLETTER-BADGE-001: see the entities for why the sequence is a counter row and not an identity column.
internal sealed class NewsletterVerificationActivityConfiguration : IEntityTypeConfiguration<NewsletterVerificationActivity>
{
    public void Configure(EntityTypeBuilder<NewsletterVerificationActivity> builder)
    {
        builder.ToTable("NewsletterVerificationActivities", table => table.HasCheckConstraint("CK_NewsletterVerificationActivities_Sequence", "\"Sequence\" >= 1"));
        builder.HasKey(row => row.Sequence);
        builder.Property(row => row.Sequence).ValueGeneratedNever();
        // Deleting a subscription removes what it had counted; no address or token lives here, so nothing personal is left behind either way.
        builder.HasOne<NewsletterSubscription>().WithMany().HasForeignKey(row => row.SubscriptionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(row => row.SubscriptionId).HasDatabaseName("IX_NewsletterVerificationActivities_SubscriptionId");
    }
}

internal sealed class MenuActivityStreamConfiguration : IEntityTypeConfiguration<MenuActivityStream>
{
    public void Configure(EntityTypeBuilder<MenuActivityStream> builder)
    {
        builder.ToTable("MenuActivityStreams", table => table.HasCheckConstraint("CK_MenuActivityStreams_LastSequence", "\"LastSequence\" >= 0"));
        builder.HasKey(row => row.MenuKey);
        builder.Property(row => row.MenuKey).HasMaxLength(40);
        builder.Property(row => row.LastSequence).ValueGeneratedNever();
        // The row the verification locks must exist before the first verification: it is seeded by the migration, not created on demand.
        builder.HasData(new MenuActivityStream { MenuKey = MenuActivityStream.Newsletter, LastSequence = 0 });
    }
}

internal sealed class StaffMenuSeenConfiguration : IEntityTypeConfiguration<StaffMenuSeen>
{
    public void Configure(EntityTypeBuilder<StaffMenuSeen> builder)
    {
        builder.ToTable("StaffMenuSeen", table => table.HasCheckConstraint("CK_StaffMenuSeen_LastSeenSequence", "\"LastSeenSequence\" >= 0"));
        builder.HasKey(row => new { row.StaffAccountId, row.MenuKey });
        builder.Property(row => row.MenuKey).HasMaxLength(40);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.StaffAccountId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<MenuActivityStream>().WithMany().HasForeignKey(row => row.MenuKey).OnDelete(DeleteBehavior.Restrict);
    }
}
