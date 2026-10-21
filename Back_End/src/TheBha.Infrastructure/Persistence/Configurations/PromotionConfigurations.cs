using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Bookings;
using TheBha.Domain.Promotions;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class PromotionConfiguration : IEntityTypeConfiguration<Promotion>
{
    public void Configure(EntityTypeBuilder<Promotion> b)
    {
        b.ToTable("Promotions", t =>
        {
            t.HasCheckConstraint("CK_Promotions_Value", "\"Value\" > 0");
            t.HasCheckConstraint("CK_Promotions_Percent", "\"Kind\" <> 'Percent' OR (\"Value\" < 100 AND \"CurrencyCode\" IS NULL)");
            t.HasCheckConstraint("CK_Promotions_FixedCurrency", "\"Kind\" <> 'FixedAmount' OR \"CurrencyCode\" ~ '^[A-Z]{3}$'");
            t.HasCheckConstraint("CK_Promotions_BookingWindow", "\"BookingFrom\" IS NULL OR \"BookingTo\" IS NULL OR \"BookingTo\" >= \"BookingFrom\"");
            t.HasCheckConstraint("CK_Promotions_StayWindow", "\"StayFrom\" IS NULL OR \"StayTo\" IS NULL OR \"StayTo\" >= \"StayFrom\"");
            t.HasCheckConstraint("CK_Promotions_DisplayWindow", "\"DisplayFrom\" IS NULL OR \"DisplayTo\" IS NULL OR \"DisplayTo\" >= \"DisplayFrom\"");
            t.HasCheckConstraint("CK_Promotions_MinNights", "\"MinNights\" BETWEEN 1 AND 30");
            t.HasCheckConstraint("CK_Promotions_SortOrder", "\"SortOrder\" BETWEEN 0 AND 9999");
            t.HasCheckConstraint("CK_Promotions_Version", "\"Version\" >= 1");
            t.HasCheckConstraint("CK_Promotions_Homepage", "NOT \"ShowOnHomepage\" OR \"CoverMediaId\" IS NOT NULL");
            t.HasCheckConstraint("CK_Promotions_Fingerprint", "\"CreateFingerprint\" ~ '^[0-9a-f]{64}$'");
        });
        b.HasKey(x => x.Id);
        b.HasAlternateKey(x => new { x.PropertyId, x.Id });
        b.Property(x => x.Slug).HasMaxLength(PromotionLimits.Slug);
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
        b.Property(x => x.Value).HasPrecision(18, 2);
        b.Property(x => x.CurrencyCode).HasMaxLength(3).IsFixedLength();
        b.Property(x => x.Title).HasMaxLength(PromotionLimits.Title);
        b.Property(x => x.Summary).HasMaxLength(PromotionLimits.Summary);
        b.Property(x => x.CoverAltText).HasMaxLength(PromotionLimits.AltText);
        b.Property(x => x.BodyParagraphs).HasColumnType("text[]");
        b.Property(x => x.CreateFingerprint).HasMaxLength(64).IsFixedLength();
        b.Property(x => x.Version).HasDefaultValue(1).IsConcurrencyToken();
        foreach (var date in new[] { nameof(Promotion.BookingFrom), nameof(Promotion.BookingTo), nameof(Promotion.StayFrom), nameof(Promotion.StayTo), nameof(Promotion.DisplayFrom), nameof(Promotion.DisplayTo) })
        {
            b.Property(date).HasColumnType("date");
        }

        b.HasIndex(x => x.Slug).IsUnique().HasDatabaseName("UX_Promotions_Slug");
        b.HasIndex(x => new { x.CreatedByStaffId, x.CreateOperationId }).IsUnique().HasDatabaseName("UX_Promotions_CreateOperation");
        b.HasIndex(x => new { x.PropertyId, x.Status });
        b.HasIndex(x => new { x.Status, x.ShowOnHomepage, x.SortOrder });
        b.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<PromotionMedia>().WithMany().HasForeignKey(x => x.CoverMediaId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.RoomTypes).WithOne().HasForeignKey(x => new { x.PropertyId, x.PromotionId })
            .HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class PromotionRoomTypeConfiguration : IEntityTypeConfiguration<PromotionRoomType>
{
    public void Configure(EntityTypeBuilder<PromotionRoomType> b)
    {
        b.ToTable("PromotionRoomTypes");
        b.HasKey(x => new { x.PromotionId, x.RoomTypeId });
        b.HasOne<RoomType>().WithMany().HasForeignKey(x => new { x.PropertyId, x.RoomTypeId })
            .HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.RoomTypeId);
    }
}

internal sealed class PromotionMediaConfiguration : IEntityTypeConfiguration<PromotionMedia>
{
    public void Configure(EntityTypeBuilder<PromotionMedia> b)
    {
        b.ToTable("PromotionMedia", t =>
        {
            t.HasCheckConstraint("CK_PromotionMedia_Size", "\"ByteSize\" > 0 AND \"Width\" > 0 AND \"Height\" > 0");
            t.HasCheckConstraint("CK_PromotionMedia_Key", "\"StorageKey\" ~ '^promo/[0-9a-f]{32}\\.(jpg|png|webp)$'");
        });
        b.HasKey(x => x.Id);
        b.Property(x => x.StorageKey).HasMaxLength(100);
        b.Property(x => x.ContentType).HasMaxLength(40);
        b.HasIndex(x => x.StorageKey).IsUnique();
        b.HasIndex(x => new { x.PropertyId, x.CreatedAtUtc });
        b.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class PromotionAuditConfiguration : IEntityTypeConfiguration<PromotionAudit>
{
    public void Configure(EntityTypeBuilder<PromotionAudit> b)
    {
        b.ToTable("PromotionAudits");
        b.HasKey(x => x.Id);
        b.Property(x => x.Action).HasMaxLength(50);
        b.Property(x => x.Before).HasColumnType("jsonb");
        b.Property(x => x.After).HasColumnType("jsonb");
        b.HasOne<Promotion>().WithMany().HasForeignKey(x => new { x.PropertyId, x.PromotionId })
            .HasPrincipalKey(x => new { x.PropertyId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.PromotionId, x.AtUtc });
    }
}

internal sealed class BookingPromotionApplicationConfiguration : IEntityTypeConfiguration<BookingPromotionApplication>
{
    public void Configure(EntityTypeBuilder<BookingPromotionApplication> b)
    {
        b.ToTable("BookingPromotionApplications", t =>
        {
            t.HasCheckConstraint("CK_BookingPromotionApplications_Amounts", "\"DiscountTotalAmount\" > 0 AND \"ListTotalAmount\" > \"DiscountTotalAmount\"");
            t.HasCheckConstraint("CK_BookingPromotionApplications_Value", "\"Value\" > 0 AND \"PromotionVersion\" >= 1");
        });
        b.HasKey(x => x.HoldId);
        b.Property(x => x.Slug).HasMaxLength(PromotionLimits.Slug);
        b.Property(x => x.Title).HasMaxLength(PromotionLimits.Title);
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
        b.Property(x => x.Value).HasPrecision(18, 2);
        b.Property(x => x.CurrencyCode).HasMaxLength(3).IsFixedLength();
        b.Property(x => x.ListTotalAmount).HasPrecision(18, 2);
        b.Property(x => x.DiscountTotalAmount).HasPrecision(18, 2);
        b.HasIndex(x => x.PromotionId);
        b.HasOne<InventoryHold>().WithOne(x => x.PromotionApplication).HasForeignKey<BookingPromotionApplication>(x => x.HoldId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne<Reservation>().WithOne(x => x.PromotionApplication).HasForeignKey<BookingPromotionApplication>(x => x.ReservationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Promotion>().WithMany().HasForeignKey(x => x.PromotionId).OnDelete(DeleteBehavior.Restrict);
    }
}
