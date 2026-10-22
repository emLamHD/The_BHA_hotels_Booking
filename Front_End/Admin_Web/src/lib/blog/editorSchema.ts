/**
 * BHA-BLOG-001-CP03: the editor's schema — exactly the shapes the server accepts (design §3), and no others.
 *
 * Not `StarterKit`: its blockquote, list item and heading allow things the body format has no place for (nested lists, several paragraphs in an item,
 * marks inside a heading, hard breaks, code). Here a heading is plain text, a list item is one run of inlines, a quote is one run plus an optional cite,
 * and the only marks are bold, italic and a safe link. The atoms (image, gallery, contents, property intro, and an opaque block for anything unknown)
 * carry their data as attributes; the React views that edit them are attached in `nodeViews.tsx`, so this file has no DOM and tests can build the schema.
 */

import { Node, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Heading from "@tiptap/extension-heading";
import Blockquote from "@tiptap/extension-blockquote";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import { isSafeHref } from "./bodyModel";

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
export const GalleryBlock = atom("gallery", { items: [] });
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
