"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircleIcon, InfoIcon, PlusIcon } from "@/icons";
import { compareIsoDate, diffDaysIso } from "@/components/calendar/reservation-board/dateMath";
import { isoRangesOverlap } from "@/components/calendar/reservation-board/dateMath";
import {
  MOCK_BOOKING_SOURCES,
  MOCK_PHYSICAL_ROOMS,
  MOCK_PROPERTIES,
  MOCK_ROOM_TYPES,
  MOCK_TIMELINE_ITEMS,
} from "@/components/calendar/reservation-board/mockData";
import type {
  BookingSourceId,
  PropertyId,
} from "@/components/calendar/reservation-board/types";
import GuestDetailsSection from "./GuestDetailsSection";
import ReservationUnitEditor from "./ReservationUnitEditor";
import ReservationSummary from "./ReservationSummary";
import ReservationReviewDialog from "./ReservationReviewDialog";
import { MOCK_NATIONALITIES, MOCK_RATE_PLANS } from "./mockData";
import type {
  CreateReservationFormState,
  CreateReservationGuestDetails,
  FieldError,
  ReservationReviewData,
  ReservationUnitDraft,
} from "./types";

function createEmptyUnit(id: string): ReservationUnitDraft {
  return {
    id,
    soldRoomTypeId: "",
    ratePlanId: "",
    physicalRoomId: "",
    checkIn: "",
    checkOut: "",
    adults: 1,
    children: 0,
    specialRequest: "",
  };
}

function createInitialState(): CreateReservationFormState {
  return {
    propertyId: "",
    sourceId: "",
    guest: { fullName: "", phone: "", email: "", nationalityCode: "" },
    units: [createEmptyUnit("unit-1")],
    internalNote: "",
    nextUnitSeq: 2,
  };
}

type FormAction =
  | { type: "SET_PROPERTY"; propertyId: PropertyId }
  | { type: "SET_SOURCE"; sourceId: BookingSourceId }
  | {
      type: "SET_GUEST_FIELD";
      field: keyof CreateReservationGuestDetails;
      value: string;
    }
  | { type: "SET_NOTE"; value: string }
  | { type: "ADD_UNIT" }
  | { type: "REMOVE_UNIT"; unitId: string }
  | {
      type: "SET_UNIT_FIELD";
      unitId: string;
      field: keyof ReservationUnitDraft;
      value: string | number;
    }
  | { type: "RESET" };

function formReducer(
  state: CreateReservationFormState,
  action: FormAction
): CreateReservationFormState {
  switch (action.type) {
    case "SET_PROPERTY":
      return {
        ...state,
        propertyId: action.propertyId,
        // Property scopes every sold RoomType/PhysicalRoom option — clear
        // stale cross-Property selections rather than retaining invalid IDs.
        units: state.units.map((unit) => ({
          ...unit,
          soldRoomTypeId: "",
          ratePlanId: "",
          physicalRoomId: "",
        })),
      };
    case "SET_SOURCE":
      return { ...state, sourceId: action.sourceId };
    case "SET_GUEST_FIELD":
      return { ...state, guest: { ...state.guest, [action.field]: action.value } };
    case "SET_NOTE":
      return { ...state, internalNote: action.value };
    case "ADD_UNIT":
      return {
        ...state,
        units: [...state.units, createEmptyUnit(`unit-${state.nextUnitSeq}`)],
        nextUnitSeq: state.nextUnitSeq + 1,
      };
    case "REMOVE_UNIT":
      if (state.units.length <= 1) return state;
      return { ...state, units: state.units.filter((unit) => unit.id !== action.unitId) };
    case "SET_UNIT_FIELD":
      return {
        ...state,
        units: state.units.map((unit) => {
          if (unit.id !== action.unitId) return unit;
          const updated = { ...unit, [action.field]: action.value };
          // Rate plans are scoped per sold RoomType — a stale plan from a
          // different RoomType would no longer be a valid choice.
          if (action.field === "soldRoomTypeId") updated.ratePlanId = "";
          return updated;
        }),
      };
    case "RESET":
      return createInitialState();
    default:
      return state;
  }
}

function findConflictErrors(state: CreateReservationFormState): FieldError[] {
  const errors: FieldError[] = [];
  const candidates = state.units.filter(
    (unit) =>
      unit.physicalRoomId &&
      unit.checkIn &&
      unit.checkOut &&
      compareIsoDate(unit.checkOut, unit.checkIn) > 0
  );

  candidates.forEach((unit) => {
    const room = MOCK_PHYSICAL_ROOMS.find((candidate) => candidate.id === unit.physicalRoomId);
    const roomLabel = room ? `Room ${room.code}` : "the selected room";

    const blockingMockItem = MOCK_TIMELINE_ITEMS.find((item) => {
      if (item.kind !== "assigned-reservation" && item.kind !== "operational-block") return false;
      if (item.roomId !== unit.physicalRoomId) return false;
      return isoRangesOverlap(
        unit.checkIn as string,
        unit.checkOut as string,
        item.startDate,
        item.endDate
      );
    });
    if (blockingMockItem) {
      errors.push({
        path: `unit:${unit.id}.physicalRoomId`,
        message: `${roomLabel} is unavailable for these dates in demo data — overlaps ${
          blockingMockItem.kind === "operational-block" ? "an operational block" : "an existing stay"
        }.`,
      });
      return;
    }

    const overlappingSibling = candidates.find(
      (other) =>
        other.id !== unit.id &&
        other.physicalRoomId === unit.physicalRoomId &&
        isoRangesOverlap(
          unit.checkIn as string,
          unit.checkOut as string,
          other.checkIn as string,
          other.checkOut as string
        )
    );
    if (overlappingSibling) {
      errors.push({
        path: `unit:${unit.id}.physicalRoomId`,
        message: `${roomLabel} is selected for two overlapping room units in this reservation.`,
      });
    }
  });

  return errors;
}

function validateForm(state: CreateReservationFormState): FieldError[] {
  const errors: FieldError[] = [];

  if (!state.propertyId) errors.push({ path: "propertyId", message: "Select a property." });
  if (!state.sourceId) errors.push({ path: "sourceId", message: "Select a booking source." });

  if (!state.guest.fullName.trim()) {
    errors.push({ path: "guest.fullName", message: "Enter the guest's full name." });
  }
  const trimmedPhone = state.guest.phone.trim();
  if (!trimmedPhone) {
    errors.push({ path: "guest.phone", message: "Enter a phone number." });
  } else if (trimmedPhone.length > 32) {
    errors.push({ path: "guest.phone", message: "Phone number must be 32 characters or fewer." });
  }
  if (state.guest.email.trim().length > 256) {
    errors.push({ path: "guest.email", message: "Email must be 256 characters or fewer." });
  }

  if (state.units.length === 0) {
    errors.push({ path: "units", message: "Add at least one room unit." });
  }

  state.units.forEach((unit, index) => {
    const label = `Room ${index + 1}`;
    const unitPath = (field: string) => `unit:${unit.id}.${field}`;

    if (!unit.soldRoomTypeId) {
      errors.push({ path: unitPath("soldRoomTypeId"), message: `${label}: select a sold room type.` });
    } else if (state.propertyId) {
      const roomType = MOCK_ROOM_TYPES.find((candidate) => candidate.id === unit.soldRoomTypeId);
      if (!roomType || roomType.propertyId !== state.propertyId) {
        errors.push({
          path: unitPath("soldRoomTypeId"),
          message: `${label}: sold room type does not belong to the selected property.`,
        });
      }
    }

    if (!unit.ratePlanId) {
      errors.push({ path: unitPath("ratePlanId"), message: `${label}: select a rate plan.` });
    }

    if (!unit.checkIn) {
      errors.push({ path: unitPath("checkIn"), message: `${label}: enter a check-in date.` });
    }
    if (!unit.checkOut) {
      errors.push({ path: unitPath("checkOut"), message: `${label}: enter a checkout date.` });
    }
    if (unit.checkIn && unit.checkOut && compareIsoDate(unit.checkOut, unit.checkIn) <= 0) {
      errors.push({ path: unitPath("checkOut"), message: `${label}: checkout must be after check-in.` });
    }

    if (unit.adults < 1) {
      errors.push({ path: unitPath("adults"), message: `${label}: at least 1 adult is required.` });
    }
    if (unit.children < 0) {
      errors.push({ path: unitPath("children"), message: `${label}: children cannot be negative.` });
    }

    if (unit.physicalRoomId && state.propertyId) {
      const room = MOCK_PHYSICAL_ROOMS.find((candidate) => candidate.id === unit.physicalRoomId);
      const roomType = room ? MOCK_ROOM_TYPES.find((candidate) => candidate.id === room.roomTypeId) : null;
      if (!room || !roomType || roomType.propertyId !== state.propertyId) {
        errors.push({
          path: unitPath("physicalRoomId"),
          message: `${label}: selected room does not belong to the chosen property.`,
        });
      }
    }
  });

  errors.push(...findConflictErrors(state));

  return errors;
}

function buildReviewData(state: CreateReservationFormState): ReservationReviewData {
  const property = state.propertyId
    ? MOCK_PROPERTIES.find((candidate) => candidate.id === state.propertyId)
    : null;
  const source = state.sourceId
    ? MOCK_BOOKING_SOURCES.find((candidate) => candidate.id === state.sourceId)
    : null;
  const nationality = state.guest.nationalityCode
    ? MOCK_NATIONALITIES.find((candidate) => candidate.code === state.guest.nationalityCode)
    : null;

  const units = state.units.map((unit) => {
    const soldRoomType = unit.soldRoomTypeId
      ? MOCK_ROOM_TYPES.find((candidate) => candidate.id === unit.soldRoomTypeId) ?? null
      : null;
    const physicalRoom = unit.physicalRoomId
      ? MOCK_PHYSICAL_ROOMS.find((candidate) => candidate.id === unit.physicalRoomId) ?? null
      : null;
    const assignedRoomType = physicalRoom
      ? MOCK_ROOM_TYPES.find((candidate) => candidate.id === physicalRoom.roomTypeId) ?? null
      : null;
    const crossesRoomType = Boolean(
      soldRoomType && assignedRoomType && soldRoomType.id !== assignedRoomType.id
    );
    const nights =
      unit.checkIn && unit.checkOut ? Math.max(diffDaysIso(unit.checkIn, unit.checkOut), 0) : 0;
    const ratePlan = unit.ratePlanId
      ? MOCK_RATE_PLANS.find((candidate) => candidate.id === unit.ratePlanId) ?? null
      : null;
    const subtotal = ratePlan && nights > 0 ? ratePlan.nightlyAmount * nights : null;

    return {
      unitId: unit.id,
      soldRoomTypeName: soldRoomType?.name ?? null,
      physicalRoomLabel: physicalRoom ? `Room ${physicalRoom.code}` : "Unassigned",
      assignedRoomTypeName: assignedRoomType?.name ?? null,
      crossesRoomType,
      checkIn: unit.checkIn,
      checkOut: unit.checkOut,
      nights,
      adults: unit.adults,
      children: unit.children,
      ratePlanName: ratePlan?.name ?? null,
      nightlyAmount: ratePlan?.nightlyAmount ?? null,
      subtotal,
    };
  });

  const aggregateTotal = units.reduce((sum, unit) => sum + (unit.subtotal ?? 0), 0);

  return {
    propertyName: property?.name ?? "No property selected",
    guestName: state.guest.fullName.trim() || "Guest not entered",
    guestPhone: state.guest.phone.trim() || "—",
    guestEmail: state.guest.email.trim(),
    guestNationalityLabel: nationality ? `${nationality.flag} ${nationality.label}` : null,
    sourceLabel: source?.label ?? "No source selected",
    units,
    aggregateTotal,
    internalNote: state.internalNote,
  };
}

const cardClassName =
  "rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6";

const SuccessView: React.FC<{ data: ReservationReviewData; onCreateAnother: () => void }> = ({
  data,
  onCreateAnother,
}) => {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="rounded-2xl border border-success-200 bg-success-50 p-6 text-center dark:border-success-500/30 dark:bg-success-500/10 sm:p-8">
        <CheckCircleIcon
          className="mx-auto size-10 text-success-500 dark:text-success-400"
          aria-hidden="true"
        />
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-3 text-xl font-semibold text-gray-800 outline-hidden dark:text-white/90"
        >
          Demo reservation created locally — not saved to backend
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {data.guestName} · {data.propertyName} · {data.units.length} room unit
          {data.units.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className={cardClassName}>
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Demo reservation recap
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Source</dt>
            <dd className="text-right font-medium text-gray-800 dark:text-white/90">
              {data.sourceLabel}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Phone</dt>
            <dd className="text-right font-medium text-gray-800 dark:text-white/90">
              {data.guestPhone}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-col gap-2">
          {data.units.map((unit, index) => (
            <div
              key={unit.unitId}
              className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-xs dark:border-gray-800 dark:bg-white/[0.02]"
            >
              <p className="font-medium text-gray-800 dark:text-white/90">
                Room {index + 1} — {unit.soldRoomTypeName} · {unit.physicalRoomLabel}
              </p>
              <p className="text-gray-600 dark:text-gray-300">
                {unit.checkIn} – {unit.checkOut} · {unit.nights} night{unit.nights === 1 ? "" : "s"}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-right text-sm font-semibold text-gray-800 dark:text-white/90">
          Estimated total:{" "}
          {new Intl.NumberFormat("vi-VN", {
            style: "currency",
            currency: "VND",
            maximumFractionDigits: 0,
          }).format(data.aggregateTotal)}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onCreateAnother}
          className="h-11 flex-1 rounded-lg bg-brand-500 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          Create another
        </button>
        <Link
          href="/calendar"
          className="flex h-11 flex-1 items-center justify-center rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          Back to calendar
        </Link>
      </div>
    </div>
  );
};

const CreateReservationForm: React.FC = () => {
  const [state, dispatch] = useReducer(formReducer, undefined, createInitialState);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [phase, setPhase] = useState<"editing" | "success">("editing");
  const [confirmedData, setConfirmedData] = useState<ReservationReviewData | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);

  const errors = validateForm(state);
  const reviewData = buildReviewData(state);

  const handlePropertyChange = (propertyId: PropertyId) => {
    dispatch({ type: "SET_PROPERTY", propertyId });
  };
  const handleSourceChange = (sourceId: BookingSourceId) => {
    dispatch({ type: "SET_SOURCE", sourceId });
  };
  const handleGuestFieldChange = (
    field: keyof CreateReservationGuestDetails,
    value: string
  ) => {
    dispatch({ type: "SET_GUEST_FIELD", field, value });
  };
  const handleUnitFieldChange = (
    unitId: string,
    field: keyof ReservationUnitDraft,
    value: string | number
  ) => {
    dispatch({ type: "SET_UNIT_FIELD", unitId, field, value });
  };
  const handleRemoveUnit = (unitId: string) => {
    dispatch({ type: "REMOVE_UNIT", unitId });
  };

  const handleReviewClick = () => {
    setSubmitAttempted(true);
    if (errors.length > 0) {
      errorSummaryRef.current?.focus();
      return;
    }
    setIsReviewOpen(true);
  };

  const handleBackToEdit = () => {
    setIsReviewOpen(false);
    document.getElementById("reservation-review-button")?.focus();
  };

  const handleConfirm = () => {
    setConfirmedData(reviewData);
    setIsReviewOpen(false);
    setPhase("success");
  };

  const handleCreateAnother = () => {
    dispatch({ type: "RESET" });
    setSubmitAttempted(false);
    setConfirmedData(null);
    setPhase("editing");
  };

  if (phase === "success" && confirmedData) {
    return <SuccessView data={confirmedData} onCreateAnother={handleCreateAnother} />;
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        handleReviewClick();
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Create reservation
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Direct Admin / walk-in reservation workflow.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-white/[0.05] dark:text-gray-300">
            <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
            Demo only — not connected to backend
          </span>
          <Link
            href="/calendar"
            className="text-sm font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
          >
            Cancel
          </Link>
        </div>
      </div>

      {submitAttempted && errors.length > 0 ? (
        <div
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
          className="rounded-2xl border border-error-200 bg-error-50 p-4 text-sm text-error-700 outline-hidden dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300"
        >
          <p className="font-medium">Please fix the following before continuing:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {errors.map((error, index) => (
              <li key={`${error.path}-${index}`}>{error.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <GuestDetailsSection
            state={state}
            errors={errors}
            showErrors={submitAttempted}
            onPropertyChange={handlePropertyChange}
            onSourceChange={handleSourceChange}
            onGuestFieldChange={handleGuestFieldChange}
          />

          <div className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              Reservation units
            </h2>
            {state.units.map((unit, index) => (
              <ReservationUnitEditor
                key={unit.id}
                unit={unit}
                index={index}
                propertyId={state.propertyId}
                errors={errors}
                showErrors={submitAttempted}
                canRemove={state.units.length > 1}
                onFieldChange={handleUnitFieldChange}
                onRemove={handleRemoveUnit}
              />
            ))}
            <button
              type="button"
              onClick={() => dispatch({ type: "ADD_UNIT" })}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-brand-300 hover:text-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:border-brand-500/50 dark:hover:text-brand-300"
            >
              <PlusIcon className="size-4" aria-hidden="true" />
              Add room
            </button>
          </div>

          <div className={cardClassName}>
            <label
              htmlFor="reservation-internal-note"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Internal note <span className="text-gray-400 dark:text-gray-500">(optional)</span>
            </label>
            <textarea
              id="reservation-internal-note"
              value={state.internalNote}
              onChange={(event) => dispatch({ type: "SET_NOTE", value: event.target.value })}
              rows={3}
              placeholder="Internal note visible to Admin staff only"
              className="h-auto w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
            />
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-24">
            <ReservationSummary data={reviewData} onReview={handleReviewClick} />
          </div>
        </div>
      </div>

      {isReviewOpen ? (
        <ReservationReviewDialog
          data={reviewData}
          onBackToEdit={handleBackToEdit}
          onConfirm={handleConfirm}
        />
      ) : null}
    </form>
  );
};

export default CreateReservationForm;
