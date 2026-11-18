using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Configurations;

// BHA-NEWSLETTER-002. The sender is one row (Id = 1, enforced); the secrets are Data Protection payloads, never plain text.
internal sealed class NewsletterSenderSettingsConfiguration : IEntityTypeConfiguration<NewsletterSenderSettings>
{
    public void Configure(EntityTypeBuilder<NewsletterSenderSettings> builder)
    {
        builder.ToTable("NewsletterSenderSettings", table =>
        {
            table.HasCheckConstraint("CK_NewsletterSenderSettings_Singleton", "\"Id\" = 1");
            table.HasCheckConstraint("CK_NewsletterSenderSettings_Status", "\"Status\" IN ('NotConnected', 'Connected', 'NeedsReconnect')");
            // A connected sender always has everything it needs to send; a disconnected one keeps no token.
            table.HasCheckConstraint("CK_NewsletterSenderSettings_Connected",
                "\"Status\" = 'NotConnected' AND \"ProtectedRefreshToken\" IS NULL OR \"Status\" <> 'NotConnected' AND \"ProtectedRefreshToken\" IS NOT NULL AND \"ConnectedEmail\" IS NOT NULL AND \"ClientId\" IS NOT NULL AND \"ProtectedClientSecret\" IS NOT NULL");
        });
        builder.HasKey(row => row.Id);
        builder.Property(row => row.Id).ValueGeneratedNever();
        builder.Property(row => row.ClientId).HasMaxLength(256);
        builder.Property(row => row.ProtectedClientSecret).HasMaxLength(2048);
        builder.Property(row => row.ProtectedRefreshToken).HasMaxLength(4096);
        builder.Property(row => row.ConnectedEmail).HasMaxLength(254);
        builder.Property(row => row.SenderName).HasMaxLength(100);
        builder.Property(row => row.ReplyTo).HasMaxLength(254);
        builder.Property(row => row.Status).HasMaxLength(30).IsRequired();
    }
}

internal sealed class NewsletterOAuthStateConfiguration : IEntityTypeConfiguration<NewsletterOAuthState>
{
    public void Configure(EntityTypeBuilder<NewsletterOAuthState> builder)
    {
        builder.ToTable("NewsletterOAuthStates");
        builder.HasKey(row => row.Id);
        builder.Property(row => row.StateHash).HasMaxLength(64).IsRequired();
        builder.Property(row => row.ProtectedCodeVerifier).HasMaxLength(2048).IsRequired();
        builder.Property(row => row.ClientId).HasMaxLength(256).IsRequired();
        builder.Property(row => row.ProtectedClientSecret).HasMaxLength(2048).IsRequired();
        builder.HasIndex(row => row.StateHash).IsUnique().HasDatabaseName("UX_NewsletterOAuthStates_StateHash");
        builder.HasIndex(row => row.ExpiresAtUtc).HasDatabaseName("IX_NewsletterOAuthStates_ExpiresAtUtc");
    }
}

internal sealed class NewsletterVerificationRequestConfiguration : IEntityTypeConfiguration<NewsletterVerificationRequest>
{
    public void Configure(EntityTypeBuilder<NewsletterVerificationRequest> builder)
    {
        builder.ToTable("NewsletterVerificationRequests", table =>
        {
            table.HasCheckConstraint("CK_NewsletterVerificationRequests_Status", "\"Status\" IN ('Pending', 'Sending', 'Sent', 'Failed', 'Cancelled')");
            table.HasCheckConstraint("CK_NewsletterVerificationRequests_Language", "\"Language\" IN ('vi', 'en', 'fr')");
            table.HasCheckConstraint("CK_NewsletterVerificationRequests_Attempts", "\"Attempts\" >= 0");
            table.HasCheckConstraint("CK_NewsletterVerificationRequests_Purpose", "\"Purpose\" IN ('Verification', 'Welcome')");
            // A Welcome says which verification it answers; a confirmation request never does.
            table.HasCheckConstraint("CK_NewsletterVerificationRequests_ForVerifiedAt", "(\"Purpose\" = 'Welcome') = (\"ForVerifiedAtUtc\" IS NOT NULL)");
        });
        builder.HasKey(row => row.Id);
        builder.Property(row => row.TokenHash).HasMaxLength(64).IsRequired();
        builder.Property(row => row.ProtectedToken).HasMaxLength(2048);
        builder.Property(row => row.Language).HasMaxLength(2).IsRequired();
        builder.Property(row => row.Status).HasMaxLength(20).IsRequired();
        builder.Property(row => row.Purpose).HasMaxLength(20).IsRequired().HasDefaultValue("Verification");
        builder.Property(row => row.LastOutcome).HasMaxLength(60);
        builder.Property(row => row.FromEmail).HasMaxLength(254);
        builder.Property(row => row.FromName).HasMaxLength(100);
        builder.Property(row => row.ReplyTo).HasMaxLength(254);
        builder.HasIndex(row => row.TokenHash).IsUnique().HasDatabaseName("UX_NewsletterVerificationRequests_TokenHash");
        builder.HasIndex(row => new { row.Status, row.NextAttemptAtUtc }).HasDatabaseName("IX_NewsletterVerificationRequests_Status_NextAttemptAtUtc");
        builder.HasIndex(row => row.SubscriptionId).HasDatabaseName("IX_NewsletterVerificationRequests_SubscriptionId");
        // One verification, one Welcome: the database refuses a second one for the same instant, whatever the code does.
        builder.HasIndex(row => new { row.SubscriptionId, row.ForVerifiedAtUtc }).IsUnique().HasFilter("\"Purpose\" = 'Welcome'").HasDatabaseName("UX_NewsletterVerificationRequests_WelcomePerVerification");
        // Restrict: a subscription is never deleted; if one ever is, its mail history must be dealt with on purpose.
        builder.HasOne<NewsletterSubscription>().WithMany().HasForeignKey(row => row.SubscriptionId).OnDelete(DeleteBehavior.Restrict);
    }
}
