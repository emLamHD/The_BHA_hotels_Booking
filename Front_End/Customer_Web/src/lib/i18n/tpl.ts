import { createElement, type ReactElement } from "react";
import { Tpl } from "./Tpl";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the template pages' boilerplate (a filter's option names, a section's sentence, a sample
 * plan's feature line). These texts live in module-level data next to the layout that shows them, so they cannot call `t()`
 * where they are written. `tpl("English text")` writes the text in place and returns an element that shows the visitor's
 * language when it renders. The pack key is derived from the source text (`customer.tpl.<hash>`), the way gettext keys by
 * its msgid: change the source text and the key changes with it, so the Admin sees the old translation as missing, never as
 * silently wrong. A text without a key in the pack is shown as written (and counted as missing in the Admin).
 */
export function tplKey(text: string): string {
  // FNV-1a over the UTF-16 code units of the NFC text: small, stable, and identical on the server and in the browser.
  let hash = 0x811c9dc5;
  const normalized = text.normalize("NFC");
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `customer.tpl.${hash.toString(16).padStart(8, "0")}`;
}

/** The template text as an element; usable in server and client modules alike, wherever a ReactNode is accepted. */
export const tpl = (text: string): ReactElement => createElement(Tpl, { text });
