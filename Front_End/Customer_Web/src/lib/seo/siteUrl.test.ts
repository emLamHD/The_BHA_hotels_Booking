import { afterEach, describe, expect, it, vi } from "vitest";
import { absoluteUrl, getSiteOrigin } from "./siteUrl";

describe("the public origin of the site", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a bare https origin (a trailing slash is fine), or a loopback http one for development", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(getSiteOrigin({ SITE_URL: "https://www.thebha.vn" })).toBe("https://www.thebha.vn");
    expect(getSiteOrigin({ SITE_URL: " https://www.thebha.vn/ " })).toBe("https://www.thebha.vn");
    expect(getSiteOrigin({ SITE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("is null — never a guess — when absent or anything other than a bare origin, and the value is not quoted back", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const bad of [undefined, "", "   ", "www.thebha.vn", "http://www.thebha.vn", "https://www.thebha.vn/blog", "https://www.thebha.vn?x=1", "https://u:p@www.thebha.vn", "https://a b", "javascript:alert(1)"]) {
      expect(getSiteOrigin({ SITE_URL: bad })).toBeNull();
    }
    expect(error.mock.calls.flat().join(" ")).not.toContain("u:p");
  });

  it("joins an in-site path to the origin, and has no address without one", () => {
    expect(absoluteUrl("https://x.test", "/blog?locale=vi")).toBe("https://x.test/blog?locale=vi");
    expect(absoluteUrl(null, "/blog")).toBeNull();
  });
});
