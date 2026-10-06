import { describe, expect, it } from "vitest";
import type { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import { initialBookingHoldFlowState } from "@/lib/api/bookingHoldFlow";
import type { BookingHoldFlowState } from "@/lib/api/bookingHoldFlow";
import type { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import {
  buildRoomDetailsHref,
  filterOffersForRoomType,
  inProgressBookingTarget,
  parseRoomDetailsQuery,
  resolveProperty,
  resolveRoomType,
  withQueryParam,
} from "./roomDetailsRoute";

const P1 = "a1000000-0000-0000-0000-000000000001";
const P2 = "a1000000-0000-0000-0000-000000000002";
const R1 = "a3000000-0000-0000-0000-000000000001";
const R2 = "a3000000-0000-0000-0000-000000000002";

const reader = (search: string) => new URLSearchParams(search);

describe("buildRoomDetailsHref", () => {
  it("builds the existing details route with exactly the two catalog ids", () => {
    const href = buildRoomDetailsHref({ propertyId: P1, roomTypeId: R1 });
    expect(href).toBe(`/listing-stay-detail?propertyId=${P1}&roomTypeId=${R1}`);
  });

  it("builds a different URL for a different room type of the same property", () => {
    expect(buildRoomDetailsHref({ propertyId: P1, roomTypeId: R1 })).not.toBe(
      buildRoomDetailsHref({ propertyId: P1, roomTypeId: R2 })
    );
  });
});

describe("parseRoomDetailsQuery", () => {
  it("accepts one valid propertyId and one valid roomTypeId, in either case", () => {
    expect(parseRoomDetailsQuery(reader(`propertyId=${P1}&roomTypeId=${R1}`))).toEqual({
      kind: "ok",
      ids: { propertyId: P1, roomTypeId: R1 },
    });
    expect(parseRoomDetailsQuery(reader(`roomTypeId=${R1.toUpperCase()}&propertyId=${P1}`)).kind).toBe("ok");
  });

  it("keeps working when a modal parameter is added next to the identity", () => {
    expect(parseRoomDetailsQuery(reader(`propertyId=${P1}&roomTypeId=${R1}&modal=PHOTO_TOUR_SCROLLABLE&photoId=2`)).kind).toBe("ok");
  });

  it.each([
    ["", "missing"],
    ["modal=PHOTO_TOUR_SCROLLABLE", "missing"],
    [`propertyId=${P1}`, "invalid"],
    [`roomTypeId=${R1}`, "invalid"],
    [`propertyId=${P1}&roomTypeId=not-a-guid`, "invalid"],
    [`propertyId=${P1}&roomTypeId=`, "invalid"],
    [`propertyId=%27%3B--&roomTypeId=${R1}`, "invalid"],
    [`propertyId=${P1}&propertyId=${P2}&roomTypeId=${R1}`, "invalid"],
    [`propertyId=${P1}&roomTypeId=${R1}&roomTypeId=${R2}`, "invalid"],
    [`propertyId=${P1}x&roomTypeId=${R1}`, "invalid"],
  ])("rejects %j as %s", (search, kind) => {
    expect(parseRoomDetailsQuery(reader(search)).kind).toBe(kind);
  });

  it("treats a missing query object as missing", () => {
    expect(parseRoomDetailsQuery(null).kind).toBe("missing");
  });
});

const property = (id: string): PropertyDto => ({
  id,
  name: "P",
  slug: "p",
  description: null,
  address: null,
  city: null,
  country: null,
  timeZone: null,
  checkInTime: "14:00:00",
  checkOutTime: "12:00:00",
  amenities: [],
  media: [],
});
const roomType = (id: string, propertyId: string): RoomTypeDto => ({
  id,
  propertyId,
  code: "C",
  name: "N",
  slug: "n",
  description: null,
  baseOccupancy: 2,
  maxOccupancy: 2,
  amenities: [],
  media: [],
});

describe("resolveProperty / resolveRoomType", () => {
  it("finds the property and the room type that belongs to it", () => {
    expect(resolveProperty([property(P1), property(P2)], P2)?.id).toBe(P2);
    expect(resolveRoomType([roomType(R1, P1), roomType(R2, P1)], { propertyId: P1, roomTypeId: R2 })?.id).toBe(R2);
  });

  it("returns undefined for an unknown property or room type", () => {
    expect(resolveProperty([property(P1)], P2)).toBeUndefined();
    expect(resolveRoomType([roomType(R1, P1)], { propertyId: P1, roomTypeId: R2 })).toBeUndefined();
  });

  it("treats a room type that belongs to another property as a mismatch, not a match", () => {
    expect(resolveRoomType([roomType(R1, P2)], { propertyId: P1, roomTypeId: R1 })).toBeUndefined();
  });

  it("never falls back to the first room type", () => {
    expect(resolveRoomType([roomType(R1, P1)], { propertyId: P1, roomTypeId: R2 })).toBeUndefined();
  });
});

describe("filterOffersForRoomType", () => {
  const offer = (roomTypeId: string): AvailabilityOfferDto =>
    ({ roomTypeId, ratePlanId: "rp" } as AvailabilityOfferDto);

  it("keeps only offers of the viewed room type", () => {
    const offers = [offer(R1), offer(R2), offer(R1)];
    expect(filterOffersForRoomType(offers, R1)).toHaveLength(2);
    expect(filterOffersForRoomType(offers, R2)).toHaveLength(1);
  });

  it("returns nothing when the room type has no offer, never another room's offer", () => {
    expect(filterOffersForRoomType([offer(R2)], R1)).toEqual([]);
  });
});

describe("withQueryParam", () => {
  const base = `propertyId=${P1}&roomTypeId=${R1}`;

  it("adds the modal parameter without losing the room identity", () => {
    const next = withQueryParam(`?${base}`, "modal", "PHOTO_TOUR_SCROLLABLE");
    expect(parseRoomDetailsQuery(reader(next)).kind).toBe("ok");
    expect(next).toContain("modal=PHOTO_TOUR_SCROLLABLE");
  });

  it("removes only the named parameter", () => {
    const next = withQueryParam(`${base}&modal=PHOTO_TOUR_SCROLLABLE&photoId=3`, "modal", null);
    expect(next).toBe(`${base}&photoId=3`);
  });

  it("works on an empty query", () => {
    expect(withQueryParam("", "photoId", "1")).toBe("photoId=1");
  });
});

describe("inProgressBookingTarget", () => {
  const state = (patch: Partial<BookingHoldFlowState>): BookingHoldFlowState => ({
    ...initialBookingHoldFlowState,
    ...patch,
  });
  const hold = { propertyId: P1, roomTypeId: R1 } as never;

  it("is null while nothing is in progress (idle, selected, known error may be abandoned)", () => {
    expect(inProgressBookingTarget(initialBookingHoldFlowState)).toBeNull();
    expect(inProgressBookingTarget(state({ phase: "selected", offer: { propertyId: P1, roomTypeId: R1 } as never }))).toBeNull();
    expect(inProgressBookingTarget(state({ phase: "known-error", offer: { propertyId: P1, roomTypeId: R1 } as never }))).toBeNull();
  });

  it("points at the offer's room while a Hold is being created or its outcome is unknown", () => {
    for (const phase of ["submitting", "uncertain"] as const) {
      expect(inProgressBookingTarget(state({ phase, offer: { propertyId: P1, roomTypeId: R1 } as never }))).toEqual({
        propertyId: P1,
        roomTypeId: R1,
        phase,
      });
    }
  });

  it("points at the Hold's room once a session exists", () => {
    for (const phase of ["active-session", "confirming", "confirm-known-error", "confirm-uncertain"] as const) {
      expect(inProgressBookingTarget(state({ phase, session: { hold, guestAccessToken: "t", outcome: "created" } as never }))?.roomTypeId).toBe(R1);
    }
  });

  it("points at the Reservation's room after confirmation", () => {
    expect(
      inProgressBookingTarget(
        state({ phase: "reservation-result", reservationResult: { reservation: { propertyId: P2, roomTypeId: R2 }, outcome: "created" } as never })
      )
    ).toEqual({ propertyId: P2, roomTypeId: R2, phase: "reservation-result" });
  });

  it("is null when a locked phase carries no room (nothing to continue)", () => {
    expect(inProgressBookingTarget(state({ phase: "active-session" }))).toBeNull();
  });
});
