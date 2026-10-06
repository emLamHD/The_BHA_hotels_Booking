"use client";

import React, { FC } from "react";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's pill-shaped stay search, pointed at the one thing that
 * can be searched today. There is nothing to type here — dates, guests and rooms are chosen on the
 * room's own page, next to its real prices — so the button goes to the room section instead of
 * navigating to a mock listing page.
 */
const StaySearchForm: FC<{}> = () => {
  return (
    <div className="w-full relative mt-8 flex flex-col sm:flex-row rounded-3xl sm:rounded-full shadow-xl dark:shadow-2xl bg-white dark:bg-neutral-800">
      <div className="flex-[1.5] px-8 py-4 sm:py-0 flex flex-col justify-center">
        <span className="block font-semibold text-neutral-800 dark:text-neutral-100">Chỗ nghỉ</span>
        <span className="block mt-1 text-sm font-light text-neutral-400">The BHA Riverside</span>
      </div>
      <div className="self-center hidden sm:block border-r border-slate-200 dark:border-slate-700 h-8"></div>
      <div className="flex-1 px-8 py-4 sm:py-5 flex flex-col justify-center">
        <span className="block font-semibold text-neutral-800 dark:text-neutral-100">Loại phòng</span>
        <span className="block mt-1 text-sm font-light text-neutral-400">Chọn phòng, ngày và số khách ở trang chi tiết</span>
      </div>
      <div className="p-3 sm:pr-4 flex items-center">
        <ShowcaseNavLink
          section="rooms"
          className="h-14 md:h-16 w-full md:w-auto md:px-8 rounded-full bg-primary-6000 hover:bg-primary-700 flex items-center justify-center text-neutral-50 font-medium focus:outline-none"
        >
          Xem phòng
        </ShowcaseNavLink>
      </div>
    </div>
  );
};

export default StaySearchForm;
