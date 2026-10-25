"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { blogRecoverToHref } from "@/lib/blog/blog";
import { revalidateBlog404 } from "@/lib/blog/revalidate404";

/** BHA-BLOG-001-CP04-CP05-C9: asks the server once whether the Blog 404 on screen is still true, and leaves it through `/blog-recover` when the page now exists (see `lib/blog/revalidate404`). Renders nothing. */
export default function BlogNotFoundRevalidate() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const here = () => window.location.pathname + window.location.search;
    const abort = new AbortController();
    void revalidateBlog404({
      href: here(),
      origin: window.location.origin,
      fetcher: (input, init) => fetch(input, init),         // not `fetch` itself: called as a property it would lose its `this`
      signal: abort.signal,
      current: here,
      // `replace`: the 404's history entry becomes the step, and the step replaces itself with the page, so Back never lands on either.
      recover: (target) => router.replace(blogRecoverToHref(target) as never),
    });
    return () => abort.abort();
  }, [router, pathname, search]);
  return null;
}
