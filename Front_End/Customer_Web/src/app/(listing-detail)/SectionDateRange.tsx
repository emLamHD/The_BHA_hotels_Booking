import React, { FC, Fragment, useState } from "react";
import DatePicker from "@/components/LocalizedDatePicker";
import DatePickerCustomHeaderTwoMonth from "@/components/DatePickerCustomHeaderTwoMonth";
import DatePickerCustomDay from "@/components/DatePickerCustomDay";

import { useT } from "@/lib/i18n/I18nProvider";
const SectionDateRange = () => {
  const t = useT();
  const [startDate, setStartDate] = useState<Date | null>(
    new Date("2023/02/06")
  );
  const [endDate, setEndDate] = useState<Date | null>(new Date("2023/02/23"));
  const onChangeDate = (dates: [Date | null, Date | null]) => {
    const [start, end] = dates;
    setStartDate(start);
    setEndDate(end);
  };

  const renderSectionCheckIndate = () => {
    return (
      <div className="listingSection__wrap overflow-hidden">
        {/* HEADING */}
        <div>
          <h2 className="text-2xl font-semibold">{t("customer.listingDetail.sectionDateRange.availability")}</h2>
          <span className="block mt-2 text-neutral-500 dark:text-neutral-400">{t("customer.listingDetail.sectionDateRange.pricesMayIncreaseOnWeekends")}</span>
        </div>
        <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
        {/* CONTENT */}

        <div className="">
          <DatePicker
            selected={startDate}
            onChange={onChangeDate}
            startDate={startDate}
            endDate={endDate}
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
      </div>
    );
  };

  return renderSectionCheckIndate();
};

export default SectionDateRange;
