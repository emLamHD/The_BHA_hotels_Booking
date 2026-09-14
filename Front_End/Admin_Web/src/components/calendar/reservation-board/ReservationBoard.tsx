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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReservationBoardToolbar from "./ReservationBoardToolbar";
import ReservationBoardServerTimeline, {
  type BlockSelection,
  type StaySelection,
  type UnassignedRangeSelection,
} from "./ReservationBoardServerTimeline";
import ReservationBoardStayPopover from "./ReservationBoardStayPopover";
import ReservationAssignmentDialog, { type BoardReloadStatus } from "./ReservationAssignmentDialog";
import { boardIdentityKey, buildAssignmentTarget, type AssignmentTarget } from "./assignmentTarget";
import { describeAssignmentOutcome } from "./assignmentOutcome";
import {
  isBoardAwaitingReconciliation,
  isUnassignedRangeUnresolved,
  settleReconciliations,
  type Reconciliation,
} from "./reconciliation";
import { AlertIcon, CloseLineIcon } from "@/icons";
import {
  buildVisibleRange,
  computeVisibleStartFromAnchor,
  addDaysIso,
  formatIsoDate,
  formatRangeLabel,
} from "./dateMath";
import type { IsoDate, ReservationBoardFilters, ReservationBoardRangeLength } from "./types";
import {
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  type ApiError,
  type AssignmentCreateOutcome,
} from "@/lib/api/client";
import type { ApiProperty, ReservationBoardResponse, ReservationBoardUnassignedRange } from "@/lib/api/types";

const INITIAL_RANGE_LENGTH: ReservationBoardRangeLength = 14;

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

const ReservationBoard: React.FC = () => {
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
  /**
   * Rendered from state; decided from the ref. The ref is updated
   * synchronously the moment a write resolves, so a click that lands before
   * React has re-rendered the board is still refused.
   */
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const reconciliationsRef = useRef<Reconciliation[]>([]);
  const nextReconciliationIdRef = useRef(1);
  const referencedReconciliationIdsRef = useRef<{ dialog: number | null; notice: number | null }>({
    dialog: null,
    notice: null,
  });
  const noticeRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateReconciliations = useCallback((update: (list: Reconciliation[]) => Reconciliation[]) => {
    const next = update(reconciliationsRef.current);
    if (next === reconciliationsRef.current) return;
    reconciliationsRef.current = next;
    setReconciliations(next);
  }, []);

  useEffect(() => {
    referencedReconciliationIdsRef.current = {
      dialog: dialogReconciliationId,
      notice: assignmentNotice?.reconciliationId ?? null,
    };
  }, [dialogReconciliationId, assignmentNotice]);

  // Initial load: real active Properties, then deterministically select the
  // first and derive the initial anchor from its own time zone.
  useEffect(() => {
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
  }, []);

  const rangeStart = anchorDate ? computeVisibleStartFromAnchor(anchorDate, rangeLength) : null;
  const range = rangeStart ? buildVisibleRange(rangeStart, rangeLength) : null;

  // Refetch whenever Property, visible range, or Retry changes. Stale-response
  // protection: an AbortController per request, plus a monotonic sequence
  // number checked before committing results (belt-and-suspenders in case a
  // fetch polyfill/environment does not fully honor abort).
  useEffect(() => {
    if (!selectedPropertyId || !range) return;
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
        setBoardState({ status: "error", error: result.error });
        updateReconciliations((list) => settleReconciliations(list, requestKey, thisSeq, { kind: "failed" }));
        return;
      }
      setBoardState({ status: "loaded", board: result.data });
      updateReconciliations((list) =>
        settleReconciliations(list, requestKey, thisSeq, { kind: "loaded", board: result.data })
      );
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPropertyId, range?.start, range?.endExclusive, retryToken]);

  const handleSelectProperty = useCallback(
    (propertyId: string) => {
      setSelectedPropertyId(propertyId);
      setSelection(null);
      setAssignmentTarget(null);
      setAssignmentNotice(null);
      if (propertiesState.status === "loaded") {
        const property = propertiesState.properties.find((candidate) => candidate.id === propertyId);
        if (property) {
          setAnchorDate(todayInTimeZone(property.timeZone));
        }
      }
    },
    [propertiesState]
  );

  const handlePrev = useCallback(() => {
    if (!anchorDate) return;
    setAnchorDate(addDaysIso(anchorDate, -rangeLength));
  }, [anchorDate, rangeLength]);

  const handleNext = useCallback(() => {
    if (!anchorDate) return;
    setAnchorDate(addDaysIso(anchorDate, rangeLength));
  }, [anchorDate, rangeLength]);

  const handleToday = useCallback(() => {
    if (propertiesState.status !== "loaded" || !selectedPropertyId) return;
    const property = propertiesState.properties.find((candidate) => candidate.id === selectedPropertyId);
    if (property) {
      setAnchorDate(todayInTimeZone(property.timeZone));
    }
  }, [propertiesState, selectedPropertyId]);

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
      if (isBoardAwaitingReconciliation(reconciliationsRef.current, displayedKey)) {
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
      const target = buildAssignmentTarget(boardState.board, selectedPropertyId, unassignedSelection);
      if (!target) return;
      setSelection(null);
      setDialogReconciliationId(null);
      setAssignmentTarget(target);
    },
    [boardState, selectedPropertyId]
  );

  const submitAssignment = useCallback(
    async (target: AssignmentTarget, physicalRoomId: string): Promise<AssignmentCreateOutcome> => {
      // Only a room the dialog was built with can be sent — never an arbitrary id.
      const room = target.candidateRooms.find((candidate) => candidate.id === physicalRoomId);
      if (!room) {
        return { kind: "not-sent", message: "Choose one of the listed rooms." };
      }

      const outcome = await createReservationAssignment(target.propertyId, {
        reservationUnitId: target.stay.reservationUnitId,
        physicalRoomId: room.id,
        startDate: target.unassignedRange.startDate,
        endDate: target.unassignedRange.endDate,
        confirmCrossRoomType: false,
      });
      if (!mountedRef.current) return outcome;

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
          target: {
            reservationUnitId: target.stay.reservationUnitId,
            physicalRoomId: room.id,
            startDate: target.unassignedRange.startDate,
            endDate: target.unassignedRange.endDate,
            roomNumber: room.roomNumber,
            guestDisplayName: target.stay.guestDisplayName,
            confirmationNumber: target.stay.confirmationNumber,
          },
          status: "pending",
          resolution: uncertain ? "unresolved" : "settled",
        };
        const referenced = referencedReconciliationIdsRef.current;
        updateReconciliations((list) => [
          // Settled entries are kept only while a notice or dialog still shows
          // them; uncertain ones stay until the operator dismisses a resolved one.
          ...list.filter(
            (entry) =>
              entry.status !== "done" ||
              entry.certainty === "uncertain" ||
              entry.id === referenced.dialog ||
              entry.id === referenced.notice
          ),
          reconciliation,
        ]);
        setDialogReconciliationId(reconciliation.id);
        if (outcome.kind === "created") {
          setAssignmentTarget(null);
          setAssignmentNotice({
            text: `Room ${room.roomNumber} assigned to ${target.stay.guestDisplayName} (${target.stay.confirmationNumber}) for [${target.unassignedRange.startDate}, ${target.unassignedRange.endDate}).`,
            reconciliationId: reconciliation.id,
          });
        }
        setRetryToken((token) => token + 1);
      }
      return outcome;
    },
    [updateReconciliations]
  );

  const currentBoardKey =
    selectedPropertyId && range ? boardIdentityKey(selectedPropertyId, range.start, range.endExclusive) : null;

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

  const dialogReconciliation =
    dialogReconciliationId === null
      ? null
      : reconciliations.find((entry) => entry.id === dialogReconciliationId) ?? null;

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

  const boardCanShow = (entry: Reconciliation) =>
    boardState.status === "loaded" &&
    boardState.board.property.id === entry.propertyId &&
    boardState.board.from <= entry.target.startDate &&
    boardState.board.to >= entry.target.endDate;

  const noticeReconciliation =
    assignmentNotice === null
      ? null
      : reconciliations.find((entry) => entry.id === assignmentNotice.reconciliationId) ?? null;

  const displayedBoardAwaitingReconciliation =
    boardState.status === "loaded" &&
    isBoardAwaitingReconciliation(
      reconciliations,
      boardIdentityKey(boardState.board.property.id, boardState.board.from, boardState.board.to)
    );

  // A new notice takes focus: the bar that opened the dialog is gone once the
  // board reloads, so focus would otherwise fall back to the document.
  useEffect(() => {
    if (assignmentNotice) noticeRef.current?.focus();
  }, [assignmentNotice]);

  const rangeLabel = range ? formatRangeLabel(range) : "";

  const body = useMemo(() => {
    if (propertiesState.status === "loading") {
      return <CenteredMessage>Loading properties…</CenteredMessage>;
    }
    if (propertiesState.status === "error") {
      return (
        <ErrorMessage message={propertiesState.error.message} onRetry={() => window.location.reload()} />
      );
    }
    if (propertiesState.properties.length === 0) {
      return <CenteredMessage>No active properties are available.</CenteredMessage>;
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
        onSelectStay={(value) => setSelection({ kind: "stay", value })}
        onSelectUnassignedRange={handleSelectUnassignedRange}
        onSelectBlock={(value) => setSelection({ kind: "block", value })}
        unassignedActionsBlocked={displayedBoardAwaitingReconciliation}
        isUnassignedRangeUnconfirmed={isRangeUnconfirmed}
      />
    );
  }, [
    propertiesState,
    boardState,
    range,
    filters,
    handleRetry,
    handleSelectUnassignedRange,
    displayedBoardAwaitingReconciliation,
    isRangeUnconfirmed,
  ]);

  const toolbarProperties = propertiesState.status === "loaded" ? propertiesState.properties : [];

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <ReservationBoardToolbar
        properties={toolbarProperties}
        selectedPropertyId={selectedPropertyId ?? ""}
        onSelectProperty={handleSelectProperty}
        rangeLength={rangeLength}
        onSelectRangeLength={setRangeLength}
        rangeLabel={rangeLabel}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        filters={filters}
        onToggleFilter={handleToggleFilter}
      />
      {assignmentNotice && (
        <AssignmentNotice
          ref={noticeRef}
          text={assignmentNotice.text}
          reloadStatus={reconciliationStatus(assignmentNotice.reconciliationId)}
          writtenRange={noticeReconciliation ? { from: noticeReconciliation.from, to: noticeReconciliation.to } : null}
          onDismiss={() => setAssignmentNotice(null)}
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
          onDismiss={() => dismissReconciliation(entry.id)}
        />
      ))}
      {boardState.status === "loaded" && boardState.refreshing && (
        <p role="status" className="px-4 pt-2 text-xs text-gray-500 dark:text-gray-400">
          Refreshing board from the server…
        </p>
      )}
      <div className="p-2 sm:p-4">{body}</div>
      {selection && <ReservationBoardStayPopover selection={selection} onClose={() => setSelection(null)} />}
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
          onSubmit={(physicalRoomId) => submitAssignment(assignmentTarget, physicalRoomId)}
          onClose={() => setAssignmentTarget(null)}
        />
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
  onDismiss: () => void;
}> = ({ entry, readStatus, canCheckHere, checking, onCheckAgain, onDismiss }) => {
  const { target } = entry;
  const range = `[${target.startDate}, ${target.endDate})`;
  const resolved = entry.resolution === "observed" || entry.resolution === "changed";
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
    detail = `The result is still unknown and these nights stay locked. Open a view of this Property that includes ${range} to check again.`;
  } else {
    detail = checking
      ? "Checking the board on the server again…"
      : "The board was checked, but no matching assignment is shown yet, so the result is still unknown. These nights stay locked and the request will not be sent again.";
  }

  return (
    <div
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
          Unconfirmed request: room {target.roomNumber} for {target.guestDisplayName} ({target.confirmationNumber}),{" "}
          {range}.
        </p>
        <p className="mt-0.5 text-xs">{detail}</p>
      </div>
      {resolved ? (
        <button
          type="button"
          onClick={onDismiss}
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
