import NewsletterSenderCallback from "@/components/website/NewsletterSenderCallback";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kết nối Gmail | The BHA Admin", referrer: "no-referrer" };

/** BHA-NEWSLETTER-002: where Google sends the browser back. Signing in again returns to the sender page (the code is single use and is not kept). */
export default function Page() {
  return <div className="flex flex-col gap-6">
    <PageBreadcrumb pageTitle="Kết nối Gmail" />
    <WebsiteAccessGate returnTo="/website/newsletter/sender"><NewsletterSenderCallback /></WebsiteAccessGate>
  </div>;
}
