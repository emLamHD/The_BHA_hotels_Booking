import NewsletterSubscriptionsPanel from "@/components/website/NewsletterSubscriptionsPanel";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Đăng ký nhận tin | The BHA Admin" };

export default function Page() {
  return <div className="flex flex-col gap-6">
    <PageBreadcrumb pageTitle="Đăng ký nhận tin" />
    <WebsiteAccessGate returnTo="/website/newsletter"><NewsletterSubscriptionsPanel /></WebsiteAccessGate>
  </div>;
}
