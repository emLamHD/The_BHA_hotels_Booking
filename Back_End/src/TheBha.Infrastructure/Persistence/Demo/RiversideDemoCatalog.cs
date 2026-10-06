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
        Add("two-bedroom-balcony-view.webp", "Ban công căn hộ hai phòng ngủ nhìn ra thành phố", roomType, "RIV-2BR", 0, true);
        Add("two-bedroom-skyline-1.webp", "Khung cảnh khu dân cư nhìn từ trên cao", roomType, "RIV-2BR", 1, false);
        Add("two-bedroom-skyline-2.webp", "Toàn cảnh khu dân cư và đồi núi phía xa nhìn từ trên cao", roomType, "RIV-2BR", 2, false);
        return items;
    }
}
