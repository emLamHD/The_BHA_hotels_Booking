using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C1: one row per content-pack row an import has placed (or found) in this database. It is how a later import tells a row that
/// was never imported (put it in) from a row that was imported and then deleted by the staff (leave it deleted). The importer writes it in the same
/// transaction as the rows; nothing else reads or writes it.
/// </summary>
public sealed class ContentPackLedgerEntry
{
    public string TableName { get; set; } = string.Empty;

    /// <summary>The row's primary key in the pack, joined with "/".</summary>
    public string RowKey { get; set; } = string.Empty;

    public string PackSha256 { get; set; } = string.Empty;

    public DateTimeOffset ImportedAtUtc { get; set; }
}

internal sealed class ContentPackLedgerEntryConfiguration : IEntityTypeConfiguration<ContentPackLedgerEntry>
{
    public void Configure(EntityTypeBuilder<ContentPackLedgerEntry> builder)
    {
        builder.ToTable("ContentPackLedger");
        builder.HasKey(entry => new { entry.TableName, entry.RowKey });
        builder.Property(entry => entry.TableName).HasMaxLength(100);
        builder.Property(entry => entry.RowKey).HasMaxLength(400);
        builder.Property(entry => entry.PackSha256).HasMaxLength(64).IsFixedLength();
    }
}
