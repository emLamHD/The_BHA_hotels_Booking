#!/usr/bin/env node
// Drafts the missing languages of new messages with a LOCAL LibreTranslate, keeping the ICU structure intact.
// It is an authoring aid: the website never calls it, and a draft is not accepted as translated until reviewed.
//
//   node Back_End/tools/i18n/mt-pack.mjs --in seed.json --out adds.json [--report report.json] [--url http://127.0.0.1:5000]
//
// seed.json   { "<key>": { "lang": "vi" | "en", "text": "<message in that language>" } }   (explicit source, never auto-detect)
// adds.json   { "<key>": { "vi": …, "en": …, "fr": … } }  — same shape `merge.py` / the pack merge consumes
// report.json { translated, reused, failed[], review[] }  — `failed` could not be drafted safely (lost/duplicated variable,
//             plural shape not handled) and must be written by hand; `review` = suspicious or price/hold/cancel-critical rows.
//
// How variables survive: LibreTranslate drops `{braces}` and garbles `__0__` markers (see the probe evidence), so each
// argument is replaced by a distinct SAMPLE (a number, or a fake name), the sentence is translated, and the sample is found
// again as a whole token. Not exactly once => the message is reported as failed, never emitted with a missing variable.
// Supported ICU subset: text, `{name}`, `#`, and a message that is exactly one `{n, plural, …}` (see format.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packs = join(here, "../../src/TheBha.Application/Website/Localization/packs");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
if (!args.in || !args.out) throw new Error("usage: mt-pack.mjs --in seed.json --out adds.json [--report report.json] [--url http://127.0.0.1:5000]");
const URL_ = `${args.url ?? "http://127.0.0.1:5000"}/translate`;
const LANGS = ["vi", "en", "fr"];
const glossary = JSON.parse(readFileSync(join(here, "glossary.json"), "utf8"));

// ---- ICU subset ---------------------------------------------------------------------------------------------------
function parse(s) {
  const pos = { i: 0 };
  const nodes = (depth) => {
    const out = [];
    let text = "";
    const flush = () => { if (text) out.push({ k: "t", v: text }); text = ""; };
    while (pos.i < s.length) {
      const c = s[pos.i];
      if (c === "}") { if (!depth) throw new Error("stray }"); break; }
      if (c === "{") {
        flush(); pos.i++;
        let name = ""; while (pos.i < s.length && !",}".includes(s[pos.i])) name += s[pos.i++];
        name = name.trim();
        if (s[pos.i] === "}") { pos.i++; out.push({ k: "a", n: name }); continue; }
        pos.i++;
        let kind = ""; while (s[pos.i] !== ",") kind += s[pos.i++]; pos.i++;
        if (kind.trim() !== "plural") throw new Error("only plural is supported");
        const branches = [];
        for (;;) {
          while (/\s/.test(s[pos.i])) pos.i++;
          if (s[pos.i] === "}") { pos.i++; break; }
          let sel = ""; while (!/[\s{]/.test(s[pos.i])) sel += s[pos.i++];
          while (/\s/.test(s[pos.i])) pos.i++;
          pos.i++; // {
          const body = nodes(depth + 1);
          pos.i++; // }
          branches.push({ sel, body });
        }
        out.push({ k: "p", n: name, branches });
        continue;
      }
      if (c === "#" && depth) { flush(); out.push({ k: "h" }); pos.i++; continue; }
      text += c; pos.i++;
    }
    flush();
    return out;
  };
  const r = nodes(0);
  if (pos.i < s.length) throw new Error("unbalanced braces");
  return r;
}
const NUM_NAME = /^(count|n|num|nights?|guests?|rooms?|adults?|children|max|min|hours?|minutes?|days?|years?|age|step|page|index|total|price|amount|fee|tax|number|quantity|qty)/i;
const FAKE = ["Alvaro", "Bernard", "Cecile", "Dorian", "Esteban", "Fabien"];

// Numbers are sampled as 14, 27, … : the engine spells 1–12 out ("two guests") and spells a sentence-initial number out too,
// which loses the variable; such a branch is reported in `failed` (a short hand-written list), never emitted.
// a "unit" = text with args (and #) replaced by samples, translated once, then mapped back
function sampleFor(nodes, plural) {
  const names = [...new Set(nodes.filter((n) => n.k === "a").map((n) => n.n))];
  const map = new Map(); let num = 14, fake = 0;
  for (const n of names) map.set(n, NUM_NAME.test(n) ? String((num += 13) - 13) : FAKE[fake++ % FAKE.length]);
  if (plural) map.set("#", String(plural));
  return map;
}
function toSampleText(nodes, samples) {
  return nodes.map((n) => (n.k === "t" ? n.v : n.k === "a" ? samples.get(n.n) : samples.get("#"))).join("");
}
function fromSampleText(out, samples) {
  let r = out;
  for (const [name, sample] of samples) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}.,])${sample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}]|[.,]\\d)`, "gu");
    const hits = r.match(re) ?? [];
    if (hits.length !== 1) return null;
    r = r.replace(re, name === "#" ? "#" : `{${name}}`);
  }
  return r;
}

// ---- LibreTranslate -------------------------------------------------------------------------------------------------
const stats = { calls: 0, items: 0, ms: 0 };
async function lt(list, source, target) {
  if (!list.length) return [];
  const t0 = Date.now();
  const res = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: list, source, target, format: "text" }) });
  if (!res.ok) throw new Error(`LibreTranslate ${res.status}: ${await res.text()}`);
  const out = (await res.json()).translatedText;
  if (!Array.isArray(out) || out.length !== list.length) throw new Error("response not aligned with the request");
  stats.calls++; stats.items += list.length; stats.ms += Date.now() - t0;
  return out;
}
// Short labels are mistranslated without sentence punctuation ("Địa chỉ email" -> "Chile", probe evidence): add "." and drop it again.
const dot = (s) => (/\S+(\s+\S+){0,2}$/.test(s.trim()) && !/[.!?:…]$/.test(s.trim()) ? [s + ".", true] : [s, false]);
const FR_PUNCT = (t) => t.replace(/ ([:;?!»])/g, " $1").replace(/« /g, "« ");

// ---- work ---------------------------------------------------------------------------------------------------------------
const seed = JSON.parse(readFileSync(args.in, "utf8"));
const existing = Object.fromEntries(LANGS.map((l) => {
  const p = JSON.parse(readFileSync(join(packs, `${l}.json`), "utf8"));
  return [l, { ...p.messages.shared, ...p.messages.customer, ...p.messages.admin, ...p.content }];
}));
const memory = new Map(); // translation memory: (source lang, text) -> {lang: text}, built from the packs already reviewed
for (const key of Object.keys(existing.vi)) {
  const row = Object.fromEntries(LANGS.map((l) => [l, existing[l][key]]));
  if (LANGS.every((l) => row[l])) for (const l of LANGS) memory.set(`${l}\u0000${row[l]}`, row);
}

async function draft(seed, targets) {
const adds = {}, failed = [], review = [], reused = [];
const jobs = []; // {key, target, src, nodes plan}
for (const [key, { lang, text }] of Object.entries(seed)) {
  if (!LANGS.includes(lang)) throw new Error(`${key}: lang must be one of ${LANGS}`);
  const row = { [lang]: text };
  const known = memory.get(`${lang}\u0000${text}`);
  if (known) { adds[key] = { ...known }; reused.push(key); continue; }
  adds[key] = row;
  let nodes;
  try { nodes = parse(text); } catch (e) { failed.push({ key, reason: `source not valid: ${e.message}` }); continue; }
  const plurals = nodes.filter((n) => n.k === "p");
  const nested = plurals.some((p) => p.branches.some((b) => b.body.some((n) => n.k === "p")));
  const shape = plurals.length === 0 ? "flat" : plurals.length === 1 && !nested ? "plural" : null;
  if (!shape) { failed.push({ key, reason: "more than one plural in a message: write by hand" }); continue; }
  for (const target of targets.filter((l) => l !== lang)) {
    const hit = glossary[`${lang}>${target}`]?.[text];
    if (hit) { row[target] = hit; continue; }
    if (shape === "flat") jobs.push({ key, lang, target, shape, nodes, sample: sampleFor(nodes) });
    else jobs.push({ key, lang, target, shape, nodes, node: plurals[0] });
  }
}

// expand plural jobs into per-branch units
const units = []; // {job, branchSel?, nodes, samples, input, dotted}
for (const job of jobs) {
  if (job.shape === "flat") { addUnit(job, null, job.nodes, job.sample); continue; }
  const p = job.node;
  const cats = new Intl.PluralRules(job.target).resolvedOptions().pluralCategories.filter((c) => c !== "many" && c !== "zero" && c !== "two" && c !== "few");
  const exact = p.branches.filter((b) => b.sel.startsWith("="));
  const sourceBy = (c) => p.branches.find((b) => b.sel === c) ?? p.branches.find((b) => b.sel === "other");
  if (!sourceBy("other")) { failed.push({ key: job.key, reason: "plural without other" }); continue; }
  job.plural = { name: p.n, parts: [] };
  // The whole sentence is translated once per plural form (text around the plural included), so the result is
  // `{n, plural, one {<whole sentence>} other {<whole sentence>}}` — what the formatter takes and the translator reads.
  const whole = (b) => job.nodes.flatMap((n) => (n === p ? b.body : [n]));
  for (const b of exact) addUnit(job, b.sel, whole(b), sampleFor(whole(b)));
  for (const c of cats) { const b = sourceBy(c); const n = c === "one" ? 1 : 14; addUnit(job, c, whole(b), sampleFor(whole(b), n), n); }
}
// Domain terms the engine renders badly ("chỗ nghỉ" -> "rest"): the source term is replaced by the target term itself before
// translating (a word of the target language inside the sentence stays as it is). One reviewed list, glossary.json "terms".
function withTerms(text, lang, target) {
  const terms = Object.entries(glossary.terms?.[lang] ?? {}).sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [term, to] of terms) {
    if (!to[target]) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"), to[target]);
  }
  return out;
}
function addUnit(job, sel, nodes, samples, n) {
  const raw = job.target === "en" ? withTerms(toSampleText(nodes, samples), job.lang, "en") : toSampleText(nodes, samples);
  const [input, dotted] = dot(raw);
  units.push({ job, sel, samples, input, dotted, n });
}

const byPair = new Map();
for (const u of units) { const k = `${u.job.lang}>${u.job.target}`; (byPair.get(k) ?? byPair.set(k, []).get(k)).push(u); }
for (const [pair, list] of byPair) {
  const [s, t] = pair.split(">");
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    const out = await lt(chunk.map((u) => u.input), s, t);
    chunk.forEach((u, j) => {
      let r = out[j].trim();
      if (u.dotted && r.endsWith(".")) r = r.slice(0, -1);
      u.output = t === "fr" ? FR_PUNCT(r) : r;
    });
  }
}

// A sentence that starts with its number gets the number spelled out ("1 khách" -> "a guest"). A short carrier in front
// of it keeps the digits; the carrier is cut off again at its colon. Only used for units that lost their variable.
const CARRIER = { vi: "Tổng cộng: ", en: "Total: ", fr: "Total : " };
{
  const lost = units.filter((u) => fromSampleText(u.output, u.samples) === null && !u.input.includes(":"));
  const retryPairs = new Map();
  for (const u of lost) { const k = `${u.job.lang}>${u.job.target}`; (retryPairs.get(k) ?? retryPairs.set(k, []).get(k)).push(u); }
  for (const [pair, list] of retryPairs) {
    const [s, t] = pair.split(">");
    for (let i = 0; i < list.length; i += 25) {
      const chunk = list.slice(i, i + 25);
      const out = await lt(chunk.map((u) => CARRIER[s] + u.input), s, t);
      chunk.forEach((u, j) => {
        let cut = out[j].replace(/^[^:]*:\s*/, "").trim();
        if (/^\p{Lu}/u.test(u.input) && /^\p{Ll}/u.test(cut)) cut = cut[0].toUpperCase() + cut.slice(1);
        const text = t === "fr" ? FR_PUNCT(u.dotted && cut.endsWith(".") ? cut.slice(0, -1) : cut) : (u.dotted && cut.endsWith(".") ? cut.slice(0, -1) : cut);
        if (fromSampleText(text, u.samples) !== null) u.output = text;
      });
    }
  }
}

const results = new Map(); // `${key}>${target}` -> {text, parts}
for (const u of units) {
  const id = `${u.job.key}>${u.job.target}`;
  const back = fromSampleText(u.output, u.samples);
  const entry = results.get(id) ?? results.set(id, { job: u.job, parts: [], bad: null }).get(id);
  if (back === null) { entry.bad = `variable lost or duplicated in "${u.output}"`; continue; }
  entry.parts.push({ sel: u.sel, text: back });
}
for (const { job, parts, bad } of results.values()) {
  if (bad) { failed.push({ key: job.key, target: job.target, reason: bad }); delete adds[job.key][job.target]; continue; }
  adds[job.key][job.target] = job.shape === "flat" ? parts[0].text
    : `{${job.node.n}, plural, ${parts.map((p) => `${p.sel} {${p.text}}`).join(" ")}}`;
}

// ---- review list: back-translation score + short strings + price/hold/cancel-critical ---------------------------------
const CRITICAL = /(price|total|hold|cancel|confirm|pay|receipt|deposit|refund|policy|expire|error|fail|giá|giữ|hủy|xác nhận|thanh toán|hoàn|chính sách|hết hạn|lỗi)/i;
const words = (s) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 1));
const jacc = (a, b) => { const A = words(a), B = words(b); const i = [...A].filter((w) => B.has(w)).length; return A.size + B.size - i ? i / (A.size + B.size - i) : 1; };
const strip = (m) => m.replace(/\{[^}]*\}/g, " ").replace(/#/g, " ");
const checks = [];
for (const [key, row] of Object.entries(adds)) {
  const lang = seed[key].lang;
  for (const target of targets.filter((l) => l !== lang && row[l])) {
    if (reused.includes(key) || glossary[`${lang}>${target}`]?.[seed[key].text]) continue;
    checks.push({ key, lang, target, source: strip(seed[key].text), draft: strip(row[target]) });
  }
}
const backPairs = new Map();
for (const c of checks) { const k = `${c.target}>${c.lang}`; (backPairs.get(k) ?? backPairs.set(k, []).get(k)).push(c); }
for (const [pair, list] of backPairs) {
  const [s, t] = pair.split(">");
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    const out = await lt(chunk.map((c) => c.draft || "."), s, t);
    chunk.forEach((c, j) => { c.back = out[j]; c.score = jacc(c.source, c.back); });
  }
}
for (const c of checks) {
  const reasons = [];
  if (c.score < 0.34) reasons.push(`back-translation differs (${c.score.toFixed(2)}: "${c.back}")`);
  if (words(c.source).size <= 2) reasons.push("short label");
  if (CRITICAL.test(c.source) || CRITICAL.test(c.key)) reasons.push("price/hold/cancel/confirm/pay/error text");
  if (reasons.length) review.push({ key: c.key, target: c.target, source: seed[c.key].text, draft: adds[c.key][c.target], reasons });
}

for (const [key, row] of Object.entries(adds)) for (const l of LANGS) if (!row[l]) { /* incomplete rows are not emitted */ }
  return { adds, failed, review, reused };
}

// English first (from vi, with the reviewed domain terms), then French FROM THE ENGLISH TEXT: an explicit source for every pair,
// and the engine renders French far better from English than from Vietnamese for this vocabulary.
const A = await draft(seed, ["vi", "en"]);
const seedB = {};
for (const [key, row] of Object.entries(A.adds)) if (row.en && !row.fr) seedB[key] = { lang: "en", text: row.en };
const B = await draft(seedB, ["fr"]);
for (const [key, row] of Object.entries(B.adds)) if (row.fr) A.adds[key].fr = row.fr;
const adds = A.adds, reused = A.reused;
const failed = [...A.failed, ...B.failed.filter((f) => !A.failed.some((x) => x.key === f.key))];
const review = [...A.review, ...B.review];
const complete = Object.fromEntries(Object.entries(adds).filter(([, r]) => LANGS.every((l) => r[l])));
writeFileSync(args.out, JSON.stringify(complete, null, 1) + "\n");
const report = { total: Object.keys(seed).length, emitted: Object.keys(complete).length, reused: reused.length, translatedUnits: stats.items, ltCalls: stats.calls, ltMs: stats.ms, failed, review };
if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ ...report, failed: report.failed.length, review: report.review.length }));
