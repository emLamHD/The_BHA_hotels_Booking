import React from "react";
import { describe, expect, it, vi } from "vitest";
import { bookingHoldFlowReducer, initialBookingHoldFlowState, type BookingHoldFlowState } from "@/lib/api/bookingHoldFlow";
import type { SelectedOfferSnapshot } from "@/lib/api/bookingHoldAttempt";
import type { AppliedPromotionDto, AvailabilityOfferDto, PriceQuote } from "@/lib/api/availabilityTypes";
import { parsePriceQuote, quoteOfOffer } from "@/lib/api/availabilityTypes";
import type { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { quoteForRoomType } from "@/lib/roomQuote";
import { formatMoney } from "@/lib/i18n/display";
import { renderWithI18n } from "@/lib/i18n/testkit";
import { TEST_QUOTE } from "@/lib/api/quoteTestkit";
import PriceBreakdown from "../PriceBreakdown";
import RoomTypeStayCard from "../RoomTypeStayCard";
import AvailabilityOfferCard from "../AvailabilityOfferCard";

/** BHA-BOOKING-PROMOTIONS-001: how the guest sees a promotion's effect on a price — struck through only when something was really discounted. */
const money = (amount: number) => formatMoney(String(amount), "VND", 0, "en-US");
const render = (element: React.ReactElement) => renderWithI18n(element, "en", "VND");
/** A submit button with the disabled ATTRIBUTE (the class list also contains "disabled:" variants). */
const DISABLED_SUBMIT = /<button[^>]*\bdisabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*\bdisabled=""/;
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

const PROMO: AppliedPromotionDto = { id: "p1", slug: "giam-15", title: "Đặt sớm", kind: "Percent", value: 15, currencyCode: null };

const mockedFlow = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("@/app/BookingHoldProvider", () => ({
  useBookingHoldFlow: () => ({
    state: mockedFlow.state, updateContact: () => undefined, submit: () => undefined, retryExact: () => undefined, confirmHold: () => undefined,
    retryConfirmationExact: () => undefined, acceptPriceChange: () => undefined,
  }),
}));
import BookingHoldPanel from "../BookingHoldPanel";

describe("PriceBreakdown", () => {
  const rows = [
    { key: "2026-08-01", label: "1 Aug", amount: 1275000, listAmount: 1500000 },
    { key: "2026-08-02", label: "2 Aug", amount: 1275000, listAmount: 1500000 },
  ];

  it("strikes the list price and states the saving only when something was really discounted", () => {
    const markup = render(React.createElement(PriceBreakdown, {
      rows, totalAmount: 2550000, currencyCode: "VND", totalLabel: "Total",
      discount: { listTotal: 3000000, discountTotal: 450000, promotion: PROMO },
    }));

    expect(count(markup, "<del")).toBe(3);                                  // two nights + the list total
    expect(markup).toContain(money(1500000));
    expect(markup).toContain(money(3000000));
    expect(markup).toContain(money(2550000));
    expect(markup).toContain(`−${money(450000)}`);
    expect(markup).toContain("Original price");
    expect(markup).toContain("You save");
    expect(markup).toContain("15% off");
  });

  it("strikes nothing when the discount is zero, even if a list amount is present", () => {
    const markup = render(React.createElement(PriceBreakdown, {
      rows: rows.map((row) => ({ ...row, listAmount: row.amount })), totalAmount: 2550000, currencyCode: "VND", totalLabel: "Total",
      discount: { listTotal: 2550000, discountTotal: 0, promotion: null },
    }));

    expect(markup).not.toContain("<del");
    expect(markup).not.toContain("You save");
    expect(markup).not.toContain('data-testid="price-discount"');
  });

  it("is unchanged for a caller that knows nothing about promotions", () => {
    const markup = render(React.createElement(PriceBreakdown, { rows: [{ key: "a", label: "1 Aug", amount: 1500000 }], totalAmount: 1500000, currencyCode: "VND", totalLabel: "Total" }));

    expect(markup).not.toContain("<del");
    expect(markup).toContain(money(1500000));
  });
});

describe("quoteForRoomType", () => {
  const offer = (patch: Partial<AvailabilityOfferDto>): AvailabilityOfferDto => ({
    propertyId: "p", roomTypeId: "r1", roomTypeCode: "R1", roomTypeName: "R1", roomTypeDescription: null, media: [], ratePlanId: "rp", ratePlanCode: "STD", ratePlanName: "Standard",
    currencyCode: "VND", checkIn: "2026-08-01", checkOut: "2026-08-03", nights: 2, requestedRooms: 1, availableRooms: 1,
    nightlyRates: [{ stayDate: "2026-08-01", amount: 1275000, listAmount: 1500000, discountAmount: 225000 }, { stayDate: "2026-08-02", amount: 1275000, listAmount: 1500000, discountAmount: 225000 }],
    totalAmount: 2550000, listTotalAmount: 3000000, discountTotalAmount: 450000, appliedPromotion: PROMO, ...patch,
  });

  it("carries the list price, the nightly list price and the promotion of the cheapest offer", () => {
    const quote = quoteForRoomType([offer({})], "r1")!;

    expect(quote).toMatchObject({ totalAmount: 2550000, listTotalAmount: 3000000, uniformNightlyAmount: 1275000, uniformListNightlyAmount: 1500000, promotion: PROMO });
  });

  it("is plain for an offer from a server that sends no promotion fields", () => {
    const quote = quoteForRoomType([offer({ listTotalAmount: undefined, discountTotalAmount: undefined, appliedPromotion: undefined, nightlyRates: [{ stayDate: "2026-08-01", amount: 1500000 }], totalAmount: 1500000 })], "r1")!;

    expect(quote).toMatchObject({ listTotalAmount: 1500000, uniformListNightlyAmount: 1500000, promotion: null });
  });
});

describe("RoomTypeStayCard", () => {
  const property = { id: "p", name: "Riverside" } as PropertyDto;
  const room = { id: "r1", name: "Room", media: [] } as unknown as RoomTypeDto;
  const base = { totalAmount: 2550000, currencyCode: "VND", nights: 2, uniformNightlyAmount: 1275000, ratePlanName: "Std", listTotalAmount: 3000000, uniformListNightlyAmount: 1500000 };
  const card = (quote: object) =>
    render(React.createElement(RoomTypeStayCard, { property, roomType: room, href: "/x", price: { state: "quoted", quote: { ...base, promotion: PROMO, ...quote } as never } }));

  it("shows the struck list price, the final price and the promotion when the backend discounted", () => {
    const markup = card({});

    expect(markup).toContain('data-testid="list-price"');
    expect(markup).toContain(money(1500000));
    expect(markup).toContain(money(1275000));
    expect(markup).toContain('data-testid="promotion-badge"');
  });

  it("shows no strike and no badge when there is no promotion", () => {
    const markup = card({ promotion: null, listTotalAmount: 2550000, uniformListNightlyAmount: 1275000 });

    expect(markup).not.toContain('data-testid="list-price"');
    expect(markup).not.toContain('data-testid="promotion-badge"');
    expect(markup).toContain(money(1275000));
  });

  it("with no dates shows no price at all, never a discounted one", () => {
    const markup = render(React.createElement(RoomTypeStayCard, { property, roomType: room, href: "/x", price: { state: "none" } }));

    expect(markup).not.toContain("<del");
    expect(markup).not.toContain("promotion-badge");
    expect(markup).not.toMatch(/\d{1,3}(,\d{3})+/);
  });
});

describe("AvailabilityOfferCard", () => {
  it("breaks the price down with the saving, and the figures are the backend's", () => {
    const data = {
      propertyId: "p", roomTypeId: "r1", roomTypeCode: "R1", roomTypeName: "Room", roomTypeDescription: null, media: [], ratePlanId: "rp", ratePlanCode: "STD", ratePlanName: "Std",
      currencyCode: "VND", checkIn: "2026-08-01", checkOut: "2026-08-03", nights: 2, requestedRooms: 1, availableRooms: 1,
      nightlyRates: [{ stayDate: "2026-08-01", amount: 1275000, listAmount: 1500000, discountAmount: 225000 }, { stayDate: "2026-08-02", amount: 1275000, listAmount: 1500000, discountAmount: 225000 }],
      totalAmount: 2550000, listTotalAmount: 3000000, discountTotalAmount: 450000, appliedPromotion: PROMO,
    } as AvailabilityOfferDto;

    const markup = render(React.createElement(AvailabilityOfferCard, { data }));

    expect(markup).toContain('data-testid="price-discount"');
    expect(markup).toContain(money(2550000));
    expect(markup).toContain(`−${money(450000)}`);
  });
});

describe("quote helpers", () => {
  it("quoteOfOffer is the figure the guest was shown", () => {
    const quote = quoteOfOffer({ currencyCode: "VND", totalAmount: 2550000, listTotalAmount: 3000000, discountTotalAmount: 450000, nightlyRates: [], appliedPromotion: PROMO } as unknown as AvailabilityOfferDto);

    expect(quote).toEqual({ currencyCode: "VND", totalAmount: 2550000, listTotalAmount: 3000000, discountTotalAmount: 450000, nightlyRates: [], appliedPromotion: PROMO });
  });

  it("quoteOfOffer works for a server without promotion fields", () => {
    const quote = quoteOfOffer({ currencyCode: "VND", totalAmount: 1500000, nightlyRates: null } as unknown as AvailabilityOfferDto);

    expect(quote).toMatchObject({ listTotalAmount: 1500000, discountTotalAmount: 0, appliedPromotion: null, nightlyRates: [] });
  });

  it("parsePriceQuote accepts the server's quote and refuses anything that is not one", () => {
    const wire = { currencyCode: "VND", totalAmount: 2550000, listTotalAmount: 3000000, discountTotalAmount: 450000, nightlyRates: [{ stayDate: "2026-08-01", amount: 1275000 }], appliedPromotion: PROMO };

    expect(parsePriceQuote(wire)).toMatchObject({ totalAmount: 2550000, appliedPromotion: PROMO });
    for (const bad of [null, undefined, "x", {}, { ...wire, totalAmount: "2550000" }, { ...wire, nightlyRates: [{ stayDate: 5 }] }, { ...wire, currencyCode: 3 }]) {
      expect(parsePriceQuote(bad)).toBeNull();
    }
    expect(parsePriceQuote({ ...wire, appliedPromotion: { ...PROMO, kind: "Free" } })?.appliedPromotion).toBeNull();
  });
});

describe("BookingHoldPanel: the price the guest confirms, and a price that changed", () => {
  const NEW_QUOTE: PriceQuote = {
    currencyCode: "VND", totalAmount: 2550000, listTotalAmount: 3000000, discountTotalAmount: 450000,
    nightlyRates: [{ stayDate: "2026-08-01", amount: 1275000, listAmount: 1500000, discountAmount: 225000 }, { stayDate: "2026-08-02", amount: 1275000, listAmount: 1500000, discountAmount: 225000 }],
    appliedPromotion: PROMO,
  };
  const OFFER: SelectedOfferSnapshot = {
    propertyId: "p", roomTypeId: "r1", ratePlanId: "rp", checkIn: "2026-08-01", checkOut: "2026-08-03", adults: 2, children: 0, rooms: 1, quote: TEST_QUOTE,
  };
  const selected = (): BookingHoldFlowState =>
    bookingHoldFlowReducer(initialBookingHoldFlowState, { type: "offer-selected", offer: OFFER, label: "The offer" });
  const changed = (): BookingHoldFlowState => {
    let state = bookingHoldFlowReducer(selected(), { type: "submit-requested", attempt: { request: {} as never, idempotencyKey: "k" }, operationId: 1 });
    state = bookingHoldFlowReducer(state, { type: "price-changed", operationId: 1, quote: NEW_QUOTE });
    return state;
  };
  const panel = (state: BookingHoldFlowState) => {
    mockedFlow.state = state;
    return render(React.createElement(BookingHoldPanel));
  };

  it("shows the price being confirmed above the contact form", () => {
    const markup = panel(selected());

    expect(markup).toContain('data-testid="confirmed-price"');
    expect(markup).toContain("Price you are confirming");
    expect(markup).toContain(money(TEST_QUOTE.totalAmount));
    expect(markup).not.toContain('data-testid="price-changed"');
  });

  it("after a refusal for a changed price, shows the new price, asks to confirm it, and disables the hold button", () => {
    const markup = panel(changed());

    expect(markup).toContain('data-testid="price-changed"');
    expect(markup).toContain("The price has changed");
    expect(markup).toContain("no room has been held");
    expect(markup).toContain("Current price");
    expect(markup).toContain(money(2550000));                              // the new total
    expect(markup).toContain(money(TEST_QUOTE.totalAmount));               // the old one is still shown as what was confirmed
    expect(markup).toContain("Confirm the new price");
    expect(markup).toMatch(DISABLED_SUBMIT);
  });

  it("is an ordinary form again once the new price is accepted", () => {
    let state = bookingHoldFlowReducer(changed(), { type: "price-change-accepted" });
    const markup = panel(state);

    expect(markup).not.toContain('data-testid="price-changed"');
    expect(markup).toContain(money(2550000));                              // the confirmed price is now the new one
    expect(markup).not.toMatch(DISABLED_SUBMIT);
    state = bookingHoldFlowReducer(state, { type: "price-change-accepted" });
    expect(state.offer?.quote.totalAmount).toBe(2550000);
  });
});
