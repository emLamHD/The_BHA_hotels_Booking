"use client";

import React from "react";
import { TrashBinIcon } from "@/icons";
import { diffDaysIso } from "@/components/calendar/reservation-board/dateMath";
import {
  MOCK_PHYSICAL_ROOMS,
  MOCK_ROOM_TYPES,
} from "@/components/calendar/reservation-board/mockData";
import type {
  PhysicalRoom,
  PropertyId,
  RoomType,
  RoomTypeId,
} from "@/components/calendar/reservation-board/types";
import { MOCK_RATE_PLANS, ratePlansForRoomType } from "./mockData";
import { findFieldError } from "./types";
import type { FieldError, ReservationUnitDraft } from "./types";

const AMOUNT_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

interface ReservationUnitEditorProps {
  unit: ReservationUnitDraft;
  index: number;
  propertyId: PropertyId | "";
  errors: FieldError[];
  showErrors: boolean;
  canRemove: boolean;
  onFieldChange: (
    unitId: string,
    field: keyof ReservationUnitDraft,
    value: string | number
  ) => void;
  onRemove: (unitId: string) => void;
}

const inputClassName =
  "h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800";
const invalidInputClassName =
  "border-error-300 focus:border-error-300 focus:ring-error-500/10 dark:border-error-500/60";
const labelClassName = "mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300";
const errorTextClassName = "mt-1.5 text-xs text-error-600 dark:text-error-400";

function fieldMessage(
  errors: FieldError[],
  showErrors: boolean,
  path: string
): string | undefined {
  return showErrors ? findFieldError(errors, path) : undefined;
}

const ReservationUnitEditor: React.FC<ReservationUnitEditorProps> = ({
  unit,
  index,
  propertyId,
  errors,
  showErrors,
  canRemove,
  onFieldChange,
  onRemove,
}) => {
  const unitLabel = `Room ${index + 1}`;
  const path = (field: string) => `unit:${unit.id}.${field}`;

  const roomTypesForProperty: RoomType[] = propertyId
    ? MOCK_ROOM_TYPES.filter((roomType) => roomType.propertyId === propertyId)
    : [];
  const roomTypeIdsForProperty = new Set(roomTypesForProperty.map((roomType) => roomType.id));
  const physicalRoomsForProperty: PhysicalRoom[] = propertyId
    ? MOCK_PHYSICAL_ROOMS.filter((room) => roomTypeIdsForProperty.has(room.roomTypeId))
    : [];
  const physicalRoomsByRoomType = new Map<RoomTypeId, PhysicalRoom[]>();
  physicalRoomsForProperty.forEach((room) => {
    const bucket = physicalRoomsByRoomType.get(room.roomTypeId) ?? [];
    bucket.push(room);
    physicalRoomsByRoomType.set(room.roomTypeId, bucket);
  });

  const ratePlanOptions = unit.soldRoomTypeId ? ratePlansForRoomType(unit.soldRoomTypeId) : [];

  const soldRoomType = unit.soldRoomTypeId
    ? MOCK_ROOM_TYPES.find((roomType) => roomType.id === unit.soldRoomTypeId) ?? null
    : null;
  const physicalRoom = unit.physicalRoomId
    ? MOCK_PHYSICAL_ROOMS.find((room) => room.id === unit.physicalRoomId) ?? null
    : null;
  const assignedRoomType = physicalRoom
    ? MOCK_ROOM_TYPES.find((roomType) => roomType.id === physicalRoom.roomTypeId) ?? null
    : null;
  const crossesRoomType = Boolean(
    soldRoomType && assignedRoomType && soldRoomType.id !== assignedRoomType.id
  );

  const nights =
    unit.checkIn && unit.checkOut ? Math.max(diffDaysIso(unit.checkIn, unit.checkOut), 0) : 0;
  const selectedRatePlan = unit.ratePlanId
    ? MOCK_RATE_PLANS.find((plan) => plan.id === unit.ratePlanId) ?? null
    : null;
  const subtotal = selectedRatePlan && nights > 0 ? selectedRatePlan.nightlyAmount * nights : null;

  const soldRoomTypeError = fieldMessage(errors, showErrors, path("soldRoomTypeId"));
  const ratePlanError = fieldMessage(errors, showErrors, path("ratePlanId"));
  const physicalRoomError = fieldMessage(errors, showErrors, path("physicalRoomId"));
  const checkInError = fieldMessage(errors, showErrors, path("checkIn"));
  const checkOutError = fieldMessage(errors, showErrors, path("checkOut"));
  const adultsError = fieldMessage(errors, showErrors, path("adults"));
  const childrenError = fieldMessage(errors, showErrors, path("children"));

  return (
    <fieldset className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <legend className="text-base font-semibold text-gray-800 dark:text-white/90">
          {unitLabel}
        </legend>
        {canRemove ? (
          <button
            type="button"
            onClick={() => onRemove(unit.id)}
            aria-label={`Remove ${unitLabel}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <TrashBinIcon className="size-3.5" aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${unit.id}-sold-room-type`} className={labelClassName}>
            Sold RoomType <span className="text-error-500">*</span>
          </label>
          <select
            id={`${unit.id}-sold-room-type`}
            value={unit.soldRoomTypeId}
            onChange={(event) => onFieldChange(unit.id, "soldRoomTypeId", event.target.value)}
            disabled={!propertyId}
            aria-invalid={Boolean(soldRoomTypeError)}
            aria-describedby={soldRoomTypeError ? `${unit.id}-sold-room-type-error` : undefined}
            className={`${inputClassName} ${soldRoomTypeError ? invalidInputClassName : ""} disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-white/[0.02]`}
          >
            <option value="">
              {propertyId ? "Select a room type…" : "Select a property first"}
            </option>
            {roomTypesForProperty.map((roomType) => (
              <option key={roomType.id} value={roomType.id}>
                {roomType.name}
              </option>
            ))}
          </select>
          {soldRoomTypeError ? (
            <p id={`${unit.id}-sold-room-type-error`} className={errorTextClassName}>
              {soldRoomTypeError}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={`${unit.id}-rate-plan`} className={labelClassName}>
            Rate Plan <span className="text-error-500">*</span>
          </label>
          <select
            id={`${unit.id}-rate-plan`}
            value={unit.ratePlanId}
            onChange={(event) => onFieldChange(unit.id, "ratePlanId", event.target.value)}
            disabled={!unit.soldRoomTypeId}
            aria-invalid={Boolean(ratePlanError)}
            aria-describedby={ratePlanError ? `${unit.id}-rate-plan-error` : undefined}
            className={`${inputClassName} ${ratePlanError ? invalidInputClassName : ""} disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-white/[0.02]`}
          >
            <option value="">
              {unit.soldRoomTypeId ? "Select a rate plan…" : "Select a sold room type first"}
            </option>
            {ratePlanOptions.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} — {AMOUNT_FORMATTER.format(plan.nightlyAmount)}/night
              </option>
            ))}
          </select>
          {ratePlanError ? (
            <p id={`${unit.id}-rate-plan-error`} className={errorTextClassName}>
              {ratePlanError}
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${unit.id}-physical-room`} className={labelClassName}>
            Assigned PhysicalRoom{" "}
            <span className="text-gray-400 dark:text-gray-500">(optional — may stay Unassigned)</span>
          </label>
          <select
            id={`${unit.id}-physical-room`}
            value={unit.physicalRoomId}
            onChange={(event) => onFieldChange(unit.id, "physicalRoomId", event.target.value)}
            disabled={!propertyId}
            aria-invalid={Boolean(physicalRoomError)}
            aria-describedby={physicalRoomError ? `${unit.id}-physical-room-error` : undefined}
            className={`${inputClassName} ${physicalRoomError ? invalidInputClassName : ""} disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-white/[0.02]`}
          >
            <option value="">Unassigned</option>
            {roomTypesForProperty.map((roomType) => (
              <optgroup key={roomType.id} label={roomType.name}>
                {(physicalRoomsByRoomType.get(roomType.id) ?? []).map((room) => (
                  <option key={room.id} value={room.id}>
                    Room {room.code}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {physicalRoomError ? (
            <p id={`${unit.id}-physical-room-error`} role="alert" className={errorTextClassName}>
              {physicalRoomError}
            </p>
          ) : null}
          {!physicalRoomError && crossesRoomType && soldRoomType && assignedRoomType ? (
            <p className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
              Sold RoomType: {soldRoomType.name}
              <br />
              Assigned PhysicalRoom type: {assignedRoomType.name}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={`${unit.id}-check-in`} className={labelClassName}>
            Check-in date <span className="text-error-500">*</span>
          </label>
          <input
            id={`${unit.id}-check-in`}
            type="date"
            value={unit.checkIn}
            onChange={(event) => onFieldChange(unit.id, "checkIn", event.target.value)}
            aria-invalid={Boolean(checkInError)}
            aria-describedby={checkInError ? `${unit.id}-check-in-error` : undefined}
            className={`${inputClassName} ${checkInError ? invalidInputClassName : ""}`}
          />
          {checkInError ? (
            <p id={`${unit.id}-check-in-error`} className={errorTextClassName}>
              {checkInError}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={`${unit.id}-check-out`} className={labelClassName}>
            Checkout date <span className="text-error-500">*</span>
          </label>
          <input
            id={`${unit.id}-check-out`}
            type="date"
            value={unit.checkOut}
            min={unit.checkIn || undefined}
            onChange={(event) => onFieldChange(unit.id, "checkOut", event.target.value)}
            aria-invalid={Boolean(checkOutError)}
            aria-describedby={checkOutError ? `${unit.id}-check-out-error` : undefined}
            className={`${inputClassName} ${checkOutError ? invalidInputClassName : ""}`}
          />
          {checkOutError ? (
            <p id={`${unit.id}-check-out-error`} className={errorTextClassName}>
              {checkOutError}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "Select both dates"}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${unit.id}-adults`} className={labelClassName}>
            Adults <span className="text-error-500">*</span>
          </label>
          <input
            id={`${unit.id}-adults`}
            type="number"
            min={1}
            value={unit.adults}
            onChange={(event) => onFieldChange(unit.id, "adults", Number(event.target.value))}
            aria-invalid={Boolean(adultsError)}
            aria-describedby={adultsError ? `${unit.id}-adults-error` : undefined}
            className={`${inputClassName} ${adultsError ? invalidInputClassName : ""}`}
          />
          {adultsError ? (
            <p id={`${unit.id}-adults-error`} className={errorTextClassName}>
              {adultsError}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={`${unit.id}-children`} className={labelClassName}>
            Children
          </label>
          <input
            id={`${unit.id}-children`}
            type="number"
            min={0}
            value={unit.children}
            onChange={(event) => onFieldChange(unit.id, "children", Number(event.target.value))}
            aria-invalid={Boolean(childrenError)}
            aria-describedby={childrenError ? `${unit.id}-children-error` : undefined}
            className={`${inputClassName} ${childrenError ? invalidInputClassName : ""}`}
          />
          {childrenError ? (
            <p id={`${unit.id}-children-error`} className={errorTextClassName}>
              {childrenError}
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${unit.id}-special-request`} className={labelClassName}>
            Special request{" "}
            <span className="text-gray-400 dark:text-gray-500">(optional)</span>
          </label>
          <textarea
            id={`${unit.id}-special-request`}
            value={unit.specialRequest}
            onChange={(event) => onFieldChange(unit.id, "specialRequest", event.target.value)}
            rows={2}
            placeholder="e.g. High floor, away from elevator"
            className={`${inputClassName} h-auto resize-none py-2.5`}
          />
        </div>
      </div>

      {selectedRatePlan && subtotal !== null ? (
        <p className="mt-4 text-right text-sm text-gray-600 dark:text-gray-300">
          {nights} night{nights === 1 ? "" : "s"} × {AMOUNT_FORMATTER.format(selectedRatePlan.nightlyAmount)}{" "}
          ={" "}
          <span className="font-semibold text-gray-800 dark:text-white/90">
            {AMOUNT_FORMATTER.format(subtotal)}
          </span>{" "}
          <span className="text-xs text-gray-400 dark:text-gray-500">(demo estimate)</span>
        </p>
      ) : null}
    </fieldset>
  );
};

export default ReservationUnitEditor;
