using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Configurations;

// CUST-WEB-HEADER-001-CP02. The database is the last line: whatever the application does or forgets, a code
// cannot repeat (any case), a default must be active, an active currency must have a rate, a rate must be
// positive, VND is the one base with rate 1, and there is at most one default of each kind. "Exactly one"
// (never zero) is enforced by the deferred constraint triggers the migration adds.

internal sealed class WebsiteLanguageConfiguration : IEntityTypeConfiguration<WebsiteLanguage>
{
    public void Configure(EntityTypeBuilder<WebsiteLanguage> builder)
    {
        builder.ToTable("WebsiteLanguages", table =>
        {
            table.HasCheckConstraint(
                "CK_WebsiteLanguages_Code",
                "\"NormalizedCode\" = lower(\"Code\") AND " +
                "\"NormalizedCode\" ~ '^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?$'");
            table.HasCheckConstraint("CK_WebsiteLanguages_Names", "btrim(\"DisplayName\") <> '' AND btrim(\"NativeName\") <> ''");
            table.HasCheckConstraint("CK_WebsiteLanguages_SortOrder", "\"SortOrder\" BETWEEN 0 AND 10000");
            table.HasCheckConstraint("CK_WebsiteLanguages_DefaultIsActive", "NOT \"IsDefault\" OR \"IsActive\"");
            table.HasCheckConstraint("CK_WebsiteLanguages_Version", "\"Version\" >= 1");
            table.HasCheckConstraint("CK_WebsiteLanguages_Direction", "\"Direction\" IN ('ltr', 'rtl')");
            table.HasCheckConstraint("CK_WebsiteLanguages_FormatLocale", "btrim(\"FormatLocale\") <> ''");
        });

        builder.HasKey(language => language.Id);
        builder.Property(language => language.Code).HasMaxLength(WebsiteFieldLimits.LanguageCode).IsRequired();
        builder.Property(language => language.NormalizedCode).HasMaxLength(WebsiteFieldLimits.LanguageCode).IsRequired();
        builder.Property(language => language.DisplayName).HasMaxLength(WebsiteFieldLimits.LanguageName).IsRequired();
        builder.Property(language => language.NativeName).HasMaxLength(WebsiteFieldLimits.LanguageName).IsRequired();
        builder.Property(language => language.Version).IsConcurrencyToken();
        builder.Property(language => language.DefaultCurrencyCode).HasMaxLength(3).IsFixedLength();
        builder.Property(language => language.Direction).HasMaxLength(3).HasDefaultValue("ltr").IsRequired();
        builder.Property(language => language.FormatLocale).HasMaxLength(WebsiteFieldLimits.FormatLocale).IsRequired();
        builder.Property(language => language.PackId).HasMaxLength(WebsiteFieldLimits.PackId);
        builder.Property(language => language.PackVersion).HasMaxLength(WebsiteFieldLimits.PackVersion);
        builder.Property(language => language.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(language => language.UpdatedAtUtc).HasColumnType("timestamp with time zone");

        builder.HasIndex(language => language.NormalizedCode).IsUnique().HasDatabaseName("UX_WebsiteLanguages_NormalizedCode");
        builder.HasIndex(language => language.IsDefault).IsUnique().HasFilter("\"IsDefault\"").HasDatabaseName("UX_WebsiteLanguages_OneDefault");
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(language => language.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<WebsiteCurrency>().WithMany().HasForeignKey(language => language.DefaultCurrencyCode).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class WebsiteTranslationConfiguration : IEntityTypeConfiguration<WebsiteTranslation>
{
    public void Configure(EntityTypeBuilder<WebsiteTranslation> builder)
    {
        builder.ToTable("WebsiteTranslations", table =>
        {
            table.HasCheckConstraint("CK_WebsiteTranslations_Key", "\"Key\" ~ '^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9][a-zA-Z0-9_-]*)+$'");
            table.HasCheckConstraint(
                "CK_WebsiteTranslations_Value",
                "btrim(\"Value\") <> '' AND char_length(\"Value\") <= 4000");
            table.HasCheckConstraint("CK_WebsiteTranslations_Version", "\"Version\" >= 1");
        });

        builder.HasKey(translation => new { translation.LanguageId, translation.Key });
        builder.Property(translation => translation.Key).HasMaxLength(WebsiteFieldLimits.TranslationKey).IsRequired();
        builder.Property(translation => translation.Value).HasMaxLength(WebsiteFieldLimits.TranslationValue).IsRequired();
        builder.Property(translation => translation.IsManual).HasDefaultValue(false);
        builder.Property(translation => translation.SourceHash).HasMaxLength(WebsiteFieldLimits.SourceHash);
        builder.Property(translation => translation.Version).IsConcurrencyToken();
        builder.Property(translation => translation.UpdatedAtUtc).HasColumnType("timestamp with time zone");

        builder.HasOne<WebsiteLanguage>().WithMany().HasForeignKey(translation => translation.LanguageId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(translation => translation.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class WebsiteCurrencyConfiguration : IEntityTypeConfiguration<WebsiteCurrency>
{
    public void Configure(EntityTypeBuilder<WebsiteCurrency> builder)
    {
        builder.ToTable("WebsiteCurrencies", table =>
        {
            table.HasCheckConstraint("CK_WebsiteCurrencies_Code", "\"Code\" ~ '^[A-Z]{3}$'");
            table.HasCheckConstraint("CK_WebsiteCurrencies_Names", "btrim(\"Name\") <> '' AND btrim(\"Symbol\") <> ''");
            table.HasCheckConstraint("CK_WebsiteCurrencies_MinorUnits", "\"MinorUnits\" BETWEEN 0 AND 4");
            table.HasCheckConstraint("CK_WebsiteCurrencies_SortOrder", "\"SortOrder\" BETWEEN 0 AND 10000");
            table.HasCheckConstraint("CK_WebsiteCurrencies_Rate", "\"VndPerUnit\" IS NULL OR (\"VndPerUnit\" > 0 AND \"VndPerUnit\" < 1000000000000)");
            table.HasCheckConstraint("CK_WebsiteCurrencies_RateStamp", "(\"VndPerUnit\" IS NULL) = (\"RateUpdatedAtUtc\" IS NULL)");
            table.HasCheckConstraint("CK_WebsiteCurrencies_RateSource", "\"RateSource\" = 'manual'");
            table.HasCheckConstraint("CK_WebsiteCurrencies_ActiveNeedsRate", "NOT \"IsActive\" OR \"VndPerUnit\" IS NOT NULL");
            table.HasCheckConstraint("CK_WebsiteCurrencies_DefaultIsActive", "NOT \"IsDefault\" OR \"IsActive\"");
            table.HasCheckConstraint(
                "CK_WebsiteCurrencies_Base",
                "(\"IsBase\" = (\"Code\" = 'VND')) AND " +
                "(NOT \"IsBase\" OR (\"VndPerUnit\" = 1 AND \"MinorUnits\" = 0 AND \"IsActive\"))");
            table.HasCheckConstraint("CK_WebsiteCurrencies_Version", "\"Version\" >= 1");
        });

        builder.HasKey(currency => currency.Code);
        builder.Property(currency => currency.Code).HasMaxLength(3).IsFixedLength().IsRequired();
        builder.Property(currency => currency.Name).HasMaxLength(WebsiteFieldLimits.CurrencyName).IsRequired();
        builder.Property(currency => currency.Symbol).HasMaxLength(WebsiteFieldLimits.CurrencySymbol).IsRequired();
        builder.Property(currency => currency.VndPerUnit).HasPrecision(ExchangeRate.IntegerDigits + ExchangeRate.FractionDigits, ExchangeRate.FractionDigits);
        builder.Property(currency => currency.RateSource).HasMaxLength(20).IsRequired();
        builder.Property(currency => currency.Version).IsConcurrencyToken();
        builder.Property(currency => currency.RateUpdatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(currency => currency.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Property(currency => currency.UpdatedAtUtc).HasColumnType("timestamp with time zone");
        builder.Ignore(currency => currency.HasRate);

        builder.HasIndex(currency => currency.IsDefault).IsUnique().HasFilter("\"IsDefault\"").HasDatabaseName("UX_WebsiteCurrencies_OneDefault");
        builder.HasIndex(currency => currency.IsBase).IsUnique().HasFilter("\"IsBase\"").HasDatabaseName("UX_WebsiteCurrencies_OneBase");
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(currency => currency.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(currency => currency.RateUpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}

// CUST-WEB-HEADER-001-CP04: the header navigation. A root has a placement and a child has none; no row is its own
// parent; a link has no whitespace, control character or backslash. The cycle and depth rules need the whole tree
// and are the service's, under the website lock.
internal sealed class WebsiteMenuItemConfiguration : IEntityTypeConfiguration<WebsiteMenuItem>
{
    public void Configure(EntityTypeBuilder<WebsiteMenuItem> builder)
    {
        builder.ToTable("WebsiteMenuItems", table =>
        {
            table.HasCheckConstraint(
                "CK_WebsiteMenuItems_Placement",
                "(\"ParentId\" IS NULL) = (\"Placement\" IS NOT NULL) AND (\"Placement\" IS NULL OR \"Placement\" IN ('primary', 'secondary'))");
            table.HasCheckConstraint("CK_WebsiteMenuItems_NotOwnParent", "\"ParentId\" IS NULL OR \"ParentId\" <> \"Id\"");
            table.HasCheckConstraint("CK_WebsiteMenuItems_Label", "btrim(\"Label\") <> '' AND char_length(\"Label\") <= 80");
            table.HasCheckConstraint(
                "CK_WebsiteMenuItems_Href",
                "char_length(\"Href\") BETWEEN 1 AND 2048 AND \"Href\" !~ '[[:cntrl:][:space:]\\\\]'");
            table.HasCheckConstraint("CK_WebsiteMenuItems_SortOrder", "\"SortOrder\" BETWEEN 0 AND 10000");
        });

        builder.HasKey(item => item.Id);
        builder.Property(item => item.Placement).HasMaxLength(9);
        builder.Property(item => item.Label).HasMaxLength(MenuLimits.MaxLabel).IsRequired();
        builder.Property(item => item.Href).HasMaxLength(MenuLimits.MaxHref).IsRequired();
        builder.HasOne<WebsiteMenuItem>().WithMany().HasForeignKey(item => item.ParentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(item => new { item.ParentId, item.SortOrder }).HasDatabaseName("IX_WebsiteMenuItems_Parent_Sort");
    }
}

internal sealed class WebsiteMenuStateConfiguration : IEntityTypeConfiguration<WebsiteMenuState>
{
    public void Configure(EntityTypeBuilder<WebsiteMenuState> builder)
    {
        builder.ToTable("WebsiteMenu", table =>
        {
            table.HasCheckConstraint("CK_WebsiteMenu_Singleton", "\"Id\" = 1");
            table.HasCheckConstraint("CK_WebsiteMenu_Version", "\"Version\" >= 1");
        });

        builder.HasKey(state => state.Id);
        builder.Property(state => state.Id).ValueGeneratedNever();
        builder.Property(state => state.Version).IsConcurrencyToken();
        builder.Property(state => state.UpdatedAtUtc).HasColumnType("timestamp with time zone");
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(state => state.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}

// CUST-WEB-HERO-001-CP01: the home page hero. A picture row states its own limits; a slide points at a picture (never deleted, so the
// restriction can never leave a slide without one); the settings row is the one version of the whole hero.
internal sealed class WebsiteHeroMediaConfiguration : IEntityTypeConfiguration<WebsiteHeroMedia>
{
    public void Configure(EntityTypeBuilder<WebsiteHeroMedia> builder)
    {
        builder.ToTable("WebsiteHeroMedia", table =>
        {
            table.HasCheckConstraint("CK_WebsiteHeroMedia_Kind", "\"Kind\" IN ('seed', 'upload')");
            table.HasCheckConstraint("CK_WebsiteHeroMedia_StorageKey", "\"StorageKey\" ~ '^(seed|hero)/[A-Za-z0-9][A-Za-z0-9._-]*$' AND \"StorageKey\" !~ '\\.\\.'");
            table.HasCheckConstraint("CK_WebsiteHeroMedia_ContentType", "\"ContentType\" IN ('image/jpeg', 'image/png', 'image/webp')");
            table.HasCheckConstraint("CK_WebsiteHeroMedia_Size", "\"ByteSize\" BETWEEN 1 AND 10485760 AND \"Width\" BETWEEN 1 AND 8000 AND \"Height\" BETWEEN 1 AND 8000");
        });

        builder.HasKey(media => media.Id);
        builder.Property(media => media.Id).ValueGeneratedNever();
        builder.Property(media => media.Kind).HasMaxLength(8).IsRequired();
        builder.Property(media => media.StorageKey).HasMaxLength(HeroLimits.MaxStorageKey).IsRequired();
        builder.Property(media => media.ContentType).HasMaxLength(40).IsRequired();
        builder.Property(media => media.CreatedAtUtc).HasColumnType("timestamp with time zone");
        builder.HasIndex(media => media.StorageKey).IsUnique().HasDatabaseName("UX_WebsiteHeroMedia_StorageKey");
        builder.HasIndex(media => media.CreatedAtUtc).HasDatabaseName("IX_WebsiteHeroMedia_CreatedAt");
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(media => media.CreatedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class WebsiteHeroSlideConfiguration : IEntityTypeConfiguration<WebsiteHeroSlide>
{
    public void Configure(EntityTypeBuilder<WebsiteHeroSlide> builder)
    {
        builder.ToTable("WebsiteHeroSlides", table =>
        {
            table.HasCheckConstraint("CK_WebsiteHeroSlides_SortOrder", "\"SortOrder\" BETWEEN 0 AND 9");
            table.HasCheckConstraint("CK_WebsiteHeroSlides_Alt", "btrim(\"Alt\") <> '' AND char_length(\"Alt\") <= 200");
            table.HasCheckConstraint("CK_WebsiteHeroSlides_Caption", "btrim(\"Caption\") <> '' AND char_length(\"Caption\") <= 120");
            table.HasCheckConstraint("CK_WebsiteHeroSlides_Focal", "\"FocalPosition\" ~ '^[0-9]{1,3}% [0-9]{1,3}%$'");
        });

        builder.HasKey(slide => slide.Id);
        builder.Property(slide => slide.Id).ValueGeneratedNever();
        builder.Property(slide => slide.FocalPosition).HasMaxLength(HeroLimits.MaxFocal).IsRequired();
        builder.Property(slide => slide.Alt).HasMaxLength(HeroLimits.MaxAlt).IsRequired();
        builder.Property(slide => slide.Caption).HasMaxLength(HeroLimits.MaxCaption).IsRequired();
        builder.HasOne<WebsiteHeroMedia>().WithMany().HasForeignKey(slide => slide.MediaId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(slide => slide.SortOrder).IsUnique().HasDatabaseName("UX_WebsiteHeroSlides_Sort");
        builder.HasIndex(slide => slide.MediaId).HasDatabaseName("IX_WebsiteHeroSlides_Media");
    }
}

internal sealed class WebsiteHeroSettingsConfiguration : IEntityTypeConfiguration<WebsiteHeroSettings>
{
    public void Configure(EntityTypeBuilder<WebsiteHeroSettings> builder)
    {
        builder.ToTable("WebsiteHero", table =>
        {
            table.HasCheckConstraint("CK_WebsiteHero_Singleton", "\"Id\" = 1");
            table.HasCheckConstraint("CK_WebsiteHero_Version", "\"Version\" >= 1");
            table.HasCheckConstraint("CK_WebsiteHero_Font", "\"FontKey\" IN ('default', 'be-vietnam-pro', 'system-sans', 'system-serif')");
            table.HasCheckConstraint("CK_WebsiteHero_Interval", "\"IntervalSeconds\" BETWEEN 3 AND 60");
            table.HasCheckConstraint(
                "CK_WebsiteHero_Texts",
                "btrim(\"Title\") <> '' AND char_length(\"Title\") <= 120 AND btrim(\"Description\") <> '' AND char_length(\"Description\") <= 300 " +
                "AND btrim(\"PrimaryActionLabel\") <> '' AND char_length(\"PrimaryActionLabel\") <= 40 AND btrim(\"SecondaryActionLabel\") <> '' AND char_length(\"SecondaryActionLabel\") <= 40");
        });

        builder.HasKey(settings => settings.Id);
        builder.Property(settings => settings.Id).ValueGeneratedNever();
        builder.Property(settings => settings.Version).IsConcurrencyToken();
        builder.Property(settings => settings.FontKey).HasMaxLength(16).IsRequired();
        builder.Property(settings => settings.Title).HasMaxLength(HeroLimits.MaxTitle).IsRequired();
        builder.Property(settings => settings.Description).HasMaxLength(HeroLimits.MaxDescription).IsRequired();
        builder.Property(settings => settings.PrimaryActionLabel).HasMaxLength(HeroLimits.MaxAction).IsRequired();
        builder.Property(settings => settings.SecondaryActionLabel).HasMaxLength(HeroLimits.MaxAction).IsRequired();
        builder.Property(settings => settings.UpdatedAtUtc).HasColumnType("timestamp with time zone");
        builder.HasOne<StaffAccount>().WithMany().HasForeignKey(settings => settings.UpdatedByStaffId).OnDelete(DeleteBehavior.Restrict);
    }
}
