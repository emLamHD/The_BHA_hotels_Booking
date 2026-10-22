"use client";

/**
 * BHA-BLOG-001-CP03: the React views of the body editor's atom blocks (picture, gallery, contents, property intro, and the opaque block for what the
 * editor does not understand). Each edits its own attributes through `updateAttributes`; moving and removing a block is the toolbar's.
 */

import React from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { StaffImage } from "./useStaffImage";
import { mediaPreviewPath } from "@/lib/api/blog";
import { BODY_LIMITS, type GalleryItem } from "@/lib/blog/bodyModel";
import { useBodyEditorServices } from "./BodyEditorContext";
import { GalleryBlock, ImageBlock, PropertyIntroBlock, TocBlock, UnknownBlock } from "@/lib/blog/editorSchema";

const FRAME = "my-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-white/[0.03]";
const INPUT = "h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden disabled:opacity-60 dark:border-gray-700 dark:text-white/90";
const SMALL_BUTTON = "rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5";

function Frame({ label, selected, children }: { label: string; selected: boolean; children: React.ReactNode }) {
  return (
    <NodeViewWrapper className={`${FRAME} ${selected ? "ring-2 ring-brand-300" : ""}`} data-testid={`block-${label}`} contentEditable={false}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      {children}
    </NodeViewWrapper>
  );
}

function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const { editable, pickMedia } = useBodyEditorServices();
  const { mediaId, alt, caption } = node.attrs as { mediaId: string; alt: string; caption: string };
  const change = async () => {
    const picked = await pickMedia({ multiple: false, title: "Chọn ảnh cho bài viết" });
    if (picked?.[0]) updateAttributes({ mediaId: picked[0].id });
  };
  return (
    <Frame label="Ảnh" selected={selected}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <StaffImage path={mediaId ? mediaPreviewPath(mediaId, "card") : null} alt={alt || "Ảnh trong bài"} className="h-28 w-40 shrink-0 rounded-lg object-cover" testId="image-block-thumb" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input aria-label="Văn bản thay thế (alt) của ảnh" placeholder="Văn bản thay thế (alt) — bắt buộc khi xuất bản" value={alt} disabled={!editable} className={INPUT} onChange={(e) => updateAttributes({ alt: e.target.value })} />
          <input aria-label="Chú thích ảnh" placeholder="Chú thích (tuỳ chọn)" value={caption} disabled={!editable} className={INPUT} onChange={(e) => updateAttributes({ caption: e.target.value })} />
          <div>
            <button type="button" className={SMALL_BUTTON} disabled={!editable} onClick={change}>Đổi ảnh</button>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function GalleryView({ node, updateAttributes, selected }: NodeViewProps) {
  const { editable, pickMedia } = useBodyEditorServices();
  const items = (node.attrs.items as GalleryItem[]) ?? [];
  const set = (next: GalleryItem[]) => updateAttributes({ items: next });
  const add = async () => {
    const room = BODY_LIMITS.galleryMax - items.length;
    if (room <= 0) return;
    const picked = await pickMedia({ multiple: true, max: room, title: "Chọn ảnh cho thư viện" });
    if (picked?.length) set([...items, ...picked.slice(0, room).map((media) => ({ mediaId: media.id, alt: "", caption: "" }))]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    set(next);
  };
  return (
    <Frame label="Thư viện ảnh" selected={selected}>
      <p className={`mb-2 text-xs ${items.length < BODY_LIMITS.galleryMin ? "text-error-500" : "text-gray-500 dark:text-gray-400"}`}>
        {items.length} ảnh — cần từ {BODY_LIMITS.galleryMin} đến {BODY_LIMITS.galleryMax} ảnh.
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={`${item.mediaId}-${index}`} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-2 sm:flex-row dark:border-gray-700" data-testid="gallery-item">
            <StaffImage path={mediaPreviewPath(item.mediaId, "thumb")} alt={item.alt || `Ảnh ${index + 1}`} className="h-16 w-24 shrink-0 rounded-md object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <input aria-label={`Alt của ảnh ${index + 1}`} placeholder="Văn bản thay thế (alt)" value={item.alt} disabled={!editable} className={INPUT} onChange={(e) => set(items.map((x, i) => (i === index ? { ...x, alt: e.target.value } : x)))} />
              <input aria-label={`Chú thích của ảnh ${index + 1}`} placeholder="Chú thích (tuỳ chọn)" value={item.caption ?? ""} disabled={!editable} className={INPUT} onChange={(e) => set(items.map((x, i) => (i === index ? { ...x, caption: e.target.value } : x)))} />
            </div>
            <div className="flex shrink-0 gap-1 sm:flex-col">
              <button type="button" className={SMALL_BUTTON} disabled={!editable || index === 0} aria-label={`Đưa ảnh ${index + 1} lên`} onClick={() => move(index, index - 1)}>↑</button>
              <button type="button" className={SMALL_BUTTON} disabled={!editable || index === items.length - 1} aria-label={`Đưa ảnh ${index + 1} xuống`} onClick={() => move(index, index + 1)}>↓</button>
              <button type="button" className={SMALL_BUTTON} disabled={!editable} aria-label={`Bỏ ảnh ${index + 1}`} onClick={() => set(items.filter((_, i) => i !== index))}>Bỏ</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <button type="button" className={SMALL_BUTTON} disabled={!editable || items.length >= BODY_LIMITS.galleryMax} onClick={add}>Thêm ảnh</button>
      </div>
    </Frame>
  );
}

function TocView({ selected }: NodeViewProps) {
  return (
    <Frame label="Mục lục" selected={selected}>
      <p className="text-sm text-gray-600 dark:text-gray-300">Mục lục được website tự tạo từ các tiêu đề mục của bài.</p>
    </Frame>
  );
}

function PropertyIntroView({ node, updateAttributes, selected }: NodeViewProps) {
  const { editable, properties } = useBodyEditorServices();
  const propertyId = String(node.attrs.propertyId ?? "");
  return (
    <Frame label="Giới thiệu cơ sở lưu trú" selected={selected}>
      <select aria-label="Cơ sở lưu trú" value={propertyId} disabled={!editable} className={INPUT} onChange={(e) => updateAttributes({ propertyId: e.target.value })}>
        <option value="">— Chọn cơ sở —</option>
        {properties.map((property) => (
          <option key={property.id} value={property.id}>{property.name}</option>
        ))}
        {propertyId && !properties.some((property) => property.id === propertyId) && <option value={propertyId}>Cơ sở {propertyId.slice(0, 8)}… (không thấy trong danh sách đang hoạt động)</option>}
      </select>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Chỉ lưu mã cơ sở; giá và tình trạng phòng không nằm trong bài.</p>
    </Frame>
  );
}

function UnknownView({ node, selected }: NodeViewProps) {
  const raw = String(node.attrs.raw ?? "");
  let kind = "không rõ";
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (typeof parsed.type === "string") kind = parsed.type;
  } catch {
    // The raw text is shown below either way.
  }
  return (
    <Frame label="Khối chưa hỗ trợ" selected={selected}>
      <p className="text-sm text-warning-700 dark:text-warning-300" role="alert">
        Khối loại “{kind}” không thuộc định dạng mà trình soạn thảo này hiểu. Nó được giữ nguyên, không bị sửa hay xoá; máy chủ có thể từ chối lưu bài cho đến khi khối này được gỡ.
      </p>
      <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-gray-100 p-2 text-xs dark:bg-white/5">{raw}</pre>
    </Frame>
  );
}

/** The atom blocks with their views attached. */
export const viewedBlocks = [
  ImageBlock.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
  GalleryBlock.extend({ addNodeView: () => ReactNodeViewRenderer(GalleryView) }),
  TocBlock.extend({ addNodeView: () => ReactNodeViewRenderer(TocView) }),
  PropertyIntroBlock.extend({ addNodeView: () => ReactNodeViewRenderer(PropertyIntroView) }),
  UnknownBlock.extend({ addNodeView: () => ReactNodeViewRenderer(UnknownView) }),
];
