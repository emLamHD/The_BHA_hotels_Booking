import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import TranslationsRoute from "@/components/website/TranslationsRoute";
import { Metadata } from "next";
import React, { Suspense } from "react";

export const metadata: Metadata = {
  title: "Website UI translations | The BHA Admin",
  description: "Manage the UI translations of The BHA website.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="UI translations" />
      {/* CUST-WEB-HEADER-001-CP02: no request until a confirmed Staff session holds the website permission. */}
      <WebsiteAccessGate returnTo="/website/translations">
        <Suspense fallback={null}>
          <TranslationsRoute />
        </Suspense>
      </WebsiteAccessGate>
    </div>
  );
}
