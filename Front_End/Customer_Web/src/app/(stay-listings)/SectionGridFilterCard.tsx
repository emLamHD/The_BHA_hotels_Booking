"use client";

import React, { FC, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ListingStaySearchForm from "./ListingStaySearchForm";
import ListingStayResults from "./ListingStayResults";
import { useListingStaySearch } from "./useListingStaySearch";
import {
  buildStayListingHref,
  parseStayListingQuery,
  StayBrand,
  stayListingKey,
  DEFAULT_STAY_BRAND,
} from "@/lib/stayListingQuery";
import type { AvailabilityDraft } from "@/lib/api/availabilityValidation";

export interface SectionGridFilterCardProps {
  className?: string;
}

/**
 * CUST-WEB-001-CP05a: /listing-stay as the real Riverside catalog / availability page. The URL is the only
 * source of what is searched (`lib/stayListingQuery`), the form holds an editable draft until Search, and
 * the results come from the page's own controller (`lib/stayListingSearch`). The template's sample
 * listings, filter tabs and pagination are gone from this page; nothing here holds a room.
 */
const SectionGridFilterCard: FC<SectionGridFilterCardProps> = ({ className = "" }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams?.toString() ?? "";
  // The parsed query follows the URL's text, so an unrelated re-render does not look like a new query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const query = useMemo(() => parseStayListingQuery(new URLSearchParams(queryString)), [queryString]);
  const key = stayListingKey(query);
  const { state, retry } = useListingStaySearch(query);

  const go = (href: string) => router.push(href as never);

  const apply = (brand: StayBrand, search: AvailabilityDraft) => {
    const href = buildStayListingHref(brand, search);
    // The same applied query again is not a navigation: it re-reads the server once.
    if (stayListingKey(parseStayListingQuery(new URL(href, "https://local.invalid").searchParams)) === key) retry();
    else go(href);
  };

  const clear = () => go(buildStayListingHref(query.brand ?? DEFAULT_STAY_BRAND));

  return (
    <div className={`nc-SectionGridFilterCard relative ${className}`} data-nc-id="SectionGridFilterCard">
      <div className="mb-8 lg:mb-10">
        <h1 className="text-4xl font-semibold">Tìm phòng tại The BHA</h1>
        <span className="mt-3 block text-neutral-500 dark:text-neutral-400">
          Chọn ngày và số khách để xem loại phòng còn trống và giá. Kết quả chưa giữ phòng.
        </span>
      </div>

      <div className="mb-8 lg:mb-11">
        <ListingStaySearchForm key={key} applied={query} onApply={apply} onClear={clear} />
      </div>

      <ListingStayResults query={query} state={state} onRetry={retry} onClear={clear} />
    </div>
  );
};

export default SectionGridFilterCard;
