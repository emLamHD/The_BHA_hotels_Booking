#!/usr/bin/env node
// Regenerates (or --check verifies) src/TheBha.Application/Website/Localization/catalog.json from the built-in
// reference pack. The catalog is language-neutral: key, scope (its namespace) and the placeholders the key declares
// (read from the reference text); `context` is an optional English note for translators and is preserved.
//   node Back_End/tools/i18n/catalog.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../src/TheBha.Application/Website/Localization");
const reference = JSON.parse(readFileSync(join(dir, "packs/vi.json"), "utf8"));
const previous = (() => { try { return JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8")); } catch { return { messages: [] }; } })();
const context = new Map(previous.messages.map((m) => [m.key, m.context]));

function variables(text) {
  const names = new Set();
  const scan = (s, i, depth) => {
    while (i < s.length) {
      const c = s[i];
      if (c === "}") return depth ? i : (() => { throw new Error("stray } in " + s); })();
      if (c === "{") {
        let j = i + 1; while (j < s.length && s[j] !== "," && s[j] !== "}") j++;
        names.add(s.slice(i + 1, j).trim());
        if (s[j] === "}") { i = j + 1; continue; }
        j++; while (s[j] !== ",") j++; j++;
        for (;;) {
          while (/\s/.test(s[j])) j++;
          if (s[j] === "}") { i = j + 1; break; }
          while (!/\s|\{/.test(s[j])) j++;
          while (/\s/.test(s[j])) j++;
          j = scan(s, j + 1, depth + 1) + 1;
        }
        continue;
      }
      i++;
    }
    return i;
  };
  scan(text, 0, 0);
  return [...names].sort();
}

const messages = [];
for (const scope of ["shared", "customer", "admin"]) {
  for (const [key, text] of Object.entries(reference.messages[scope] ?? {})) {
    if (!key.startsWith(scope + ".")) throw new Error(`${key} is not in the ${scope} namespace`);
    const entry = { key, scope, placeholders: variables(text) };
    if (context.get(key)) entry.context = context.get(key);
    messages.push(entry);
  }
}
// Static content of the site (posts, offers, the hero, the navigation, the booking guide) is part of what a language must cover.
// A stored-content field of the database (a property, a room type, a rate plan, an amenity, a picture) is NOT listed here: those
// are required only while the entity exists, and the server reads them from the database.
const STORED = new Set(["property", "roomType", "ratePlan", "amenity", "media", "menuItem"]);
for (const [key, text] of Object.entries(reference.content ?? {})) {
  const entity = key.split(".")[1];
  if (!key.startsWith("content.") || STORED.has(entity)) continue;
  const entry = { key, scope: "content", placeholders: variables(text) };
  if (context.get(key)) entry.context = context.get(key);
  messages.push(entry);
}
messages.sort((a, b) => a.key.localeCompare(b.key, "en"));
const text = JSON.stringify({ schema: "bha.message-catalog/1", messages }, null, 1) + "\n";
if (process.argv.includes("--check")) {
  const current = readFileSync(join(dir, "catalog.json"), "utf8");
  if (current !== text) { console.error("catalog.json is out of date: run node Back_End/tools/i18n/catalog.mjs"); process.exit(1); }
  console.log(`catalog.json is current (${messages.length} messages)`);
} else {
  writeFileSync(join(dir, "catalog.json"), text);
  console.log(`catalog.json written (${messages.length} messages)`);
}
