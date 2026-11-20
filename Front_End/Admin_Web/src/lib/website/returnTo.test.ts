/**
 * CUST-WEB-HEADER-001-CP02: the sign-in return target is an exact allowlist — the website pages and /calendar.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_TO, WEBSITE_PAGES, resolveReturnTo, signInUrlFor } from "./returnTo";

describe("resolveReturnTo", () => {
  it.each(["/calendar", "/website/languages", "/website/translations", "/website/currencies", "/website/menus", "/website/hero", "/website/social-media", "/website/newsletter", "/website/newsletter/sender"])("accepts the allowed page %s", (page) => {
    expect(resolveReturnTo(page)).toBe(page);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["empty", ""],
    ["an external URL", "https://evil.example/website/languages"],
    ["a protocol-relative URL", "//evil.example"],
    ["a scheme URL", "javascript:alert(1)"],
    ["another Admin page", "/profile"],
    ["the sign-in page itself", "/signin"],
    ["an allowed path with a query", "/website/languages?x=1"],
    ["an allowed path with a fragment", "/website/languages#top"],
    ["an allowed path with a trailing slash", "/website/languages/"],
    ["a different case", "/Website/Languages"],
    ["a path under an allowed one", "/website/languages/new"],
    ["a dot-dot escape", "/website/../signup"],
    ["an encoded slash", "%2Fwebsite%2Flanguages"],
    ["a double-encoded path", "%252Fwebsite%252Flanguages"],
    ["a backslash variant", "\\website\\languages"],
    ["whitespace around an allowed path", " /website/languages"],
    ["a null byte", "/website/languages\u0000"],
    ["a list value", ["/website/languages", "https://evil.example"]],
  ] as const)("falls back to /calendar for %s", (_label, value) => {
    expect(resolveReturnTo(value as string | string[] | null | undefined)).toBe(DEFAULT_RETURN_TO);
  });

  it("returns to the sender page after a sign-in (BHA-NEWSLETTER-002) but not to its OAuth callback, whose code is single use", () => {
    expect(resolveReturnTo("/website/newsletter/sender")).toBe("/website/newsletter/sender");
    expect(resolveReturnTo("/website/newsletter/sender/callback")).toBe(DEFAULT_RETURN_TO);
    expect(resolveReturnTo("/website/newsletter/sender?code=x")).toBe(DEFAULT_RETURN_TO);
  });

  it("lists exactly the website settings pages", () => {
    expect([...WEBSITE_PAGES]).toEqual(["/website/languages", "/website/translations", "/website/currencies", "/website/menus", "/website/hero", "/website/social-media", "/website/newsletter", "/website/newsletter/sender"]);
  });
});

describe("signInUrlFor", () => {
  it("carries a website page and nothing else", () => {
    expect(signInUrlFor("/website/currencies")).toBe("/signin?returnTo=%2Fwebsite%2Fcurrencies");
    expect(signInUrlFor("/website/newsletter")).toBe("/signin?returnTo=%2Fwebsite%2Fnewsletter");
    expect(signInUrlFor("/calendar")).toBe("/signin");
    expect(signInUrlFor("https://evil.example")).toBe("/signin");
    expect(signInUrlFor("/website/languages?x=1")).toBe("/signin");
  });
});

describe("the Blog pages (BHA-BLOG-001-CP03)", () => {
  it("allows the fixed Blog pages and nothing under them", async () => {
    const { BLOG_PAGES } = await import("./returnTo");
    for (const page of BLOG_PAGES) {
      expect(resolveReturnTo(page)).toBe(page);
      expect(signInUrlFor(page)).toBe(`/signin?returnTo=${encodeURIComponent(page)}`);
    }
    // A post's own page is dynamic: signing in from it goes back to the list, never to an id the allowlist does not know.
    expect(resolveReturnTo("/website/blog/posts/11111111-1111-4111-8111-111111111111")).toBe(DEFAULT_RETURN_TO);
    expect(resolveReturnTo("/website/blog/posts/../../calendar")).toBe(DEFAULT_RETURN_TO);
    expect(resolveReturnTo("/website/blog/posts?x=1")).toBe(DEFAULT_RETURN_TO);
    expect(signInUrlFor("/website/blog/posts/abc")).toBe("/signin");
  });
});

describe("the activity history (BHA-ADMIN-BADGE-001-PR05-C2)", () => {
  it("is a sign-in destination, matched exactly, and the sign-in link carries it", () => {
    expect(resolveReturnTo("/activity")).toBe("/activity");
    expect(signInUrlFor("/activity")).toBe("/signin?returnTo=%2Factivity");
  });
  it("only that exact path: no query, fragment, trailing slash, case, sub-path or encoded variant", () => {
    for (const other of ["/activity/", "/activity?menu=blog-posts", "/activity?menu=promotions&propertyId=p-1", "/activity#top", "/Activity", "/activity/export", "/activity/../signup", "%2Factivity", "%252Factivity", "/activity\u0000", " /activity", "//activity", "https://evil.example/activity", "/activities"]) {
      expect(resolveReturnTo(other)).toBe(DEFAULT_RETURN_TO);
      expect(signInUrlFor(other)).toBe("/signin");
    }
    expect(resolveReturnTo(["/activity", "https://evil.example"])).toBe(DEFAULT_RETURN_TO);
  });
  it("leaves the pages that were already allowed exactly as they were", () => {
    for (const page of ["/calendar", "/products", "/promotions", ...WEBSITE_PAGES]) expect(resolveReturnTo(page)).toBe(page);
    expect(resolveReturnTo("/profile")).toBe(DEFAULT_RETURN_TO);
  });
});

describe("the Newsletter page (BHA-NEWSLETTER-001-C2)", () => {
  it("is a sign-in destination, matched exactly", () => {
    expect(resolveReturnTo("/website/newsletter")).toBe("/website/newsletter");
    for (const other of ["/website/newsletter/", "/website/newsletter?x=1", "/website/newsletter#top", "/Website/Newsletter", "/website/newsletter/export", "/website/news"]) {
      expect(resolveReturnTo(other)).toBe(DEFAULT_RETURN_TO);
      expect(signInUrlFor(other)).toBe("/signin");
    }
  });
});
