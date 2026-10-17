import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock("@/lib/api/env", () => ({ getApiBaseUrl: () => "https://api.test" }));

import { getHeroSnapshot } from "./server";

const body = (title: string, patch: Record<string, unknown> = {}) => ({
  revision: "r", locale: "vi", generatedAtUtc: "2026-10-17T01:00:00Z", fontKey: "default", autoplayEnabled: true, intervalSeconds: 6,
  title, description: "d", primaryAction: "a", secondaryAction: "b",
  slides: [{ id: "s1", imageUrl: "/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-000000000001", seedFile: null, focalPosition: "50% 50%", alt: "x", caption: "y" }],
  ...patch,
});
const answer = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

describe("the server's read of the hero for the first render", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is read fresh (no Next fetch cache), in the visitor's language", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(body("Một")));
    const hero = await getHeroSnapshot("vi");
    expect(hero?.title).toBe("Một");
    expect(hero?.slides[0].imageUrl).toBe("https://api.test/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-000000000001");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.test/api/v1/website/hero?locale=vi");
  });

  it("a first failure — an error status, a network error or something that is not a hero — is null, never a throw", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ title: "boom" }, 500));
    expect(await getHeroSnapshot("fr")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ hello: "proxy page" }));
    expect(await getHeroSnapshot("fr")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(body("x", { slides: [] })));
    expect(await getHeroSnapshot("fr")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await getHeroSnapshot("fr")).toBeNull();
  });

  it("after one good read a transient failure keeps the last good hero of that language only", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(() => answer(body("Còn đó")));
    await getHeroSnapshot("en");
    fetchMock.mockImplementation(() => answer({}, 503));
    expect((await getHeroSnapshot("en"))?.title).toBe("Còn đó");
    expect(await getHeroSnapshot("de")).toBeNull();
    fetchMock.mockImplementation(() => answer(body("Mới")));
    expect((await getHeroSnapshot("en"))?.title).toBe("Mới");                      // and a good read replaces it
  });
});
