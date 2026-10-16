import type { MenuItem, MenuLocale, MenuPlacement } from "@/lib/api/website";

/**
 * CUST-WEB-HEADER-001-CP04: the menu editor's draft, as pure functions over the flat list the API speaks (tree order: the
 * main row first, each entry followed by its sub-entries). Every operation returns a new, canonical list or says why it
 * cannot — a cycle, a fifth level or an entry that still has children is not a state the editor can reach. The server
 * repeats every rule; these only make the draft honest and save a round trip.
 */
export const MAX_DEPTH = 4;
export const MAX_ITEMS = 200;
export const MAX_LABEL = 80;
export const MAX_HREF = 2048;

const key = (parentId: string | null, placement: MenuPlacement | null) => parentId ?? `root:${placement}`;

/** The list in tree order; `order` replaces the order of one sibling group. Entries whose parent is gone are dropped (an operation never leaves one). */
export function canonical(items: readonly MenuItem[], order?: { group: string; ids: readonly string[] }): MenuItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const groups = new Map<string, MenuItem[]>();
  for (const item of items) {
    const k = key(item.parentId, item.placement);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  const listOf = (k: string): MenuItem[] => (order?.group === k ? order.ids.map((id) => byId.get(id)).filter((item): item is MenuItem => !!item) : groups.get(k) ?? []);
  const out: MenuItem[] = [];
  const walk = (item: MenuItem) => {
    out.push(item);
    listOf(item.id).forEach(walk);
  };
  for (const placement of ["primary", "secondary"] as const) listOf(`root:${placement}`).forEach(walk);
  return out;
}

export const find = (items: readonly MenuItem[], id: string) => items.find((item) => item.id === id) ?? null;
export const childrenOf = (items: readonly MenuItem[], id: string) => items.filter((item) => item.parentId === id);

export function siblingsOf(items: readonly MenuItem[], id: string): MenuItem[] {
  const item = find(items, id);
  return item ? items.filter((other) => other.parentId === item.parentId && other.placement === item.placement) : [];
}

export function depthOf(items: readonly MenuItem[], id: string): number {
  let depth = 1;
  for (let current = find(items, id); current?.parentId; current = find(items, current.parentId)) depth++;
  return depth;
}

/** Levels of the subtree below (and including) `id`: a leaf is 1. */
export function subtreeHeight(items: readonly MenuItem[], id: string): number {
  return 1 + Math.max(0, ...childrenOf(items, id).map((child) => subtreeHeight(items, child.id)));
}

export function descendantIds(items: readonly MenuItem[], id: string): string[] {
  return childrenOf(items, id).flatMap((child) => [child.id, ...descendantIds(items, child.id)]);
}

export type Move = { ok: true; items: MenuItem[] } | { ok: false; reason: string };

const groupOf = (item: MenuItem) => key(item.parentId, item.placement);

/** One step up (`-1`) or down (`1`) among its siblings. */
export function moveWithinSiblings(items: readonly MenuItem[], id: string, direction: -1 | 1): Move {
  const list = siblingsOf(items, id);
  const at = list.findIndex((item) => item.id === id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= list.length) return { ok: false, reason: direction < 0 ? "Mục này đã đứng đầu." : "Mục này đã đứng cuối." };
  const ids = list.map((item) => item.id);
  [ids[at], ids[to]] = [ids[to], ids[at]];
  return { ok: true, items: canonical(items, { group: groupOf(list[at]), ids }) };
}

/** Becomes the last sub-entry of the entry just above it (a "thụt vào"). */
export function indent(items: readonly MenuItem[], id: string): Move {
  const list = siblingsOf(items, id);
  const at = list.findIndex((item) => item.id === id);
  if (at <= 0) return { ok: false, reason: "Cần một mục ngay phía trên để đặt mục này vào trong." };
  const parent = list[at - 1];
  if (depthOf(items, parent.id) + subtreeHeight(items, id) > MAX_DEPTH) return { ok: false, reason: `Menu chỉ có tối đa ${MAX_DEPTH} cấp.` };
  const moved = items.map((item) => (item.id === id ? { ...item, parentId: parent.id, placement: null } : item));
  return { ok: true, items: canonical(moved, { group: parent.id, ids: [...childrenOf(items, parent.id).map((child) => child.id), id] }) };
}

/** Becomes a sibling right after its parent (a "lùi ra"). */
export function outdent(items: readonly MenuItem[], id: string): Move {
  const item = find(items, id);
  const parent = item?.parentId ? find(items, item.parentId) : null;
  if (!item || !parent) return { ok: false, reason: "Mục cấp cao nhất không lùi ra thêm được." };
  const moved = items.map((other) => (other.id === id ? { ...other, parentId: parent.parentId, placement: parent.parentId ? null : parent.placement } : other));
  const ids = siblingsOf(items, parent.id).map((sibling) => sibling.id);
  ids.splice(ids.indexOf(parent.id) + 1, 0, id);
  return { ok: true, items: canonical(moved, { group: key(parent.parentId, parent.placement), ids }) };
}

/** A top-level entry moves to the other group, at its end. */
export function setPlacement(items: readonly MenuItem[], id: string, placement: MenuPlacement): Move {
  const item = find(items, id);
  if (!item || item.parentId !== null) return { ok: false, reason: "Chỉ mục cấp cao nhất mới đổi nhóm được." };
  if (item.placement === placement) return { ok: false, reason: "Mục này đã ở nhóm đó." };
  const moved = items.map((other) => (other.id === id ? { ...other, placement } : other));
  return { ok: true, items: canonical(moved, { group: `root:${placement}`, ids: [...items.filter((other) => other.parentId === null && other.placement === placement).map((other) => other.id), id] }) };
}

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/[x]/g, () => Math.floor(Math.random() * 16).toString(16));

export function addItem(items: readonly MenuItem[], parentId: string | null, placement: MenuPlacement, labels: Record<string, string | null>, id = newId()): Move {
  if (items.length >= MAX_ITEMS) return { ok: false, reason: `Menu có tối đa ${MAX_ITEMS} mục.` };
  if (parentId !== null && depthOf(items, parentId) >= MAX_DEPTH) return { ok: false, reason: `Menu chỉ có tối đa ${MAX_DEPTH} cấp.` };
  const created: MenuItem = { id, parentId, placement: parentId === null ? placement : null, isEnabled: true, href: "/", openInNewTab: false, labels };
  return { ok: true, items: canonical([...items, created]) };
}

/** Refuses an entry that still has sub-entries (the operator moves or deletes those first): never a silent branch delete. */
export function removeItem(items: readonly MenuItem[], id: string): Move {
  const count = childrenOf(items, id).length;
  if (count > 0) return { ok: false, reason: `Mục này còn ${count} mục con. Hãy chuyển hoặc xoá các mục con trước.` };
  return { ok: true, items: items.filter((item) => item.id !== id) };
}

export const patchItem = (items: readonly MenuItem[], id: string, patch: Partial<Omit<MenuItem, "id" | "parentId" | "placement">>): MenuItem[] =>
  items.map((item) => (item.id === id ? { ...item, ...patch } : item));

// ---------------------------------------------------------------- the same field rules as the server

/** `null` when the link is acceptable: an internal path, a `#` fragment, or an `https://` address. Nothing is fetched. */
export function checkHref(text: string): string | null {
  if (text.length === 0) return "Nhập link.";
  if (text.length > MAX_HREF) return `Link dài quá ${MAX_HREF} ký tự.`;
  if (/[\s\u0000-\u001f\u007f-\u009f\\]/.test(text)) return "Link không được có khoảng trắng, ký tự điều khiển hay dấu \\.";
  let decoded = text;
  for (let round = 0; round < 3; round++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return "Link không phải địa chỉ hợp lệ.";
    }
    if (next === decoded) break;
    decoded = next;
    if (/[\u0000-\u001f\u007f-\u009f\\]/.test(decoded)) return "Link không được chứa ký tự điều khiển hay dấu \\ (kể cả dạng mã hoá).";
  }
  if (text[0] === "#") return text.indexOf("#", 1) >= 0 ? "Link chỉ có một mốc #." : null;
  if (text[0] === "/") return text.startsWith("//") || decoded.startsWith("//") ? "Link không được bắt đầu bằng // (sẽ rời khỏi website)." : null;
  if (/^https:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return url.hostname && !url.username && !url.password ? null : "Địa chỉ https không hợp lệ.";
    } catch {
      return "Địa chỉ https không hợp lệ.";
    }
  }
  return "Dùng đường dẫn bắt đầu bằng /, một mốc # hoặc địa chỉ https://.";
}

export function checkLabel(text: string | null | undefined): string | null {
  const value = (text ?? "").trim();
  if (value.length === 0) return "Nhập nhãn.";
  if (value.length > MAX_LABEL) return `Nhãn dài quá ${MAX_LABEL} ký tự.`;
  return /[\u0000-\u001f\u007f-\u009f<>]/.test(value) ? "Nhãn là chữ thường: không dùng < >, không ký tự điều khiển." : null;
}

export interface ItemProblems {
  href: string | null;
  /** A language code → what is wrong with its label. */
  labels: Record<string, string>;
  /** Languages the entry has no label in, and that are not required: the visitor sees the default's text instead. */
  missing: string[];
}

/** Required: the content source language (`vi`) and the default language. Any other language may be empty (it is flagged, not refused). */
export function problemsOf(item: MenuItem, locales: readonly MenuLocale[]): ItemProblems {
  const required = new Set(locales.filter((locale) => locale.isContentSource || locale.isDefault).map((locale) => locale.code));
  const problems: ItemProblems = { href: checkHref(item.href), labels: {}, missing: [] };
  for (const locale of locales) {
    const text = item.labels[locale.code] ?? null;
    const blank = (text ?? "").trim().length === 0;
    if (blank && required.has(locale.code)) problems.labels[locale.code] = `Nhập nhãn ${locale.code}: các ngôn ngữ khác dùng nhãn này khi thiếu.`;
    else if (blank) problems.missing.push(locale.code);
    else if (checkLabel(text) !== null) problems.labels[locale.code] = checkLabel(text)!;
  }
  return problems;
}

export function draftProblems(items: readonly MenuItem[], locales: readonly MenuLocale[]): Map<string, ItemProblems> {
  const result = new Map<string, ItemProblems>();
  for (const item of items) result.set(item.id, problemsOf(item, locales));
  return result;
}

export const hasBlockingProblem = (problems: ItemProblems) => problems.href !== null || Object.keys(problems.labels).length > 0;

// ---------------------------------------------------------------- comparing drafts and the server

/** A draft reduced to what is saved, so "changed?" and "did the server store what I sent?" are one comparison. */
export function fingerprint(items: readonly MenuItem[]): string {
  return JSON.stringify(
    canonical(items).map((item) => [
      item.id, item.parentId, item.placement, item.isEnabled, item.href, item.openInNewTab,
      Object.entries(item.labels).map(([code, text]) => [code, (text ?? "").trim()]).filter(([, text]) => text !== "").sort(([a], [b]) => (a < b ? -1 : 1)),
    ])
  );
}

export interface Changes {
  added: number;
  removed: number;
  edited: number;
}

export function summarizeChanges(base: readonly MenuItem[], draft: readonly MenuItem[]): Changes {
  const before = new Map(base.map((item) => [item.id, fingerprint([item]) + positionOf(base, item.id)]));
  const after = new Map(draft.map((item) => [item.id, fingerprint([item]) + positionOf(draft, item.id)]));
  let edited = 0;
  for (const [id, was] of before) if (after.has(id) && after.get(id) !== was) edited++;
  return { added: [...after.keys()].filter((id) => !before.has(id)).length, removed: [...before.keys()].filter((id) => !after.has(id)).length, edited };
}

const positionOf = (items: readonly MenuItem[], id: string) => {
  const item = find(items, id);
  if (!item) return "";
  const list = siblingsOf(items, id);
  return `@${list.findIndex((other) => other.id === id)}`;
};

// ---------------------------------------------------------------- reading a server refusal back onto the draft

/** `items[3].href` → the draft entry it names and which field. */
export function locateField(field: string | null, items: readonly MenuItem[]): { id: string; prop: string; sub: string | null } | null {
  const match = field ? /^items\[(\d+)\]\.([A-Za-z]+)(?:\.(.+))?$/.exec(field) : null;
  const item = match ? items[Number(match[1])] : undefined;
  return match && item ? { id: item.id, prop: match[2], sub: match[3] ?? null } : null;
}

// ---------------------------------------------------------------- the preview

export interface PreviewNode {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
  children: PreviewNode[];
}

/** What a visitor of `locale` would see: enabled entries only (a disabled parent hides its branch), the label in that language else the default's, else Vietnamese. */
export function previewTree(items: readonly MenuItem[], locale: string, defaultCode: string): { primary: PreviewNode[]; secondary: PreviewNode[] } {
  const build = (item: MenuItem): PreviewNode => ({
    id: item.id,
    label: [item.labels[locale], item.labels[defaultCode], item.labels.vi].find((text) => (text ?? "").trim() !== "")?.trim() ?? "",
    href: item.href,
    newTab: item.openInNewTab,
    children: childrenOf(items, item.id).filter((child) => child.isEnabled).map(build),
  });
  const placed = (placement: MenuPlacement) => items.filter((item) => item.parentId === null && item.placement === placement && item.isEnabled).map(build);
  return { primary: placed("primary"), secondary: placed("secondary") };
}
