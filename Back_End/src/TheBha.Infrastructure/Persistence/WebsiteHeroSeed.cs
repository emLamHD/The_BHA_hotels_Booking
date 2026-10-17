namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HERO-001-CP01: the home page hero exactly as migration 13 seeds it — the four photographs, texts, order and timing
/// the Customer had in code before the Admin could edit them (default font, autoplay on, 6 seconds). Every id is fixed, so an exported
/// text pack names the same slides on every site. FROZEN: it is what <c>AddWebsiteHero</c> ran; a later change to the seed is a new
/// migration, not an edit here. The integration tests re-run it to start each test from the baseline. The en and fr texts go to the
/// languages that exist when it runs (the content source language, Vietnamese, keeps its text in the row itself); they are the texts the
/// previous static content packs already carried.
/// </summary>
public static class WebsiteHeroSeed
{
    public const string Sql = """
        INSERT INTO "WebsiteHero" ("Id", "Version", "FontKey", "AutoplayEnabled", "IntervalSeconds", "Title", "Description", "PrimaryActionLabel", "SecondaryActionLabel", "UpdatedAtUtc", "UpdatedByStaffId")
        VALUES (1, 1, 'default', true, 6, 'The BHA — Đà Nẵng', 'Đặt phòng trực tiếp, xem giá từng đêm.', 'Tìm phòng', 'Xem Riverside', now(), NULL);
        INSERT INTO "WebsiteHeroMedia" ("Id", "Kind", "StorageKey", "ContentType", "ByteSize", "Width", "Height", "CreatedAtUtc", "CreatedByStaffId") VALUES
        ('e51f4612-9102-5afa-99f0-c9bf9d4d7c67', 'seed', 'seed/hero-dragon-bridge-dusk.webp', 'image/webp', 93254, 1920, 900, now(), NULL),
        ('65d3f728-975b-5bcb-80ee-d066ebe66541', 'seed', 'seed/hero-my-khe-beach.webp', 'image/webp', 471546, 1920, 900, now(), NULL),
        ('6d223738-150f-5794-92d8-4a9d842fee79', 'seed', 'seed/hero-danang-skyline.webp', 'image/webp', 78088, 1920, 900, now(), NULL),
        ('129367df-d78e-5287-9642-7f27e182fb74', 'seed', 'seed/hero-han-river-night.webp', 'image/webp', 138810, 1920, 900, now(), NULL);
        INSERT INTO "WebsiteHeroSlides" ("Id", "MediaId", "SortOrder", "FocalPosition", "Alt", "Caption") VALUES
        ('a60b7be4-abc5-5c14-b06b-174284175fd6', 'e51f4612-9102-5afa-99f0-c9bf9d4d7c67', 0, '40% 50%', 'Cầu Rồng và sông Hàn lúc hoàng hôn, Đà Nẵng', 'Cầu Rồng và sông Hàn lúc hoàng hôn'),
        ('77a9cc93-3bbf-5525-8472-2be985210fb3', '65d3f728-975b-5bcb-80ee-d066ebe66541', 1, '50% 50%', 'Bãi biển Mỹ Khê với hàng dừa, Đà Nẵng', 'Bãi biển Mỹ Khê'),
        ('1cf044a5-6b89-59d0-8c1c-fce0ffdbacb1', '6d223738-150f-5794-92d8-4a9d842fee79', 2, '50% 50%', 'Đường chân trời Đà Nẵng lúc chạng vạng', 'Đường chân trời Đà Nẵng lúc chạng vạng'),
        ('1d6f7a55-c0ff-554e-a4df-4d1927280ba7', '129367df-d78e-5287-9642-7f27e182fb74', 3, '60% 50%', 'Cầu quay sông Hàn về đêm, Đà Nẵng', 'Sông Hàn về đêm');
        INSERT INTO "WebsiteTranslations" ("LanguageId", "Key", "Value", "Version", "UpdatedAtUtc", "UpdatedByStaffId", "IsManual", "SourceHash")
        SELECT l."Id", v.key, v.value, 1, now(), NULL, false, v.hash
        FROM "WebsiteLanguages" l JOIN (VALUES
        ('en', 'content.heroSlideshow.main.title', 'The BHA — Da Nang', '4144d8e24f20c439'),
        ('fr', 'content.heroSlideshow.main.title', 'The BHA — Da Nang', '4144d8e24f20c439'),
        ('en', 'content.heroSlideshow.main.description', 'Book direct and see the price night by night.', 'a42eaea3f727a766'),
        ('fr', 'content.heroSlideshow.main.description', 'Réservez en direct et consultez le prix nuit par nuit.', 'a42eaea3f727a766'),
        ('en', 'content.heroSlideshow.main.primaryAction', 'Find a room', 'f90c3231e88057d6'),
        ('fr', 'content.heroSlideshow.main.primaryAction', 'Trouver une chambre', 'f90c3231e88057d6'),
        ('en', 'content.heroSlideshow.main.secondaryAction', 'View Riverside', '1779aa5b9500bac6'),
        ('fr', 'content.heroSlideshow.main.secondaryAction', 'Voir Riverside', '1779aa5b9500bac6'),
        ('en', 'content.heroSlide.a60b7be4-abc5-5c14-b06b-174284175fd6.alt', 'The Dragon Bridge and the Han River at dusk, Da Nang', '8c2818b344dfb69d'),
        ('fr', 'content.heroSlide.a60b7be4-abc5-5c14-b06b-174284175fd6.alt', 'Le Pont du Dragon et la rivière Han au crépuscule, Da Nang', '8c2818b344dfb69d'),
        ('en', 'content.heroSlide.a60b7be4-abc5-5c14-b06b-174284175fd6.caption', 'The Dragon Bridge and the Han River at dusk', '93f13e6f14a2c75c'),
        ('fr', 'content.heroSlide.a60b7be4-abc5-5c14-b06b-174284175fd6.caption', 'Le Pont du Dragon et la rivière Han au crépuscule', '93f13e6f14a2c75c'),
        ('en', 'content.heroSlide.77a9cc93-3bbf-5525-8472-2be985210fb3.alt', 'My Khe Beach with a row of coconut palms, Da Nang', '9c275c9304e18ff6'),
        ('fr', 'content.heroSlide.77a9cc93-3bbf-5525-8472-2be985210fb3.alt', 'La plage de My Khe et ses cocotiers, Da Nang', '9c275c9304e18ff6'),
        ('en', 'content.heroSlide.77a9cc93-3bbf-5525-8472-2be985210fb3.caption', 'My Khe Beach', 'b36fc9337da82c85'),
        ('fr', 'content.heroSlide.77a9cc93-3bbf-5525-8472-2be985210fb3.caption', 'La plage de My Khe', 'b36fc9337da82c85'),
        ('en', 'content.heroSlide.1cf044a5-6b89-59d0-8c1c-fce0ffdbacb1.alt', 'The Da Nang skyline at dusk', 'ea67fc98f6d29a69'),
        ('fr', 'content.heroSlide.1cf044a5-6b89-59d0-8c1c-fce0ffdbacb1.alt', 'La ligne d’horizon de Da Nang au crépuscule', 'ea67fc98f6d29a69'),
        ('en', 'content.heroSlide.1cf044a5-6b89-59d0-8c1c-fce0ffdbacb1.caption', 'The Da Nang skyline at dusk', 'ea67fc98f6d29a69'),
        ('fr', 'content.heroSlide.1cf044a5-6b89-59d0-8c1c-fce0ffdbacb1.caption', 'La ligne d’horizon de Da Nang au crépuscule', 'ea67fc98f6d29a69'),
        ('en', 'content.heroSlide.1d6f7a55-c0ff-554e-a4df-4d1927280ba7.alt', 'A Han River bridge at night, Da Nang', '079f250f6ad087a2'),
        ('fr', 'content.heroSlide.1d6f7a55-c0ff-554e-a4df-4d1927280ba7.alt', 'Un pont de la rivière Han de nuit, Da Nang', '079f250f6ad087a2'),
        ('en', 'content.heroSlide.1d6f7a55-c0ff-554e-a4df-4d1927280ba7.caption', 'A Han River bridge at night', '9ed542369c12502d'),
        ('fr', 'content.heroSlide.1d6f7a55-c0ff-554e-a4df-4d1927280ba7.caption', 'Un pont de la rivière Han de nuit', '9ed542369c12502d')
        ) AS v(code, key, value, hash) ON v.code = l."NormalizedCode";
        """;
}
