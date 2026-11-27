import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

/**
 * A just-enough DOM for `react-dom/client` in the node test environment (the project has no jsdom and a dependency is not added for one test). It supports what the pages
 * under test render: elements, text, attributes, and the form controls of the arrival form. It is a test aid, not a browser: nothing here is layout, focus or events.
 */
class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  value = "";
  checked = false;
  disabled = false;
  nodeValue: string | null = null;
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: FakeDocument | null) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const siblings = this.parentNode?.childNodes ?? []; return siblings[siblings.indexOf(this) + 1] ?? null; }
  get tagName() { return this.nodeName; }
  get namespaceURI() { return "http://www.w3.org/1999/xhtml"; }
  get options() { return this.childNodes.filter((child) => child.nodeName === "OPTION"); }
  get selectedIndex() { return this.options.findIndex((option) => option.attributes.value === this.value); }
  get textContent(): string { return this.nodeType === 3 ? (this.nodeValue ?? "") : this.childNodes.map((child) => child.textContent).join(""); }
  set textContent(text: string) { this.childNodes.forEach((child) => { child.parentNode = null; }); this.childNodes = []; if (text !== "") this.appendChild(this.ownerDocument!.createTextNode(text)); }
  appendChild(child: FakeNode) { return this.insertBefore(child, null); }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child);
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: FakeNode) { this.childNodes = this.childNodes.filter((c) => c !== child); child.parentNode = null; return child; }
  setAttribute(name: string, value: string) { this.attributes[name] = String(value); }
  removeAttribute(name: string) { delete this.attributes[name]; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  hasAttribute(name: string) { return name in this.attributes; }
  addEventListener() {}
  removeEventListener() {}
  get defaultValue() { return this.attributes.value ?? ""; }
  set defaultValue(value: string) { this.attributes.value = value; }
  /** The markup the tree would show (attributes sorted out; only for assertions). */
  get outerHTML(): string {
    if (this.nodeType === 3) return this.nodeValue ?? "";
    const attrs = Object.entries(this.attributes).map(([k, v]) => ` ${k}="${v}"`).join("");
    return `<${this.nodeName.toLowerCase()}${attrs}>${this.childNodes.map((child) => child.outerHTML).join("")}</${this.nodeName.toLowerCase()}>`;
  }
}

class FakeDocument extends FakeNode {
  activeElement: FakeNode | null = null;
  body: FakeNode;
  constructor() {
    super(9, "#document", null);
    this.ownerDocument = this;
    this.body = this.createElement("body");
    this.activeElement = this.body;
  }
  createElement(name: string) { return new FakeNode(1, name.toUpperCase(), this); }
  createElementNS(_ns: string, name: string) { return this.createElement(name); }
  createTextNode(text: string) { const node = new FakeNode(3, "#text", this); node.nodeValue = text; return node; }
}

export interface MiniDom {
  container: FakeNode;
  root: Root;
  render: (node: ReactNode) => void;
  html: () => string;
  restore: () => void;
}

const GLOBALS = ["document", "window", "HTMLIFrameElement", "IS_REACT_ACT_ENVIRONMENT"] as const;

/** Installs the fake DOM on `globalThis` (restored by `restore()`), and returns a root to render into. `window` is a plain object: tests give it `location`/`history` if the code under test reads them. */
export function mountMiniDom(extraWindow: Record<string, unknown> = {}): MiniDom {
  const g = globalThis as Record<string, unknown>;
  const saved = GLOBALS.map((name) => [name, g[name], name in g] as const);
  const document = new FakeDocument();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const win: Record<string, unknown> = { document, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, ...extraWindow };
  g.document = document;
  g.window = win;
  g.HTMLIFrameElement = win.HTMLIFrameElement;
  g.IS_REACT_ACT_ENVIRONMENT = false; // never `act`: the tests order commit, layout effects and passive effects themselves
  const root = createRoot(container as unknown as Element);
  return {
    container,
    root,
    render: (node) => root.render(node),
    html: () => container.outerHTML,
    restore: () => {
      root.unmount();
      for (const [name, value, had] of saved) { if (had) g[name] = value; else delete g[name]; }
    },
  };
}
