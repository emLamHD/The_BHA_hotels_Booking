/**
 * CUST-WEB-HEADER-001-CP02: the sign-in return target is an exact allowlist — the website pages and /calendar.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_TO, WEBSITE_PAGES, resolveReturnTo, signInUrlFor } from "./returnTo";

describe("resolveReturnTo", () => {
  it.each(["/calendar", "/website/languages", "/website/translations", "/website/currencies", "/website/menus", "/website/hero"])("accepts the allowed page %s", (page) => {
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

  it("lists exactly the four website pages", () => {
    expect([...WEBSITE_PAGES]).toEqual(["/website/languages", "/website/translations", "/website/currencies", "/website/menus", "/website/hero"]);
  });
});

describe("signInUrlFor", () => {
  it("carries a website page and nothing else", () => {
    expect(signInUrlFor("/website/currencies")).toBe("/signin?returnTo=%2Fwebsite%2Fcurrencies");
    expect(signInUrlFor("/calendar")).toBe("/signin");
    expect(signInUrlFor("https://evil.example")).toBe("/signin");
    expect(signInUrlFor("/website/languages?x=1")).toBe("/signin");
  });
});
