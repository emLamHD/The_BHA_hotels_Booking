import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ManagedReservation } from "@/lib/api/reservationManagementService";
import type { PropertyDto } from "@/lib/api/propertyTypes";
import { renderWithI18n } from "@/lib/i18n/testkit";

// BHA-CHECKOUT-001-PR09-C5 P2-4: the property block looks the booked property up in the whole public catalog the StaySearchProvider already loaded, never only in Riverside.
const property = (id: string, name: string, address: string, slug: string): PropertyDto => ({
  id, name, slug, description: null, address, city: null, country: null, timeZone: "Asia/Ho_Chi_Minh", checkInTime: "14:00:00", checkOutTime: "12:00:00", amenities: null, media: null,
});
const RIVERSIDE = property("00000000-0000-0000-0000-000000000001", "BHA Riverside Test", "1 River Road", "riverside");
const GARDEN = property("00000000-0000-0000-0000-0000000000AB", "BHA Garden Test", "9 Garden Lane", "garden");
let catalog: { riverside: PropertyDto | undefined; properties: PropertyDto[] } = { riverside: RIVERSIDE, properties: [RIVERSIDE, GARDEN] };

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/CustomerSessionProvider", () => ({ useCustomerSession: () => ({ state: { status: "anonymous" }, refreshSession: vi.fn() }) }));
vi.mock("@/components/StaySearchProvider", () => ({ useStaySearch: () => ({ ...catalog, ensureCatalog: vi.fn() }) }));
import { Details } from "../app/reservations/[reservationId]/manage/ManageReservation";

const base: ManagedReservation = {
  reservationId: "0b8f6c1e-5f3a-4b0e-9a57-0c2f6f6a1d11", confirmationNumber: "BHA-TEST-0001", status: "Confirmed", propertyId: RIVERSIDE.id,
  checkIn: "2026-12-10", checkOut: "2026-12-12", adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 2000000, confirmedAtUtc: "2026-11-25T03:00:00Z",
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", collectedAmount: 0, balanceDueAmount: 2000000, propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};
const render = (reservation: ManagedReservation) =>
  renderWithI18n(React.createElement(Details, { reservation, save: { status: "idle" } as never, onSubmit: () => {}, onCheckAgain: () => {} }), "en");

describe("the management page's property block (PR09-C5 P2-4)", () => {
  it("a booking at another property shows that property's name and address, even with Riverside first in the catalog", () => {
    const html = render({ ...base, propertyId: GARDEN.id });
    expect(html).toContain("BHA Garden Test");
    expect(html).toContain("9 Garden Lane");
    expect(html).not.toContain("BHA Riverside Test");
    expect(html).not.toContain("1 River Road");
  });

  it("the id is matched whatever its letter case (as everywhere else)", () => {
    const html = render({ ...base, propertyId: GARDEN.id.toLowerCase() });
    expect(html).toContain("BHA Garden Test");
  });

  it("a Riverside booking still shows Riverside", () => {
    const html = render(base);
    expect(html).toContain("BHA Riverside Test");
    expect(html).toContain("1 River Road");
    expect(html).not.toContain("BHA Garden Test");
  });

  it("a property that is not in the catalog (or a catalog that is not loaded) falls back to the plain name, with no address and no other property's details", () => {
    for (const unknown of [{ ...base, propertyId: "99999999-9999-9999-9999-999999999999" }]) {
      const html = render(unknown);
      expect(html).toContain("The BHA");
      expect(html).not.toContain("1 River Road");
      expect(html).not.toContain("9 Garden Lane");
    }
    catalog = { riverside: undefined, properties: [] };
    const html = render({ ...base, propertyId: GARDEN.id });
    expect(html).toContain("The BHA");
    expect(html).not.toContain("Garden Lane");
    catalog = { riverside: RIVERSIDE, properties: [RIVERSIDE, GARDEN] };
  });
});
