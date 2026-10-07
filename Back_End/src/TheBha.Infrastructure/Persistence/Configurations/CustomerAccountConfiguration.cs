using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

public sealed class CustomerAccountConfiguration : IEntityTypeConfiguration<CustomerAccount>
{
    public void Configure(EntityTypeBuilder<CustomerAccount> builder)
    {
        builder.Property(account => account.Email).IsRequired();
        builder.Property(account => account.NormalizedEmail).IsRequired();
        builder.HasIndex(account => account.NormalizedEmail)
            .IsUnique()
            .HasDatabaseName("UX_CustomerAccounts_NormalizedEmail");
    }
}
