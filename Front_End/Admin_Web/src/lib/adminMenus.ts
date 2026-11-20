/**
 * BHA-ADMIN-BADGE-001-PR04 (ADR 0011 §C/§F): the ONE list of the Admin menus that can carry an unseen badge. The sidebar builds its entries from it and the provider reads the API's
 * answer through it. `key` is the server's menu key (fixed by the ADR), `path` is where the entry goes today and `scope` says whether the API answers per Property. Template items
 * (Dashboard, Forms, Tables, Charts, UI Elements …) are not menus: they have no key, so they can never show a badge. A row here creates no recorder and no permission on the server.
 */

export type AdminMenuKey =
  | "blog-posts" | "blog-categories" | "blog-media" | "blog-settings"
  | "website-hero" | "website-menus" | "website-languages" | "website-translations" | "website-currencies" | "website-social"
  | "newsletter-sender" | "newsletter" | "promotions" | "catalog" | "calendar";

export interface AdminMenu {
  key: AdminMenuKey;
  label: string;
  path: string;
  /** `property`: the API answers `byProperty` (Promotions, Calendar). Catalog is global even though its routes carry a Property id (ADR §C). */
  scope: "global" | "property";
  /** Whether the sidebar shows a number for it. */
  badge: boolean;
}

const menu = (key: AdminMenuKey, label: string, path: string, scope: AdminMenu["scope"] = "global"): AdminMenu => ({ key, label, path, scope, badge: true });

export const ADMIN_MENUS: readonly AdminMenu[] = [
  menu("catalog", "Cơ sở & loại phòng", "/products"),
  menu("promotions", "Ưu đãi đặt phòng", "/promotions", "property"),
  menu("calendar", "Calendar", "/calendar", "property"),
  menu("website-languages", "Ngôn ngữ & bản dịch", "/website/languages"),
  menu("website-translations", "Bản dịch", "/website/translations"),
  menu("website-currencies", "Tiền tệ & tỷ giá", "/website/currencies"),
  menu("website-menus", "Menu", "/website/menus"),
  menu("website-hero", "Banner trang chủ", "/website/hero"),
  menu("website-social", "Social media", "/website/social-media"),
  menu("newsletter", "Đăng ký nhận tin", "/website/newsletter"),
  menu("newsletter-sender", "Cấu hình email gửi", "/website/newsletter/sender"),
  menu("blog-posts", "Blog: Bài viết", "/website/blog/posts"),
  menu("blog-categories", "Blog: Chuyên mục", "/website/blog/categories"),
  menu("blog-media", "Blog: Thư viện ảnh", "/website/blog/media"),
  menu("blog-settings", "Blog: Cấu hình", "/website/blog/settings"),
];

export const ADMIN_MENU = Object.fromEntries(ADMIN_MENUS.map((entry) => [entry.key, entry])) as Readonly<Record<AdminMenuKey, AdminMenu>>;

export const isAdminMenuKey = (key: string): key is AdminMenuKey => Object.hasOwn(ADMIN_MENU, key);
