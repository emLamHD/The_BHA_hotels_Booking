using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class StaffPropertyMembershipConfiguration : IEntityTypeConfiguration<StaffPropertyMembership>
{
    public void Configure(EntityTypeBuilder<StaffPropertyMembership> builder)
    {
        builder.ToTable("StaffPropertyMemberships", table => table.HasCheckConstraint(
            "CK_StaffPropertyMemberships_Role",
            $"\"Role\" IN ('{StaffRole.FrontDesk}', '{StaffRole.Manager}')"));
        builder.HasKey(membership => new { membership.StaffAccountId, membership.PropertyId });
        builder.Property(membership => membership.Role).HasMaxLength(32).IsRequired();
        builder.Property(membership => membership.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(membership => membership.PropertyId);

        builder.HasOne<StaffAccount>()
            .WithMany()
            .HasForeignKey(membership => membership.StaffAccountId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Property>()
            .WithMany()
            .HasForeignKey(membership => membership.PropertyId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
