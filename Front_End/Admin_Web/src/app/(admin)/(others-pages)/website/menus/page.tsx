import MenusPanel from "@/components/website/MenusPanel";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Menu header | The BHA Admin",
  description: "Quản lý menu header của website The BHA: thêm, sửa, sắp xếp, đổi link và nhãn.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Menu header" />
      {/* CUST-WEB-HEADER-001-CP04: no request until a confirmed Staff session holds the website permission. */}
      <WebsiteAccessGate returnTo="/website/menus">
        <MenusPanel />
      </WebsiteAccessGate>
    </div>
  );
}
