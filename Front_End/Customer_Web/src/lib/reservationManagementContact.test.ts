import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ManagedReservation } from "@/lib/api/reservationManagementService";
import { loadPack, renderWithI18n } from "@/lib/i18n/testkit";
import type { ContactChoice } from "@/lib/social/settings";
import type { ManageFailure } from "@/lib/reservationManagement";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/CustomerSessionProvider", () => ({ useCustomerSession: () => ({ state: { status: "anonymous" }, refreshSession: vi.fn() }) }));
import { Details, Problem } from "../app/reservations/[reservationId]/manage/ManageReservation";

// BHA-CHECKOUT-001-PR09-C6 P2-2. The details screen and the error screen offer the SAME support channel (the public Website Social Settings, Phone, then Zalo, then Messenger),
// never the template `/contact` page. Fixture destinations below are not real.
const RESERVATION: ManagedReservation = {
  reservationId: "0b8f6c1e-5f3a-4b0e-9a57-0c2f6f6a1d11", confirmationNumber: "BHA-TEST-0001", status: "Confirmed", propertyId: "00000000-0000-0000-0000-000000000001",
  checkIn: "2026-12-10", checkOut: "2026-12-12", adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 2000000, confirmedAtUtc: "2026-11-25T03:00:00Z",
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", collectedAmount: 0, balanceDueAmount: 2000000, propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};
const PHONE: ContactChoice = { status: "channel", kind: "phone", href: "tel:+84000000000" };
const ZALO: ContactChoice = { status: "channel", kind: "zalo", href: "https://zalo.me/0000000000" };
const MESSENGER: ContactChoice = { status: "channel", kind: "messenger", href: "https://m.me/example-page" };
const NONE: ContactChoice = { status: "none" };
const LOADING: ContactChoice = { status: "loading" };

const screens: Record<string, (contact: ContactChoice | undefined, locale: string) => string> = {
  details: (contact, locale) => renderWithI18n(React.createElement(Details, { reservation: RESERVATION, save: { status: "idle" } as never, onSubmit: () => {}, onCheckAgain: () => {}, contact }), locale),
  "error screen (no access to the booking)": (contact, locale) => renderWithI18n(React.createElement(Problem, { failure: "no-access" as ManageFailure, contact }), locale),
};
const anchor = (html: string, href: string) => new RegExp(`<a [^>]*href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(html)?.[0];
const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

describe.each(Object.keys(screens))("the support channel on the %s (PR09-C6)", (name) => {
  const render = screens[name];

  it("Phone: a tel: link in the same tab, labelled with the localized contact text; never /contact", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const html = render(PHONE, locale);
      const link = anchor(html, "tel:+84000000000");
      expect(link, locale).toBeDefined();
      expect(link, locale).not.toContain("target=");
      expect(decode(html), locale).toContain(`>${decode(loadPack(locale)["customer.manage.contact"])}</a>`);
      expect(html, locale).not.toContain('href="/contact"');
      expect(html, locale).not.toContain("manage-contact-unavailable");
    }
  });

  it("Zalo and Messenger: https links in a new tab that send no referrer", () => {
    for (const choice of [ZALO, MESSENGER]) {
      const link = anchor(render(choice, "en"), (choice as { href: string }).href);
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
      expect(render(choice, "en")).not.toContain('href="/contact"');
    }
  });

  it("no usable channel (disabled, missing or the settings could not be read): the localized notice, no button and no /contact", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const html = render(NONE, locale);
      expect(html, locale).toContain('data-testid="manage-contact-unavailable"');
      expect(decode(html), locale).toContain(decode(loadPack(locale)["customer.manage.contactUnavailable"]));
      expect(html, locale).not.toContain('href="/contact"');
      expect(html, locale).not.toContain(`>${decode(loadPack(locale)["customer.manage.contact"])}</a>`);
      expect(html, locale).not.toContain("tel:");
    }
  });

  it("while the settings are being read, and when the screen is given none: neither a button nor a notice", () => {
    for (const choice of [LOADING, undefined]) {
      const html = render(choice, "en");
      expect(html).not.toContain("manage-contact-unavailable");
      expect(html).not.toContain('href="/contact"');
      expect(html).not.toContain("tel:");
    }
  });

  it("carries nothing of the booking, the address or the link into the destination", () => {
    const html = render(PHONE, "en");
    expect(anchor(html, "tel:+84000000000")).not.toMatch(/BHA-TEST-0001|reservations|#/);
  });
});

describe("the three notice texts exist (PR09-C6)", () => {
  it("vi, en and fr each say that no contact channel is available, and none promises anything else", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const text = loadPack(locale)["customer.manage.contactUnavailable"];
      expect(text, locale).toBeTruthy();
      expect(text, locale).not.toMatch(/email|e-mail|mail|courriel/i);
    }
  });
});
