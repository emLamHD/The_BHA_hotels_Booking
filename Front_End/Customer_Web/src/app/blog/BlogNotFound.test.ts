import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("../not-found", async () => ({ default: async () => (await import("react")).createElement("div", { id: "site-404" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/blog", useSearchParams: () => new URLSearchParams() }));
import BlogLocaleTargets from "@/components/blog/BlogLocaleTargets";
import { I18nProvider, useI18n, type I18nContextValue } from "@/lib/i18n/I18nProvider";
import { localeTargetFor, setLocaleTargets } from "@/lib/i18n/localeTargets";
import { testSnapshot } from "@/lib/i18n/testkit";

const APP = resolve(__dirname, "..");

/** The `not-found` file Next renders for `notFound()` thrown by the page at `route`: the nearest one walking up from its folder, as Next resolves it. */
function boundaryFor(route: string): string | null {
  for (let dir = join(APP, route); dir.startsWith(APP); dir = dirname(dir)) {
    for (const file of ["not-found.tsx", "not-found.ts", "not-found.jsx", "not-found.js"]) if (existsSync(join(dir, file))) return join(dir, file).slice(APP.length + 1);
  }
  return null;
}

function targetsOf(node: unknown): Record<string, string> | null {
  if (!React.isValidElement(node)) return Array.isArray(node) ? node.map(targetsOf).find((t) => t !== null) ?? null : null;
  const element = node as React.ReactElement<{ targets?: Record<string, string>; children?: unknown }>;
  if (element.type === BlogLocaleTargets) return element.props.targets ?? null;
  return targetsOf(element.props.children);
}

describe("which not-found page a Blog 404 renders", () => {
  it("every Blog page that calls notFound() (index with a bad page or language, category, post) has the Blog boundary; a page outside the Blog keeps the root one", () => {
    for (const route of ["blog", "blog/category/[slug]", "blog/[slug]"]) expect(boundaryFor(route), route).toBe(join("blog", "not-found.tsx"));
    for (const route of ["offers/[slug]", "faq", "riverside"]) expect(boundaryFor(route), route).toBe("not-found.tsx");
  });
});

describe("the Blog 404 can be a stale copy (BHA-BLOG-001-CP04-CP05-C9)", () => {
  // By name, so this file still loads where the component does not exist.
  const contains = (node: unknown, name: string): boolean => {
    if (Array.isArray(node)) return node.some((child) => contains(child, name));
    if (!React.isValidElement(node)) return false;
    const element = node as React.ReactElement<{ children?: unknown }>;
    return (typeof element.type === "function" && element.type.name === name) || contains(element.props.children, name);
  };

  it("the Blog 404 mounts the revalidation (found in the tree the boundary returns), next to the language targets and the site's 404", async () => {
    const { default: BlogNotFound } = await import("./not-found");
    const tree = await BlogNotFound();
    expect(contains(tree, "BlogNotFoundRevalidate")).toBe(true);
    expect(contains(tree, "BlogLocaleTargets")).toBe(true);
    expect(renderToStaticMarkup(tree as React.ReactElement)).toContain('id="site-404"');
  });
});

describe("the Blog 404 and the language switch", () => {
  const INDEXES = { vi: "/blog?locale=vi", en: "/blog?locale=en", fr: "/blog?locale=fr" };
  const cookies: string[] = [];

  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
    cookies.length = 0;
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    vi.stubGlobal("document", { set cookie(value: string) { cookies.push(value); } });
  });
  afterEach(() => {
    setLocaleTargets(null);
    vi.unstubAllGlobals();
  });

  async function boundary() {
    const { default: BlogNotFound } = await import("./not-found");
    return BlogNotFound();
  }
  function mountedSwitch(currency?: string): I18nContextValue {
    let context: I18nContextValue | null = null;
    const Probe = () => { context = useI18n(); return null; };
    renderToStaticMarkup(React.createElement(I18nProvider, { snapshot: testSnapshot("vi", currency) }, React.createElement(Probe)));
    return context!;
  }

  it("shows the site's 404 page and registers every active language's own Blog index — no slug, no guess about a post that is not public", async () => {
    const tree = await boundary();
    expect(renderToStaticMarkup(tree as React.ReactElement)).toContain('id="site-404"');      // the site's own 404 page, unchanged
    expect(targetsOf(tree)).toEqual(INDEXES);
    expect(JSON.stringify(targetsOf(tree))).not.toMatch(/khong-co|bai-viet/);
  });

  it("asks for the recovery step: a target on the pathname the reader is on goes through /blog-recover (Next 13.4.3 clears a 404 only when the pathname changes)", async () => {
    const find = (node: unknown): React.ReactElement<{ recover?: boolean }> | null =>
      Array.isArray(node) ? node.map(find).find((e) => e !== null) ?? null : React.isValidElement(node) ? (node.type === BlogLocaleTargets ? (node as React.ReactElement<{ recover?: boolean }>) : find((node.props as { children?: unknown }).children)) : null;
    expect(find(await boundary())?.props.recover).toBe(true);
  });

  it("is the Blog's alone: the root 404 page registers no language targets, so a 404 elsewhere switches by cookie + refresh as before", () => {
    expect(readFileSync(join(APP, "not-found.tsx"), "utf8")).not.toMatch(/BlogLocaleTargets|localeTargets|blogIndexHref|indexTargets/);
  });

  it("choosing a language on a Blog 404 whose URL names another goes to that language's index and refreshes — even when the currency is the one already chosen", async () => {
    setLocaleTargets(targetsOf(await boundary()));
    mountedSwitch("USD").setLocale("en");
    expect(router.push).toHaveBeenCalledWith("/blog?locale=en");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(cookies.some((c) => c.startsWith("bha_locale=en;"))).toBe(true);
  });

  it("leaves no stale targets behind and does not take over a post's: the boundary replaces them when it is shown and clears them when it goes", async () => {
    const effects: Array<() => void | (() => void)> = [];
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useEffect: (fn: () => void | (() => void)) => { effects.push(fn); } }));
    const { default: Targets } = await import("@/components/blog/BlogLocaleTargets");
    const { setLocaleTargets: set, localeTargetFor: target } = await import("@/lib/i18n/localeTargets");
    const show = (targets: Record<string, string>) => { Targets({ targets }); return effects.pop()!() as () => void; };

    const leavePost = show({ vi: "/blog/bai-mot?locale=vi", en: "/blog/post-one?locale=en" });
    expect(target("en")).toBe("/blog/post-one?locale=en");
    leavePost();                                                    // the post goes ...
    expect(target("en")).toBeNull();
    const leave404 = show(INDEXES);                                 // ... the 404 comes
    expect(target("en")).toBe("/blog?locale=en");
    leave404();
    expect(target("en")).toBeNull();
    set(null);
    vi.doUnmock("react");
  });
});
