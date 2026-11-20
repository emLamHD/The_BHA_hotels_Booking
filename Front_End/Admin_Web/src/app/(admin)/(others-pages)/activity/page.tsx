import ActivityScreen from "@/components/activity/ActivityScreen";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React, { Suspense } from "react";

export const metadata: Metadata = {
  title: "Lịch sử hoạt động | The BHA Admin",
  description: "Lịch sử hoạt động của các menu Admin mà tài khoản Staff được xem. Chỉ xem, không đánh dấu đã xem.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Lịch sử hoạt động" />
      {/* BHA-ADMIN-BADGE-001-PR05: any signed-in Staff; nothing is requested in LocalGate. `useSearchParams` (the popover's link carries the menu and Property) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <ActivityScreen />
      </Suspense>
    </div>
  );
}
