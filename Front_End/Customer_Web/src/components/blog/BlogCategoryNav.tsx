import React from "react";
import Link from "next/link";
import type { Route } from "next";

const CHIP = "inline-flex items-center rounded-full border px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";
const ON = "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900";
const OFF = "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800";

/** "All" and the categories that have a published post in this language, as links; the current one is marked. */
export default function BlogCategoryNav({ label, allLabel, allHref, active, items }: { label: string; allLabel: string; allHref: string; active: string | null; items: { slug: string; name: string; href: string }[] }) {
  return (
    <nav aria-label={label} data-testid="blog-categories" className="mt-8 flex flex-wrap gap-3">
      <Link href={allHref as Route} prefetch={false} aria-current={active === null ? "page" : undefined} className={`${CHIP} ${active === null ? ON : OFF}`}>{allLabel}</Link>
      {items.map((item) => (
        <Link key={item.slug} href={item.href as Route} prefetch={false} aria-current={active === item.slug ? "page" : undefined} className={`${CHIP} ${active === item.slug ? ON : OFF}`}>{item.name}</Link>
      ))}
    </nav>
  );
}
