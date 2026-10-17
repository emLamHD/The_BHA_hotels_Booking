import { describe, expect, it } from "vitest";
import { backToTopBehavior, contactLabels, parseContactSettings, shouldAcceptContact } from "./settings";

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
