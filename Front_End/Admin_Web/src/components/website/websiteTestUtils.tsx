/**
 * CUST-WEB-HEADER-001-CP02 test helpers: factories for the API's records and one place that renders a screen inside the
 * real WebsiteAccessGate with `me` mocked. Test-only; nothing in the product imports it.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { StaffSession } from "@/lib/api/staff";
import type { WebsiteCurrency, WebsiteLanguage, WebsiteTranslationList, WebsiteTranslationRow } from "@/lib/api/website";
import WebsiteAccessGate from "./WebsiteAccessGate";

export const ALLOWED: StaffSession = {
  staffAccountId: "11111111-1111-1111-1111-111111111111",
  email: "site@example.com",
  memberships: [{ propertyId: "prop-a", propertyName: "Property A", timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" }],
  permissions: ["WebsiteSettingsManage"],
};

export const WITHOUT_PERMISSION: StaffSession = { ...ALLOWED, permissions: [] };

export function lang(overrides: Partial<WebsiteLanguage> = {}): WebsiteLanguage {
  return {
    code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", sortOrder: 10, isActive: true, isDefault: true,
    version: 1, translatedKeys: 25, totalKeys: 25, updatedAtUtc: "2026-10-15T00:00:00+00:00", ...overrides,
  };
}

export function currency(overrides: Partial<WebsiteCurrency> = {}): WebsiteCurrency {
  return {
    code: "USD", name: "US dollar", symbol: "$", minorUnits: 2, sortOrder: 20, isActive: false, isDefault: false, isBase: false,
    vndPerUnit: null, rateUpdatedAtUtc: null, rateSource: "manual", version: 1, updatedAtUtc: "2026-10-15T00:00:00+00:00", ...overrides,
  };
}

export const VND = currency({
  code: "VND", name: "Vietnamese đồng", symbol: "₫", minorUnits: 0, sortOrder: 10, isActive: true, isDefault: true, isBase: true,
  vndPerUnit: "1", rateUpdatedAtUtc: "2026-10-15T00:00:00+00:00",
});

export function row(overrides: Partial<WebsiteTranslationRow> = {}): WebsiteTranslationRow {
  return {
    key: "common.close", group: "common", sourceText: "Đóng", placeholders: [], value: "Đóng", effectiveValue: "Đóng",
    hasOverride: true, isFallback: false, version: 1, updatedAtUtc: "2026-10-15T00:00:00+00:00", ...overrides,
  };
}

export function translations(overrides: Partial<WebsiteTranslationList> = {}): WebsiteTranslationList {
  return {
    locale: "vi", isDefaultLocale: true, defaultLocale: "vi", translatedKeys: 2, totalKeys: 2, groups: ["common", "header-menu"],
    rows: [row(), row({ key: "common.error.loadFailed", sourceText: "Đã có lỗi khi tải {what}.", placeholders: ["what"], value: "Đã có lỗi khi tải {what}.", effectiveValue: "Đã có lỗi khi tải {what}." })],
    ...overrides,
  };
}

export const ok = <T,>(data: T) => ({ kind: "ok" as const, data });

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Renders a screen inside the real gate, with the Staff session already confirmed by the (mocked) `me`. */
export function renderInGate(screen: React.ReactNode, returnTo = "/website/languages") {
  return render(<WebsiteAccessGate returnTo={returnTo}>{screen}</WebsiteAccessGate>);
}

export const fakeRouter = () => ({ replace: vi.fn(), push: vi.fn() });

/** `ActionButton` puts its test id on a wrapping span; this is the button inside it. */
export const btn = (testId: string) => within(screen.getByTestId(testId)).getByRole("button");
export const queryBtn = (testId: string) => {
  const holder = screen.queryByTestId(testId);
  return holder ? within(holder).getByRole("button") : null;
};
