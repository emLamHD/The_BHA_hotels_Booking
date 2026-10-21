import PromotionsScreen from "@/components/promotions/PromotionsScreen";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Ưu đãi đặt phòng | The BHA Admin",
  description: "Quản lý ưu đãi đặt phòng của cơ sở: quy tắc giảm giá, nội dung giới thiệu và thẻ ưu đãi trên trang chủ.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Ưu đãi đặt phòng" />
      {/* BHA-BOOKING-PROMOTIONS-001: no request until a confirmed Staff session is a Manager of a Property. */}
      <PromotionsScreen />
    </div>
  );
}
