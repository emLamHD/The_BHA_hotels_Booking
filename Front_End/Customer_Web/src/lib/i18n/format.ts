/**
 * CUST-WEB-HEADER-001-CP02-C2: the message formatter. Messages are an ICU MessageFormat SUBSET, so a full
 * sentence with parameters and plural forms is ONE translatable unit and no translated fragments are ever
 * concatenated:
 *
 *   plain text · `{name}` · `{count, plural, =0 {…} one {…} other {…}}` (`other` required, `#` = the number)
 *
 * An apostrophe is always a literal (French needs it everywhere); a literal brace is not supported. Plural
 * categories come from `Intl.PluralRules` for the message's locale — never from a per-language table in code — so a
 * language added later needs no code. This file is identical in Customer_Web and Admin_Web (a test compares them) and
 * both run the shared vectors in `Back_End/src/TheBha.Application/Website/Localization/icu-vectors.json`, which the C#
 * validator also runs, so the three cannot disagree about what a message means.
 */

export type MessageParams = Record<string, string | number | undefined>;

type Node =
  | { kind: "text"; text: string }
  | { kind: "arg"; name: string }
  | { kind: "hash" }
  | { kind: "plural"; name: string; branches: { selector: string; nodes: Node[] }[] };

const SELECTORS = new Set(["zero", "one", "two", "few", "many", "other"]);
const cache = new Map<string, Node[] | null>();

class ParseError extends Error {}

function isName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name);
}

function parseNodes(source: string, position: { i: number }, depth: number): Node[] {
  const nodes: Node[] = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push({ kind: "text", text });
    text = "";
  };
  while (position.i < source.length) {
    const c = source[position.i];
    if (c === "}") {
      if (depth === 0) throw new ParseError("stray }");
      break;
    }
    if (c === "{") {
      flush();
      position.i++;
      nodes.push(parseArgument(source, position, depth));
      continue;
    }
    if (c === "#" && depth > 0) {
      flush();
      nodes.push({ kind: "hash" });
      position.i++;
      continue;
    }
    text += c;
    position.i++;
  }
  flush();
  if (depth > 0 && source[position.i] !== "}") throw new ParseError("unclosed {");
  return nodes;
}

function parseArgument(source: string, position: { i: number }, depth: number): Node {
  const start = position.i;
  while (position.i < source.length && source[position.i] !== "," && source[position.i] !== "}") position.i++;
  if (position.i >= source.length) throw new ParseError("unclosed {");
  const name = source.slice(start, position.i).trim();
  if (!isName(name)) throw new ParseError(`bad placeholder ${name}`);
  if (source[position.i] === "}") {
    position.i++;
    return { kind: "arg", name };
  }
  position.i++; // ","
  const typeStart = position.i;
  while (position.i < source.length && source[position.i] !== ",") position.i++;
  if (position.i >= source.length || source.slice(typeStart, position.i).trim() !== "plural") throw new ParseError("only plural is supported");
  position.i++; // ","
  const branches: { selector: string; nodes: Node[] }[] = [];
  const seen = new Set<string>();
  for (;;) {
    while (position.i < source.length && /\s/.test(source[position.i])) position.i++;
    if (position.i >= source.length) throw new ParseError("unclosed {");
    if (source[position.i] === "}") {
      position.i++;
      break;
    }
    const selectorStart = position.i;
    while (position.i < source.length && !/\s/.test(source[position.i]) && source[position.i] !== "{") position.i++;
    const selector = source.slice(selectorStart, position.i);
    if (!SELECTORS.has(selector) && !/^=\d+$/.test(selector)) throw new ParseError(`bad plural form ${selector}`);
    if (seen.has(selector)) throw new ParseError(`duplicate plural form ${selector}`);
    seen.add(selector);
    while (position.i < source.length && /\s/.test(source[position.i])) position.i++;
    if (source[position.i] !== "{") throw new ParseError("plural form needs {text}");
    position.i++;
    const nodes = parseNodes(source, position, depth + 1);
    position.i++; // "}"
    branches.push({ selector, nodes });
  }
  if (!seen.has("other")) throw new ParseError("plural needs other");
  return { kind: "plural", name, branches };
}

/** The parse tree, or `null` when the message is not valid (it is then shown as written). */
function parse(message: string): Node[] | null {
  const hit = cache.get(message);
  if (hit !== undefined) return hit;
  let nodes: Node[] | null;
  try {
    const position = { i: 0 };
    nodes = parseNodes(message, position, 0);
    if (position.i < message.length) nodes = null;
  } catch {
    nodes = null;
  }
  cache.set(message, nodes);
  return nodes;
}

/** Names of the variables a valid message uses (empty for an invalid one). */
export function messageVariables(message: string): string[] {
  const nodes = parse(message);
  const names = new Set<string>();
  const walk = (list: Node[]) => {
    for (const node of list) {
      if (node.kind === "arg") names.add(node.name);
      if (node.kind === "plural") {
        names.add(node.name);
        node.branches.forEach((branch) => walk(branch.nodes));
      }
    }
  };
  if (nodes) walk(nodes);
  return Array.from(names).sort();
}

export function isValidMessage(message: string): boolean {
  return parse(message) !== null;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function numberFormat(locale: string): Intl.NumberFormat {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format;
}

function pluralRule(locale: string): Intl.PluralRules {
  let rule = pluralRules.get(locale);
  if (!rule) {
    rule = new Intl.PluralRules(locale);
    pluralRules.set(locale, rule);
  }
  return rule;
}

function render(nodes: Node[], params: MessageParams, locale: string, hash: number | null): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") out += node.text;
    else if (node.kind === "hash") out += hash === null ? "#" : numberFormat(locale).format(hash);
    else if (node.kind === "arg") {
      const value = params[node.name];
      out += value === undefined ? `{${node.name}}` : typeof value === "number" ? numberFormat(locale).format(value) : value;
    } else {
      const raw = params[node.name];
      const n = typeof raw === "number" ? raw : Number(raw);
      if (raw === undefined || Number.isNaN(n)) {
        out += `{${node.name}}`;
        continue;
      }
      const exact = node.branches.find((branch) => branch.selector === `=${n}`);
      const category = pluralRule(locale).select(n);
      const chosen = exact ?? node.branches.find((branch) => branch.selector === category) ?? node.branches.find((branch) => branch.selector === "other")!;
      out += render(chosen.nodes, params, locale, n);
    }
  }
  return out;
}

/** Formats `message` for `locale`. An invalid message is returned as written (and is rejected by the server on import). */
export function formatMessage(message: string, locale: string, params: MessageParams = {}): string {
  const nodes = parse(message);
  return nodes === null ? message : render(nodes, params, locale, null);
}
