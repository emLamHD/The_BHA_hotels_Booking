import { describe, expect, it } from "vitest";
import { isExternalHref, isSafeMenuHref, parseMenu, shouldAcceptMenu, type MenuSnapshot } from "./menu";

const snapshot = (over: Partial<MenuSnapshot> = {}): MenuSnapshot => ({ revision: "r", locale: "vi", generatedAt: 1000, primary: [], secondary: [], ...over });

describe("isSafeMenuHref: what a stored link may be before it is rendered into the page", () => {
  it.each(["/", "/riverside", "/blog?category=a#x", "#", "#faq", "https://example.com", "https://example.com/p?q=1#z", "HTTPS://Example.com", "/%E1%BB%A9ng"])("accepts %s", (href) => {
    expect(isSafeMenuHref(href)).toBe(true);
  });

  it.each([
    "", " ", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "mailto:a@b.c", "http://example.com", "//evil.example", "/\\evil.example",
    "/%2F%2Fevil.example", "/%252F%252Fevil.example", "/%5Cevil.example", "/ok%0Aevil", "/a b", "/a\tb", "/a\u0000", " /x", "x/y", "https://", "https://u:p@example.com", "#a#b", "/%E0%A4%A",
  ])("refuses %j", (href) => {
    expect(isSafeMenuHref(href)).toBe(false);
  });

  it("refuses anything that is not a string, and an absurdly long link", () => {
    for (const bad of [null, undefined, 5, {}, []]) expect(isSafeMenuHref(bad)).toBe(false);
    expect(isSafeMenuHref("/" + "a".repeat(2048))).toBe(false);
  });

  it("tells an external link from an internal one", () => {
    expect(isExternalHref("https://example.com")).toBe(true);
    expect(isExternalHref("/riverside")).toBe(false);
    expect(isExternalHref("#faq")).toBe(false);
  });
});

describe("parseMenu: the API's answer as a snapshot", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    revision: "abc",
    locale: "en",
    generatedAtUtc: "2026-10-16T01:00:00.000Z",
    primary: [{ id: "1", label: "Offers", href: "/offers", newTab: false, children: [{ id: "2", label: "Deals", href: "https://example.com", newTab: true, children: [] }] }],
    secondary: [],
    ...over,
  });

  it("keeps the tree, the flags and orders answers by the API's own clock", () => {
    const menu = parseMenu(body())!;
    expect(menu.locale).toBe("en");
    expect(menu.generatedAt).toBe(Date.parse("2026-10-16T01:00:00.000Z"));
    expect(menu.primary[0].children[0]).toMatchObject({ label: "Deals", newTab: true, href: "https://example.com" });
  });

  it("an empty menu is a real answer, not a failure", () => {
    expect(parseMenu(body({ primary: [], secondary: [] }))).toMatchObject({ primary: [], secondary: [] });
  });

  it("an entry with an unsafe link is dropped with its branch; its siblings stay", () => {
    const menu = parseMenu(
      body({
        primary: [
          { id: "1", label: "Bad", href: "javascript:alert(1)", newTab: false, children: [{ id: "2", label: "Child", href: "/ok", newTab: false, children: [] }] },
          { id: "3", label: "Good", href: "/good", newTab: false, children: [] },
        ],
      })
    )!;
    expect(menu.primary.map((item) => item.label)).toEqual(["Good"]);
  });

  it("a body that is not a menu is null, so the caller keeps what it has", () => {
    for (const bad of [null, "x", 5, {}, body({ revision: 5 }), body({ generatedAtUtc: "not a date" }), body({ primary: "x" }), body({ secondary: undefined })]) {
      expect(parseMenu(bad)).toBeNull();
    }
  });
});

describe("shouldAcceptMenu: an answer replaces the menu on screen only when it should", () => {
  it("accepts the first answer, and a newer answer of the same language", () => {
    expect(shouldAcceptMenu(null, snapshot(), "vi")).toBe(true);
    expect(shouldAcceptMenu(snapshot({ generatedAt: 1000 }), snapshot({ generatedAt: 2000 }), "vi")).toBe(true);
  });

  it("refuses an older or equal answer (answers can arrive out of order)", () => {
    expect(shouldAcceptMenu(snapshot({ generatedAt: 2000 }), snapshot({ generatedAt: 1000 }), "vi")).toBe(false);
    expect(shouldAcceptMenu(snapshot({ generatedAt: 2000 }), snapshot({ generatedAt: 2000 }), "vi")).toBe(false);
  });

  it("refuses an answer for another language than the one on screen — a slow answer after a switch", () => {
    expect(shouldAcceptMenu(snapshot({ locale: "en" }), snapshot({ locale: "vi", generatedAt: 9999 }), "en")).toBe(false);
  });

  it("accepts the new language's first answer even though it is not newer", () => {
    expect(shouldAcceptMenu(snapshot({ locale: "vi", generatedAt: 5000 }), snapshot({ locale: "en", generatedAt: 1000 }), "en")).toBe(true);
  });
});
