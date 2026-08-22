"use client";

import React, { useEffect, useRef, useState } from "react";
import { CloseLineIcon, InfoIcon, PlusIcon } from "@/icons";
import { diffDaysIso, formatDisplayDate } from "./dateMath";
import {
  canCancel,
  canCheckIn,
  canCheckOut,
  canEditGuest,
  canEditStay,
  canMarkNoShow,
  canMove,
  canRecordPayment,
  canRecordRefund,
  computeFolioSummary,
  DERIVED_PAYMENT_STATUS_LABEL,
  findBlockingItem,
  formatVnd,
  hasBlockReasonChanges,
  hasGuestChanges,
  hasStayChanges,
  PAYMENT_METHOD_LABEL,
} from "./reservationRuntime";
import type { EditGuestInput, EditStayInput, RecordPaymentInput, RecordRefundInput } from "./reservationRuntime";
import {
  isValidFolioAmount,
  isValidOccupancyCount,
  isValidOptionalEmail,
  isValidReservationIsoDate,
  LIFECYCLE_STATUS_LABEL,
  MAX_ACTUAL_NIGHTLY_AMOUNT,
  MAX_ADULTS_PER_UNIT,
  MAX_CHILDREN_PER_UNIT,
  MAX_RESERVATION_DATE,
  MIN_RESERVATION_DATE,
  parseActualNightlyAmount,
  permittedLifecycleActions,
} from "./types";
import type {
  BookingSource,
  BookingSourceId,
  DerivedPaymentStatus,
  GuestNationality,
  IsoDate,
  PhysicalRoom,
  ReservationLifecycleStatus,
  ReservationPaymentMethod,
  RoomType,
  TimelineItem,
} from "./types";

interface TimelineItemDetailsDialogProps {
  item: TimelineItem;
  items: TimelineItem[];
  physicalRooms: PhysicalRoom[];
  roomTypes: RoomType[];
  bookingSources: BookingSource[];
  nationalities: GuestNationality[];
  onClose: () => void;
  onRequestMove: (itemId: string) => void;
  onConfirmReservation: (itemId: string) => void;
  onCheckIn: (itemId: string, note: string) => void;
  onCheckOut: (itemId: string, note: string, overrideReason: string) => void;
  onCancelReservation: (itemId: string, reason: string) => void;
  onMarkNoShow: (itemId: string, reason: string, feeAmount: number | null) => void;
  onEditGuest: (itemId: string, guest: EditGuestInput) => void;
  onEditStay: (itemId: string, stay: EditStayInput) => void;
  onRecordPayment: (itemId: string, input: RecordPaymentInput) => void;
  onRecordRefund: (itemId: string, input: RecordRefundInput) => void;
  onAddNote: (itemId: string, content: string) => void;
  onRemoveBlock: (blockId: string, reason: string) => void;
  onEditBlockReason: (blockId: string, reason: string) => void;
}

const TITLE_ID = "timeline-item-details-title";

type ReservationTab = "overview" | "stay" | "folio" | "notes";
type ReservationPanel =
  | "check-in"
  | "check-out"
  | "cancel"
  | "no-show"
  | "edit-guest"
  | "edit-stay"
  | "record-payment"
  | "record-refund"
  | null;

const inputClassName =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-white/[0.02]";
const invalidInputClassName = "border-error-300 focus:border-error-300 focus:ring-error-500/10 dark:border-error-500/60";
const labelClassName = "mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300";
const errorTextClassName = "mt-1 text-xs text-error-600 dark:text-error-400";
const fieldLabelClassName = "text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500";
const fieldValueClassName = "text-sm font-medium text-gray-800 dark:text-white/90";
const primaryButtonClassName =
  "h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400";
const secondaryButtonClassName =
  "h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5";
const dangerButtonClassName =
  "h-10 rounded-lg bg-error-500 px-4 text-sm font-medium text-white hover:bg-error-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-error-500/40 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500";
const cardClassName = "rounded-lg border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-white/[0.02]";
const noticeClassName =
  "flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200";

const LIFECYCLE_CHIP_CLASSNAME: Record<ReservationLifecycleStatus, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  confirmed: "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300",
  "checked-in": "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
  "checked-out": "bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400",
  cancelled: "bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-400",
  "no-show": "bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-400",
};

const PAYMENT_CHIP_CLASSNAME: Record<DerivedPaymentStatus, string> = {
  unpaid: "bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-400",
  partial: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  paid: "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400",
  overpaid: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
};

function nightsLabel(nights: number): string {
  return `${nights} night${nights === 1 ? "" : "s"}`;
}

function occupancyLabel(adults: number, children: number): string {
  const adultsLabel = `${adults} adult${adults === 1 ? "" : "s"}`;
  return children > 0 ? `${adultsLabel} · ${children} child${children === 1 ? "" : "ren"}` : adultsLabel;
}

function isOtaSource(sourceId: BookingSourceId): boolean {
  return sourceId === "booking_com" || sourceId === "agoda";
}

const OTA_SYNC_NOTICE = "Demo only — channel synchronization is not implemented.";

/**
 * Front-desk reservation operations workspace (ADMIN-002.1-C6). Larger than
 * the C5 read-only dialog: a sticky header with lifecycle-dependent actions,
 * four tabs, and internal action panels (never nested modals) for every
 * mutation. Every mutation is dispatched through `reservationRuntime.ts` via
 * the handlers passed down from `ReservationBoard.tsx` — this component
 * owns only its own open-tab/open-panel/form-draft UI state.
 */
const TimelineItemDetailsDialog: React.FC<TimelineItemDetailsDialogProps> = ({
  item,
  items,
  physicalRooms,
  roomTypes,
  bookingSources,
  nationalities,
  onClose,
  onRequestMove,
  onConfirmReservation,
  onCheckIn,
  onCheckOut,
  onCancelReservation,
  onMarkNoShow,
  onEditGuest,
  onEditStay,
  onRecordPayment,
  onRecordRefund,
  onAddNote,
  onRemoveBlock,
  onEditBlockReason,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeTab, setActiveTab] = useState<ReservationTab>("overview");
  const [activePanel, setActivePanel] = useState<ReservationPanel>(null);
  const [blockPanel, setBlockPanel] = useState<"edit-reason" | "remove" | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (activePanel || blockPanel) {
        setActivePanel(null);
        setBlockPanel(null);
        return;
      }
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const container = panelRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const durationNights = diffDaysIso(item.startDate, item.endDate);
  const room =
    item.kind === "assigned-reservation" || item.kind === "operational-block"
      ? physicalRooms.find((candidate) => candidate.id === item.roomId) ?? null
      : null;
  const roomType =
    (room && roomTypes.find((candidate) => candidate.id === room.roomTypeId)) ??
    (item.kind !== "operational-block"
      ? roomTypes.find((candidate) => candidate.id === item.soldRoomTypeId) ?? null
      : null);

  // ---------------------------------------------------------------------
  // Operational block workspace — a distinct, smaller shell. Never shows
  // guest/payment/reservation fields (§14).
  // ---------------------------------------------------------------------
  if (item.kind === "operational-block") {
    const moveEligibility = canMove(item);
    return (
      <div
        className="fixed inset-0 z-999999 flex items-center justify-center overflow-y-auto bg-gray-900/70 p-4 dark:bg-gray-950/80"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !blockPanel) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          onKeyDown={handleKeyDown}
          className="my-8 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 sm:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Operational block
            </h3>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <CloseLineIcon className="size-4" aria-hidden="true" />
            </button>
          </div>

          {blockPanel === "edit-reason" ? (
            <BlockEditReasonPanel
              initialReason={item.reason}
              onCancel={() => setBlockPanel(null)}
              onSave={(reason) => {
                onEditBlockReason(item.id, reason);
                setBlockPanel(null);
              }}
            />
          ) : blockPanel === "remove" ? (
            <BlockRemovePanel
              onCancel={() => setBlockPanel(null)}
              onConfirm={(reason) => {
                onRemoveBlock(item.id, reason);
                setBlockPanel(null);
                onClose();
              }}
            />
          ) : item.removed ? (
            <>
              <div className={`mt-4 ${cardClassName}`}>
                <p className={fieldValueClassName}>This operational block has been removed.</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Retained here for audit — it no longer occupies inventory.
                </p>
              </div>
              <BlockOverviewGrid item={item} room={room} roomType={roomType} durationNights={durationNights} />
              <BlockActivityList activity={item.activity} />
            </>
          ) : (
            <>
              <BlockOverviewGrid item={item} room={room} roomType={roomType} durationNights={durationNights} />
              <BlockActivityList activity={item.activity} />
              <p className={`mt-3 ${noticeClassName}`}>
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Demo only — not saved to the backend.
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button type="button" onClick={onClose} className={secondaryButtonClassName}>
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setBlockPanel("edit-reason")}
                  className={secondaryButtonClassName}
                >
                  Edit reason
                </button>
                <button
                  type="button"
                  disabled={!moveEligibility.allowed}
                  onClick={() => onRequestMove(item.id)}
                  className={primaryButtonClassName}
                  title={moveEligibility.reason}
                >
                  Move block
                </button>
                <button type="button" onClick={() => setBlockPanel("remove")} className={dangerButtonClassName}>
                  Remove block
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Reservation operations workspace
  // ---------------------------------------------------------------------
  const source = bookingSources.find((candidate) => candidate.id === item.sourceId);
  const physicalRoomLabel = room ? `Room ${room.code}` : "Unassigned";
  const folioSummary = computeFolioSummary(item);
  const actions = permittedLifecycleActions(item.lifecycleStatus);
  const propertyPhysicalRoomIds = new Set(physicalRooms.map((candidate) => candidate.id));
  const moveEligibility = canMove(item);

  const closePanel = () => setActivePanel(null);
  const announce = (message: string) => setAnnouncement(message);

  const tabs: { id: ReservationTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "stay", label: "Stay & guest" },
    { id: "folio", label: "Folio" },
    { id: "notes", label: "Notes & activity" },
  ];

  return (
    <div
      className="fixed inset-0 z-999999 flex items-center justify-center overflow-y-auto bg-gray-900/70 p-4 dark:bg-gray-950/80"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        onKeyDown={handleKeyDown}
        className="my-8 flex w-full flex-col rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
        style={{ width: "min(1120px, calc(100vw - 32px))", maxHeight: "90dvh" }}
      >
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {/* Sticky header */}
        <div className="shrink-0 rounded-t-2xl border-b border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
                  {item.guestName}
                </h3>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${LIFECYCLE_CHIP_CLASSNAME[item.lifecycleStatus]}`}
                >
                  {LIFECYCLE_STATUS_LABEL[item.lifecycleStatus]}
                </span>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${PAYMENT_CHIP_CLASSNAME[folioSummary.status]}`}>
                  {DERIVED_PAYMENT_STATUS_LABEL[folioSummary.status]}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                {item.reservationCode} · {source?.label ?? item.sourceId} · {physicalRoomLabel} ·{" "}
                {formatDisplayDate(item.startDate)} → {formatDisplayDate(item.endDate)} ·{" "}
                {folioSummary.balanceDue > 0
                  ? `${formatVnd(folioSummary.balanceDue)} due`
                  : "No balance due"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions.includes("confirm") ? (
                <button
                  type="button"
                  onClick={() => {
                    onConfirmReservation(item.id);
                    announce("Reservation confirmed.");
                  }}
                  className={primaryButtonClassName}
                >
                  Confirm
                </button>
              ) : null}
              {actions.includes("check-in") ? (
                <button type="button" onClick={() => setActivePanel("check-in")} className={primaryButtonClassName}>
                  Check in
                </button>
              ) : null}
              {actions.includes("check-out") ? (
                <button type="button" onClick={() => setActivePanel("check-out")} className={primaryButtonClassName}>
                  Check out
                </button>
              ) : null}
              {actions.includes("no-show") ? (
                <button type="button" onClick={() => setActivePanel("no-show")} className={secondaryButtonClassName}>
                  Mark no-show
                </button>
              ) : null}
              {actions.includes("cancel") ? (
                <button type="button" onClick={() => setActivePanel("cancel")} className={dangerButtonClassName}>
                  Cancel reservation
                </button>
              ) : null}
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-white/5 dark:hover:text-gray-300"
              >
                <CloseLineIcon className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {actions.length === 0 ? (
            <p className={`mt-3 ${noticeClassName}`}>
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              This reservation is {LIFECYCLE_STATUS_LABEL[item.lifecycleStatus].toLowerCase()} — no further
              lifecycle actions are available. Create a new reservation instead.
            </p>
          ) : null}

          <div role="tablist" aria-label="Reservation details" className="mt-4 flex gap-1 border-b border-gray-200 dark:border-gray-800">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`tabpanel-${tab.id}`}
                onClick={() => {
                  setActivePanel(null);
                  setActiveTab(tab.id);
                }}
                className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                  activeTab === tab.id
                    ? "border-brand-500 text-brand-600 dark:text-brand-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {activePanel === "check-in" ? (
            <CheckInPanel
              item={item}
              propertyPhysicalRoomIds={propertyPhysicalRoomIds}
              onCancel={closePanel}
              onConfirm={(note) => {
                onCheckIn(item.id, note);
                announce("Guest checked in.");
                closePanel();
              }}
            />
          ) : activePanel === "check-out" ? (
            <CheckOutPanel
              item={item}
              folioSummary={folioSummary}
              onCancel={closePanel}
              onConfirm={(note, overrideReason) => {
                onCheckOut(item.id, note, overrideReason);
                announce("Guest checked out.");
                closePanel();
              }}
            />
          ) : activePanel === "cancel" ? (
            <CancelPanel
              item={item}
              onCancel={closePanel}
              onConfirm={(reason) => {
                onCancelReservation(item.id, reason);
                announce("Reservation cancelled.");
                closePanel();
              }}
            />
          ) : activePanel === "no-show" ? (
            <NoShowPanel
              item={item}
              onCancel={closePanel}
              onConfirm={(reason, feeAmount) => {
                onMarkNoShow(item.id, reason, feeAmount);
                announce("Reservation marked no-show.");
                closePanel();
              }}
            />
          ) : activePanel === "edit-guest" ? (
            <EditGuestPanel
              item={item}
              nationalities={nationalities}
              onCancel={closePanel}
              onSave={(guest) => {
                onEditGuest(item.id, guest);
                announce("Guest information updated.");
                closePanel();
              }}
            />
          ) : activePanel === "edit-stay" ? (
            <EditStayPanel
              item={item}
              items={items}
              roomTypes={roomTypes}
              physicalRooms={physicalRooms}
              bookingSources={bookingSources}
              onCancel={closePanel}
              onSave={(stay) => {
                onEditStay(item.id, stay);
                announce("Stay details updated.");
                closePanel();
              }}
            />
          ) : activePanel === "record-payment" ? (
            <RecordPaymentPanel
              onCancel={closePanel}
              onSave={(input) => {
                onRecordPayment(item.id, input);
                announce("Payment recorded.");
                closePanel();
              }}
            />
          ) : activePanel === "record-refund" ? (
            <RecordRefundPanel
              maxAmount={folioSummary.totalCollected}
              onCancel={closePanel}
              onSave={(input) => {
                onRecordRefund(item.id, input);
                announce("Refund recorded.");
                closePanel();
              }}
            />
          ) : activeTab === "overview" ? (
            <OverviewTab item={item} room={room} roomType={roomType} source={source} durationNights={durationNights} folioSummary={folioSummary} />
          ) : activeTab === "stay" ? (
            <StayGuestTab
              item={item}
              room={room}
              roomType={roomType}
              source={source}
              durationNights={durationNights}
              moveEligibility={moveEligibility}
              onRequestMove={() => onRequestMove(item.id)}
              onEditGuest={() => setActivePanel("edit-guest")}
              onEditStay={() => setActivePanel("edit-stay")}
            />
          ) : activeTab === "folio" ? (
            <FolioTab
              item={item}
              folioSummary={folioSummary}
              onRecordPayment={() => setActivePanel("record-payment")}
              onRecordRefund={() => setActivePanel("record-refund")}
            />
          ) : (
            <NotesActivityTab item={item} onAddNote={(content) => onAddNote(item.id, content)} />
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------
const OverviewTab: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  room: PhysicalRoom | null;
  roomType: RoomType | null;
  source: BookingSource | undefined;
  durationNights: number;
  folioSummary: ReturnType<typeof computeFolioSummary>;
}> = ({ item, room, roomType, source, durationNights, folioSummary }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div className={cardClassName}>
      <p className={fieldLabelClassName}>Guest</p>
      <p className={fieldValueClassName}>
        {item.guestName} <span aria-hidden="true">{item.nationality.flag}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.guestPhone}</p>
      {item.guestEmail ? <p className="text-xs text-gray-500 dark:text-gray-400">{item.guestEmail}</p> : null}
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {occupancyLabel(item.occupancy.adults, item.occupancy.children)}
      </p>
    </div>
    <div className={cardClassName}>
      <p className={fieldLabelClassName}>Stay</p>
      <p className={fieldValueClassName}>
        {roomType?.name ?? "—"} · {room ? `Room ${room.code}` : "Unassigned"}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {formatDisplayDate(item.startDate)} · {item.checkInTime} → {formatDisplayDate(item.endDate)} ·{" "}
        {item.checkOutTime}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{nightsLabel(durationNights)} · {source?.label ?? item.sourceId}</p>
    </div>
    <div className={`sm:col-span-2 ${cardClassName}`}>
      <p className={fieldLabelClassName}>Balance</p>
      <div className="mt-1 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Total charges</p>
          <p className={fieldValueClassName}>{formatVnd(folioSummary.totalCharges)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Collected</p>
          <p className={fieldValueClassName}>{formatVnd(folioSummary.totalCollected)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Balance due</p>
          <p className={fieldValueClassName}>{formatVnd(folioSummary.balanceDue)}</p>
        </div>
      </div>
    </div>
    {item.actualCheckInAt !== null || item.actualCheckOutAt !== null ? (
      <div className={`sm:col-span-2 ${cardClassName}`}>
        <p className={fieldLabelClassName}>Actual timestamps</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {item.actualCheckInAt !== null ? "Checked in this session. " : "Not yet checked in. "}
          {item.actualCheckOutAt !== null ? "Checked out this session." : ""}
        </p>
      </div>
    ) : null}
  </div>
);

// ---------------------------------------------------------------------
// Stay & guest tab
// ---------------------------------------------------------------------
const StayGuestTab: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  room: PhysicalRoom | null;
  roomType: RoomType | null;
  source: BookingSource | undefined;
  durationNights: number;
  moveEligibility: { allowed: boolean; reason?: string };
  onRequestMove: () => void;
  onEditGuest: () => void;
  onEditStay: () => void;
}> = ({ item, room, roomType, source, durationNights, moveEligibility, onRequestMove, onEditGuest, onEditStay }) => {
  const guestEligibility = canEditGuest(item);
  const stayEligibility = canEditStay(item);
  const priceResult = parseActualNightlyAmount(item.actualNightlyAmount);
  const effectiveAmount = priceResult.isValid && !priceResult.isBlank ? priceResult.amount! : item.nightlyRate;

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClassName}>
        <div className="flex items-center justify-between">
          <p className={fieldLabelClassName}>Guest details</p>
          <button
            type="button"
            disabled={!guestEligibility.allowed}
            onClick={onEditGuest}
            title={guestEligibility.reason}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-brand-400"
          >
            Edit guest
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className={fieldLabelClassName}>Full name</p>
            <p className={fieldValueClassName}>{item.guestName}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Phone</p>
            <p className={fieldValueClassName}>{item.guestPhone}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Email</p>
            <p className={fieldValueClassName}>{item.guestEmail || "—"}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Nationality</p>
            <p className={fieldValueClassName}>
              <span aria-hidden="true">{item.nationality.flag}</span> {item.nationality.label}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Occupancy</p>
            <p className={fieldValueClassName}>{occupancyLabel(item.occupancy.adults, item.occupancy.children)}</p>
          </div>
        </div>
      </div>

      <div className={cardClassName}>
        <div className="flex items-center justify-between">
          <p className={fieldLabelClassName}>Stay details</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!stayEligibility.allowed}
              onClick={onEditStay}
              title={stayEligibility.reason}
              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-brand-400"
            >
              Edit stay
            </button>
            <button
              type="button"
              disabled={!moveEligibility.allowed}
              onClick={onRequestMove}
              title={moveEligibility.reason}
              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-brand-400"
            >
              Move / adjust stay
            </button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className={fieldLabelClassName}>Booking source</p>
            <p className={fieldValueClassName}>{source?.label ?? item.sourceId}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Sold room type</p>
            <p className={fieldValueClassName}>{roomType?.name ?? "—"}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Assigned room</p>
            <p className={fieldValueClassName}>{room ? `Room ${room.code}` : "Unassigned"}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Nights</p>
            <p className={fieldValueClassName}>{nightsLabel(durationNights)}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Check-in</p>
            <p className={fieldValueClassName}>
              {formatDisplayDate(item.startDate)} · {item.checkInTime}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Checkout</p>
            <p className={fieldValueClassName}>
              {formatDisplayDate(item.endDate)} · {item.checkOutTime}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Reference nightly rate</p>
            <p className={fieldValueClassName}>{formatVnd(item.nightlyRate)}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Effective nightly rate</p>
            <p className={fieldValueClassName}>
              {formatVnd(effectiveAmount)}
              {!priceResult.isBlank ? " (negotiated)" : ""}
            </p>
          </div>
        </div>
      </div>

      {!stayEligibility.allowed ? (
        <p className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {stayEligibility.reason}
        </p>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------
// Folio tab
// ---------------------------------------------------------------------
const FolioTab: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  folioSummary: ReturnType<typeof computeFolioSummary>;
  onRecordPayment: () => void;
  onRecordRefund: () => void;
}> = ({ item, folioSummary, onRecordPayment, onRecordRefund }) => {
  const paymentEligibility = canRecordPayment(item);
  const refundEligibility = canRecordRefund(item, folioSummary);
  const nights = diffDaysIso(item.startDate, item.endDate);
  const priceResult = parseActualNightlyAmount(item.actualNightlyAmount);
  const effectiveAmount = priceResult.isValid && !priceResult.isBlank ? priceResult.amount! : item.nightlyRate;

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClassName}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className={fieldLabelClassName}>Room charge</p>
            <p className={fieldValueClassName}>
              {nightsLabel(Math.max(nights, 0))} × {formatVnd(effectiveAmount)}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Total charges</p>
            <p className={fieldValueClassName}>{formatVnd(folioSummary.totalCharges)}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Total collected</p>
            <p className={fieldValueClassName}>{formatVnd(folioSummary.totalCollected)}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Balance due</p>
            <p className={fieldValueClassName}>{formatVnd(folioSummary.balanceDue)}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!paymentEligibility.allowed}
          onClick={onRecordPayment}
          title={paymentEligibility.reason}
          className={primaryButtonClassName}
        >
          Record payment
        </button>
        <button
          type="button"
          disabled={!refundEligibility.allowed}
          onClick={onRecordRefund}
          title={refundEligibility.reason}
          className={secondaryButtonClassName}
        >
          Record refund
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-gray-50 text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Method</th>
              <th className="px-3 py-2 font-medium">Note / reference</th>
              <th className="px-3 py-2 font-medium">Actor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {item.folio.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-center text-gray-400 dark:text-gray-500">
                  No folio entries yet.
                </td>
              </tr>
            ) : (
              item.folio.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 capitalize text-gray-700 dark:text-gray-200">{entry.kind.replace("-", " ")}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{formatVnd(entry.amount)}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {entry.method ? PAYMENT_METHOD_LABEL[entry.method] : "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {[entry.reference, entry.note].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{entry.actor}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// Notes & activity tab
// ---------------------------------------------------------------------
const NotesActivityTab: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  onAddNote: (content: string) => void;
}> = ({ item, onAddNote }) => {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className={fieldLabelClassName}>Internal notes</p>
        <div className="mt-2 flex flex-col gap-2">
          {item.notes.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No internal notes yet.</p>
          ) : (
            [...item.notes].reverse().map((note) => (
              <div key={note.id} className={cardClassName}>
                <p className="text-sm text-gray-800 dark:text-white/90">{note.content}</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{note.actor}</p>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            placeholder="Add an internal note visible to Admin staff only"
            className={`${inputClassName} h-auto resize-none py-2`}
          />
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => {
              onAddNote(draft);
              setDraft("");
            }}
            className={`${primaryButtonClassName} shrink-0`}
          >
            <PlusIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div>
        <p className={fieldLabelClassName}>Activity</p>
        <div className="mt-2 flex flex-col gap-2">
          {[...item.activity].reverse().map((entry) => (
            <div key={entry.id} className="border-l-2 border-gray-200 pl-3 dark:border-gray-700">
              <p className="text-sm text-gray-800 dark:text-white/90">{entry.description}</p>
              {entry.reason ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">Reason: {entry.reason}</p>
              ) : null}
              <p className="text-xs text-gray-400 dark:text-gray-500">{entry.actor}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
          Actor identity is a mock demo value — real actor identity requires authentication/backend integration.
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// Action panels
// ---------------------------------------------------------------------
const PanelShell: React.FC<{ title: string; children: React.ReactNode; onCancel: () => void; footer: React.ReactNode }> = ({
  title,
  children,
  onCancel,
  footer,
}) => (
  <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between">
      <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h4>
      <button type="button" onClick={onCancel} className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400">
        ← Back
      </button>
    </div>
    {children}
    <div className="mt-1 flex justify-end gap-3">{footer}</div>
  </div>
);

const CheckInPanel: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  propertyPhysicalRoomIds: Set<string>;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}> = ({ item, propertyPhysicalRoomIds, onCancel, onConfirm }) => {
  const [note, setNote] = useState("");
  const eligibility = canCheckIn(item, propertyPhysicalRoomIds);
  const folioSummary = computeFolioSummary(item);

  return (
    <PanelShell
      title="Check in"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!eligibility.allowed}
            onClick={() => onConfirm(note)}
            className={primaryButtonClassName}
          >
            Confirm check-in
          </button>
        </>
      }
    >
      <div className={cardClassName}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={fieldLabelClassName}>Guest</p>
            <p className={fieldValueClassName}>{item.guestName}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Scheduled arrival</p>
            <p className={fieldValueClassName}>
              {formatDisplayDate(item.startDate)} · {item.checkInTime}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Payment</p>
            <p className={fieldValueClassName}>
              {folioSummary.balanceDue > 0 ? `${formatVnd(folioSummary.balanceDue)} due` : "No balance due"}
            </p>
          </div>
        </div>
      </div>
      {!eligibility.allowed ? (
        <p role="alert" className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {eligibility.reason}
        </p>
      ) : folioSummary.balanceDue > 0 ? (
        <p className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Outstanding balance — this is a warning only and does not block check-in.
        </p>
      ) : null}
      <div>
        <label className={labelClassName}>Note (optional)</label>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          className={`${inputClassName} h-auto resize-none py-2`}
        />
      </div>
    </PanelShell>
  );
};

const CheckOutPanel: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  folioSummary: ReturnType<typeof computeFolioSummary>;
  onCancel: () => void;
  onConfirm: (note: string, overrideReason: string) => void;
}> = ({ item, folioSummary, onCancel, onConfirm }) => {
  const [note, setNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const eligibility = canCheckOut(item);
  const requiresOverride = folioSummary.balanceDue > 0;
  const canConfirmCheckout = eligibility.allowed && (!requiresOverride || overrideReason.trim().length > 0);

  return (
    <PanelShell
      title="Check out"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirmCheckout}
            onClick={() => onConfirm(note, overrideReason)}
            className={requiresOverride ? dangerButtonClassName : primaryButtonClassName}
          >
            {requiresOverride ? "Check out with balance due" : "Confirm checkout"}
          </button>
        </>
      }
    >
      <div className={cardClassName}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={fieldLabelClassName}>Guest</p>
            <p className={fieldValueClassName}>{item.guestName}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Scheduled checkout</p>
            <p className={fieldValueClassName}>
              {formatDisplayDate(item.endDate)} · {item.checkOutTime}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Total charges</p>
            <p className={fieldValueClassName}>{formatVnd(folioSummary.totalCharges)}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Collected</p>
            <p className={fieldValueClassName}>{formatVnd(folioSummary.totalCollected)}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Balance due</p>
            <p className={fieldValueClassName}>{formatVnd(folioSummary.balanceDue)}</p>
          </div>
        </div>
      </div>
      {!eligibility.allowed ? (
        <p role="alert" className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {eligibility.reason}
        </p>
      ) : requiresOverride ? (
        <div>
          <p className={noticeClassName}>
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            A balance is due. Recording a payment first is recommended. Checking out anyway is an override that
            would require permission in a real backend system.
          </p>
          <label className={`${labelClassName} mt-2`}>Override reason (required)</label>
          <textarea
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            rows={2}
            className={`${inputClassName} h-auto resize-none py-2`}
          />
        </div>
      ) : null}
      <div>
        <label className={labelClassName}>Note (optional)</label>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          className={`${inputClassName} h-auto resize-none py-2`}
        />
      </div>
    </PanelShell>
  );
};

const CancelPanel: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}> = ({ item, onCancel, onConfirm }) => {
  const [reason, setReason] = useState("");
  const eligibility = canCancel(item);
  const trimmed = reason.trim();

  return (
    <PanelShell
      title="Cancel reservation"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Back
          </button>
          <button
            type="button"
            disabled={!eligibility.allowed || !trimmed}
            onClick={() => onConfirm(reason)}
            className={dangerButtonClassName}
          >
            Confirm cancellation
          </button>
        </>
      }
    >
      <p className={noticeClassName}>
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Cancelling releases this reservation&apos;s future inventory. The record and its history are preserved and
        remain visible through the Inactive filter.
      </p>
      {isOtaSource(item.sourceId) ? (
        <p className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {OTA_SYNC_NOTICE}
        </p>
      ) : null}
      {!eligibility.allowed ? (
        <p role="alert" className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {eligibility.reason}
        </p>
      ) : null}
      <div>
        <label className={labelClassName}>Cancellation reason (required)</label>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          className={`${inputClassName} h-auto resize-none py-2`}
        />
      </div>
    </PanelShell>
  );
};

const NoShowPanel: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  onCancel: () => void;
  onConfirm: (reason: string, feeAmount: number | null) => void;
}> = ({ item, onCancel, onConfirm }) => {
  const [reason, setReason] = useState("");
  const [recordFee, setRecordFee] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const eligibility = canMarkNoShow(item);
  const trimmed = reason.trim();
  const feeValid = !recordFee || (Number(feeAmount) > 0 && isValidFolioAmount(Number(feeAmount)) && /^[0-9]+$/.test(feeAmount.trim()));

  return (
    <PanelShell
      title="Mark no-show"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Back
          </button>
          <button
            type="button"
            disabled={!eligibility.allowed || !trimmed || !feeValid}
            onClick={() => onConfirm(reason, recordFee ? Number(feeAmount) : null)}
            className={dangerButtonClassName}
          >
            Confirm no-show
          </button>
        </>
      }
    >
      <p className={noticeClassName}>
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Marking no-show releases this reservation&apos;s future inventory. The record remains visible through the
        Inactive filter.
      </p>
      {isOtaSource(item.sourceId) ? (
        <p className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {OTA_SYNC_NOTICE}
        </p>
      ) : null}
      {!eligibility.allowed ? (
        <p role="alert" className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {eligibility.reason}
        </p>
      ) : null}
      <div>
        <label className={labelClassName}>Reason (required)</label>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className={`${inputClassName} h-auto resize-none py-2`}
        />
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={recordFee} onChange={(event) => setRecordFee(event.target.checked)} />
          Record a no-show fee
        </label>
        {recordFee ? (
          <div className="mt-2">
            <label className={labelClassName}>Fee amount (VND)</label>
            <input
              type="text"
              inputMode="numeric"
              value={feeAmount}
              onChange={(event) => setFeeAmount(event.target.value)}
              placeholder="e.g. 500000"
              className={`${inputClassName} max-w-[220px] ${!feeValid ? invalidInputClassName : ""}`}
            />
            {!feeValid ? <p className={errorTextClassName}>Enter a whole VND amount greater than 0.</p> : null}
          </div>
        ) : null}
      </div>
    </PanelShell>
  );
};

const EditGuestPanel: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  nationalities: GuestNationality[];
  onCancel: () => void;
  onSave: (guest: EditGuestInput) => void;
}> = ({ item, nationalities, onCancel, onSave }) => {
  const [guestName, setGuestName] = useState(item.guestName);
  const [guestPhone, setGuestPhone] = useState(item.guestPhone);
  const [guestEmail, setGuestEmail] = useState(item.guestEmail);
  const [nationalityCode, setNationalityCode] = useState(item.nationality.code);
  const [adults, setAdults] = useState(item.occupancy.adults);
  const [children, setChildren] = useState(item.occupancy.children);

  const trimmedName = guestName.trim();
  const trimmedPhone = guestPhone.trim();
  const nameValid = Boolean(trimmedName);
  const phoneValid = Boolean(trimmedPhone) && trimmedPhone.length <= 32;
  const emailValid = isValidOptionalEmail(guestEmail);
  const adultsValid = isValidOccupancyCount(adults, 1, MAX_ADULTS_PER_UNIT);
  const childrenValid = isValidOccupancyCount(children, 0, MAX_CHILDREN_PER_UNIT);
  const formValid = nameValid && phoneValid && emailValid && adultsValid && childrenValid;
  const nationality = nationalities.find((candidate) => candidate.code === nationalityCode) ?? item.nationality;
  const draft: EditGuestInput = { guestName, guestPhone, guestEmail, nationality, adults, children };
  // Save must stay disabled on valid-but-unchanged data — a no-op dispatch
  // would be silently rejected by the reducer, but the panel would still
  // close and announce a success that never happened (Codex, ADMIN-002.1-C7).
  const changed = formValid ? hasGuestChanges(item, draft) : false;

  return (
    <PanelShell
      title="Edit guest"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!formValid || !changed}
            onClick={() => {
              if (!changed) return;
              onSave(draft);
            }}
            className={primaryButtonClassName}
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClassName}>Full name</label>
          <input
            type="text"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            className={`${inputClassName} ${!nameValid ? invalidInputClassName : ""}`}
          />
          {!nameValid ? <p className={errorTextClassName}>Enter the guest&apos;s full name.</p> : null}
        </div>
        <div>
          <label className={labelClassName}>Phone</label>
          <input
            type="tel"
            value={guestPhone}
            maxLength={32}
            onChange={(event) => setGuestPhone(event.target.value)}
            className={`${inputClassName} ${!phoneValid ? invalidInputClassName : ""}`}
          />
          {!phoneValid ? <p className={errorTextClassName}>Enter a phone number (max 32 characters).</p> : null}
        </div>
        <div>
          <label className={labelClassName}>Email (optional)</label>
          <input
            type="email"
            value={guestEmail}
            maxLength={256}
            onChange={(event) => setGuestEmail(event.target.value)}
            className={`${inputClassName} ${!emailValid ? invalidInputClassName : ""}`}
          />
          {!emailValid ? <p className={errorTextClassName}>Enter a valid email address, or leave blank.</p> : null}
        </div>
        <div>
          <label className={labelClassName}>Nationality</label>
          <select
            value={nationalityCode}
            onChange={(event) => setNationalityCode(event.target.value)}
            className={inputClassName}
          >
            {nationalities.map((option) => (
              <option key={option.code} value={option.code}>
                {option.flag} {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClassName}>Adults</label>
          <input
            type="number"
            step={1}
            min={1}
            value={adults}
            onChange={(event) => setAdults(Number(event.target.value))}
            className={`${inputClassName} ${!adultsValid ? invalidInputClassName : ""}`}
          />
          {!adultsValid ? (
            <p className={errorTextClassName}>Adults must be a whole number between 1 and {MAX_ADULTS_PER_UNIT}.</p>
          ) : null}
        </div>
        <div>
          <label className={labelClassName}>Children</label>
          <input
            type="number"
            step={1}
            min={0}
            value={children}
            onChange={(event) => setChildren(Number(event.target.value))}
            className={`${inputClassName} ${!childrenValid ? invalidInputClassName : ""}`}
          />
          {!childrenValid ? (
            <p className={errorTextClassName}>Children must be a whole number between 0 and {MAX_CHILDREN_PER_UNIT}.</p>
          ) : null}
        </div>
      </div>
      {formValid && !changed ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Make at least one change to save.</p>
      ) : null}
    </PanelShell>
  );
};

const EditStayPanel: React.FC<{
  item: Extract<TimelineItem, { kind: "assigned-reservation" | "unassigned-reservation" }>;
  items: TimelineItem[];
  roomTypes: RoomType[];
  physicalRooms: PhysicalRoom[];
  bookingSources: BookingSource[];
  onCancel: () => void;
  onSave: (stay: EditStayInput) => void;
}> = ({ item, items, roomTypes, physicalRooms, bookingSources, onCancel, onSave }) => {
  const [sourceId, setSourceId] = useState<BookingSourceId>(item.sourceId);
  const [soldRoomTypeId, setSoldRoomTypeId] = useState(item.soldRoomTypeId);
  const [physicalRoomId, setPhysicalRoomId] = useState(item.kind === "assigned-reservation" ? item.roomId : "");
  const [checkIn, setCheckIn] = useState<IsoDate>(item.startDate);
  const [checkOut, setCheckOut] = useState<IsoDate>(item.endDate);
  const [checkInTime, setCheckInTime] = useState(item.checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(item.checkOutTime);
  const [actualNightlyAmount, setActualNightlyAmount] = useState(item.actualNightlyAmount);

  const roomsForType = physicalRooms.filter((room) => room.roomTypeId === soldRoomTypeId);
  const checkInValid = isValidReservationIsoDate(checkIn);
  const checkOutValid = isValidReservationIsoDate(checkOut);
  const orderValid = checkInValid && checkOutValid && checkOut > checkIn;
  const priceResult = parseActualNightlyAmount(actualNightlyAmount);
  const blockingItem = physicalRoomId && checkInValid && checkOutValid
    ? findBlockingItem(items, item.id, item.propertyId, physicalRoomId, checkIn, checkOut)
    : null;

  const formValid = checkInValid && checkOutValid && orderValid && priceResult.isValid && !blockingItem;
  const draft: EditStayInput = {
    sourceId,
    soldRoomTypeId,
    physicalRoomId,
    checkIn,
    checkOut,
    checkInTime,
    checkOutTime,
    actualNightlyAmount,
  };
  // See EditGuestPanel — a no-op Save must stay disabled rather than close
  // the panel and announce a success the reducer silently rejected.
  const changed = formValid ? hasStayChanges(item, draft) : false;

  return (
    <PanelShell
      title="Edit stay"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!formValid || !changed}
            onClick={() => {
              if (!changed) return;
              onSave(draft);
            }}
            className={primaryButtonClassName}
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClassName}>Booking source</label>
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value as BookingSourceId)}
            className={inputClassName}
          >
            {bookingSources.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClassName}>Sold room type</label>
          <select
            value={soldRoomTypeId}
            onChange={(event) => {
              setSoldRoomTypeId(event.target.value);
              setPhysicalRoomId("");
              setActualNightlyAmount("");
            }}
            className={inputClassName}
          >
            {roomTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClassName}>Assigned room (optional)</label>
          <select
            value={physicalRoomId}
            onChange={(event) => setPhysicalRoomId(event.target.value)}
            className={inputClassName}
          >
            <option value="">Unassigned</option>
            {roomsForType.map((option) => (
              <option key={option.id} value={option.id}>
                Room {option.code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClassName}>Negotiated nightly price (optional)</label>
          <input
            type="text"
            inputMode="numeric"
            value={actualNightlyAmount}
            onChange={(event) => setActualNightlyAmount(event.target.value)}
            placeholder={`e.g. ${item.nightlyRate}`}
            className={`${inputClassName} ${!priceResult.isValid ? invalidInputClassName : ""}`}
          />
          {!priceResult.isValid ? (
            <p className={errorTextClassName}>Enter a whole number between 0 and {MAX_ACTUAL_NIGHTLY_AMOUNT.toLocaleString("vi-VN")} VND, or leave blank.</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Reference rate: {formatVnd(item.nightlyRate)}/night.</p>
          )}
        </div>
        <div>
          <label className={labelClassName}>Check-in date</label>
          <input
            type="date"
            value={checkIn}
            min={MIN_RESERVATION_DATE}
            max={MAX_RESERVATION_DATE}
            onChange={(event) => setCheckIn(event.target.value)}
            className={`${inputClassName} ${!checkInValid ? invalidInputClassName : ""}`}
          />
        </div>
        <div>
          <label className={labelClassName}>Checkout date</label>
          <input
            type="date"
            value={checkOut}
            min={checkIn || MIN_RESERVATION_DATE}
            max={MAX_RESERVATION_DATE}
            onChange={(event) => setCheckOut(event.target.value)}
            className={`${inputClassName} ${!checkOutValid || (checkInValid && checkOutValid && !orderValid) ? invalidInputClassName : ""}`}
          />
        </div>
        <div>
          <label className={labelClassName}>Scheduled check-in time</label>
          <input
            type="time"
            value={checkInTime}
            onChange={(event) => setCheckInTime(event.target.value)}
            className={inputClassName}
          />
        </div>
        <div>
          <label className={labelClassName}>Scheduled checkout time</label>
          <input
            type="time"
            value={checkOutTime}
            onChange={(event) => setCheckOutTime(event.target.value)}
            className={inputClassName}
          />
        </div>
      </div>
      {checkInValid && checkOutValid && !orderValid ? (
        <p role="alert" className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Checkout must be after check-in.
        </p>
      ) : null}
      {blockingItem ? (
        <p role="alert" className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Room {physicalRooms.find((room) => room.id === physicalRoomId)?.code}: dates overlap{" "}
          {blockingItem.kind === "operational-block" ? "an operational block" : "an existing stay"}.
        </p>
      ) : null}
      {formValid && !changed ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Make at least one change to save.</p>
      ) : null}
    </PanelShell>
  );
};

const RecordPaymentPanel: React.FC<{
  onCancel: () => void;
  onSave: (input: RecordPaymentInput) => void;
}> = ({ onCancel, onSave }) => {
  const [entryType, setEntryType] = useState<"deposit" | "payment">("deposit");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ReservationPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const amountValid = /^[0-9]+$/.test(amount.trim()) && isValidFolioAmount(Number(amount.trim()));

  return (
    <PanelShell
      title="Record payment"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!amountValid}
            onClick={() => onSave({ entryType, amount: Number(amount), method, reference, note })}
            className={primaryButtonClassName}
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClassName}>Type</label>
          <select
            value={entryType}
            onChange={(event) => setEntryType(event.target.value as "deposit" | "payment")}
            className={inputClassName}
          >
            <option value="deposit">Advance deposit</option>
            <option value="payment">Payment</option>
          </select>
        </div>
        <div>
          <label className={labelClassName}>Method</label>
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as ReservationPaymentMethod)}
            className={inputClassName}
          >
            {(Object.keys(PAYMENT_METHOD_LABEL) as ReservationPaymentMethod[]).map((option) => (
              <option key={option} value={option}>
                {PAYMENT_METHOD_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClassName}>Amount (VND)</label>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="e.g. 1500000"
            className={`${inputClassName} ${!amountValid ? invalidInputClassName : ""}`}
          />
          {!amountValid ? <p className={errorTextClassName}>Enter a whole VND amount greater than 0.</p> : null}
        </div>
        <div>
          <label className={labelClassName}>Reference (optional)</label>
          <input
            type="text"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className={inputClassName}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClassName}>Note (optional)</label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className={`${inputClassName} h-auto resize-none py-2`}
          />
        </div>
      </div>
    </PanelShell>
  );
};

const RecordRefundPanel: React.FC<{
  maxAmount: number;
  onCancel: () => void;
  onSave: (input: RecordRefundInput) => void;
}> = ({ maxAmount, onCancel, onSave }) => {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ReservationPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const amountValid = /^[0-9]+$/.test(amount.trim()) && isValidFolioAmount(Number(amount.trim()));
  const wouldOverdraw = amountValid && Number(amount) > maxAmount;
  const trimmedReason = reason.trim();

  return (
    <PanelShell
      title="Record refund"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!amountValid || !trimmedReason}
            onClick={() => onSave({ amount: Number(amount), method, reference, reason })}
            className={dangerButtonClassName}
          >
            Confirm refund
          </button>
        </>
      }
    >
      <p className="text-xs text-gray-500 dark:text-gray-400">
        This is a demo accounting record, not a real payment-gateway refund. It appends a new entry — the original
        payment is never erased.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClassName}>Amount (VND)</label>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="e.g. 500000"
            className={`${inputClassName} ${!amountValid ? invalidInputClassName : ""}`}
          />
          {!amountValid ? <p className={errorTextClassName}>Enter a whole VND amount greater than 0.</p> : null}
        </div>
        <div>
          <label className={labelClassName}>Method</label>
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as ReservationPaymentMethod)}
            className={inputClassName}
          >
            {(Object.keys(PAYMENT_METHOD_LABEL) as ReservationPaymentMethod[]).map((option) => (
              <option key={option} value={option}>
                {PAYMENT_METHOD_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClassName}>Reference (optional)</label>
          <input
            type="text"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className={inputClassName}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClassName}>Reason (required)</label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            className={`${inputClassName} h-auto resize-none py-2`}
          />
        </div>
      </div>
      {wouldOverdraw ? (
        <p className={noticeClassName}>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          This exceeds the {formatVnd(maxAmount)} collected — the reservation would show as overpaid in reverse.
        </p>
      ) : null}
    </PanelShell>
  );
};

// ---------------------------------------------------------------------
// Operational block sub-panels
// ---------------------------------------------------------------------
const BlockOverviewGrid: React.FC<{
  item: Extract<TimelineItem, { kind: "operational-block" }>;
  room: PhysicalRoom | null;
  roomType: RoomType | null;
  durationNights: number;
}> = ({ item, room, roomType, durationNights }) => (
  <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
    <div>
      <p className={fieldLabelClassName}>Note / type</p>
      <p className={fieldValueClassName}>{item.reason}</p>
    </div>
    <div>
      <p className={fieldLabelClassName}>Room</p>
      <p className={fieldValueClassName}>
        {room ? `Room ${room.code}` : "—"}
        {roomType ? ` · ${roomType.name}` : ""}
      </p>
    </div>
    <div>
      <p className={fieldLabelClassName}>Start</p>
      <p className={fieldValueClassName}>{formatDisplayDate(item.startDate)}</p>
    </div>
    <div>
      <p className={fieldLabelClassName}>End</p>
      <p className={fieldValueClassName}>{formatDisplayDate(item.endDate)}</p>
    </div>
    <div>
      <p className={fieldLabelClassName}>Duration</p>
      <p className={fieldValueClassName}>{nightsLabel(durationNights)}</p>
    </div>
  </div>
);

const BlockActivityList: React.FC<{ activity: Extract<TimelineItem, { kind: "operational-block" }>["activity"] }> = ({
  activity,
}) =>
  activity.length > 0 ? (
    <div className="mt-3 flex flex-col gap-2">
      <p className={fieldLabelClassName}>Activity</p>
      {[...activity].reverse().map((entry) => (
        <div key={entry.id} className="border-l-2 border-gray-200 pl-3 dark:border-gray-700">
          <p className="text-sm text-gray-800 dark:text-white/90">{entry.description}</p>
          {entry.reason ? <p className="text-xs text-gray-500 dark:text-gray-400">Reason: {entry.reason}</p> : null}
          <p className="text-xs text-gray-400 dark:text-gray-500">{entry.actor}</p>
        </div>
      ))}
    </div>
  ) : null;

const BlockEditReasonPanel: React.FC<{
  initialReason: string;
  onCancel: () => void;
  onSave: (reason: string) => void;
}> = ({ initialReason, onCancel, onSave }) => {
  const [reason, setReason] = useState(initialReason);
  const trimmed = reason.trim();
  // See EditGuestPanel — a no-op Save must stay disabled rather than close
  // the panel and announce a success the reducer silently rejected.
  const changed = hasBlockReasonChanges(initialReason, reason);

  return (
    <PanelShell
      title="Edit block reason"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmed || !changed}
            onClick={() => {
              if (!changed) return;
              onSave(reason);
            }}
            className={primaryButtonClassName}
          >
            Save
          </button>
        </>
      }
    >
      <div>
        <label className={labelClassName}>Note / type</label>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className={`${inputClassName} h-auto resize-none py-2`}
        />
      </div>
      {trimmed && !changed ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Make at least one change to save.</p>
      ) : null}
    </PanelShell>
  );
};

const BlockRemovePanel: React.FC<{
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}> = ({ onCancel, onConfirm }) => {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <PanelShell
      title="Remove block"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => onConfirm(reason)}
            className={dangerButtonClassName}
          >
            Confirm removal
          </button>
        </>
      }
    >
      <p className={noticeClassName}>
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Removing releases this block&apos;s inventory. It is retained with its activity record and hidden from the
        active board.
      </p>
      <div>
        <label className={labelClassName}>Reason (required)</label>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className={`${inputClassName} h-auto resize-none py-2`}
        />
      </div>
    </PanelShell>
  );
};

export default TimelineItemDetailsDialog;
