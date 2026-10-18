using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class AdminCatalogCreateOperationConfiguration : IEntityTypeConfiguration<AdminCatalogCreateOperation>
{
    public void Configure(EntityTypeBuilder<AdminCatalogCreateOperation> b)
    {
        b.ToTable("AdminCatalogCreateOperations", t => t.HasCheckConstraint("CK_AdminCatalogCreateOperations_Fingerprint", "\"RequestFingerprint\" ~ '^[0-9a-f]{64}$'"));
        b.HasKey(x => new { x.ActorStaffId, x.OperationId });
        b.Property(x => x.EntityType).HasMaxLength(30).IsRequired();
        b.Property(x => x.RequestFingerprint).HasMaxLength(64).IsRequired();
        b.Property(x => x.CreatedAt).HasColumnType("timestamp with time zone");
        b.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId).OnDelete(DeleteBehavior.Restrict);
    }
}
