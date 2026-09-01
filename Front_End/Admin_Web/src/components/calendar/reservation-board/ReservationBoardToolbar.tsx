"use client";

import React from "react";
import {
  CalenderIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  InfoIcon,
  LockIcon,
} from "@/icons";
import type {
  Property,
  PropertyId,
  ReservationBoardFilters,
  ReservationBoardRangeLength,
} from "./types";

interface RangeLengthOption {
  value: ReservationBoardRangeLength;
  label: string;
}

const RANGE_LENGTH_OPTIONS: RangeLengthOption[] = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 21, label: "21 days" },
  { value: 31, label: "1 month" },
];

interface FilterOption {
  key: keyof ReservationBoardFilters;
  label: string;
  swatchClassName: string;
}

const FILTER_OPTIONS: FilterOption[] = [
  {
    key: "showAssigned",
    label: "Assigned",
    swatchClassName: "bg-brand-500",
  },
  {
    key: "showUnassigned",
    label: "Unassigned",
    swatchClassName: "border-2 border-dashed border-purple-500 bg-purple-50 dark:bg-purple-500/10",
  },
  {
    key: "showOperationalBlocks",
    label: "Operational Blocks",
    swatchClassName: "border border-amber-500 bg-[repeating-linear-gradient(45deg,#fcd34d_0,#fcd34d_2px,transparent_2px,transparent_6px)] dark:bg-[repeating-linear-gradient(45deg,#b45309_0,#b45309_2px,transparent_2px,transparent_6px)]",
  },
  {
    key: "showInactive",
    label: "Inactive (cancelled/no-show)",
    swatchClassName: "border border-gray-400 bg-gray-200 dark:border-gray-600 dark:bg-gray-700",
  },
];

interface ReservationBoardToolbarProps {
  properties: Property[];
  selectedPropertyId: PropertyId;
  onSelectProperty: (propertyId: PropertyId) => void;
  rangeLength: ReservationBoardRangeLength;
  onSelectRangeLength: (length: ReservationBoardRangeLength) => void;
  rangeLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  filters: ReservationBoardFilters;
  onToggleFilter: (key: keyof ReservationBoardFilters) => void;
}

const ReservationBoardToolbar: React.FC<ReservationBoardToolbarProps> = ({
  properties,
  selectedPropertyId,
  onSelectProperty,
  rangeLength,
  onSelectRangeLength,
  rangeLabel,
  onPrev,
  onNext,
  onToday,
  filters,
  onToggleFilter,
}) => {
  return (
    <div className="flex flex-col gap-4 border-b border-gray-200 p-5 dark:border-gray-800 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LockIcon className="size-5 text-gray-400 dark:text-gray-500" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Reservation Board
          </h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-white/[0.05] dark:text-gray-300">
          <InfoIcon className="size-3.5" aria-hidden="true" />
          Live data — read-only (no assignment, block, or lifecycle actions yet)
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="reservation-board-property" className="sr-only">
            Property
          </label>
          <div className="relative">
            <select
              id="reservation-board-property"
              value={selectedPropertyId}
              onChange={(event) => onSelectProperty(event.target.value)}
              className="h-10 appearance-none rounded-lg border border-gray-300 bg-white pl-3 pr-9 text-sm font-medium text-gray-700 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:focus:border-brand-800"
            >
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
            <ChevronDownIcon
              className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-800">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous date range"
            className="flex size-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onToday}
            aria-label="Jump to today"
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <CalenderIcon className="size-4" aria-hidden="true" />
            Today
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next date range"
            className="flex size-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
          >
            <ChevronLeftIcon className="size-4 rotate-180" aria-hidden="true" />
          </button>
        </div>

        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
          {rangeLabel}
        </span>

        <fieldset className="ml-auto flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-800">
          <legend className="sr-only">Visible date range length</legend>
          {RANGE_LENGTH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={rangeLength === option.value}
              onClick={() => onSelectRangeLength(option.value)}
              className={`h-8 whitespace-nowrap rounded-md px-3 text-sm font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                rangeLength === option.value
                  ? "bg-white text-gray-900 shadow-theme-xs dark:bg-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((option) => {
          const isChecked = filters[option.key];
          return (
            <label
              key={option.key}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleFilter(option.key)}
                className="sr-only"
              />
              <span
                className={`size-3 rounded-sm ${option.swatchClassName} ${
                  isChecked ? "" : "opacity-40"
                }`}
                aria-hidden="true"
              />
              <span className={isChecked ? "" : "text-gray-400 dark:text-gray-500"}>
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default ReservationBoardToolbar;
