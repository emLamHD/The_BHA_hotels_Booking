import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PmModelNode } from "@tiptap/pm/model";
import { BODY_LIMITS, bodyToDoc, canonicalBody, docToBody, isPlain, isSafeHref, mediaIdsOf, type PmNode } from "./bodyModel";
import { schemaExtensions } from "./editorSchema";

const schema = getSchema(schemaExtensions());
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const P1 = "44444444-4444-4444-8444-444444444444";

/** Through the real schema: `fromJSON` + `check` throw when the document breaks a content rule, so this is also the proof the editor can hold it. */
function viaSchema(doc: PmNode): PmNode {
  const node = PmModelNode.fromJSON(schema, doc);
  node.check();
  return node.toJSON() as PmNode;
}

function roundTrip(raw: unknown) {
  const opened = bodyToDoc(raw);
  if (opened.kind !== "ok") throw new Error("locked");
  return docToBody(viaSchema(opened.doc));
}

const FULL = {
  schemaVersion: 1,
  blocks: [
    { type: "heading", level: 2, text: "Giới thiệu" },
    { type: "paragraph", inlines: [{ text: "Đây là " }, { text: "đậm", bold: true }, { text: " và " }, { text: "nghiêng", italic: true }, { text: " và " }, { text: "cả hai", bold: true, italic: true }, { text: " và " }, { text: "liên kết", href: "/blog" }, { text: " và ", }, { text: "ngoài", href: "https://example.com/a?b=1" }] },
    { type: "heading", level: 3, text: "Mục con" },
    { type: "heading", level: 4, text: "Mục nhỏ" },
    { type: "list", ordered: false, items: [[{ text: "Một" }], [{ text: "Hai ", bold: true }, { text: "chữ" }]] },
    { type: "list", ordered: true, items: [[{ text: "Bước 1" }], [{ text: "Bước 2" }]] },
    { type: "quote", inlines: [{ text: "Trích dẫn", italic: true }], cite: "Nguồn" },
    { type: "quote", inlines: [{ text: "Không nguồn" }] },
    { type: "image", mediaId: M1, alt: "Bãi biển", caption: "Mỹ Khê" },
    { type: "image", mediaId: M2, alt: "" },
    { type: "gallery", items: [{ mediaId: M1, alt: "a", caption: "x" }, { mediaId: M2, alt: "b" }, { mediaId: M3, alt: "" }] },
    { type: "toc" },
    { type: "propertyIntro", propertyId: P1 },
  ],
};

describe("the body, JSON -> editor -> JSON", () => {
  it("keeps every block type and every format, with the spaces between formatted runs", () => {
    const result = roundTrip(FULL);
    expect(result.problems).toEqual([]);
    expect(result.body).toEqual(FULL);
  });

  it("keeps the order of blocks and lists the pictures it uses", () => {
    expect(mediaIdsOf(roundTrip(FULL).body).sort()).toEqual([M1, M2, M3]);
  });

  it("merges neighbouring runs that have the same format, and nothing else", () => {
    const result = roundTrip({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "a" }, { text: "b" }, { text: "c", bold: true }] }] });
    expect(result.body.blocks).toEqual([{ type: "paragraph", inlines: [{ text: "ab" }, { text: "c", bold: true }] }]);
  });

  it("leaves out blocks with nothing in them, without touching the others", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "heading", attrs: { level: 2 } },
        { type: "paragraph", content: [{ type: "text", text: "  " }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Còn lại" }] },
      ],
    };
    const result = docToBody(viaSchema(doc));
    expect(result.problems).toEqual([]);
    expect(result.body.blocks).toEqual([{ type: "paragraph", inlines: [{ text: "Còn lại" }] }]);
  });

  it("opens an empty or missing body as one empty paragraph and saves it as no blocks", () => {
    for (const raw of [null, undefined, { schemaVersion: 1, blocks: [] }]) {
      const opened = bodyToDoc(raw);
      expect(opened.kind).toBe("ok");
      if (opened.kind === "ok") expect(docToBody(viaSchema(opened.doc)).body.blocks).toEqual([]);
    }
  });

  it("is stable: a second pass changes nothing", () => {
    const once = roundTrip(FULL).body;
    expect(roundTrip(once).body).toEqual(once);
    expect(canonicalBody(FULL)).toBe(canonicalBody(once));
  });
});

describe("what the editor does not understand", () => {
  it("keeps an unknown block exactly as it came, among known ones", () => {
    const strange = { type: "video", url: "https://example.com/v", extra: [1, 2, { deep: true }] };
    const result = roundTrip({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Trước" }] }, strange, { type: "toc" }] });
    expect(result.body.blocks).toEqual([{ type: "paragraph", inlines: [{ text: "Trước" }] }, strange, { type: "toc" }]);
  });

  it("keeps a known block type with an unknown field as an opaque block rather than dropping the field", () => {
    const odd = { type: "heading", level: 2, text: "Tiêu đề", anchor: "x" };
    expect(roundTrip({ schemaVersion: 1, blocks: [odd] }).body.blocks).toEqual([odd]);
    const badLevel = { type: "heading", level: 6, text: "Quá sâu" };
    expect(roundTrip({ schemaVersion: 1, blocks: [badLevel] }).body.blocks).toEqual([badLevel]);
  });

  it("does not open a body of another schema version, or a body that is not a body", () => {
    expect(bodyToDoc({ schemaVersion: 2, blocks: [] }).kind).toBe("locked");
    expect(bodyToDoc({ blocks: [] }).kind).toBe("locked");
    expect(bodyToDoc({ schemaVersion: 1 }).kind).toBe("locked");
    expect(bodyToDoc("text").kind).toBe("locked");
    expect(bodyToDoc([1]).kind).toBe("locked");
  });

  it("compares a locked body as it is", () => {
    const raw = { schemaVersion: 7, blocks: [{ type: "new" }] };
    expect(canonicalBody(raw)).toBe(JSON.stringify(raw));
  });
});

describe("the schema holds only what the server accepts", () => {
  const text = (value: string, marks?: PmNode["marks"]): PmNode => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
  const refuses = (doc: PmNode) => expect(() => viaSchema(doc)).toThrow();

  it("has no marks inside a heading", () => {
    refuses({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [text("x", [{ type: "bold" }])] }] });
  });

  it("has no heading outside levels 2 to 4... in the parsed body (a level 1 is not made by the editor)", () => {
    const opened = bodyToDoc({ schemaVersion: 1, blocks: [{ type: "heading", level: 1, text: "H1" }] });
    expect(opened.kind === "ok" && opened.doc.content?.[0].type).toBe("unknownBlock");
  });

  it("has one paragraph in a list item, and no nested list", () => {
    refuses({ type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }, { type: "paragraph" }] }] }] });
    refuses({ type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "bulletList" }] }] }] });
  });

  it("has a quote of one paragraph and an optional cite, and nothing else", () => {
    refuses({ type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph" }, { type: "paragraph" }] }] });
    refuses({ type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph" }, { type: "quoteCite", content: [text("n", [{ type: "bold" }])] }] }] });
  });

  it("has no hard break, code or strike", () => {
    expect(schema.nodes.hardBreak).toBeUndefined();
    expect(schema.nodes.codeBlock).toBeUndefined();
    expect(schema.marks.strike).toBeUndefined();
    expect(schema.marks.code).toBeUndefined();
  });
});

describe("what the server would refuse is reported before sending, and the text is not rewritten", () => {
  const withText = (value: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] } as PmNode);

  it("flags angle brackets, tabs, line breaks and other control characters", () => {
    for (const bad of ["a < b", "a > b", "tab\there", "line\nbreak", "bell\u0007", "nel\u0085"]) {
      const result = docToBody(withText(bad));
      expect(result.problems.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(result.body.blocks[0]).toEqual({ type: "paragraph", inlines: [{ text: bad }] });
    }
    expect(docToBody(withText("Ổn: “ngoặc kép”, & dấu — và emoji 🌴")).problems).toEqual([]);
  });

  it("flags a link the server would refuse", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//evil.com", "/\\evil", "https://u:p@example.com", "ftp://x.y", " /a", "/a b", ""]) {
      const doc: PmNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }] }] };
      expect(docToBody(doc).problems.length, JSON.stringify(href)).toBeGreaterThan(0);
    }
  });

  it("flags a text longer than 5000, a heading over 300 and a cite over 200", () => {
    expect(docToBody(withText("a".repeat(BODY_LIMITS.text))).problems).toEqual([]);
    expect(docToBody(withText("a".repeat(BODY_LIMITS.text + 1))).problems).toHaveLength(1);
    const heading = (n: number): PmNode => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "h".repeat(n) }] }] });
    expect(docToBody(heading(300)).problems).toEqual([]);
    expect(docToBody(heading(301)).problems).toHaveLength(1);
    const quote = (n: number): PmNode => ({ type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }, { type: "quoteCite", content: [{ type: "text", text: "c".repeat(n) }] }] }] });
    expect(docToBody(quote(200)).problems).toEqual([]);
    expect(docToBody(quote(201)).problems).toHaveLength(1);
  });

  it("counts blocks, runs and list items", () => {
    const paragraphs = (n: number): PmNode => ({ type: "doc", content: Array.from({ length: n }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `p${i}` }] })) });
    expect(docToBody(paragraphs(BODY_LIMITS.blocks)).problems).toEqual([]);
    expect(docToBody(paragraphs(BODY_LIMITS.blocks + 1)).problems.map((p) => p.where)).toContain("Bài viết");

    const runs = (n: number): PmNode => ({ type: "doc", content: [{ type: "paragraph", content: Array.from({ length: n }, (_, i) => ({ type: "text", text: "x", marks: i % 2 ? [{ type: "bold" }] : [] })) }] });
    expect(docToBody(runs(BODY_LIMITS.inlines)).problems).toEqual([]);
    expect(docToBody(runs(BODY_LIMITS.inlines + 1)).problems).toHaveLength(1);

    const items = (n: number): PmNode => ({ type: "doc", content: [{ type: "orderedList", content: Array.from({ length: n }, (_, i) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: `i${i}` }] }] })) }] });
    expect(docToBody(items(BODY_LIMITS.listItems)).problems).toEqual([]);
    expect(docToBody(items(BODY_LIMITS.listItems + 1)).problems).toHaveLength(1);
  });

  it("measures the body in UTF-8 bytes, not characters", () => {
    // 'ế' is three bytes: 30 000 of them are 30 000 characters but 90 000 bytes; 70 000 of them are over the 200 000 byte limit.
    const paragraph = (n: number): PmNode => ({ type: "doc", content: Array.from({ length: Math.ceil(n / BODY_LIMITS.text) }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: "ế".repeat(Math.min(BODY_LIMITS.text, n - i * BODY_LIMITS.text)) }] })) });
    expect(docToBody(paragraph(30_000)).problems).toEqual([]);
    expect(docToBody(paragraph(70_000)).problems.some((p) => p.where === "Bài viết")).toBe(true);
  });

  it("needs 2 to 12 pictures in a gallery, and a picture in an image", () => {
    const gallery = (n: number): PmNode => ({ type: "doc", content: [{ type: "gallery", attrs: { items: Array.from({ length: n }, () => ({ mediaId: M1, alt: "a" })) } }] });
    expect(docToBody(gallery(1)).problems).toHaveLength(1);
    expect(docToBody(gallery(2)).problems).toEqual([]);
    expect(docToBody(gallery(12)).problems).toEqual([]);
    expect(docToBody(gallery(13)).problems).toHaveLength(1);
    expect(docToBody({ type: "doc", content: [{ type: "image", attrs: { mediaId: "", alt: "", caption: "" } }] }).problems).toHaveLength(1);
    expect(docToBody({ type: "doc", content: [{ type: "propertyIntro", attrs: { propertyId: "" } }] }).problems).toHaveLength(1);
  });

  it("reports a quote that has a source but no text", () => {
    const doc: PmNode = { type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph" }, { type: "quoteCite", content: [{ type: "text", text: "Ai đó" }] }] }] };
    expect(docToBody(doc).problems).toHaveLength(1);
  });
});

describe("the server's link and text rules, ported", () => {
  it("accepts an internal path and an https address only", () => {
    for (const ok of ["/", "/blog", "/blog/bai-viet?x=1#y", "https://example.com", "https://example.com/a/b?c=d"]) expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of ["", "blog", "//x.y", "/\\x", "http://x.y", "javascript:x", "https:/x", "https://", "HTTPS://example.com", "https://a@b.c", "/a'b", '/a"b', "/a<b", "https://x.y/ z"]) {
      expect(isSafeHref(bad), bad).toBe(false);
    }
    expect(isSafeHref("/" + "a".repeat(BODY_LIMITS.href))).toBe(false);
  });

  it("is plain text when there is no angle bracket and no control character", () => {
    expect(isPlain("Đà Nẵng — 5★ “hay”")).toBe(true);
    expect(isPlain("a<b")).toBe(false);
    expect(isPlain("a\tb")).toBe(false);
  });
});
