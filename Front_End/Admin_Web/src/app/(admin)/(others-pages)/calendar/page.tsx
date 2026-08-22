import Calendar from "@/components/calendar/Calendar";
import ReservationBoard from "@/components/calendar/reservation-board/ReservationBoard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "The BHA Admin Calendar",
  description:
    "The BHA Admin PMS Reservation Board and Events Calendar page.",
  // other metadata
};
export default function page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Calendar" />
      <ReservationBoard />
      <div>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Events Calendar
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            General event calendar, unrelated to the Reservation Board above.
          </p>
        </div>
        <Calendar />
      </div>
    </div>
  );
}
