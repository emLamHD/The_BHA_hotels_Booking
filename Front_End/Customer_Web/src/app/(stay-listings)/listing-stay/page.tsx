import React, { Suspense } from "react";
import SectionGridFilterCard from "../SectionGridFilterCard";

import { getT } from "@/lib/i18n/server";
// The page reads the URL's search on the client; Suspense keeps the static shell buildable.
export default async function ListingStayPage() {
  const t = await getT();
  return (
    <Suspense
      fallback={
        <div className="container pt-10 pb-24 lg:pt-16 lg:pb-28">
          <p role="status" className="text-neutral-500">{t("customer.stayListings.listingStay.page.loading")}</p>
        </div>
      }
    >
      <SectionGridFilterCard className="container pt-10 pb-24 lg:pt-16 lg:pb-28" />
    </Suspense>
  );
}

