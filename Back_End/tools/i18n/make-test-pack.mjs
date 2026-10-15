#!/usr/bin/env node
// Writes a TEST language pack (not a translation): every text of the English pack carries an obvious marker so a copy is
// detectable on screen, and texts with variables / plural forms are kept exactly as they are so the pack stays valid ICU.
// It exists to prove, in a real browser, that a language the code has never heard of can be installed from the Admin with no
// code, build or restart — never to be shipped as a language.
//   node Back_End/tools/i18n/make-test-pack.mjs <locale> "<English name>" "<native name>" <currency> <out.json> [marker]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [locale, displayName, nativeName, currency, out, markerArg] = process.argv.slice(2);
if (!locale || !displayName || !nativeName || !currency || !out) throw new Error("usage: make-test-pack.mjs <locale> <name> <native name> <currency> <out.json> [marker]");
const marker = markerArg ?? `[${locale.toUpperCase()}]`;
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../src/TheBha.Application/Website/Localization/packs");
const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
const mark = (text) => (text.includes("{") ? text : `${marker} ${text}`);
const pack = {
  schema: "bha.language-pack/1",
  locale,
  displayName,
  nativeName,
  direction: "ltr",
  formatLocale: locale,
  defaultCurrency: currency,
  pack: { id: `test.${locale}`, version: "1" },
  referenceLocale: "vi",
  messages: Object.fromEntries(Object.entries(en.messages).map(([scope, texts]) => [scope, Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, mark(text)]))])),
  content: Object.fromEntries(Object.entries(en.content).map(([key, text]) => [key, mark(text)])),
};
writeFileSync(out, JSON.stringify(pack, null, 1) + "\n");
console.log(`${out}: ${Object.values(pack.messages).reduce((n, texts) => n + Object.keys(texts).length, 0)} messages, ${Object.keys(pack.content).length} content texts`);
