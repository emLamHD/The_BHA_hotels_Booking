namespace TheBha.Infrastructure.Persistence;

/// <summary>Frozen one-time seed for migration 14 and integration-test database resets.</summary>
public static class WebsiteSocialSeed
{
    public const string Sql = """
        INSERT INTO "WebsiteSocialSettings" ("Id", "Version", "PhoneEnabled", "PhoneNumber", "PhoneHref", "MessengerEnabled", "MessengerUrl", "ZaloEnabled", "ZaloNumber", "ZaloUrl", "BackToTopEnabled", "UpdatedAtUtc", "UpdatedByStaffId")
        VALUES (1, 1, true, '0899474888', 'tel:+84899474888', false, NULL, false, NULL, NULL, true, TIMESTAMPTZ '2026-10-17 00:00:00+00', NULL);
        """;
}
