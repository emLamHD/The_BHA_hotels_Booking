/**
 * BHA-ADMIN-BADGE-001-PR07: what the Blog client reads and sends for the unseen badges, run against a stubbed `fetch` carrying the shapes PR-6 answers.
 * A watermark is the decimal string of the answer's own snapshot: in the body of the four object reads, in `X-Admin-View-Watermark` for the bare-array categories. A missing or malformed
 * one never makes good data unreadable (an older backend). The correlation id travels only on the requests of one Save-then-Publish chain; "seen" is a POST of exactly the watermark given.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORRELATION_HEADER, createPost, getPins, getSettings, listCategories, listMedia, listPosts, readCategories, saveDraft, transitionPost } from "./blog";
import { markMenuSeen } from "./menuUnseen";

const BASE = "https://localhost:7145";
const ID = "3f2b6c1e-5d4a-4b8e-9c7d-1a2b3c4d5e6f";
const BLOG = `${BASE}/api/admin/v1/website/blog`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE);
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function answer(body: unknown, headers: Record<string, string> = {}) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const post = { id: ID, createdAtUtc: "2026-10-21T08:00:00Z", translations: [] };
const posts = { items: [], page: 1, pageSize: 20, total: 0 };
const media = { items: [], page: 1, pageSize: 24, total: 0 };
const pins = { categoryId: ID, version: 2, pins: [] };
const settings = { homeSectionCategoryId: null, version: 3, updatedAtUtc: "2026-10-21T08:00:00Z" };

type Read = { name: string; body: object; read: () => Promise<{ kind: string; data?: unknown }> };
const reads: Read[] = [
  { name: "the posts list", body: posts, read: () => listPosts({ page: 1, pageSize: 20 }) },
  { name: "the media list", body: media, read: () => listMedia({ page: 1, pageSize: 24 }) },
  { name: "the pins", body: pins, read: () => getPins(ID) },
  { name: "the settings", body: settings, read: () => getSettings() },
];

describe.each(reads)("$name", ({ body, read }) => {
  it("carries the watermark of its own answer as the decimal string the server sent (never a number)", async () => {
    answer({ ...body, viewWatermark: "9223372036854775807" });
    const result = await read();
    expect(result.kind).toBe("ok");
    expect((result.data as { viewWatermark?: string }).viewWatermark).toBe("9223372036854775807");
  });

  it.each([["missing", undefined], ["a JSON number", 7], ["padded", "007"], ["signed", "-1"], ["text", "abc"], ["empty", ""], ["null", null]])(
    "renders its data with no mark when the watermark is %s (an older backend)", async (_label, value) => {
      answer(value === undefined ? body : { ...body, viewWatermark: value });
      const result = await read();
      expect(result.kind).toBe("ok");
      expect("viewWatermark" in (result.data as object)).toBe(false);
      expect(result.data).toMatchObject(body);
    },
  );
});

describe("the categories (a bare array: the watermark is a response header)", () => {
  it("readCategories gives the items and the header's watermark; listCategories (the pickers) still gives the plain array", async () => {
    answer([], { "X-Admin-View-Watermark": "42" });
    expect(await readCategories()).toEqual({ kind: "ok", data: { items: [], viewWatermark: "42" } });
    answer([], { "X-Admin-View-Watermark": "42" });
    expect(await listCategories()).toEqual({ kind: "ok", data: [] });
  });

  it.each([["missing", {}], ["padded", { "X-Admin-View-Watermark": "042" }], ["text", { "X-Admin-View-Watermark": "x" }], ["two numbers", { "X-Admin-View-Watermark": "4, 5" }]])(
    "reads the items with no mark when the header is %s", async (_label, headers) => {
      answer([], headers);
      expect(await readCategories()).toEqual({ kind: "ok", data: { items: [] } });
    },
  );

  it("is a plain GET of the categories", async () => {
    const spy = answer([]);
    await readCategories();
    expect(spy.mock.calls[0]).toEqual([`${BLOG}/categories`, expect.objectContaining({ method: "GET", credentials: "include" })]);
  });
});

describe("the correlation id of one Save-then-Publish chain", () => {
  const draft = { title: "t", slug: "s", summary: "x", bodyJson: null } as never;
  const sentHeaders = (spy: ReturnType<typeof answer>) => (spy.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;

  it("is sent as X-Admin-Correlation-Id by create, save and publish when the chain gives one", async () => {
    for (const send of [() => createPost(ID, "vi", draft, ID), () => saveDraft(ID, "vi", 1, draft, ID), () => transitionPost(ID, "vi", "publish", 2, ID)]) {
      const spy = answer(post);
      await send();
      expect(sentHeaders(spy)[CORRELATION_HEADER]).toBe(ID);
    }
  });

  it("is never sent when the call is given none: a standalone create, save or publish sends exactly what it always sent", async () => {
    for (const send of [() => createPost(ID, "vi", draft), () => saveDraft(ID, "vi", 1, draft), () => transitionPost(ID, "vi", "publish", 2)]) {
      const spy = answer(post);
      await send();
      expect(sentHeaders(spy)).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    }
  });

  it("is never sent by a transition that is not a publish, even if one is handed in", async () => {
    for (const action of ["unpublish", "archive", "unarchive"] as const) {
      const spy = answer(post);
      await transitionPost(ID, "vi", action, 2, ID);
      expect(sentHeaders(spy)).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    }
  });
});

describe("markMenuSeen", () => {
  const entry = { count: 0, lastSeenWatermark: "12", currentWatermark: "12" };

  it("POSTs exactly the watermark it was given to the menu's seen route and answers the entry after the move", async () => {
    const spy = answer(entry);
    expect(await markMenuSeen("blog-categories", "12")).toEqual({ kind: "ok", data: entry });
    const [url, init] = spy.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe(`${BASE}/api/admin/v1/menu-unseen/blog-categories/seen`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ viewWatermark: "12" });
  });
});
