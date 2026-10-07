"use client";

import DatePicker from "react-datepicker";
import React, { FC, Fragment, useEffect, useState } from "react";
import DatePickerCustomHeaderTwoMonth from "@/components/DatePickerCustomHeaderTwoMonth";
import DatePickerCustomDay from "@/components/DatePickerCustomDay";

export interface StayDatesRangeInputProps {
  className?: string;
  /** CP02-C3: controlled range (the shared stay search draft); without `onDatesChange` the field is the template's own. */
  startDate?: Date | null;
  endDate?: Date | null;
  onDatesChange?: (dates: [Date | null, Date | null]) => void;
  minDate?: Date;
}

const StayDatesRangeInput: FC<StayDatesRangeInputProps> = ({
  className = "",
  startDate: controlledStart,
  endDate: controlledEnd,
  onDatesChange,
  minDate,
}) => {
  const [ownStart, setStartDate] = useState<Date | null>(null);
  const [ownEnd, setEndDate] = useState<Date | null>(null);
  const startDate = onDatesChange ? controlledStart ?? null : ownStart;
  const endDate = onDatesChange ? controlledEnd ?? null : ownEnd;

  const onChangeDate = (dates: [Date | null, Date | null]) => {
    if (onDatesChange) {
      onDatesChange(dates);
      return;
    }
    const [start, end] = dates;
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div>
      <div className="p-5">
        <span className="block font-semibold text-xl sm:text-2xl">
          {` When's your trip?`}
        </span>
      </div>
      <div
        className={`relative flex-shrink-0 flex justify-center z-10 py-5 ${className} `}
      >
        <DatePicker
          selected={startDate}
          onChange={onChangeDate}
          startDate={startDate}
          endDate={endDate}
          minDate={minDate}
          selectsRange
          monthsShown={2}
          showPopperArrow={false}
          inline
          renderCustomHeader={(p) => <DatePickerCustomHeaderTwoMonth {...p} />}
          renderDayContents={(day, date) => (
            <DatePickerCustomDay dayOfMonth={day} date={date} />
          )}
        />
      </div>
    </div>
  );
};

export default StayDatesRangeInput;
