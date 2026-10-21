namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-BLOG-001-CP01: the one category and the settings row the Blog starts with, exactly as migration <c>AddBlogFoundation</c> seeds them.
/// Idempotent (<c>ON CONFLICT DO NOTHING</c>) and FROZEN: a later change is a new migration, not an edit here. No post, picture or figure is
/// seeded. The texts go to the languages that exist when it runs (Vietnamese, the default, is always there); they are the texts the
/// website already carried for this section. The integration tests re-run it to start each test from the baseline.
/// </summary>
public static class BlogSeed
{
    public static readonly Guid FeaturedDestinationsCategoryId = Guid.Parse("b10c0001-0000-4000-8000-000000000001");

    public const string FeaturedDestinationsKey = "featured-destinations";

    public static readonly string Sql = $"""
        INSERT INTO "BlogCategories" ("Id", "SystemKey", "SortOrder", "Version", "CreatedAtUtc", "UpdatedAtUtc", "CreatedByStaffId", "UpdatedByStaffId")
        VALUES ('{FeaturedDestinationsCategoryId}', '{FeaturedDestinationsKey}', 10, 1, now(), now(), NULL, NULL)
        ON CONFLICT DO NOTHING;
        INSERT INTO "BlogCategoryTranslations" ("CategoryId", "Locale", "Name", "Slug", "Description")
        SELECT '{FeaturedDestinationsCategoryId}', l."NormalizedCode", v.name, v.slug, v.description
        FROM "WebsiteLanguages" l JOIN (VALUES
        ('vi', 'Điểm đến nổi bật', 'diem-den-noi-bat', 'Những nơi nên biết khi ở Đà Nẵng và vùng lân cận: biển, núi, cầu, phố cổ và cố đô.'),
        ('en', 'Featured destinations', 'featured-destinations', 'Places worth knowing in Da Nang and nearby, with references.'),
        ('fr', 'Destinations phares', 'destinations-phares', 'Les lieux à connaître à Da Nang et aux alentours, avec leurs sources.')
        ) AS v(code, name, slug, description) ON v.code = l."NormalizedCode"
        ON CONFLICT DO NOTHING;
        INSERT INTO "BlogCategorySlugs" ("Locale", "Slug", "CategoryId", "IsCurrent")
        SELECT t."Locale", t."Slug", t."CategoryId", true FROM "BlogCategoryTranslations" t WHERE t."CategoryId" = '{FeaturedDestinationsCategoryId}'
        ON CONFLICT DO NOTHING;
        INSERT INTO "BlogSettings" ("Id", "HomeSectionCategoryId", "Version", "UpdatedAtUtc", "UpdatedByStaffId")
        VALUES (1, '{FeaturedDestinationsCategoryId}', 1, now(), NULL)
        ON CONFLICT DO NOTHING;
        """;
}
