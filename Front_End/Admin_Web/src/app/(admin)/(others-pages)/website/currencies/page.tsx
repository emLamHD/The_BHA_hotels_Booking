import CurrenciesPanel from "@/components/website/CurrenciesPanel";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Tiền tệ & tỷ giá | The BHA Admin",
  description: "Quản lý tiền tệ và tỷ giá hiển thị của website The BHA.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Tiền tệ & tỷ giá" />
      {/* CUST-WEB-HEADER-001-CP02: no request until a confirmed Staff session holds the website permission. */}
      <WebsiteAccessGate returnTo="/website/currencies">
        <CurrenciesPanel />
      </WebsiteAccessGate>
    </div>
  );
}
