import type { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import type { BookingHoldFlowState } from "@/lib/api/bookingHoldFlow";
import type { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: identity of the room shown at /listing-stay-detail. The URL carries
 * only the two catalog ids; nothing about the guest (no contact, token, cookie) ever goes in it.
 */
export const ROOM_DETAILS_PATH = "/listing-stay-detail";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RoomIdentity {
  propertyId: string;
  roomTypeId: string;
}

export function isGuid(value: string | null | undefined): value is string {
  return !!value && GUID.test(value);
}

export function buildRoomDetailsHref(ids: RoomIdentity): string {
  const query = new URLSearchParams({ propertyId: ids.propertyId, roomTypeId: ids.roomTypeId });
  return `${ROOM_DETAILS_PATH}?${query.toString()}`;
}

export type ParsedRoomQuery =
  | { kind: "ok"; ids: RoomIdentity }
  | { kind: "missing" }
  | { kind: "invalid" };

interface QueryReader {
  getAll(name: string): string[];
}

/** Reads and validates the identity query. Absent, repeated or malformed values never reach the API. */
export function parseRoomDetailsQuery(query: QueryReader | null | undefined): ParsedRoomQuery {
  const propertyIds = query?.getAll("propertyId") ?? [];
  const roomTypeIds = query?.getAll("roomTypeId") ?? [];
  if (propertyIds.length === 0 && roomTypeIds.length === 0) return { kind: "missing" };
  if (propertyIds.length !== 1 || roomTypeIds.length !== 1) return { kind: "invalid" };
  const [propertyId] = propertyIds;
  const [roomTypeId] = roomTypeIds;
  if (!isGuid(propertyId) || !isGuid(roomTypeId)) return { kind: "invalid" };
  return { kind: "ok", ids: { propertyId, roomTypeId } };
}

export type RoomResolution =
  | { kind: "found"; property: PropertyDto; roomType: RoomTypeDto }
  | { kind: "unknown-property" };

export function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function resolveProperty(
  properties: readonly PropertyDto[],
  propertyId: string
): PropertyDto | undefined {
  return properties.find((property) => sameId(property.id, propertyId));
}

/**
 * The RoomType for the requested id, only when it belongs to the requested Property. A room type id
 * from another Property, or one the Property does not list, is a mismatch, never a default room.
 */
export function resolveRoomType(
  roomTypes: readonly RoomTypeDto[],
  ids: RoomIdentity
): RoomTypeDto | undefined {
  return roomTypes.find(
    (roomType) => sameId(roomType.id, ids.roomTypeId) && sameId(roomType.propertyId, ids.propertyId)
  );
}

/** Only the offers for the room being viewed: another room's offer is never shown as this room's. */
export function filterOffersForRoomType(
  offers: readonly AvailabilityOfferDto[],
  roomTypeId: string
): AvailabilityOfferDto[] {
  return offers.filter((offer) => sameId(offer.roomTypeId, roomTypeId));
}

/** Rebuilds a query string with one parameter set (or removed), keeping every other parameter. */
export function withQueryParam(search: string, name: string, value: string | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (value === null) params.delete(name);
  else params.set(name, value);
  return params.toString();
}

/** The phases in which a booking is in progress and must not be replaced by another room's search. */
const IN_PROGRESS_PHASES: ReadonlySet<BookingHoldFlowState["phase"]> = new Set<BookingHoldFlowState["phase"]>([
  "submitting",
  "uncertain",
  "active-session",
  "confirming",
  "confirm-known-error",
  "confirm-uncertain",
  "reservation-result",
]);

export interface BookingTarget extends RoomIdentity {
  phase: BookingHoldFlowState["phase"];
}

/**
 * The room the visitor's in-progress booking belongs to, read only from the app-level hold flow.
 * Null when nothing is in progress (idle, selected or a known error: those may be abandoned).
 */
export function inProgressBookingTarget(state: BookingHoldFlowState): BookingTarget | null {
  if (!IN_PROGRESS_PHASES.has(state.phase)) return null;
  const source =
    state.reservationResult?.reservation ?? state.session?.hold ?? state.offer ?? null;
  if (!source) return null;
  return { propertyId: source.propertyId, roomTypeId: source.roomTypeId, phase: state.phase };
}

/**
 * The room the app-level booking flow currently refers to, in any phase that carries one (a selected
 * offer, a Hold session or a Reservation). Used to decide whether a room's page may show the flow.
 */
export function bookingFlowRoomTypeId(state: BookingHoldFlowState): string | null {
  return (
    state.reservationResult?.reservation.roomTypeId ??
    state.session?.hold.roomTypeId ??
    state.offer?.roomTypeId ??
    null
  );
}

export interface BookingStatusCopy {
  /** Sentence shown where the visitor is told about the booking. */
  message: string;
  /** Label of the link/button that leads back to the room of that booking. */
  action: string;
  /** Short status for the mobile bar. */
  barText: string;
  barAction: string;
}

/** What to tell the visitor about a booking that is in progress or has just been confirmed. */
export function bookingStatusCopy(phase: BookingHoldFlowState["phase"]): BookingStatusCopy {
  if (phase === "reservation-result") {
    return {
      message: "Bạn vừa hoàn tất một đặt phòng.",
      action: "Xem xác nhận",
      barText: "Đặt phòng đã xác nhận",
      barAction: "Xem",
    };
  }
  return {
    message: "Bạn đang có một đặt phòng đang thực hiện.",
    action: "Tiếp tục đặt phòng",
    barText: "Đặt phòng đang thực hiện",
    barAction: "Tiếp tục",
  };
}
