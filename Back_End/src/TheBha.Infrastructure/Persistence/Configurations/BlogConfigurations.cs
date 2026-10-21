using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Blog;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class BlogCategoryConfiguration : IEntityTypeConfiguration<BlogCategory>
{
    public void Configure(EntityTypeBuilder<BlogCategory> b)
    {
        b.ToTable("BlogCategories", t =>
        {
            t.HasCheckConstraint("CK_BlogCategories_Version", "\"Version\" >= 1");
            t.HasCheckConstraint("CK_BlogCategories_SortOrder", "\"SortOrder\" BETWEEN 0 AND 9999");
        });
        b.HasKey(x => x.Id);
        b.Property(x => x.SystemKey).HasMaxLength(60);
        b.Property(x => x.Version).HasDefaultValue(1).IsConcurrencyToken();
        b.HasIndex(x => x.SystemKey).IsUnique().HasDatabaseName("UX_BlogCategories_SystemKey");
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.CreatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Translations).WithOne().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class BlogCategoryTranslationConfiguration : IEntityTypeConfiguration<BlogCategoryTranslation>
{
    public void Configure(EntityTypeBuilder<BlogCategoryTranslation> b)
    {
        b.ToTable("BlogCategoryTranslations");
        b.HasKey(x => new { x.CategoryId, x.Locale });
        b.Property(x => x.Locale).HasMaxLength(35);
        b.Property(x => x.Name).HasMaxLength(BlogLimits.CategoryName);
        b.Property(x => x.Slug).HasMaxLength(BlogLimits.Slug);
        b.Property(x => x.Description).HasMaxLength(BlogLimits.CategoryDescription);
    }
}

internal sealed class BlogCategorySlugConfiguration : IEntityTypeConfiguration<BlogCategorySlug>
{
    public void Configure(EntityTypeBuilder<BlogCategorySlug> b)
    {
        b.ToTable("BlogCategorySlugs");
        b.HasKey(x => new { x.Locale, x.Slug });
        b.Property(x => x.Locale).HasMaxLength(35);
        b.Property(x => x.Slug).HasMaxLength(BlogLimits.Slug);
        b.HasIndex(x => new { x.CategoryId, x.Locale }).IsUnique().HasFilter("\"IsCurrent\"").HasDatabaseName("UX_BlogCategorySlugs_Current");
        b.HasOne<BlogCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class BlogCategoryPinConfiguration : IEntityTypeConfiguration<BlogCategoryPin>
{
    public void Configure(EntityTypeBuilder<BlogCategoryPin> b)
    {
        b.ToTable("BlogCategoryPins", t => t.HasCheckConstraint("CK_BlogCategoryPins_Position", "\"Position\" BETWEEN 0 AND 999"));
        b.HasKey(x => new { x.CategoryId, x.PostId });
        b.HasIndex(x => new { x.CategoryId, x.Position });
        b.HasOne<BlogCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<BlogPost>().WithMany().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.PinnedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogPostConfiguration : IEntityTypeConfiguration<BlogPost>
{
    public void Configure(EntityTypeBuilder<BlogPost> b)
    {
        b.ToTable("BlogPosts");
        b.HasKey(x => x.Id);
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.CreatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Translations).WithOne().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogPostTranslationConfiguration : IEntityTypeConfiguration<BlogPostTranslation>
{
    public void Configure(EntityTypeBuilder<BlogPostTranslation> b)
    {
        b.ToTable("BlogPostTranslations", t =>
        {
            t.HasCheckConstraint("CK_BlogPostTranslations_Version", "\"Version\" >= 1");
            t.HasCheckConstraint("CK_BlogPostTranslations_Published", "\"Status\" <> 'Published' OR \"PublishedRevisionId\" IS NOT NULL");
            t.HasCheckConstraint("CK_BlogPostTranslations_Unpublished", "\"Status\" <> 'Unpublished' OR \"PublishedRevisionId\" IS NOT NULL");
            t.HasCheckConstraint("CK_BlogPostTranslations_FirstPublished", "\"PublishedRevisionId\" IS NULL OR \"FirstPublishedAtUtc\" IS NOT NULL");
        });
        b.HasKey(x => x.Id);
        b.Property(x => x.Locale).HasMaxLength(35);
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        b.Property(x => x.Version).HasDefaultValue(1).IsConcurrencyToken();
        b.HasIndex(x => new { x.PostId, x.Locale }).IsUnique().HasDatabaseName("UX_BlogPostTranslations_PostLocale");
        b.HasIndex(x => new { x.Locale, x.Status });
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);

        // The pointers are composite so a translation can only ever point at one of its own revisions.
        b.HasOne<BlogPostRevision>().WithMany().HasForeignKey(x => new { x.Id, x.DraftRevisionId })
            .HasPrincipalKey(x => new { x.TranslationId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<BlogPostRevision>().WithMany().HasForeignKey(x => new { x.Id, x.PublishedRevisionId })
            .HasPrincipalKey(x => new { x.TranslationId, x.Id }).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogPostRevisionConfiguration : IEntityTypeConfiguration<BlogPostRevision>
{
    public void Configure(EntityTypeBuilder<BlogPostRevision> b)
    {
        b.ToTable("BlogPostRevisions", t =>
        {
            t.HasCheckConstraint("CK_BlogPostRevisions_Number", "\"Number\" >= 1");
            t.HasCheckConstraint("CK_BlogPostRevisions_Published", "\"PublishedAtUtc\" IS NULL OR \"State\" = 'Frozen'");
        });
        b.HasKey(x => x.Id);
        b.HasAlternateKey(x => new { x.TranslationId, x.Id });
        b.Property(x => x.State).HasConversion<string>().HasMaxLength(10);
        b.Property(x => x.Origin).HasConversion<string>().HasMaxLength(10);
        b.Property(x => x.Title).HasMaxLength(BlogLimits.Title);
        b.Property(x => x.Slug).HasMaxLength(BlogLimits.Slug);
        b.Property(x => x.Summary).HasMaxLength(BlogLimits.Summary);
        b.Property(x => x.BodyJson).HasColumnType("jsonb");
        b.Property(x => x.CoverAlt).HasMaxLength(BlogLimits.AltText);
        b.Property(x => x.AuthorName).HasMaxLength(BlogLimits.Author);
        b.Property(x => x.MetaTitle).HasMaxLength(BlogLimits.MetaTitle);
        b.Property(x => x.MetaDescription).HasMaxLength(BlogLimits.MetaDescription);
        b.HasIndex(x => new { x.TranslationId, x.Number }).IsUnique().HasDatabaseName("UX_BlogPostRevisions_Number");
        b.HasIndex(x => x.TranslationId).IsUnique().HasFilter("\"State\" = 'Draft'").HasDatabaseName("UX_BlogPostRevisions_OneDraft");
        b.HasOne<BlogPostTranslation>().WithMany().HasForeignKey(x => x.TranslationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<BlogMedia>().WithMany().HasForeignKey(x => x.CoverMediaId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<BlogMedia>().WithMany().HasForeignKey(x => x.OgImageMediaId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.CreatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.PublishedByStaffId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Categories).WithOne().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Cascade);
        b.HasMany(x => x.Media).WithOne().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class BlogRevisionCategoryConfiguration : IEntityTypeConfiguration<BlogRevisionCategory>
{
    public void Configure(EntityTypeBuilder<BlogRevisionCategory> b)
    {
        b.ToTable("BlogRevisionCategories");
        b.HasKey(x => new { x.RevisionId, x.CategoryId });
        b.HasIndex(x => x.CategoryId);
        b.HasIndex(x => x.RevisionId).IsUnique().HasFilter("\"IsPrimary\"").HasDatabaseName("UX_BlogRevisionCategories_Primary");
        b.HasOne<BlogCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogRevisionMediaConfiguration : IEntityTypeConfiguration<BlogRevisionMedia>
{
    public void Configure(EntityTypeBuilder<BlogRevisionMedia> b)
    {
        b.ToTable("BlogRevisionMedia");
        b.HasKey(x => new { x.RevisionId, x.MediaId });
        b.HasIndex(x => x.MediaId);
        b.HasOne<BlogMedia>().WithMany().HasForeignKey(x => x.MediaId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogPostSlugConfiguration : IEntityTypeConfiguration<BlogPostSlug>
{
    public void Configure(EntityTypeBuilder<BlogPostSlug> b)
    {
        b.ToTable("BlogPostSlugs");
        b.HasKey(x => new { x.Locale, x.Slug });
        b.Property(x => x.Locale).HasMaxLength(35);
        b.Property(x => x.Slug).HasMaxLength(BlogLimits.Slug);
        b.Property(x => x.State).HasConversion<string>().HasMaxLength(10);
        b.HasIndex(x => x.TranslationId, "UX_BlogPostSlugs_OneDraft").IsUnique().HasFilter("\"State\" = 'Draft'");
        b.HasIndex(x => x.TranslationId, "UX_BlogPostSlugs_OneCurrent").IsUnique().HasFilter("\"State\" = 'Current'");
        b.HasOne<BlogPostTranslation>().WithMany().HasForeignKey(x => x.TranslationId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogMediaConfiguration : IEntityTypeConfiguration<BlogMedia>
{
    public void Configure(EntityTypeBuilder<BlogMedia> b)
    {
        b.ToTable("BlogMedia", t =>
        {
            t.HasCheckConstraint("CK_BlogMedia_Size", "\"ByteSize\" > 0 AND \"Width\" > 0 AND \"Height\" > 0");
            t.HasCheckConstraint("CK_BlogMedia_Key", "\"StorageKey\" ~ '^blog/[0-9a-f]{32}\\.(jpg|png|webp)$'");
        });
        b.HasKey(x => x.Id);
        b.Property(x => x.StorageKey).HasMaxLength(100);
        b.Property(x => x.ContentType).HasMaxLength(40);
        b.HasIndex(x => x.StorageKey).IsUnique();
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.CreatedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogSettingsConfiguration : IEntityTypeConfiguration<BlogSettings>
{
    public void Configure(EntityTypeBuilder<BlogSettings> b)
    {
        b.ToTable("BlogSettings", t =>
        {
            t.HasCheckConstraint("CK_BlogSettings_Single", "\"Id\" = 1");
            t.HasCheckConstraint("CK_BlogSettings_Version", "\"Version\" >= 1");
        });
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).ValueGeneratedNever();
        b.Property(x => x.Version).HasDefaultValue(1).IsConcurrencyToken();
        b.HasOne<BlogCategory>().WithMany().HasForeignKey(x => x.HomeSectionCategoryId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BlogAuditConfiguration : IEntityTypeConfiguration<BlogAudit>
{
    public void Configure(EntityTypeBuilder<BlogAudit> b)
    {
        b.ToTable("BlogAudits");
        b.HasKey(x => x.Id);
        b.Property(x => x.Action).HasMaxLength(50);
        b.Property(x => x.Locale).HasMaxLength(35);
        b.Property(x => x.Detail).HasColumnType("jsonb");
        b.HasIndex(x => new { x.PostId, x.AtUtc });
        b.HasIndex(x => new { x.CategoryId, x.AtUtc });
        b.HasOne<StaffAccount>().WithMany().HasForeignKey(x => x.ActorStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}
