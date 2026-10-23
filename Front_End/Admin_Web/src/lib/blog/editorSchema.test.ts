/**
 * BHA-BLOG-001-CP03-C6 (F1): the gallery's items are a list of objects; ProseMirror's clipboard (copy, paste, drag) writes a block as HTML and reads it
 * back through the schema. These tests use that real path - `DOMSerializer` for what is copied, `DOMParser` and the editor's own `pasteHTML` for what is
 * pasted - not a helper of ours, so an attribute that does not survive HTML is caught where the person would meet it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor, getSchema } from "@tiptap/core";
import { DOMParser as PmDOMParser, DOMSerializer, Node as PmModelNode } from "@tiptap/pm/model";
import { bodyToDoc, docToBody, type PmNode } from "./bodyModel";
import { schemaExtensions } from "./editorSchema";

const schema = getSchema(schemaExtensions());
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";

const ITEMS = [
  { mediaId: M1, alt: "Biển \"Mỹ Khê\" & cát", caption: "Nháy 'đơn' và \\ gạch chéo — 🌊" },
  { mediaId: M2, alt: "b", caption: "" },
  { mediaId: M3, alt: "c", caption: "Chú thích c" },
];
const BODY = { schemaVersion: 1, blocks: [{ type: "gallery", items: [{ ...ITEMS[0] }, { mediaId: M2, alt: "b" }, { ...ITEMS[2] }] }] };

const galleryNode = (items: unknown) => PmModelNode.fromJSON(schema, { type: "gallery", attrs: { items } });

/** What the clipboard puts on the clipboard for a node: the schema's own serializer. */
function copy(node: PmModelNode): HTMLElement {
  const holder = document.createElement("div");
  holder.appendChild(DOMSerializer.fromSchema(schema).serializeNode(node));
  return holder;
}
/** What the clipboard makes of HTML: the schema's own parser. */
function paste(html: string): PmModelNode {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return PmDOMParser.fromSchema(schema).parse(holder);
}
const bodyOf = (doc: PmModelNode) => docToBody(doc.toJSON() as PmNode);

describe("a gallery through clipboard HTML", () => {
  it("is written as JSON, never as the string of an object", () => {
    const html = copy(galleryNode(ITEMS)).innerHTML;
    expect(html).not.toContain("[object Object]");
    const attributes = [...copy(galleryNode(ITEMS)).querySelectorAll("[data-bha-block=gallery]")[0].attributes].map((a) => a.value);
    expect(attributes.some((value) => value.startsWith("[") && JSON.stringify(JSON.parse(value)) === JSON.stringify(ITEMS))).toBe(true);
  });

  it("comes back with every media id, the order, each alt and each caption - including quotes, ampersands, backslashes and emoji", () => {
    const html = copy(galleryNode(ITEMS)).innerHTML;
    const pasted = paste(html);
    const gallery = pasted.firstChild!;
    expect(gallery.type.name).toBe("gallery");
    expect(gallery.attrs.items).toEqual(ITEMS);
    const body = bodyOf(pasted);
    expect(body.problems).toEqual([]);
    expect(body.body).toEqual(BODY);
  });

  it("does not let the text of an item turn into markup of the page", () => {
    const hostile = [{ mediaId: M1, alt: "\"><img src=x onerror=alert(1)>\n", caption: "</div><script>alert(1)</script>" }, { mediaId: M2, alt: "", caption: "" }];
    const html = copy(galleryNode(hostile)).innerHTML;
    const holder = document.createElement("div");
    holder.innerHTML = html;
    expect(holder.querySelector("script, img")).toBeNull();
    expect(paste(html).firstChild!.attrs.items).toEqual(hostile);
  });
});

describe("a gallery whose attribute is not what the editor wrote", () => {
  const htmlWith = (attribute: string | null) => `<div data-bha-block="gallery"${attribute === null ? "" : ` data-items="${attribute.replace(/"/g, "&quot;")}"`}></div>`;
  const cases: Array<[string, string | null]> = [
    ["missing", null],
    ["empty", ""],
    ["the string of an object", "[object Object],[object Object]"],
    ["truncated JSON", `[{"mediaId":"${M1}","alt":"a"`],
    ["JSON that is not a list", `{"mediaId":"${M1}","alt":"a"}`],
    ["a list of numbers", "[1,2]"],
    ["a list with null", `[null,{"mediaId":"${M1}","alt":"a","caption":""}]`],
    ["an item without a media id", `[{"alt":"a"},{"mediaId":"${M1}","alt":"a"}]`],
    ["a media id that is a number", `[{"mediaId":5,"alt":"a"},{"mediaId":"${M1}","alt":"a"}]`],
    ["an alt that is not text", `[{"mediaId":"${M1}","alt":7},{"mediaId":"${M2}","alt":"a"}]`],
    ["a caption that is not text", `[{"mediaId":"${M1}","alt":"a","caption":{}},{"mediaId":"${M2}","alt":"a"}]`],
    ["an item with a field the format does not have", `[{"mediaId":"${M1}","alt":"a","href":"https://x.test"},{"mediaId":"${M2}","alt":"a"}]`],
  ];

  it.each(cases)("%s: does not throw, and is an empty gallery the editor reports as having too few pictures", (_name, attribute) => {
    let pasted!: PmModelNode;
    expect(() => { pasted = paste(htmlWith(attribute)); }).not.toThrow();
    const gallery = pasted.firstChild!;
    expect(gallery.type.name).toBe("gallery");
    expect(Array.isArray(gallery.attrs.items)).toBe(true);
    expect(gallery.attrs.items).toEqual([]);
    const body = bodyOf(pasted);
    expect(body.problems.map((p) => p.message)).toEqual(expect.arrayContaining([expect.stringMatching(/Thư viện ảnh cần từ 2 đến 12 ảnh/)]));
  });

  it("a missing caption is an empty one, as a stored body is opened", () => {
    const items = paste(htmlWith(JSON.stringify([{ mediaId: M1, alt: "a" }, { mediaId: M2 }]))).firstChild!.attrs.items;
    expect(items).toEqual([{ mediaId: M1, alt: "a", caption: "" }, { mediaId: M2, alt: "", caption: "" }]);
  });

  it("docToBody does not throw on a gallery whose items are not objects (a document built some other way)", () => {
    const doc: PmNode = { type: "doc", content: [{ type: "gallery", attrs: { items: [null, 5, "x", { mediaId: M1, alt: "a" }] } }] };
    expect(() => docToBody(doc)).not.toThrow();
    expect(docToBody(doc).problems.length).toBeGreaterThan(0);
  });
});

describe("the real editor's paste", () => {
  let editor: Editor;
  beforeEach(() => {
    // ProseMirror measures the page when it scrolls a selection into view; jsdom has no layout.
    const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
    Range.prototype.getBoundingClientRect = () => rect;
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
    Element.prototype.scrollIntoView = () => {};
    // `pasteHTML` makes a ClipboardEvent, which jsdom does not have; the paste pipeline only needs an event object.
    (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {};
    // A paragraph after the gallery: the paste goes there, instead of replacing the gallery that would be selected.
    const opened = bodyToDoc({ ...BODY, blocks: [...BODY.blocks, { type: "paragraph", inlines: [{ text: "sau" }] }] });
    if (opened.kind !== "ok") throw new Error("locked");
    editor = new Editor({ element: document.createElement("div"), extensions: schemaExtensions(), content: opened.doc });
  });
  afterEach(() => editor.destroy());

  it("a copied gallery pasted at the end becomes a second gallery with the same items, and the body saves as two galleries", () => {
    const gallery = editor.state.doc.firstChild!;
    const html = copy(gallery).innerHTML;
    editor.commands.focus("end");
    expect(editor.view.pasteHTML(html)).toBe(true);
    const doc = editor.state.doc;
    const galleries: PmModelNode[] = [];
    doc.forEach((child) => { if (child.type.name === "gallery") galleries.push(child); });
    expect(galleries).toHaveLength(2);
    expect(galleries[1].attrs.items).toEqual(galleries[0].attrs.items);
    expect(galleries[1].attrs.items).toEqual(ITEMS);
    const saved = docToBody(doc.toJSON() as PmNode);
    expect(saved.problems).toEqual([]);
    expect(saved.body.blocks.filter((b) => b.type === "gallery")).toEqual([BODY.blocks[0], BODY.blocks[0]]);
  });
});
