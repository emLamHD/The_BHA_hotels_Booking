import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ManagedReservation } from "@/lib/api/reservationManagementService";
import { renderWithI18n } from "@/lib/i18n/testkit";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/CustomerSessionProvider", () => ({ useCustomerSession: () => ({ state: { status: "anonymous" }, refreshSession: vi.fn() }) }));
import { Details } from "../app/reservations/[reservationId]/manage/ManageReservation";

// BHA-CHECKOUT-001-PR09-C1. PR06 returns balanceDueAmount from the folio, and the folio does not post anything when a booking is cancelled,
// so a cancelled booking can still carry its original positive balance. The page must not offer that as "still to pay".
const base: ManagedReservation = {
  reservationId: "0b8f6c1e-5f3a-4b0e-9a57-0c2f6f6a1d11",
  confirmationNumber: "BHA-TEST-0001",
  status: "Confirmed",
  propertyId: "00000000-0000-0000-0000-000000000001",
  checkIn: "2026-12-10",
  checkOut: "2026-12-12",
  adults: 2,
  children: 0,
  rooms: 1,
  currencyCode: "VND",
  totalAmount: 2000000,
  confirmedAtUtc: "2026-11-25T03:00:00Z",
  paymentMethod: "PayAtProperty",
  ledgerState: "Recorded",
  collectedAmount: 500000,
  balanceDueAmount: 1500000,
  propertyTimeZoneId: "Asia/Ho_Chi_Minh",
  estimatedArrival: null,
};

const render = (reservation: ManagedReservation, locale = "vi") =>
  renderWithI18n(React.createElement(Details, { reservation, save: { status: "idle" } as never, onSubmit: () => {}, onCheckAgain: () => {} }), locale);
const text = (html: string, id: string) => new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(html)?.[1];
// "₫" and the thousands separator vary in whitespace; compare digits only.
const digits = (value: string | undefined) => (value ?? "").replace(/\D/g, "");
const PAY_NOTE = "Bạn thanh toán tại cơ sở khi nhận phòng";

describe("the management page's money block (PR09-C1)", () => {
  it("Cancelled + Recorded with a positive balance: status, total and collected are shown; the balance line and the pay-at-property note are not", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const html = render({ ...base, status: "Cancelled" }, locale);
      expect(html, locale).toContain('role="status"'); // cancelled notice
      expect(digits(text(html, "manage-total")), locale).toBe("2000000");
      expect(digits(text(html, "manage-collected")), locale).toBe("500000");
      expect(html, locale).not.toContain('data-testid="manage-balance"');
      expect(html, locale).not.toContain('data-testid="manage-not-recorded"');
    }
    const vi = render({ ...base, status: "Cancelled" });
    expect(vi).toContain("Đã hủy");
    expect(vi).not.toContain("Còn phải thanh toán");
    expect(vi).not.toContain(PAY_NOTE);
  });

  it("Confirmed + Recorded shows the balance the API returned, and the pay-at-property note", () => {
    const html = render(base);
    expect(digits(text(html, "manage-balance"))).toBe("1500000");
    expect(digits(text(html, "manage-collected"))).toBe("500000");
    expect(html).toContain("Còn phải thanh toán");
    expect(html).toContain(PAY_NOTE);
    expect(digits(text(render({ ...base, collectedAmount: 2000000, balanceDueAmount: 0 }), "manage-balance"))).toBe("0");
  });

  it("NotRecorded says so and infers neither a collected nor a remaining amount (Confirmed and Cancelled)", () => {
    for (const status of ["Confirmed", "Cancelled"]) {
      const html = render({ ...base, status, ledgerState: "NotRecorded", collectedAmount: null, balanceDueAmount: null });
      expect(text(html, "manage-not-recorded"), status).toBe("Chưa ghi nhận thanh toán");
      expect(html, status).not.toContain('data-testid="manage-collected"');
      expect(html, status).not.toContain('data-testid="manage-balance"');
      expect(html, status).not.toContain("Còn phải thanh toán");
      expect(digits(text(html, "manage-total")), status).toBe("2000000");
    }
  });
});
