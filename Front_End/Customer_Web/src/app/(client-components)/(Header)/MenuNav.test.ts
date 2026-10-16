import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/testkit";
import { MenuContext } from "@/lib/menus/MenuProvider";
import type { MenuNode, MenuSnapshot } from "@/lib/menus/menu";
import NavMobile from "@/shared/Navigation/NavMobile";
import { PrimaryNav, SecondaryNav, fitCount, isCurrentPage } from "./MenuNav";

// The logo is a statically imported picture, which this node-only test setup cannot resolve; nothing here is about it.
vi.mock("@/shared/Logo", () => ({ default: () => null }));

const node = (id: string, label: string, href: string, children: MenuNode[] = [], newTab = false): MenuNode => ({ id, label, href, newTab, children });
const menu = (primary: MenuNode[], secondary: MenuNode[] = []): MenuSnapshot => ({ revision: "r", locale: "vi", generatedAt: 1, primary, secondary });
const withMenu = (value: MenuSnapshot | null, element: React.ReactElement) =>
  React.createElement(MenuContext.Provider, { value: { menu: value, stale: false } }, element);
const render = (value: MenuSnapshot | null, element: React.ReactElement, locale = "vi") => renderWithI18n(withMenu(value, element), locale);

describe("the desktop header navigation is drawn from the tree it is given, and nothing else", () => {
  it("renders no menu — not even an empty landmark — when there is none (first load failed, or the Admin emptied it)", () => {
    expect(render(null, React.createElement(PrimaryNav))).toBe("");
    expect(render(menu([]), React.createElement(PrimaryNav))).toBe("");
    expect(render(menu([]), React.createElement(SecondaryNav))).toBe("");
  });

  it("a leaf is a link; the entry the Admin renamed shows its new label and link, not a built-in one", () => {
    const html = render(menu([node("1", "Khuyến mãi hè", "/offers?ref=menu")]), React.createElement(PrimaryNav));
    expect(html).toContain('href="/offers?ref=menu"');
    expect(html).toContain("Khuyến mãi hè");
    expect(html).not.toContain("Ưu đãi");
    expect(html).not.toContain("Riverside");
  });

  it("an entry with children is a link plus an expander named after it, in the visitor's language", () => {
    const tree = menu([node("1", "Blog", "/blog", [node("2", "Tin", "/blog?c=1")])]);
    expect(render(tree, React.createElement(PrimaryNav), "en")).toContain('aria-label="Expand Blog"');
    expect(render(tree, React.createElement(PrimaryNav), "fr")).toContain('aria-label="Développer Blog"');
    expect(render(tree, React.createElement(PrimaryNav), "vi")).toContain('aria-label="Mở rộng Blog"');
  });

  it("an entry whose link is only # is a button, not a dead link", () => {
    const html = render(menu([node("1", "Dịch vụ", "#", [node("2", "Lưu trú", "/listing-stay")])]), React.createElement(PrimaryNav));
    expect(html).not.toContain('href="#"');
    expect(html).toContain("<button");
    expect(html).toContain("Dịch vụ");
  });

  it("opens in a new tab only when asked, and every new tab or external address carries rel noopener noreferrer", () => {
    const html = render(
      menu([
        node("1", "Internal", "/a"),
        node("2", "InternalTab", "/b", [], true),
        node("3", "External", "https://example.com/x"),
        node("4", "ExternalTab", "https://example.com/y", [], true),
      ]),
      React.createElement(PrimaryNav)
    );
    const tag = (label: string) => html.slice(html.lastIndexOf("<a", html.indexOf(`>${label}<`)), html.indexOf(`>${label}<`));
    expect(tag("Internal")).not.toContain("target=");
    expect(tag("Internal")).not.toContain("rel=");
    expect(tag("InternalTab")).toContain('target="_blank"');
    expect(tag("InternalTab")).toContain('rel="noopener noreferrer"');
    expect(tag("External")).not.toContain("target=");
    expect(tag("External")).toContain('rel="noopener noreferrer"');
    expect(tag("ExternalTab")).toContain('target="_blank"');
  });

  it("a label is plain text: markup in it is escaped, never interpreted", () => {
    const html = render(menu([node("1", '<img src=x onerror="alert(1)">', "/a")]), React.createElement(PrimaryNav));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("the secondary group is its own set of entries beside the controls", () => {
    const html = render(menu([node("1", "Primary one", "/a")], [node("2", "Secondary one", "/b")]), React.createElement(SecondaryNav));
    expect(html).toContain("Secondary one");
    expect(html).not.toContain("Primary one");
  });
});

describe("the mobile drawer shows the same tree: the main row, then the secondary group", () => {
  it("lists every root in order with an expander per entry that has children", () => {
    const html = render(
      menu([node("1", "Một", "/1", [node("3", "Con", "/3")]), node("2", "Hai", "/2")], [node("4", "Phụ", "/4")]),
      React.createElement(NavMobile, {})
    );
    expect(html.indexOf("Một")).toBeGreaterThan(-1);
    expect(html.indexOf("Một")).toBeLessThan(html.indexOf("Hai"));
    expect(html.indexOf("Hai")).toBeLessThan(html.indexOf("Phụ"));
    expect(html).toContain('aria-label="Mở rộng Một"');
    expect(html).not.toContain('aria-label="Mở rộng Hai"');
  });

  it("an entry whose link is only # is one expander row, not a dead link", () => {
    const html = render(menu([node("1", "Dịch vụ", "#", [node("2", "Lưu trú", "/listing-stay")])]), React.createElement(NavMobile, {}));
    expect(html).not.toContain('href="#"');
    expect(html).toContain('aria-label="Mở rộng Dịch vụ"');
  });

  it("an emptied or missing menu leaves the drawer with its controls only", () => {
    for (const value of [null, menu([])]) {
      const html = render(value, React.createElement(NavMobile, {}));
      expect(html).not.toContain("<nav");
      expect(html).toContain("<button"); // the close button and the language/currency entry are still there
    }
  });

  it("follows the Admin: a label removed from the tree is gone from the drawer (no built-in group survives)", () => {
    const html = render(menu([node("1", "Chỉ một", "/1")]), React.createElement(NavMobile, {}));
    for (const gone of ["Giao diện mẫu", "Dịch vụ", "Blog", "Ưu đãi"]) expect(html).not.toContain(gone);
  });
});

describe("the main row fits itself to the room it has", () => {
  it("shows every entry when they all fit, and otherwise as many as fit beside the 'more' button (never fewer than one)", () => {
    expect(fitCount([100, 100, 100], 400)).toBe(3);
    expect(fitCount([100, 100, 100, 100], 300)).toBe(2);       // 84 (more) + 2 × 104 = 292 ≤ 300
    expect(fitCount([300, 300], 100)).toBe(1);
    expect(fitCount([], 100)).toBe(0);
  });

  it("before it has been measured every entry is rendered (so there is something to measure) and no 'more' button exists", () => {
    const html = render(menu([node("1", "Một", "/1"), node("2", "Hai", "/2"), node("3", "Ba", "/3")]), React.createElement(PrimaryNav));
    for (const label of ["Một", "Hai", "Ba"]) expect(html).toContain(label);
    expect(html).not.toContain("···");
  });
});

describe("the page being shown is marked in a dropdown", () => {
  it("an internal link is current when its path is the page's; a query-filtered or external link never is", () => {
    expect(isCurrentPage("/blog", "/blog")).toBe(true);
    expect(isCurrentPage("/blog#top", "/blog")).toBe(true);
    expect(isCurrentPage("/blog?category=tin-du-lich", "/blog")).toBe(false);   // a filtered view is not "the blog"
    expect(isCurrentPage("/faq", "/blog")).toBe(false);
    expect(isCurrentPage("https://example.com/blog", "/blog")).toBe(false);
    expect(isCurrentPage("#faq", "/blog")).toBe(false);
    expect(isCurrentPage("/blog", null)).toBe(false);
  });
});
