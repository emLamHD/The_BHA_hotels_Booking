/**
 * CUST-WEB-HEADER-001-CP04: the header navigation as the API serves it (`GET /api/v1/website/menus`) — the one source of
 * the desktop header and the mobile drawer. Nothing in code lists a menu entry: the Admin owns the tree.
 */
export interface MenuNode {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
  children: MenuNode[];
}

export interface MenuSnapshot {
  revision: string;
  /** The language the labels are in (the API's resolution of the visitor's choice). */
  locale: string;
  /** When the API read the menu (ms since epoch, the API's clock): answers are ordered by it, whatever order they arrive in. */
  generatedAt: number;
  primary: MenuNode[];
  secondary: MenuNode[];
}

/**
 * The same link rules the API enforces, repeated here because a stored link is rendered into the page: React 18 still
 * renders a `javascript:` href. An internal path, a `#` fragment or an `https://` address — nothing else, no
 * protocol-relative `//`, no backslash, whitespace or control character, in the link or in what it decodes to.
 */
export function isSafeMenuHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length === 0 || href.length > 2048) return false;
  if (/[\s\u0000-\u001f\u007f-\u009f\\]/.test(href)) return false;
  let decoded = href;
  for (let round = 0; round < 3; round++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return false;
    }
    if (next === decoded) break;
    decoded = next;
    if (/[\u0000-\u001f\u007f-\u009f\\]/.test(decoded)) return false;
  }
  if (href[0] === "#") return href.indexOf("#", 1) === -1;
  if (href[0] === "/") return !href.startsWith("//") && !decoded.startsWith("//");
  if (/^https:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }
  return false;
}

/** An external link (leaves this site): rendered as a plain anchor, not a router link. */
export const isExternalHref = (href: string) => /^https:\/\//i.test(href);

function parseNodes(value: unknown, depth: number): MenuNode[] {
  if (!Array.isArray(value) || depth > 4) return [];
  const nodes: MenuNode[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.label !== "string" || item.label.trim() === "" || !isSafeMenuHref(item.href)) continue;
    nodes.push({ id: item.id, label: item.label, href: item.href, newTab: item.newTab === true, children: parseNodes(item.children, depth + 1) });
  }
  return nodes;
}

/** The API's answer as a snapshot, or null when it is not one (a proxy's error page, an older API). An entry that fails the link rules is dropped with its branch. */
export function parseMenu(json: unknown): MenuSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const generatedAt = typeof body.generatedAtUtc === "string" ? Date.parse(body.generatedAtUtc) : NaN;
  if (typeof body.revision !== "string" || typeof body.locale !== "string" || Number.isNaN(generatedAt)) return null;
  if (!Array.isArray(body.primary) || !Array.isArray(body.secondary)) return null;
  return { revision: body.revision, locale: body.locale, generatedAt, primary: parseNodes(body.primary, 1), secondary: parseNodes(body.secondary, 1) };
}

/**
 * Whether `next` may replace `current`. Never an answer for another language than the one on screen (a slow answer after a
 * language switch); within a language never an older answer over a newer one (answers can arrive out of order); a language
 * change is the one case a new answer wins without being newer, because the labels it replaces are in the wrong language.
 */
export function shouldAcceptMenu(current: MenuSnapshot | null, next: MenuSnapshot, activeLocale: string): boolean {
  if (next.locale !== activeLocale) return false;
  if (!current || current.locale !== next.locale) return true;
  return next.generatedAt > current.generatedAt;
}
