"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * BHA-BLOG-001-CP04-CP05-C7: the browser half of the Blog 404 recovery. Arriving here changed the pathname, which is what resets Next's not-found boundary; it then
 * REPLACES this entry with the Blog index the reader chose, so Back never lands on this step. Renders nothing visible; `to` was built by the page from a validated
 * language, never from the URL.
 */
export default function BlogRecover({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to as never);
  }, [router, to]);
  return <noscript><a href={to}>{to}</a></noscript>;
}
