using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class RatePlanConfiguration : IEntityTypeConfiguration<RatePlan>
{
    public void Configure(EntityTypeBuilder<RatePlan> builder)
    {
        builder.ToTable(
            "RatePlans",
            table =>
            {
                table.HasCheckConstraint("CK_RatePlans_Code_NotBlank", "btrim(\"Code\") <> ''");
                table.HasCheckConstraint("CK_RatePlans_Name_NotBlank", "btrim(\"Name\") <> ''");
                table.HasCheckConstraint("CK_RatePlans_CurrencyCode", "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
                table.HasCheckConstraint("CK_RatePlans_Timestamps", "\"UpdatedAt\" >= \"CreatedAt\"");
            });
        builder.HasKey(ratePlan => ratePlan.Id);
        builder.HasAlternateKey(ratePlan => new { ratePlan.PropertyId, ratePlan.Id });
        builder.Property(ratePlan => ratePlan.Code).HasMaxLength(50).IsRequired();
        builder.Property(ratePlan => ratePlan.Name).HasMaxLength(200).IsRequired();
        builder.Property(ratePlan => ratePlan.Description).HasMaxLength(4000);
        builder.Property(ratePlan => ratePlan.CurrencyCode).HasMaxLength(3).IsRequired();
        builder.Property(ratePlan => ratePlan.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(ratePlan => ratePlan.UpdatedAt).HasColumnType("timestamp with time zone");
        builder.HasIndex(ratePlan => new { ratePlan.PropertyId, ratePlan.Code }).IsUnique();
        builder.HasOne<Property>()
            .WithMany()
            .HasForeignKey(ratePlan => ratePlan.PropertyId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
