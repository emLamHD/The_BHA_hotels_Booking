"use client";

/**
 * BHA-BLOG-001-CP03: the rich editor of the article body. TipTap (ProseMirror) restricted to the server's body format (`lib/blog/editorSchema`), with the
 * atom blocks edited in place and a toolbar that adds, moves and removes whole blocks. It holds the document; the screen above holds the form.
 *
 * - The stored body goes in once (`initialBody`); a different body means a different `key` on this component.
 * - Every change reports the body JSON the editor would send plus what the server would refuse (`onChange`) — the text is never rewritten.
 * - A body the editor does not understand (another `schemaVersion`) is shown as it is and is not editable here; the screen then sends it back unchanged.
 * - Pasting goes through the schema, so no HTML, script or unsafe link can enter; a pasted link must pass the same rule as a typed one.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Dropcursor, Gapcursor, UndoRedo } from "@tiptap/extensions";
import { bodyToDoc, docToBody, isSafeHref, type BodyProblem, type BodyV1 } from "@/lib/blog/bodyModel";
import { schemaExtensions, unwrapQuotes } from "@/lib/blog/editorSchema";
import { BodyEditorServicesContext, type BodyEditorServices } from "./BodyEditorContext";
import { viewedBlocks } from "./nodeViews";

export interface BodyState {
  /** `null` while the body is locked (not editable here). */
  body: BodyV1 | null;
  problems: BodyProblem[];
}

const ATOMS = new Set(["image", "gallery", "toc", "propertyIntro", "unknownBlock"]);

function extensions() {
  return [...schemaExtensions().filter((extension) => !ATOMS.has(extension.name)), ...viewedBlocks, UndoRedo, Gapcursor, Dropcursor];
}

/**
 * The top-level block the selection is in: its index, its position and its node - or `null` when there is none. A gap cursor (the caret the Gapcursor
 * extension allows before, between and after the atom blocks, at the end of the document included) sits BETWEEN blocks: no block is selected, and
 * `$from.index(0)` names the one after the gap, or is past the last one. Moving or deleting "the block at the gap" would be moving or deleting a block the
 * person did not select.
 */
function currentBlock(editor: Editor) {
  const { doc, selection } = editor.state;
  if (selection instanceof GapCursor) return null;
  const index = selection.$from.index(0);
  if (index >= doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return { index, pos, node: doc.child(index), count: doc.childCount };
}

function moveBlock(editor: Editor, direction: -1 | 1) {
  const block = currentBlock(editor);
  if (!block) return;
  const { index, pos, node, count } = block;
  const target = index + direction;
  if (target < 0 || target >= count) return;
  const neighbour = editor.state.doc.child(target);
  const { tr, selection } = editor.state;
  tr.delete(pos, pos + node.nodeSize);
  const insertAt = direction === -1 ? pos - neighbour.nodeSize : pos + neighbour.nodeSize;
  tr.insert(insertAt, node);
  // Deleting the block moved the selection onto a neighbour; the selection belongs to the block that was moved, so that the next click moves the same block: a node
  // selection stays a node selection, a text selection keeps its offsets inside the block (the copy is identical), anything wider starts at the block's text.
  const inside = selection.from >= pos && selection.to <= pos + node.nodeSize;
  if (inside && selection instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, insertAt));
  else if (inside) tr.setSelection(TextSelection.create(tr.doc, insertAt + (selection.anchor - pos), insertAt + (selection.head - pos)));
  else tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 1), 1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

/** Wraps the block in a quote, or takes the quote off (`unwrapQuotes`: the inherited toggle cannot lift a quote that has a cite). */
function toggleQuote(editor: Editor) {
  // Not `isActive("blockquote")`: that is only true when quotes cover the WHOLE selection, and a selection over a quote and its neighbours is still a quote to take off.
  const unwrapped = unwrapQuotes(editor.state);
  if (unwrapped) {
    editor.view.dispatch(unwrapped.scrollIntoView());
    editor.commands.focus();
  } else editor.chain().focus().toggleBlockquote().run();
}

function deleteBlock(editor: Editor) {
  const block = currentBlock(editor);
  if (!block) return;
  const { pos, node, count } = block;
  const { tr } = editor.state;
  tr.delete(pos, pos + node.nodeSize);
  if (count === 1) tr.insert(0, editor.state.schema.nodes.paragraph.create());
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

/** Inserts a block after the one the cursor is in, or AT a gap cursor; an empty paragraph the cursor is in is replaced instead of left behind. */
function insertBlock(editor: Editor, content: Record<string, unknown>) {
  const block = currentBlock(editor);
  if (!block) {
    editor.chain().focus().insertContentAt(editor.state.selection.from, content).run();
    return;
  }
  const { pos, node } = block;
  const empty = node.type.name === "paragraph" && node.content.size === 0;
  editor.chain().focus().insertContentAt(empty ? { from: pos, to: pos + node.nodeSize } : pos + node.nodeSize, content).run();
}

const BUTTON = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:border-brand-400 aria-pressed:bg-brand-50 aria-pressed:text-brand-700 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5 dark:aria-pressed:bg-brand-500/20";

function Toolbar({ editor, services }: { editor: Editor; services: BodyEditorServices }) {
  const [, force] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => {
    const redraw = () => force((n) => n + 1);
    editor.on("transaction", redraw);
    return () => {
      editor.off("transaction", redraw);
    };
  }, [editor]);

  const can = services.editable;
  const atGap = editor.state.selection instanceof GapCursor; // between blocks: nothing is selected to move or remove
  const inText = !(editor.state.selection instanceof NodeSelection) && !editor.isActive("heading");
  const button = (label: string, run: () => void, options: { active?: boolean; disabled?: boolean; title?: string } = {}) => (
    <button type="button" className={BUTTON} aria-pressed={options.active} disabled={!can || options.disabled} title={options.title ?? label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  );

  const applyLink = () => {
    const value = href.trim();
    if (!isSafeHref(value)) {
      setLinkError("Chỉ nhận đường dẫn nội bộ (bắt đầu bằng /, không phải //) hoặc địa chỉ https://.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    setLinkOpen(false);
    setHref("");
    setLinkError(null);
  };

  const pick = async (multiple: boolean) => {
    const picked = await services.pickMedia(multiple ? { multiple: true, min: 2, max: 12, title: "Chọn ảnh cho thư viện" } : { multiple: false, title: "Chọn ảnh cho bài viết" });
    if (!picked?.length) return;
    if (multiple) insertBlock(editor, { type: "gallery", attrs: { items: picked.map((media) => ({ mediaId: media.id, alt: "", caption: "" })) } });
    else insertBlock(editor, { type: "image", attrs: { mediaId: picked[0].id, alt: "", caption: picked[0].description } });
  };

  return (
    <div role="toolbar" aria-label="Công cụ soạn bài" data-testid="body-toolbar" className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-white/[0.03]">
      {button("Đoạn", () => editor.chain().focus().setParagraph().run(), { active: editor.isActive("paragraph") })}
      {([2, 3, 4] as const).map((level) => <React.Fragment key={level}>{button(`H${level}`, () => editor.chain().focus().setHeading({ level }).run(), { active: editor.isActive("heading", { level }), title: `Tiêu đề mục cấp ${level}` })}</React.Fragment>)}
      {button("B", () => editor.chain().focus().toggleBold().run(), { active: editor.isActive("bold"), disabled: !inText, title: "In đậm" })}
      {button("I", () => editor.chain().focus().toggleItalic().run(), { active: editor.isActive("italic"), disabled: !inText, title: "In nghiêng" })}
      {button("Liên kết", () => setLinkOpen((open) => !open), { active: editor.isActive("link"), disabled: !inText })}
      {button("Gỡ liên kết", () => editor.chain().focus().extendMarkRange("link").unsetLink().run(), { disabled: !editor.isActive("link") })}
      {button("• Danh sách", () => editor.chain().focus().toggleBulletList().run(), { active: editor.isActive("bulletList") })}
      {button("1. Danh sách", () => editor.chain().focus().toggleOrderedList().run(), { active: editor.isActive("orderedList") })}
      {button("Trích dẫn", () => toggleQuote(editor), { active: editor.isActive("blockquote") })}
      {button("Nguồn trích dẫn", () => editor.chain().focus().insertContentAt(editor.state.selection.$from.after(1) - 1, { type: "quoteCite" }).run(), { disabled: !editor.isActive("blockquote"), title: "Thêm dòng nguồn dưới trích dẫn" })}
      <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-700" aria-hidden />
      {button("Ảnh", () => void pick(false), { title: "Chèn một ảnh" })}
      {button("Thư viện ảnh", () => void pick(true), { title: "Chèn thư viện 2–12 ảnh" })}
      {button("Mục lục", () => insertBlock(editor, { type: "toc" }))}
      {button("Cơ sở lưu trú", () => insertBlock(editor, { type: "propertyIntro", attrs: { propertyId: "" } }))}
      <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-700" aria-hidden />
      {button("↑ Khối", () => moveBlock(editor, -1), { disabled: atGap, title: "Đưa khối lên" })}
      {button("↓ Khối", () => moveBlock(editor, 1), { disabled: atGap, title: "Đưa khối xuống" })}
      {button("Xoá khối", () => deleteBlock(editor), { disabled: atGap })}
      {button("Hoàn tác", () => editor.chain().focus().undo().run(), { disabled: !editor.can().undo() })}
      {button("Làm lại", () => editor.chain().focus().redo().run(), { disabled: !editor.can().redo() })}
      {linkOpen && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1">
          <input aria-label="Địa chỉ liên kết" placeholder="/blog/bai-viet hoặc https://…" value={href} onChange={(e) => { setHref(e.target.value); setLinkError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }} className="h-9 min-w-64 flex-1 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90" />
          <button type="button" className={BUTTON} onClick={applyLink}>Áp dụng</button>
          <button type="button" className={BUTTON} onClick={() => { setLinkOpen(false); setLinkError(null); }}>Đóng</button>
          {linkError && <p role="alert" className="w-full text-xs text-error-500">{linkError}</p>}
        </div>
      )}
    </div>
  );
}

export default function RichBodyEditor({
  initialBody,
  services,
  onChange,
}: {
  initialBody: unknown;
  services: BodyEditorServices;
  onChange: (state: BodyState) => void;
}) {
  const opened = useMemo(() => bodyToDoc(initialBody), [initialBody]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: extensions(),
    content: opened.kind === "ok" ? opened.doc : undefined,
    editable: services.editable && opened.kind === "ok",
    // Server rendering has no DOM for the editor; it is created in the browser (TipTap's own advice for Next.js).
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "prose-editor min-h-[18rem] max-w-none px-4 py-3 text-base leading-7 text-gray-800 focus:outline-hidden dark:text-white/90", "aria-label": "Nội dung bài viết", "data-testid": "body-editor" },
    },
    // A locked body has no document of its own (the editor behind it is empty): it must never be reported, or saving would replace it with nothing.
    onCreate: ({ editor: created }) => {
      if (opened.kind !== "ok") return;
      const { body, problems } = docToBody(created.getJSON());
      onChangeRef.current({ body, problems });
    },
    onUpdate: ({ editor: updated }) => {
      if (opened.kind !== "ok") return;
      const { body, problems } = docToBody(updated.getJSON());
      onChangeRef.current({ body, problems });
    },
  });

  useEffect(() => {
    editor?.setEditable(services.editable && opened.kind === "ok");
  }, [editor, services.editable, opened.kind]);

  if (opened.kind === "locked") {
    return (
      <div className="rounded-xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-200" role="alert" data-testid="body-locked">
        <p className="font-medium">Nội dung này chưa mở để sửa được.</p>
        <p className="mt-1">{opened.reason} Nó được giữ nguyên và gửi lại không đổi khi bạn lưu các trường khác.</p>
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-white/60 p-2 text-xs dark:bg-black/20">{JSON.stringify(initialBody, null, 2)}</pre>
      </div>
    );
  }

  return (
    <BodyEditorServicesContext.Provider value={services}>
      <div className="overflow-hidden rounded-xl border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
        {editor && services.editable && <Toolbar editor={editor} services={services} />}
        <EditorContent editor={editor} />
      </div>
    </BodyEditorServicesContext.Provider>
  );
}
