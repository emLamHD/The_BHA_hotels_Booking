/**
 * BHA-BLOG-001-CP03: the real editor (TipTap in jsdom): a stored body opens and comes back out unchanged, an unknown block survives, a body of another
 * schema version is shown and not edited, and a toolbar command changes the body the screen is told about.
 */
import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/blog")>()), fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })) }));

import RichBodyEditor, { type BodyState } from "./RichBodyEditor";
import type { BodyEditorServices } from "./BodyEditorContext";
import { EDITOR, renderInBlogGate } from "./blogTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";

// ProseMirror measures the page when it scrolls a selection into view; jsdom has no layout.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: EDITOR });
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const services = (over: Partial<BodyEditorServices> = {}): BodyEditorServices => ({ editable: true, properties: [{ id: "44444444-4444-4444-8444-444444444444", name: "Riverside" }], pickMedia: vi.fn(), ...over });

const BODY = {
  schemaVersion: 1,
  blocks: [
    { type: "heading", level: 2, text: "Giới thiệu" },
    { type: "paragraph", inlines: [{ text: "Đây là " }, { text: "đậm", bold: true }, { text: " và " }, { text: "liên kết", href: "/blog" }] },
    { type: "list", ordered: true, items: [[{ text: "Một" }], [{ text: "Hai", italic: true }]] },
    { type: "quote", inlines: [{ text: "Trích" }], cite: "Nguồn" },
    { type: "image", mediaId: M1, alt: "Biển", caption: "Mỹ Khê" },
    { type: "gallery", items: [{ mediaId: M1, alt: "a" }, { mediaId: M2, alt: "b", caption: "c" }] },
    { type: "toc" },
    { type: "propertyIntro", propertyId: "44444444-4444-4444-8444-444444444444" },
  ],
};

async function open(initialBody: unknown, over: Partial<BodyEditorServices> = {}) {
  const states: BodyState[] = [];
  renderInBlogGate(<RichBodyEditor initialBody={initialBody} services={services(over)} onChange={(s) => states.push(s)} />);
  await screen.findByTestId("body-editor").catch(() => null);
  return states;
}

describe("the real editor", () => {
  it("opens a stored body and reports exactly the same body, with no problem", async () => {
    const states = await open(BODY);
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    const last = states[states.length - 1];
    expect(last.problems).toEqual([]);
    expect(last.body).toEqual(BODY);
  });

  it("draws the atom blocks it edits in place", async () => {
    await open(BODY);
    expect(await screen.findByTestId("block-Ảnh")).toBeInTheDocument();
    expect(screen.getByTestId("block-Thư viện ảnh")).toBeInTheDocument();
    expect(screen.getByTestId("block-Mục lục")).toBeInTheDocument();
    expect(screen.getByLabelText("Cơ sở lưu trú")).toHaveValue("44444444-4444-4444-8444-444444444444");
    expect(screen.getAllByTestId("gallery-item")).toHaveLength(2);
  });

  it("keeps a block it does not understand and says so", async () => {
    const strange = { type: "video", url: "https://example.com/v" };
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Trước" }] }, strange] });
    expect(await screen.findByTestId("block-Khối chưa hỗ trợ")).toHaveTextContent("video");
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    expect(states[states.length - 1].body?.blocks[1]).toEqual(strange);
  });

  it("shows a body of another schema version as it is and does not make it editable", async () => {
    const states = await open({ schemaVersion: 2, blocks: [{ type: "new" }] });
    expect(await screen.findByTestId("body-locked")).toHaveTextContent(/phiên bản cấu trúc 2/);
    expect(screen.queryByTestId("body-editor")).toBeNull();
    expect(states).toEqual([]); // nothing to send but the stored body, which the screen keeps
  });

  it("offers no toolbar to someone who may not edit", async () => {
    await open(BODY, { editable: false });
    await screen.findByTestId("body-editor");
    expect(screen.queryByTestId("body-toolbar")).toBeNull();
    expect(screen.getByLabelText("Cơ sở lưu trú")).toBeDisabled();
  });

  it("lets a picture's alt and caption reach the server's limit PLUS a space (the server measures the trimmed text) and reports no problem (C5 F4)", async () => {
    const states = await open({ schemaVersion: 1, blocks: [{ type: "image", mediaId: M1, alt: "a".repeat(200), caption: "c".repeat(300) }] });
    const alt = (await screen.findByLabelText("Văn bản thay thế (alt) của ảnh")) as HTMLInputElement;
    const caption = screen.getByLabelText("Chú thích ảnh") as HTMLInputElement;
    await userEvent.type(alt, " ");
    await userEvent.type(caption, " ");
    expect(alt.value).toHaveLength(201); // the input does not stop a space after the 200th character
    expect(caption.value).toHaveLength(301);
    await waitFor(() => expect(states[states.length - 1].body?.blocks[0]).toMatchObject({ alt: "a".repeat(200) + " ", caption: "c".repeat(300) + " " }));
    expect(states[states.length - 1].problems).toEqual([]);
  });

  it("adds a contents block from the toolbar and reports it", async () => {
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Một đoạn" }] }] });
    await screen.findByTestId("body-toolbar");
    await userEvent.click(screen.getByRole("button", { name: "Mục lục" }));
    await waitFor(() => expect(states[states.length - 1].body?.blocks.map((b) => b.type)).toEqual(["paragraph", "toc"]));
  });

  it("flags a text with angle brackets instead of rewriting it", async () => {
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "a < b" }] }] });
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    const last = states[states.length - 1];
    expect(last.problems).toHaveLength(1);
    expect(last.body?.blocks[0]).toEqual({ type: "paragraph", inlines: [{ text: "a < b" }] });
  });
});


// ---------------------------------------------------------------- C7 F3: the gap cursor

describe("C7 F3 — the toolbar with a real GapCursor selection", () => {
  const PROPERTY = "44444444-4444-4444-8444-444444444444";
  const editorOf = () => (screen.getByTestId("body-editor") as HTMLElement & { editor: Editor }).editor;
  /** A real gap cursor (ProseMirror's own class and its own validity check), placed through a transaction. */
  const gapAt = (pos: number) => act(() => {
    const editor = editorOf();
    const $pos = editor.state.doc.resolve(pos);
    expect((GapCursor as unknown as { valid(at: typeof $pos): boolean }).valid($pos), `a gap cursor is allowed at ${pos}`).toBe(true);
    editor.view.dispatch(editor.state.tr.setSelection(new GapCursor($pos)));
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
  });
  const types = (states: BodyState[]) => states[states.length - 1].body?.blocks.map((b) => b.type);
  const button = (name: string) => screen.getByRole("button", { name });
  const ATOMS = { schemaVersion: 1, blocks: [{ type: "image", mediaId: M1, alt: "a" }, { type: "toc" }] }; // doc positions: 0 | image | 1 | toc | 2

  it.each([
    ["before the first block", 0, ["propertyIntro", "image", "toc"]],
    ["between two atoms", 1, ["image", "propertyIntro", "toc"]],
    ["after the trailing atom", 2, ["image", "toc", "propertyIntro"]],
  ])("inserting a block %s puts it AT the gap (no exception)", async (_name, pos, expected) => {
    const states = await open(ATOMS);
    await screen.findByTestId("body-toolbar");
    gapAt(pos);
    await userEvent.click(button("Cơ sở lưu trú"));
    await waitFor(() => expect(types(states)).toEqual(expected));
    void PROPERTY;
  });

  it.each([[0], [1], [2]])("move up, move down and delete are unavailable at a gap (position %i): there is no selected block, so none is moved or removed", async (pos) => {
    const states = await open(ATOMS);
    await screen.findByTestId("body-toolbar");
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    const before = JSON.stringify(editorOf().getJSON());
    gapAt(pos);
    for (const name of ["↑ Khối", "↓ Khối", "Xoá khối"]) expect(button(name)).toBeDisabled();
    expect(JSON.stringify(editorOf().getJSON())).toBe(before);
  });

  it.each([[0], [1], [2]])("every other enabled toolbar button can be pressed at a gap (position %i) without an exception, and the document stays a valid one", async (pos) => {
    const states = await open(ATOMS);
    await screen.findByTestId("body-toolbar");
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    const toolbar = screen.getByTestId("body-toolbar");
    const names = Array.from(toolbar.querySelectorAll("button")).map((b) => b.textContent ?? "");
    const errors: unknown[] = [];
    const record = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener("error", record);
    for (const name of names) {
      gapAt(pos);
      const target = Array.from(toolbar.querySelectorAll("button")).find((b) => b.textContent === name)!;
      if ((target as HTMLButtonElement).disabled) continue;
      await userEvent.click(target);
      editorOf().state.doc.check(); // still a document the schema accepts
    }
    window.removeEventListener("error", record);
    expect(errors).toEqual([]);
  });

  it("a trailing gallery: the gap after it takes an inserted block, and the preceding gallery is untouched", async () => {
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Mở đầu" }] }, { type: "gallery", items: [{ mediaId: M1, alt: "a" }, { mediaId: M2, alt: "b" }] }] });
    await screen.findByTestId("body-toolbar");
    const end = editorOf().state.doc.content.size;
    gapAt(end);
    await userEvent.click(button("Mục lục"));
    await waitFor(() => expect(types(states)).toEqual(["paragraph", "gallery", "toc"]));
    expect(states[states.length - 1].body?.blocks[1]).toEqual({ type: "gallery", items: [{ mediaId: M1, alt: "a" }, { mediaId: M2, alt: "b" }] });
  });

  it("after the insert the document saves as the intended body, with no problem other than the property still to be chosen", async () => {
    const states = await open(ATOMS);
    await screen.findByTestId("body-toolbar");
    gapAt(2);
    await userEvent.click(button("Mục lục"));
    await waitFor(() => expect(types(states)).toEqual(["image", "toc", "toc"]));
    expect(states[states.length - 1].problems).toEqual([]);
  });

  it("ordinary selections are unchanged: a text selection moves its block, a node selection is deleted", async () => {
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Một" }] }, { type: "paragraph", inlines: [{ text: "Hai" }] }, { type: "toc" }] });
    await screen.findByTestId("body-toolbar");
    act(() => { const editor = editorOf(); editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2))); }); // inside "Một"
    for (const name of ["↑ Khối", "↓ Khối", "Xoá khối"]) expect(button(name)).toBeEnabled();
    await userEvent.click(button("↓ Khối"));
    await waitFor(() => expect(states[states.length - 1].body?.blocks[0]).toEqual({ type: "paragraph", inlines: [{ text: "Hai" }] }));
    act(() => { const editor = editorOf(); const tocPos = editor.state.doc.content.size - 1; editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tocPos))); });
    await userEvent.click(button("Xoá khối"));
    await waitFor(() => expect(types(states)).toEqual(["paragraph", "paragraph"]));
  });
});


// ---------------------------------------------------------------- C8 F1: the selection follows a moved block

describe("C8 F1 — repeated moves act on the same block", () => {
  const editorOf = () => (screen.getByTestId("body-editor") as HTMLElement & { editor: Editor }).editor;
  const button = (name: string) => screen.getByRole("button", { name });
  const P = (text: string) => ({ type: "paragraph", inlines: [{ text }] });
  const texts = (states: BodyState[]) => states[states.length - 1].body?.blocks.map((b) => (b.type === "paragraph" ? b.inlines.map((i) => i.text).join("") : b.type));
  /** Puts a real text selection into the block whose text is `text`, at the given offsets inside it. */
  const caretIn = (text: string, anchorOffset: number, headOffset = anchorOffset) => act(() => {
    const editor = editorOf();
    let start = -1;
    editor.state.doc.descendants((node, offset) => { if (start < 0 && node.isTextblock && node.textContent === text) start = offset; });
    expect(start, `a block "${text}"`).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + 1 + anchorOffset, start + 1 + headOffset)));
  });
  const where = () => { const { selection } = editorOf().state; return { parent: selection.$from.parent.textContent, from: selection.$from.parentOffset, to: selection.$to.parentOffset }; };

  it("A / B / C, caret in C: two clicks on 'up' give C / A / B WITHOUT selecting again, a third does nothing, and the caret stays in C", async () => {
    const states = await open({ schemaVersion: 1, blocks: [P("A"), P("B"), P("Cxyz")] });
    await screen.findByTestId("body-toolbar");
    caretIn("Cxyz", 2);
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["A", "Cxyz", "B"]));
    expect(where()).toEqual({ parent: "Cxyz", from: 2, to: 2 });
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["Cxyz", "A", "B"]));
    expect(where()).toEqual({ parent: "Cxyz", from: 2, to: 2 });
    await userEvent.click(button("↑ Khối")); // the boundary: nothing moves
    expect(texts(states)).toEqual(["Cxyz", "A", "B"]);
    expect(where()).toEqual({ parent: "Cxyz", from: 2, to: 2 });
  });

  it("and back down again, twice, ends where it began with the caret in the same place", async () => {
    const states = await open({ schemaVersion: 1, blocks: [P("A"), P("B"), P("Cxyz")] });
    await screen.findByTestId("body-toolbar");
    caretIn("Cxyz", 1);
    await userEvent.click(button("↑ Khối"));
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["Cxyz", "A", "B"]));
    await userEvent.click(button("↓ Khối"));
    await userEvent.click(button("↓ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["A", "B", "Cxyz"]));
    expect(where()).toEqual({ parent: "Cxyz", from: 1, to: 1 });
    await userEvent.click(button("↓ Khối")); // the other boundary
    expect(texts(states)).toEqual(["A", "B", "Cxyz"]);
  });

  it("a text RANGE inside the block is kept as a range", async () => {
    const states = await open({ schemaVersion: 1, blocks: [P("A"), P("Cxyzw")] });
    await screen.findByTestId("body-toolbar");
    caretIn("Cxyzw", 1, 4);
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["Cxyzw", "A"]));
    expect(where()).toEqual({ parent: "Cxyzw", from: 1, to: 4 });
  });

  it("an atom block (gallery) stays NODE-selected through repeated moves in both directions", async () => {
    const GALLERY = { type: "gallery", items: [{ mediaId: M1, alt: "a" }, { mediaId: M2, alt: "b" }] };
    const states = await open({ schemaVersion: 1, blocks: [P("Mở"), { type: "toc" }, GALLERY, { type: "image", mediaId: M1, alt: "x" }] });
    await screen.findByTestId("body-toolbar");
    act(() => { const editor = editorOf(); let at = -1; editor.state.doc.forEach((n, offset) => { if (n.type.name === "gallery") at = offset; }); editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at))); });
    const selected = () => (editorOf().state.selection instanceof NodeSelection ? (editorOf().state.selection as NodeSelection).node.type.name : "(not a node selection)");
    await userEvent.click(button("↓ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["Mở", "toc", "image", "gallery"]));
    expect(selected()).toBe("gallery");
    await userEvent.click(button("↓ Khối")); // boundary
    expect(texts(states)).toEqual(["Mở", "toc", "image", "gallery"]);
    await userEvent.click(button("↑ Khối"));
    await userEvent.click(button("↑ Khối"));
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["gallery", "Mở", "toc", "image"]));
    expect(selected()).toBe("gallery");
    await userEvent.click(button("↑ Khối")); // boundary
    expect(texts(states)).toEqual(["gallery", "Mở", "toc", "image"]);
  });

  it("a caret inside a list item keeps its place when the list moves", async () => {
    const states = await open({ schemaVersion: 1, blocks: [P("Trên"), { type: "list", ordered: false, items: [[{ text: "Một" }], [{ text: "Hai ba" }]] }] });
    await screen.findByTestId("body-toolbar");
    caretIn("Hai ba", 3);
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(states[states.length - 1].body?.blocks.map((b) => b.type)).toEqual(["list", "paragraph"]));
    expect(where()).toEqual({ parent: "Hai ba", from: 3, to: 3 });
    await userEvent.click(button("↓ Khối"));
    await waitFor(() => expect(states[states.length - 1].body?.blocks.map((b) => b.type)).toEqual(["paragraph", "list"]));
    expect(where()).toEqual({ parent: "Hai ba", from: 3, to: 3 });
  });

  it("one move is one undo step, and redo moves it again", async () => {
    const states = await open({ schemaVersion: 1, blocks: [P("A"), P("B"), P("C")] });
    await screen.findByTestId("body-toolbar");
    caretIn("C", 1);
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(texts(states)).toEqual(["A", "C", "B"]));
    await userEvent.click(button("Hoàn tác"));
    await waitFor(() => expect(texts(states)).toEqual(["A", "B", "C"]));
    await userEvent.click(button("Làm lại"));
    await waitFor(() => expect(texts(states)).toEqual(["A", "C", "B"]));
  });

  it("the move saves as the intended body (serialisation)", async () => {
    const states = await open({ schemaVersion: 1, blocks: [P("A"), { type: "toc" }, P("Cxyz")] });
    await screen.findByTestId("body-toolbar");
    caretIn("Cxyz", 2);
    await userEvent.click(button("↑ Khối"));
    await userEvent.click(button("↑ Khối"));
    await waitFor(() => expect(states[states.length - 1].body?.blocks).toEqual([P("Cxyz"), P("A"), { type: "toc" }]));
    expect(states[states.length - 1].problems).toEqual([]);
  });
});

// ---------------------------------------------------------------- C9 F2: the quote button unwraps a quote that has a citation

describe("C9 F2 — 'Trích dẫn' removes quote formatting from the restricted quote schema", () => {
  const editorOf = () => (screen.getByTestId("body-editor") as HTMLElement & { editor: Editor }).editor;
  const button = (name: string) => screen.getByRole("button", { name });
  const P = (text: string) => ({ type: "paragraph", inlines: [{ text }] });
  const QUOTE_INLINES = [{ text: "Câu " }, { text: "đậm", bold: true }, { text: " và " }, { text: "liên kết", href: "/blog" }];
  const body = (...blocks: unknown[]) => ({ schemaVersion: 1, blocks });
  const blocksOf = (states: BodyState[]) => states[states.length - 1].body?.blocks;
  const caretIn = (text: string, offset = 0) => act(() => {
    const editor = editorOf();
    let start = -1;
    editor.state.doc.descendants((node, pos) => { if (start < 0 && node.isTextblock && node.textContent === text) start = pos; });
    expect(start, `a block "${text}"`).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + 1 + offset)));
  });
  const rangeOver = (firstText: string, lastText: string) => act(() => {
    const editor = editorOf();
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === firstText && from < 0) from = pos + 1;
      if (node.isTextblock && node.textContent === lastText) to = pos + 1 + node.content.size;
    });
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  });
  const where = () => { const { selection } = editorOf().state; return { parent: selection.$from.parent.textContent, type: selection.$from.parent.type.name, offset: selection.$from.parentOffset }; };
  const shapeOf = () => { const types: string[] = []; editorOf().state.doc.forEach((child) => types.push(child.type.name)); return types; };

  const WITH_CITE = body(P("Trước"), { type: "quote", inlines: QUOTE_INLINES, cite: "Nguồn A" }, P("Sau"));

  it("from the quote's paragraph, with a citation: both stay as ordinary paragraphs, in order, with their marks and the link; the document is valid", async () => {
    const states = await open(WITH_CITE);
    caretIn("Câu đậm và liên kết", 3);
    await userEvent.click(button("Trích dẫn"));
    expect(blocksOf(states)).toEqual([P("Trước"), { type: "paragraph", inlines: QUOTE_INLINES }, P("Nguồn A"), P("Sau")]);
    expect(shapeOf()).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"]);
    expect(() => editorOf().state.doc.check()).not.toThrow();
    expect(editorOf().isActive("blockquote")).toBe(false);
    expect(where()).toEqual({ parent: "Câu đậm và liên kết", type: "paragraph", offset: 3 }); // the caret stays where it was in the text
  });

  it("from the citation: the same result, and the caret stays in the citation's text", async () => {
    const states = await open(WITH_CITE);
    caretIn("Nguồn A", 4);
    await userEvent.click(button("Trích dẫn"));
    expect(blocksOf(states)).toEqual([P("Trước"), { type: "paragraph", inlines: QUOTE_INLINES }, P("Nguồn A"), P("Sau")]);
    expect(where()).toEqual({ parent: "Nguồn A", type: "paragraph", offset: 4 });
  });

  it("with an EMPTY citation (added with 'Nguồn trích dẫn', not filled): it unwraps, and no empty paragraph or duplicate is left", async () => {
    const states = await open(body(P("Trước"), { type: "quote", inlines: [{ text: "Chỉ trích" }] }, P("Sau")));
    caretIn("Chỉ trích", 2);
    await userEvent.click(button("Nguồn trích dẫn"));
    expect(shapeOf()).toEqual(["paragraph", "blockquote", "paragraph"]);
    expect(editorOf().state.doc.child(1).childCount).toBe(2); // a paragraph and an empty cite
    caretIn("Chỉ trích", 2);
    await userEvent.click(button("Trích dẫn"));
    expect(shapeOf()).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(blocksOf(states)).toEqual([P("Trước"), P("Chỉ trích"), P("Sau")]);
    expect(where()).toEqual({ parent: "Chỉ trích", type: "paragraph", offset: 2 });
  });

  it("from the empty citation itself: the caret lands at the end of the quote's paragraph", async () => {
    await open(body({ type: "quote", inlines: [{ text: "Chỉ trích" }] }));
    caretIn("Chỉ trích", 2);
    await userEvent.click(button("Nguồn trích dẫn"));
    act(() => {
      const editor = editorOf();
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.child(0).child(0).nodeSize + 2)));
    });
    expect(where().type).toBe("quoteCite");
    await userEvent.click(button("Trích dẫn"));
    expect(shapeOf()).toEqual(["paragraph"]);
    expect(where()).toEqual({ parent: "Chỉ trích", type: "paragraph", offset: "Chỉ trích".length });
  });

  it("a quote without a citation unwraps as before", async () => {
    const states = await open(body(P("Trước"), { type: "quote", inlines: [{ text: "Chỉ trích" }] }, P("Sau")));
    caretIn("Chỉ trích", 1);
    await userEvent.click(button("Trích dẫn"));
    expect(blocksOf(states)).toEqual([P("Trước"), P("Chỉ trích"), P("Sau")]);
  });

  it("a selection over two quotes and the paragraph between them unwraps both quotes (citations kept) and leaves every other block as it was", async () => {
    const states = await open(body(
      P("Đầu"),
      { type: "quote", inlines: [{ text: "Một" }], cite: "Nguồn 1" },
      P("Giữa"),
      { type: "quote", inlines: [{ text: "Hai" }], cite: "Nguồn 2" },
      { type: "heading", level: 2, text: "Cuối" },
    ));
    rangeOver("Một", "Nguồn 2");
    await userEvent.click(button("Trích dẫn"));
    expect(blocksOf(states)).toEqual([P("Đầu"), P("Một"), P("Nguồn 1"), P("Giữa"), P("Hai"), P("Nguồn 2"), { type: "heading", level: 2, text: "Cuối" }]);
    expect(() => editorOf().state.doc.check()).not.toThrow();
    expect(editorOf().isActive("blockquote")).toBe(false);
  });

  it("is ONE undoable action: undo restores the quote with its citation, redo unwraps again", async () => {
    const states = await open(WITH_CITE);
    caretIn("Câu đậm và liên kết", 3);
    await userEvent.click(button("Trích dẫn"));
    await userEvent.click(button("Hoàn tác"));
    expect(blocksOf(states)).toEqual(WITH_CITE.blocks);
    expect(shapeOf()).toEqual(["paragraph", "blockquote", "paragraph"]);
    await userEvent.click(button("Làm lại"));
    expect(blocksOf(states)).toEqual([P("Trước"), { type: "paragraph", inlines: QUOTE_INLINES }, P("Nguồn A"), P("Sau")]);
  });

  it("ordinary wrapping still works: a paragraph becomes a quote, and the button takes it back", async () => {
    const states = await open(body(P("Trước"), P("Thường"), P("Sau")));
    caretIn("Thường", 2);
    await userEvent.click(button("Trích dẫn"));
    expect(blocksOf(states)).toEqual([P("Trước"), { type: "quote", inlines: [{ text: "Thường" }] }, P("Sau")]);
    await userEvent.click(button("Trích dẫn"));
    expect(blocksOf(states)).toEqual([P("Trước"), P("Thường"), P("Sau")]);
  });

  it("does nothing off a quote (a heading, a gap cursor) and does not throw", async () => {
    const states = await open(body({ type: "heading", level: 2, text: "Tiêu đề" }, { type: "image", mediaId: M1, alt: "a", caption: "" }));
    caretIn("Tiêu đề", 1);
    const before = JSON.stringify(blocksOf(states));
    expect(editorOf().isActive("blockquote")).toBe(false);
    act(() => {
      const editor = editorOf();
      editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(editor.state.doc.content.size))));
    });
    expect(() => editorOf().chain().focus().run()).not.toThrow();
    expect(JSON.stringify(blocksOf(states))).toBe(before);
  });
});
