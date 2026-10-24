import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ replace: () => undefined, push: () => undefined }) }));
import BlogRecoverPage, { metadata } from "./page";
import BlogRecover from "@/components/blog/BlogRecover";

describe("/blog-recover: only a language, and always that language's Blog index", () => {
  it.each([
    ["en", "/blog?locale=en"],
    ["vi", "/blog?locale=vi"],
    ["EN-us", "/blog?locale=en-us"],
    ["zh-Hant", "/blog?locale=zh-hant"],
  ])("?locale=%s -> %s", (locale, to) => {
    const element = BlogRecoverPage({ searchParams: { locale } }) as React.ReactElement<{ to: string }>;
    expect(element.type).toBe(BlogRecover);
    expect(element.props.to).toBe(to);
  });

  it.each([
    ["no language", undefined],
    ["an empty one", ""],
    ["not a language tag", "zz!"],
    ["a path", "/offers"],
    ["an absolute URL", "https://evil.test/blog?locale=vi"],
    ["a protocol-relative one", "//evil.test"],
    ["a backslash", "/\\evil.test"],
    ["a Blog address", "/blog/bai-mot?locale=vi"],
    ["a repeated language", ["en", "vi"]],
  ])("%s is a 404 — the address to go to is never taken from the URL", (_name, locale) => {
    expect(() => BlogRecoverPage({ searchParams: { locale: locale as string | string[] | undefined } })).toThrow("NEXT_NOT_FOUND");
  });

  it("is never indexed and carries no canonical or alternates", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });
});

describe("BlogRecover", () => {
  afterEach(() => {
    vi.doUnmock("react");
    vi.doUnmock("next/navigation");
    vi.restoreAllMocks();
  });

  async function mount(to: string) {
    const replace = vi.fn(), push = vi.fn();
    let previous: unknown[] | undefined;
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useEffect: (fn: () => void, deps: unknown[]) => { if (!previous || deps.some((d, i) => !Object.is(d, previous![i]))) fn(); previous = deps; } }));
    const router = { replace, push };
    vi.doMock("next/navigation", () => ({ useRouter: () => router }));
    const { default: Component } = await import("@/components/blog/BlogRecover");
    return { replace, push, render: () => Component({ to }) };
  }

  it("REPLACES the entry with the chosen index (Back never lands on this step), once, and never pushes", async () => {
    const { replace, push, render } = await mount("/blog?locale=en");
    for (let i = 0; i < 5; i += 1) render();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/blog?locale=en");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows nothing but a no-script link to the same index", () => {
    const html = renderToStaticMarkup(React.createElement(BlogRecover, { to: "/blog?locale=en" }));
    expect(html.replace(/<noscript>.*<\/noscript>/, "")).toBe("");
    expect(html).toContain('href="/blog?locale=en"');
  });
});
