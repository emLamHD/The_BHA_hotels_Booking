/**
 * BHA-ADMIN-BADGE-001-PR04: the red counters of the sidebar, in the expanded, collapsed, hovered and mobile states. The numbers come from the shell's provider (tested there); here they
 * are the API's answer for a Staff member, so each picture is exact: only a menu the API returned with a count above 0 shows a number, a parent shows the REAL sum of its children
 * (formatted after summing), the label keeps the real number, and template entries never carry one.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuUnseenSummary } from "@/lib/api/menuUnseen";

const EXPANDED = { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
const ui = vi.hoisted(() => ({ menus: {} as Record<string, unknown>, pathname: "/", sidebar: {} as Record<string, unknown>, identity: "staff-a" }));
const api = vi.hoisted(() => ({ changes: vi.fn(), seen: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => ui.pathname }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ui.sidebar }));
vi.mock("@/components/website/NewsletterBadgeProvider", () => ({
  useMenuUnseen: () => ui.menus,
  useUnseenScope: () => ({ identity: ui.identity, ready: true, propertyNames: { "p-0": "Riverside" }, reportAuth: () => undefined }),
}));
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()), fetchMenuChanges: api.changes, markNewsletterSeen: api.seen }));
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
const openWebsite_ifDrawn = () => { const site = screen.queryByText("Website"); if (site) fireEvent.click(site.closest("button")!); };

beforeEach(() => {
  ui.menus = {};
  ui.pathname = "/";
  ui.sidebar = { ...EXPANDED };
  ui.identity = "staff-a";
  api.changes.mockReset();
  api.seen.mockReset();
  api.changes.mockReturnValue(new Promise(() => undefined));                                    // the popover's own reads are tested in MenuChangesPopover.test
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

  it("top-level entries are links to their paths; the number is a button BESIDE the link, in the same row, never inside it", () => {
    answer({ catalog: global(2), promotions: perProperty(1), calendar: perProperty(3) });
    renderSidebar();
    for (const [key, name, path] of [["catalog", "Cơ sở & loại phòng", "/products"], ["promotions", "Ưu đãi đặt phòng", "/promotions"], ["calendar", "Calendar", "/calendar"]]) {
      const link = screen.getByText(name).closest("a")!;
      expect(link.getAttribute("href")).toBe(path);
      const badgeNode = within(link.parentElement!).getByTestId(`menu-unseen-badge-${key}`);
      expect(link.contains(badgeNode)).toBe(false);
      expect(badgeNode.tagName).toBe(key === "calendar" ? "SPAN" : "BUTTON");                      // the Calendar's number stays a plain image until its list exists
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
    const badgeOf = (link: HTMLElement) => link.closest("li")!.querySelector('[data-testid^="menu-unseen-badge"]');
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/website/languages", "/website/translations", "/website/currencies", "/website/menus", "/website/hero", "/website/social-media", "/website/newsletter",
      "/website/newsletter/sender", "/website/blog/posts", "/website/blog/categories", "/website/blog/media", "/website/blog/settings",
    ]);
    expect(links.map((link) => badgeOf(link)?.textContent ?? "")).toEqual(["", "", "", "", "1", "", "2", "3", "4", "5", "6", "7"]);
    expect(links.every((link) => badgeOf(link) === null || !link.contains(badgeOf(link)))).toBe(true);
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
    const toggle = screen.getByText("Website").closest("button")!;
    expect(toggle.contains(parent)).toBe(false);                                                       // beside the toggle, never inside the button
    expect(toggle.parentElement!.contains(parent)).toBe(true);
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
    expect(badge("catalog")!.getAttribute("data-placement")).toBe("corner");                           // pinned to the icon
  });

  it("hovering a collapsed sidebar draws it like the expanded one: inline numbers, and the parent shows its sum while closed", () => {
    menus();
    ui.sidebar = { ...collapsed, isHovered: true };
    renderSidebar();
    expect(badge("catalog")!.getAttribute("data-placement")).toBe("inline");
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

// ================================================================================================ BHA-ADMIN-BADGE-001-PR05: the badge opens the unseen list

const changes = (menu: string, unseenEvents: number, extra: Record<string, unknown> = {}) => ({
  kind: "ok",
  data: { menu, propertyId: null, unseenEvents, hasMore: false, lastSeenWatermark: "0", snapshotWatermark: String(unseenEvents), groups: [], ...extra },
});
const popover = () => screen.queryByTestId("unseen-popover");

describe("the badge opens the unseen list", () => {
  beforeEach(() => {
    api.changes.mockImplementation(async (menu: string) => changes(menu, 3));
  });

  it("a click opens the list and does not navigate or toggle: the entry's link is untouched, the Website submenu stays closed (its parent number is still the closed-state sum), and nothing is acknowledged", async () => {
    answer({ catalog: global(2), newsletter: global(4) });
    renderSidebar();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    expect(popover()).toBeTruthy();
    expect(screen.getByTestId("menu-unseen-badge-catalog").getAttribute("aria-expanded")).toBe("true");
    expect(ui.pathname).toBe("/");
    await userEvent.click(screen.getByTestId("menu-unseen-badge-parent"));                             // the Website parent's number, beside its toggle
    expect(screen.getByTestId("menu-unseen-badge-parent")).toBeTruthy();                               // the submenu did not open (an open one hides the parent's number)
    expect(api.seen).not.toHaveBeenCalled();
  });

  it("no control sits inside a link or inside a button, in any sidebar state", () => {
    answer({ catalog: global(2), promotions: perProperty(1), calendar: perProperty(3), newsletter: global(4), "blog-posts": global(150) });
    for (const sidebar of [{ ...EXPANDED }, { ...EXPANDED, isExpanded: false }, { ...EXPANDED, isExpanded: false, isMobileOpen: true }]) {
      ui.sidebar = sidebar;
      const view = renderSidebar();
      openWebsite_ifDrawn();
      expect(document.querySelectorAll("a button, button button, a [role='button'], button a").length).toBe(0);
      view.unmount();
    }
  });

  it("with the keyboard: Enter on the badge opens it, focus goes into it, Escape closes it and focus is back on the badge", async () => {
    answer({ catalog: global(2) });
    renderSidebar();
    const trigger = screen.getByTestId("menu-unseen-badge-catalog");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(popover()).toBeTruthy();
    expect(popover()!.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard(" ");                                                                      // Space opens it too
    expect(popover()).toBeTruthy();
  });

  it("a click outside closes it without taking focus back; clicking the same badge again closes it", async () => {
    answer({ catalog: global(2) });
    renderSidebar();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    await userEvent.click(document.body);
    expect(popover()).toBeNull();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    expect(popover()).toBeTruthy();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    expect(popover()).toBeNull();
  });

  it("works on a collapsed sidebar (the number on the icon) and in the mobile drawer", async () => {
    answer({ catalog: global(2) });
    ui.sidebar = { ...EXPANDED, isExpanded: false };
    renderSidebar();
    expect(screen.getByTestId("menu-unseen-badge-catalog").getAttribute("data-placement")).toBe("corner");
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    expect(popover()).toBeTruthy();
    cleanup();
    ui.sidebar = { ...EXPANDED, isExpanded: false, isMobileOpen: true };
    renderSidebar();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    expect(popover()).toBeTruthy();
  });

  it("the Website parent's number opens ONE list for its permitted children and loads only the chosen one (the first with something unseen), never all, never merged", async () => {
    answer({ "blog-posts": global(0), newsletter: global(4), "website-hero": global(1) });
    renderSidebar();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-parent"));
    await waitFor(() => expect(api.changes).toHaveBeenCalledTimes(1));
    expect(api.changes.mock.calls[0][0]).toBe("website-hero");                                         // first in the sidebar's order that has a number
    expect(api.changes.mock.calls[0][1]).toBeUndefined();                                              // a global menu sends no Property
    const options = within(screen.getByTestId("unseen-popover-menu")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Banner trang chủ (1)", "Đăng ký nhận tin (4)", "Blog: Bài viết (0)"]);   // only menus the summary allows, with the API's own numbers
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-menu"), "newsletter");
    await waitFor(() => expect(api.changes).toHaveBeenCalledTimes(2));
    expect(api.changes.mock.calls[1][0]).toBe("newsletter");
  });

  it("a child's own number opens the list on that child; Promotions loads exactly one Property, picked from its byProperty", async () => {
    answer({ newsletter: global(4), "website-hero": global(1), promotions: perProperty(2, 3) });
    renderSidebar();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-promotions"));
    await waitFor(() => expect(api.changes).toHaveBeenCalledTimes(1));
    expect(api.changes.mock.calls[0].slice(0, 2)).toEqual(["promotions", "p-0"]);
    expect(within(screen.getByTestId("unseen-popover-property")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Riverside (2)", "Cơ sở p-1 (3)"]);
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-property"), "p-1");
    await waitFor(() => expect(api.changes).toHaveBeenCalledTimes(2));
    expect(api.changes.mock.calls[1].slice(0, 2)).toEqual(["promotions", "p-1"]);
    cleanup();
    api.changes.mockClear();
    renderSidebar();
    openWebsite();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-newsletter"));
    await waitFor(() => expect(api.changes).toHaveBeenCalledTimes(1));
    expect(api.changes.mock.calls[0][0]).toBe("newsletter");
  });

  it("closes in the same render when the Staff identity changes or the page changes, and is never shown to another identity", async () => {
    answer({ catalog: global(2) });
    const view = renderSidebar();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    expect(popover()).toBeTruthy();
    ui.identity = "staff-b";
    view.rerender(<AppSidebar />);
    expect(popover()).toBeNull();
    ui.identity = "staff-a";                                                                            // and A coming back does not bring it back
    view.rerender(<AppSidebar />);
    expect(popover()).toBeNull();
    await userEvent.click(screen.getByTestId("menu-unseen-badge-catalog"));
    expect(popover()).toBeTruthy();
    ui.pathname = "/products";
    view.rerender(<AppSidebar />);
    expect(popover()).toBeNull();
  });

  it("the Calendar keeps its plain number: no button, no list", async () => {
    answer({ calendar: perProperty(3) });
    renderSidebar();
    expect(screen.getByTestId("menu-unseen-badge-calendar").tagName).toBe("SPAN");
    await userEvent.click(screen.getByTestId("menu-unseen-badge-calendar"));
    expect(popover()).toBeNull();
    expect(api.changes).not.toHaveBeenCalled();
  });
});

describe("the history entrance", () => {
  it("'Lịch sử hoạt động' is a link to /activity whether or not anything is unseen (count 0, no menu allowed)", () => {
    renderSidebar();
    expect(screen.getByText("Lịch sử hoạt động").closest("a")!.getAttribute("href")).toBe("/activity");
  });

  it("LocalGate has no entrance", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    try {
      renderSidebar();
      expect(screen.queryByText("Lịch sử hoạt động")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
