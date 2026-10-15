import React from "react";
import Link from "next/link";

import { getT } from "@/lib/i18n/server";
export default async function Unavailable() {
  const t = await getT();
  return (
    <div className="container max-w-2xl space-y-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t("customer.showcaseUnavailable.notFound.thisFeatureIsNotIn")}</h1>
      <p className="text-neutral-600 dark:text-neutral-300">{t("customer.showcaseUnavailable.notFound.thisDemoOnlyCoversViewing")}</p>
      {/* CP01-C1 (F1): client navigation keeps an in-progress guest hold. */}
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-full bg-primary-6000 px-6 py-3 font-medium text-neutral-50 hover:bg-primary-700"
      >{t("customer.showcaseUnavailable.notFound.backToTheBookingPage")}</Link>
    </div>
  );
}
