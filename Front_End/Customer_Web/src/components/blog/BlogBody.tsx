import React from "react";
import Link from "next/link";
import type { Route } from "next";
import BlogPicture from "./BlogPicture";
import type { BlogMediaRef } from "@/lib/blog/blog";
import { headingsOf, type BlogBlock, type Inline } from "@/lib/blog/body";
import { RIVERSIDE_PATH } from "@/lib/riversideHomeContent";

export interface BlogBodyLabels {
  tocTitle: string;
  galleryLabel: string;
  propertyCta: (name: string) => string;
}

/** The Property pages the Customer site really has. Any other Property is named, not linked: there is no page to send a reader to, and nothing about price or availability is said. */
const PROPERTY_PAGES: Record<string, string> = { "the-bha-riverside": RIVERSIDE_PATH };

const LINK = "font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300";

function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, i) => {
        let node: React.ReactNode = run.text;
        if (run.bold) node = <strong>{node}</strong>;
        if (run.italic) node = <em>{node}</em>;
        if (run.href?.startsWith("/")) node = <Link href={run.href as Route} prefetch={false} className={LINK}>{node}</Link>;
        else if (run.href) node = <a href={run.href} target="_blank" rel="noopener noreferrer" className={LINK}>{node}</a>;
        return <React.Fragment key={i}>{node}</React.Fragment>;
      })}
    </>
  );
}

function Picture({ media, alt, sizes, eager }: { media: BlogMediaRef; alt: string; sizes: string; eager?: boolean }) {
  return <BlogPicture src={media.url} alt={alt} width={media.width} height={media.height} variants={media.variants} sizes={sizes} eager={eager} className="h-auto w-full object-cover" />;
}

/**
 * BHA-BLOG-001-CP04: the Blog body (schemaVersion 1) as React. Everything is a React text node or an element chosen here — there is no raw HTML, and a block
 * or a link the contract does not allow was already left out or turned to text by `parseBody`. The page's one H1 is the title; the body's headings are H2–H4.
 */
export default function BlogBody({ blocks, media, properties, labels }: { blocks: BlogBlock[]; media: Record<string, BlogMediaRef>; properties: Record<string, { slug: string; name: string }>; labels: BlogBodyLabels }) {
  const headings = headingsOf(blocks);
  return (
    <div data-testid="blog-body" className="space-y-6 text-neutral-700 dark:text-neutral-300">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Tag = `h${block.level}` as "h2" | "h3" | "h4";
            const size = block.level === 2 ? "text-xl md:text-2xl" : block.level === 3 ? "text-lg md:text-xl" : "text-base md:text-lg";
            return <Tag key={index} id={block.id} className={`scroll-mt-24 pt-4 font-semibold text-neutral-900 dark:text-neutral-100 ${size}`}>{block.text}</Tag>;
          }
          case "paragraph":
            return <p key={index}><Runs runs={block.inlines} /></p>;
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index} className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-2 pl-6`}>
                {block.items.map((item, i) => <li key={i}><Runs runs={item} /></li>)}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={index} className="border-l-4 border-neutral-300 pl-4 italic dark:border-neutral-600">
                <p><Runs runs={block.inlines} /></p>
                {block.cite && <footer className="mt-2 text-sm not-italic text-neutral-500 dark:text-neutral-400">— {block.cite}</footer>}
              </blockquote>
            );
          case "image": {
            const ref = media[block.mediaId];
            if (!ref) return null; // a picture the API did not send is not shown
            return (
              <figure key={index} className="space-y-2">
                <div className="overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-800"><Picture media={ref} alt={block.alt} sizes="(min-width: 768px) 768px, 100vw" /></div>
                {block.caption && <figcaption className="text-sm text-neutral-500 dark:text-neutral-400">{block.caption}</figcaption>}
              </figure>
            );
          }
          case "gallery": {
            const shown = block.items.filter((item) => media[item.mediaId]);
            if (shown.length === 0) return null;
            return (
              <ul key={index} aria-label={labels.galleryLabel} data-testid="blog-gallery" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {shown.map((item, i) => (
                  <li key={i}>
                    <figure className="space-y-2">
                      <div className="overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-800"><Picture media={media[item.mediaId]} alt={item.alt} sizes="(min-width: 768px) 372px, 100vw" /></div>
                      {item.caption && <figcaption className="text-sm text-neutral-500 dark:text-neutral-400">{item.caption}</figcaption>}
                    </figure>
                  </li>
                ))}
              </ul>
            );
          }
          case "toc":
            if (headings.length === 0) return null;
            return (
              <nav key={index} aria-label={labels.tocTitle} data-testid="blog-toc" className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-700">
                <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-900 dark:text-neutral-100">{labels.tocTitle}</p>
                <ol className="space-y-2 text-sm">
                  {headings.map((h) => (
                    <li key={h.id} style={{ paddingLeft: `${(h.level - 2) * 1}rem` }}>
                      <a href={`#${h.id}`} className="hover:underline">{h.text}</a>
                    </li>
                  ))}
                </ol>
              </nav>
            );
          case "propertyIntro": {
            const property = properties[block.propertyId];
            if (!property) return null; // no longer public: the API dropped it, and so does this
            const page = PROPERTY_PAGES[property.slug];
            return (
              <aside key={index} data-testid="blog-property" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-700">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">{property.name}</p>
                {page && <Link href={page as Route} prefetch={false} className="inline-flex items-center rounded-full bg-primary-6000 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{labels.propertyCta(property.name)}</Link>}
              </aside>
            );
          }
        }
      })}
    </div>
  );
}
