using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class CatalogContentAuditConfiguration : IEntityTypeConfiguration<CatalogContentAudit>
{
    public void Configure(EntityTypeBuilder<CatalogContentAudit> b)
    {
        b.ToTable("CatalogContentAudits"); b.HasKey(x => x.Id);
        b.Property(x => x.Action).HasMaxLength(50);
        b.Property(x => x.Before).HasColumnType("jsonb"); b.Property(x => x.After).HasColumnType("jsonb");
        b.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<RoomType>().WithMany().HasForeignKey(x => new { x.PropertyId, x.RoomTypeId })
            .HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.PropertyId, x.AtUtc });
    }
}
internal sealed class CatalogUploadConfiguration : IEntityTypeConfiguration<CatalogUpload>
{
    public void Configure(EntityTypeBuilder<CatalogUpload> b)
    {
        b.ToTable("CatalogUploads"); b.HasKey(x => x.MediaId);
        b.Property(x => x.StorageKey).HasMaxLength(100); b.Property(x => x.ContentType).HasMaxLength(30);
        b.HasOne<Media>().WithMany().HasForeignKey(x => x.MediaId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<RoomType>().WithMany().HasForeignKey(x => new { x.PropertyId, x.RoomTypeId })
            .HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Restrict);
    }
}
