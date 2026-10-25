/**
 * BHA-BLOG-001-CP04: the Blog body (`{"schemaVersion":1,"blocks":[…]}`, design §3) as typed blocks the page can render. The server already validated and
 * re-serialised the body; this still reads it defensively because a page must never crash or run something because of one bad block: a block it does not
 * know, or a malformed one, is left out; a link that is not an internal path or `https://` is shown as plain text; there is no raw HTML anywhere.
 */
export interface Inline {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Only an internal path (`/…`, not `//`) or `https://…`; `null` otherwise. */
  href: string | null;
}

export type BlogBlock =
  | { type: "heading"; level: 2 | 3 | 4; text: string; id: string }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; inlines: Inline[]; cite: string | null }
  | { type: "image"; mediaId: string; alt: string; caption: string | null }
  | { type: "gallery"; items: { mediaId: string; alt: string; caption: string | null }[] }
  | { type: "toc" }
  | { type: "propertyIntro"; propertyId: string };

const rec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeHref(value: unknown): string | null {
  // A backslash is read by a browser as a slash (`/\evil.example` is `//evil.example`), so no link may have one; the API refuses it too (BlogLink.IsSafe).
  if (typeof value !== "string" || value === "" || CONTROL.test(value) || value.includes("\\")) return null;
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;
  return value.startsWith("https://") && value.length > "https://".length ? value : null;
}

function inlines(x: unknown): Inline[] | null {
  if (!Array.isArray(x)) return null;
  const out: Inline[] = [];
  for (const item of x) {
    if (!rec(item) || typeof item.text !== "string") return null;
    out.push({ text: item.text, bold: item.bold === true, italic: item.italic === true, href: safeHref(item.href) });
  }
  return out;
}

const optionalText = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x : null);

/** Lower-case ASCII with hyphens (accents folded), the same text always giving the same id. */
export function headingSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The blocks of a body. Heading ids come from the heading's text in document order (`dest`, `dest-2`, …), so they are stable for the same text and never repeat. */
export function parseBody(body: unknown): BlogBlock[] {
  if (!rec(body) || body.schemaVersion !== 1 || !Array.isArray(body.blocks)) return [];
  const used = new Set<string>();
  const blocks: BlogBlock[] = [];
  for (const raw of body.blocks) {
    if (!rec(raw)) continue;
    switch (raw.type) {
      case "heading": {
        if (typeof raw.text !== "string" || raw.text.trim() === "" || (raw.level !== 2 && raw.level !== 3 && raw.level !== 4)) break;
        const base = headingSlug(raw.text) || "section";
        let id = base;
        for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
        used.add(id);
        blocks.push({ type: "heading", level: raw.level, text: raw.text, id });
        break;
      }
      case "paragraph": {
        const runs = inlines(raw.inlines);
        if (runs) blocks.push({ type: "paragraph", inlines: runs });
        break;
      }
      case "list": {
        if (typeof raw.ordered !== "boolean" || !Array.isArray(raw.items)) break;
        const items = raw.items.map(inlines);
        if (items.length > 0 && items.every((i): i is Inline[] => i !== null)) blocks.push({ type: "list", ordered: raw.ordered, items });
        break;
      }
      case "quote": {
        const runs = inlines(raw.inlines);
        if (runs) blocks.push({ type: "quote", inlines: runs, cite: optionalText(raw.cite) });
        break;
      }
      case "image":
        if (typeof raw.mediaId === "string" && GUID.test(raw.mediaId)) {
          blocks.push({ type: "image", mediaId: raw.mediaId.toLowerCase(), alt: typeof raw.alt === "string" ? raw.alt : "", caption: optionalText(raw.caption) });
        }
        break;
      case "gallery": {
        if (!Array.isArray(raw.items)) break;
        const items = raw.items
          .filter((i): i is Record<string, unknown> => rec(i) && typeof i.mediaId === "string" && GUID.test(i.mediaId))
          .map((i) => ({ mediaId: (i.mediaId as string).toLowerCase(), alt: typeof i.alt === "string" ? i.alt : "", caption: optionalText(i.caption) }));
        if (items.length > 0) blocks.push({ type: "gallery", items });
        break;
      }
      case "toc":
        blocks.push({ type: "toc" });
        break;
      case "propertyIntro":
        if (typeof raw.propertyId === "string" && GUID.test(raw.propertyId)) blocks.push({ type: "propertyIntro", propertyId: raw.propertyId.toLowerCase() });
        break;
      default:
        break; // an unknown block is not rendered
    }
  }
  return blocks;
}

export const headingsOf = (blocks: BlogBlock[]) => blocks.filter((b): b is Extract<BlogBlock, { type: "heading" }> => b.type === "heading");
