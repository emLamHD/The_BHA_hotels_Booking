using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Notifications;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

/// <summary>
/// BHA-CHECKOUT-001-PR03. The event half of the transactional e-mail outbox: one row per business fact, written in the caller's transaction. The partial index serves "the next due event" and nothing else;
/// the Failed index serves the backend failure query. The jsonb payload is kept small and an object by constraint.
/// </summary>
internal sealed class EmailOutboxEventConfiguration : IEntityTypeConfiguration<EmailOutboxEvent>
{
    private const string NoUuid = "'00000000-0000-0000-0000-000000000000'::uuid";

    public void Configure(EntityTypeBuilder<EmailOutboxEvent> builder)
    {
        builder.ToTable("EmailOutboxEvents", table =>
        {
            table.HasCheckConstraint("CK_EmailOutboxEvents_Ids", $"\"Id\" <> {NoUuid} AND \"PropertyId\" <> {NoUuid}");
            table.HasCheckConstraint("CK_EmailOutboxEvents_Type", "btrim(\"EventType\") <> ''");
            table.HasCheckConstraint("CK_EmailOutboxEvents_Version", "\"SchemaVersion\" > 0");
            table.HasCheckConstraint("CK_EmailOutboxEvents_Payload", $"jsonb_typeof(\"Payload\") = 'object' AND octet_length(\"Payload\"::text) <= {EmailOutboxLimits.PayloadBytes}");
            table.HasCheckConstraint("CK_EmailOutboxEvents_Status", "\"Status\" IN ('Pending', 'Completed', 'Failed')");
            table.HasCheckConstraint("CK_EmailOutboxEvents_Completed", "(\"Status\" = 'Completed') = (\"CompletedAtUtc\" IS NOT NULL)");
            table.HasCheckConstraint("CK_EmailOutboxEvents_Attempts", "\"FanoutAttempts\" >= 0");
        });

        builder.HasKey(row => row.Id);
        builder.HasAlternateKey(row => new { row.PropertyId, row.Id });
        builder.Property(row => row.EventType).HasMaxLength(EmailOutboxLimits.EventType).IsRequired();
        builder.Property(row => row.PayloadJson).HasColumnName("Payload").HasColumnType("jsonb").IsRequired();
        builder.Property(row => row.Status).HasMaxLength(16).IsRequired();
        builder.Property(row => row.LastOutcome).HasMaxLength(EmailOutboxLimits.Outcome);
        builder.Property(row => row.NextAttemptAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(row => row.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(row => row.CompletedAtUtc).HasColumnType("timestamp with time zone");

        builder.HasIndex(row => new { row.NextAttemptAtUtc, row.CreatedAtUtc, row.Id }).HasDatabaseName("IX_EmailOutboxEvents_Due").HasFilter("\"Status\" = 'Pending'");
        builder.HasIndex(row => new { row.PropertyId, row.CreatedAtUtc }).HasDatabaseName("IX_EmailOutboxEvents_Failed").HasFilter("\"Status\" = 'Failed'");

        builder.HasOne<Property>().WithMany().HasForeignKey(row => row.PropertyId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// The delivery half: one row per recipient and purpose of an event (unique, so a replayed fan-out adds nothing). The recipient and the rendered message are stored protected; a trigger in the migration refuses any change to
/// them, and to the identity pinned at the first attempt, once set. Only "Pending" rows are due for a claim, and a "Sending" row is due again when its lease has run out.
/// </summary>
internal sealed class EmailOutboxDeliveryConfiguration : IEntityTypeConfiguration<EmailOutboxDelivery>
{
    private const string NoUuid = "'00000000-0000-0000-0000-000000000000'::uuid";

    public void Configure(EntityTypeBuilder<EmailOutboxDelivery> builder)
    {
        builder.ToTable("EmailOutboxDeliveries", table =>
        {
            table.HasCheckConstraint("CK_EmailOutboxDeliveries_Ids", $"\"Id\" <> {NoUuid} AND \"EventId\" <> {NoUuid} AND \"PropertyId\" <> {NoUuid}");
            table.HasCheckConstraint("CK_EmailOutboxDeliveries_Text", "btrim(\"Purpose\") <> '' AND btrim(\"RecipientKey\") <> '' AND btrim(\"TemplateKey\") <> '' AND btrim(\"Locale\") <> ''");
            table.HasCheckConstraint("CK_EmailOutboxDeliveries_Status", "\"Status\" IN ('Pending', 'Sending', 'Accepted', 'Failed', 'NeedsReconciliation')");
            table.HasCheckConstraint("CK_EmailOutboxDeliveries_Attempts", "\"Attempts\" >= 0");
            table.HasCheckConstraint("CK_EmailOutboxDeliveries_Claim", "(\"Status\" = 'Sending') = (\"ClaimId\" IS NOT NULL) AND (\"ClaimId\" IS NULL) = (\"LeaseUntilUtc\" IS NULL)");
            table.HasCheckConstraint("CK_EmailOutboxDeliveries_Pin", "(\"FirstAttemptAtUtc\" IS NULL) = (\"PinnedFingerprint\" IS NULL) AND (\"PinnedFingerprint\" IS NULL) = (\"PinnedFrom\" IS NULL)");
            table.HasCheckConstraint(
                "CK_EmailOutboxDeliveries_Accepted",
                "(\"Status\" = 'Accepted') = (\"AcceptedAtUtc\" IS NOT NULL) AND (\"Status\" <> 'Accepted' OR \"ProviderMessageId\" IS NOT NULL)");
            table.HasCheckConstraint(
                "CK_EmailOutboxDeliveries_Payload",
                "(\"Status\" NOT IN ('Pending', 'Sending') OR (\"ProtectedRecipient\" IS NOT NULL AND \"ProtectedMessage\" IS NOT NULL)) AND (\"Status\" <> 'Accepted' OR (\"ProtectedRecipient\" IS NULL AND \"ProtectedMessage\" IS NULL))");
        });

        builder.HasKey(row => row.Id);
        builder.Property(row => row.Purpose).HasMaxLength(EmailOutboxLimits.Purpose).IsRequired();
        builder.Property(row => row.RecipientKey).HasMaxLength(EmailOutboxLimits.RecipientKey).IsRequired();
        builder.Property(row => row.TemplateKey).HasMaxLength(EmailOutboxLimits.TemplateKey).IsRequired();
        builder.Property(row => row.Locale).HasMaxLength(EmailOutboxLimits.Locale).IsRequired();
        builder.Property(row => row.Status).HasMaxLength(24).IsRequired();
        builder.Property(row => row.PinnedFingerprint).HasMaxLength(EmailOutboxLimits.Fingerprint);
        builder.Property(row => row.PinnedFrom).HasMaxLength(EmailOutboxLimits.From);
        builder.Property(row => row.ProviderMessageId).HasMaxLength(EmailOutboxLimits.ProviderMessageId);
        builder.Property(row => row.LastOutcome).HasMaxLength(EmailOutboxLimits.Outcome);
        foreach (var column in new[] { nameof(EmailOutboxDelivery.NextAttemptAtUtc), nameof(EmailOutboxDelivery.LeaseUntilUtc), nameof(EmailOutboxDelivery.FirstAttemptAtUtc), nameof(EmailOutboxDelivery.LastAttemptAtUtc), nameof(EmailOutboxDelivery.AcceptedAtUtc), nameof(EmailOutboxDelivery.CreatedAtUtc) })
        {
            builder.Property(column).HasColumnType("timestamp with time zone");
        }

        builder.HasIndex(row => new { row.EventId, row.Purpose, row.RecipientKey }).IsUnique();
        builder.HasIndex(row => new { row.NextAttemptAtUtc, row.Id }).HasDatabaseName("IX_EmailOutboxDeliveries_Pending").HasFilter("\"Status\" = 'Pending'");
        builder.HasIndex(row => row.LeaseUntilUtc).HasDatabaseName("IX_EmailOutboxDeliveries_Lease").HasFilter("\"Status\" = 'Sending'");
        builder.HasIndex(row => new { row.PropertyId, row.CreatedAtUtc }).HasDatabaseName("IX_EmailOutboxDeliveries_Failures").HasFilter("\"Status\" IN ('Failed', 'NeedsReconciliation')");

        // A delivery belongs to its event's Property: (PropertyId, EventId) → (PropertyId, Id).
        builder.HasOne<EmailOutboxEvent>().WithMany().HasForeignKey(row => new { row.PropertyId, row.EventId }).HasPrincipalKey(row => new { row.PropertyId, row.Id }).OnDelete(DeleteBehavior.Restrict);
    }
}
