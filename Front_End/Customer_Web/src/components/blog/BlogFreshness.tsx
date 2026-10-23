"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** A page that mounts this long after the document was loaded did not come from this document's own first response (a soft navigation). */
const SOFT_NAVIGATION_AFTER_MS = 4000;

/**
 * BHA-BLOG-001-CP04: Next 13.4's client router cache keeps a page the tab has already visited for the rest of the session (measured: still served after 70 s), so a
 * reader who goes back to a post — or opens it again from a list — in the same tab would still see a post the Admin has since unpublished. A Blog page therefore
 * refreshes its route when it is shown by a client navigation: the server answers again (a post that is no longer public is a 404, a list is the current one).
 * A page loaded as a real request is already fresh and asks for nothing. Renders nothing.
 */
export default function BlogFreshness() {
  const router = useRouter();
  useEffect(() => {
    if (performance.now() > SOFT_NAVIGATION_AFTER_MS) router.refresh();
  }, [router]);
  return null;
}
