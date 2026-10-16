"use client";

import DatePickerCustomDay from "@/components/DatePickerCustomDay";
import DatePickerCustomHeaderTwoMonth from "@/components/DatePickerCustomHeaderTwoMonth";
import NcInputNumber from "@/components/NcInputNumber";
import React, { FC, useState } from "react";
import DatePicker from "@/components/LocalizedDatePicker";

import { useT } from "@/lib/i18n/I18nProvider";
export interface PageAddListing9Props {}

const PageAddListing9: FC<PageAddListing9Props> = () => {
  const t = useT();
  const [dates, setDates] = useState<number[]>([
    new Date("2023/02/06").getTime(),
    new Date("2023/02/09").getTime(),
    new Date("2023/02/15").getTime(),
  ]);

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing9.howLongCanGuestsStay")}</h2>
        <span className="block mt-2 text-neutral-500 dark:text-neutral-400">
          {" "}{t("customer.addListing.stepIndex.pageAddListing9.shorterTripsCanMeanMore")}
        </span>
      </div>
      <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
      {/* FORM */}
      <div className="space-y-7">
        {/* ITEM */}
        <NcInputNumber label={t("customer.addListing.stepIndex.pageAddListing9.nightsMin")} defaultValue={1} />
        <NcInputNumber label={t("customer.addListing.stepIndex.pageAddListing9.nightsMax")} defaultValue={99} />
      </div>

      {/*  */}
      <div>
        <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing9.setYourAvailability")}</h2>
        <span className="block mt-2 text-neutral-500 dark:text-neutral-400">{t("customer.addListing.stepIndex.pageAddListing9.editingYourCalendarIsEasy")}</span>
      </div>

      <div className="addListingDatePickerExclude">
        <DatePicker
          onChange={(date) => {
            let newDates = [];

            if (!date) {
              return;
            }
            const newTime = date.getTime();
            if (dates.includes(newTime)) {
              newDates = dates.filter((item) => item !== newTime);
            } else {
              newDates = [...dates, newTime];
            }
            setDates(newDates);
          }}
          // selected={startDate}
          monthsShown={2}
          showPopperArrow={false}
          excludeDates={dates.filter(Boolean).map((item) => new Date(item))}
          inline
          renderCustomHeader={(p) => <DatePickerCustomHeaderTwoMonth {...p} />}
          renderDayContents={(day, date) => (
            <DatePickerCustomDay dayOfMonth={day} date={date} />
          )}
        />
      </div>
    </>
  );
};

export default PageAddListing9;
