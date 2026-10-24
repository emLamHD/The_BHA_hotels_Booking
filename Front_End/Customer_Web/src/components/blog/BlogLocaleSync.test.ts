import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BlogLocaleSync with React's hooks and Next's navigation hooks replaced by a controllable fake: `render()` is one render of the mounted component, and the effect
 * runs when a dependency changed, like React does. This pins WHEN it asks the server again; that the layout is then really re-rendered in the other language is
 * shown in Chrome on `next start`, not by this fake.
 */
async function mount(start = "/blog", search = "locale=en") {
  const refresh = vi.fn();
  const url = { pathname: start, search };
  const ref = { current: false };
  let previous: unknown[] | undefined;
  vi.resetModules();
  vi.doMock("react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("react")>()),
    useRef: () => ref,
    useEffect: (fn: () => void, deps: unknown[]) => {
      if (!previous || deps.some((d, i) => !Object.is(d, previous![i]))) fn();
      previous = deps;
    },
  }));
  vi.doMock("next/navigation", () => ({
    useRouter: () => ({ refresh }),
    usePathname: () => url.pathname,
    useSearchParams: () => new URLSearchParams(url.search),
  }));
  const { default: BlogLocaleSync } = await import("./BlogLocaleSync");
  const render = () => BlogLocaleSync();
  render();
  const go = (pathname: string, query = "") => {
    url.pathname = pathname;
    url.search = query;
    render();
  };
  return { refresh, go, render };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock("next/navigation");
  vi.restoreAllMocks();
});

describe("leaving a Blog page whose URL names its language", () => {
  it("asks the server again once, so the layout (header, menu, <html lang>, dictionary) follows the destination's language again", async () => {
    const { refresh, go } = await mount("/blog", "locale=en");
    expect(refresh).not.toHaveBeenCalled();                       // being on the Blog changes nothing here (BlogFreshness refreshes the Blog page itself)
    go("/");
    expect(refresh).toHaveBeenCalledTimes(1);
    go("/faq");                                                   // Home -> FAQ: not leaving the Blog
    go("/");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does so from every kind of Blog page, and for a regional language", async () => {
    for (const [from, query] of [["/blog/bai-viet", "locale=vi"], ["/blog/category/diem-den", "locale=en-us&page=2"], ["/blog", "page=3&locale=zh-hant"]] as const) {
      const { refresh, go } = await mount(from, query);
      go("/offers");
      expect(refresh, from).toHaveBeenCalledTimes(1);
    }
  });

  it("does it again for the next visit (Back to the Blog, then out again), and never in between", async () => {
    const { refresh, go } = await mount("/blog", "locale=en");
    go("/");                                                      // out: 1
    go("/blog", "locale=en");                                     // Back to the Blog (BlogFreshness refreshes it)
    expect(refresh).toHaveBeenCalledTimes(1);
    go("/faq");                                                   // out again: 2
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh a re-render at the same address (what a refresh itself causes): no loop", async () => {
    const { refresh, go, render } = await mount("/blog", "locale=en");
    go("/");
    for (let i = 0; i < 6; i += 1) render();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("everything else is left alone", () => {
  it.each([
    ["a Blog page with no language in its URL (the cookie already decides it)", "/blog", "page=2"],
    ["a Blog page whose `locale` is not a language tag (the middleware ignores it too)", "/blog", "locale=%00bad"],
    ["a Blog page whose `locale` is empty", "/blog/bai-viet", "locale="],
  ])("%s -> Home: no refresh", async (_name, from, query) => {
    const { refresh, go } = await mount(from, query);
    go("/");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Blog -> Blog (another post, category, page or language) is BlogFreshness's job: no refresh here", async () => {
    const { refresh, go } = await mount("/blog", "locale=en");
    go("/blog/bai-viet", "locale=vi");
    go("/blog/category/diem-den", "locale=vi&page=2");
    go("/blog", "locale=en");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("entering the Blog from elsewhere is BlogFreshness's job too: no refresh here", async () => {
    const { refresh, go } = await mount("/", "");
    go("/blog", "locale=en");
    go("/faq");                                                   // out of the Blog: the one refresh
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("`/blog-moved` and other paths that merely start with /blog are not the Blog", async () => {
    const { refresh, go } = await mount("/blog", "locale=en");
    go("/blog-moved");                                            // leaving the Blog: refresh
    expect(refresh).toHaveBeenCalledTimes(1);
    const other = await mount("/blogging", "locale=en");
    other.go("/");
    expect(other.refresh).not.toHaveBeenCalled();
  });

  it("never writes a cookie: the reader's language and currency are the reader's", async () => {
    const writes: string[] = [];
    vi.stubGlobal("document", { set cookie(value: string) { writes.push(value); } });
    const { go } = await mount("/blog", "locale=en");
    go("/");
    vi.unstubAllGlobals();
    expect(writes).toEqual([]);
  });
});

describe("the Blog 404 recovery step (C7)", () => {
  it("is passed through without a refresh, and the next Blog page still counts as one that names its language", async () => {
    const { refresh, go } = await mount("/blog", "locale=vi&page=abc");   // a 404 of the index, language named in the URL
    go("/blog-recover", "locale=en");                                       // the transit step
    expect(refresh).not.toHaveBeenCalled();
    go("/blog", "locale=en");                                               // the chosen index (BlogFreshness refreshes it)
    expect(refresh).not.toHaveBeenCalled();
    go("/faq");                                                             // leaving it afterwards is still the C6 case
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
