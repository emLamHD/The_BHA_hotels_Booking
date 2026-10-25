import { afterEach, describe, expect, it, vi } from "vitest";

const INDEXES = { vi: "/blog?locale=vi", en: "/blog?locale=en", fr: "/blog?locale=fr" };

/** BlogLocaleTargets with React's effect and Next's pathname replaced by a controllable fake; what it registers is read back through the real `localeTargetFor`. */
async function show(pathname: string, props: { targets: Record<string, string>; recover?: boolean }) {
  vi.resetModules();
  vi.doMock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useEffect: (fn: () => void) => { fn(); } }));
  vi.doMock("next/navigation", () => ({ usePathname: () => pathname }));
  const { default: Targets } = await import("./BlogLocaleTargets");
  const { localeTargetFor, setLocaleTargets } = await import("@/lib/i18n/localeTargets");
  setLocaleTargets(null);
  Targets(props);
  return (code: string) => localeTargetFor(code);
}

afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock("next/navigation");
  vi.restoreAllMocks();
});

describe("the language targets of a Blog 404 (recover)", () => {
  it("send a target with the pathname the reader is on through /blog-recover — the only way Next 13.4.3 lets the 404 go", async () => {
    const target = await show("/blog", { targets: INDEXES, recover: true });     // /blog?page=abc and /blog?locale=zz are 404s of the index itself
    expect(target("en")).toBe("/blog-recover?locale=en");
    expect(target("vi")).toBe("/blog-recover?locale=vi");
    expect(target("fr")).toBe("/blog-recover?locale=fr");
  });

  it("leave the targets alone when the 404 is at another pathname (a post, a category): the pathname change already clears it", async () => {
    for (const pathname of ["/blog/khong-co", "/blog/category/khong-co"]) {
      const target = await show(pathname, { targets: INDEXES, recover: true });
      expect(target("en"), pathname).toBe("/blog?locale=en");
    }
  });

  it("are not applied to any other page: without `recover` a page on /blog registers its plain targets", async () => {
    const target = await show("/blog", { targets: INDEXES });
    expect(target("en")).toBe("/blog?locale=en");
  });

  it("never turn a target that is not a Blog index with a language into a recovery step", async () => {
    const target = await show("/blog/bai-mot", { targets: { vi: "/blog/bai-mot?locale=vi", en: "/blog/post-one?locale=en" }, recover: true });
    expect(target("vi")).toBe("/blog/bai-mot?locale=vi");                                          // the same pathname, but a post, and `/blog/bai-mot` is not 404 here
  });
});
