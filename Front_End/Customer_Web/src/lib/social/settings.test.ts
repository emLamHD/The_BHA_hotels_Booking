import { afterEach, describe, expect, it, vi } from "vitest";
import { backToTopBehavior, chooseContact, contactLabels, fetchContactSettings, parseContactSettings, shouldAcceptContact } from "./settings";

const valid = { revision: 3, generatedAtUtc: "2026-10-17T00:00:00Z", phoneEnabled: true, phoneNumber: "0899474888",
  phoneHref: "tel:+84899474888", messengerEnabled: true, messengerUrl: "https://m.me/thebha", zaloEnabled: true,
  zaloUrl: "https://zalo.me/0899474888", backToTopEnabled: true };

describe("floating contact settings", () => {
  it("accepts the public contract and rejects incomplete bodies", () => {
    expect(parseContactSettings(valid)).toEqual(valid);
    expect(parseContactSettings({ ...valid, phoneHref: undefined })).toBeNull();
  });

  it("does not let an older response replace a newer revision", () => {
    expect(shouldAcceptContact(valid, { ...valid, revision: 2 })).toBe(false);
    expect(shouldAcceptContact(valid, { ...valid, revision: 4 })).toBe(true);
  });

  it("uses instant scrolling for reduced motion", () => {
    expect(backToTopBehavior(true)).toBe("auto");
    expect(backToTopBehavior(false)).toBe("smooth");
  });

  it("provides the four action labels in Vietnamese, English and French", () => {
    expect(contactLabels("vi")).toMatchObject({ phone: "Điện thoại", top: "Về đầu trang" });
    expect(contactLabels("en-US")).toMatchObject({ messenger: "Chat on Messenger", call: "Call" });
    expect(contactLabels("fr")).toMatchObject({ zalo: "Contacter sur Zalo", top: "Retour en haut" });
  });
});

// BHA-CHECKOUT-001-PR09-C6 P2-2: the one channel a page offers. Fixture numbers and addresses below are not real.
const fake = { ...valid, phoneNumber: "0000 000 000", phoneHref: "tel:+84000000000", messengerUrl: "https://m.me/example-page", zaloUrl: "https://zalo.me/0000000000" };

describe("chooseContact (PR09-C6)", () => {
  it("prefers Phone, then Zalo, then Messenger, among the enabled channels with a usable destination", () => {
    expect(chooseContact(fake)).toEqual({ status: "channel", kind: "phone", href: "tel:+84000000000" });
    expect(chooseContact({ ...fake, phoneEnabled: false })).toEqual({ status: "channel", kind: "zalo", href: "https://zalo.me/0000000000" });
    expect(chooseContact({ ...fake, phoneEnabled: false, zaloEnabled: false })).toEqual({ status: "channel", kind: "messenger", href: "https://m.me/example-page" });
    expect(chooseContact({ ...fake, phoneEnabled: false, zaloEnabled: false, messengerEnabled: false })).toEqual({ status: "none" });
  });

  it("skips a destination that is missing or not a tel: number / https: address, and moves on to the next channel", () => {
    expect(chooseContact({ ...fake, phoneNumber: null })).toMatchObject({ kind: "zalo" });
    expect(chooseContact({ ...fake, phoneHref: null })).toMatchObject({ kind: "zalo" });
    expect(chooseContact({ ...fake, phoneHref: "javascript:alert(1)" })).toMatchObject({ kind: "zalo" });
    expect(chooseContact({ ...fake, phoneHref: "https://example.test/call" })).toMatchObject({ kind: "zalo" });
    expect(chooseContact({ ...fake, phoneEnabled: false, zaloUrl: "http://zalo.me/0000000000" })).toMatchObject({ kind: "messenger" });
    expect(chooseContact({ ...fake, phoneEnabled: false, zaloUrl: "not a url" })).toMatchObject({ kind: "messenger" });
    expect(chooseContact({ ...fake, phoneEnabled: false, zaloEnabled: false, messengerUrl: "javascript:alert(1)" })).toEqual({ status: "none" });
    expect(chooseContact({ ...fake, phoneEnabled: false, zaloEnabled: false, messengerUrl: null })).toEqual({ status: "none" });
    expect(chooseContact(null)).toEqual({ status: "none" });
  });

  it("adds nothing to the destination (no booking code, address or secret)", () => {
    const choice = chooseContact(fake);
    expect(choice).toEqual({ status: "channel", kind: "phone", href: fake.phoneHref });
  });
});

describe("fetchContactSettings (PR09-C6)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const respond = (init: { ok: boolean; status?: number; body?: unknown }) => {
    const fetchMock = vi.fn(async () => ({ ok: init.ok, status: init.status ?? 200, json: async () => init.body }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
    return fetchMock;
  };

  it("reads the public endpoint without credentials or cache, and parses it", async () => {
    const fetchMock = respond({ ok: true, body: fake });
    await expect(fetchContactSettings()).resolves.toEqual(fake);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/v1/website/social-media", expect.objectContaining({ cache: "no-store" }));
    expect((fetchMock.mock.calls[0] as unknown[])[1]).not.toHaveProperty("credentials");
  });

  it("rejects on an HTTP error, and answers null for a body that is not the contract", async () => {
    respond({ ok: false, status: 503 });
    await expect(fetchContactSettings()).rejects.toThrow("HTTP 503");
    respond({ ok: true, body: { nope: true } });
    await expect(fetchContactSettings()).resolves.toBeNull();
  });
});
