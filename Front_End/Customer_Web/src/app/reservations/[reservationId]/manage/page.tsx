import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { MANAGE } from "@/lib/reservationManagement";
import ManageReservation from "./ManageReservation";

// A private page reached from an e-mail: always rendered per request, never cached, never indexed. The matching HTTP headers
// (Referrer-Policy, X-Robots-Tag) are set for exactly this route in next.config.js; these tags are the in-document copy. `force-dynamic` is also what
// makes Next answer `Cache-Control: private, no-cache, no-store, …` (it overwrites a configured value for a page).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t(MANAGE.meta), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** BHA-CHECKOUT-001-PR09: where the guest's one-time e-mail link (`/reservations/{id}/manage#<secret>`) and an account owner's receipt link land. */
export default function ReservationManagePage({ params }: { params: { reservationId: string } }) {
  return <ManageReservation reservationId={params.reservationId} />;
}
