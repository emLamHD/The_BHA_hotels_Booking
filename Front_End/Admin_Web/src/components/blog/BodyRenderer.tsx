"use client";

/**
 * BHA-BLOG-001-CP03: a body (`schemaVersion` 1) drawn for the Staff preview. Every piece is a React element built from the data — there is no HTML string and no
 * `dangerouslySetInnerHTML` anywhere — so a text can never become markup. A link is drawn only if it passes the same rule the server enforces, and it does not
 * navigate (a preview must not leave the Admin); pictures are read through the Staff session from the addresses the preview gives.
 */

import React from "react";
import { isSafeHref, type Block, type Inline } from "@/lib/blog/bodyModel";
import type { BlogPreviewMedia } from "@/lib/api/blog";
import { StaffImage } from "./useStaffImage";

export interface RenderContext {
  media: Record<string, BlogPreviewMedia>;
  properties: Record<string, { slug: string; name: string }>;
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        let node: React.ReactNode = inline.text;
        if (inline.bold) node = <strong>{node}</strong>;
        if (inline.italic) node = <em>{node}</em>;
        if (inline.href !== undefined) {
          node = isSafeHref(inline.href)
            ? <span className="cursor-help text-brand-600 underline underline-offset-2 dark:text-brand-400" title={`Liên kết tới ${inline.href} (không mở trong bản xem trước)`} data-testid="preview-link" data-href={inline.href}>{node}</span>
            : <span className="text-error-500">{node}</span>;
        }
        return <React.Fragment key={index}>{node}</React.Fragment>;
      })}
    </>
  );
}

const slugOf = (text: string, index: number) => `muc-${index + 1}-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;

export default function BodyRenderer({ body, context }: { body: unknown; context: RenderContext }) {
  const blocks: Block[] | null = typeof body === "object" && body !== null && Array.isArray((body as { blocks?: unknown }).blocks) ? ((body as { blocks: Block[] }).blocks) : null;
  if (!blocks) return <p className="text-sm text-warning-700">Không đọc được nội dung bài.</p>;
  const headings = blocks.flatMap((b, i) => (b.type === "heading" ? [{ id: slugOf(b.text, i), text: b.text, level: b.level }] : []));
  return (
    <div className="flex flex-col gap-4 text-base leading-7 text-gray-800 dark:text-gray-200" data-testid="preview-body">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Tag = (`h${block.level}`) as "h2" | "h3" | "h4";
            const size = block.level === 2 ? "text-2xl" : block.level === 3 ? "text-xl" : "text-lg";
            return <Tag key={index} id={slugOf(block.text, index)} className={`${size} font-semibold text-gray-900 dark:text-white`}>{block.text}</Tag>;
          }
          case "paragraph":
            return <p key={index}><Inlines inlines={block.inlines} /></p>;
          case "list": {
            const items = block.items.map((item, i) => <li key={i}><Inlines inlines={item} /></li>);
            return block.ordered ? <ol key={index} className="list-decimal pl-6">{items}</ol> : <ul key={index} className="list-disc pl-6">{items}</ul>;
          }
          case "quote":
            return (
              <blockquote key={index} className="border-l-4 border-brand-300 pl-4 italic">
                <p><Inlines inlines={block.inlines} /></p>
                {block.cite && <cite className="mt-1 block text-sm not-italic text-gray-500">— {block.cite}</cite>}
              </blockquote>
            );
          case "image": {
            const ref = context.media[block.mediaId];
            return (
              <figure key={index} data-testid="preview-image">
                <StaffImage path={ref?.url ?? null} alt={block.alt} className="max-h-[28rem] w-full rounded-xl object-cover" />
                {block.caption && <figcaption className="mt-1 text-sm text-gray-500">{block.caption}</figcaption>}
              </figure>
            );
          }
          case "gallery":
            return (
              <div key={index} className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="preview-gallery">
                {block.items.map((item, i) => (
                  <figure key={i}>
                    <StaffImage path={context.media[item.mediaId]?.url ?? null} alt={item.alt} className="aspect-[4/3] w-full rounded-lg object-cover" />
                    {item.caption && <figcaption className="mt-1 text-xs text-gray-500">{item.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            );
          case "toc":
            return (
              <nav key={index} aria-label="Mục lục" className="rounded-xl border border-gray-200 p-4 dark:border-gray-700" data-testid="preview-toc">
                <p className="mb-1 text-sm font-semibold">Mục lục</p>
                {headings.length === 0 ? <p className="text-sm text-gray-500">Chưa có tiêu đề mục nào.</p> : <ul className="text-sm">{headings.map((h) => <li key={h.id} style={{ paddingLeft: `${(h.level - 2) * 12}px` }}>{h.text}</li>)}</ul>}
              </nav>
            );
          case "propertyIntro": {
            const property = context.properties[block.propertyId];
            return property
              ? <div key={index} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700" data-testid="preview-property"><p className="text-sm text-gray-500">Giới thiệu cơ sở</p><p className="font-semibold">{property.name}</p></div>
              : <p key={index} className="text-sm text-warning-700">Cơ sở trong bài hiện không hoạt động nên bài đăng sẽ ẩn khối này.</p>;
          }
          default:
            return <p key={index} className="text-sm text-warning-700" role="alert">Khối “{(block as { type?: string }).type ?? "không rõ"}” không hiển thị được trong bản xem trước.</p>;
        }
      })}
    </div>
  );
}
