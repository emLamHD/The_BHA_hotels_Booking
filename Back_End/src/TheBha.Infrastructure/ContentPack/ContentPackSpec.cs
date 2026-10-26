using System.Text.Json;
using System.Text.Encodings.Web;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>
/// BHA-CONTENT-PERSIST-001: what a content pack holds, in the order it is written, and why every other table is not in it.
/// A pack is the website's content as one database serves it (catalog, promotions, Blog) as rows plus the picture files those
/// rows need. The exporter refuses a database that has a table this class does not classify, so a new table can never be left
/// out silently.
/// </summary>
public static class ContentPackSpec
{
    public const int FormatVersion = 1;

    /// <summary>Stands for the Customer origin in <c>Media.Url</c>; the importer puts the target's origin there.</summary>
    public const string OriginToken = "{{MEDIA_ORIGIN}}";

    /// <summary>Stands for the Staff account the operator names at import; a pack never carries a source Staff id.</summary>
    public const string ActorToken = "@actor";

    /// <summary>The importer's own advisory-lock key (not the booking registry's): one import at a time per database.</summary>
    public const long AdvisoryLockKey = 0x4248_4143_5041_434B; // "BHACPACK"

    public static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, WriteIndented = false };

    /// <summary>Property-scoped selection: <c>@pids</c> is the uuid[] of the properties the operator named.</summary>
    private const string Roomtypes = "(SELECT \"Id\" FROM \"RoomTypes\" WHERE \"PropertyId\" = ANY(@pids))";

    /// <summary>Included tables in dependency order (a table follows everything it refers to). <c>Where</c> is a predicate on alias <c>t</c>.</summary>
    public static readonly IReadOnlyList<(string Table, string Where)> Included =
    [
        ("Properties", "t.\"Id\" = ANY(@pids)"),
        ("Amenities", "t.\"Id\" IN (SELECT \"AmenityId\" FROM \"PropertyAmenities\" WHERE \"PropertyId\" = ANY(@pids) UNION SELECT \"AmenityId\" FROM \"RoomTypeAmenities\" WHERE \"RoomTypeId\" IN " + Roomtypes + ")"),
        ("RatePlans", "t.\"PropertyId\" = ANY(@pids)"),
        ("RoomTypes", "t.\"PropertyId\" = ANY(@pids)"),
        ("PropertyAmenities", "t.\"PropertyId\" = ANY(@pids)"),
        ("RoomTypeAmenities", "t.\"RoomTypeId\" IN " + Roomtypes),
        ("PhysicalRooms", "t.\"PropertyId\" = ANY(@pids)"),
        ("Media", "t.\"Id\" IN (SELECT \"MediaId\" FROM \"PropertyMedia\" WHERE \"PropertyId\" = ANY(@pids) UNION SELECT \"MediaId\" FROM \"RoomTypeMedia\" WHERE \"RoomTypeId\" IN " + Roomtypes + ")"),
        ("PropertyMedia", "t.\"PropertyId\" = ANY(@pids)"),
        ("RoomTypeMedia", "t.\"RoomTypeId\" IN " + Roomtypes),
        ("DailyRoomRates", "t.\"PropertyId\" = ANY(@pids)"),
        ("DailyInventoryControls", "t.\"PropertyId\" = ANY(@pids)"),
        ("PromotionMedia", "t.\"PropertyId\" = ANY(@pids)"),
        ("Promotions", "t.\"PropertyId\" = ANY(@pids)"),
        ("PromotionRoomTypes", "t.\"PropertyId\" = ANY(@pids)"),
        ("BlogCategories", "true"),
        ("BlogCategoryTranslations", "true"),
        ("BlogCategorySlugs", "true"),
        ("BlogMedia", "true"),
        ("BlogPosts", "true"),
        ("BlogPostTranslations", "true"),
        ("BlogPostSlugs", "true"),
        ("BlogPostRevisions", "true"),
        ("BlogRevisionCategories", "true"),
        ("BlogRevisionMedia", "true"),
        ("BlogCategoryPins", "true"),
        ("BlogSettings", "true"),
    ];

    /// <summary>Not in a pack, with the reason (reported by the exporter with the row count).</summary>
    public static readonly IReadOnlyDictionary<string, string> Excluded = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["StaffAccounts"] = "people and credentials; the operator names an existing Staff at import",
        ["StaffPropertyMemberships"] = "people; created with the Staff CLI",
        ["BlogAudits"] = "history of the source's Staff actions",
        ["PromotionAudits"] = "history of the source's Staff actions",
        ["BlogMediaVariants"] = "derived from the originals; the picture pipeline rebuilds them at import (--blog-media-maintain's backfill)",
        ["AspNetUserClaims"] = "identity data", ["AspNetUserLogins"] = "identity data", ["AspNetUserTokens"] = "identity data", ["AspNetUsers"] = "identity data",
        ["__EFMigrationsHistory"] = "schema history",
    };

    /// <summary>Booking and test-transaction tables: never exported; the exporter reports their row counts so an empty source is a statement, not a guess.</summary>
    public static readonly IReadOnlyList<string> Transactional =
    [
        "Reservations", "ReservationUnits", "ReservationUnitNights", "InventoryHolds", "InventoryHoldItems", "InventoryHoldItemNights", "RoomBlocks",
        "RoomOccupancySegments", "RoomOccupancySegmentAudits", "BookingPromotionApplications", "AdminCatalogCreateOperations", "CatalogContentAudits", "CatalogUploads",
    ];

    /// <summary>Website configuration every migrated database already has (migration seeds); the pack does not copy it. Only the active-language choice travels.</summary>
    public static readonly IReadOnlyList<string> MigrationSeeded =
    [
        "WebsiteCurrencies", "WebsiteHero", "WebsiteHeroMedia", "WebsiteHeroSlides", "WebsiteMenu", "WebsiteMenuItems", "WebsiteSocialSettings", "WebsiteTranslations", "WebsiteLanguages",
    ];

    public static readonly IReadOnlyList<string> Groups = ["catalog", "promotions", "blog"];

    /// <summary>catalog = the properties and everything a guest books; promotions = the offers; blog = categories, posts and pictures.</summary>
    public static string GroupOf(string table) => table.StartsWith("Blog", StringComparison.Ordinal) ? "blog" : table.StartsWith("Promotion", StringComparison.Ordinal) || table == "Promotions" ? "promotions" : "catalog";

    public static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"") + "\"";
}
