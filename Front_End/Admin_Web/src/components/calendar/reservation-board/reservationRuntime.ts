/**
 * Centralized runtime transition layer for the Reservation Board
 * (ADMIN-002.1-C6 §16) — replaces the scattered `useState`/direct-mutation
 * pattern from C1–C5 for anything that changes a reservation/block's
 * durable state (lifecycle, folio, notes, activity, room/date). All view-only
 * UI state (open item ID, active tab, drag preview, filters, feedback
 * banners) stays in `ReservationBoard.tsx`, not here.
 *
 * Every transition validates current state, returns a new immutable state,
 * rejects illegal transitions by returning the input state unchanged, and
 * appends activity only on success — a cancelled dialog or failed
 * validation never mutates state or appends activity (§2.4).
 *
 * Timestamps are a deterministic "demo clock" (minutes elapsed since
 * `DEMO_TODAY_ISO` 00:00), never `Date.now()` — this keeps every activity/
 * folio entry reproducible and hydration-safe, consistent with this
 * project's established "never derive from the runtime clock" rule for
 * calendar dates.
 */

import { compareIsoDate, diffDaysIso, formatDisplayDate, isoRangesOverlap } from "./dateMath";
import { DEMO_TODAY_ISO, MOCK_TIMELINE_ITEMS } from "./mockData";
import {
  DEMO_ACTOR,
  isInactiveLifecycleStatus,
  isTerminalLifecycleStatus,
  isValidFolioAmount,
  isValidOccupancyCount,
  isValidOptionalEmail,
  isValidReservationIsoDate,
  MAX_ADULTS_PER_UNIT,
  MAX_CHILDREN_PER_UNIT,
  parseActualNightlyAmount,
} from "./types";
import type {
  AssignedReservationItem,
  BookingSourceId,
  DerivedPaymentStatus,
  GuestNationality,
  IsoDate,
  OperationalBlockItem,
  PhysicalRoomId,
  PropertyId,
  ReservationActivityEntry,
  ReservationFolioEntry,
  ReservationFolioSummary,
  ReservationMoveIntent,
  ReservationPaymentMethod,
  ReservationTimelineItemBase,
  RoomTypeId,
  TimelineItem,
  UnassignedReservationItem,
} from "./types";

const CLOCK_STEP_MINUTES = 3;
const CLOCK_SEED_MINUTES = 9 * 60;

export interface ReservationRuntimeState {
  items: TimelineItem[];
  clockMinutes: number;
  nextSeq: number;
}

export function createInitialRuntimeState(): ReservationRuntimeState {
  return {
    items: MOCK_TIMELINE_ITEMS.map((item) => ({ ...item })),
    clockMinutes: CLOCK_SEED_MINUTES,
    nextSeq: 1,
  };
}

const AMOUNT_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

export function formatVnd(amount: number): string {
  return AMOUNT_FORMATTER.format(amount);
}

export const PAYMENT_METHOD_LABEL: Record<ReservationPaymentMethod, string> = {
  cash: "Cash",
  "bank-transfer": "Bank transfer",
  card: "Card",
  "ota-collect": "OTA collect",
};

function effectiveNightlyAmount(nightlyRate: number, actualNightlyAmount: string): number {
  const result = parseActualNightlyAmount(actualNightlyAmount);
  if (result.isValid && !result.isBlank && result.amount !== null) return result.amount;
  return nightlyRate;
}

/** Derives the folio summary/status from the item's own stay dates and its immutable ledger — never a stored field (§11.2). */
export function computeFolioSummary(
  item: AssignedReservationItem | UnassignedReservationItem
): ReservationFolioSummary {
  const nights = Math.max(diffDaysIso(item.startDate, item.endDate), 0);
  const nightlyAmount = effectiveNightlyAmount(item.nightlyRate, item.actualNightlyAmount);
  const roomCharge = nights * nightlyAmount;

  let extraCharges = 0;
  let collected = 0;
  for (const entry of item.folio) {
    switch (entry.kind) {
      case "extra-charge":
      case "adjustment":
      case "room-charge":
        extraCharges += entry.amount;
        break;
      case "deposit":
      case "payment":
        collected += entry.amount;
        break;
      case "refund":
        collected -= entry.amount;
        break;
    }
  }

  const totalCharges = roomCharge + extraCharges;
  const totalCollected = collected;
  const balanceDue = totalCharges - totalCollected;

  let status: DerivedPaymentStatus;
  if (balanceDue < 0) status = "overpaid";
  else if (totalCollected > 0 && balanceDue === 0) status = "paid";
  else if (totalCollected > 0 && balanceDue > 0) status = "partial";
  else status = "unpaid";

  return { totalCharges, totalCollected, balanceDue, status };
}

export const DERIVED_PAYMENT_STATUS_LABEL: Record<DerivedPaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Partially paid",
  paid: "Paid",
  overpaid: "Overpaid",
};

export interface ActionEligibility {
  allowed: boolean;
  reason?: string;
}

const ALLOWED: ActionEligibility = { allowed: true };

export function canConfirm(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks are never pending." };
  if (item.lifecycleStatus !== "pending") {
    return { allowed: false, reason: "Only a pending reservation can be confirmed." };
  }
  return ALLOWED;
}

export function canCheckIn(
  item: TimelineItem,
  propertyPhysicalRoomIds: ReadonlySet<PhysicalRoomId>
): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks cannot be checked in." };
  if (item.lifecycleStatus !== "confirmed") {
    return { allowed: false, reason: "Only a confirmed reservation can be checked in." };
  }
  if (item.kind !== "assigned-reservation") {
    return { allowed: false, reason: "Assign a physical room before checking in." };
  }
  if (!propertyPhysicalRoomIds.has(item.roomId)) {
    return { allowed: false, reason: "The assigned room does not belong to the selected property." };
  }
  if (compareIsoDate(item.startDate, DEMO_TODAY_ISO) > 0) {
    return { allowed: false, reason: "Scheduled check-in is after today. Correct the stay dates first." };
  }
  return ALLOWED;
}

export function canCheckOut(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks cannot be checked out." };
  if (item.lifecycleStatus !== "checked-in") {
    return { allowed: false, reason: "Only a checked-in reservation can be checked out." };
  }
  return ALLOWED;
}

export function canCancel(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks cannot be cancelled." };
  if (item.lifecycleStatus !== "pending" && item.lifecycleStatus !== "confirmed") {
    return { allowed: false, reason: "Only a pending or confirmed reservation can be cancelled." };
  }
  return ALLOWED;
}

export function canMarkNoShow(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks cannot be marked no-show." };
  if (item.lifecycleStatus !== "confirmed") {
    return { allowed: false, reason: "Only a confirmed reservation can be marked no-show." };
  }
  if (compareIsoDate(item.startDate, DEMO_TODAY_ISO) > 0) {
    return { allowed: false, reason: "No-show can only be recorded on or after the scheduled check-in date." };
  }
  return ALLOWED;
}

export function canEditGuest(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks have no guest information." };
  if (isTerminalLifecycleStatus(item.lifecycleStatus)) {
    return { allowed: false, reason: "This reservation is in a terminal status and its record is read-only." };
  }
  return ALLOWED;
}

export function canEditStay(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Use Edit block reason for operational blocks." };
  if (item.lifecycleStatus !== "pending" && item.lifecycleStatus !== "confirmed") {
    return { allowed: false, reason: "Stay details can only be edited while pending or confirmed." };
  }
  return ALLOWED;
}

export function canRecordPayment(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks have no folio." };
  if (item.lifecycleStatus === "cancelled" || item.lifecycleStatus === "no-show") {
    return { allowed: false, reason: "Cannot record a payment on a cancelled or no-show reservation." };
  }
  return ALLOWED;
}

export function canRecordRefund(item: TimelineItem, summary: ReservationFolioSummary): ActionEligibility {
  if (item.kind === "operational-block") return { allowed: false, reason: "Operational blocks have no folio." };
  if (summary.totalCollected <= 0) {
    return { allowed: false, reason: "No collected funds are available to refund." };
  }
  return ALLOWED;
}

export function canMove(item: TimelineItem): ActionEligibility {
  if (item.kind === "operational-block") {
    if (item.removed) return { allowed: false, reason: "This operational block has been removed." };
    return ALLOWED;
  }
  if (item.lifecycleStatus !== "pending" && item.lifecycleStatus !== "confirmed") {
    return {
      allowed: false,
      reason: `This reservation is ${item.lifecycleStatus.replace("-", " ")} and cannot be moved.`,
    };
  }
  return ALLOWED;
}

/**
 * Single shared conflict-detection primitive (§10.3, §13) — both the drag/
 * keyboard move path (`ReservationBoard.tsx`) and the Edit Stay panel call
 * this exact function so there is never a second, inconsistent conflict
 * implementation. Ignores cancelled/no-show reservations and removed
 * blocks, which never occupy inventory (§6.1).
 */
export function findBlockingItem(
  items: TimelineItem[],
  excludeItemId: string,
  propertyId: PropertyId,
  targetRoomId: PhysicalRoomId,
  targetStart: IsoDate,
  targetEnd: IsoDate
): AssignedReservationItem | OperationalBlockItem | null {
  for (const other of items) {
    if (other.id === excludeItemId) continue;
    if (other.propertyId !== propertyId) continue;
    if (other.kind === "unassigned-reservation") continue;
    if (other.kind === "operational-block" && other.removed) continue;
    if (other.kind === "assigned-reservation" && isInactiveLifecycleStatus(other.lifecycleStatus)) continue;
    if (other.roomId !== targetRoomId) continue;
    if (isoRangesOverlap(targetStart, targetEnd, other.startDate, other.endDate)) return other;
  }
  return null;
}

function commonReservationFields(
  item: AssignedReservationItem | UnassignedReservationItem
): ReservationTimelineItemBase {
  return {
    id: item.id,
    propertyId: item.propertyId,
    startDate: item.startDate,
    endDate: item.endDate,
    soldRoomTypeId: item.soldRoomTypeId,
    reservationCode: item.reservationCode,
    guestName: item.guestName,
    guestPhone: item.guestPhone,
    guestEmail: item.guestEmail,
    nationality: item.nationality,
    sourceId: item.sourceId,
    occupancy: item.occupancy,
    lifecycleStatus: item.lifecycleStatus,
    checkInTime: item.checkInTime,
    checkOutTime: item.checkOutTime,
    actualCheckInAt: item.actualCheckInAt,
    actualCheckOutAt: item.actualCheckOutAt,
    nightlyRate: item.nightlyRate,
    actualNightlyAmount: item.actualNightlyAmount,
    folio: item.folio,
    notes: item.notes,
    activity: item.activity,
  };
}

function withRoomAssignment(
  base: ReservationTimelineItemBase,
  physicalRoomId: PhysicalRoomId | ""
): AssignedReservationItem | UnassignedReservationItem {
  if (physicalRoomId) {
    return { ...base, kind: "assigned-reservation", roomId: physicalRoomId };
  }
  return { ...base, kind: "unassigned-reservation" };
}

type ReservationUpdater = (
  item: AssignedReservationItem | UnassignedReservationItem,
  clockMinutes: number,
  allocateId: (prefix: string) => string
) => AssignedReservationItem | UnassignedReservationItem | null;

function updateReservation(
  state: ReservationRuntimeState,
  itemId: string,
  updater: ReservationUpdater
): ReservationRuntimeState {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item || item.kind === "operational-block") return state;
  let seq = state.nextSeq;
  const clockMinutes = state.clockMinutes + CLOCK_STEP_MINUTES;
  const allocateId = (prefix: string) => `${itemId}-${prefix}-${seq++}`;
  const updated = updater(item, clockMinutes, allocateId);
  if (!updated) return state;
  return {
    clockMinutes,
    nextSeq: seq,
    items: state.items.map((candidate) => (candidate.id === itemId ? updated : candidate)),
  };
}

type BlockUpdater = (
  item: OperationalBlockItem,
  clockMinutes: number,
  allocateId: (prefix: string) => string
) => OperationalBlockItem | null;

function updateBlock(
  state: ReservationRuntimeState,
  blockId: string,
  updater: BlockUpdater
): ReservationRuntimeState {
  const item = state.items.find((candidate) => candidate.id === blockId);
  if (!item || item.kind !== "operational-block") return state;
  let seq = state.nextSeq;
  const clockMinutes = state.clockMinutes + CLOCK_STEP_MINUTES;
  const allocateId = (prefix: string) => `${blockId}-${prefix}-${seq++}`;
  const updated = updater(item, clockMinutes, allocateId);
  if (!updated) return state;
  return {
    clockMinutes,
    nextSeq: seq,
    items: state.items.map((candidate) => (candidate.id === blockId ? updated : candidate)),
  };
}

export interface EditGuestInput {
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  nationality: GuestNationality;
  adults: number;
  children: number;
}

export interface EditStayInput {
  sourceId: BookingSourceId;
  soldRoomTypeId: RoomTypeId;
  physicalRoomId: PhysicalRoomId | "";
  checkIn: IsoDate;
  checkOut: IsoDate;
  checkInTime: string;
  checkOutTime: string;
  actualNightlyAmount: string;
}

export interface RecordPaymentInput {
  entryType: "deposit" | "payment";
  amount: number;
  method: ReservationPaymentMethod;
  reference: string;
  note: string;
}

export interface RecordRefundInput {
  amount: number;
  method: ReservationPaymentMethod;
  reference: string;
  reason: string;
}

export type ReservationRuntimeAction =
  | { type: "CONFIRM_MOVE"; intent: ReservationMoveIntent }
  | { type: "CONFIRM_RESERVATION"; itemId: string }
  | { type: "CHECK_IN"; itemId: string; note: string; propertyPhysicalRoomIds: PhysicalRoomId[] }
  | { type: "CHECK_OUT"; itemId: string; note: string; overrideReason: string }
  | { type: "CANCEL_RESERVATION"; itemId: string; reason: string }
  | { type: "MARK_NO_SHOW"; itemId: string; reason: string; feeAmount: number | null }
  | { type: "EDIT_GUEST"; itemId: string; guest: EditGuestInput }
  | { type: "EDIT_STAY"; itemId: string; stay: EditStayInput }
  | { type: "RECORD_PAYMENT"; itemId: string; input: RecordPaymentInput }
  | { type: "RECORD_REFUND"; itemId: string; input: RecordRefundInput }
  | { type: "ADD_NOTE"; itemId: string; content: string }
  | { type: "REMOVE_BLOCK"; blockId: string; reason: string }
  | { type: "EDIT_BLOCK_REASON"; blockId: string; reason: string };

export function reservationRuntimeReducer(
  state: ReservationRuntimeState,
  action: ReservationRuntimeAction
): ReservationRuntimeState {
  switch (action.type) {
    case "CONFIRM_MOVE": {
      const intent = action.intent;
      if (intent.operation === "block-move") {
        return updateBlock(state, intent.blockId, (block, clockMinutes, id) => {
          if (!canMove(block).allowed) return null;
          return {
            ...block,
            roomId: intent.toRoomId,
            startDate: intent.toStartDate,
            endDate: intent.toEndDate,
            activity: [
              ...block.activity,
              {
                id: id("act"),
                type: "moved",
                description: `Moved to Room ${intent.toRoomCode}, ${formatDisplayDate(intent.toStartDate)} – ${formatDisplayDate(intent.toEndDate)}.`,
                actor: DEMO_ACTOR,
                clockMinutes,
              },
            ],
          };
        });
      }
      const itemId = intent.reservationId;
      return updateReservation(state, itemId, (item, clockMinutes, id) => {
        if (!canMove(item).allowed) return null;
        const base: ReservationTimelineItemBase = {
          ...commonReservationFields(item),
          startDate: intent.toStartDate,
          endDate: intent.toEndDate,
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "moved",
              description: `Moved to Room ${intent.toRoomCode}, ${formatDisplayDate(intent.toStartDate)} – ${formatDisplayDate(intent.toEndDate)}.`,
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ],
        };
        return withRoomAssignment(base, intent.toRoomId);
      });
    }

    case "CONFIRM_RESERVATION":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        if (!canConfirm(item).allowed) return null;
        return {
          ...item,
          lifecycleStatus: "confirmed",
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "confirmed",
              description: "Reservation confirmed.",
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ],
        };
      });

    case "CHECK_IN":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        const eligibility = canCheckIn(item, new Set(action.propertyPhysicalRoomIds));
        if (!eligibility.allowed) return null;
        const note = action.note.trim();
        return {
          ...item,
          lifecycleStatus: "checked-in",
          actualCheckInAt: clockMinutes,
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "checked-in",
              description: "Guest checked in.",
              actor: DEMO_ACTOR,
              clockMinutes,
              reason: note || undefined,
            },
          ],
        };
      });

    case "CHECK_OUT":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        if (!canCheckOut(item).allowed) return null;
        const summary = computeFolioSummary(item);
        const overrideReason = action.overrideReason.trim();
        if (summary.balanceDue > 0 && !overrideReason) return null;
        const note = action.note.trim();
        const descriptionParts = ["Guest checked out."];
        if (summary.balanceDue > 0) {
          descriptionParts.push(`Balance of ${formatVnd(summary.balanceDue)} due at checkout (override).`);
        }
        if (note) descriptionParts.push(note);
        return {
          ...item,
          lifecycleStatus: "checked-out",
          actualCheckOutAt: clockMinutes,
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "checked-out",
              description: descriptionParts.join(" "),
              actor: DEMO_ACTOR,
              clockMinutes,
              reason: overrideReason || undefined,
            },
          ],
        };
      });

    case "CANCEL_RESERVATION":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        if (!canCancel(item).allowed) return null;
        const reason = action.reason.trim();
        if (!reason) return null;
        return {
          ...item,
          lifecycleStatus: "cancelled",
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "cancelled",
              description: "Reservation cancelled.",
              actor: DEMO_ACTOR,
              clockMinutes,
              reason,
            },
          ],
        };
      });

    case "MARK_NO_SHOW":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        if (!canMarkNoShow(item).allowed) return null;
        const reason = action.reason.trim();
        if (!reason) return null;
        let folio = item.folio;
        let activity: ReservationActivityEntry[] = [
          ...item.activity,
          {
            id: id("act"),
            type: "no-show",
            description: "Reservation marked no-show.",
            actor: DEMO_ACTOR,
            clockMinutes,
            reason,
          },
        ];
        if (action.feeAmount !== null && action.feeAmount > 0) {
          if (!isValidFolioAmount(action.feeAmount)) return null;
          const feeEntry: ReservationFolioEntry = {
            id: id("folio"),
            kind: "extra-charge",
            amount: action.feeAmount,
            currency: "VND",
            note: "No-show fee",
            actor: DEMO_ACTOR,
            clockMinutes,
          };
          folio = [...folio, feeEntry];
          activity = [
            ...activity,
            {
              id: id("act"),
              type: "payment-recorded",
              description: `No-show fee of ${formatVnd(action.feeAmount)} recorded.`,
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ];
        }
        return { ...item, lifecycleStatus: "no-show", folio, activity };
      });

    case "EDIT_GUEST":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        if (!canEditGuest(item).allowed) return null;
        const { guestName, guestPhone, guestEmail, nationality, adults, children } = action.guest;
        const trimmedName = guestName.trim();
        const trimmedPhone = guestPhone.trim();
        if (!trimmedName || !trimmedPhone || trimmedPhone.length > 32) return null;
        if (!isValidOptionalEmail(guestEmail)) return null;
        if (!isValidOccupancyCount(adults, 1, MAX_ADULTS_PER_UNIT)) return null;
        if (!isValidOccupancyCount(children, 0, MAX_CHILDREN_PER_UNIT)) return null;

        const trimmedEmail = guestEmail.trim();
        const changed: string[] = [];
        if (trimmedName !== item.guestName) changed.push("name");
        if (trimmedPhone !== item.guestPhone) changed.push("phone");
        if (trimmedEmail !== item.guestEmail) changed.push("email");
        if (nationality.code !== item.nationality.code) changed.push("nationality");
        if (adults !== item.occupancy.adults || children !== item.occupancy.children) changed.push("occupancy");
        if (changed.length === 0) return null;

        return {
          ...item,
          guestName: trimmedName,
          guestPhone: trimmedPhone,
          guestEmail: trimmedEmail,
          nationality,
          occupancy: { adults, children },
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "guest-edited",
              description: `Guest information updated (${changed.join(", ")}).`,
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ],
        };
      });

    case "EDIT_STAY":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        if (!canEditStay(item).allowed) return null;
        const s = action.stay;
        if (!isValidReservationIsoDate(s.checkIn) || !isValidReservationIsoDate(s.checkOut)) return null;
        if (compareIsoDate(s.checkOut, s.checkIn) <= 0) return null;
        const priceResult = parseActualNightlyAmount(s.actualNightlyAmount);
        if (!priceResult.isValid) return null;
        if (s.physicalRoomId) {
          const blocking = findBlockingItem(
            state.items,
            item.id,
            item.propertyId,
            s.physicalRoomId,
            s.checkIn,
            s.checkOut
          );
          if (blocking) return null;
        }

        const soldRoomTypeChanged = s.soldRoomTypeId !== item.soldRoomTypeId;
        const finalActualNightlyAmount = soldRoomTypeChanged ? "" : s.actualNightlyAmount;
        const currentRoomId = item.kind === "assigned-reservation" ? item.roomId : "";

        const changed: string[] = [];
        if (s.sourceId !== item.sourceId) changed.push("source");
        if (soldRoomTypeChanged) changed.push("sold room type");
        if (s.physicalRoomId !== currentRoomId) changed.push("assigned room");
        if (s.checkIn !== item.startDate || s.checkOut !== item.endDate) changed.push("dates");
        if (s.checkInTime !== item.checkInTime || s.checkOutTime !== item.checkOutTime) changed.push("scheduled times");
        if (finalActualNightlyAmount !== item.actualNightlyAmount) changed.push("negotiated price");
        if (changed.length === 0) return null;

        const base: ReservationTimelineItemBase = {
          ...commonReservationFields(item),
          sourceId: s.sourceId,
          soldRoomTypeId: s.soldRoomTypeId,
          startDate: s.checkIn,
          endDate: s.checkOut,
          checkInTime: s.checkInTime,
          checkOutTime: s.checkOutTime,
          actualNightlyAmount: finalActualNightlyAmount,
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "stay-edited",
              description: `Stay details updated (${changed.join(", ")}).`,
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ],
        };
        return withRoomAssignment(base, s.physicalRoomId);
      });

    case "RECORD_PAYMENT":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        if (!canRecordPayment(item).allowed) return null;
        const { entryType, amount, method, reference, note } = action.input;
        if (!isValidFolioAmount(amount)) return null;
        const entry: ReservationFolioEntry = {
          id: id("folio"),
          kind: entryType,
          amount,
          currency: "VND",
          method,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          actor: DEMO_ACTOR,
          clockMinutes,
        };
        const label = entryType === "deposit" ? "Advance deposit" : "Payment";
        return {
          ...item,
          folio: [...item.folio, entry],
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "payment-recorded",
              description: `${label} of ${formatVnd(amount)} recorded (${PAYMENT_METHOD_LABEL[method]}).`,
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ],
        };
      });

    case "RECORD_REFUND":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        const summary = computeFolioSummary(item);
        if (!canRecordRefund(item, summary).allowed) return null;
        const { amount, method, reference, reason } = action.input;
        if (!isValidFolioAmount(amount)) return null;
        const trimmedReason = reason.trim();
        if (!trimmedReason) return null;
        const entry: ReservationFolioEntry = {
          id: id("folio"),
          kind: "refund",
          amount,
          currency: "VND",
          method,
          reference: reference.trim() || undefined,
          note: trimmedReason,
          actor: DEMO_ACTOR,
          clockMinutes,
        };
        return {
          ...item,
          folio: [...item.folio, entry],
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "refund-recorded",
              description: `Refund of ${formatVnd(amount)} recorded.`,
              actor: DEMO_ACTOR,
              clockMinutes,
              reason: trimmedReason,
            },
          ],
        };
      });

    case "ADD_NOTE":
      return updateReservation(state, action.itemId, (item, clockMinutes, id) => {
        const content = action.content.trim();
        if (!content) return null;
        return {
          ...item,
          notes: [...item.notes, { id: id("note"), content, actor: DEMO_ACTOR, clockMinutes }],
          activity: [
            ...item.activity,
            {
              id: id("act"),
              type: "note-added",
              description: "Internal note added.",
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ],
        };
      });

    case "REMOVE_BLOCK":
      return updateBlock(state, action.blockId, (block, clockMinutes, id) => {
        if (block.removed) return null;
        const reason = action.reason.trim();
        if (!reason) return null;
        return {
          ...block,
          removed: true,
          activity: [
            ...block.activity,
            {
              id: id("act"),
              type: "block-removed",
              description: "Operational block removed.",
              actor: DEMO_ACTOR,
              clockMinutes,
              reason,
            },
          ],
        };
      });

    case "EDIT_BLOCK_REASON":
      return updateBlock(state, action.blockId, (block, clockMinutes, id) => {
        if (block.removed) return null;
        const reason = action.reason.trim();
        if (!reason || reason === block.reason) return null;
        return {
          ...block,
          reason,
          activity: [
            ...block.activity,
            {
              id: id("act"),
              type: "block-edited",
              description: `Note/type updated to "${reason}".`,
              actor: DEMO_ACTOR,
              clockMinutes,
            },
          ],
        };
      });

    default:
      return state;
  }
}
