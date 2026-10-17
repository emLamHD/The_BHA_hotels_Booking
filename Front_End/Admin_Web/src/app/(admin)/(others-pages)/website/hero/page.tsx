import HeroPanel from "@/components/website/HeroPanel";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Banner trang chủ | The BHA Admin",
  description: "Quản lý banner trượt của trang chủ The BHA: ảnh, thứ tự, chữ, font và cách tự chuyển ảnh.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Banner trang chủ" />
      {/* CUST-WEB-HERO-001-CP01: no request until a confirmed Staff session holds the website permission. */}
      <WebsiteAccessGate returnTo="/website/hero">
        <HeroPanel />
      </WebsiteAccessGate>
    </div>
  );
}
