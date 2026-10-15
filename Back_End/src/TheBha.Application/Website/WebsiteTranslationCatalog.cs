namespace TheBha.Application.Website;

/// <summary>
/// One managed UI string. The key is a stable identifier (never shown); <see cref="Vietnamese"/> is the source
/// text lifted from the current Customer_Web UI (<see cref="Source"/>); <see cref="English"/> is an authored
/// translation, not a source. The values administered in the database start from these. Plain text only.
/// </summary>
public sealed record TranslationKeyDefinition(
    string Key,
    string Group,
    string Vietnamese,
    string English,
    string Source,
    IReadOnlyList<string> Placeholders);

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the managed key set — the header/menu labels and the common controls the Customer_Web
/// UI actually shows today. Admin edits the values, never the keys: a key for new content is added here, with a
/// migration that seeds its Vietnamese and English rows, when that content is built. There is no save, cancel,
/// delete or confirm key because Customer_Web has no standalone label for any of them (only compound ones such
/// as "Xác nhận đặt phòng"); inventing a source for them would change the product's wording.
/// </summary>
public static class WebsiteTranslationCatalog
{
    public const string GroupMenu = "header-menu";
    public const string GroupAccount = "header-account";
    public const string GroupCommon = "common";

    private static readonly string[] NoPlaceholders = [];

    public static IReadOnlyList<TranslationKeyDefinition> All { get; } =
    [
        // Desktop header and mobile drawer menu.
        K("header.menu.riverside", GroupMenu, "Riverside", "Riverside", "src/lib/riversideHomeContent.ts:51"),
        K("header.menu.offers", GroupMenu, "Ưu đãi", "Offers", "src/lib/riversideHomeContent.ts:52"),
        K("header.menu.blog", GroupMenu, "Blog", "Blog", "src/lib/riversideHomeContent.ts:53"),
        K("header.menu.services", GroupMenu, "Dịch vụ", "Services", "src/app/(client-components)/(Header)/DropdownTravelers.tsx:71"),
        K("header.menu.templates", GroupMenu, "Giao diện mẫu", "Sample templates", "src/app/(client-components)/(Header)/TemplatesDropdown.tsx:41"),
        K("header.menu.languageCurrency", GroupMenu, "Ngôn ngữ và tiền tệ", "Language and currency", "src/app/(client-components)/(Header)/LangDropdown.tsx:145"),
        K("header.menu.language", GroupMenu, "Ngôn ngữ", "Language", "src/app/(client-components)/(Header)/LangDropdown.tsx:67"),
        K("header.menu.currency", GroupMenu, "Tiền tệ", "Currency", "src/app/(client-components)/(Header)/LangDropdown.tsx:67"),
        K("header.menu.openMenu", GroupMenu, "Mở menu", "Open menu", "src/shared/MenuBar.tsx:71"),
        K("header.menu.menu", GroupMenu, "Menu", "Menu", "src/components/FooterNav.tsx:52"),
        K("header.theme.toDark", GroupMenu, "Bật chế độ tối", "Switch to dark mode", "src/shared/SwitchDarkMode.tsx:24"),
        K("header.theme.toLight", GroupMenu, "Bật chế độ sáng", "Switch to light mode", "src/shared/SwitchDarkMode.tsx:24"),
        K("header.note.languageCurrencyDemo", GroupMenu,
            "Bản demo: lựa chọn này chưa được áp dụng. Trang vẫn hiển thị tiếng Việt và giá bằng VND.",
            "Demo: this choice is not applied yet. The page still shows Vietnamese and prices in VND.",
            "src/app/(client-components)/(Header)/LangDropdown.tsx:33"),

        // Account entries of the header.
        K("header.account.account", GroupAccount, "Tài khoản", "Account", "src/lib/customerAuthUi.ts:294"),
        K("header.account.myAccount", GroupAccount, "Tài khoản của tôi", "My account", "src/app/(client-components)/(Header)/AvatarDropdown.tsx:146"),
        K("header.account.signIn", GroupAccount, "Đăng nhập", "Sign in", "src/app/(client-components)/(Header)/AvatarDropdown.tsx:125"),
        K("header.account.createAccount", GroupAccount, "Tạo tài khoản", "Create account", "src/app/(client-components)/(Header)/AvatarDropdown.tsx:136"),
        K("header.account.signOut", GroupAccount, "Đăng xuất", "Sign out", "src/app/(client-components)/(Header)/AvatarDropdown.tsx:200"),

        // Controls and states that appear across the pages today.
        K("common.close", GroupCommon, "Đóng", "Close", "src/app/(client-components)/(HeroSearchForm2Mobile)/HeroSearchForm2Mobile.tsx:130"),
        K("common.retry", GroupCommon, "Thử lại", "Try again", "src/app/(stay-listings)/ListingStayResults.tsx:99"),
        K("common.loading", GroupCommon, "Đang tải…", "Loading…", "src/app/(stay-listings)/ListingStayResults.tsx:65"),
        K("common.clearFilters", GroupCommon, "Xoá bộ lọc", "Clear filters", "src/app/(stay-listings)/ListingStayResults.tsx:78"),
        K("common.error.generic", GroupCommon,
            "Hệ thống đặt phòng đang gặp sự cố. Hãy thử lại sau.",
            "The booking system is having a problem. Please try again later.",
            "src/lib/stayListingSearch.ts:88"),
        K("common.error.network", GroupCommon,
            "Không kết nối được tới hệ thống đặt phòng. Kiểm tra kết nối rồi thử lại.",
            "Could not reach the booking system. Check your connection and try again.",
            "src/lib/stayListingSearch.ts:80"),
        K("common.error.loadFailed", GroupCommon,
            "Đã có lỗi khi tải {what}.",
            "Something went wrong while loading {what}.",
            "src/app/(listing-detail)/listing-stay-detail/RoomDetailsRoot.tsx:28",
            "what"),
    ];

    public static IReadOnlyDictionary<string, TranslationKeyDefinition> ByKey { get; } =
        All.ToDictionary(definition => definition.Key, StringComparer.Ordinal);

    public static IReadOnlyList<string> Groups { get; } = [GroupMenu, GroupAccount, GroupCommon];

    private static TranslationKeyDefinition K(string key, string group, string vietnamese, string english, string source, params string[] placeholders) =>
        new(key, group, vietnamese, english, source, placeholders.Length == 0 ? NoPlaceholders : placeholders);
}
