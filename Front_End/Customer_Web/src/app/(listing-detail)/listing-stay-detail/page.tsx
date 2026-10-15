import React, { Suspense } from "react";
import RoomDetailsRoot from "./RoomDetailsRoot";

import { getT } from "@/lib/i18n/server";
/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's stay detail route, now the page of one RoomType.
 * `?propertyId=&roomTypeId=` identifies the room; everything else comes from the API. The client
 * part reads the query, so it sits inside Suspense, which keeps the production build prerenderable.
 */
export default async function ListingStayDetailPage() {
  const t = await getT();
  return (
    <Suspense
      fallback={
        <div role="status" aria-live="polite" className="py-24 text-center text-neutral-500 dark:text-neutral-400">
          {t("customer.listingDetail.listingStayDetail.page.loadingRooms")}
        </div>
      }
    >
      <RoomDetailsRoot />
    </Suspense>
  );
}
