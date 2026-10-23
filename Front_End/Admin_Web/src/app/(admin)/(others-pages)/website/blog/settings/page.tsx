import SettingsScreen from "@/components/blog/SettingsScreen";
import BlogAccessGate from "@/components/blog/BlogAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Cấu hình Blog | The BHA Admin",
  description: "Cấu hình mục Blog trên trang chủ.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Cấu hình Blog" />
      {/* BHA-BLOG-001-CP03: no request until a confirmed Staff session holds BlogEdit or BlogPublish. */}
      <BlogAccessGate returnTo="/website/blog/settings">
        <SettingsScreen />
      </BlogAccessGate>
    </div>
  );
}
