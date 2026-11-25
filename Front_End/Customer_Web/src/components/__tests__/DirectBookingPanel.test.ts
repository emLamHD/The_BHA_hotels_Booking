import React from "react";
import { describe, expect, it, vi } from "vitest";
import { BookingHoldFlowState, bookingHoldFlowReducer, initialBookingHoldFlowState } from "@/lib/api/bookingHoldFlow";
import type { SelectedOfferSnapshot } from "@/lib/api/bookingHoldAttempt";
import { TEST_QUOTE } from "@/lib/api/quoteTestkit";
import { loadPack, renderWithI18n } from "@/lib/i18n/testkit";
import { shouldRedirectToReceipt } from "../HoldReceiptRedirector";
import type { CustomerSessionState } from "@/lib/customerSession";

const mocked = vi.hoisted(() => ({ state: null as unknown, session: null as unknown }));
vi.mock("@/app/BookingHoldProvider", () => ({
  useBookingHoldFlow: () => ({ state: mocked.state, updateContact: () => undefined, submitDirect: () => undefined, retryDirectExact: () => undefined, acceptPriceChange: () => undefined }),
}));
vi.mock("@/app/CustomerSessionProvider", () => ({ useCustomerSession: () => ({ state: mocked.session, refreshSession: () => undefined }) }));

import DirectBookingPanel from "../DirectBookingPanel";

const OFFER: SelectedOfferSnapshot = {
  propertyId: "10000000-0000-0000-0000-000000000001", roomTypeId: "30000000-0000-0000-0000-000000000001", ratePlanId: "60000000-0000-0000-0000-000000000001",
  checkIn: "2026-08-01", checkOut: "2026-08-03", adults: 2, children: 0, rooms: 1, quote: TEST_QUOTE,
};
const selected = (): BookingHoldFlowState => bookingHoldFlowReducer(initialBookingHoldFlowState, { type: "offer-selected", offer: OFFER, label: "Offer label", direct: { ownerKey: "guest" } });
const AUTH: CustomerSessionState = { status: "authenticated", customer: { customerAccountId: "aaaaaaaa-0000-0000-0000-000000000001", email: "acc@example.com" } };
const ANON: CustomerSessionState = { status: "anonymous", customer: null };

const render = (state: BookingHoldFlowState, session: CustomerSessionState, locale: string) => {
  mocked.state = state;
  mocked.session = session;
  return renderWithI18n(React.createElement(DirectBookingPanel), locale);
};
const RAW_KEY = /\b(customer|shared)\.(direct|receipt|booking|apiError)\.[A-Za-z.-]+/;

describe("DirectBookingPanel", () => {
  it.each(["vi", "en", "fr"])("shows no raw key in %s, in every state it can be in", (locale) => {
    const uncertain: BookingHoldFlowState = {
      ...selected(), phase: "uncertain", errorMessage: null,
      direct: { ...selected().direct, unresolved: true, retryErrorMessage: "shared.apiError.reservation.idempotency-conflict", attempt: { request: {} as never, idempotencyKey: "k", owner: { kind: "guest", guestAccessToken: "t" } } },
    };
    const known = (code: string): BookingHoldFlowState => ({ ...selected(), phase: "known-error", errorMessage: code });
    const states: BookingHoldFlowState[] = [
      selected(), uncertain, { ...selected(), phase: "submitting" },
      known("shared.apiError.checkout.direct-unavailable"), known("shared.apiError.booking.closed"), known("shared.apiError.hold.rooms-unavailable"), known("shared.apiError.auth.rate-limited"),
      known("shared.apiError.directGeneric"), known("customer.direct.ownerChanged"), known("customer.direct.identityUnverified"), known("customer.direct.credentialUnavailable"),
      known("customer.direct.sessionMismatchRetry"), known("customer.direct.unresolved.blocked"), known("shared.apiError.reservation.pricing-out-of-range"),
      known("shared.apiError.reservation.amount-unsupported"), known("shared.apiError.reservation.offer-not-bookable"),
      { ...known("x"), errorMessage: null, priceChange: { ...TEST_QUOTE, totalAmount: 3300000 } },
      { ...selected(), phase: "known-error", errorMessage: null, fieldErrors: { fullName: "customer.validation.fullNameRequired", email: "customer.validation.emailInvalid", phone: "customer.validation.phoneInvalid" } },
    ];
    for (const state of states) {
      for (const session of [AUTH, ANON, { status: "loading", customer: null } as CustomerSessionState]) {
        const html = render(state, session, locale);
        expect(html).not.toMatch(RAW_KEY);
      }
    }
  });

  it("states the pay-at-property total, the booking identity and an accessible form (vi)", () => {
    const html = render(selected(), AUTH, "vi");
    expect(html).toContain("Xác nhận đặt phòng — thanh toán khi nhận phòng");
    expect(html).toContain("acc@example.com");
    expect(html).toMatch(/3\.000\.000/);
    expect(html).toContain('for="direct-full-name"');
    expect(html).toContain('type="submit"');
    expect(render(selected(), ANON, "vi")).toContain("với tư cách khách");
  });

  it("an unknown/loading session shows the verifying state, never a guest line", () => {
    const html = render(selected(), { status: "unknown", customer: null }, "en");
    expect(html).toContain("Checking your sign-in");
    expect(html).not.toContain("booking as a guest");
  });

  it("an uncertain attempt offers only the exact resend and shows a rejected retry beside it", () => {
    const state: BookingHoldFlowState = {
      ...selected(), phase: "uncertain",
      direct: { ...selected().direct, unresolved: true, retryErrorMessage: "shared.apiError.auth.rate-limited", attempt: { request: {} as never, idempotencyKey: "k", owner: { kind: "guest", guestAccessToken: "t" } } },
    };
    const html = render(state, ANON, "en");
    expect(html).toContain("Send the same request again");
    expect(html).toContain("still unconfirmed");
    expect(html).toContain("Too many attempts");
    expect(html).not.toContain('type="submit"');
  });
});

describe("receipt redirect", () => {
  it("a Direct booking goes from submitting to its receipt; nothing else does", () => {
    expect(shouldRedirectToReceipt("submitting", "reservation-result", false, true)).toBe(true);
    expect(shouldRedirectToReceipt("confirming", "reservation-result", false, true)).toBe(false);
    expect(shouldRedirectToReceipt("submitting", "reservation-result", false, false)).toBe(false);
  });
});

describe("language packs carry every Direct text with the same placeholders", () => {
  const KEYS = Object.keys(loadPack("vi")).filter((key) => key.startsWith("customer.direct.") || /^customer\.receipt\.(collected|balanceDue|owner\.|paymentMethod\.|recovery\.unresolved|sub\.direct|sub\.cancelled|title\.cancelled)/.test(key) || /^shared\.apiError\.(directGeneric|checkout\.|booking\.closed|reservation\.(?!not-))/.test(key));
  const placeholders = (text: string) => Array.from(text.matchAll(/\{(\w+)[,}]/g)).map((m) => m[1]).sort();
  it("has the expected number of keys", () => expect(KEYS.length).toBe(44));
  it.each(KEYS)("%s in vi/en/fr", (key) => {
    const [vi, en, fr] = ["vi", "en", "fr"].map((l) => loadPack(l)[key]);
    for (const text of [vi, en, fr]) expect(text && text.length).toBeGreaterThan(0);
    expect(placeholders(en)).toEqual(placeholders(vi));
    expect(placeholders(fr)).toEqual(placeholders(vi));
  });
});
