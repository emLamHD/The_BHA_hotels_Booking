/** BHA-ADMIN-BADGE-001-PR04: the registry is the one list of the 15 menus of ADR 0011 §C, with today's paths. */
import { describe, expect, it } from "vitest";
import { ADMIN_MENUS, ADMIN_MENU, isAdminMenuKey } from "./adminMenus";

describe("the Admin menu registry", () => {
  it("holds exactly the 15 keys the ADR fixes, once each, every one with a badge", () => {
    expect(ADMIN_MENUS.map((entry) => entry.key).sort()).toEqual([
      "blog-categories", "blog-media", "blog-posts", "blog-settings", "calendar", "catalog", "newsletter", "newsletter-sender", "promotions",
      "website-currencies", "website-hero", "website-languages", "website-menus", "website-social", "website-translations",
    ]);
    expect(ADMIN_MENUS.every((entry) => entry.badge)).toBe(true);
  });
  it("only Promotions and Calendar are per Property; Catalog is global even though its routes carry a Property id", () => {
    expect(ADMIN_MENUS.filter((entry) => entry.scope === "property").map((entry) => entry.key).sort()).toEqual(["calendar", "promotions"]);
    expect(ADMIN_MENU.catalog.scope).toBe("global");
  });
  it("keeps the paths the sidebar goes to today, each once", () => {
    expect(ADMIN_MENU.catalog.path).toBe("/products");
    expect(ADMIN_MENU.promotions.path).toBe("/promotions");
    expect(ADMIN_MENU.calendar.path).toBe("/calendar");
    expect(ADMIN_MENU.newsletter.path).toBe("/website/newsletter");
    expect(ADMIN_MENU["newsletter-sender"].path).toBe("/website/newsletter/sender");
    expect(new Set(ADMIN_MENUS.map((entry) => entry.path)).size).toBe(15);
  });
  it("knows its own keys and nothing inherited", () => {
    expect(isAdminMenuKey("calendar")).toBe(true);
    for (const other of ["dashboard", "", "toString", "__proto__"]) expect(isAdminMenuKey(other)).toBe(false);
  });
});
