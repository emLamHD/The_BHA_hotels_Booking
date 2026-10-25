import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Revalidation } from "./revalidate404";

/** BHA-BLOG-001-CP04-CP05-C9: `revalidateBlog404` against a stubbed `fetch` (a plain function — it is the reader's own address, read for its status only). */
const ORIGIN = "https://site.test";

let revalidateBlog404: typeof import("./revalidate404").revalidateBlog404;
beforeEach(async () => {
  vi.resetModules();                                   // `attempted` (the loop stop) is module state: each test starts without it
  ({ revalidateBlog404 } = await import("./revalidate404"));
});

function reply(status: number, extra: { redirected?: boolean; url?: string } = {}) {
  const response = new Response(null, { status: status === 200 ? 200 : status });
  Object.defineProperty(response, "redirected", { value: extra.redirected ?? false });
  Object.defineProperty(response, "url", { value: extra.url ?? "" });
  return response;
}

function run(href: string, answer: () => Promise<Response>, over: Partial<{ current: string; signal: AbortSignal }> = {}) {
  const recover = vi.fn();
  const fetcher = vi.fn(answer) as unknown as typeof fetch;
  const result = revalidateBlog404({ href, origin: ORIGIN, fetcher, signal: over.signal ?? new AbortController().signal, current: () => over.current ?? href, recover });
  return { result, recover, fetcher: fetcher as unknown as ReturnType<typeof vi.fn> };
}

describe("a Blog 404 asks the server once, with a plain GET of the same address", () => {
  it("reads the address itself, never cached, same-origin, as HTML — one request", async () => {
    const { result, fetcher } = run("/blog/x", async () => reply(404));
    expect(await result).toBe<Revalidation>("still-404");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/blog/x");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "same-origin", headers: { Accept: "text/html" } });
  });

  it("404 is still true: nothing happens (no recovery, no navigation)", async () => {
    const { result, recover } = run("/blog/x?locale=vi", async () => reply(404));
    expect(await result).toBe("still-404");
    expect(recover).not.toHaveBeenCalled();
  });

  it("200 means the address is a page now: recover to that address (with its language and page kept)", async () => {
    for (const href of ["/blog/x", "/blog/x?locale=vi", "/blog/category/c?locale=en&page=2", "/blog?locale=vi"]) {
      const { result, recover } = run(href, async () => reply(200));
      expect(await result, href).toBe("recovered");
      expect(recover.mock.calls, href).toEqual([[href]]);
    }
  });

  it("an old slug the server redirects (followed to a 200) is recovered to where it lives now — only when that is a Blog address of this site", async () => {
    const good = run("/blog/old", async () => reply(200, { redirected: true, url: `${ORIGIN}/blog/new?locale=vi` }));
    expect(await good.result).toBe("recovered");
    expect(good.recover.mock.calls).toEqual([["/blog/new?locale=vi"]]);
    for (const url of ["https://evil.test/blog/new", `${ORIGIN}/offers`, `${ORIGIN}/blog/new?next=1`, "not a url"]) {
      const bad = run("/blog/old", async () => reply(200, { redirected: true, url }));
      expect(await bad.result, url).toBe("unconfirmed");
      expect(bad.recover, url).not.toHaveBeenCalled();
    }
  });

  it("any other answer, a failed read or a thrown fetch changes nothing and is not retried", async () => {
    for (const answer of [async () => reply(500), async () => reply(503), async () => reply(301), async () => { throw new TypeError("network"); }]) {
      const { result, recover, fetcher } = run("/blog/x", answer);
      expect(await result).toBe("unconfirmed");
      expect(recover).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("an answer that arrives after the reader left (another address, or the effect was cleaned up) acts on nothing", async () => {
    const moved = run("/blog/x", async () => reply(200), { current: "/faq" });
    expect(await moved.result).toBe("left");
    expect(moved.recover).not.toHaveBeenCalled();
    const controller = new AbortController();
    const late = run("/blog/x", async () => { controller.abort(); return reply(200); }, { signal: controller.signal });
    expect(await late.result).toBe("left");
    expect(late.recover).not.toHaveBeenCalled();
  });

  it("an address recovered once that is shown as a 404 again is not recovered again (no loop) until the server says 404 for it", async () => {
    const answers = [200, 200, 404, 200];
    const seen: Revalidation[] = [];
    const recover = vi.fn();
    for (const status of answers) {
      seen.push(await revalidateBlog404({ href: "/blog/x", origin: ORIGIN, fetcher: (async () => reply(status)) as unknown as typeof fetch, signal: new AbortController().signal, current: () => "/blog/x", recover }));
    }
    expect(seen).toEqual(["recovered", "skipped", "still-404", "recovered"]);
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
