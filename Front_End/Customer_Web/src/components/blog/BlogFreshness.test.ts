import { afterEach, describe, expect, it, vi } from "vitest";

/** BlogFreshness with React's effect and Next's navigation hooks replaced by a controllable fake: `render()` is one render of a mounted component. */
async function mount(url = { pathname: "/blog/bai-viet-1", search: "locale=vi" }) {
  const refresh = vi.fn();
  const router = { refresh };
  let previous: unknown[] | undefined;
  vi.resetModules();
  vi.doMock("react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("react")>()),
    // Runs the effect on mount and whenever a dependency changed, like React does.
    useEffect: (fn: () => void, deps: unknown[]) => {
      if (!previous || deps.some((d, i) => !Object.is(d, previous![i]))) fn();
      previous = deps;
    },
  }));
  vi.doMock("next/navigation", () => ({
    useRouter: () => router,
    usePathname: () => url.pathname,
    useSearchParams: () => new URLSearchParams(url.search),
  }));
  const { default: BlogFreshness } = await import("./BlogFreshness");
  return { refresh, url, render: () => BlogFreshness() };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock("next/navigation");
  vi.restoreAllMocks();
});

describe("a Blog page shown again from the client router cache", () => {
  it("asks the server again when it is shown, however soon after the tab loaded (a fast Back/Forward or Link revisit is no exception)", async () => {
    const now = vi.spyOn(performance, "now");
    for (const sinceLoad of [0, 900, 3999, 4001, 60_000]) {
      now.mockReturnValue(sinceLoad);
      const { refresh, render } = await mount();
      render();
      expect(refresh, `${sinceLoad} ms after the tab loaded`).toHaveBeenCalledTimes(1);
    }
  });

  it("refreshes once per mount: a re-render at the same address (what a refresh itself causes) does not refresh again", async () => {
    const { refresh, render } = await mount();
    for (let i = 0; i < 5; i += 1) render();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes again when the page is kept but its path, query or language changes", async () => {
    const { refresh, url, render } = await mount();
    render();
    url.search = "locale=vi&page=2";
    render();
    expect(refresh).toHaveBeenCalledTimes(2);
    url.search = "locale=en&page=2";
    render();
    expect(refresh).toHaveBeenCalledTimes(3);
    url.pathname = "/blog/category/diem-den";
    render();
    expect(refresh).toHaveBeenCalledTimes(4);
    render();
    render();
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});
