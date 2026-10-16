import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import AccountSessionPanel from "./AccountSessionPanel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.account") };
}

/**
 * CUST-WEB-001-CP04: the read-only account page. Nothing here is fetched on the server — who the Customer is
 * comes from the session provider in the browser, so the server render carries no profile and no email.
 */
export default function AccountPage() {
  return <AccountSessionPanel />;
}
