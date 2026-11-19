using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Website;

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
            table.HasCheckConstraint("CK_NewsletterSubscriptions_Status", "\"Status\" IN ('PendingVerification', 'Verified')");
            // A verified row says when; a pending one never does (BHA-NEWSLETTER-002).
            table.HasCheckConstraint("CK_NewsletterSubscriptions_VerifiedAt", "(\"Status\" = 'Verified') = (\"VerifiedAtUtc\" IS NOT NULL)");
            table.HasCheckConstraint("CK_NewsletterSubscriptions_Source", "\"Source\" IN ('homepage')");
        });
        builder.HasKey(subscription => subscription.Id);
        builder.Property(subscription => subscription.Email).HasMaxLength(NewsletterRulesLimits.Email).IsRequired();
        builder.Property(subscription => subscription.Source).HasMaxLength(30).IsRequired();
        builder.Property(subscription => subscription.Status).HasMaxLength(30).IsRequired();
        builder.HasIndex(subscription => subscription.Email).IsUnique().HasDatabaseName("UX_NewsletterSubscriptions_Email");
        builder.HasIndex(subscription => new { subscription.ReceivedAtUtc, subscription.Id }).IsDescending().HasDatabaseName("IX_NewsletterSubscriptions_ReceivedAtUtc_Id");
    }
}

internal static class NewsletterRulesLimits
{
    public const int Email = TheBha.Application.Website.NewsletterRules.MaxEmailLength;
}
