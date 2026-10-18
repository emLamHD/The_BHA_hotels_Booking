import SocialMediaPanel from "@/components/website/SocialMediaPanel";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Social media | The BHA Admin" };

export default function Page() {
  return <div className="flex flex-col gap-6">
    <PageBreadcrumb pageTitle="Social media" />
    <WebsiteAccessGate returnTo="/website/social-media"><SocialMediaPanel /></WebsiteAccessGate>
  </div>;
}
