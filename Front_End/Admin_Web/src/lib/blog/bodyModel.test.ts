import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { DOMParser as PmDOMParser, Node as PmModelNode } from "@tiptap/pm/model";
import { BODY_LIMITS, bodyToDoc, canonicalBody, comparableBody, docToBody, isPlain, isSafeHref, mediaIdsOf, type PmNode } from "./bodyModel";
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

describe("pasted HTML goes through the schema", () => {
  const paste = (html: string) => {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const doc = PmDOMParser.fromSchema(schema).parse(holder);
    return docToBody(doc.toJSON() as PmNode);
  };

  it("keeps a safe link and drops an unsafe one, keeping its text", () => {
    const safe = paste('<p>a <a href="https://example.com/x">ok</a> <a href="/blog">in</a></p>');
    expect(safe.body.blocks[0]).toEqual({ type: "paragraph", inlines: [{ text: "a " }, { text: "ok", href: "https://example.com/x" }, { text: " " }, { text: "in", href: "/blog" }] });
    for (const href of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//evil.example", "vbscript:x"]) {
      const result = paste(`<p>see <a href="${href}">here</a></p>`);
      expect(JSON.stringify(result.body), href).not.toContain("href");
      expect(result.body.blocks[0]).toEqual({ type: "paragraph", inlines: [{ text: "see here" }] });
    }
  });

  it("keeps no script, style, image, iframe, event handler or unknown tag", () => {
    const result = paste('<p onclick="x()">hi<script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://e.example"></iframe><style>p{}</style><u>under</u></p><div class="x">block</div>');
    const text = JSON.stringify(result.body);
    expect(text).not.toMatch(/script|onerror|onclick|iframe|style|img/);
    expect(result.body.blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("turns nested lists, a second paragraph in an item and a heading with bold into the allowed shapes", () => {
    const result = paste("<ul><li><p>one</p><p>two</p><ul><li>nested</li></ul></li></ul><h2>Head <b>bold</b></h2><h1>Top</h1>");
    for (const block of result.body.blocks) {
      if (block.type === "heading") expect(block.text).not.toContain("<");
      if (block.type === "list") block.items.forEach((item) => expect(item.every((run) => typeof run.text === "string")).toBe(true));
    }
    expect(() => PmModelNode.fromJSON(schema, PmDOMParser.fromSchema(schema).parse((() => { const d = document.createElement("div"); d.innerHTML = "<ul><li><p>one</p><p>two</p></li></ul>"; return d; })()).toJSON()).check()).not.toThrow();
  });
});

describe("the form bodies are compared in", () => {
  it("ignores the spaces the server trims (heading, cite, alt, caption) and keeps the spaces of a run", () => {
    const typed = { schemaVersion: 1 as const, blocks: [
      { type: "heading" as const, level: 2 as const, text: "  Mục  " },
      { type: "quote" as const, inlines: [{ text: "a " }, { text: "b", bold: true as const }], cite: " Ai đó " },
      { type: "image" as const, mediaId: M1, alt: " Biển ", caption: "  " },
      { type: "gallery" as const, items: [{ mediaId: M1, alt: "x ", caption: " c " }, { mediaId: M2, alt: "y" }] },
    ] };
    const kept = { schemaVersion: 1 as const, blocks: [
      { type: "heading" as const, level: 2 as const, text: "Mục" },
      { type: "quote" as const, inlines: [{ text: "a " }, { text: "b", bold: true as const }], cite: "Ai đó" },
      { type: "image" as const, mediaId: M1, alt: "Biển" },
      { type: "gallery" as const, items: [{ mediaId: M1, alt: "x", caption: "c" }, { mediaId: M2, alt: "y" }] },
    ] };
    expect(comparableBody(typed)).toBe(comparableBody(kept));
    // …but a space inside a run is text and does count
    expect(comparableBody({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "a " }] }] })).not.toBe(comparableBody({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "a" }] }] }));
  });
});

// ---------------------------------------------------------------- C5 F4: the server trims these texts BEFORE it counts and checks them

describe("C5 F4 — heading, cite, alt and caption are measured as the server measures them (trimmed)", () => {
  // `string.Trim()` on .NET 8 removes exactly these (read from the runtime: every char for which `char.IsWhiteSpace` is true, U+0000..U+FFFF).
  const NET_WHITESPACE = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
  // Not removed by .NET although `String.prototype.trim` of JavaScript removes U+FEFF; and zero-width characters are not whitespace on either side.
  const NOT_TRIMMED_BY_NET = [0xfeff, 0x200b, 0x200c, 0x180e, 0x00ad];
  const doc = (...content: PmNode[]): PmNode => ({ type: "doc", content });
  const heading = (text: string): PmNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
  const quote = (cite: string): PmNode => ({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Lời" }] }, { type: "quoteCite", content: [{ type: "text", text: cite }] }] });
  const image = (alt: string, caption: string): PmNode => ({ type: "image", attrs: { mediaId: M1, alt, caption } });
  const gallery = (alt: string, caption: string): PmNode => ({ type: "gallery", attrs: { items: [{ mediaId: M1, alt, caption }, { mediaId: M2, alt: "b" }] } });
  const x = (n: number) => "x".repeat(n);

  it("a heading of exactly 300 characters with spaces around it passes, and is submitted as typed", () => {
    for (const padded of [x(300) + " ", " " + x(300), "  " + x(300) + "   "]) {
      const out = docToBody(doc(heading(padded)));
      expect(out.problems).toEqual([]);
      expect(out.body.blocks[0]).toMatchObject({ type: "heading", text: padded }); // the raw text goes to the server, which trims it
    }
  });

  it("a heading whose TRIMMED text is over 300 is still refused", () => {
    expect(docToBody(doc(heading(x(301)))).problems).toHaveLength(1);
    expect(docToBody(doc(heading(" " + x(301) + " "))).problems).toHaveLength(1);
  });

  it("each trimmed field passes at its limit with whitespace around it and fails one over: cite 200, alt 200, caption 300, in an image and in a gallery", () => {
    const at = (fn: (s: string) => PmNode, limit: number) => {
      expect(docToBody(doc(fn(" " + x(limit) + " "))).problems).toEqual([]);
      expect(docToBody(doc(fn(" " + x(limit + 1) + " "))).problems).toHaveLength(1);
    };
    at(quote, BODY_LIMITS.cite);
    at((s) => image(s, ""), BODY_LIMITS.alt);
    at((s) => image("a", s), BODY_LIMITS.caption);
    at((s) => gallery(s, ""), BODY_LIMITS.alt);
    at((s) => gallery("a", s), BODY_LIMITS.caption);
  });

  it("the characters .NET trims are trimmed, one by one, as the runtime says (not the JavaScript set)", () => {
    for (const code of NET_WHITESPACE) {
      const c = String.fromCharCode(code);
      expect(docToBody(doc(heading(x(300) + c))).problems, `U+${code.toString(16)} after 300 characters`).toEqual([]);
      expect(docToBody(doc(heading(c + x(300)))).problems, `U+${code.toString(16)} before 300 characters`).toEqual([]);
    }
  });

  it("the characters .NET does NOT trim count: U+FEFF (JavaScript would trim it), zero-width and soft hyphen make 301", () => {
    for (const code of NOT_TRIMMED_BY_NET) {
      const out = docToBody(doc(heading(x(300) + String.fromCharCode(code))));
      expect(out.problems.length, `U+${code.toString(16)}`).toBeGreaterThan(0);
    }
  });

  it("a control character that is whitespace at the ends is trimmed (the server accepts it); one inside the text is not", () => {
    expect(docToBody(doc(heading("Tiêu đề\t"))).problems).toEqual([]);
    expect(docToBody(doc(heading("\u0085Tiêu đề"))).problems).toEqual([]);
    expect(docToBody(doc(heading("Tiêu\tđề"))).problems).toHaveLength(1);
    expect(docToBody(doc(heading("Tiêu\u0001 đề"))).problems).toHaveLength(1);
    expect(docToBody(doc(heading("\u0001Tiêu đề"))).problems).toHaveLength(1); // not whitespace: not trimmed
  });

  it("'<' and '>' in the trimmed text are still refused", () => {
    expect(docToBody(doc(heading(" a<b "))).problems).toHaveLength(1);
  });

  it("a heading with only whitespace (also NEL / ideographic space) is an empty block: left out, no problem", () => {
    for (const blank of ["   ", "\u0085", "\u3000\u00a0"]) {
      const out = docToBody(doc(heading(blank), { type: "paragraph", content: [{ type: "text", text: "ok" }] }));
      expect(out.problems).toEqual([]);
      expect(out.body.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    }
  });

  it("an inline run is NOT trimmed (the server keeps the spaces between runs): 5000 + a space is over the limit, and the text is not rewritten", () => {
    const paragraph = (text: string): PmNode => ({ type: "paragraph", content: [{ type: "text", text }] });
    expect(docToBody(doc(paragraph(x(5000)))).problems).toEqual([]);
    expect(docToBody(doc(paragraph(x(5000) + " "))).problems).toHaveLength(1);
    expect(docToBody(doc(paragraph("Đây là "))).body.blocks[0]).toMatchObject({ inlines: [{ text: "Đây là " }] });
  });
});
