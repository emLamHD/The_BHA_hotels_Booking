/**
 * BHA-ADMIN-BADGE-001-PR09: what the Website client reads for the unseen badges, run against a stubbed `fetch` carrying the shapes PR-8 answers.
 * A watermark is the decimal string of the answer's own snapshot: in the body of the five object reads, in `X-Admin-View-Watermark` for the three bare-array reads. A missing or malformed
 * one never makes good data unreadable (an older backend), and the bare-array `list*` callers keep getting the plain array.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHero, getMenu, getNewsletterSender, getSocialSettings, listCurrencies, listLanguages, listLibraryPacks, listTranslations, readCurrencies, readLanguages, readLibraryPacks,
} from "./website";
import { currency, lang, translations } from "@/components/website/websiteTestUtils";

const BASE = "https://localhost:7145";
const SETTINGS = `${BASE}/api/admin/v1/website`;

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

const locale = { code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, isActive: true, isContentSource: true };
const text = { vi: "x" };
const hero = {
  revision: "r1", version: 1, updatedAtUtc: "2026-11-21T00:00:00Z", locales: [locale], fontKey: "default", autoplayEnabled: true, intervalSeconds: 6, slides: [], media: [],
  texts: { title: text, description: text, primaryAction: text, secondaryAction: text },
};
const menu = { revision: "r1", version: 1, updatedAtUtc: "2026-11-21T00:00:00Z", locales: [locale], items: [] };
const social = {
  revision: 1, updatedAtUtc: "2026-11-21T00:00:00Z", phoneEnabled: true, phoneNumber: "0900000000", phoneHref: "tel:0900000000", messengerEnabled: false, messengerUrl: null,
  zaloEnabled: false, zaloNumber: null, zaloUrl: null, backToTopEnabled: true,
};
const sender = {
  status: "NotConnected", clientId: null, hasClientSecret: false, connectedEmail: null, senderName: null, replyTo: null, connectedAtUtc: null, redirectUri: null, scopes: [],
  customerOriginReady: true, version: 0, pendingRequests: 0,
};

type Read = { name: string; body: object; read: () => Promise<{ kind: string; data?: unknown }> };
const reads: Read[] = [
  { name: "the hero", body: hero, read: () => getHero() },
  { name: "the menus", body: menu, read: () => getMenu() },
  { name: "the social settings", body: social, read: () => getSocialSettings() },
  { name: "the newsletter sender", body: sender, read: () => getNewsletterSender() },
  { name: "the translations", body: translations(), read: () => listTranslations("vi", { page: 1, pageSize: 25 }) },
];

describe.each(reads)("$name (the watermark is in the body)", ({ body, read }) => {
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

type Bare = { name: string; path: string; body: unknown[]; read: () => Promise<{ kind: string; data?: unknown }>; list: () => Promise<{ kind: string; data?: unknown }> };
const bare: Bare[] = [
  { name: "the languages", path: "languages", body: [lang()], read: () => readLanguages(), list: () => listLanguages() },
  { name: "the language-pack library", path: "language-packs/library", body: [], read: () => readLibraryPacks(), list: () => listLibraryPacks() },
  { name: "the currencies", path: "currencies", body: [currency()], read: () => readCurrencies(), list: () => listCurrencies() },
];

describe.each(bare)("$name (a bare array: the watermark is a response header)", ({ path, body, read, list }) => {
  it("read* gives the items and the header's watermark; list* (the pickers and lookups) still gives the plain array", async () => {
    answer(body, { "X-Admin-View-Watermark": "42" });
    expect(await read()).toEqual({ kind: "ok", data: { items: body, viewWatermark: "42" } });
    answer(body, { "X-Admin-View-Watermark": "42" });
    expect(await list()).toEqual({ kind: "ok", data: body });
  });

  it.each([["missing", {}], ["padded", { "X-Admin-View-Watermark": "042" }], ["text", { "X-Admin-View-Watermark": "x" }], ["two numbers", { "X-Admin-View-Watermark": "4, 5" }]])(
    "reads the items with no mark when the header is %s", async (_label, headers) => {
      answer(body, headers);
      expect(await read()).toEqual({ kind: "ok", data: { items: body } });
    },
  );

  it("is a plain GET of the same path", async () => {
    const spy = answer(body);
    await read();
    expect(spy.mock.calls[0]).toEqual([`${SETTINGS}/${path}`, expect.objectContaining({ method: "GET", credentials: "include" })]);
  });
});
