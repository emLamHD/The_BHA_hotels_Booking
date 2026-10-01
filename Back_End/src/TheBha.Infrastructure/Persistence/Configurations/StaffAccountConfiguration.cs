using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class StaffAccountConfiguration : IEntityTypeConfiguration<StaffAccount>
{
    public void Configure(EntityTypeBuilder<StaffAccount> builder)
    {
        builder.ToTable("StaffAccounts", table => table.HasCheckConstraint(
            "CK_StaffAccounts_DisabledAtUtc",
            "(\"IsActive\" AND \"DisabledAtUtc\" IS NULL) OR (NOT \"IsActive\" AND \"DisabledAtUtc\" IS NOT NULL)"));
        builder.HasKey(account => account.Id);
        builder.Property(account => account.ConcurrencyStamp).IsConcurrencyToken();
        builder.Property(account => account.UserName).HasMaxLength(256).IsRequired();
        builder.Property(account => account.NormalizedUserName).HasMaxLength(256).IsRequired();
        builder.Property(account => account.Email).HasMaxLength(256).IsRequired();
        builder.Property(account => account.NormalizedEmail).HasMaxLength(256).IsRequired();
        builder.Property(account => account.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(account => account.DisabledAtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(account => account.NormalizedUserName)
            .IsUnique()
            .HasDatabaseName("UX_StaffAccounts_NormalizedUserName");
        builder.HasIndex(account => account.NormalizedEmail)
            .IsUnique()
            .HasDatabaseName("UX_StaffAccounts_NormalizedEmail");
    }
}
