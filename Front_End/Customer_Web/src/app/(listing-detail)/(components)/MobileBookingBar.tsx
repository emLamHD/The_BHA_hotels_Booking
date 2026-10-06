"use client";

import React, { FC } from "react";
import ButtonPrimary from "@/shared/ButtonPrimary";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { inProgressBookingTarget } from "@/lib/roomDetailsRoute";

export const BOOKING_PANEL_ID = "room-booking";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's sticky bar for small screens. It no longer opens a
 * second reservation form or a checkout: the one booking panel (search, offers, contact, hold,
 * confirm) is on the page, and this bar takes the visitor to it and says whether a booking is under
 * way. It states no price, because a price exists only for dates the visitor has chosen.
 */
const MobileBookingBar: FC = () => {
  const { state } = useBookingHoldFlow();
  const inProgress = inProgressBookingTarget(state) !== null;

  const goToBooking = () => {
    const panel = document.getElementById(BOOKING_PANEL_ID);
    if (!panel) return;
    panel.scrollIntoView({ block: "start" });
    panel.querySelector<HTMLElement>("input, select, button")?.focus({ preventScroll: true });
  };

  return (
    <div className="block lg:hidden fixed bottom-0 inset-x-0 py-2 sm:py-3 bg-white dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-6000 z-40">
      <div className="container flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {inProgress ? "Đặt phòng đang thực hiện" : "Chọn ngày để xem giá"}
        </span>
        <ButtonPrimary
          type="button"
          sizeClass="px-5 sm:px-7 py-3 !rounded-2xl"
          onClick={goToBooking}
        >
          {inProgress ? "Tiếp tục" : "Đặt phòng"}
        </ButtonPrimary>
      </div>
    </div>
  );
};

export default MobileBookingBar;
