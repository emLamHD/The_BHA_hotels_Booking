/**
 * BHA-BLOG-001-CP03: the Blog body (design §3, `schemaVersion` 1) and the editor's document, converted both ways.
 *
 * The server is the authority: it validates and re-serializes the body, and refuses what it does not know. This file only (a) turns the stored JSON
 * into the ProseMirror JSON the editor holds and back, (b) says before sending what the server would refuse (limits, plain text, safe links), and (c)
 * never drops data it does not understand — an unknown block travels as an opaque `unknownBlock` and goes back unchanged, and a body of another
 * `schemaVersion` is not opened for editing at all.
 */

export const BODY_LIMITS = {
  blocks: 400,
  bytes: 200_000,
  text: 5000,
  inlines: 100,
  listItems: 100,
  galleryMin: 2,
  galleryMax: 12,
  heading: 300,
  cite: 200,
  alt: 200,
  caption: 300,
  href: 2000,
} as const;

export interface Inline {
  text: string;
  bold?: true;
  italic?: true;
  href?: string;
}

export interface GalleryItem {
  mediaId: string;
  alt: string;
  caption?: string;
}

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; inlines: Inline[]; cite?: string }
  | { type: "image"; mediaId: string; alt: string; caption?: string }
  | { type: "gallery"; items: GalleryItem[] }
  | { type: "toc" }
  | { type: "propertyIntro"; propertyId: string };

export interface BodyV1 {
  schemaVersion: 1;
  blocks: Block[];
}

/** The editor's document, as ProseMirror JSON. */
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface BodyProblem {
  /** Where, in words an editor can use ("Khối 3", "Khối 5, mục 2"). */
  where: string;
  message: string;
}

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

// ---------------------------------------------------------------- the server's text and link rules (BlogText.IsPlain, BlogLink.IsSafe)

// Cc: U+0000–U+001F and U+007F–U+009F — tab and line break are control characters too.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export const isPlain = (value: string): boolean => !CONTROL.test(value) && !/[<>]/.test(value);

/** The server's `BlogLink.IsSafe`: an internal path (not `//`) or an `https://` address, nothing else. */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length === 0 || href.length > BODY_LIMITS.href || href !== href.trim()) return false;
  if (CONTROL.test(href) || /\s/.test(href) || /[\\"'<>]/.test(href)) return false;
  if (href[0] === "/") return href.length === 1 || href[1] !== "/";
  if (!href.startsWith("https://")) return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (x: unknown): x is string => typeof x === "string" && GUID.test(x);

// ---------------------------------------------------------------- stored JSON -> editor document

export type OpenedBody = { kind: "ok"; doc: PmNode } | { kind: "locked"; reason: string };

const EMPTY_DOC: PmNode = { type: "doc", content: [{ type: "paragraph" }] };

function parseInlines(x: unknown): Inline[] | null {
  if (!Array.isArray(x)) return null;
  const out: Inline[] = [];
  for (const part of x) {
    if (!isRec(part) || typeof part.text !== "string") return null;
    if (Object.keys(part).some((key) => key !== "text" && key !== "bold" && key !== "italic" && key !== "href")) return null;
    if ((part.bold !== undefined && typeof part.bold !== "boolean") || (part.italic !== undefined && typeof part.italic !== "boolean")) return null;
    if (part.href !== undefined && typeof part.href !== "string") return null;
    const inline: Inline = { text: part.text };
    if (part.bold === true) inline.bold = true;
    if (part.italic === true) inline.italic = true;
    if (typeof part.href === "string") inline.href = part.href;
    out.push(inline);
  }
  return out;
}

function inlineNodes(inlines: Inline[]): PmNode[] {
  return inlines.map((inline) => {
    const marks: NonNullable<PmNode["marks"]> = [];
    if (inline.bold) marks.push({ type: "bold" });
    if (inline.italic) marks.push({ type: "italic" });
    if (inline.href !== undefined) marks.push({ type: "link", attrs: { href: inline.href } });
    return marks.length ? { type: "text", text: inline.text, marks } : { type: "text", text: inline.text };
  });
}

const paragraphOf = (inlines: Inline[]): PmNode => (inlines.length ? { type: "paragraph", content: inlineNodes(inlines) } : { type: "paragraph" });

const unknownBlock = (block: unknown): PmNode => ({ type: "unknownBlock", attrs: { raw: JSON.stringify(block) } });

function blockNode(block: unknown): PmNode {
  if (!isRec(block) || typeof block.type !== "string") return unknownBlock(block);
  const keys = Object.keys(block);
  const only = (...allowed: string[]) => keys.every((key) => key === "type" || allowed.includes(key));
  switch (block.type) {
    case "heading":
      if (only("level", "text") && (block.level === 2 || block.level === 3 || block.level === 4) && typeof block.text === "string") {
        return block.text ? { type: "heading", attrs: { level: block.level }, content: [{ type: "text", text: block.text }] } : { type: "heading", attrs: { level: block.level } };
      }
      break;
    case "paragraph": {
      const inlines = only("inlines") ? parseInlines(block.inlines) : null;
      if (inlines) return paragraphOf(inlines);
      break;
    }
    case "list": {
      if (only("ordered", "items") && typeof block.ordered === "boolean" && Array.isArray(block.items)) {
        const items = block.items.map(parseInlines);
        if (items.every((item) => item !== null)) {
          return {
            type: block.ordered ? "orderedList" : "bulletList",
            content: (items as Inline[][]).map((item) => ({ type: "listItem", content: [paragraphOf(item)] })),
          };
        }
      }
      break;
    }
    case "quote": {
      const inlines = only("inlines", "cite") ? parseInlines(block.inlines) : null;
      if (inlines && (block.cite === undefined || typeof block.cite === "string")) {
        const content = [paragraphOf(inlines)];
        if (typeof block.cite === "string" && block.cite) content.push({ type: "quoteCite", content: [{ type: "text", text: block.cite }] });
        return { type: "blockquote", content };
      }
      break;
    }
    case "image":
      if (only("mediaId", "alt", "caption") && typeof block.mediaId === "string" && (block.alt === undefined || typeof block.alt === "string") && (block.caption === undefined || typeof block.caption === "string")) {
        return { type: "image", attrs: { mediaId: block.mediaId, alt: block.alt ?? "", caption: block.caption ?? "" } };
      }
      break;
    case "gallery":
      if (only("items") && Array.isArray(block.items)) {
        const items: GalleryItem[] = [];
        for (const item of block.items) {
          if (!isRec(item) || typeof item.mediaId !== "string" || Object.keys(item).some((key) => !["mediaId", "alt", "caption"].includes(key))) return unknownBlock(block);
          if ((item.alt !== undefined && typeof item.alt !== "string") || (item.caption !== undefined && typeof item.caption !== "string")) return unknownBlock(block);
          items.push({ mediaId: item.mediaId, alt: (item.alt as string | undefined) ?? "", caption: (item.caption as string | undefined) ?? "" });
        }
        return { type: "gallery", attrs: { items } };
      }
      break;
    case "toc":
      if (only()) return { type: "toc" };
      break;
    case "propertyIntro":
      if (only("propertyId") && typeof block.propertyId === "string") return { type: "propertyIntro", attrs: { propertyId: block.propertyId } };
      break;
  }
  return unknownBlock(block);
}

/** Opens a stored body for editing. A body that is not `schemaVersion` 1 is `locked`: shown, never rewritten by the editor. */
export function bodyToDoc(raw: unknown): OpenedBody {
  if (raw === null || raw === undefined) return { kind: "ok", doc: EMPTY_DOC };
  if (!isRec(raw)) return { kind: "locked", reason: "Nội dung bài viết không có dạng cấu trúc mà trình soạn thảo hiểu." };
  if (raw.schemaVersion !== 1) {
    return { kind: "locked", reason: `Nội dung bài viết dùng phiên bản cấu trúc ${JSON.stringify(raw.schemaVersion) ?? "không rõ"}; trình soạn thảo này chỉ mở phiên bản 1.` };
  }
  if (!Array.isArray(raw.blocks)) return { kind: "locked", reason: "Nội dung bài viết không có danh sách khối." };
  const content = raw.blocks.map(blockNode);
  return { kind: "ok", doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] } };
}

// ---------------------------------------------------------------- editor document -> body JSON

function sameMarks(a: Inline, b: Inline): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && a.href === b.href;
}

function inlinesOf(nodes: PmNode[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes ?? []) {
    if (node.type !== "text" || !node.text) continue;
    const inline: Inline = { text: node.text };
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") inline.bold = true;
      else if (mark.type === "italic") inline.italic = true;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string") inline.href = mark.attrs.href;
    }
    const last = out[out.length - 1];
    if (last && sameMarks(last, inline)) last.text += inline.text;
    else out.push(inline);
  }
  return out;
}

const textOf = (nodes: PmNode[] | undefined) => (nodes ?? []).map((node) => node.text ?? "").join("");
const blank = (inlines: Inline[]) => inlines.every((inline) => inline.text.trim() === "");

function checkText(value: string, max: number, where: string, what: string, problems: BodyProblem[]) {
  if (value.length > max) problems.push({ where, message: `${what} dài quá ${max} ký tự.` });
  if (!isPlain(value)) problems.push({ where, message: `${what} chỉ là văn bản thuần: không có < >, tab hay xuống dòng.` });
}

function checkInlines(inlines: Inline[], where: string, problems: BodyProblem[]) {
  if (inlines.length > BODY_LIMITS.inlines) problems.push({ where, message: `Một đoạn có tối đa ${BODY_LIMITS.inlines} phần định dạng khác nhau.` });
  for (const inline of inlines) {
    checkText(inline.text, BODY_LIMITS.text, where, "Văn bản", problems);
    if (inline.href !== undefined && !isSafeHref(inline.href)) problems.push({ where, message: `Liên kết “${inline.href}” không hợp lệ: chỉ nhận đường dẫn nội bộ (/…) hoặc địa chỉ https://.` });
  }
}

export interface SerializedBody {
  body: BodyV1;
  problems: BodyProblem[];
}

/**
 * The body JSON of an editor document. Blocks with nothing in them (an empty paragraph, heading, list item or quote) are left out — there is no data
 * in them. Everything the server would refuse is reported in `problems`; the text is never rewritten to hide it.
 */
export function docToBody(doc: PmNode): SerializedBody {
  const blocks: Block[] = [];
  const problems: BodyProblem[] = [];
  let index = 0;
  for (const node of doc.content ?? []) {
    const where = `Khối ${++index}`;
    switch (node.type) {
      case "paragraph": {
        const inlines = inlinesOf(node.content);
        if (blank(inlines)) break;
        checkInlines(inlines, where, problems);
        blocks.push({ type: "paragraph", inlines });
        break;
      }
      case "heading": {
        const text = textOf(node.content);
        const level = node.attrs?.level;
        if (text.trim() === "") break;
        checkText(text, BODY_LIMITS.heading, where, "Tiêu đề mục", problems);
        blocks.push({ type: "heading", level: level === 3 || level === 4 ? level : 2, text });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const items: Inline[][] = [];
        for (const item of node.content ?? []) {
          const inlines = inlinesOf(item.content?.[0]?.content);
          if (blank(inlines)) continue;
          checkInlines(inlines, `${where}, mục ${items.length + 1}`, problems);
          items.push(inlines);
        }
        if (items.length === 0) break;
        if (items.length > BODY_LIMITS.listItems) problems.push({ where, message: `Một danh sách có tối đa ${BODY_LIMITS.listItems} mục.` });
        blocks.push({ type: "list", ordered: node.type === "orderedList", items });
        break;
      }
      case "blockquote": {
        const inlines = inlinesOf(node.content?.[0]?.content);
        const cite = textOf(node.content?.find((child) => child.type === "quoteCite")?.content);
        if (blank(inlines)) {
          if (cite.trim() !== "") problems.push({ where, message: "Trích dẫn có nguồn nhưng chưa có nội dung." });
          break;
        }
        checkInlines(inlines, where, problems);
        const block: Block = { type: "quote", inlines };
        if (cite.trim() !== "") {
          checkText(cite, BODY_LIMITS.cite, where, "Nguồn trích dẫn", problems);
          block.cite = cite;
        }
        blocks.push(block);
        break;
      }
      case "image": {
        const mediaId = String(node.attrs?.mediaId ?? "");
        const alt = String(node.attrs?.alt ?? "");
        const caption = String(node.attrs?.caption ?? "");
        if (!isGuid(mediaId)) problems.push({ where, message: "Ảnh chưa được chọn." });
        checkText(alt, BODY_LIMITS.alt, where, "Văn bản thay thế (alt)", problems);
        checkText(caption, BODY_LIMITS.caption, where, "Chú thích", problems);
        blocks.push(caption.trim() ? { type: "image", mediaId, alt, caption } : { type: "image", mediaId, alt });
        break;
      }
      case "gallery": {
        const raw = Array.isArray(node.attrs?.items) ? (node.attrs!.items as GalleryItem[]) : [];
        const items = raw.map((item): GalleryItem => (item.caption?.trim() ? { mediaId: item.mediaId, alt: item.alt ?? "", caption: item.caption } : { mediaId: item.mediaId, alt: item.alt ?? "" }));
        if (items.length < BODY_LIMITS.galleryMin || items.length > BODY_LIMITS.galleryMax) {
          problems.push({ where, message: `Thư viện ảnh cần từ ${BODY_LIMITS.galleryMin} đến ${BODY_LIMITS.galleryMax} ảnh.` });
        }
        items.forEach((item, i) => {
          checkText(item.alt, BODY_LIMITS.alt, `${where}, ảnh ${i + 1}`, "Văn bản thay thế (alt)", problems);
          checkText(item.caption ?? "", BODY_LIMITS.caption, `${where}, ảnh ${i + 1}`, "Chú thích", problems);
        });
        blocks.push({ type: "gallery", items });
        break;
      }
      case "toc":
        blocks.push({ type: "toc" });
        break;
      case "propertyIntro": {
        const propertyId = String(node.attrs?.propertyId ?? "");
        if (!isGuid(propertyId)) problems.push({ where, message: "Chưa chọn cơ sở lưu trú." });
        blocks.push({ type: "propertyIntro", propertyId });
        break;
      }
      case "unknownBlock": {
        // Kept exactly as it came (the editor shows a warning card for it); the server decides whether it can be stored.
        try {
          blocks.push(JSON.parse(String(node.attrs?.raw)) as Block);
        } catch {
          problems.push({ where, message: "Khối không nhận ra bị hỏng và không thể giữ lại." });
        }
        break;
      }
      default:
        problems.push({ where, message: `Khối loại “${node.type}” không được hỗ trợ.` });
    }
  }

  if (blocks.length > BODY_LIMITS.blocks) problems.push({ where: "Bài viết", message: `Một bài có tối đa ${BODY_LIMITS.blocks} khối.` });
  const body: BodyV1 = { schemaVersion: 1, blocks };
  const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
  if (bytes > BODY_LIMITS.bytes) problems.push({ where: "Bài viết", message: `Nội dung vượt ${BODY_LIMITS.bytes.toLocaleString("vi-VN")} byte (hiện ${bytes.toLocaleString("vi-VN")}).` });
  return { body, problems };
}

/**
 * The body in the form two bodies are COMPARED in: what the server would keep. It trims heading text, cite, alt and caption (and drops an empty caption /
 * cite), exactly as the server does; a run of an inline list keeps its spaces. It is only for comparing (dirty, "did the server get mine?") — what is
 * sent is the body as typed.
 */
export function comparableBody(body: BodyV1): string {
  const trimmed = body.blocks.map((block): Block => {
    switch (block.type) {
      case "heading":
        return { ...block, text: block.text.trim() };
      case "quote": {
        const { cite, ...rest } = block;
        return cite !== undefined && cite.trim() !== "" ? { ...rest, cite: cite.trim() } : rest;
      }
      case "image": {
        const { caption, ...rest } = block;
        return caption !== undefined && caption.trim() !== "" ? { ...rest, alt: rest.alt.trim(), caption: caption.trim() } : { ...rest, alt: rest.alt.trim() };
      }
      case "gallery":
        return { type: "gallery", items: block.items.map(({ caption, ...item }) => (caption !== undefined && caption.trim() !== "" ? { ...item, alt: item.alt.trim(), caption: caption.trim() } : { ...item, alt: item.alt.trim() })) };
      default:
        return block;
    }
  });
  return JSON.stringify({ schemaVersion: body.schemaVersion, blocks: trimmed });
}

/** The comparable form of a stored body (a locked body is compared as it is). */
export function canonicalBody(raw: unknown): string {
  const opened = bodyToDoc(raw);
  return opened.kind === "locked" ? JSON.stringify(raw) : comparableBody(docToBody(opened.doc).body);
}

/** Every media id a body names (for the picker and the thumbnails). */
export function mediaIdsOf(body: BodyV1): string[] {
  const ids = new Set<string>();
  for (const block of body.blocks) {
    if (block.type === "image") ids.add(block.mediaId);
    else if (block.type === "gallery") block.items.forEach((item) => ids.add(item.mediaId));
  }
  return [...ids];
}
