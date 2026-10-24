"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * BHA-BLOG-001-CP04: Next 13.4's client router cache keeps a page the tab has already visited for the rest of the session (measured: still served after 70 s), so a
 * reader who goes back to a post — or opens it again from a list — in the same tab would still see a post the Admin has since unpublished. A Blog page — and the home
 * page, which reads two Blog projections (C7) — therefore refreshes its route whenever it is shown or its address changes: the server answers again (a post that is no longer public is a 404, a list is the current one).
 * There is no way to tell a cached soft navigation from the first load by time (a revisit can come a second after the tab opened), so the first load asks once more
 * too — one extra request. A refresh re-renders this component at the same address, which does not run the effect again: no loop, no polling. Renders nothing.
 */
export default function BlogFreshness() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    router.refresh();
  }, [router, pathname, search]);
  return null;
}
