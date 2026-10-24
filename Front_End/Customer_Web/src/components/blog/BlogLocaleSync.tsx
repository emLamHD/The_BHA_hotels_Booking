"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isBlogPath, normalizeLocale } from "@/lib/blog/blog";

/**
 * BHA-BLOG-001-CP04-CP05-C6: on a Blog URL an explicit `?locale=` decides the page's language and the layout's (header, menu, `<html lang>`, dictionary) for that
 * request — the cookie is untouched. A soft navigation keeps the root layout as it was, so leaving such a page for Home or the FAQ would leave the layout in the
 * Blog URL's language while the destination's content follows the cookie. This lives in the root layout, so it outlasts the Blog page (`BlogFreshness` unmounts with
 * it): when the address moves from a Blog page that names its language to anything that is not the Blog, it asks the server again once and the layout follows the
 * destination. Blog-to-Blog and into-the-Blog are `BlogFreshness`'s refresh; the providers above stay mounted; no cookie is written; renders nothing.
 */
export default function BlogLocaleSync() {
  const router = useRouter();
  const pathname = usePathname();
  const language = normalizeLocale(useSearchParams().get("locale"));
  const named = useRef(false);
  useEffect(() => {
    const blog = isBlogPath(pathname);
    if (named.current && !blog) router.refresh();
    named.current = blog && language !== null;
  }, [router, pathname, language]);
  return null;
}
