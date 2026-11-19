using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

// BHA-NEWSLETTER-001. The unique index on the normalized address is what makes a repeated or concurrent request one row;
// the check constraints keep the stored address in the shape the application writes.
internal sealed class NewsletterSubscriptionConfiguration : IEntityTypeConfiguration<NewsletterSubscription>
{
    public void Configure(EntityTypeBuilder<NewsletterSubscription> builder)
    {
        builder.ToTable("NewsletterSubscriptions", table =>
        {
            table.HasCheckConstraint("CK_NewsletterSubscriptions_Email", "\"Email\" = lower(btrim(\"Email\")) AND char_length(\"Email\") BETWEEN 3 AND 254 AND \"Email\" LIKE '_%@_%'");
            table.HasCheckConstraint("CK_NewsletterSubscriptions_Status", "\"Status\" IN ('PendingVerification', 'Verified', 'Unsubscribed')");
            // A verified row says when; a pending one never does; an unsubscribed one keeps the instant it had (BHA-NEWSLETTER-002/003).
            table.HasCheckConstraint("CK_NewsletterSubscriptions_VerifiedAt",
                "(\"Status\" = 'Verified' AND \"VerifiedAtUtc\" IS NOT NULL) OR (\"Status\" = 'PendingVerification' AND \"VerifiedAtUtc\" IS NULL) OR \"Status\" = 'Unsubscribed'");
            table.HasCheckConstraint("CK_NewsletterSubscriptions_UnsubscribedAt", "(\"Status\" = 'Unsubscribed') = (\"UnsubscribedAtUtc\" IS NOT NULL)");
            table.HasCheckConstraint("CK_NewsletterSubscriptions_Source", "\"Source\" IN ('homepage', 'admin')");
            // An address Staff added names who added it; one from the public form never does.
            table.HasCheckConstraint("CK_NewsletterSubscriptions_CreatedBy", "(\"Source\" = 'admin') = (\"CreatedByStaffId\" IS NOT NULL)");
            table.HasCheckConstraint("CK_NewsletterSubscriptions_Language", "\"Language\" IN ('vi', 'en', 'fr')");
            table.HasCheckConstraint("CK_NewsletterSubscriptions_Version", "\"Version\" >= 1");
        });
        builder.HasKey(subscription => subscription.Id);
        builder.Property(subscription => subscription.Email).HasMaxLength(NewsletterRulesLimits.Email).IsRequired();
        builder.Property(subscription => subscription.Source).HasMaxLength(30).IsRequired();
        builder.Property(subscription => subscription.Status).HasMaxLength(30).IsRequired();
        builder.Property(subscription => subscription.Language).HasMaxLength(2).IsRequired().HasDefaultValue("vi");
        builder.Property(subscription => subscription.Version).IsRequired().HasDefaultValue(1);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(subscription => subscription.CreatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(subscription => subscription.Email).IsUnique().HasDatabaseName("UX_NewsletterSubscriptions_Email");
        builder.HasIndex(subscription => new { subscription.ReceivedAtUtc, subscription.Id }).IsDescending().HasDatabaseName("IX_NewsletterSubscriptions_ReceivedAtUtc_Id");
    }
}

internal static class NewsletterRulesLimits
{
    public const int Email = TheBha.Application.Website.NewsletterRules.MaxEmailLength;
}

/// <summary>BHA-NEWSLETTER-003: Staff actions on subscriptions. No foreign key to the subscription and no address: see <see cref="NewsletterSubscriptionAudit"/>.</summary>
internal sealed class NewsletterSubscriptionAuditConfiguration : IEntityTypeConfiguration<NewsletterSubscriptionAudit>
{
    public void Configure(EntityTypeBuilder<NewsletterSubscriptionAudit> builder)
    {
        builder.ToTable("NewsletterSubscriptionAudits", table =>
            table.HasCheckConstraint("CK_NewsletterSubscriptionAudits_Action", "\"Action\" IN ('created', 'edited', 'invited', 'unsubscribed', 'archived', 'restored', 'deleted')"));
        builder.HasKey(row => row.Id);
        builder.Property(row => row.Action).HasMaxLength(20).IsRequired();
        builder.Property(row => row.Detail).HasMaxLength(100);
        builder.HasIndex(row => new { row.SubscriptionId, row.OccurredAtUtc }).HasDatabaseName("IX_NewsletterSubscriptionAudits_SubscriptionId_OccurredAtUtc");
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(row => row.ActorStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}
