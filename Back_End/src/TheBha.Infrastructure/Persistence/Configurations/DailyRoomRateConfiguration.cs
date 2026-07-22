using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class DailyRoomRateConfiguration : IEntityTypeConfiguration<DailyRoomRate>
{
    public void Configure(EntityTypeBuilder<DailyRoomRate> builder)
    {
        builder.ToTable("DailyRoomRates", table => { table.HasCheckConstraint("CK_DailyRoomRates_Amount", "\"Amount\" > 0"); table.HasCheckConstraint("CK_DailyRoomRates_Timestamps", "\"UpdatedAt\" >= \"CreatedAt\""); });
        builder.HasKey(x => x.Id);
        builder.Property(x => x.StayDate).HasColumnType("date");
        builder.Property(x => x.Amount).HasPrecision(18, 2);
        builder.Property(x => x.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(x => x.UpdatedAt).HasColumnType("timestamp with time zone");
        builder.HasIndex(x => new { x.PropertyId, x.RoomTypeId, x.RatePlanId, x.StayDate }).IsUnique();
        builder.HasIndex(x => new { x.PropertyId, x.StayDate });
        builder.HasIndex(x => new { x.PropertyId, x.RoomTypeId, x.StayDate });
        builder.HasIndex(x => new { x.PropertyId, x.RatePlanId, x.StayDate });
        builder.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RoomType>().WithMany().HasForeignKey(x => new { x.PropertyId, x.RoomTypeId }).HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RatePlan>().WithMany().HasForeignKey(x => new { x.PropertyId, x.RatePlanId }).HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Restrict);
    }
}
