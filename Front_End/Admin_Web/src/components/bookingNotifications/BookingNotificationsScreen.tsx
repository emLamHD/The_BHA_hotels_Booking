"use client";

import React from "react";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import BookingNotificationsWorkspace, { BOOKING_NOTIFICATION_RULE } from "./BookingNotificationsWorkspace";

/** The gate and the workspace together, so the server page passes no function across the client boundary. */
export default function BookingNotificationsScreen() {
  return (
    <WebsiteAccessGate returnTo="/booking-notifications" rule={BOOKING_NOTIFICATION_RULE}>
      <BookingNotificationsWorkspace />
    </WebsiteAccessGate>
  );
}
