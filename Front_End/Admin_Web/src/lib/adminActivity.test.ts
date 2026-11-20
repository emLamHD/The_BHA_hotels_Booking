/** BHA-ADMIN-BADGE-001-PR05: the Admin's day boundary and which scopes a summary allows. */
import { describe, expect, it } from "vitest";
import { actorLabel, allowedMenus, allowedProperties, dayAfter, dayStart, isCalendarDay, resolveScope } from "./adminActivity";
import type { MenuUnseenSummary } from "./api/menuUnseen";

const global = (count: number) => ({ count, lastSeenWatermark: "0", currentWatermark: String(count) });
const byProperty = (...ids: string[]) => ({ count: ids.length, byProperty: ids.map((propertyId) => ({ propertyId, count: 1, lastSeenWatermark: "0", currentWatermark: "1" })) });

describe("days in Admin time", () => {
  it("a day starts at 00:00 +07:00 and 'to' is the start of the next day (exclusive), across month and year ends and leap days", () => {
    expect(dayStart("2026-11-15")).toBe("2026-11-15T00:00:00+07:00");
    expect(dayAfter("2026-11-15")).toBe("2026-11-16T00:00:00+07:00");
    expect(dayAfter("2026-11-30")).toBe("2026-12-01T00:00:00+07:00");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01T00:00:00+07:00");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29T00:00:00+07:00");
    expect(dayAfter("2027-02-28")).toBe("2027-03-01T00:00:00+07:00");
  });
  it("only a real calendar date is a day", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-29", "2026-02-30", "2026-13-01", "2026-1-1", "15/11/2026", "", "2026-11-15T00:00"]) expect(isCalendarDay(bad)).toBe(false);
  });
});

describe("scopes", () => {
  const summary: MenuUnseenSummary = { "blog-posts": global(0), newsletter: global(3), promotions: byProperty("a", "b"), calendar: byProperty("a") };
  it("lists only what the summary allows, in the registry's order, optionally among a parent's children", () => {
    expect(allowedMenus(summary)).toEqual(["promotions", "calendar", "newsletter", "blog-posts"]);
    expect(allowedMenus(summary, ["blog-posts", "website-hero"])).toEqual(["blog-posts"]);
    expect(allowedMenus({})).toEqual([]);
  });
  it("a global menu has no Properties; a Property-scoped one has what byProperty lists", () => {
    expect(allowedProperties(summary, "newsletter")).toEqual([]);
    expect(allowedProperties(summary, "promotions").map((item) => item.propertyId)).toEqual(["a", "b"]);
  });
  it("resolves to the wanted scope when allowed, else to the first allowed one; a global menu never carries a Property", () => {
    const menus = allowedMenus(summary);
    expect(resolveScope(summary, menus, "promotions", "b")).toEqual({ menu: "promotions", propertyId: "b" });
    expect(resolveScope(summary, menus, "promotions", "zzz")).toEqual({ menu: "promotions", propertyId: "a" });
    expect(resolveScope(summary, menus, "newsletter", "a")).toEqual({ menu: "newsletter" });
    expect(resolveScope(summary, menus, "website-hero")).toEqual({ menu: "promotions", propertyId: "a" });
    expect(resolveScope({}, [], "newsletter")).toBeNull();
    expect(resolveScope({ promotions: { count: 0, byProperty: [] } }, ["promotions"], "promotions")).toBeNull();
  });
  it("words for who did it", () => {
    expect(["Staff", "Public", "System", "Other"].map(actorLabel)).toEqual(["Nhân viên", "Khách truy cập", "Hệ thống", "Other"]);
  });
});
