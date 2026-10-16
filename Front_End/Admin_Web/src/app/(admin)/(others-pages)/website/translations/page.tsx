import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import TranslationsRoute from "@/components/website/TranslationsRoute";
import { Metadata } from "next";
import React, { Suspense } from "react";

export const metadata: Metadata = {
  title: "Bản dịch | The BHA Admin",
  description: "Sửa bản dịch của website The BHA.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Bản dịch" />
      {/* CUST-WEB-HEADER-001-CP02: no request until a confirmed Staff session holds the website permission. */}
      <WebsiteAccessGate returnTo="/website/translations">
        <Suspense fallback={null}>
          <TranslationsRoute />
        </Suspense>
      </WebsiteAccessGate>
    </div>
  );
}
