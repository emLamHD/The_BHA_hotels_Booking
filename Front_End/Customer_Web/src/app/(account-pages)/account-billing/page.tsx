import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import AccountUnavailable from "../(components)/AccountUnavailable";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.unavailable") };
}

/** CUST-WEB-001-CP04: no payment or payout feature behind this route yet; it says so instead of showing a template. */
export default async function AccountBillingPage() {
  const t = await getT();
  return <AccountUnavailable feature={t("customer.account.feature.billing")} />;
}
