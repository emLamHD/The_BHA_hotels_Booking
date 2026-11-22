import BookingNotificationsScreen from "@/components/bookingNotifications/BookingNotificationsScreen";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Email nhận đặt phòng | The BHA Admin",
  description: "Chọn nhân viên và email nhận thông báo đặt phòng của từng cơ sở.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Email nhận đặt phòng" />
      {/* BHA-CHECKOUT-001-PR04: no request until a confirmed Staff session is a Manager of a Property. */}
      <BookingNotificationsScreen />
    </div>
  );
}
