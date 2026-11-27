import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ManagedReservation } from "@/lib/api/reservationManagementService";
import { loadPack, renderWithI18n } from "@/lib/i18n/testkit";
import type { SaveState } from "@/lib/reservationManagement";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/CustomerSessionProvider", () => ({ useCustomerSession: () => ({ state: { status: "anonymous" }, refreshSession: vi.fn() }) }));
import { Details } from "../app/reservations/[reservationId]/manage/ManageReservation";

// BHA-CHECKOUT-001-PR09-C2: what the arrival form shows and locks for each save state.
const RES: ManagedReservation = {
  reservationId: "0b8f6c1e-5f3a-4b0e-9a57-0c2f6f6a1d11", confirmationNumber: "BHA-TEST-0001", status: "Confirmed", propertyId: "00000000-0000-0000-0000-000000000001",
  checkIn: "2026-12-10", checkOut: "2026-12-12", adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 2000000, confirmedAtUtc: "2026-11-25T03:00:00Z",
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", collectedAmount: 0, balanceDueAmount: 2000000, propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};
const REFUSAL = "shared.apiError.reservation.arrival-not-changeable";
const render = (save: SaveState, locale = "en") =>
  renderWithI18n(React.createElement(Details, { reservation: RES, save, onSubmit: () => {}, onCheckAgain: () => {} }), locale);
const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** The three arrival controls (date, time, submit) that are disabled. */
const disabledControls = (html: string) => (/<form[\s\S]*<\/form>/.exec(html)?.[0].match(/<(?:select|input|button)\b[^>]*\sdisabled=""/g) ?? []).length;

describe("the arrival form for each save state (PR09-C2)", () => {
  it("is open when idle or after a refusal that a read has shown to be editable", () => {
    expect(disabledControls(render({ status: "idle" }))).toBe(0);
    expect(disabledControls(render({ status: "error", messageKey: REFUSAL }))).toBe(0);
  });

  it("the 'not sent' error (CSRF token unavailable) leaves the form open and says nothing was sent, in vi / en / fr (PR09-C3)", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const text = decode(loadPack(locale)["customer.manage.eta.error.notSent"]);
      const html = render({ status: "error", messageKey: "customer.manage.eta.error.notSent" }, locale);
      expect(disabledControls(html), locale).toBe(0);
      expect(decode(html), locale).toContain(text);
      expect(decode(html), locale).not.toContain(decode(loadPack(locale)["customer.manage.eta.unverified"]));
    }
  });

  it("is shut for every state in which an earlier request may still take effect or the booking may no longer be editable", () => {
    // date + time + submit are all disabled while a request or read is out
    for (const save of [
      { status: "saving" }, { status: "verifying" }, { status: "conflict", messageKey: REFUSAL, checking: true },
    ] as SaveState[]) expect(disabledControls(render(save)), JSON.stringify(save)).toBe(3);
    // date + time are disabled and there is no submit button at all: only "Check again" (a read) is offered
    for (const save of [{ status: "unverified" }, { status: "conflict", messageKey: REFUSAL, checking: false }] as SaveState[]) {
      const html = render(save);
      expect(disabledControls(html), JSON.stringify(save)).toBe(2);
      expect(html, JSON.stringify(save)).not.toContain('type="submit"');
    }
  });

  it("offers only 'Check again' (a read) once the outcome is not confirmed or the read after a refusal failed; never during a read", () => {
    const pack = loadPack("en");
    const again = decode(pack["customer.manage.eta.checkAgain"]);
    const save = decode(pack["customer.manage.eta.save"]);
    for (const state of [{ status: "unverified" }, { status: "conflict", messageKey: REFUSAL, checking: false }] as SaveState[]) {
      const html = decode(render(state));
      expect(html, JSON.stringify(state)).toContain(again);
      expect(html, JSON.stringify(state)).not.toContain(`>${save}<`);
    }
    for (const state of [{ status: "idle" }, { status: "conflict", messageKey: REFUSAL, checking: true }] as SaveState[]) expect(decode(render(state)), JSON.stringify(state)).not.toContain(again);
  });

  it("keeps showing the refusal while the read after a 409 is out or has failed", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const refusal = decode(loadPack(locale)[REFUSAL]);
      for (const checking of [true, false]) expect(decode(render({ status: "conflict", messageKey: REFUSAL, checking }, locale)), `${locale} ${checking}`).toContain(refusal);
    }
  });

  it("the not-confirmed text never says 'not saved' and says the request may still be applied (vi / en / fr)", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const pack = loadPack(locale);
      expect(pack["customer.manage.eta.notSaved"], locale).toBeUndefined();
      expect(decode(render({ status: "unverified" }, locale)), locale).toContain(decode(pack["customer.manage.eta.unverified"]));
    }
    expect(loadPack("en")["customer.manage.eta.unverified"]).toMatch(/may still be applied/);
    expect(loadPack("vi")["customer.manage.eta.unverified"]).toMatch(/vẫn đang được xử lý|vẫn có thể được áp dụng/);
    expect(loadPack("fr")["customer.manage.eta.unverified"]).toMatch(/peut encore être appliquée/);
  });
});
