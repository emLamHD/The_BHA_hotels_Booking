"use client";

/**
 * PMS-CAL-001.1: the Admin Reservation Board, now backed by the real
 * Admin API (HTTPS, read-only) instead of `mockData.ts`/`reservationRuntime.ts`.
 * `mockData.ts`, `reservationRuntime.ts`, `ReservationTimeline.tsx`, and
 * `TimelineItemDetailsDialog.tsx` intentionally remain unused by this
 * component — they stay in the tree for tests and the next mutation slice
 * (FRONTEND INTEGRATION CONTRACT item 2 of the Master Execution Prompt),
 * but no longer drive what this component renders.
 *
 * PMS-CAL-001.2-CP03A: the first real write from this board. Clicking an
 * unassigned bar opens `ReservationAssignmentDialog` for that exact range; the
 * create call goes to the backend, and every outcome that may have changed
 * the schedule (success, conflict, unconfirmed) is followed by a re-read of
 * the authoritative board. Nothing is ever inserted into board state locally.
 *
 * PMS-CAL-001.2-CP03B: the dialog may also offer a controlled cross-RoomType
 * placement — a confirmed, reasoned request to a room of a different RoomType
 * than sold. This board treats it exactly like same-RoomType assignment for
 * every safety property (double-submit guard, authoritative reload,
 * board-key-scoped reconciliation, stale-bar locking): the only difference is
 * the extra `reason` field this component forwards to the API client when the
 * dialog reports a confirmed cross-RoomType submission.
 *
 * PMS-CAL-001.2-CP04C.6B: `ReservationMoveDialog` now mounts here with
 * `crossRoomTypeEnabled` live, offering the same controlled cross-RoomType
 * destination for a move that CP03B already offers for a new assignment.
 * `submitMove`'s own request wiring (`confirmCrossRoomType`, trimmed
 * `reason`, exact segment version, full `[startDate, endDate)`) does not
 * change here — it was already correct as of CP04C.6A, ahead of any live
 * caller enabling the choice that exercises it.
 *
 * PMS-CAL-001.2-CP04D-BOARD-WIRING: `ReservationUnassignDialog` now mounts
 * here too, reached from the popover's opt-in `onUnassignRoom` — the same
 * assigned bar → popover → dialog path as Move room. `submitUnassign` follows
 * `submitMove`'s own rules verbatim, built on the pure `unassignTarget.ts`/
 * `unassignSubmission.ts` helpers rather than re-deriving them inline.
 *
 * PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: three review corrections — the
 * dialog now carries its own `boardReloadStatus`/`uncertainResolution`
 * (parity with move, see `dialogUnassignReconciliationId`'s own comment),
 * the shared uncertain-write notice speaks unassign-correct wording, and
 * dismissing the unassign success notice by keyboard restores focus.
 *
 * PMS-CAL-001.3-CP03: the toolbar's Create operational block opens
 * `ReservationBlockCreateDialog` for the board on screen. A block has no
 * ReservationUnit, so its writes are tracked in their own list
 * (`blockCreateReconciliation.ts`) rather than forced into the assignment
 * reconciliation types — but under the same rules: one request, re-read the
 * authoritative board, never paint a result onto a board the operator has
 * left, and keep a lost-response room/night range locked until the server
 * shows the block. A pending re-read from either list holds every write on
 * that board.
 *
 * PMS-ADMIN-AUTH-001-CP06: `access` says how this board reaches the API. In
 * `LocalGate` (the default, and every existing caller) nothing changes. In
 * `Staff` mode the Properties are the signed-in Staff member's memberships
 * (the public catalog is never read), each control and each submit handler is
 * limited to what that membership's role allows (`calendarAccess.ts`), a `401`
 * ends the session — but only once no write of this board is still on the wire,
 * so every outcome and pending intent is settled first — and a `403` re-reads
 * `me` to update roles without resending anything. The unconfirmed-write
 * records in `uncertainWriteStorage.ts` are not tied to a Staff member, so a
 * sign-out, an expiry or another Staff member signing in never drops them.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReservationBoardToolbar from "./ReservationBoardToolbar";
import ReservationBoardServerTimeline, {
  type AssignedSegmentSelection,
  type BlockSelection,
  type StaySelection,
  type UnassignedRangeSelection,
} from "./ReservationBoardServerTimeline";
import ReservationBoardStayPopover from "./ReservationBoardStayPopover";
import ReservationAssignmentDialog, {
  type BoardReloadStatus,
  type CrossRoomTypeConfirmation,
} from "./ReservationAssignmentDialog";
import ReservationMoveDialog from "./ReservationMoveDialog";
import ReservationUnassignDialog from "./ReservationUnassignDialog";
import ReservationBlockCancelDialog, { describeBlockCancelOutcome } from "./ReservationBlockCancelDialog";
import ReservationBlockCreateDialog, {
  describeBlockCreateOutcome,
  type BlockCreateDialogTarget,
} from "./ReservationBlockCreateDialog";
import {
  boardCanEvaluateBlock,
  isBoardAwaitingBlockReconciliation,
  settleBlockReconciliations,
  type BlockCreateReconciliation,
  type BlockWriteTarget,
} from "./blockCreateReconciliation";
import { boardIdentityKey, buildAssignmentTarget, type AssignmentTarget } from "./assignmentTarget";
import { buildMoveTarget, type MoveTarget } from "./moveTarget";
import { buildBlockCancelTarget, type BlockCancelTarget } from "./blockCancelTarget";
import {
  beginPendingWrite,
  discardPendingWrite,
  endPendingWrite,
  isPageUnloading,
  markPageAlive,
  persistUncertainWrites,
  restoreUncertainWrites,
  retryPendingCleanup,
  tabStorage,
  uncertainWriteIdentity,
} from "./uncertainWriteStorage";
import { buildUnassignTarget, type UnassignTarget } from "./unassignTarget";
import { buildUnassignRequest, planUnassignReconciliation } from "./unassignSubmission";
import { describeAssignmentOutcome, describeMoveOutcome } from "./assignmentOutcome";
import {
  boardCanEvaluate,
  isBoardAwaitingReconciliation,
  isSegmentMoveUnresolved,
  isSegmentUnassignUnresolved,
  isRoomRangeUnresolved,
  isUnassignedRangeUnresolved,
  settleReconciliations,
  type Reconciliation,
  type ReconciliationTarget,
} from "./reconciliation";
import { AlertIcon, CloseLineIcon } from "@/icons";
import {
  ACCESS_CHECK_MESSAGE,
  LOCAL_GATE_ACCESS,
  SIGNING_OUT_MESSAGE,
  capabilitiesFor,
  describeBoardAccess,
  type BoardAccess,
} from "./calendarAccess";
import {
  buildVisibleRange,
  computeVisibleStartFromAnchor,
  addDaysIso,
  formatIsoDate,
  formatRangeLabel,
} from "./dateMath";
import type { IsoDate, ReservationBoardFilters, ReservationBoardRangeLength } from "./types";
import {
  cancelOperationalBlock,
  createOperationalBlock,
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
  unassignReservationAssignment,
  type ApiError,
  type AssignmentCreateOutcome,
  type MoveAssignmentOutcome,
  type OperationalBlockCancelOutcome,
  type OperationalBlockCreateOutcome,
  type UnassignAssignmentOutcome,
} from "@/lib/api/client";
import type {
  ApiProperty,
  CreateOperationalBlockRequest,
  ReservationBoardOperationalBlock,
  ReservationBoardResponse,
  ReservationBoardUnassignedRange,
} from "@/lib/api/types";

const INITIAL_RANGE_LENGTH: ReservationBoardRangeLength = 14;

/** PMS-CAL-001.3-CP03-C1: why a write was refused before sending (see `isRoomLocked`). */
const ROOM_LOCKED_MESSAGE =
  "An earlier request for this room on overlapping nights is still unconfirmed. Nothing was sent; check the board again before sending another.";

/**
 * PMS-CAL-001.5-CP02: what a notice restored after a reload must say. The page
 * that sent the request never learned its result; the board can show the
 * schedule as it is now, but not which request produced it.
 */
const RESTORED_EXPLANATION =
  "Its result was never confirmed. It may already have been saved: the board shows the schedule, not which request changed it.";

/**
 * PMS-CAL-001.5-CP03: the same, for a request the page sent but reloaded
 * before any answer arrived — it may not even have reached the server.
 */
const RESTORED_IN_FLIGHT_EXPLANATION =
  "The page was reloaded or left before the server answered. The request may never have reached the server, or may already have been saved: the board shows the schedule, not which request changed it.";

/**
 * PMS-CAL-001.5-CP03: a write is only sent after its intent is safely recorded
 * for this tab; if that record cannot be written, a reload during the request
 * could no longer show that the write may have happened, so it is not sent.
 */
const INTENT_NOT_RECORDED_MESSAGE =
  "Nothing was sent: this browser tab could not keep the safety record that protects this change if the page is reloaded before the server answers. Allow this site to store data for the session (for example, leave private browsing), then try again.";

/**
 * PMS-CAL-001.5-CP03-C3: shown while the records an earlier page left behind
 * could not be read. It says neither that an earlier request exists nor that it
 * does not — that is exactly what is not known.
 */
const STORAGE_UNVERIFIED_MESSAGE =
  "Nothing was sent: this browser tab could not read the safety records of earlier requests, so it cannot yet rule out that this change repeats one. Choose Check storage again on the board, or allow this site to store data for the session (for example, leave private browsing), then try again.";

/**
 * PMS-CAL-001.5-CP03: a write described exactly as it would be tracked if its
 * outcome were `unknown` — which is what an unanswered request is. Used only
 * to record the intent; the board's own entry is still built from the outcome.
 */
function asUnansweredEntry<T>(board: { boardKey: string; propertyId: string; boardFrom: string; boardTo: string }, target: T) {
  return {
    id: 0,
    key: board.boardKey,
    propertyId: board.propertyId,
    from: board.boardFrom,
    to: board.boardTo,
    afterSeq: 0,
    certainty: "uncertain" as const,
    status: "pending" as const,
    resolution: "unresolved" as const,
    target,
  };
}

/** PMS-CAL-001.4-CP01: a move dialog outlived the board it was opened from. */
const STALE_MOVE_DIALOG_MESSAGE =
  "The board changed after this move was opened. Nothing was sent; start the move again from the board on screen.";

/**
 * PMS-CAL-001.4-CP01-C2: the same, for a dialog whose last request did reach
 * the server and was rejected there. A request was sent, so "Nothing was sent"
 * would be false; what the rejection proves is that nothing was changed.
 */
const REJECTED_MOVE_THEN_BOARD_CHANGED_MESSAGE =
  "The server rejected the last move request, so nothing was changed. The board has changed; start the move again from the board on screen.";

/** PMS-ADMIN-AUTH-001-CP06: a write the signed-in Staff member's role does not allow here. */
const NOT_PERMITTED_MESSAGE =
  "Your role at this Property does not allow this change. Nothing was sent.";

/** CP06: a cross-RoomType confirmation by a role without that permission. */
const CROSS_ROOM_TYPE_NOT_PERMITTED_MESSAGE =
  "Placing a guest in a different room type needs a Manager at this Property. Nothing was sent.";

/** CP06: a board read the server refused with 403. */
const ACCESS_DENIED_MESSAGE =
  "The server refused access to this Property's board for your Staff session. Your access is being checked again.";

/** PMS-CAL-001.3-CP03-C2: a block dialog outlived the board it was opened from. */
const STALE_BLOCK_DIALOG_MESSAGE =
  "The board changed after this dialog was opened. Nothing was sent; open Create operational block again from the board on screen.";

type PropertiesState =
  | { status: "loading" }
  | { status: "loaded"; properties: ApiProperty[] }
  | { status: "error"; error: ApiError };

type BoardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; board: ReservationBoardResponse; refreshing?: boolean }
  | { status: "error"; error: ApiError };

/**
 * Client-side "today" in an IANA zone, used only to pick the very first
 * visible range — see dateMath.ts header comment for why this module never
 * otherwise uses browser-local dates.
 *
 * PMS-CAL-001.1 correction C3: reads year/month/day from
 * `formatToParts()` rather than trusting `.format()`'s string shape.
 * `Intl.DateTimeFormat(...).format()` is not contractually guaranteed to
 * return `YYYY-MM-DD` for any given locale/ICU build — even "en-CA", which
 * conventionally does, is an implementation detail some environments don't
 * honor (e.g. returning `M/D/YYYY` instead). An unchecked mismatch here
 * would feed a malformed date straight into ISO date arithmetic. `calendar:
 * "gregory"`/`numberingSystem: "latn"` additionally rule out a
 * locale/environment defaulting to a non-Gregorian calendar or non-Latin
 * digits. `now` is an injectable parameter (default `new Date()`) purely
 * for deterministic unit testing.
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): IsoDate {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      throw new Error("Intl.DateTimeFormat did not return numeric year/month/day parts.");
    }
    return formatIsoDate(year, month, day);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const ReservationBoard: React.FC<{ access?: BoardAccess }> = ({ access = LOCAL_GATE_ACCESS }) => {
  const staffMode = access.mode === "Staff";
  /** CP06: the live access, read by async continuations at the moment they resume. */
  const accessRef = useRef(access);
  useEffect(() => {
    accessRef.current = access;
  }, [access]);
  /**
   * CP06-C3: a re-read of `me` after a denial is under way, or could not answer:
   * no new write may start (the ref for send-time checks, the state for
   * rendering). Only the latest check that found the session reopens writes, in
   * this effect — after the render carrying the re-read roles, which the effect
   * above has already handed to `accessRef`.
   */
  const accessCheckRunRef = useRef(0);
  const accessCheckPausedRef = useRef(false);
  const [accessCheckPaused, setAccessCheckPaused] = useState(false);
  const [accessCheckPassedRun, setAccessCheckPassedRun] = useState(0);
  useEffect(() => {
    if (accessCheckPassedRun !== 0 && accessCheckPassedRun === accessCheckRunRef.current) {
      accessCheckPausedRef.current = false;
    }
  }, [accessCheckPassedRun]);
  /** CP06-C3: the check could not answer while a write was on the wire; close access once none is. */
  const accessFailPendingRef = useRef(false);
  /** CP06: the session ended; nothing more is read or sent, and the board's data is gone. */
  const [sessionEnded, setSessionEnded] = useState(false);
  const sessionEndedRef = useRef(false);
  /** CP06: the session ended while a write was on the wire; hand over once none is. */
  const expirePendingRef = useRef(false);
  const [propertiesState, setPropertiesState] = useState<PropertiesState>({ status: "loading" });
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [rangeLength, setRangeLength] = useState<ReservationBoardRangeLength>(INITIAL_RANGE_LENGTH);
  const [anchorDate, setAnchorDate] = useState<IsoDate | null>(null);
  const [boardState, setBoardState] = useState<BoardState>({ status: "idle" });
  const [retryToken, setRetryToken] = useState(0);
  const [filters, setFilters] = useState<ReservationBoardFilters>({
    showAssigned: true,
    showUnassigned: true,
    showOperationalBlocks: true,
  });
  const [selection, setSelection] = useState<
    { kind: "stay"; value: StaySelection } | { kind: "block"; value: BlockSelection } | null
  >(null);

  const [assignmentTarget, setAssignmentTarget] = useState<AssignmentTarget | null>(null);
  /** The reconciliation started by the open dialog's last outcome, if any. */
  const [dialogReconciliationId, setDialogReconciliationId] = useState<number | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<{ text: string; reconciliationId: number } | null>(
    null
  );

  /** PMS-CAL-001.2-CP04C.5: same shape as the create-assignment state above, kept separate — a move and an assign are different dialogs and never share a lock. */
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [dialogMoveReconciliationId, setDialogMoveReconciliationId] = useState<number | null>(null);
  const [moveNotice, setMoveNotice] = useState<{ text: string; reconciliationId: number } | null>(null);
  const moveNoticeRef = useRef<HTMLDivElement>(null);
  const moveRequestPendingRef = useRef(false);
  /**
   * PMS-CAL-001.4-CP01: the room a drag-and-drop chose, handed to the move
   * dialog as a preselection only; `undefined` when the dialog was opened from
   * the popover's Move room action.
   */
  const [moveInitialRoomId, setMoveInitialRoomId] = useState<string | undefined>(undefined);
  /** The board identity a drag started on; a drop onto any other board is refused. */
  const dragSourceBoardKeyRef = useRef<string | null>(null);
  /**
   * PMS-CAL-001.4-CP01-C1: why a move dialog was closed without sending — it
   * outlived the board it was opened from. Shown on the board, because the
   * dialog is gone and the operator has to start again from what is on screen.
   * `focus` is true only when the closed dialog held focus (a Confirm); a
   * Property switch leaves focus on the control the operator just used.
   */
  const [moveRefusal, setMoveRefusal] = useState<{ text: string; focus: boolean } | null>(null);
  /**
   * PMS-CAL-001.4-CP01-C2: what the open move dialog has actually done — reset
   * whenever a move dialog opens. `moveRequestPendingRef` only says whether a
   * request is on the wire *now*; once its response arrives it is false again,
   * so it cannot tell a dialog that never sent from one whose request reached
   * the server. These two can.
   */
  const moveDialogSentRef = useRef(false);
  const moveDialogOutcomeRef = useRef<MoveAssignmentOutcome | null>(null);
  const moveRefusalRef = useRef<HTMLDivElement>(null);

  /**
   * PMS-CAL-001.2-CP04D-BOARD-WIRING: the unassign counterpart of the move
   * state above, kept just as separate — an unassign never shares a lock
   * with a move or a create, even for the very same segment.
   *
   * PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: `dialogUnassignReconciliationId`
   * mirrors `dialogMoveReconciliationId` exactly — a review finding on the
   * initial wiring noted this board reloaded the *currently displayed*
   * board on every unassign outcome but never told the still-open dialog
   * which reconciliation to report on, so a conflict/unknown result during a
   * Property/range switch could read as if the *originating* board had been
   * reloaded when it had not.
   */
  const [unassignTarget, setUnassignTarget] = useState<UnassignTarget | null>(null);
  const [dialogUnassignReconciliationId, setDialogUnassignReconciliationId] = useState<number | null>(null);
  const [unassignNotice, setUnassignNotice] = useState<{ text: string; reconciliationId: number } | null>(null);
  const unassignNoticeRef = useRef<HTMLDivElement>(null);
  const unassignRequestPendingRef = useRef(false);
  /**
   * PMS-CAL-001.2-CP04C.5-C2: the assigned-bar element that opened the
   * current stay popover, captured the moment it is selected — before the
   * popover (and, if the operator goes on to Move room, the move dialog)
   * ever mount. `ReservationMoveDialog` cannot reliably capture this itself:
   * opening it also unmounts the popover's own "Move room" button in the
   * same commit, so by the time the dialog's own mount effect would read
   * `document.activeElement`, the browser has already moved focus to
   * `document.body`. Capturing it here, one hop earlier, is the only point
   * where `document.activeElement` is still the real opener.
   */
  const assignedBarOpenerRef = useRef<HTMLElement | null>(null);
  /**
   * PMS-CAL-001.2-CP04C.5-C2: the board identity (`propertyId|from|to`)
   * currently on screen, mirrored into a ref so `submitMove`'s async
   * continuation can read the *live* value at the moment a response arrives
   * — not the value closed over when the request was sent. A move started
   * on one Property/range must never paint its success text onto whatever
   * Property/range the operator has since navigated to.
   */
  const currentBoardKeyRef = useRef<string | null>(null);
  /**
   * Rendered from state; decided from the ref. The ref is updated
   * synchronously the moment a write resolves, so a click that lands before
   * React has re-rendered the board is still refused.
   */
  /**
   * PMS-CAL-001.5-CP02: unconfirmed writes a previous page in this tab left
   * behind. Restored here, in the first render's state initializers, so their
   * locks are in the refs before the board can offer any write at all.
   */
  const [restoredWrites] = useState(() => {
    markPageAlive();
    return restoreUncertainWrites(tabStorage(), 1);
  });
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>(restoredWrites.assignments);
  const reconciliationsRef = useRef<Reconciliation[]>(restoredWrites.assignments);
  const nextReconciliationIdRef = useRef(1 + restoredWrites.assignments.length + restoredWrites.blocks.length);
  const referencedReconciliationIdsRef = useRef<{
    dialog: number | null;
    notice: number | null;
    moveDialog: number | null;
    moveNotice: number | null;
    unassignDialog: number | null;
    unassignNotice: number | null;
  }>({
    dialog: null,
    notice: null,
    moveDialog: null,
    moveNotice: null,
    unassignDialog: null,
    unassignNotice: null,
  });
  const noticeRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  /** PMS-CAL-001.3-CP03: operational-block create, tracked apart from assignment writes (see header). */
  const [blockTarget, setBlockTarget] = useState<BlockCreateDialogTarget | null>(null);
  const [dialogBlockReconciliationId, setDialogBlockReconciliationId] = useState<number | null>(null);
  const [blockNotice, setBlockNotice] = useState<{ text: string; reconciliationId: number } | null>(null);
  const blockNoticeRef = useRef<HTMLDivElement>(null);
  const blockRequestPendingRef = useRef(false);
  /**
   * PMS-CAL-001.3-CP03-C1: the open block dialog has sent a request whose
   * result it must report. Such a dialog is never closed by navigation, even
   * after the request is no longer pending.
   *
   * PMS-CAL-001.3-CP03-C2: cleared again when the result proves nothing was
   * written (`allowResubmit`: `not-sent`, `400`). That dialog then offers its
   * form again, which is correctable only on the board it was opened from —
   * so from then on navigation closes it like one that never sent.
   */
  const blockSubmittedRef = useRef(false);
  /** C2: the board closed a stale block dialog; restore focus if that dialog took it along. */
  const restoreFocusAfterStaleBlockDialogRef = useRef(false);
  /**
   * PMS-CAL-001.3-CP04: operational-block cancel. It shares the block
   * reconciliation list and therefore the cross-write-type room lock with
   * create — a lost cancel and a lost create both leave the same room's nights
   * unsettled — but keeps its own dialog, notice and pending flag, so neither
   * direction can present the other's result.
   */
  const [blockCancelTarget, setBlockCancelTarget] = useState<BlockCancelTarget | null>(null);
  const [dialogBlockCancelReconciliationId, setDialogBlockCancelReconciliationId] = useState<number | null>(null);
  const [blockCancelNotice, setBlockCancelNotice] = useState<{ text: string; reconciliationId: number } | null>(null);
  const blockCancelNoticeRef = useRef<HTMLDivElement>(null);
  const blockCancelRequestPendingRef = useRef(false);
  /** Set once a cancel request is sent: such a dialog stays open to report its own result. */
  const blockCancelSubmittedRef = useRef(false);
  const [blockReconciliations, setBlockReconciliations] = useState<BlockCreateReconciliation[]>(restoredWrites.blocks);
  const blockReconciliationsRef = useRef<BlockCreateReconciliation[]>(restoredWrites.blocks);
  const referencedBlockIdsRef = useRef<{
    dialog: number | null;
    notice: number | null;
    cancelDialog: number | null;
    cancelNotice: number | null;
  }>({
    dialog: null,
    notice: null,
    cancelDialog: null,
    cancelNotice: null,
  });

  const requestSeqRef = useRef(0);

  /**
   * PMS-CAL-001.5-CP03-C1: intents whose write this page now tracks in its
   * lists, but which stay in storage until the unconfirmed record replacing
   * them has been saved and read back (`persistTracked`). While storage
   * refuses that record, the intent is the tab's only record of the write.
   */
  const handOffTokensRef = useRef<Set<string>>(new Set(restoredWrites.pendingTokens));
  /** CP03-C1: intents of this page's writes still on the wire; their own answer decides them. */
  const inFlightTokensRef = useRef<Set<string>>(new Set());
  /** Something stored could not be read back: at mount, or when the page came back from the back/forward cache. */
  const [storageUnreadable, setStorageUnreadable] = useState(restoredWrites.unreadable);
  /**
   * PMS-CAL-001.5-CP03-C3: a read of the tab's records threw, so earlier writes
   * are not accounted for. While set, no write is sent and no record is
   * written over what could not be read. The ref is what decides (it changes
   * the moment a read succeeds); the state only draws the warning.
   */
  const storageIncompleteRef = useRef(restoredWrites.incomplete);
  const [storageIncomplete, setStorageIncomplete] = useState(restoredWrites.incomplete);
  const recoverStorageRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * CP06: a write is on the wire from the moment its intent is recorded until its
   * answer is in. CP06-C1: reported to the page synchronously — not from an
   * effect — so Sign out, clicked in the same tick, already sees it.
   */
  const reportWriteActivity = useCallback(() => {
    const current = accessRef.current;
    if (current.mode === "Staff") current.onWriteActivityChange?.(inFlightTokensRef.current.size > 0);
  }, []);

  const trackWrite = useCallback(
    (token: string) => {
      inFlightTokensRef.current.add(token);
      reportWriteActivity();
    },
    [reportWriteActivity]
  );

  const untrackWrite = useCallback(
    (token: string) => {
      inFlightTokensRef.current.delete(token);
      reportWriteActivity();
    },
    [reportWriteActivity]
  );

  /**
   * CP06-C1/C3: why no write may start right now — a sign-out waiting for the
   * server, or access being checked again after a denial — read live at the
   * moment a write would start; `null` when writes may start.
   */
  const writesPausedReason = useCallback((): "signing-out" | "checking-access" | null => {
    const current = accessRef.current;
    if (current.mode === "Staff" && current.isSigningOut?.() === true) return "signing-out";
    return accessCheckPausedRef.current ? "checking-access" : null;
  }, []);
  const writesPausedNow = useCallback(() => writesPausedReason() !== null, [writesPausedReason]);

  /** CP06: what the signed-in Staff member may do at one Property right now (LocalGate: everything, as before). */
  const capabilitiesAt = useCallback(
    (propertyId: string | null) => capabilitiesFor(accessRef.current, propertyId, sessionEndedRef.current, writesPausedNow()),
    [writesPausedNow]
  );

  /** CP06-C1/C3: why a write the board refused at send time was not sent. */
  const notPermittedMessage = useCallback(() => {
    const paused = writesPausedReason();
    return paused === "signing-out" ? SIGNING_OUT_MESSAGE : paused === "checking-access" ? ACCESS_CHECK_MESSAGE : NOT_PERMITTED_MESSAGE;
  }, [writesPausedReason]);

  /**
   * CP06: the server said the Staff session is no longer valid. The board's data
   * and every action on it close at once; the session itself is handed back to
   * the page only when no write of this board is waiting for the server, so each
   * outcome and pending intent is settled by its own handler first.
   */
  const expireSession = useCallback(() => {
    const current = accessRef.current;
    if (current.mode !== "Staff") return;
    if (!sessionEndedRef.current) {
      sessionEndedRef.current = true;
      setSessionEnded(true);
      setBoardState({ status: "idle" });
      setSelection(null);
    }
    expirePendingRef.current = true;
    if (inFlightTokensRef.current.size === 0) {
      expirePendingRef.current = false;
      current.onSessionExpired();
    }
  }, []);

  /**
   * CP06-C3: the re-read after a denial could not check access. The page closes
   * access (error with Retry) only once no write of this board is on the wire, so
   * each outcome and pending intent is settled by its own handler first.
   */
  const closeAccessAfterFailedCheck = useCallback(() => {
    const current = accessRef.current;
    if (current.mode !== "Staff") return;
    accessFailPendingRef.current = true;
    if (inFlightTokensRef.current.size === 0) {
      accessFailPendingRef.current = false;
      current.onAccessCheckFailed?.();
    }
  }, []);

  /**
   * CP06: after a 403, re-read `me` once. Never resends anything. CP06-C3: no new
   * write starts until the latest such check has answered; it reopens writes only
   * on `authenticated`. `unauthenticated` ends the session; an error — or a check
   * superseded with nothing newer to decide — closes access with Retry.
   */
  const refreshAfterDenial = useCallback(async () => {
    const current = accessRef.current;
    if (current.mode !== "Staff" || sessionEndedRef.current) return;
    const run = ++accessCheckRunRef.current;
    accessCheckPausedRef.current = true;
    setAccessCheckPaused(true);
    const result = await current.refreshAccess();
    if (run !== accessCheckRunRef.current) return; // a newer check decides
    if (result === "authenticated") {
      setAccessCheckPaused(false);
      setAccessCheckPassedRun(run);
    } else if (result === "unauthenticated") {
      expireSession();
    } else {
      closeAccessAfterFailedCheck();
    }
  }, [expireSession, closeAccessAfterFailedCheck]);

  /**
   * CP06: the last step of every submit handler on a live page, after its
   * outcome and intent are settled: a `401` ends the session, a `403` other than
   * the cross-RoomType confirmation re-reads `me`, and a session that ended
   * while this write was on the wire is handed over now if none is left.
   */
  const afterWrite = useCallback(
    (outcome: { kind: string; status?: number; category?: string }) => {
      const current = accessRef.current;
      if (current.mode !== "Staff") return;
      if (outcome.kind === "rejected" && outcome.status === 401) {
        expireSession();
        return;
      }
      if (
        outcome.kind === "rejected" &&
        outcome.status === 403 &&
        outcome.category !== "cross-room-type-confirmation-required"
      ) {
        void refreshAfterDenial();
      }
      if (expirePendingRef.current && inFlightTokensRef.current.size === 0) {
        expirePendingRef.current = false;
        current.onSessionExpired();
      }
      if (accessFailPendingRef.current && inFlightTokensRef.current.size === 0) {
        accessFailPendingRef.current = false;
        current.onAccessCheckFailed?.();
      }
    },
    [expireSession, refreshAfterDenial]
  );

  /**
   * CP03-C1: writes the tab's unconfirmed record from both lists and, only if
   * storage verifiably holds it, drops the intents handed over to it. A
   * refused write drops nothing; the next change of either list tries again.
   */
  const persistTracked = useCallback(() => {
    // CP03-C2: a deletion storage refused earlier is owed whatever happens to the record below.
    retryPendingCleanup(tabStorage());
    // C3: never write over a record that could not be read; its unread entries are not in these lists.
    if (storageIncompleteRef.current) return;
    if (!persistUncertainWrites(tabStorage(), reconciliationsRef.current, blockReconciliationsRef.current)) return;
    for (const token of [...handOffTokensRef.current]) {
      if (endPendingWrite(tabStorage(), token)) handOffTokensRef.current.delete(token);
    }
  }, []);

  // PMS-CAL-001.5-CP03: restored in-flight intents are now tracked entries of
  // this page. They are handed over to the unresolved record through
  // `persistTracked` — dropped only once that record is safely stored, and
  // never an intent a later write of this page has begun.
  useEffect(() => {
    if (handOffTokensRef.current.size > 0) persistTracked();
  }, [persistTracked]);

  /**
   * CP03-C1/C2: an unchanged list is still a moment to retry what storage
   * refused — a restoration that could not read (C3), a hand-over
   * (`persistTracked`) or the deletion of an intent whose outcome is known
   * (`retryPendingCleanup`). A board read reaches this on every completion.
   */
  const retryStorage = useCallback(() => {
    if (storageIncompleteRef.current) recoverStorageRef.current();
    else if (handOffTokensRef.current.size > 0) persistTracked();
    else retryPendingCleanup(tabStorage());
  }, [persistTracked]);

  // PMS-CAL-001.5-CP02: the only two places either list changes, so the tab's
  // record of unresolved writes can never drift from what the board locks.
  // CP03-C2: `persist: false` only for a caller that changes both lists and
  // persists once after, so no record ever holds just one list of a pair.
  const updateReconciliations = useCallback(
    (update: (list: Reconciliation[]) => Reconciliation[], persist = true) => {
      const next = update(reconciliationsRef.current);
      if (next === reconciliationsRef.current) {
        retryStorage();
        return;
      }
      reconciliationsRef.current = next;
      setReconciliations(next);
      if (persist) persistTracked();
    },
    [persistTracked, retryStorage]
  );

  const updateBlockReconciliations = useCallback(
    (update: (list: BlockCreateReconciliation[]) => BlockCreateReconciliation[], persist = true) => {
      const next = update(blockReconciliationsRef.current);
      if (next === blockReconciliationsRef.current) {
        retryStorage();
        return;
      }
      blockReconciliationsRef.current = next;
      setBlockReconciliations(next);
      if (persist) persistTracked();
    },
    [persistTracked, retryStorage]
  );

  /**
   * CP03-C1: how a submit handler lets go of its intent once the answer is in
   * on a live page. A lost answer (`unknown`) that is now a tracked entry is
   * handed over (see `persistTracked`); an answer that decided the outcome
   * needs no record, only the intent's deletion — which is retried, not
   * forgotten, if storage refuses it now (CP03-C2). An `unknown` the board did
   * not track keeps its intent.
   */
  const finishIntent = useCallback(
    (token: string, outcomeKind: string, tracked: boolean) => {
      if (outcomeKind !== "unknown") {
        discardPendingWrite(tabStorage(), token);
      } else if (tracked) {
        handOffTokensRef.current.add(token);
        persistTracked();
      }
    },
    [persistTracked]
  );

  /**
   * PMS-CAL-001.5-CP03-C1: takes in what this tab's storage holds and this page's
   * lists do not. A page restored from the back/forward cache is not mounted
   * again, so nothing else would: what it recorded while it was being left — an
   * intent whose request was cut off, an unknown answer that arrived while it
   * was unloading — is in storage but not in the lists. The missing writes go
   * synchronously into the lock refs, `pending` for a re-read issued from now on,
   * which keeps this board's write controls closed until the server has been
   * asked again. A write already tracked here, or still on the wire (its own
   * answer will decide it), is never taken in twice.
   *
   * PMS-CAL-001.5-CP03-C3: the same routine finishes a restoration whose read
   * threw (`incomplete`), so a mounted board recovers without a reload: it
   * reads again, keeps the locks of whatever was readable meanwhile, and only
   * when every record has been read does it open writes again. Returns how many
   * writes it took in.
   */
  const restoreStoredWrites = useCallback((): number => {
    const restored = restoreUncertainWrites(tabStorage(), nextReconciliationIdRef.current);
    nextReconciliationIdRef.current += restored.assignments.length + restored.blocks.length;
    const inFlight = inFlightTokensRef.current;
    const known = new Set([
      ...reconciliationsRef.current.map((entry) => uncertainWriteIdentity("assignment", entry)),
      ...blockReconciliationsRef.current.map((entry) => uncertainWriteIdentity("block", entry)),
    ]);
    const afterSeq = requestSeqRef.current;
    const missing = <T extends Reconciliation | BlockCreateReconciliation>(kind: "assignment" | "block", entries: T[]) =>
      entries
        .filter((entry) => !known.has(uncertainWriteIdentity(kind, entry)) && !(entry.intent !== undefined && inFlight.has(entry.intent)))
        .map((entry) => ({ ...entry, afterSeq }));
    for (const token of restored.pendingTokens) if (!inFlight.has(token)) handOffTokensRef.current.add(token);
    const assignments = missing("assignment", restored.assignments);
    const blocks = missing("block", restored.blocks);
    // Both lists hold everything they took in before anything is persisted: an
    // intent is dropped only for a record that contains every write handed over (CP03-C2).
    if (assignments.length > 0) updateReconciliations((list) => [...list, ...assignments], false);
    if (blocks.length > 0) updateBlockReconciliations((list) => [...list, ...blocks], false);
    // Before persisting: `persistTracked` writes nothing while a record is still unread.
    storageIncompleteRef.current = restored.incomplete;
    setStorageIncomplete(restored.incomplete);
    persistTracked();
    if (restored.unreadable) setStorageUnreadable(true);
    return assignments.length + blocks.length;
  }, [persistTracked, updateReconciliations, updateBlockReconciliations]);

  /** C3: another look at records that could not be read; a board read is only needed if it found something. */
  const recoverStorage = useCallback(() => {
    if (restoreStoredWrites() > 0) setRetryToken((token) => token + 1);
  }, [restoreStoredWrites]);

  useEffect(() => {
    recoverStorageRef.current = recoverStorage;
  }, [recoverStorage]);

  /**
   * C3: called at the start of every submit path, before its room/night guard. It
   * reads the newest state synchronously — a dialog opened, or a click made, while
   * records were unreadable still meets the recovered locks — and refuses the
   * send for as long as any record is unread. It never sends anything itself.
   */
  const refuseWhileStorageUnverified = useCallback((): string | null => {
    if (!storageIncompleteRef.current) return null;
    recoverStorage();
    return storageIncompleteRef.current ? STORAGE_UNVERIFIED_MESSAGE : null;
  }, [recoverStorage]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      markPageAlive();
      restoreStoredWrites();
      // The board may have changed while the page was away: read it again, whatever was found.
      setRetryToken((token) => token + 1);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [restoreStoredWrites]);

  useEffect(() => {
    referencedBlockIdsRef.current = {
      dialog: dialogBlockReconciliationId,
      notice: blockNotice?.reconciliationId ?? null,
      cancelDialog: dialogBlockCancelReconciliationId,
      cancelNotice: blockCancelNotice?.reconciliationId ?? null,
    };
  }, [dialogBlockReconciliationId, blockNotice, dialogBlockCancelReconciliationId, blockCancelNotice]);

  /** A write of either kind made from exactly this board has not been re-read yet. */
  const isBoardAwaitingAnyWrite = useCallback(
    (key: string) =>
      isBoardAwaitingReconciliation(reconciliationsRef.current, key) ||
      isBoardAwaitingBlockReconciliation(blockReconciliationsRef.current, key),
    []
  );

  /**
   * PMS-CAL-001.3-CP03-C1: true while a lost-response write of any type is
   * still unresolved for one of these rooms over overlapping nights on this
   * Property (`isRoomRangeUnresolved`). Read from the refs, so a lock that
   * appeared after a dialog opened is still seen at the moment of sending.
   */
  const isRoomLocked = useCallback(
    (propertyId: string, physicalRoomIds: string[], range: { startDate: string; endDate: string }) =>
      isRoomRangeUnresolved(
        reconciliationsRef.current,
        blockReconciliationsRef.current,
        propertyId,
        physicalRoomIds,
        range
      ),
    []
  );

  useEffect(() => {
    referencedReconciliationIdsRef.current = {
      dialog: dialogReconciliationId,
      notice: assignmentNotice?.reconciliationId ?? null,
      moveDialog: dialogMoveReconciliationId,
      moveNotice: moveNotice?.reconciliationId ?? null,
      unassignDialog: dialogUnassignReconciliationId,
      unassignNotice: unassignNotice?.reconciliationId ?? null,
    };
  }, [
    dialogReconciliationId,
    assignmentNotice,
    dialogMoveReconciliationId,
    moveNotice,
    dialogUnassignReconciliationId,
    unassignNotice,
  ]);

  // Initial load: real active Properties, then deterministically select the
  // first and derive the initial anchor from its own time zone.
  useEffect(() => {
    // CP06: in Staff mode the memberships are the Properties; the public catalog is never read.
    if (staffMode) return;
    const controller = new AbortController();
    setPropertiesState({ status: "loading" });
    fetchActiveProperties(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        if (result.error.kind === "aborted") return;
        setPropertiesState({ status: "error", error: result.error });
        return;
      }
      setPropertiesState({ status: "loaded", properties: result.data });
      if (result.data.length > 0) {
        const first = result.data[0];
        setSelectedPropertyId(first.id);
        setAnchorDate(todayInTimeZone(first.timeZone));
      }
    });
    return () => controller.abort();
  }, [staffMode]);

  const memberships = access.mode === "Staff" ? access.memberships : null;
  useEffect(() => {
    if (memberships === null) return;
    setPropertiesState({
      status: "loaded",
      properties: memberships.map((membership) => ({
        id: membership.propertyId,
        name: membership.propertyName,
        timeZone: membership.timeZone,
      })),
    });
  }, [memberships]);

  const rangeStart = anchorDate ? computeVisibleStartFromAnchor(anchorDate, rangeLength) : null;
  const range = rangeStart ? buildVisibleRange(rangeStart, rangeLength) : null;

  // Refetch whenever Property, visible range, or Retry changes. Stale-response
  // protection: an AbortController per request, plus a monotonic sequence
  // number checked before committing results (belt-and-suspenders in case a
  // fetch polyfill/environment does not fully honor abort).
  const boardReadAllowed = capabilitiesFor(access, selectedPropertyId, sessionEnded).boardRead;

  useEffect(() => {
    if (!selectedPropertyId || !range) return;
    // CP06: no read without permission at this Property, and none after the session ended.
    if (!boardReadAllowed) {
      setBoardState({ status: "idle" });
      return;
    }
    const thisSeq = requestSeqRef.current + 1;
    requestSeqRef.current = thisSeq;
    const controller = new AbortController();
    const rangeStartIso = range.start;
    const rangeEndIso = range.endExclusive;
    const requestKey = boardIdentityKey(selectedPropertyId, rangeStartIso, rangeEndIso);
    // A re-read of exactly the Property and range already on screen (the only
    // case is a post-write reload) keeps that board visible while it refreshes.
    // Any other key — a different Property or date range — still clears to the
    // loading state, so a previous Property's or range's data is never shown
    // under a new selection.
    setBoardState((previous) =>
      previous.status === "loaded" &&
      previous.board.property.id === selectedPropertyId &&
      previous.board.from === rangeStartIso &&
      previous.board.to === rangeEndIso
        ? { ...previous, refreshing: true }
        : { status: "loading" }
    );
    fetchReservationBoard(selectedPropertyId, range.start, range.endExclusive, controller.signal).then((result) => {
      if (requestSeqRef.current !== thisSeq) return; // superseded by a newer request
      if (controller.signal.aborted) return;
      if (!result.ok) {
        if (result.error.kind === "aborted") return;
        const status = result.error.status;
        // CP06: a refused read shows none of this Property's data; the error replaces it.
        setBoardState(
          staffMode && status === 403
            ? { status: "error", error: { ...result.error, message: ACCESS_DENIED_MESSAGE } }
            : { status: "error", error: result.error }
        );
        updateReconciliations((list) => settleReconciliations(list, requestKey, thisSeq, { kind: "failed" }));
        updateBlockReconciliations((list) => settleBlockReconciliations(list, requestKey, thisSeq, { kind: "failed" }));
        if (staffMode && status === 401) expireSession();
        else if (staffMode && status === 403) void refreshAfterDenial();
        return;
      }
      setBoardState({ status: "loaded", board: result.data });
      updateReconciliations((list) =>
        settleReconciliations(list, requestKey, thisSeq, { kind: "loaded", board: result.data })
      );
      updateBlockReconciliations((list) =>
        settleBlockReconciliations(list, requestKey, thisSeq, { kind: "loaded", board: result.data })
      );
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPropertyId, range?.start, range?.endExclusive, retryToken, boardReadAllowed]);

  /**
   * PMS-CAL-001.3-CP03-C1: every navigation records the board identity it is
   * about to show in `currentBoardKeyRef` synchronously, inside the event
   * handler. The effect that also sets it runs only after React renders, and
   * a write that resolves in between must already see the new identity — or
   * it would paint its result onto a board the operator has left. A control
   * that leaves the identity unchanged records the same key, so it is not
   * mistaken for navigation.
   */
  const markNavigation = useCallback(
    (propertyId: string | null, anchor: IsoDate | null, length: ReservationBoardRangeLength) => {
      if (!propertyId || !anchor) return;
      const next = buildVisibleRange(computeVisibleStartFromAnchor(anchor, length), length);
      currentBoardKeyRef.current = boardIdentityKey(propertyId, next.start, next.endExclusive);
    },
    []
  );

  /**
   * Settled block entries are kept only while a dialog or notice of either
   * block direction still refers to them; an uncertain one is never dropped.
   */
  const keepBlockReconciliation = useCallback((entry: BlockCreateReconciliation) => {
    const referenced = referencedBlockIdsRef.current;
    return (
      entry.status !== "done" ||
      entry.certainty === "uncertain" ||
      entry.id === referenced.dialog ||
      entry.id === referenced.notice ||
      entry.id === referenced.cancelDialog ||
      entry.id === referenced.cancelNotice
    );
  }, []);

  /** CP04: closes a block cancel dialog that belongs to a board no longer on screen. */
  const closeStaleBlockCancelDialog = useCallback(() => {
    setBlockCancelTarget((open) => {
      if (open) restoreFocusAfterStaleBlockDialogRef.current = true;
      return null;
    });
  }, []);

  /** C2: closes a block dialog that belongs to a board no longer on screen. */
  const closeStaleBlockDialog = useCallback(() => {
    setBlockTarget((open) => {
      if (open) restoreFocusAfterStaleBlockDialogRef.current = true;
      return null;
    });
  }, []);

  const handleSelectProperty = useCallback(
    (propertyId: string) => {
      const property =
        propertiesState.status === "loaded"
          ? propertiesState.properties.find((candidate) => candidate.id === propertyId)
          : undefined;
      const nextAnchor = property ? todayInTimeZone(property.timeZone) : anchorDate;
      markNavigation(propertyId, nextAnchor, rangeLength);
      setSelectedPropertyId(propertyId);
      setSelection(null);
      setAssignmentTarget(null);
      setAssignmentNotice(null);
      if (!moveRequestPendingRef.current) {
        const outcome = moveDialogOutcomeRef.current;
        if (moveTarget && outcome !== null && !describeMoveOutcome(outcome).allowResubmit) {
          // PMS-CAL-001.4-CP01-C2: this dialog's request reached — or, when
          // unknown, may have reached — the server, and the dialog is now
          // reporting that outcome with no way to send it again. It stays, like
          // a dialog whose request is still pending: closing it would hide a
          // success, a conflict or an unconfirmed write the operator must see.
          setMoveRefusal(null);
        } else {
          // Sent nothing, or was refused in a way that proves nothing changed:
          // it closes with the board it belonged to, and says which of the two.
          setMoveRefusal(
            moveTarget
              ? {
                  text: moveDialogSentRef.current ? REJECTED_MOVE_THEN_BOARD_CHANGED_MESSAGE : STALE_MOVE_DIALOG_MESSAGE,
                  focus: false,
                }
              : null
          );
          setMoveTarget(null);
        }
      }
      setMoveNotice(null);
      if (!unassignRequestPendingRef.current) setUnassignTarget(null);
      setUnassignNotice(null);
      if (!blockSubmittedRef.current) closeStaleBlockDialog();
      setBlockNotice(null);
      if (!blockCancelSubmittedRef.current) closeStaleBlockCancelDialog();
      setBlockCancelNotice(null);
      if (nextAnchor !== anchorDate) setAnchorDate(nextAnchor);
    },
    [propertiesState, anchorDate, rangeLength, markNavigation, closeStaleBlockDialog, closeStaleBlockCancelDialog, moveTarget]
  );

  /**
   * CP06: in Staff mode the Property list follows the memberships. The first
   * one is selected on arrival; when the selected one is no longer granted, the
   * board moves to the first that is, or — with none — closes completely, so no
   * Property of an earlier session or role stays selected.
   */
  useEffect(() => {
    if (!staffMode || propertiesState.status !== "loaded") return;
    const list = propertiesState.properties;
    if (selectedPropertyId !== null && list.some((property) => property.id === selectedPropertyId)) return;
    if (list.length > 0) {
      if (selectedPropertyId === null) {
        const first = list[0];
        const anchor = todayInTimeZone(first.timeZone);
        markNavigation(first.id, anchor, rangeLength);
        setSelectedPropertyId(first.id);
        setAnchorDate(anchor);
      } else {
        handleSelectProperty(list[0].id);
      }
      return;
    }
    if (selectedPropertyId === null) return;
    currentBoardKeyRef.current = null;
    setSelectedPropertyId(null);
    setBoardState({ status: "idle" });
    setSelection(null);
    setAssignmentTarget(null);
    setAssignmentNotice(null);
    if (!moveRequestPendingRef.current) setMoveTarget(null);
    setMoveNotice(null);
    if (!unassignRequestPendingRef.current) setUnassignTarget(null);
    setUnassignNotice(null);
    if (!blockSubmittedRef.current) closeStaleBlockDialog();
    setBlockNotice(null);
    if (!blockCancelSubmittedRef.current) closeStaleBlockCancelDialog();
    setBlockCancelNotice(null);
  }, [
    staffMode,
    propertiesState,
    selectedPropertyId,
    rangeLength,
    markNavigation,
    handleSelectProperty,
    closeStaleBlockDialog,
    closeStaleBlockCancelDialog,
  ]);

  const handlePrev = useCallback(() => {
    if (!anchorDate) return;
    const nextAnchor = addDaysIso(anchorDate, -rangeLength);
    markNavigation(selectedPropertyId, nextAnchor, rangeLength);
    setAnchorDate(nextAnchor);
  }, [anchorDate, rangeLength, selectedPropertyId, markNavigation]);

  const handleNext = useCallback(() => {
    if (!anchorDate) return;
    const nextAnchor = addDaysIso(anchorDate, rangeLength);
    markNavigation(selectedPropertyId, nextAnchor, rangeLength);
    setAnchorDate(nextAnchor);
  }, [anchorDate, rangeLength, selectedPropertyId, markNavigation]);

  const handleToday = useCallback(() => {
    if (propertiesState.status !== "loaded" || !selectedPropertyId) return;
    const property = propertiesState.properties.find((candidate) => candidate.id === selectedPropertyId);
    if (property) {
      const nextAnchor = todayInTimeZone(property.timeZone);
      markNavigation(selectedPropertyId, nextAnchor, rangeLength);
      setAnchorDate(nextAnchor);
    }
  }, [propertiesState, selectedPropertyId, rangeLength, markNavigation]);

  const handleSelectRangeLength = useCallback(
    (length: ReservationBoardRangeLength) => {
      markNavigation(selectedPropertyId, anchorDate, length);
      setRangeLength(length);
    },
    [selectedPropertyId, anchorDate, markNavigation]
  );

  const handleToggleFilter = useCallback((key: keyof ReservationBoardFilters) => {
    setFilters((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  const handleRetry = useCallback(() => setRetryToken((token) => token + 1), []);

  const handleSelectUnassignedRange = useCallback(
    (unassignedSelection: UnassignedRangeSelection) => {
      if (boardState.status !== "loaded") return;
      const displayedKey = boardIdentityKey(
        boardState.board.property.id,
        boardState.board.from,
        boardState.board.to
      );
      // The board on screen may already be contradicted by a write that has
      // not been re-read yet; nothing on it may start another one.
      if (isBoardAwaitingAnyWrite(displayedKey)) {
        return;
      }
      // An earlier create for these nights lost its response and has not been
      // resolved by the server's data: a second create must not be offered.
      if (
        isUnassignedRangeUnresolved(
          reconciliationsRef.current,
          boardState.board.property.id,
          unassignedSelection.stay.reservationUnitId,
          unassignedSelection.unassignedRange
        )
      ) {
        return;
      }
      // CP06: only a role that may assign opens the dialog, and without the
      // cross-RoomType permission it offers rooms of the sold type only.
      const capabilities = capabilitiesAt(boardState.board.property.id);
      if (!capabilities.assignmentWrite) return;
      const built = buildAssignmentTarget(boardState.board, selectedPropertyId, unassignedSelection);
      if (!built) return;
      const target = capabilities.crossRoomType
        ? built
        : { ...built, candidateRooms: built.candidateRooms.filter((room) => room.isSameSoldType) };
      setSelection(null);
      setDialogReconciliationId(null);
      setAssignmentTarget(target);
    },
    [boardState, selectedPropertyId, isBoardAwaitingAnyWrite, capabilitiesAt]
  );

  /**
   * PMS-CAL-001.2-CP04C.5: shared by `submitAssignment` and `submitMove`.
   * Settled entries are kept only while a notice or dialog (of either kind)
   * still shows them; uncertain ones stay until the operator dismisses a
   * resolved one.
   */
  const keepReconciliation = useCallback((entry: Reconciliation) => {
    const referenced = referencedReconciliationIdsRef.current;
    return (
      entry.status !== "done" ||
      entry.certainty === "uncertain" ||
      entry.id === referenced.dialog ||
      entry.id === referenced.notice ||
      entry.id === referenced.moveDialog ||
      entry.id === referenced.moveNotice ||
      entry.id === referenced.unassignDialog ||
      entry.id === referenced.unassignNotice
    );
  }, []);

  const submitAssignment = useCallback(
    async (
      target: AssignmentTarget,
      physicalRoomId: string,
      crossRoomType: CrossRoomTypeConfirmation | null
    ): Promise<AssignmentCreateOutcome> => {
      // Only a room the dialog was built with can be sent — never an arbitrary id.
      const room = target.candidateRooms.find((candidate) => candidate.id === physicalRoomId);
      if (!room) {
        return { kind: "not-sent", message: "Choose one of the listed rooms." };
      }
      // The dialog decides whether a room is cross-RoomType from the same
      // board data this target was built from; re-checked here so a stale
      // target (e.g. a RoomType deactivated between render and submit) can
      // never send `confirmCrossRoomType: false` for a room that is not, in
      // fact, the Unit's sold RoomType.
      const isCrossRoomType = room.roomTypeId !== target.stay.soldRoomTypeId;
      // CP06: re-checked at send time against the role as it is now.
      const capabilities = capabilitiesAt(target.propertyId);
      if (!capabilities.assignmentWrite) return { kind: "not-sent", message: notPermittedMessage() };
      if (isCrossRoomType && !capabilities.crossRoomType) {
        return { kind: "not-sent", message: CROSS_ROOM_TYPE_NOT_PERMITTED_MESSAGE };
      }
      // PMS-CAL-001.3-CP03-C1: re-checked at send time, not only when the dialog opened.
      const unverified = refuseWhileStorageUnverified();
      if (unverified) return { kind: "not-sent", message: unverified };
      if (isRoomLocked(target.propertyId, [room.id], target.unassignedRange)) {
        return { kind: "not-sent", message: ROOM_LOCKED_MESSAGE };
      }

      const writeTarget: ReconciliationTarget = {
        // PMS-CAL-001.2-CP04C.3: reconciliation.ts's ReconciliationTarget
        // is a discriminated union (create/move); this is always the
        // create path — `submitMove` below produces the move path.
        operation: "create",
        reservationUnitId: target.stay.reservationUnitId,
        physicalRoomId: room.id,
        startDate: target.unassignedRange.startDate,
        endDate: target.unassignedRange.endDate,
        roomNumber: room.roomNumber,
        guestDisplayName: target.stay.guestDisplayName,
        confirmationNumber: target.stay.confirmationNumber,
      };
      // PMS-CAL-001.5-CP03: after every refusal above, immediately before the wire.
      const pendingToken = beginPendingWrite(tabStorage(), { kind: "assignment", entry: asUnansweredEntry(target, writeTarget) });
      if (pendingToken === null) return { kind: "not-sent", message: INTENT_NOT_RECORDED_MESSAGE };
      trackWrite(pendingToken);

      const outcome = await createReservationAssignment(target.propertyId, {
        reservationUnitId: target.stay.reservationUnitId,
        physicalRoomId: room.id,
        startDate: target.unassignedRange.startDate,
        endDate: target.unassignedRange.endDate,
        confirmCrossRoomType: isCrossRoomType,
        ...(isCrossRoomType && crossRoomType ? { reason: crossRoomType.reason } : {}),
      });
      untrackWrite(pendingToken);
      // CP03: a page that is unloading is as good as gone — a reload aborts the
      // fetch before the board unmounts (verified live in Chrome).
      if (!mountedRef.current || isPageUnloading()) {
        // An unknown outcome on a page that is gone stays recorded for the next one.
        if (outcome.kind !== "unknown") discardPendingWrite(tabStorage(), pendingToken);
        return outcome;
      }

      if (describeAssignmentOutcome(outcome).reloadBoard) {
        const uncertain = outcome.kind === "unknown";
        const reconciliation: Reconciliation = {
          id: nextReconciliationIdRef.current++,
          key: target.boardKey,
          propertyId: target.propertyId,
          from: target.boardFrom,
          to: target.boardTo,
          // Any board request already issued may have been answered before the write.
          afterSeq: requestSeqRef.current,
          // 201 and 409 are decided before the response; a lost response is not.
          certainty: uncertain ? "uncertain" : "settled",
          target: writeTarget,
          status: "pending",
          resolution: uncertain ? "unresolved" : "settled",
          intent: pendingToken,
        };
        updateReconciliations((list) => [...list.filter(keepReconciliation), reconciliation]);
        setDialogReconciliationId(reconciliation.id);
        if (outcome.kind === "created") {
          setAssignmentTarget(null);
          setAssignmentNotice({
            text: `Room ${room.roomNumber}${isCrossRoomType ? ` (${room.roomTypeName})` : ""} assigned to ${target.stay.guestDisplayName} (${target.stay.confirmationNumber}) for [${target.unassignedRange.startDate}, ${target.unassignedRange.endDate}).`,
            reconciliationId: reconciliation.id,
          });
        }
        setRetryToken((token) => token + 1);
      }
      // Only now: an unknown outcome is already in the tracked list, and the
      // intent goes only once that list is safely stored (CP03-C1).
      finishIntent(pendingToken, outcome.kind, describeAssignmentOutcome(outcome).reloadBoard);
      afterWrite(outcome);
      return outcome;
    },
    [
      updateReconciliations,
      keepReconciliation,
      isRoomLocked,
      refuseWhileStorageUnverified,
      finishIntent,
      capabilitiesAt,
      notPermittedMessage,
      trackWrite,
      untrackWrite,
      afterWrite,
    ]
  );

  const handleMoveRoom = useCallback(
    (moveSelection: AssignedSegmentSelection) => {
      if (boardState.status !== "loaded") return;
      if (!capabilitiesAt(boardState.board.property.id).assignmentWrite) return;
      const displayedKey = boardIdentityKey(
        boardState.board.property.id,
        boardState.board.from,
        boardState.board.to
      );
      // Same guard as handleSelectUnassignedRange: nothing on a board that is
      // already contradicted by an un-reread write may start another one.
      if (isBoardAwaitingAnyWrite(displayedKey)) {
        return;
      }
      // This exact segment already has an uncertain move outstanding — its
      // eventual effect is still unknown, so a second move on it must not be offered.
      if (
        isSegmentMoveUnresolved(
          reconciliationsRef.current,
          boardState.board.property.id,
          moveSelection.segment.segmentId
        )
      ) {
        return;
      }
      // PMS-CAL-001.3-CP03-C1: nor while another lost write still touches its room and nights.
      if (isRoomLocked(boardState.board.property.id, [moveSelection.segment.physicalRoomId], moveSelection.segment)) {
        return;
      }
      const target = buildMoveTarget(boardState.board, selectedPropertyId, moveSelection);
      if (!target) return;
      setSelection(null);
      setDialogMoveReconciliationId(null);
      setMoveInitialRoomId(undefined);
      setMoveRefusal(null);
      moveDialogSentRef.current = false;
      moveDialogOutcomeRef.current = null;
      setMoveTarget(target);
    },
    [boardState, selectedPropertyId, isBoardAwaitingAnyWrite, isRoomLocked, capabilitiesAt]
  );

  /**
   * PMS-CAL-001.4-CP01: every rule a drag-to-move must pass, in one place, so
   * the drag preview, the drop and the source check can never disagree. It is
   * `handleMoveRoom`'s own guards plus the destination: the room must be one of
   * `buildMoveTarget`'s `candidateRooms` (Active, not the current room) and not
   * touched by an unresolved write on the segment's nights. Nothing here guesses
   * whether the room is free — the server decides that when the move is sent.
   *
   * `physicalRoomId` is `undefined` for the source-only check at drag start,
   * and `null` when the pointer is over a row that is not a room.
   */
  const moveDragRefusal = useCallback(
    (dragged: AssignedSegmentSelection, physicalRoomId?: string | null): string | null => {
      if (boardState.status !== "loaded") return "The board is not loaded.";
      const board = boardState.board;
      const displayedKey = boardIdentityKey(board.property.id, board.from, board.to);
      if (physicalRoomId !== undefined && dragSourceBoardKeyRef.current !== displayedKey) {
        return "The board changed during the drag.";
      }
      const capabilities = capabilitiesAt(board.property.id);
      if (!capabilities.assignmentWrite) {
        const paused = writesPausedReason();
        if (paused === "signing-out") return "Signing out — changes are paused.";
        if (paused === "checking-access") return "Checking your access again — changes are paused.";
        return "Your role at this Property cannot move stays.";
      }
      if (moveRequestPendingRef.current) return "Another move is still waiting for the server.";
      if (isBoardAwaitingAnyWrite(displayedKey)) return "Waiting for the board to be re-read after a change.";
      if (
        isSegmentMoveUnresolved(reconciliationsRef.current, board.property.id, dragged.segment.segmentId) ||
        isRoomLocked(board.property.id, [dragged.segment.physicalRoomId], dragged.segment)
      ) {
        return "An earlier change to this room on these nights is still unconfirmed.";
      }
      const target = buildMoveTarget(board, selectedPropertyId, dragged);
      if (!target) return "This stay has changed on the server. Reload the board and try again.";
      if (physicalRoomId === undefined) return null;
      if (physicalRoomId === null) return "Drop on a room's row to move this stay.";
      const room = board.physicalRooms.find((candidate) => candidate.id === physicalRoomId);
      if (!room) return "Drop on a room's row to move this stay.";
      // `candidateRooms` is the one rule that decides; the wording only says why.
      if (!target.candidateRooms.some((candidate) => candidate.id === room.id)) {
        if (room.id === dragged.segment.physicalRoomId) return `This stay is already in room ${room.roomNumber}.`;
        if (room.operationalStatus !== "Active") return `Room ${room.roomNumber} is not Active.`;
        return `Room ${room.roomNumber} can't take this stay.`;
      }
      if (isRoomLocked(board.property.id, [room.id], dragged.segment)) {
        return `An earlier change to room ${room.roomNumber} on these nights is still unconfirmed.`;
      }
      if (!capabilities.crossRoomType && !target.candidateRooms.some((candidate) => candidate.id === room.id && candidate.isSameSoldType)) {
        return `Moving this stay to room ${room.roomNumber}, a different room type, needs a Manager.`;
      }
      return null;
    },
    [boardState, selectedPropertyId, isBoardAwaitingAnyWrite, isRoomLocked, capabilitiesAt, writesPausedReason]
  );

  const handleAssignedSegmentDragStart = useCallback(
    (dragged: AssignedSegmentSelection, bar: HTMLElement) => {
      const refusal = moveDragRefusal(dragged);
      if (refusal !== null) return refusal;
      dragSourceBoardKeyRef.current = currentBoardKeyRef.current;
      // The dragged bar is the opener focus returns to if the dialog closes.
      assignedBarOpenerRef.current = bar;
      return null;
    },
    [moveDragRefusal]
  );

  /**
   * PMS-CAL-001.4-CP01: a drop only opens the existing Move room dialog with
   * the room preselected, for review. It never sends anything, and the target
   * is rebuilt from the authoritative board — the segment's own full
   * `[startDate, endDate)`, never anything derived from where it was dropped.
   */
  const handleAssignedSegmentDrop = useCallback(
    (dragged: AssignedSegmentSelection, physicalRoomId: string | null) => {
      const refusal = moveDragRefusal(dragged, physicalRoomId);
      dragSourceBoardKeyRef.current = null;
      if (refusal !== null) return refusal;
      if (boardState.status !== "loaded") return "The board is not loaded.";
      const target = buildMoveTarget(boardState.board, selectedPropertyId, dragged);
      if (!target || physicalRoomId === null) return "This stay has changed on the server. Reload the board and try again.";
      setSelection(null);
      setDialogMoveReconciliationId(null);
      setMoveInitialRoomId(physicalRoomId);
      setMoveRefusal(null);
      moveDialogSentRef.current = false;
      moveDialogOutcomeRef.current = null;
      setMoveTarget(target);
      return null;
    },
    [moveDragRefusal, boardState, selectedPropertyId]
  );

  /** PMS-CAL-001.2-CP04D-BOARD-WIRING: the unassign counterpart of `handleMoveRoom` above, same two guards. */
  const handleUnassignRoom = useCallback(
    (unassignSelection: AssignedSegmentSelection) => {
      if (boardState.status !== "loaded") return;
      if (!capabilitiesAt(boardState.board.property.id).assignmentWrite) return;
      const displayedKey = boardIdentityKey(
        boardState.board.property.id,
        boardState.board.from,
        boardState.board.to
      );
      if (isBoardAwaitingAnyWrite(displayedKey)) {
        return;
      }
      // This exact segment already has an uncertain unassign outstanding — its
      // eventual effect is still unknown, so a second unassign must not be offered.
      if (
        isSegmentUnassignUnresolved(
          reconciliationsRef.current,
          boardState.board.property.id,
          unassignSelection.segment.segmentId
        )
      ) {
        return;
      }
      if (isRoomLocked(boardState.board.property.id, [unassignSelection.segment.physicalRoomId], unassignSelection.segment)) {
        return;
      }
      const target = buildUnassignTarget(boardState.board, selectedPropertyId, unassignSelection);
      if (!target) return;
      setSelection(null);
      setDialogUnassignReconciliationId(null);
      setUnassignTarget(target);
    },
    [boardState, selectedPropertyId, isBoardAwaitingAnyWrite, isRoomLocked, capabilitiesAt]
  );

  /** C2: the open move dialog's latest result, read by a later Property switch. */
  const recordMoveOutcome = useCallback((outcome: MoveAssignmentOutcome) => {
    moveDialogOutcomeRef.current = outcome;
    return outcome;
  }, []);

  const submitMove = useCallback(
    async (
      target: MoveTarget,
      physicalRoomId: string,
      crossRoomType: CrossRoomTypeConfirmation | null
    ): Promise<MoveAssignmentOutcome> => {
      // Only a room the dialog was built with can be sent — never an arbitrary id.
      const room = target.candidateRooms.find((candidate) => candidate.id === physicalRoomId);
      if (!room) {
        return recordMoveOutcome({ kind: "not-sent", message: "Choose one of the listed rooms." });
      }
      // PMS-CAL-001.2-CP04C.6A: re-derived here, the same way `submitAssignment`
      // re-derives it for create, rather than trusted from the dialog — a
      // stale target (e.g. a RoomType deactivated between render and submit)
      // must never let `confirmCrossRoomType: false` reach the wire for a
      // room that is not, in fact, the Unit's sold RoomType.
      // PMS-CAL-001.2-CP04C.6B: `ReservationMoveDialog` now offers a
      // cross-RoomType destination live, so `room` here is no longer always
      // same-sold-RoomType — this is the line that turns that choice into
      // the request's own `confirmCrossRoomType`.
      const isCrossRoomType = room.roomTypeId !== target.stay.soldRoomTypeId;
      // CP06: re-checked at send time against the role as it is now.
      const capabilities = capabilitiesAt(target.propertyId);
      if (!capabilities.assignmentWrite) return recordMoveOutcome({ kind: "not-sent", message: notPermittedMessage() });
      if (isCrossRoomType && !capabilities.crossRoomType) {
        return recordMoveOutcome({ kind: "not-sent", message: CROSS_ROOM_TYPE_NOT_PERMITTED_MESSAGE });
      }
      // PMS-CAL-001.3-CP03-C1: a move changes both its source and its destination room.
      const unverified = refuseWhileStorageUnverified();
      if (unverified) return recordMoveOutcome({ kind: "not-sent", message: unverified });
      if (isRoomLocked(target.propertyId, [room.id, target.segment.physicalRoomId], target.segment)) {
        return recordMoveOutcome({ kind: "not-sent", message: ROOM_LOCKED_MESSAGE });
      }
      // PMS-CAL-001.4-CP01: a move dialog — whether opened from the popover or
      // from a drop — built from a board the operator has since left never
      // sends that board's segment. Checked immediately before the POST.
      if (currentBoardKeyRef.current !== target.boardKey) {
        // The dialog closes, so it can never Confirm this target again; the
        // refusal moves to the board and takes the focus the dialog held.
        setMoveTarget(null);
        setMoveRefusal({ text: STALE_MOVE_DIALOG_MESSAGE, focus: true });
        return { kind: "not-sent", message: STALE_MOVE_DIALOG_MESSAGE };
      }

      const writeTarget: ReconciliationTarget = {
        operation: "move",
        reservationUnitId: target.stay.reservationUnitId,
        physicalRoomId: room.id,
        startDate: target.segment.startDate,
        endDate: target.segment.endDate,
        roomNumber: room.roomNumber,
        guestDisplayName: target.stay.guestDisplayName,
        confirmationNumber: target.stay.confirmationNumber,
        segmentId: target.segment.segmentId,
        expectedVersion: target.segment.segmentVersion,
        sourcePhysicalRoomId: target.segment.physicalRoomId,
      };
      // PMS-CAL-001.5-CP03: after every refusal above, immediately before the wire.
      const pendingToken = beginPendingWrite(tabStorage(), { kind: "assignment", entry: asUnansweredEntry(target, writeTarget) });
      if (pendingToken === null) return recordMoveOutcome({ kind: "not-sent", message: INTENT_NOT_RECORDED_MESSAGE });
      trackWrite(pendingToken);

      moveRequestPendingRef.current = true;
      const outcome = await moveReservationAssignment(target.propertyId, target.segment.segmentId, {
        expectedVersion: target.segment.segmentVersion,
        physicalRoomId: room.id,
        startDate: target.segment.startDate,
        endDate: target.segment.endDate,
        confirmCrossRoomType: isCrossRoomType,
        ...(isCrossRoomType && crossRoomType ? { reason: crossRoomType.reason } : {}),
      });
      moveRequestPendingRef.current = false;
      // Only the outcome says whether a request left the browser: the client's
      // own `not-sent` (configuration, or a signal aborted before sending) is
      // proof that none did, even though it was called.
      if (outcome.kind !== "not-sent") moveDialogSentRef.current = true;
      recordMoveOutcome(outcome);
      untrackWrite(pendingToken);
      // CP03: a page that is unloading is as good as gone — a reload aborts the
      // fetch before the board unmounts (verified live in Chrome).
      if (!mountedRef.current || isPageUnloading()) {
        // An unknown outcome on a page that is gone stays recorded for the next one.
        if (outcome.kind !== "unknown") discardPendingWrite(tabStorage(), pendingToken);
        return outcome;
      }

      if (describeMoveOutcome(outcome).reloadBoard) {
        const uncertain = outcome.kind === "unknown";
        const reconciliation: Reconciliation = {
          id: nextReconciliationIdRef.current++,
          key: target.boardKey,
          propertyId: target.propertyId,
          from: target.boardFrom,
          to: target.boardTo,
          // Any board request already issued may have been answered before the write.
          afterSeq: requestSeqRef.current,
          // 200 and 409 are decided before the response; a lost response is not.
          certainty: uncertain ? "uncertain" : "settled",
          target: writeTarget,
          status: "pending",
          resolution: uncertain ? "unresolved" : "settled",
          intent: pendingToken,
        };
        updateReconciliations((list) => [...list.filter(keepReconciliation), reconciliation]);
        // PMS-CAL-001.2-CP04C.5-C3: this dialog owns the request even when
        // the visible Property/range changes before the response arrives.
        // Keep its reload status attached to this exact reconciliation so it
        // can truthfully report "elsewhere" and later settle when an
        // authoritative board is shown, instead of remaining at "idle".
        setDialogMoveReconciliationId(reconciliation.id);

        // The success notice, unlike the still-open dialog, belongs to the
        // board currently being presented. Never paint a completed move from
        // an old Property/range onto the new view.
        const stillOnWrittenBoard = currentBoardKeyRef.current === target.boardKey;
        if (stillOnWrittenBoard) {
          if (outcome.kind === "moved") {
            setMoveTarget(null);
            setMoveNotice({
              text: `Room ${room.roomNumber} moved for ${target.stay.guestDisplayName} (${target.stay.confirmationNumber}), [${target.segment.startDate}, ${target.segment.endDate}).`,
              reconciliationId: reconciliation.id,
            });
          }
        }
        setRetryToken((token) => token + 1);
      }
      // Only now: an unknown outcome is already in the tracked list, and the
      // intent goes only once that list is safely stored (CP03-C1).
      finishIntent(pendingToken, outcome.kind, describeMoveOutcome(outcome).reloadBoard);
      afterWrite(outcome);
      return outcome;
    },
    [
      updateReconciliations,
      keepReconciliation,
      isRoomLocked,
      refuseWhileStorageUnverified,
      recordMoveOutcome,
      finishIntent,
      capabilitiesAt,
      notPermittedMessage,
      trackWrite,
      untrackWrite,
      afterWrite,
    ]
  );

  /**
   * PMS-CAL-001.2-CP04D-BOARD-WIRING: the unassign counterpart of `submitMove`
   * above, built on `unassignSubmission.ts`'s pure helpers rather than
   * re-deriving the request or the reload/uncertainty decision inline.
   * `planUnassignReconciliation` returning `null` means nothing may have
   * changed (not-sent, validation, a refusal): no reconciliation, no reload.
   */
  const submitUnassign = useCallback(
    async (target: UnassignTarget, reason?: string): Promise<UnassignAssignmentOutcome> => {
      const { propertyId, segmentId, request } = buildUnassignRequest(target, reason);
      if (!capabilitiesAt(propertyId).assignmentWrite) return { kind: "not-sent", message: notPermittedMessage() };
      const unverified = refuseWhileStorageUnverified();
      if (unverified) return { kind: "not-sent", message: unverified };
      if (isRoomLocked(propertyId, [target.segment.physicalRoomId], target.segment)) {
        return { kind: "not-sent", message: ROOM_LOCKED_MESSAGE };
      }
      // PMS-CAL-001.5-CP03: the entry an `unknown` outcome would produce is exactly the intent to record.
      const unanswered = planUnassignReconciliation(target, { kind: "unknown", reason: "network" }, { id: 0, afterSeq: 0 });
      const pendingToken = unanswered ? beginPendingWrite(tabStorage(), { kind: "assignment", entry: unanswered }) : null;
      if (pendingToken === null) return { kind: "not-sent", message: INTENT_NOT_RECORDED_MESSAGE };
      trackWrite(pendingToken);

      unassignRequestPendingRef.current = true;
      const outcome = await unassignReservationAssignment(propertyId, segmentId, request);
      unassignRequestPendingRef.current = false;
      untrackWrite(pendingToken);
      // CP03: a page that is unloading is as good as gone — a reload aborts the
      // fetch before the board unmounts (verified live in Chrome).
      if (!mountedRef.current || isPageUnloading()) {
        // An unknown outcome on a page that is gone stays recorded for the next one.
        if (outcome.kind !== "unknown") discardPendingWrite(tabStorage(), pendingToken);
        return outcome;
      }

      const planned = planUnassignReconciliation(target, outcome, {
        id: nextReconciliationIdRef.current,
        afterSeq: requestSeqRef.current,
      });
      const reconciliation = planned && { ...planned, intent: pendingToken };
      if (reconciliation) {
        nextReconciliationIdRef.current = reconciliation.id + 1;
        updateReconciliations((list) => [...list.filter(keepReconciliation), reconciliation]);
        // PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: same as submitMove's own
        // `setDialogMoveReconciliationId` — keep the still-open dialog's
        // reload status attached to this exact reconciliation, so it can
        // truthfully report "elsewhere" instead of implying a board was
        // reloaded when the one it was written from was not.
        setDialogUnassignReconciliationId(reconciliation.id);

        // Same as submitMove's own guard: never paint a completed unassign
        // onto a Property/range the operator has since navigated away from.
        const stillOnWrittenBoard = currentBoardKeyRef.current === target.boardKey;
        if (stillOnWrittenBoard && outcome.kind === "unassigned") {
          setUnassignTarget(null);
          setUnassignNotice({
            text: `Room ${target.currentRoomNumber} assignment removed for ${target.stay.guestDisplayName} (${target.stay.confirmationNumber}), [${target.segment.startDate}, ${target.segment.endDate}).`,
            reconciliationId: reconciliation.id,
          });
        }
        setRetryToken((token) => token + 1);
      }
      // Only now: an unknown outcome is already in the tracked list, and the
      // intent goes only once that list is safely stored (CP03-C1).
      finishIntent(pendingToken, outcome.kind, reconciliation !== null);
      afterWrite(outcome);
      return outcome;
    },
    [
      updateReconciliations,
      keepReconciliation,
      isRoomLocked,
      refuseWhileStorageUnverified,
      finishIntent,
      capabilitiesAt,
      notPermittedMessage,
      trackWrite,
      untrackWrite,
      afterWrite,
    ]
  );

  const currentBoardKey =
    selectedPropertyId && range ? boardIdentityKey(selectedPropertyId, range.start, range.endExclusive) : null;

  useEffect(() => {
    currentBoardKeyRef.current = currentBoardKey;
    // A block dialog offers the rooms and nights of the board it was opened
    // from; once the view shows another board, one that has sent nothing is
    // stale. One that has sent a request stays open to report its own result.
    setBlockTarget((open) => {
      if (!open || blockSubmittedRef.current || open.boardKey === currentBoardKey) return open;
      restoreFocusAfterStaleBlockDialogRef.current = true;
      return null;
    });
    // CP04: the same rule for a cancel dialog. It names one segment of one
    // board read; once another board is shown, a dialog that has sent nothing
    // can no longer be confirmed against what the operator is looking at.
    setBlockCancelTarget((open) => {
      if (!open || blockCancelSubmittedRef.current || open.boardKey === currentBoardKey) return open;
      restoreFocusAfterStaleBlockDialogRef.current = true;
      return null;
    });
  }, [currentBoardKey]);

  /** PMS-CAL-001.3-CP03: opens the create dialog for the board on screen, never for a stale or unread one. */
  const handleOpenCreateBlock = useCallback(() => {
    if (boardState.status !== "loaded" || blockRequestPendingRef.current) return;
    const board = boardState.board;
    if (!capabilitiesAt(board.property.id).blockWrite) return;
    const key = boardIdentityKey(board.property.id, board.from, board.to);
    if (isBoardAwaitingAnyWrite(key)) return;
    const roomTypeNames = new Map(board.roomTypes.map((roomType) => [roomType.id, roomType.name]));
    const rooms = board.physicalRooms
      .filter((room) => room.operationalStatus === "Active")
      .map((room) => ({
        id: room.id,
        roomNumber: room.roomNumber,
        roomTypeName: roomTypeNames.get(room.roomTypeId) ?? "Unknown room type",
      }));
    if (rooms.length === 0) return;
    blockSubmittedRef.current = false;
    setSelection(null);
    setDialogBlockReconciliationId(null);
    setBlockTarget({
      propertyId: board.property.id,
      propertyName: board.property.name,
      boardKey: key,
      boardFrom: board.from,
      boardTo: board.to,
      rooms,
    });
  }, [boardState, isBoardAwaitingAnyWrite, capabilitiesAt]);

  /**
   * PMS-CAL-001.3-CP04: opens the cancel dialog for one clicked block, but only
   * when the authoritative board still shows that exact segment at that exact
   * version. Everything the operator will confirm therefore comes from the same
   * read, and a bar clicked from a board that has since been contradicted opens
   * nothing at all.
   */
  const handleCancelBlock = useCallback(
    (blockSelection: BlockSelection) => {
      if (boardState.status !== "loaded" || blockCancelRequestPendingRef.current) return;
      const board = boardState.board;
      if (!capabilitiesAt(board.property.id).blockWrite) return;
      const key = boardIdentityKey(board.property.id, board.from, board.to);
      // The board on screen may already be contradicted by a write that has not
      // been re-read yet; nothing on it may start another one.
      if (isBoardAwaitingAnyWrite(key)) return;
      const target = buildBlockCancelTarget(board, selectedPropertyId, blockSelection);
      if (!target) return;
      // An unresolved write already covers this room and these nights.
      if (isRoomLocked(target.propertyId, [target.block.physicalRoomId], target.block)) return;
      blockCancelSubmittedRef.current = false;
      setSelection(null);
      setDialogBlockCancelReconciliationId(null);
      setBlockCancelTarget(target);
    },
    [boardState, selectedPropertyId, isBoardAwaitingAnyWrite, isRoomLocked, capabilitiesAt]
  );

  /**
   * CP04: the cancel counterpart of `submitBlockCreate`, with the same rules.
   * One request, never a retry; the board is the only evidence; and a result is
   * reported onto the board it was written from, never onto one the operator
   * has since navigated to.
   */
  const submitBlockCancel = useCallback(
    async (target: BlockCancelTarget, reason?: string): Promise<OperationalBlockCancelOutcome> => {
      const { block } = target;
      if (!capabilitiesAt(target.propertyId).blockWrite) return { kind: "not-sent", message: notPermittedMessage() };
      const unverified = refuseWhileStorageUnverified();
      if (unverified) return { kind: "not-sent", message: unverified };
      if (isRoomLocked(target.propertyId, [block.physicalRoomId], block)) {
        return { kind: "not-sent", message: ROOM_LOCKED_MESSAGE };
      }
      // A dialog built from a board the operator has left never sends that
      // board's segment; navigation normally closes it first, and this also
      // covers a confirm that lands before React has re-rendered.
      if (currentBoardKeyRef.current !== target.boardKey) {
        closeStaleBlockCancelDialog();
        return { kind: "not-sent", message: STALE_BLOCK_DIALOG_MESSAGE };
      }

      const writeTarget: BlockWriteTarget = {
        operation: "cancel",
        physicalRoomId: block.physicalRoomId,
        roomNumber: target.roomNumber,
        // The segment's own full range, never the visible board window.
        startDate: block.startDate,
        endDate: block.endDate,
        reason: block.reason,
        segmentId: block.segmentId,
        expectedVersion: block.segmentVersion,
      };
      // PMS-CAL-001.5-CP03: after every refusal above, immediately before the wire.
      const pendingToken = beginPendingWrite(tabStorage(), { kind: "block", entry: asUnansweredEntry(target, writeTarget) });
      if (pendingToken === null) return { kind: "not-sent", message: INTENT_NOT_RECORDED_MESSAGE };
      trackWrite(pendingToken);

      blockCancelRequestPendingRef.current = true;
      blockCancelSubmittedRef.current = true;
      let outcome: OperationalBlockCancelOutcome;
      try {
        outcome = await cancelOperationalBlock(target.propertyId, block.segmentId, {
          expectedVersion: block.segmentVersion,
          ...(reason !== undefined ? { reason } : {}),
        });
      } finally {
        blockCancelRequestPendingRef.current = false;
      }
      untrackWrite(pendingToken);
      // CP03: a page that is unloading is as good as gone — a reload aborts the
      // fetch before the board unmounts (verified live in Chrome).
      if (!mountedRef.current || isPageUnloading()) {
        // An unknown outcome on a page that is gone stays recorded for the next one.
        if (outcome.kind !== "unknown") discardPendingWrite(tabStorage(), pendingToken);
        return outcome;
      }

      const view = describeBlockCancelOutcome(outcome);
      if (view.allowResubmit) {
        // Nothing was changed: the dialog may be used again, but only on the
        // board it was opened from.
        blockCancelSubmittedRef.current = false;
        if (currentBoardKeyRef.current !== target.boardKey) closeStaleBlockCancelDialog();
      }

      if (view.reloadBoard) {
        const uncertain = outcome.kind === "unknown";
        const reconciliation: BlockCreateReconciliation = {
          id: nextReconciliationIdRef.current++,
          key: target.boardKey,
          propertyId: target.propertyId,
          from: target.boardFrom,
          to: target.boardTo,
          afterSeq: requestSeqRef.current,
          certainty: uncertain ? "uncertain" : "settled",
          target: writeTarget,
          status: "pending",
          resolution: uncertain ? "unresolved" : "settled",
          intent: pendingToken,
        };
        updateBlockReconciliations((list) => [...list.filter(keepBlockReconciliation), reconciliation]);
        setDialogBlockCancelReconciliationId(reconciliation.id);
        // Never paint a cancelled block onto a Property/range the operator has left.
        if (currentBoardKeyRef.current === target.boardKey && outcome.kind === "cancelled") {
          setBlockCancelTarget(null);
          setBlockCancelNotice({
            text: `Block on room ${target.roomNumber} cancelled for [${block.startDate}, ${block.endDate}).`,
            reconciliationId: reconciliation.id,
          });
        }
        setRetryToken((token) => token + 1);
      }
      // Only now: an unknown outcome is already in the tracked list, and the
      // intent goes only once that list is safely stored (CP03-C1).
      finishIntent(pendingToken, outcome.kind, view.reloadBoard);
      afterWrite(outcome);
      return outcome;
    },
    [
      updateBlockReconciliations,
      isRoomLocked,
      closeStaleBlockCancelDialog,
      keepBlockReconciliation,
      refuseWhileStorageUnverified,
      finishIntent,
      capabilitiesAt,
      notPermittedMessage,
      trackWrite,
      untrackWrite,
      afterWrite,
    ]
  );

  const isBlockRangeLocked = useCallback(
    (propertyId: string, physicalRoomId: string, startDate: string, endDate: string) =>
      isRoomLocked(propertyId, [physicalRoomId], { startDate, endDate }),
    [isRoomLocked]
  );

  const submitBlockCreate = useCallback(
    async (target: BlockCreateDialogTarget, request: CreateOperationalBlockRequest): Promise<OperationalBlockCreateOutcome> => {
      // Only a room the dialog was built with can be sent — never an arbitrary id.
      const room = target.rooms.find((candidate) => candidate.id === request.physicalRoomId);
      if (!room) {
        return { kind: "not-sent", message: "Choose one of the listed rooms." };
      }
      if (!capabilitiesAt(target.propertyId).blockWrite) return { kind: "not-sent", message: notPermittedMessage() };
      const unverified = refuseWhileStorageUnverified();
      if (unverified) return { kind: "not-sent", message: unverified };
      if (isRoomLocked(target.propertyId, [room.id], request)) {
        return { kind: "not-sent", message: ROOM_LOCKED_MESSAGE };
      }
      // C2: a dialog built from a board the operator has left never sends that
      // board's Property, room and nights. Navigation normally closes it first;
      // this also covers a confirm that lands before React has re-rendered.
      if (currentBoardKeyRef.current !== target.boardKey) {
        closeStaleBlockDialog();
        return { kind: "not-sent", message: STALE_BLOCK_DIALOG_MESSAGE };
      }

      const writeTarget: BlockWriteTarget = {
        operation: "create",
        physicalRoomId: room.id,
        roomNumber: room.roomNumber,
        startDate: request.startDate,
        endDate: request.endDate,
        reason: request.reason,
      };
      // PMS-CAL-001.5-CP03: after every refusal above, immediately before the wire.
      const pendingToken = beginPendingWrite(tabStorage(), { kind: "block", entry: asUnansweredEntry(target, writeTarget) });
      if (pendingToken === null) return { kind: "not-sent", message: INTENT_NOT_RECORDED_MESSAGE };
      trackWrite(pendingToken);

      blockRequestPendingRef.current = true;
      blockSubmittedRef.current = true;
      let outcome: OperationalBlockCreateOutcome;
      try {
        outcome = await createOperationalBlock(target.propertyId, {
          physicalRoomId: room.id,
          startDate: request.startDate,
          endDate: request.endDate,
          reason: request.reason,
        });
      } finally {
        blockRequestPendingRef.current = false;
      }
      untrackWrite(pendingToken);
      // CP03: a page that is unloading is as good as gone — a reload aborts the
      // fetch before the board unmounts (verified live in Chrome).
      if (!mountedRef.current || isPageUnloading()) {
        // An unknown outcome on a page that is gone stays recorded for the next one.
        if (outcome.kind !== "unknown") discardPendingWrite(tabStorage(), pendingToken);
        return outcome;
      }

      const view = describeBlockCreateOutcome(outcome);
      if (view.allowResubmit) {
        // Nothing was written: the dialog returns to its form, and a form is
        // only correctable on the board it was opened from. If the view moved
        // on while the request was pending, the navigation effect has already
        // passed over this dialog, so it is closed here.
        blockSubmittedRef.current = false;
        if (currentBoardKeyRef.current !== target.boardKey) closeStaleBlockDialog();
      }

      if (view.reloadBoard) {
        const uncertain = outcome.kind === "unknown";
        const reconciliation: BlockCreateReconciliation = {
          id: nextReconciliationIdRef.current++,
          key: target.boardKey,
          propertyId: target.propertyId,
          from: target.boardFrom,
          to: target.boardTo,
          afterSeq: requestSeqRef.current,
          certainty: uncertain ? "uncertain" : "settled",
          target: writeTarget,
          status: "pending",
          resolution: uncertain ? "unresolved" : "settled",
          intent: pendingToken,
        };
        updateBlockReconciliations((list) => [...list.filter(keepBlockReconciliation), reconciliation]);
        setDialogBlockReconciliationId(reconciliation.id);
        // Never paint a created block onto a Property/range the operator has left.
        if (currentBoardKeyRef.current === target.boardKey && outcome.kind === "created") {
          setBlockTarget(null);
          setBlockNotice({
            text: `Room ${room.roomNumber} blocked for [${request.startDate}, ${request.endDate}): ${request.reason}`,
            reconciliationId: reconciliation.id,
          });
        }
        setRetryToken((token) => token + 1);
      }
      // Only now: an unknown outcome is already in the tracked list, and the
      // intent goes only once that list is safely stored (CP03-C1).
      finishIntent(pendingToken, outcome.kind, view.reloadBoard);
      afterWrite(outcome);
      return outcome;
    },
    [
      updateBlockReconciliations,
      isRoomLocked,
      closeStaleBlockDialog,
      keepBlockReconciliation,
      refuseWhileStorageUnverified,
      finishIntent,
      capabilitiesAt,
      notPermittedMessage,
      trackWrite,
      untrackWrite,
      afterWrite,
    ]
  );

  const reconciliationStatus = (id: number | null): BoardReloadStatus => {
    if (id === null) return "idle";
    const entry = reconciliations.find((candidate) => candidate.id === id);
    if (!entry) return "idle";
    if (entry.status === "done") return "done";
    // Not confirmed, and the view now shows a different Property or range:
    // whatever that view loads says nothing about the board that was written.
    if (entry.key !== currentBoardKey) return "elsewhere";
    return entry.status;
  };

  const blockReconciliationStatus = (id: number | null): BoardReloadStatus => {
    if (id === null) return "idle";
    const entry = blockReconciliations.find((candidate) => candidate.id === id);
    if (!entry) return "idle";
    if (entry.status === "done") return "done";
    if (entry.key !== currentBoardKey) return "elsewhere";
    return entry.status;
  };

  const dialogBlockCancelReconciliation =
    dialogBlockCancelReconciliationId === null
      ? null
      : blockReconciliations.find((entry) => entry.id === dialogBlockCancelReconciliationId) ?? null;

  const noticeBlockCancelReconciliation =
    blockCancelNotice === null
      ? null
      : blockReconciliations.find((entry) => entry.id === blockCancelNotice.reconciliationId) ?? null;

  const dialogBlockReconciliation =
    dialogBlockReconciliationId === null
      ? null
      : blockReconciliations.find((entry) => entry.id === dialogBlockReconciliationId) ?? null;

  const noticeBlockReconciliation =
    blockNotice === null ? null : blockReconciliations.find((entry) => entry.id === blockNotice.reconciliationId) ?? null;

  const uncertainBlockWrites = blockReconciliations.filter(
    (entry) => entry.certainty === "uncertain" && entry.propertyId === selectedPropertyId
  );

  const dismissBlockReconciliation = useCallback(
    (id: number) =>
      updateBlockReconciliations((list) =>
        list.filter((entry) => entry.id !== id || entry.resolution === "unresolved")
      ),
    [updateBlockReconciliations]
  );

  const dialogReconciliation =
    dialogReconciliationId === null
      ? null
      : reconciliations.find((entry) => entry.id === dialogReconciliationId) ?? null;

  const dialogMoveReconciliation =
    dialogMoveReconciliationId === null
      ? null
      : reconciliations.find((entry) => entry.id === dialogMoveReconciliationId) ?? null;

  const dialogUnassignReconciliation =
    dialogUnassignReconciliationId === null
      ? null
      : reconciliations.find((entry) => entry.id === dialogUnassignReconciliationId) ?? null;

  const handleCheckAgain = useCallback(() => setRetryToken((token) => token + 1), []);

  const dismissReconciliation = useCallback(
    (id: number) =>
      updateReconciliations((list) =>
        list.filter((entry) => entry.id !== id || entry.resolution === "unresolved")
      ),
    [updateReconciliations]
  );

  const isRangeUnconfirmed = useCallback(
    (reservationUnitId: string, unassignedRange: ReservationBoardUnassignedRange) =>
      selectedPropertyId !== null &&
      isUnassignedRangeUnresolved(reconciliations, selectedPropertyId, reservationUnitId, unassignedRange),
    [reconciliations, selectedPropertyId]
  );


  const uncertainWrites = reconciliations.filter(
    (entry) => entry.certainty === "uncertain" && entry.propertyId === selectedPropertyId
  );

  // PMS-CAL-001.2-CP04C.3-C2: must use the same board-authority predicate as
  // evaluateUncertainWrite, not an inlined containment check — the two
  // operations have different window rules (see reconciliation.ts's doc
  // comment), and this gate deciding differently than the evaluator would
  // either offer "Check again" for a board that can prove nothing, or hide
  // it from a board that could.
  const boardCanShow = (entry: Reconciliation) =>
    boardState.status === "loaded" &&
    boardCanEvaluate(entry, {
      propertyId: boardState.board.property.id,
      from: boardState.board.from,
      to: boardState.board.to,
    });

  const noticeReconciliation =
    assignmentNotice === null
      ? null
      : reconciliations.find((entry) => entry.id === assignmentNotice.reconciliationId) ?? null;

  const noticeMoveReconciliation =
    moveNotice === null ? null : reconciliations.find((entry) => entry.id === moveNotice.reconciliationId) ?? null;

  const noticeUnassignReconciliation =
    unassignNotice === null
      ? null
      : reconciliations.find((entry) => entry.id === unassignNotice.reconciliationId) ?? null;

  const displayedBoardKey =
    boardState.status === "loaded"
      ? boardIdentityKey(boardState.board.property.id, boardState.board.from, boardState.board.to)
      : null;
  const displayedBoardAwaitingReconciliation =
    displayedBoardKey !== null &&
    (isBoardAwaitingReconciliation(reconciliations, displayedBoardKey) ||
      isBoardAwaitingBlockReconciliation(blockReconciliations, displayedBoardKey));

  /** Why the toolbar's Create operational block is unavailable right now, or `null` when it is available. */
  /** CP06-C1/C3: a sign-out or an access check is under way — the board stays readable, no write is offered. */
  const signingOutNow = access.mode === "Staff" && access.signingOut === true;
  const writesPaused = signingOutNow || accessCheckPaused;
  const capabilities = capabilitiesFor(access, selectedPropertyId, sessionEnded, writesPaused);

  const createBlockUnavailableReason =
    boardState.status !== "loaded"
      ? "The board has not loaded."
      : !capabilities.blockWrite
        ? signingOutNow
          ? "Signing out — changes are paused."
          : accessCheckPaused
            ? "Checking your access again — changes are paused."
            : "Your role at this Property cannot block rooms."
      : displayedBoardAwaitingReconciliation
        ? "Waiting for the board to be re-read after a change."
        : !boardState.board.physicalRooms.some((room) => room.operationalStatus === "Active")
          ? "This Property has no Active rooms."
          : null;

  /**
   * PMS-CAL-001.2-CP04C.5: the same rule `handleMoveRoom` enforces before
   * opening a dialog, exposed so the popover can disable its Move room
   * button in advance rather than let the operator open it and find out.
   */
  /** PMS-CAL-001.3-CP03-C1: the displayed segment's own room and nights are locked by another lost write. */
  const isSegmentRoomLocked = (segmentId: string) => {
    if (boardState.status !== "loaded") return false;
    const segment = boardState.board.stays
      .flatMap((stay) => stay.assignments)
      .find((assignment) => assignment.segmentId === segmentId);
    return (
      segment !== undefined &&
      isRoomRangeUnresolved(reconciliations, blockReconciliations, boardState.board.property.id, [segment.physicalRoomId], segment)
    );
  };

  const isMoveBlockedForSegment = (segmentId: string) =>
    displayedBoardAwaitingReconciliation ||
    (selectedPropertyId !== null && isSegmentMoveUnresolved(reconciliations, selectedPropertyId, segmentId)) ||
    isSegmentRoomLocked(segmentId);

  /** PMS-CAL-001.2-CP04D-BOARD-WIRING: the unassign counterpart of `isMoveBlockedForSegment` above, independent of it. */
  /**
   * PMS-CAL-001.3-CP04: the block counterpart. A cancel is unavailable while
   * the board on screen is already contradicted by a write that has not been
   * re-read, and while an unresolved write of any type still covers this
   * room's overlapping nights — including an earlier lost cancel of this very
   * segment, which must never be sent a second time.
   */
  const isCancelBlockedForBlock = (block: ReservationBoardOperationalBlock) =>
    displayedBoardAwaitingReconciliation ||
    (selectedPropertyId !== null && isRoomLocked(selectedPropertyId, [block.physicalRoomId], block));

  const isUnassignBlockedForSegment = (segmentId: string) =>
    displayedBoardAwaitingReconciliation ||
    (selectedPropertyId !== null && isSegmentUnassignUnresolved(reconciliations, selectedPropertyId, segmentId)) ||
    isSegmentRoomLocked(segmentId);

  /**
   * PMS-CAL-001.2-CP04C.5-C2: the one place focus returns to after the move
   * dialog closes without a notice taking over (validation, a refused
   * submit, a conflict, or an unknown result — see `assignedBarOpenerRef`'s
   * own comment for why the dialog cannot determine this itself). Prefers
   * the exact assigned bar that opened this move, but only while it is
   * still actually attached to the document — an authoritative reload that
   * superseded the segment's own id, or a Property/range switch, unmounts
   * that specific element, and `.isConnected` reports that reliably without
   * this needing to know why. Falls back to the Property selector: always
   * present, always focusable, a real board control rather than the
   * document body.
   */
  const restoreBoardFocus = useCallback(() => {
    const opener = assignedBarOpenerRef.current;
    if (opener && opener.isConnected) {
      opener.focus();
      return;
    }
    document.getElementById("reservation-board-property")?.focus();
  }, []);

  // PMS-CAL-001.4-CP01-C1: the refusal takes over the focus the closed dialog held.
  useEffect(() => {
    if (moveRefusal?.focus) moveRefusalRef.current?.focus();
  }, [moveRefusal]);

  const dismissMoveRefusal = useCallback(() => {
    const noticeOwnedFocus = moveRefusalRef.current?.contains(document.activeElement) ?? false;
    // Focus leaves before the focused notice unmounts.
    if (noticeOwnedFocus) restoreBoardFocus();
    setMoveRefusal(null);
  }, [restoreBoardFocus]);

  // A new notice takes focus: the bar that opened the dialog is gone once the
  // board reloads, so focus would otherwise fall back to the document.
  useEffect(() => {
    if (assignmentNotice) noticeRef.current?.focus();
  }, [assignmentNotice]);

  useEffect(() => {
    if (moveNotice) moveNoticeRef.current?.focus();
  }, [moveNotice]);

  useEffect(() => {
    if (unassignNotice) unassignNoticeRef.current?.focus();
  }, [unassignNotice]);

  useEffect(() => {
    if (blockNotice) blockNoticeRef.current?.focus();
  }, [blockNotice]);

  useEffect(() => {
    if (blockCancelNotice) blockCancelNoticeRef.current?.focus();
  }, [blockCancelNotice]);

  /** Focus after the block dialog or its notice goes away: its own toolbar button, else the Property selector. */
  const restoreCreateBlockFocus = useCallback(() => {
    const button = document.getElementById("reservation-board-create-block");
    if (button instanceof HTMLButtonElement && !button.disabled) {
      button.focus();
      return;
    }
    document.getElementById("reservation-board-property")?.focus();
  }, []);

  // C2: a block dialog the board closed because it had gone stale took the
  // focused element with it. Only focus that fell to the document is moved;
  // focus the operator has put elsewhere is left where it is.
  useEffect(() => {
    if (blockTarget || blockCancelTarget || !restoreFocusAfterStaleBlockDialogRef.current) return;
    restoreFocusAfterStaleBlockDialogRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) restoreCreateBlockFocus();
  }, [blockTarget, blockCancelTarget, restoreCreateBlockFocus]);

  /**
   * C2: same rule as `dismissBlockNotice`, for an observed unconfirmed block
   * notice — focus moves before the focused button unmounts, and only if the
   * notice held it.
   */
  const dismissUncertainBlockNotice = useCallback(
    (id: number, noticeOwnedFocus: boolean) => {
      if (noticeOwnedFocus) restoreCreateBlockFocus();
      dismissBlockReconciliation(id);
    },
    [dismissBlockReconciliation, restoreCreateBlockFocus]
  );

  const dismissBlockCancelNotice = useCallback(() => {
    const noticeOwnedFocus = blockCancelNoticeRef.current?.contains(document.activeElement) ?? false;
    setBlockCancelNotice(null);
    if (noticeOwnedFocus) restoreBoardFocus();
  }, [restoreBoardFocus]);

  const dismissBlockNotice = useCallback(() => {
    const noticeOwnedFocus = blockNoticeRef.current?.contains(document.activeElement) ?? false;
    setBlockNotice(null);
    if (noticeOwnedFocus) restoreCreateBlockFocus();
  }, [restoreCreateBlockFocus]);

  const dismissMoveNotice = useCallback(() => {
    const noticeOwnedFocus = moveNoticeRef.current?.contains(document.activeElement) ?? false;
    setMoveNotice(null);
    // A keyboard dismissal removes the focused notice/button. Move focus to
    // a stable board control before that subtree unmounts; pointer/programmatic
    // dismissal while focus is elsewhere must leave the operator there.
    if (noticeOwnedFocus) {
      document.getElementById("reservation-board-property")?.focus();
    }
  }, []);

  /** PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: the unassign counterpart of `dismissMoveNotice` above — same rule. */
  const dismissUnassignNotice = useCallback(() => {
    const noticeOwnedFocus = unassignNoticeRef.current?.contains(document.activeElement) ?? false;
    setUnassignNotice(null);
    if (noticeOwnedFocus) {
      document.getElementById("reservation-board-property")?.focus();
    }
  }, []);

  const rangeLabel = range ? formatRangeLabel(range) : "";

  const body = useMemo(() => {
    if (sessionEnded) {
      return (
        <CenteredMessage>
          Your Staff session has ended, so this board is closed. Nothing more is sent from it; sign in again to continue.
        </CenteredMessage>
      );
    }
    if (propertiesState.status === "loading") {
      return <CenteredMessage>Loading properties…</CenteredMessage>;
    }
    if (propertiesState.status === "error") {
      return (
        <ErrorMessage message={propertiesState.error.message} onRetry={() => window.location.reload()} />
      );
    }
    if (propertiesState.properties.length === 0) {
      return staffMode ? (
        <CenteredMessage>
          You have not been granted access to any Property yet. Ask an administrator to add a Property membership for your
          Staff account.
        </CenteredMessage>
      ) : (
        <CenteredMessage>No active properties are available.</CenteredMessage>
      );
    }
    if (!capabilities.boardRead) {
      return <CenteredMessage>Your role at this Property does not include access to the Reservation Board.</CenteredMessage>;
    }
    if (boardState.status === "loading" || boardState.status === "idle") {
      return <CenteredMessage>Loading Reservation Board…</CenteredMessage>;
    }
    if (boardState.status === "error") {
      return <ErrorMessage message={boardState.error.message} onRetry={handleRetry} />;
    }
    if (!range) {
      return null;
    }
    const board = boardState.board;
    if (
      board.roomTypes.length === 0 &&
      board.physicalRooms.length === 0 &&
      board.stays.length === 0 &&
      board.operationalBlocks.length === 0
    ) {
      return <CenteredMessage>No rooms or stays for this Property and date range.</CenteredMessage>;
    }
    return (
      <ReservationBoardServerTimeline
        range={range}
        todayIso={board.property.localToday}
        roomTypes={board.roomTypes}
        physicalRooms={board.physicalRooms}
        stays={board.stays}
        operationalBlocks={board.operationalBlocks}
        showAssigned={filters.showAssigned}
        showUnassigned={filters.showUnassigned}
        showOperationalBlocks={filters.showOperationalBlocks}
        onSelectStay={(value) => {
          // Captured here, before the popover (and, if the operator goes on
          // to Move room, the dialog after it) ever mounts — see
          // `assignedBarOpenerRef`'s own comment.
          assignedBarOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setSelection({ kind: "stay", value });
        }}
        onSelectUnassignedRange={handleSelectUnassignedRange}
        onSelectBlock={(value) => {
          // CP04: captured for the same reason as `onSelectStay`'s — the block
          // bar is the stable opener focus returns to when the cancel dialog
          // closes without a notice taking over.
          assignedBarOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setSelection({ kind: "block", value });
        }}
        unassignedActionsBlocked={displayedBoardAwaitingReconciliation || !capabilities.assignmentWrite}
        isUnassignedRangeUnconfirmed={isRangeUnconfirmed}
        onAssignedSegmentDragStart={handleAssignedSegmentDragStart}
        getAssignedSegmentDropRefusal={moveDragRefusal}
        onAssignedSegmentDrop={handleAssignedSegmentDrop}
      />
    );
  }, [
    sessionEnded,
    staffMode,
    capabilities.boardRead,
    capabilities.assignmentWrite,
    propertiesState,
    boardState,
    range,
    filters,
    handleRetry,
    handleSelectUnassignedRange,
    displayedBoardAwaitingReconciliation,
    isRangeUnconfirmed,
    handleAssignedSegmentDragStart,
    moveDragRefusal,
    handleAssignedSegmentDrop,
  ]);

  const toolbarProperties = propertiesState.status === "loaded" ? propertiesState.properties : [];

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <ReservationBoardToolbar
        properties={toolbarProperties}
        selectedPropertyId={selectedPropertyId ?? ""}
        onSelectProperty={handleSelectProperty}
        rangeLength={rangeLength}
        onSelectRangeLength={handleSelectRangeLength}
        rangeLabel={rangeLabel}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        filters={filters}
        onToggleFilter={handleToggleFilter}
        onCreateBlock={handleOpenCreateBlock}
        createBlockUnavailableReason={createBlockUnavailableReason}
        accessSummary={describeBoardAccess(access, selectedPropertyId)}
      />
      {blockNotice && (
        <AssignmentNotice
          ref={blockNoticeRef}
          text={blockNotice.text}
          reloadStatus={blockReconciliationStatus(blockNotice.reconciliationId)}
          writtenRange={
            noticeBlockReconciliation ? { from: noticeBlockReconciliation.from, to: noticeBlockReconciliation.to } : null
          }
          onDismiss={dismissBlockNotice}
        />
      )}
      {blockCancelNotice && (
        <AssignmentNotice
          ref={blockCancelNoticeRef}
          text={blockCancelNotice.text}
          reloadStatus={blockReconciliationStatus(blockCancelNotice.reconciliationId)}
          writtenRange={
            noticeBlockCancelReconciliation
              ? { from: noticeBlockCancelReconciliation.from, to: noticeBlockCancelReconciliation.to }
              : null
          }
          onDismiss={dismissBlockCancelNotice}
        />
      )}
      {uncertainBlockWrites.map((entry) => (
        <UncertainBlockNotice
          key={entry.id}
          entry={entry}
          readStatus={boardState.status === "error" ? "failed" : blockReconciliationStatus(entry.id)}
          canCheckHere={
            boardState.status === "loaded" &&
            boardCanEvaluateBlock(entry, {
              propertyId: boardState.board.property.id,
              from: boardState.board.from,
              to: boardState.board.to,
            })
          }
          checking={boardState.status === "loading" || (boardState.status === "loaded" && !!boardState.refreshing)}
          onCheckAgain={handleCheckAgain}
          onDismiss={(noticeOwnedFocus) => dismissUncertainBlockNotice(entry.id, noticeOwnedFocus)}
        />
      ))}
      {assignmentNotice && (
        <AssignmentNotice
          ref={noticeRef}
          text={assignmentNotice.text}
          reloadStatus={reconciliationStatus(assignmentNotice.reconciliationId)}
          writtenRange={noticeReconciliation ? { from: noticeReconciliation.from, to: noticeReconciliation.to } : null}
          onDismiss={() => setAssignmentNotice(null)}
        />
      )}
      {moveRefusal && (
        <div
          ref={moveRefusalRef}
          tabIndex={-1}
          role="alert"
          data-testid="move-refusal-notice"
          className="mx-2 mt-2 flex items-start justify-between gap-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warning-500/60 sm:mx-4 dark:bg-warning-500/10 dark:text-warning-300"
        >
          <p className="font-medium">{moveRefusal.text}</p>
          <button
            type="button"
            onClick={dismissMoveRefusal}
            aria-label="Dismiss notice"
            className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-warning-100 dark:hover:bg-white/5"
          >
            <CloseLineIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {moveNotice && (
        <AssignmentNotice
          ref={moveNoticeRef}
          text={moveNotice.text}
          reloadStatus={reconciliationStatus(moveNotice.reconciliationId)}
          writtenRange={
            noticeMoveReconciliation ? { from: noticeMoveReconciliation.from, to: noticeMoveReconciliation.to } : null
          }
          onDismiss={dismissMoveNotice}
        />
      )}
      {unassignNotice && (
        <AssignmentNotice
          ref={unassignNoticeRef}
          text={unassignNotice.text}
          reloadStatus={reconciliationStatus(unassignNotice.reconciliationId)}
          writtenRange={
            noticeUnassignReconciliation
              ? { from: noticeUnassignReconciliation.from, to: noticeUnassignReconciliation.to }
              : null
          }
          onDismiss={dismissUnassignNotice}
        />
      )}
      {uncertainWrites.map((entry) => (
        <UncertainWriteNotice
          key={entry.id}
          entry={entry}
          readStatus={boardState.status === "error" ? "failed" : reconciliationStatus(entry.id)}
          canCheckHere={boardCanShow(entry)}
          checking={boardState.status === "loading" || (boardState.status === "loaded" && !!boardState.refreshing)}
          onCheckAgain={handleCheckAgain}
          onDismiss={(noticeOwnedFocus) => {
            // Same rule as the block notice: focus leaves before the focused button unmounts.
            if (noticeOwnedFocus) restoreCreateBlockFocus();
            dismissReconciliation(entry.id);
          }}
        />
      ))}
      {storageIncomplete && selectedPropertyId !== null && (
        // Client-only, like the warning below. Writes stay closed until every record has been read.
        <div
          role="alert"
          data-testid="unverified-storage-writes"
          className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 sm:mx-4 dark:bg-warning-500/10 dark:text-warning-300"
        >
          <p>
            This browser tab could not read the safety records of requests sent before this page was reloaded or left, so
            those requests, if any, are not accounted for. Changes are not sent from this board until they can be read.
            Nothing new was sent.
          </p>
          <button
            type="button"
            onClick={recoverStorage}
            className="shrink-0 rounded-lg border border-warning-300 px-3 py-1 text-xs font-medium hover:bg-warning-100 dark:border-warning-500/40 dark:hover:bg-white/5"
          >
            Check storage again
          </button>
        </div>
      )}
      {storageUnreadable && selectedPropertyId !== null && (
        // Client-only (gated on a loaded Property), so it never differs from the server render.
        <p
          role="alert"
          data-testid="unreadable-uncertain-writes"
          className="mx-2 mt-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 sm:mx-4 dark:bg-warning-500/10 dark:text-warning-300"
        >
          An unconfirmed request from before this page was reloaded or left could not be restored, so its rooms and nights are
          not locked here. It may already have been saved: check the board before repeating any recent change.
        </p>
      )}
      {boardState.status === "loaded" && boardState.refreshing && (
        <p role="status" className="px-4 pt-2 text-xs text-gray-500 dark:text-gray-400">
          Refreshing board from the server…
        </p>
      )}
      <div className="p-2 sm:p-4">{body}</div>
      {selection && (
        <ReservationBoardStayPopover
          selection={selection}
          onClose={() => setSelection(null)}
          onMoveRoom={capabilities.assignmentWrite ? handleMoveRoom : undefined}
          moveBlocked={
            selection.kind === "stay" && selection.value.segment
              ? isMoveBlockedForSegment(selection.value.segment.segmentId)
              : false
          }
          onUnassignRoom={capabilities.assignmentWrite ? handleUnassignRoom : undefined}
          unassignBlocked={
            selection.kind === "stay" && selection.value.segment
              ? isUnassignBlockedForSegment(selection.value.segment.segmentId)
              : false
          }
          onCancelBlock={selection.kind === "block" && capabilities.blockWrite ? handleCancelBlock : undefined}
          cancelBlockBlocked={
            selection.kind === "block" ? isCancelBlockedForBlock(selection.value.block) : false
          }
        />
      )}
      {assignmentTarget && (
        <ReservationAssignmentDialog
          // A different target is a different dialog: never carry one range's
          // selection, result or submit lock over to another.
          key={`${assignmentTarget.stay.reservationUnitId}:${assignmentTarget.unassignedRange.startDate}:${assignmentTarget.unassignedRange.endDate}`}
          target={assignmentTarget}
          boardReloadStatus={reconciliationStatus(dialogReconciliationId)}
          uncertainResolution={
            dialogReconciliation?.certainty === "uncertain" && dialogReconciliation.resolution !== "settled"
              ? dialogReconciliation.resolution
              : undefined
          }
          onSubmit={(physicalRoomId, crossRoomType) => submitAssignment(assignmentTarget, physicalRoomId, crossRoomType)}
          onClose={() => setAssignmentTarget(null)}
        />
      )}
      {moveTarget && (
        <ReservationMoveDialog
          // A different target is a different dialog: never carry one
          // segment's selection, result or submit lock over to another.
          key={`${moveTarget.segment.segmentId}:${moveTarget.segment.segmentVersion}:${moveInitialRoomId ?? ""}`}
          target={moveTarget}
          // PMS-CAL-001.4-CP01: a drop's room, preselected for review only.
          initialRoomId={moveInitialRoomId}
          // PMS-CAL-001.2-CP04C.6B: live opt-in — this board now offers a
          // controlled cross-RoomType destination for a move, the same
          // contract CP04C.6A merged and CP03B already offers for a new
          // assignment. CP06: only for a role that may confirm it at this Property.
          crossRoomTypeEnabled={capabilitiesFor(access, moveTarget.propertyId, sessionEnded, writesPaused).crossRoomType}
          boardReloadStatus={reconciliationStatus(dialogMoveReconciliationId)}
          uncertainResolution={
            dialogMoveReconciliation?.certainty === "uncertain" && dialogMoveReconciliation.resolution !== "settled"
              ? dialogMoveReconciliation.resolution
              : undefined
          }
          onSubmit={(physicalRoomId, crossRoomType) => submitMove(moveTarget, physicalRoomId, crossRoomType)}
          onClose={() => {
            setMoveTarget(null);
            // Only reached when the operator closes the dialog directly
            // (validation, a refused submit, a conflict, or an unknown
            // result) — a successful move instead clears `moveTarget`
            // itself from `submitMove` and hands focus to the success
            // notice via the effect above, so this never fights that path.
            restoreBoardFocus();
          }}
        />
      )}
      {unassignTarget && (
        <ReservationUnassignDialog
          // A different target is a different dialog: never carry one
          // segment's selection, result or submit lock over to another.
          key={`${unassignTarget.segment.segmentId}:${unassignTarget.segment.segmentVersion}`}
          target={unassignTarget}
          boardReloadStatus={reconciliationStatus(dialogUnassignReconciliationId)}
          uncertainResolution={
            dialogUnassignReconciliation?.certainty === "uncertain" &&
            dialogUnassignReconciliation.resolution !== "settled"
              ? dialogUnassignReconciliation.resolution
              : undefined
          }
          onSubmit={(reason) => submitUnassign(unassignTarget, reason)}
          onClose={() => {
            setUnassignTarget(null);
            // Same rule as the move dialog's own onClose above: success
            // instead clears `unassignTarget` from `submitUnassign` itself.
            restoreBoardFocus();
          }}
        />
      )}
      {blockTarget && (
        <ReservationBlockCreateDialog
          key={blockTarget.boardKey}
          target={blockTarget}
          boardReloadStatus={blockReconciliationStatus(dialogBlockReconciliationId)}
          uncertainResolution={
            dialogBlockReconciliation?.certainty === "uncertain" && dialogBlockReconciliation.resolution !== "settled"
              ? dialogBlockReconciliation.resolution
              : undefined
          }
          isRangeLocked={(physicalRoomId, startDate, endDate) =>
            isBlockRangeLocked(blockTarget.propertyId, physicalRoomId, startDate, endDate)
          }
          onSubmit={(request) => submitBlockCreate(blockTarget, request)}
          onClose={() => {
            setBlockTarget(null);
            restoreCreateBlockFocus();
          }}
        />
      )}
      {blockCancelTarget && (
        <ReservationBlockCancelDialog
          // A different segment/version is a different dialog: never carry one
          // block's result or submit lock over to another.
          key={`${blockCancelTarget.block.segmentId}:${blockCancelTarget.block.segmentVersion}`}
          target={blockCancelTarget}
          boardReloadStatus={blockReconciliationStatus(dialogBlockCancelReconciliationId)}
          uncertainResolution={
            dialogBlockCancelReconciliation?.certainty === "uncertain" &&
            dialogBlockCancelReconciliation.resolution !== "settled"
              ? dialogBlockCancelReconciliation.resolution
              : undefined
          }
          onSubmit={(reason) => submitBlockCancel(blockCancelTarget, reason)}
          onClose={() => {
            setBlockCancelTarget(null);
            // Success instead clears the target from `submitBlockCancel` itself.
            restoreBoardFocus();
          }}
        />
      )}
    </div>
  );
};

/**
 * PMS-CAL-001.3-CP03: one block write whose response was lost. It stays — and
 * that room's overlapping nights stay locked for every write type — until a
 * board of this Property shows the write's effect: for a create, a block for
 * the same room over exactly the same nights; for a cancel (CP04), the
 * targeted segment no longer at the version that was sent. Check again only
 * re-reads the board; it never re-sends the POST.
 */
const UncertainBlockNotice: React.FC<{
  entry: BlockCreateReconciliation;
  readStatus: BoardReloadStatus;
  canCheckHere: boolean;
  checking: boolean;
  onCheckAgain: () => void;
  /** `noticeOwnedFocus`: focus was inside this notice, which is about to unmount. */
  onDismiss: (noticeOwnedFocus: boolean) => void;
}> = ({ entry, readStatus, canCheckHere, checking, onCheckAgain, onDismiss }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { target } = entry;
  const range = `[${target.startDate}, ${target.endDate})`;
  const observed = entry.resolution === "observed";
  // PMS-CAL-001.3-CP04-C1: the two directions observe opposite things, so
  // neither may borrow the other's wording. For a cancel, `observed` means the
  // targeted segment/version is no longer on the board (gone or re-versioned);
  // `unresolved` after a read means it is still there at that version. Both are
  // facts about the schedule, never about what this lost request did. The
  // block's own reason is labelled as such: a cancel's optional reason is not
  // tracked here, and the block's reason must not read as the cancel's.
  const title = entry.restored
    ? `Unconfirmed block ${target.operation === "cancel" ? "cancel" : "create"} request ${entry.restored === "in-flight" ? "sent just" : "from"} before this page was reloaded or left: room ${target.roomNumber}, ${range}.`
    : target.operation === "cancel"
      ? `Unconfirmed cancel request: block on room ${target.roomNumber}, ${range} · original block reason: ${target.reason}`
      : `Unconfirmed block request: room ${target.roomNumber}, ${range} — ${target.reason}`;
  let detail: string;
  if (observed) {
    detail =
      target.operation === "cancel"
        ? `This block is no longer shown at version ${target.expectedVersion}, the version this request targeted. That shows the schedule changed; it does not prove this request cancelled it.`
        : `A block for room ${target.roomNumber} over ${range} is now shown on the server. That shows the schedule; it does not prove this request created it.`;
  } else if (readStatus === "pending") {
    detail = "Checking the board on the server…";
  } else if (readStatus === "failed") {
    detail = "The board could not be reloaded, so the result is still unknown. Use Retry on the board.";
  } else if (!canCheckHere) {
    detail = `The result is still unknown and this room stays locked for these nights. Open a view of this Property that overlaps ${range} to check again.`;
  } else if (checking) {
    detail = "Checking the board on the server again…";
  } else if (target.operation === "cancel") {
    detail = `The board was checked and this block is still shown at version ${target.expectedVersion}, the version this request targeted. That does not prove the cancel failed. This room stays locked for these nights and the request will not be sent again.`;
  } else {
    detail =
      "The board was checked, but no matching block is shown yet. That does not prove the request failed. This room stays locked for these nights and the request will not be sent again.";
  }

  return (
    <div
      ref={rootRef}
      role="status"
      data-testid="uncertain-block-notice"
      className={`mx-2 mt-2 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm sm:mx-4 ${
        observed
          ? "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-200"
          : "bg-warning-50 text-warning-800 dark:bg-warning-500/10 dark:text-warning-300"
      }`}
    >
      <div>
        <p className="font-medium">{title}</p>
        {entry.restored && (
          <p className="mt-0.5 text-xs">
            {entry.restored === "in-flight" ? RESTORED_IN_FLIGHT_EXPLANATION : RESTORED_EXPLANATION}
          </p>
        )}
        <p className="mt-0.5 text-xs">{detail}</p>
      </div>
      {observed ? (
        <button
          type="button"
          onClick={() => onDismiss(rootRef.current?.contains(document.activeElement) ?? false)}
          aria-label="Dismiss notice"
          className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-white/5"
        >
          <CloseLineIcon className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        canCheckHere &&
        readStatus !== "pending" &&
        readStatus !== "failed" && (
          <button
            type="button"
            onClick={() => {
              if (!checking) onCheckAgain();
            }}
            aria-disabled={checking || undefined}
            className="shrink-0 rounded-lg border border-warning-300 px-3 py-1 text-xs font-medium hover:bg-warning-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 dark:border-warning-500/40 dark:hover:bg-white/5"
          >
            Check again
          </button>
        )
      )}
    </div>
  );
};

const AssignmentNotice = React.forwardRef<
  HTMLDivElement,
  {
    text: string;
    reloadStatus: BoardReloadStatus;
    writtenRange: { from: string; to: string } | null;
    onDismiss: () => void;
  }
>(function AssignmentNotice({ text, reloadStatus, writtenRange, onDismiss }, ref) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className="mx-2 mt-2 flex items-start justify-between gap-3 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-success-500/60 sm:mx-4 dark:bg-success-500/10 dark:text-success-300"
    >
      <div>
        <p className="font-medium">{text}</p>
        <p className="mt-0.5 text-xs">
          {reloadStatus === "done"
            ? "Saved on the server. The board has been reloaded from the server."
            : reloadStatus === "failed"
              ? "Saved on the server, but the board could not be reloaded. Use Retry to see the latest data."
              : reloadStatus === "elsewhere"
                ? `Saved on the server, but the board for ${writtenRange ? `[${writtenRange.from}, ${writtenRange.to})` : "that range"} has not been reloaded since the view changed. Return to it to see the result.`
                : "Saved on the server. Reloading the board…"}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-success-100 dark:hover:bg-white/5"
      >
        <CloseLineIcon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
});

/**
 * PMS-CAL-001.2-CP03A-C2: one create whose response was lost. It stays on the
 * board — and its nights stay locked — until the server's data resolves it;
 * checking again only re-reads the board and never re-sends the create.
 */
const UncertainWriteNotice: React.FC<{
  entry: Reconciliation;
  readStatus: BoardReloadStatus;
  canCheckHere: boolean;
  checking: boolean;
  onCheckAgain: () => void;
  /** `noticeOwnedFocus`: focus was inside this notice, which is about to unmount. */
  onDismiss: (noticeOwnedFocus: boolean) => void;
}> = ({ entry, readStatus, canCheckHere, checking, onCheckAgain, onDismiss }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { target } = entry;
  const range = `[${target.startDate}, ${target.endDate})`;
  const resolved = entry.resolution === "observed" || entry.resolution === "changed";
  const operationLabel = target.operation === "create" ? "room assignment" : target.operation === "move" ? "room move" : "room unassign";
  let detail: string;
  if (entry.resolution === "observed") {
    detail = `An assignment matching this request — room ${target.roomNumber} for ${range} — is now shown on the server.`;
  } else if (entry.resolution === "changed") {
    detail =
      "These nights have since changed on the server, so this request can no longer take effect. Its own result was never confirmed.";
  } else if (readStatus === "pending") {
    detail = "Checking the board on the server…";
  } else if (readStatus === "failed") {
    detail = "The board could not be reloaded, so the result is still unknown. Use Retry on the board.";
  } else if (!canCheckHere) {
    // `canCheckHere` applies the correct per-operation window rule — full
    // containment for create, overlap for move and unassign (CP04C.3-C1/C2,
    // CP04D.3) — so the guidance text must match it exactly.
    detail =
      target.operation === "move" || target.operation === "unassign"
        ? `The result is still unknown and this segment stays locked. Open a view of this Property that overlaps ${range} to check again.`
        : `The result is still unknown and these nights stay locked. Open a view of this Property that includes ${range} to check again.`;
  } else if (checking) {
    detail = "Checking the board on the server again…";
  } else if (target.operation === "unassign") {
    // PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: an unassign's "unresolved" state
    // means the *source* room assignment is still shown, unchanged — never
    // "no matching assignment", which describes a destination that an
    // unassign never has in the first place.
    detail =
      "The board was checked, and the room assignment is still shown unchanged, so the result is still unknown. This segment stays locked and the request will not be sent again.";
  } else {
    detail =
      "The board was checked, but no matching assignment is shown yet, so the result is still unknown. These nights stay locked and the request will not be sent again.";
  }

  return (
    <div
      ref={rootRef}
      role="status"
      data-testid="uncertain-write-notice"
      className={`mx-2 mt-2 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm sm:mx-4 ${
        resolved
          ? "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-200"
          : "bg-warning-50 text-warning-800 dark:bg-warning-500/10 dark:text-warning-300"
      }`}
    >
      <div>
        <p className="font-medium">
          {entry.restored
            ? `Unconfirmed ${operationLabel} request ${entry.restored === "in-flight" ? "sent just" : "from"} before this page was reloaded or left: room ${target.roomNumber}, ${range}.`
            : `Unconfirmed request: room ${target.roomNumber} for ${target.guestDisplayName} (${target.confirmationNumber}), ${range}.`}
        </p>
        {entry.restored && (
          <p className="mt-0.5 text-xs">
            {entry.restored === "in-flight" ? RESTORED_IN_FLIGHT_EXPLANATION : RESTORED_EXPLANATION}
          </p>
        )}
        <p className="mt-0.5 text-xs">{detail}</p>
      </div>
      {resolved ? (
        <button
          type="button"
          onClick={() => onDismiss(rootRef.current?.contains(document.activeElement) ?? false)}
          aria-label="Dismiss notice"
          className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-white/5"
        >
          <CloseLineIcon className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        canCheckHere &&
        readStatus !== "pending" &&
        readStatus !== "failed" && (
          <button
            type="button"
            onClick={() => {
              if (!checking) onCheckAgain();
            }}
            aria-disabled={checking || undefined}
            className="shrink-0 rounded-lg border border-warning-300 px-3 py-1 text-xs font-medium hover:bg-warning-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 dark:border-warning-500/40 dark:hover:bg-white/5"
          >
            Check again
          </button>
        )
      )}
    </div>
  );
};

const CenteredMessage: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="flex min-h-40 items-center justify-center px-4 py-10 text-sm text-gray-500 dark:text-gray-400">
    {children}
  </div>
);

const ErrorMessage: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
    <AlertIcon className="size-6 text-error-500" aria-hidden="true" />
    <p className="max-w-sm text-sm text-gray-600 dark:text-gray-300">{message}</p>
    <button
      type="button"
      onClick={onRetry}
      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
    >
      Retry
    </button>
  </div>
);

export default ReservationBoard;
