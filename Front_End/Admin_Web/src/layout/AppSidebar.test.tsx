/**
 * BHA-ADMIN-BADGE-001-PR04: the red counters of the sidebar, in the expanded, collapsed, hovered and mobile states. The numbers come from the shell's provider (tested there); here they
 * are the API's answer for a Staff member, so each picture is exact: only a menu the API returned with a count above 0 shows a number, a parent shows the REAL sum of its children
 * (formatted after summing), the label keeps the real number, and template entries never carry one.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuUnseenSummary } from "@/lib/api/menuUnseen";

const EXPANDED = { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
const ui = vi.hoisted(() => ({ menus: {} as Record<string, unknown>, pathname: "/", sidebar: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({ usePathname: () => ui.pathname }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ui.sidebar }));
vi.mock("@/components/website/NewsletterBadgeProvider", () => ({ useMenuUnseen: () => ui.menus }));
vi.mock("./SidebarWidget", () => ({ default: () => null }));

import AppSidebar from "./AppSidebar";

const global = (count: number) => ({ count, lastSeenWatermark: "0", currentWatermark: String(count) });
const perProperty = (...counts: number[]) => ({
  count: counts.reduce((sum, count) => sum + count, 0),
  byProperty: counts.map((count, index) => ({ propertyId: `p-${index}`, count, lastSeenWatermark: "0", currentWatermark: String(count) })),
});
const answer = (menus: MenuUnseenSummary) => { ui.menus = menus; };

const renderSidebar = () => render(<AppSidebar />);
const badge = (key: string) => screen.queryByTestId(`menu-unseen-badge-${key}`);
const text = (key: string) => badge(key)?.textContent;
const openWebsite = () => fireEvent.click(screen.getByText("Website").closest("button")!);

beforeEach(() => {
  ui.menus = {};
  ui.pathname = "/";
  ui.sidebar = { ...EXPANDED };
});
afterEach(cleanup);

describe("what shows a number", () => {
  it("with no provider (LocalGate) or an empty answer nothing shows anywhere: no entry, no parent", () => {
    renderSidebar();
    expect(document.querySelector('[data-testid^="menu-unseen-badge"]')).toBeNull();
    openWebsite();
    expect(document.querySelector('[data-testid^="menu-unseen-badge"]')).toBeNull();
  });

  it("a menu at 0 shows nothing; 1 to 99 show the number and 99+ above, and the label keeps the real number", () => {
    answer({ catalog: global(0), promotions: perProperty(5), calendar: perProperty(60, 90) });
    renderSidebar();
    expect(badge("catalog")).toBeNull();
    expect(text("promotions")).toBe("5");
    expect(text("calendar")).toBe("99+");                                                              // the API's total over both Properties
    expect(badge("calendar")!.getAttribute("aria-label")).toBe("150 thay đổi chưa xem ở Calendar");
    expect(badge("promotions")!.getAttribute("aria-label")).toBe("5 thay đổi chưa xem ở Ưu đãi đặt phòng");
  });

  it("top-level entries are links to their paths, with the number inside the link", () => {
    answer({ catalog: global(2), promotions: perProperty(1), calendar: perProperty(3) });
    renderSidebar();
    for (const [key, name, path] of [["catalog", "Cơ sở & loại phòng", "/products"], ["promotions", "Ưu đãi đặt phòng", "/promotions"], ["calendar", "Calendar", "/calendar"]]) {
      const link = screen.getByText(name).closest("a")!;
      expect(link.getAttribute("href")).toBe(path);
      expect(within(link).getByTestId(`menu-unseen-badge-${key}`)).toBeTruthy();
    }
  });

  it("a menu the API left out (not permitted) has no number, while its link is still there (a link is not authorization)", () => {
    answer({ newsletter: global(4) });                                                                 // no Blog, no Catalog, no Calendar for this Staff
    renderSidebar();
    expect(badge("catalog")).toBeNull();
    expect(badge("calendar")).toBeNull();
    expect(screen.getByText("Calendar").closest("a")).toBeTruthy();
    openWebsite();
    expect(text("newsletter")).toBe("4");
    expect(badge("blog-posts")).toBeNull();
    expect(screen.getByText("Blog: Bài viết").closest("a")).toBeTruthy();
  });

  it("each Website entry carries its own number, only that entry, in the order the sidebar always had", () => {
    answer({ "website-hero": global(1), newsletter: global(2), "newsletter-sender": global(3), "blog-posts": global(4), "blog-categories": global(5), "blog-media": global(6), "blog-settings": global(7) });
    renderSidebar();
    openWebsite();
    const entries = ["Ngôn ngữ & bản dịch", "Bản dịch", "Tiền tệ & tỷ giá", "Menu", "Banner trang chủ", "Social media", "Đăng ký nhận tin", "Cấu hình email gửi", "Blog: Bài viết", "Blog: Chuyên mục", "Blog: Thư viện ảnh", "Blog: Cấu hình"];
    const links = within(screen.getByText("Website").closest("li")!).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/website/languages", "/website/translations", "/website/currencies", "/website/menus", "/website/hero", "/website/social-media", "/website/newsletter",
      "/website/newsletter/sender", "/website/blog/posts", "/website/blog/categories", "/website/blog/media", "/website/blog/settings",
    ]);
    expect(links.map((link) => link.querySelector('[role="img"]')?.textContent ?? "")).toEqual(["", "", "", "", "1", "", "2", "3", "4", "5", "6", "7"]);
    expect(entries).toHaveLength(links.length);
  });

  it("template entries never carry a number or a template `new`/`pro` label", () => {
    answer({ catalog: global(9), newsletter: global(9), calendar: perProperty(9) });
    renderSidebar();
    for (const name of ["Dashboard", "User Profile", "Forms", "Tables", "Pages", "Charts", "UI Elements", "Authentication"]) {
      const entry = screen.getByText(name).closest("li")!;
      expect(entry.querySelector('[data-testid^="menu-unseen-badge"]')).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(/\b(new|pro)\b/);
  });
});

describe("the Website parent", () => {
  const many = () => answer({ "blog-posts": global(150), newsletter: global(2), "website-hero": global(1), catalog: global(7) });

  it("shows the REAL sum of its children (150 + 2 + 1 = 153, never 99 + 2 + 1), formatted after summing, with the real number in its label; Catalog is not a child", () => {
    many();
    renderSidebar();
    const parent = badge("parent")!;
    expect(parent.textContent).toBe("99+");
    expect(parent.getAttribute("aria-label")).toBe("153 thay đổi chưa xem ở Website");
    expect(screen.getByText("Website").closest("button")!.contains(parent)).toBe(true);
  });

  it("a sum below 100 is shown as it is", () => {
    answer({ newsletter: global(40), "blog-posts": global(30) });
    renderSidebar();
    expect(text("parent")).toBe("70");
  });

  it("opening the submenu hands the numbers to the entries (150 → 99+ on the Blog entry, its label still 150); closing brings the parent's sum back; nothing is acknowledged", () => {
    many();
    renderSidebar();
    openWebsite();
    expect(badge("parent")).toBeNull();
    expect(text("blog-posts")).toBe("99+");
    expect(badge("blog-posts")!.getAttribute("aria-label")).toBe("150 thay đổi chưa xem ở Blog: Bài viết");
    expect(text("newsletter")).toBe("2");
    openWebsite();
    expect(text("parent")).toBe("99+");
  });

  it("being on a Website page opens the submenu by itself, which is not 'seen' (the entry keeps its number)", () => {
    answer({ newsletter: global(3) });
    ui.pathname = "/website/newsletter";
    renderSidebar();
    expect(badge("parent")).toBeNull();
    expect(text("newsletter")).toBe("3");
  });

  it("a parent with children but no number shows nothing", () => {
    answer({ catalog: global(5) });
    renderSidebar();
    expect(badge("parent")).toBeNull();
  });
});

describe("collapsed, hovered and mobile", () => {
  const collapsed = { isExpanded: false, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
  const menus = () => answer({ catalog: global(3), calendar: perProperty(120), newsletter: global(2), "blog-posts": global(1) });

  it("a collapsed sidebar shows the numbers on the icons: top-level entries and the Website parent's sum (no entry is drawn); the label stays on each", () => {
    menus();
    ui.sidebar = collapsed;
    renderSidebar();
    expect(text("catalog")).toBe("3");
    expect(text("calendar")).toBe("99+");
    expect(badge("calendar")!.getAttribute("aria-label")).toBe("120 thay đổi chưa xem ở Calendar");
    expect(text("parent")).toBe("3");
    expect(badge("newsletter")).toBeNull();                                                            // the submenu is not drawn while collapsed
    expect(screen.queryByText("Website")).toBeNull();
    expect(badge("catalog")!.className).toContain("absolute");                                         // pinned to the icon
  });

  it("hovering a collapsed sidebar draws it like the expanded one: inline numbers, and the parent shows its sum while closed", () => {
    menus();
    ui.sidebar = { ...collapsed, isHovered: true };
    renderSidebar();
    expect(badge("catalog")!.className).not.toContain("absolute");
    expect(text("catalog")).toBe("3");
    expect(text("parent")).toBe("3");
    openWebsite();
    expect(badge("parent")).toBeNull();
    expect(text("newsletter")).toBe("2");
  });

  it("the mobile drawer shows the same numbers; a drawer that is shut while the submenu is open shows the parent's sum on the icon", () => {
    menus();
    ui.sidebar = { ...collapsed, isMobileOpen: true };
    renderSidebar();
    expect(text("parent")).toBe("3");
    openWebsite();
    expect(badge("parent")).toBeNull();
    expect(text("newsletter")).toBe("2");
    ui.sidebar = { ...collapsed };                                                                     // the drawer closes (the submenu stays open, but is not drawn)
    cleanup();
    ui.pathname = "/website/newsletter";
    renderSidebar();
    expect(text("parent")).toBe("3");
    expect(badge("newsletter")).toBeNull();
  });
});
