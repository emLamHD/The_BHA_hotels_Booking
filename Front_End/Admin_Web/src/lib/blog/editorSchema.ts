/**
 * BHA-BLOG-001-CP03: the editor's schema — exactly the shapes the server accepts (design §3), and no others.
 *
 * Not `StarterKit`: its blockquote, list item and heading allow things the body format has no place for (nested lists, several paragraphs in an item,
 * marks inside a heading, hard breaks, code). Here a heading is plain text, a list item is one run of inlines, a quote is one run plus an optional cite,
 * and the only marks are bold, italic and a safe link. The atoms (image, gallery, contents, property intro, and an opaque block for anything unknown)
 * carry their data as attributes; the React views that edit them are attached in `nodeViews.tsx`, so this file has no DOM and tests can build the schema.
 */

import { Node, type Extensions } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Heading from "@tiptap/extension-heading";
import Blockquote from "@tiptap/extension-blockquote";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import { galleryItemsFromText, isSafeHref } from "./bodyModel";

/** The source line under a quote (`cite`): plain text, no marks. */
export const QuoteCite = Node.create({
  name: "quoteCite",
  content: "text*",
  marks: "",
  defining: true,
  parseHTML: () => [{ tag: "cite" }],
  renderHTML: () => ["cite", 0],
});

const atom = (name: string, attrs: Record<string, unknown>) =>
  Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes: () => Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, { default: value }])),
    parseHTML: () => [{ tag: `div[data-bha-block="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => ["div", { ...HTMLAttributes, "data-bha-block": name }],
  });

export const ImageBlock = atom("image", { mediaId: "", alt: "", caption: "" });
/**
 * The gallery's items are a list of objects: the default attribute rendering would write `[object Object],[object Object]` into the copied HTML and read
 * a string back. They travel as JSON in one attribute (set through the DOM, so the browser escapes it) and are validated when read.
 */
export const GalleryBlock = atom("gallery", { items: [] }).extend({
  addAttributes: () => ({
    items: {
      default: [],
      parseHTML: (element: HTMLElement) => galleryItemsFromText(element.getAttribute("data-items")),
      renderHTML: (attributes: Record<string, unknown>) => ({ "data-items": JSON.stringify(attributes.items ?? []) }),
    },
  }),
});
export const TocBlock = atom("toc", {});
export const PropertyIntroBlock = atom("propertyIntro", { propertyId: "" });
/** Anything the editor does not understand: the raw JSON of the block, held as it came and sent back unchanged. */
export const UnknownBlock = atom("unknownBlock", { raw: "{}" });

/** The extensions without any React view: what a test (or the server-side shape) needs. */
export function schemaExtensions(): Extensions {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      defaultProtocol: "https",
      protocols: [],
      // The server's rule (`BlogLink.IsSafe`): an internal path or an https address — checked on typing, on paste and on parse.
      isAllowedUri: (url) => isSafeHref(url),
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
    Heading.extend({ marks: "" }).configure({ levels: [2, 3, 4] }),
    Blockquote.extend({ content: "paragraph quoteCite?" }),
    QuoteCite,
    BulletList,
    OrderedList,
    ListItem.extend({ content: "paragraph" }),
    ImageBlock,
    GalleryBlock,
    TocBlock,
    PropertyIntroBlock,
    UnknownBlock,
  ];
}

/**
 * Takes the quote formatting off every quote the selection touches, in ONE transaction (one undo step) - or `null` when it touches none.
 *
 * The inherited `toggleBlockquote()` cannot do this: it lifts the quote's paragraph out, which would leave a `quoteCite` alone at document level (a cite is only
 * valid inside a quote), so it refuses as soon as a quote has a cite, even an empty one. A quote here is one paragraph and an optional cite; unwrapping it keeps
 * the paragraph node as it is (marks and links included) and turns a cite with text into an ordinary paragraph after it, in the same place. An empty cite has
 * nothing to keep and is dropped. Quotes are only ever top-level blocks (their content is a paragraph and a cite), so the selection's top-level range is enough.
 */
export function unwrapQuotes(state: EditorState): Transaction | null {
  const { doc, selection, schema } = state;
  const quotes: { pos: number; node: typeof doc }[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "blockquote" && pos < selection.to && pos + node.nodeSize > selection.from) quotes.push({ pos, node });
  });
  if (quotes.length === 0) return null;

  const tr = state.tr;
  const paragraph = schema.nodes.paragraph;
  // Where a position of the old document ends up: each unwrapped quote loses its two boundary tokens, and an empty cite loses its own (it was the only content removed).
  const emptyCite = (node: typeof doc) => (node.lastChild?.type.name === "quoteCite" && node.lastChild.content.size === 0 ? node.lastChild : null);
  const mapPos = (position: number) => {
    let mapped = position;
    for (const { pos, node } of quotes) {
      const end = pos + node.nodeSize;
      if (position > pos) mapped -= 1;
      if (position >= end) mapped -= 1;
      const cite = emptyCite(node);
      if (cite) {
        const citeStart = end - 1 - cite.nodeSize;
        if (position >= end) mapped -= cite.nodeSize;
        else if (position >= citeStart) mapped -= position - citeStart + 1; // in the empty cite: the end of the paragraph before it
      }
    }
    return mapped;
  };

  for (const { pos, node } of [...quotes].reverse()) {
    const kept = [node.firstChild!];
    const cite = node.child(node.childCount - 1);
    if (cite.type.name === "quoteCite" && cite.content.size > 0) kept.push(paragraph.create(null, cite.content));
    tr.replaceWith(pos, pos + node.nodeSize, kept);
  }

  if (selection instanceof NodeSelection) tr.setSelection(Selection.near(tr.doc.resolve(mapPos(selection.from)), 1));
  else tr.setSelection(TextSelection.create(tr.doc, mapPos(selection.anchor), mapPos(selection.head)));
  return tr;
}
