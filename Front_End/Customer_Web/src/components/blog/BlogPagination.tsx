import React from "react";
import Link from "next/link";
import type { Route } from "next";

interface Labels {
  navigation: string;
  previous: string;
  next: string;
  goTo: (page: number) => string;
}

/** The pages to link: the first, the last and a window round the current one, with gaps (`null`) between. */
export function pageWindow(current: number, last: number): (number | null)[] {
  const wanted = new Set([1, last, current - 1, current, current + 1]);
  const pages = Array.from(wanted).filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

const ITEM = "inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-full border px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";
const IDLE = "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800";

/** Server-side pagination: plain links (a crawler and a reader without scripts both follow them); nothing renders when there is one page. */
export default function BlogPagination({ current, last, hrefFor, labels }: { current: number; last: number; hrefFor: (page: number) => string; labels: Labels }) {
  if (last <= 1) return null;
  return (
    <nav aria-label={labels.navigation} data-testid="blog-pagination" className="mt-12 flex flex-wrap items-center justify-center gap-2">
      {current > 1 && (
        <Link href={hrefFor(current - 1) as Route} prefetch={false} rel="prev" className={`${ITEM} ${IDLE}`}>{labels.previous}</Link>
      )}
      {pageWindow(current, last).map((page, index) =>
        page === null ? (
          <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-neutral-500">…</span>
        ) : page === current ? (
          <span key={page} aria-current="page" className={`${ITEM} border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900`}>{page}</span>
        ) : (
          <Link key={page} href={hrefFor(page) as Route} prefetch={false} aria-label={labels.goTo(page)} className={`${ITEM} ${IDLE}`}>{page}</Link>
        )
      )}
      {current < last && (
        <Link href={hrefFor(current + 1) as Route} prefetch={false} rel="next" className={`${ITEM} ${IDLE}`}>{labels.next}</Link>
      )}
    </nav>
  );
}
