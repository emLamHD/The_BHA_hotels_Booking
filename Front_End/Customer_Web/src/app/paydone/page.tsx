import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import PayDoneReceipt from "./PayDoneReceipt";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.paydone") };
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the template's pay-done layout, as the live receipt of a booking made
 * in this browser tab: "Đã giữ chỗ" after a hold, "Đặt phòng đã xác nhận" only once the confirm
 * request returned a Reservation. The template's `/pay-done` redirects here.
 */
export default function PayDonePage() {
  return <PayDoneReceipt />;
}
