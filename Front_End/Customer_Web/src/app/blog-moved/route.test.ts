import { describe, expect, it } from "vitest";
import { GET } from "./route";

const call = (to?: string) => GET(new Request(`https://site.test/blog-moved${to === undefined ? "" : `?to=${encodeURIComponent(to)}`}`));

describe("the permanent redirect for an old Blog address", () => {
  it("answers 301 with a RELATIVE Location for a Blog post, category (with page) and a regional language", () => {
    for (const to of ["/blog/bai-moi?locale=vi", "/blog/category/diem-den?locale=en-us&page=2", "/blog/post-1?locale=zh-hant", "/blog/a?locale=fr"]) {
      const response = call(to);
      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(to);
    }
  });

  it("is never an open redirect: only the exact shape of a Blog address of this site is accepted", () => {
    for (const to of [undefined, "", "https://evil.test/blog/a?locale=vi", "//evil.test", "/\\evil.test", "/offers", "/blog/../account?locale=vi", "/blog/a/b?locale=vi", "/blog/a", "/blog/a?locale=vi&x=1", "/blog/a?locale=vi#h", "/blog/A?locale=vi", "javascript:alert(1)", "/blog/a?locale=vi\r\nSet-Cookie: x=1"]) {
      const response = call(to);
      expect(response.status, String(to)).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
  });
});
