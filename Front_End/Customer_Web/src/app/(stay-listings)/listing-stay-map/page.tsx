import { redirect } from "next/navigation";
import { buildListingAliasHref } from "@/lib/stayListingQuery";

// The redirect depends on the request's query: without this Next prerenders it once, at build time, to a
// bare /listing-stay and every visitor loses their search.
export const dynamic = "force-dynamic";

export interface ListingStayMapPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

/**
 * CUST-WEB-001-CP05a: there is no map yet (the catalog has no coordinates), so this route is only an
 * alias of the results page. The target is the fixed /listing-stay; the known search keys travel with
 * every value they had, repeated ones included, so the results page reports a bad URL itself.
 */
export default function ListingStayMapPage({ searchParams }: ListingStayMapPageProps) {
  redirect(buildListingAliasHref(searchParams) as never);
}
