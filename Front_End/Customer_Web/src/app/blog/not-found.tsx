import React from "react";
import BlogLocaleTargets from "@/components/blog/BlogLocaleTargets";
import BlogNotFoundRevalidate from "@/components/blog/BlogNotFoundRevalidate";
import { indexTargets } from "@/lib/blog/context";
import { getI18n } from "@/lib/i18n/server";
import Page404 from "../not-found";

/**
 * BHA-BLOG-001-CP04-CP05-C6: the 404 of every Blog page (an unknown or unpublished post, an unknown category, a bad `?page=` or language). The site's own 404 page,
 * plus the language switch's fallback: each active language goes to its own Blog index. `notFound()` is thrown before the page could register anything, and on
 * `?locale=vi` the URL would otherwise override the language the reader just chose. Nothing about the post that was asked for is used (no slug, no guessed translation);
 * the status stays 404 and the page `noindex`. Pages outside the Blog keep the root `not-found.tsx`. `recover`: a target with the pathname the reader is on (a bad `?page`
 * or language on `/blog` itself) goes through `/blog-recover`, because Next 13.4.3 clears its not-found boundary only when the pathname changes (C7). A 404 can also be a
 * copy the router cache restored (C9): `BlogNotFoundRevalidate` asks the server once and leaves the boundary through the same step when the page exists now.
 */
export default async function BlogNotFound() {
  const { config } = await getI18n();
  const page = await Page404();                       // an async server component: called, not used as a JSX tag, so the types hold
  return (
    <>
      <BlogLocaleTargets targets={indexTargets(config.locales)} recover />
      <BlogNotFoundRevalidate />
      {page}
    </>
  );
}
