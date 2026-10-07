"use client";

import React, { Fragment, FC } from "react";
import { Popover, Transition } from "@headlessui/react";
import { CalendarIcon } from "@heroicons/react/24/outline";
import DatePickerCustomHeaderTwoMonth from "@/components/DatePickerCustomHeaderTwoMonth";
import DatePickerCustomDay from "@/components/DatePickerCustomDay";
import DatePicker from "react-datepicker";
import ClearDataButton from "@/app/(client-components)/(HeroSearchForm)/ClearDataButton";

export interface StayDatesRangeInputProps {
  className?: string;
  /** The range, owned by the booking panel's draft. */
  startDate: Date | null;
  endDate: Date | null;
  onDatesChange: (dates: [Date | null, Date | null]) => void;
  minDate?: Date;
  disabled?: boolean;
}

/**
 * The template's sidebar date field (popover with the two-month calendar), controlled by the booking
 * panel's draft. CP02-C3 restored it from the template and removed its hard-coded 2023 dates.
 */
const StayDatesRangeInput: FC<StayDatesRangeInputProps> = ({
  className = "flex-1",
  startDate,
  endDate,
  onDatesChange,
  minDate,
  disabled,
}) => {
  const renderInput = () => {
    return (
      <>
        <div className="text-neutral-300 dark:text-neutral-400">
          <CalendarIcon className="w-5 h-5 lg:w-7 lg:h-7" />
        </div>
        <div className="flex-grow text-left">
          <span className="block xl:text-lg font-semibold">
            {startDate?.toLocaleDateString("en-US", {
              month: "short",
              day: "2-digit",
            }) || "Add dates"}
            {endDate
              ? " - " +
                endDate?.toLocaleDateString("en-US", {
                  month: "short",
                  day: "2-digit",
                })
              : ""}
          </span>
          <span className="block mt-1 text-sm text-neutral-400 leading-none font-light">
            {"Check in - Check out"}
          </span>
        </div>
      </>
    );
  };

  return (
    <Popover className={`StayDatesRangeInput z-10 relative flex ${className}`}>
      {({ open }) => (
        <>
          <Popover.Button
            disabled={disabled}
            className={`flex-1 flex relative p-3 items-center space-x-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6000 rounded-t-3xl ${
              open ? "shadow-lg" : ""
            } disabled:opacity-60`}
          >
            {renderInput()}
            {startDate && open && (
              <ClearDataButton onClick={() => onDatesChange([null, null])} />
            )}
          </Popover.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="absolute left-auto xl:-right-10 right-0 z-10 mt-3 top-full w-screen max-w-sm px-4 sm:px-0 lg:max-w-3xl">
              <div className="overflow-hidden rounded-3xl shadow-lg ring-1 ring-black ring-opacity-5 bg-white dark:bg-neutral-800 p-8">
                <DatePicker
                  selected={startDate}
                  onChange={onDatesChange}
                  startDate={startDate}
                  endDate={endDate}
                  minDate={minDate}
                  selectsRange
                  monthsShown={2}
                  showPopperArrow={false}
                  inline
                  renderCustomHeader={(p) => (
                    <DatePickerCustomHeaderTwoMonth {...p} />
                  )}
                  renderDayContents={(day, date) => (
                    <DatePickerCustomDay dayOfMonth={day} date={date} />
                  )}
                />
              </div>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default StayDatesRangeInput;
