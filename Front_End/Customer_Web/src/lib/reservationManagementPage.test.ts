import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMessage, messageVariables } from "@/lib/i18n/format";
import { FAILURE_KEY, MANAGE } from "./reservationManagement";

const LOCALIZATION = resolve(__dirname, "../../../../Back_End/src/TheBha.Application/Website/Localization");
const read = (path: string) => JSON.parse(readFileSync(resolve(LOCALIZATION, path), "utf8"));
const catalog = new Map<string, { scope: string; placeholders: string[] }>(
  read("catalog.json").messages.map((m: { key: string; scope: string; placeholders: string[] }) => [m.key, m]),
);
const packs: Record<string, Record<string, string>> = {};
for (const locale of ["vi", "en", "fr"]) {
  packs[locale] = Object.assign({}, ...Object.values(read(`packs/${locale}.json`).messages as Record<string, Record<string, string>>));
}

const SRC = resolve(__dirname, "..");
const sources = [
  "lib/reservationManagement.ts",
  "app/reservations/[reservationId]/manage/ManageReservation.tsx",
  "app/reservations/[reservationId]/manage/page.tsx",
].map((file) => readFileSync(resolve(SRC, file), "utf8"));
const quotedKeys = new Set(sources.flatMap((text) => Array.from(text.matchAll(/"((?:customer|shared)\.[A-Za-z0-9_.-]+)"/g)).map((m) => m[1])));
// keys built at run time by the page
const dynamicKeys = [
  "customer.booking.reservation.status.Confirmed",
  "customer.booking.reservation.status.Cancelled",
  "shared.apiError.validation.arrival-date-invalid",
  "shared.apiError.validation.arrival-time-invalid",
  "shared.apiError.validation.arrival-out-of-window",
  "shared.apiError.validation.arrival-time-nonexistent",
  "shared.apiError.reservation.arrival-not-changeable",
  "shared.apiError.auth.rate-limited",
  "shared.apiError.auth.csrf-invalid",
];
const used = Array.from(new Set([...Array.from(quotedKeys), ...Object.values(MANAGE), ...Object.values(FAILURE_KEY), ...dynamicKeys, "customer.receipt.manageBooking"]));

describe("the management page texts (vi / en / fr)", () => {
  it("collects the keys the page uses", () => {
    expect(used.length).toBeGreaterThan(60);
    expect(used).toContain("customer.manage.eta.help");
  });

  for (const locale of ["vi", "en", "fr"]) {
    it(`${locale}: every key the page uses has a text, listed in the catalog with the same placeholders (so no raw key is shown)`, () => {
      const problems: string[] = [];
      for (const key of used) {
        const text = packs[locale][key];
        const entry = catalog.get(key);
        if (text === undefined) problems.push(`${key}: no ${locale} text`);
        if (!entry) problems.push(`${key}: not in the catalog`);
        if (text !== undefined && entry) {
          if (JSON.stringify([...messageVariables(text)].sort()) !== JSON.stringify([...entry.placeholders].sort())) problems.push(`${key}: placeholders differ`);
          if (text.trim() === "") problems.push(`${key}: empty`);
        }
      }
      expect(problems).toEqual([]);
    });
  }

  it("fills the placeholders of the arrival texts in every language", () => {
    for (const [locale, formatLocale] of [["vi", "vi-VN"], ["en", "en-US"], ["fr", "fr-FR"]] as const) {
      const help = formatMessage(packs[locale]["customer.manage.eta.help"], formatLocale, { zone: "Asia/Ho_Chi_Minh" });
      const current = formatMessage(packs[locale]["customer.manage.eta.current"], formatLocale, { date: "2 Dec 2026", time: "01:30", zone: "Asia/Ho_Chi_Minh" });
      for (const text of [help, current]) expect(text).not.toMatch(/[{}]/);
      expect(help).toContain("Asia/Ho_Chi_Minh");
      expect(current).toContain("01:30");
    }
  });

  it("uses the Owner's wording for the receipt button and the not-recorded state in Vietnamese", () => {
    expect(packs.vi["customer.receipt.manageBooking"]).toBe("Quản lý đặt phòng");
    expect(packs.vi["customer.manage.ledger.notRecorded"]).toBe("Chưa ghi nhận thanh toán");
  });
});

describe("the page's response headers", () => {
  const config = createRequire(__filename)("../../next.config.js") as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };

  it("are set for exactly the management route: no referrer and no indexing", async () => {
    const rules = await config.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/reservations/:reservationId/manage");
    const byKey = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    expect(byKey).toEqual({ "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" });
  });

  it("the page is rendered per request, which is what makes Next answer private, no-store (Cache-Control is not configurable for a page)", () => {
    expect(sources[2]).toMatch(/export const dynamic = "force-dynamic"/);
  });
});
