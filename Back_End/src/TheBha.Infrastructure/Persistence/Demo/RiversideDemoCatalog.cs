namespace TheBha.Infrastructure.Persistence.Demo;

public enum RiversideMediaOwner
{
    Property,
    RoomType,
}

/// <summary>One sellable apartment type. <see cref="Rooms"/> is how many PhysicalRooms stock it.</summary>
public sealed record RiversideRoomTypeDefinition(
    Guid Id,
    string Code,
    string Name,
    string Slug,
    string Description,
    int BaseOccupancy,
    int MaxOccupancy,
    int Rooms,
    decimal NightlyRate,
    string RoomNumberPrefix);

/// <summary>An old-to-new change of one RoomType media link's sort order / cover flag (see LinkMigrations).</summary>
public sealed record RiversideLinkMigration(
    string RoomTypeCode,
    string FileName,
    int FromSortOrder,
    bool FromIsCover,
    int ToSortOrder,
    bool ToIsCover);

public sealed record RiversideAmenityDefinition(Guid Id, string Code, string Name, string Category);

/// <summary>One published photograph. The file lives in Customer_Web's controlled media namespace.</summary>
public sealed record RiversideMediaDefinition(
    Guid Id,
    string FileName,
    string AltText,
    RiversideMediaOwner OwnerType,
    string OwnerCode,
    int SortOrder,
    bool IsCover);

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: the one definition of the Riverside demo catalog the
/// <see cref="RiversideDemoSeeder"/> writes. Owner-stated facts only: one Property, three
/// RoomTypes stocked by 3 / 2 / 6 PhysicalRooms (11), demo guest limits 2 / 2 / 4, and flat
/// nightly prices of 1,000,000 / 1,100,000 / 1,600,000 VND. Everything the Owner has not
/// supplied (address, city, real room numbers and floors) is marked as pending, never invented.
/// The media entries must equal <c>Front_End/Customer_Web/scripts/riverside-media/manifest.json</c>
/// (a test enforces it, including every file's SHA-256).
/// </summary>
public static class RiversideDemoCatalog
{
    public const string PropertySlug = "the-bha-riverside";
    public const string PropertyName = "The BHA Riverside";
    public const string TimeZoneId = "Asia/Ho_Chi_Minh";
    public const string RatePlanCode = "STANDARD";
    public const string CurrencyCode = "VND";
    public const string MediaPathPrefix = "/media/the-bha-riverside/";

    /// <summary>The "floor" every demo room carries: unknown, not a real floor.</summary>
    public const int PlaceholderFloor = 0;

    public static readonly Guid PropertyId = Guid.Parse("a1000000-0000-0000-0000-000000000001");
    public static readonly Guid RatePlanId = Guid.Parse("a6000000-0000-0000-0000-000000000001");

    public const string PropertyDescription =
        "The BHA Riverside. Thông tin chi tiết về chỗ nghỉ đang được cập nhật; giờ nhận phòng 14:00 " +
        "và trả phòng 12:00 là mặc định của bản demo.";
    public const string PendingAddress = "Địa chỉ đang được cập nhật";
    public const string PendingCity = "Đang cập nhật";
    public const string Country = "Vietnam";

    public static readonly IReadOnlyList<RiversideRoomTypeDefinition> RoomTypes =
    [
        new(Guid.Parse("a3000000-0000-0000-0000-000000000001"), "RIV-1BR", "Căn hộ một phòng ngủ",
            "can-ho-mot-phong-ngu", "Căn hộ một phòng ngủ. Thông tin chi tiết đang được cập nhật.",
            BaseOccupancy: 2, MaxOccupancy: 2, Rooms: 3, NightlyRate: 1_000_000m, RoomNumberPrefix: "DEMO-1BR"),
        new(Guid.Parse("a3000000-0000-0000-0000-000000000002"), "RIV-1BR-OPEN", "Căn hộ một phòng ngủ view thoáng",
            "can-ho-mot-phong-ngu-view-thoang", "Căn hộ một phòng ngủ view thoáng. Thông tin chi tiết đang được cập nhật.",
            BaseOccupancy: 2, MaxOccupancy: 2, Rooms: 2, NightlyRate: 1_100_000m, RoomNumberPrefix: "DEMO-1BR-OPEN"),
        new(Guid.Parse("a3000000-0000-0000-0000-000000000003"), "RIV-2BR", "Căn hộ hai phòng ngủ",
            "can-ho-hai-phong-ngu", "Căn hộ hai phòng ngủ. Thông tin chi tiết đang được cập nhật.",
            BaseOccupancy: 4, MaxOccupancy: 4, Rooms: 6, NightlyRate: 1_600_000m, RoomNumberPrefix: "DEMO-2BR"),
    ];

    /// <summary>Only what the Owner stated: a pool and a rooftop. No per-room amenity is claimed.</summary>
    public static readonly IReadOnlyList<RiversideAmenityDefinition> PropertyAmenities =
    [
        new(Guid.Parse("a2000000-0000-0000-0000-000000000001"), "RIV-POOL", "Hồ bơi trên sân thượng", "Wellness"),
        new(Guid.Parse("a2000000-0000-0000-0000-000000000002"), "RIV-ROOFTOP", "Sân thượng", "Outdoor"),
    ];

    public static int TotalRooms => RoomTypes.Sum(type => type.Rooms);

    public static readonly IReadOnlyList<RiversideMediaDefinition> Media = BuildMedia();

    /// <summary>
    /// CUST-WEB-SHOWCASE-001-CP02-C3: the one change to links an earlier seed already wrote. RIV-2BR was seeded
    /// with the balcony view as its cover (order 0) and the two skyline pictures at orders 1 and 2; the room's
    /// interior is now its cover and those three move behind it. The patch touches only these links, only while
    /// they still hold exactly the old values (<c>From*</c>); an operator's own edit is left alone and reported.
    /// A link already at the new values is "applied" and silent, so a rerun changes nothing. Demotions run before
    /// promotions because a room type may have only one cover.
    /// </summary>
    public static readonly IReadOnlyList<RiversideLinkMigration> LinkMigrations =
    [
        new("RIV-2BR", "two-bedroom-balcony-view.webp", FromSortOrder: 0, FromIsCover: true, ToSortOrder: 6, ToIsCover: false),
        new("RIV-2BR", "two-bedroom-skyline-1.webp", FromSortOrder: 1, FromIsCover: false, ToSortOrder: 7, ToIsCover: false),
        new("RIV-2BR", "two-bedroom-skyline-2.webp", FromSortOrder: 2, FromIsCover: false, ToSortOrder: 8, ToIsCover: false),
        // The interior picture was inserted as a regular image (the room already had a cover); it becomes the cover.
        new("RIV-2BR", "two-bedroom-living.webp", FromSortOrder: 0, FromIsCover: false, ToSortOrder: 0, ToIsCover: true),
    ];

    private static IReadOnlyList<RiversideMediaDefinition> BuildMedia()
    {
        var items = new List<RiversideMediaDefinition>();
        void Add(string file, string alt, RiversideMediaOwner owner, string code, int order, bool cover) =>
            items.Add(new RiversideMediaDefinition(
                Guid.Parse($"a5000000-0000-0000-0000-{items.Count + 1:000000000000}"), file, alt, owner, code, order, cover));

        const RiversideMediaOwner property = RiversideMediaOwner.Property;
        const RiversideMediaOwner roomType = RiversideMediaOwner.RoomType;
        Add("entrance-logo.webp", "Cửa kính lối vào có biển hiệu The BHA Riverside và hai ghế thư giãn", property, PropertySlug, 0, true);
        Add("rooftop-pool-day.webp", "Hồ bơi trên sân thượng vào ban ngày", property, PropertySlug, 1, false);
        Add("rooftop-pool-night.webp", "Hồ bơi trên sân thượng về đêm", property, PropertySlug, 2, false);
        Add("rooftop-pool-seating.webp", "Hồ bơi và khu bàn ghế ngồi trên sân thượng", property, PropertySlug, 3, false);
        Add("rooftop-pool-city-view.webp", "Hồ bơi sân thượng nhìn ra toàn cảnh khu dân cư", property, PropertySlug, 4, false);
        Add("rooftop-pool-mural.webp", "Hồ bơi sân thượng với bức tranh tường và phao cứu sinh", property, PropertySlug, 5, false);
        Add("lobby-sofa.webp", "Khu ghế sofa và bàn trà trong sảnh", property, PropertySlug, 6, false);
        Add("lobby-logo-clocks.webp", "Logo The BHA Riverside và ba đồng hồ giờ quốc tế trên tường sảnh", property, PropertySlug, 7, false);
        Add("lobby-shelves.webp", "Kệ sách và bàn ăn nhỏ trong sảnh", property, PropertySlug, 8, false);
        Add("entrance-chairs.webp", "Lối vào có cây xanh và bộ bàn ghế trước cửa kính", property, PropertySlug, 9, false);
        Add("two-bedroom-balcony-view.webp", "Ban công căn hộ hai phòng ngủ nhìn ra thành phố", roomType, "RIV-2BR", 6, false);
        Add("two-bedroom-skyline-1.webp", "Khung cảnh khu dân cư nhìn từ trên cao", roomType, "RIV-2BR", 7, false);
        Add("two-bedroom-skyline-2.webp", "Toàn cảnh khu dân cư và đồi núi phía xa nhìn từ trên cao", roomType, "RIV-2BR", 8, false);
        Add("one-bedroom-living.webp", "Phòng khách có ghế sofa và bàn trà, phía sau là giường ngủ", roomType, "RIV-1BR", 0, true);
        Add("one-bedroom-bedroom-1.webp", "Phòng ngủ với giường đôi, tủ quần áo và tranh treo tường", roomType, "RIV-1BR", 1, false);
        Add("one-bedroom-bedroom-2.webp", "Phòng ngủ nhìn về phía cửa kính ra ban công", roomType, "RIV-1BR", 2, false);
        Add("one-bedroom-kitchen.webp", "Khu bếp nhỏ có bồn rửa, bếp và máy giặt", roomType, "RIV-1BR", 3, false);
        Add("one-bedroom-bathroom.webp", "Phòng tắm có bồn rửa, bồn cầu và buồng tắm kính", roomType, "RIV-1BR", 4, false);
        Add("one-bedroom-balcony.webp", "Ban công hẹp có bàn cao và nhìn thấy phòng ngủ phía sau", roomType, "RIV-1BR", 5, false);
        Add("open-view-living.webp", "Phòng khách có ghế sofa, bàn ăn nhỏ và giường ngủ phía sau cửa kính", roomType, "RIV-1BR-OPEN", 0, true);
        Add("open-view-living-dining.webp", "Phòng khách với sofa, bàn ăn, tivi và tủ lạnh", roomType, "RIV-1BR-OPEN", 1, false);
        Add("open-view-bedroom-balcony.webp", "Phòng ngủ có cửa kính mở ra ban công nhìn cây xanh", roomType, "RIV-1BR-OPEN", 2, false);
        Add("open-view-bedroom.webp", "Phòng ngủ với giường đôi, tủ quần áo và rèm trắng", roomType, "RIV-1BR-OPEN", 3, false);
        Add("open-view-balcony.webp", "Ban công nhìn ra hàng cây và khu dân cư", roomType, "RIV-1BR-OPEN", 4, false);
        Add("open-view-bathroom.webp", "Phòng tắm có vòi sen, bồn rửa và bồn cầu", roomType, "RIV-1BR-OPEN", 5, false);
        Add("two-bedroom-living.webp", "Phòng khách có ghế sofa, bàn trà và tivi", roomType, "RIV-2BR", 0, true);
        Add("two-bedroom-bedroom-1.webp", "Phòng ngủ thứ nhất với giường đôi và tủ quần áo", roomType, "RIV-2BR", 1, false);
        Add("two-bedroom-bedroom-2.webp", "Phòng ngủ có cửa kính ra ban công", roomType, "RIV-2BR", 2, false);
        Add("two-bedroom-bedroom-night.webp", "Phòng ngủ về đêm nhìn ra ánh đèn thành phố", roomType, "RIV-2BR", 3, false);
        Add("two-bedroom-bedroom-tv.webp", "Phòng ngủ có tivi treo tường và cửa sổ", roomType, "RIV-2BR", 4, false);
        Add("two-bedroom-bathroom.webp", "Phòng tắm có vòi sen, bồn rửa và bồn cầu", roomType, "RIV-2BR", 5, false);
        return items;
    }
}
