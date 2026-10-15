import LanguagesPanel from "@/components/website/LanguagesPanel";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Website languages | The BHA Admin",
  description: "Manage the languages of The BHA website.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Website languages" />
      {/* CUST-WEB-HEADER-001-CP02: no request until a confirmed Staff session holds the website permission. */}
      <WebsiteAccessGate returnTo="/website/languages">
        <LanguagesPanel />
      </WebsiteAccessGate>
    </div>
  );
}
