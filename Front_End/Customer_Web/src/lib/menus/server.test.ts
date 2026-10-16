import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock("@/lib/api/env", () => ({ getApiBaseUrl: () => "https://api.test" }));

import { getMenuSnapshot } from "./server";

const body = (label: string, at = "2026-10-16T01:00:00Z") => ({ revision: "r", locale: "vi", generatedAtUtc: at, primary: [{ id: "1", label, href: "/a", newTab: false, children: [] }], secondary: [] });
const answer = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

describe("the server's read of the menu for the first render", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is read fresh (no Next fetch cache) and gives the tree", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(body("Một")));
    const menu = await getMenuSnapshot("vi");
    expect(menu?.primary[0].label).toBe("Một");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.test/api/v1/website/menus?locale=vi");
  });

  it("a first failure — an error status or something that is not a menu — is null: the header then shows only its controls", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ title: "boom" }, 500));
    expect(await getMenuSnapshot("fr")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ hello: "proxy page" }));
    expect(await getMenuSnapshot("fr")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await getMenuSnapshot("fr")).toBeNull();
  });

  it("after one good read a transient failure keeps the last good menu of that language, but a valid empty answer is honoured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(() => answer(body("Còn đó")));
    await getMenuSnapshot("en");
    fetchMock.mockImplementation(() => answer({}, 503));
    expect((await getMenuSnapshot("en"))?.primary[0].label).toBe("Còn đó");
    expect(await getMenuSnapshot("de")).toBeNull();                                      // another language has no copy
    fetchMock.mockImplementation(() => answer({ ...body("x"), primary: [] }));
    expect((await getMenuSnapshot("en"))?.primary).toEqual([]);                          // the operator emptied it: that is the answer
    fetchMock.mockImplementation(() => answer({}, 503));
    expect((await getMenuSnapshot("en"))?.primary).toEqual([]);                          // and a failure after that does not bring the old menu back
  });
});
