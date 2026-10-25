import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BHA-BLOG-001-CP04-CP05-C9: the client half of the Blog 404 revalidation, with the hooks replaced by fakes (an effect runs when its dependencies change, and its cleanup
 * is kept). This proves the wiring — what is asked, what is replaced, what is cancelled — NOT that Next leaves its not-found boundary; that is the Chrome run.
 */
afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock("next/navigation");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(location: { pathname: string; search: string }, answer: () => Promise<Response>) {
  const replace = vi.fn(), push = vi.fn(), refresh = vi.fn();
  const calls: Array<{ input: unknown; init: unknown; thisValue: unknown }> = [];
  const cleanups: Array<() => void> = [];
  let previous: unknown[] | undefined;
  vi.resetModules();
  vi.doMock("react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("react")>()),
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
      if (!previous || deps.some((d, i) => !Object.is(d, previous![i]))) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }
      previous = deps;
    },
  }));
  const router = { replace, push, refresh };
  vi.doMock("next/navigation", () => ({ useRouter: () => router, usePathname: () => location.pathname, useSearchParams: () => new URLSearchParams(location.search) }));
  vi.stubGlobal("window", { location: { ...location, origin: "https://site.test" } });
  // A plain function, as the browser's: it is not callable as a method of another object (`this` must be the global, or undefined).
  vi.stubGlobal("fetch", function (this: unknown, input: unknown, init: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    calls.push({ input, init, thisValue: this });
    return answer();
  });
  const { default: Component } = await import("./BlogNotFoundRevalidate");
  return { replace, push, refresh, calls, cleanups, render: () => Component() };
}
const reply = (status: number) => Promise.resolve(new Response(null, { status }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("BlogNotFoundRevalidate", () => {
  it("asks for the address on screen once (however often it renders), through fetch called as a plain function", async () => {
    const { calls, render } = await mount({ pathname: "/blog/x", search: "?locale=vi" }, () => reply(404));
    for (let i = 0; i < 5; i += 1) render();
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("/blog/x?locale=vi");
  });

  it("a page that exists now: REPLACES the 404's entry with the recovery step for that address — once, never a push or a refresh", async () => {
    const { replace, push, refresh, render } = await mount({ pathname: "/blog/x", search: "" }, () => reply(200));
    render();
    await settle();
    expect(replace.mock.calls).toEqual([["/blog-recover?to=%2Fblog%2Fx"]]);
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a 404 that is still true, an error answer or a failed read navigates nowhere", async () => {
    for (const answer of [() => reply(404), () => reply(500), () => Promise.reject(new TypeError("network"))]) {
      const { replace, push, render } = await mount({ pathname: "/blog/x", search: "" }, answer);
      render();
      await settle();
      expect(replace).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    }
  });

  it("leaving the page cancels the request (the cleanup aborts it), so a late answer acts on nothing", async () => {
    let release: (r: Response) => void = () => undefined;
    const { replace, calls, cleanups, render } = await mount({ pathname: "/blog/x", search: "" }, () => new Promise<Response>((resolve) => { release = resolve; }));
    render();
    expect((calls[0].init as { signal: AbortSignal }).signal.aborted).toBe(false);
    cleanups.forEach((cleanup) => cleanup());
    expect((calls[0].init as { signal: AbortSignal }).signal.aborted).toBe(true);
    release(new Response(null, { status: 200 }));
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });
});
