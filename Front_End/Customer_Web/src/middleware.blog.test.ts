import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const ORIGIN = "https://localhost:3000";
const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(new URL(path, ORIGIN), { headers });
const answer = (status: number, body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), { status }));
/** What the middleware hands on to the page: the request headers it kept or set (Next's override protocol). */
const forwarded = (response: Response) => {
  const names = (response.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean);
  return Object.fromEntries(names.map((n) => [n, response.headers.get(`x-middleware-request-${n}`)]));
};

describe("middleware on the Blog", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends an old slug to the permanent-redirect route with the CURRENT Customer address (a rewrite: the reader's own scheme and host are never involved)", async () => {
    fetchMock.mockImplementation(() => answer(301, { slug: "bai-moi", locale: "vi" }));
    const response = await middleware(request("/blog/bai-cu?locale=vi", { host: "internal-host:3000" }));
    const target = new URL(response.headers.get("x-middleware-rewrite")!);
    expect(target.pathname).toBe("/blog-moved");
    expect(target.searchParams.get("to")).toBe("/blog/bai-moi?locale=vi");
    expect(response.headers.get("location")).toBeNull();
  });

  it("hands the URL's explicit language (normalized) to the page as a request header, and leaves the cookie alone", async () => {
    fetchMock.mockReturnValue(answer(200, {}));
    const response = await middleware(request("/blog/bai-viet?locale=en-US", { cookie: "bha_locale=vi" }));
    expect(response.status).toBe(200);
    expect(forwarded(response)["x-bha-locale"]).toBe("en-us");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets no language header when the URL names none or a bad one, and a client-sent one is dropped everywhere", async () => {
    fetchMock.mockReturnValue(answer(200, {}));
    expect(forwarded(await middleware(request("/blog")))).not.toHaveProperty("x-bha-locale");
    expect(forwarded(await middleware(request("/blog?locale=not%20a%20tag")))).not.toHaveProperty("x-bha-locale");
    expect(forwarded(await middleware(request("/offers?locale=en", { "x-bha-locale": "fr" })))).not.toHaveProperty("x-bha-locale");
    expect(forwarded(await middleware(request("/blog?locale=vi", { "x-bha-locale": "fr" })))["x-bha-locale"]).toBe("vi");   // the URL wins over a header a client invented
  });

  it("does not call the API for pages that are not Blog addresses", async () => {
    await middleware(request("/offers"));
    await middleware(request("/riverside?locale=en"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the request through to the page when the API cannot be asked (the page then says it could not load)", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const response = await middleware(request("/blog/bai-cu?locale=vi"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
