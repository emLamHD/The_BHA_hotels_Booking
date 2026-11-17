import NewsletterSenderPanel from "@/components/website/NewsletterSenderPanel";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cấu hình email gửi | The BHA Admin" };

export default function Page() {
  return <div className="flex flex-col gap-6">
    <PageBreadcrumb pageTitle="Cấu hình email gửi" />
    <WebsiteAccessGate returnTo="/website/newsletter/sender"><NewsletterSenderPanel /></WebsiteAccessGate>
  </div>;
}
