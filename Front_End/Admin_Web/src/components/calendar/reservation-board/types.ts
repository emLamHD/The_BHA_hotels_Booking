/**
 * Typed view model for the PMS Reservation Board UI baseline (ADMIN-002.1).
 * All data consumed here is deterministic mock data — see mockData.ts.
 * This module intentionally owns no rendering and no mock data values.
 */

export type IsoDate = string; // YYYY-MM-DD, half-open range convention: start <= night < end

export type PropertyId = string;
export type RoomTypeId = string;
export type PhysicalRoomId = string;
export type BookingSourceId = "direct" | "booking_com" | "agoda";

export interface Property {
  id: PropertyId;
  name: string;
}

export interface RoomType {
  id: RoomTypeId;
  propertyId: PropertyId;
  name: string;
}

export interface PhysicalRoom {
  id: PhysicalRoomId;
  roomTypeId: RoomTypeId;
  code: string;
}

/** A compact, in-app text/brand mark for a booking source — never a third-party logo asset. */
export interface BookingSource {
  id: BookingSourceId;
  label: string;
  markLabel: string;
  markClassName: string;
}

/** Fictional guest nationality shown in the reservation hover card. */
export interface GuestNationality {
  code: string;
  label: string;
  flag: string;
}

/**
 * Explicit reservation lifecycle (ADMIN-002.1-C6, replacing the C5
 * `ReservationStayStatus`). Never derived from `DEMO_TODAY_ISO`/today's date
 * or from a mutable payment field — transitions happen only through the
 * explicit front-desk actions in `reservationRuntime.ts`, never by directly
 * assigning an arbitrary status.
 */
export type ReservationLifecycleStatus =
  | "pending"
  | "confirmed"
  | "checked-in"
  | "checked-out"
  | "cancelled"
  | "no-show";

/** Checked-out/cancelled/no-show reservations never transition again in C6. */
export function isTerminalLifecycleStatus(status: ReservationLifecycleStatus): boolean {
  return status === "checked-out" || status === "cancelled" || status === "no-show";
}

/** Cancelled/no-show reservations release inventory and surface only via the Inactive filter. */
export function isInactiveLifecycleStatus(status: ReservationLifecycleStatus): boolean {
  return status === "cancelled" || status === "no-show";
}

/**
 * Checked-in/checked-out/cancelled/no-show reservations (and a removed
 * operational block) can never be dragged or sent through the move dialog —
 * see §13. Pending/confirmed reservations and active blocks remain movable.
 */
export function isLifecycleLockedForMove(status: ReservationLifecycleStatus): boolean {
  return status !== "pending" && status !== "confirmed";
}

/** Legal next-action set per current status (§6) — never an arbitrary status picker. */
export type ReservationLifecycleAction = "confirm" | "check-in" | "check-out" | "cancel" | "no-show";

const PERMITTED_LIFECYCLE_ACTIONS: Record<ReservationLifecycleStatus, ReservationLifecycleAction[]> = {
  pending: ["confirm", "cancel"],
  confirmed: ["check-in", "no-show", "cancel"],
  "checked-in": ["check-out"],
  "checked-out": [],
  cancelled: [],
  "no-show": [],
};

export function permittedLifecycleActions(
  status: ReservationLifecycleStatus
): ReservationLifecycleAction[] {
  return PERMITTED_LIFECYCLE_ACTIONS[status];
}

/** Short display label — always paired with distinct chip styling, never color alone (§6.2). */
export const LIFECYCLE_STATUS_LABEL: Record<ReservationLifecycleStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  "checked-in": "Checked in",
  "checked-out": "Checked out",
  cancelled: "Cancelled",
  "no-show": "No-show",
};

/** Mock current front-desk identity — real actor identity requires authentication/backend integration. */
export const DEMO_ACTOR = "Demo Front Desk";

export type ReservationFolioEntryKind =
  | "room-charge"
  | "extra-charge"
  | "deposit"
  | "payment"
  | "refund"
  | "adjustment";

export type ReservationPaymentMethod = "cash" | "bank-transfer" | "card" | "ota-collect";

/**
 * One immutable folio ledger line (§11). Entries are never edited or deleted
 * in place — a correction is a new `refund`/`adjustment` entry, so the full
 * transaction history stays visible. `clockMinutes` is the deterministic
 * demo clock (see `reservationRuntime.ts`), never `Date.now()`.
 */
export interface ReservationFolioEntry {
  id: string;
  kind: ReservationFolioEntryKind;
  /** Always a positive integer VND amount; `kind` determines charge vs. collection. */
  amount: number;
  currency: "VND";
  method?: ReservationPaymentMethod;
  reference?: string;
  note?: string;
  actor: string;
  clockMinutes: number;
}

/** Presentation status derived from the folio balance (§11.2) — never stored as its own mutable field. */
export type DerivedPaymentStatus = "unpaid" | "partial" | "paid" | "overpaid";

export interface ReservationFolioSummary {
  totalCharges: number;
  totalCollected: number;
  balanceDue: number;
  status: DerivedPaymentStatus;
}

export interface ReservationNoteEntry {
  id: string;
  content: string;
  actor: string;
  clockMinutes: number;
}

export type ReservationActivityType =
  | "created"
  | "guest-edited"
  | "stay-edited"
  | "moved"
  | "confirmed"
  | "checked-in"
  | "checked-out"
  | "cancelled"
  | "no-show"
  | "payment-recorded"
  | "refund-recorded"
  | "note-added"
  | "block-removed"
  | "block-edited";

/** One immutable local audit entry (§2.4, §12.2) — never created for a cancelled dialog or failed validation. */
export interface ReservationActivityEntry {
  id: string;
  type: ReservationActivityType;
  description: string;
  actor: string;
  clockMinutes: number;
  reason?: string;
}

export interface ReservationOccupancy {
  adults: number;
  children: number;
}

/** Frontend-only safety bounds for per-unit occupancy counts (§4.1). */
export const MAX_ADULTS_PER_UNIT = 20;
export const MAX_CHILDREN_PER_UNIT = 20;

export function isValidOccupancyCount(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Optional email: blank passes; non-blank must be ≤256 chars and pass a reasonable format check (§4.2). */
export function isValidOptionalEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (trimmed.length > 256) return false;
  return EMAIL_PATTERN.test(trimmed);
}

/**
 * Realistic demo booking window and strict ISO date validation, owned here
 * so the front-desk Edit Stay panel and the create-reservation flow share
 * identical bounds. (create-reservation/types.ts owns its own historically
 * independent copy — see that file's header comment; this is the Board's.)
 */
export const MIN_RESERVATION_DATE: IsoDate = "2020-01-01";
export const MAX_RESERVATION_DATE: IsoDate = "2035-12-31";

const ISO_DATE_STRUCTURE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidReservationIsoDate(value: string): boolean {
  if (!ISO_DATE_STRUCTURE_PATTERN.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!roundTrips) return false;
  return value >= MIN_RESERVATION_DATE && value <= MAX_RESERVATION_DATE;
}

/** Frontend-only safety bounds for a negotiated actual nightly price or a folio entry amount. */
export const MIN_ACTUAL_NIGHTLY_AMOUNT = 0;
export const MAX_ACTUAL_NIGHTLY_AMOUNT = 1_000_000_000;
export const MAX_FOLIO_ENTRY_AMOUNT = 500_000_000;

export interface ActualNightlyAmountResult {
  /** True when the raw string is empty/whitespace-only — not itself invalid; `nightlyRate` applies. */
  isBlank: boolean;
  isValid: boolean;
  amount: number | null;
}

/** Accepts only blank or `^[0-9]+$` — no sign, decimal point, exponent notation, NaN, or Infinity. */
export function parseActualNightlyAmount(raw: string): ActualNightlyAmountResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { isBlank: true, isValid: true, amount: null };
  if (!/^[0-9]+$/.test(trimmed)) return { isBlank: false, isValid: false, amount: null };
  const amount = Number(trimmed);
  if (
    !Number.isSafeInteger(amount) ||
    amount < MIN_ACTUAL_NIGHTLY_AMOUNT ||
    amount > MAX_ACTUAL_NIGHTLY_AMOUNT
  ) {
    return { isBlank: false, isValid: false, amount: null };
  }
  return { isBlank: false, isValid: true, amount };
}

/** Accepts only a positive integer VND amount within the folio safety bound — same shape of rule as above. */
export function isValidFolioAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_FOLIO_ENTRY_AMOUNT;
}

interface TimelineItemBase {
  id: string;
  propertyId: PropertyId;
  startDate: IsoDate; // check-in, inclusive
  endDate: IsoDate; // check-out, exclusive grid line
}

/**
 * Fields shared by assigned and unassigned reservations. `soldRoomTypeId` is
 * the RoomType the guest booked and is preserved independently of whichever
 * PhysicalRoom the reservation is currently assigned to — it must never be
 * overwritten by a PhysicalRoom move. Exported so `reservationRuntime.ts`
 * can rebuild an item's common fields when its kind changes (unassigned ↔
 * assigned).
 */
export interface ReservationTimelineItemBase extends TimelineItemBase {
  soldRoomTypeId: RoomTypeId;
  /** Human-facing booking reference shown in the Reservation Details dialog. */
  reservationCode: string;
  guestName: string;
  guestPhone: string;
  /** "" = not entered; optional but must pass `isValidOptionalEmail` when non-blank. */
  guestEmail: string;
  nationality: GuestNationality;
  sourceId: BookingSourceId;
  occupancy: ReservationOccupancy;
  lifecycleStatus: ReservationLifecycleStatus;
  /** Scheduled property check-in/checkout times, e.g. "14:00" — display-only demo data. */
  checkInTime: string;
  checkOutTime: string;
  /** Demo-clock minute the guest was actually checked in/out (§2.2) — null until the action occurs, never derived from `startDate`/`endDate`. */
  actualCheckInAt: number | null;
  actualCheckOutAt: number | null;
  /** Reservation Board's own simple reference nightly rate — independent of the create-reservation feature's `RatePlan` mock data. */
  nightlyRate: number;
  /** Raw negotiated nightly price override, same semantics as the create-reservation flow: "" = use `nightlyRate`. */
  actualNightlyAmount: string;
  /** Immutable ledger — the source of truth for payment status; see `computeFolioSummary`. */
  folio: ReservationFolioEntry[];
  notes: ReservationNoteEntry[];
  activity: ReservationActivityEntry[];
}

export interface AssignedReservationItem extends ReservationTimelineItemBase {
  kind: "assigned-reservation";
  roomId: PhysicalRoomId;
}

export interface UnassignedReservationItem extends ReservationTimelineItemBase {
  kind: "unassigned-reservation";
}

export interface OperationalBlockItem extends TimelineItemBase {
  kind: "operational-block";
  roomId: PhysicalRoomId;
  reason: string;
  /** Soft-removed (§14) — retained with its activity record rather than erased. */
  removed: boolean;
  activity: ReservationActivityEntry[];
}

export type TimelineItem =
  | AssignedReservationItem
  | UnassignedReservationItem
  | OperationalBlockItem;

export type ReservationBoardRangeLength = 7 | 14 | 21 | 31;

export interface ReservationBoardFilters {
  showAssigned: boolean;
  showUnassigned: boolean;
  showOperationalBlocks: boolean;
  /** Reveals cancelled/no-show reservations as faded, non-draggable, audit-only bars (§6.1). Off by default. */
  showInactive: boolean;
}

/** A PhysicalRoom move/assignment destination choice, grouped by RoomType, for the confirmation dialog. */
export interface ReservationMoveTargetGroup {
  roomType: RoomType;
  rooms: PhysicalRoom[];
}

export type ReservationMoveOperation =
  | "assigned-move"
  | "unassigned-assign"
  | "block-move";

/**
 * A proposed PhysicalRoom + half-open date span for a timeline item, derived
 * from a drag gesture or the keyboard/date-input path. `targetEndDate` is
 * always `targetStartDate` shifted by the item's preserved duration — C3
 * never allows independent check-in/check-out resizing.
 */
export interface ReservationMoveTarget {
  targetRoomId: PhysicalRoomId;
  targetStartDate: IsoDate;
  targetEndDate: IsoDate;
}

interface ReservationMoveIntentBase {
  propertyId: PropertyId;
  toRoomId: PhysicalRoomId;
  toRoomCode: string;
  toRoomTypeId: RoomTypeId;
  toRoomTypeName: string;
  toStartDate: IsoDate;
  toEndDate: IsoDate;
  /** Preserved night count — identical for the from/to span; whole-bar moves never change duration. */
  durationNights: number;
}

/** Demo-only, in-memory description of a proposed PhysicalRoom/date move for an assigned reservation. */
export interface AssignedMoveIntent extends ReservationMoveIntentBase {
  operation: "assigned-move";
  reservationId: string;
  guestName: string;
  sourceId: BookingSourceId;
  sourceLabel: string;
  soldRoomTypeId: RoomTypeId;
  soldRoomTypeName: string;
  fromRoomId: PhysicalRoomId;
  fromRoomCode: string;
  fromRoomTypeId: RoomTypeId;
  fromRoomTypeName: string;
  fromStartDate: IsoDate;
  fromEndDate: IsoDate;
  crossesRoomType: boolean;
}

/** Demo-only, in-memory description of a proposed first-time PhysicalRoom/date assignment for an unassigned reservation. */
export interface UnassignedAssignIntent extends ReservationMoveIntentBase {
  operation: "unassigned-assign";
  reservationId: string;
  guestName: string;
  sourceId: BookingSourceId;
  sourceLabel: string;
  soldRoomTypeId: RoomTypeId;
  soldRoomTypeName: string;
  /** Original (pre-assignment) listing dates, shown alongside the proposed dates. */
  fromStartDate: IsoDate;
  fromEndDate: IsoDate;
  crossesRoomType: boolean;
}

/** Demo-only, in-memory description of a proposed PhysicalRoom/date move for an operational block. */
export interface BlockMoveIntent extends ReservationMoveIntentBase {
  operation: "block-move";
  blockId: string;
  reason: string;
  fromRoomId: PhysicalRoomId;
  fromRoomCode: string;
  fromRoomTypeId: RoomTypeId;
  fromRoomTypeName: string;
  fromStartDate: IsoDate;
  fromEndDate: IsoDate;
}

/** Never persisted — pending Owner confirmation in ReservationMoveConfirmDialog. See ADMIN-002.1-C1/C2/C3. */
export type ReservationMoveIntent =
  | AssignedMoveIntent
  | UnassignedAssignIntent
  | BlockMoveIntent;

/** A rejected move target and the accessible reason it was rejected. */
export interface ReservationMoveConflict {
  targetRoomId: PhysicalRoomId;
  message: string;
}

/**
 * Outcome of validating a proposed `ReservationMoveTarget` for a timeline
 * item. `no-op` means the proposal changes neither room nor dates from the
 * item's current state (unassigned items, having no current room, can never
 * be a no-op — any room selection is a genuine first-time assignment).
 */
export type ReservationMoveValidation =
  | { status: "valid" }
  | { status: "no-op" }
  | { status: "conflict"; conflict: ReservationMoveConflict };
