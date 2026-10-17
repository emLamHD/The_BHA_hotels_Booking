/**
 * CUST-WEB-HERO-001-CP01: the hero editor's draft, free of React so it can be tested. The draft lives only on the screen until Save; every
 * operation returns a new draft or says why it cannot (never silently). The rules repeat the server's (`HeroRules`), which stays the
 * authority: they exist to explain a problem beside the field before a request is made.
 */
import type { HeroFontKey } from "@/lib/website/heroFonts";
import { HERO_FONT_KEYS } from "@/lib/website/heroFonts";
import type { HeroDraftBody, HeroMedia, HeroSlide, HeroTexts, LocalizedText, MenuLocale, WebsiteHero } from "@/lib/api/website";

export const MIN_SLIDES = 1;
export const MAX_SLIDES = 10;
export const MIN_INTERVAL_SECONDS = 3;
export const MAX_INTERVAL_SECONDS = 60;
export const DEFAULT_FOCAL = "50% 50%";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const SHARED_FIELDS = ["title", "description", "primaryAction", "secondaryAction"] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];
// Short on purpose: the Customer's hero has a fixed height, so a long text would be cut by the picture's frame (it also clamps).
export const MAX_LENGTH = { title: 80, description: 160, primaryAction: 24, secondaryAction: 24, alt: 200, caption: 60 } as const;

export interface HeroDraft {
  fontKey: HeroFontKey;
  autoplayEnabled: boolean;
  /** What the operator typed: validated as a whole number of seconds only when it is read. */
  interval: string;
  texts: HeroTexts;
  slides: HeroSlide[];
}

const copyText = (text: LocalizedText): LocalizedText => ({ ...text });

export function draftOf(hero: WebsiteHero): HeroDraft {
  return {
    fontKey: hero.fontKey,
    autoplayEnabled: hero.autoplayEnabled,
    interval: String(hero.intervalSeconds),
    texts: {
      title: copyText(hero.texts.title), description: copyText(hero.texts.description),
      primaryAction: copyText(hero.texts.primaryAction), secondaryAction: copyText(hero.texts.secondaryAction),
    },
    slides: hero.slides.map((slide) => ({ ...slide, alt: copyText(slide.alt), caption: copyText(slide.caption) })),
  };
}

/** Two drafts with the same fingerprint have nothing different to save. Empty and missing texts are the same (the server clears an empty one). */
export function fingerprint(draft: HeroDraft): string {
  const norm = (text: LocalizedText) => Object.entries(text).map(([code, value]) => [code, (value ?? "").trim()] as const).filter(([, value]) => value !== "").sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    f: draft.fontKey, a: draft.autoplayEnabled, i: draft.interval.trim(),
    t: SHARED_FIELDS.map((field) => norm(draft.texts[field])),
    s: draft.slides.map((slide) => [slide.id, slide.mediaId, slide.focalPosition, norm(slide.alt), norm(slide.caption)]),
  });
}

/** Whole seconds 3–60, typed as digits only; `null` for anything else (a decimal, a sign, a unit, a blank). */
export function parseInterval(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  return seconds >= MIN_INTERVAL_SECONDS && seconds <= MAX_INTERVAL_SECONDS ? seconds : null;
}

export const intervalProblem = (text: string): string | null =>
  parseInterval(text) === null ? `Nhập số giây nguyên từ ${MIN_INTERVAL_SECONDS} đến ${MAX_INTERVAL_SECONDS} (ví dụ 6).` : null;

/** The plain-text rule: 1 to `max` characters once trimmed, no `<` `>`, no control characters (a new line included). */
export function textProblem(value: string | null, max: number): string | null {
  const text = (value ?? "").trim();
  if (text === "") return "Nhập nội dung.";
  if (text.length > max) return `Dài ${text.length}/${max} ký tự: hãy rút gọn.`;
  return /[<>\u0000-\u001f\u007f-\u009f]/.test(text) ? "Chỉ là chữ thường: không dùng < >, không xuống dòng." : null;
}

export const isRequiredLocale = (locale: MenuLocale) => locale.isContentSource || locale.isDefault;

export interface HeroProblems {
  fontKey: string | null;
  interval: string | null;
  slides: string | null;
  /** field → language → problem */
  texts: Record<SharedField, Record<string, string>>;
  /** slide id → part → language → problem */
  slideTexts: Record<string, { alt: Record<string, string>; caption: Record<string, string> }>;
  /** How many things stop a Save. */
  blocking: number;
}

function textProblems(labels: LocalizedText, max: number, locales: MenuLocale[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of locales) {
    const value = labels[locale.code] ?? null;
    const empty = (value ?? "").trim() === "";
    if (empty && !isRequiredLocale(locale)) continue;
    const problem = textProblem(value, max);
    if (problem) out[locale.code] = problem;
  }
  return out;
}

export function draftProblems(draft: HeroDraft, locales: MenuLocale[]): HeroProblems {
  const texts = Object.fromEntries(SHARED_FIELDS.map((field) => [field, textProblems(draft.texts[field], MAX_LENGTH[field], locales)])) as HeroProblems["texts"];
  const slideTexts: HeroProblems["slideTexts"] = {};
  for (const slide of draft.slides) {
    slideTexts[slide.id] = { alt: textProblems(slide.alt, MAX_LENGTH.alt, locales), caption: textProblems(slide.caption, MAX_LENGTH.caption, locales) };
  }
  const fontKey = HERO_FONT_KEYS.includes(draft.fontKey) ? null : "Hãy chọn một font trong danh sách.";
  const interval = intervalProblem(draft.interval);
  const slides = draft.slides.length < MIN_SLIDES ? "Cần ít nhất 1 ảnh." : draft.slides.length > MAX_SLIDES ? `Tối đa ${MAX_SLIDES} ảnh.` : null;
  const count = (map: Record<string, string>) => Object.keys(map).length;
  const blocking =
    (fontKey ? 1 : 0) + (interval ? 1 : 0) + (slides ? 1 : 0) +
    SHARED_FIELDS.reduce((sum, field) => sum + count(texts[field]), 0) +
    Object.values(slideTexts).reduce((sum, item) => sum + count(item.alt) + count(item.caption), 0);
  return { fontKey, interval, slides, texts, slideTexts, blocking };
}

/** The body of a Save, or `null` while the interval is not a usable number. */
export function toBody(draft: HeroDraft): HeroDraftBody | null {
  const seconds = parseInterval(draft.interval);
  return seconds === null
    ? null
    : { fontKey: draft.fontKey, autoplayEnabled: draft.autoplayEnabled, intervalSeconds: seconds, texts: draft.texts, slides: draft.slides };
}

export type Move = { ok: true; draft: HeroDraft } | { ok: false; reason: string };

const withSlides = (draft: HeroDraft, slides: HeroSlide[]): Move => ({ ok: true, draft: { ...draft, slides } });

/** A new slide for `media`: centred, with the required languages' texts empty (the operator writes them — nothing is invented). */
export function addSlide(draft: HeroDraft, media: HeroMedia, id: string, locales: MenuLocale[]): Move {
  if (draft.slides.length >= MAX_SLIDES) return { ok: false, reason: `Banner có tối đa ${MAX_SLIDES} ảnh. Hãy xoá bớt một ảnh trước.` };
  const empty = (): LocalizedText => Object.fromEntries(locales.map((locale) => [locale.code, isRequiredLocale(locale) ? "" : null]));
  return withSlides(draft, [...draft.slides, { id, mediaId: media.id, focalPosition: DEFAULT_FOCAL, alt: empty(), caption: empty() }]);
}

/** The slide keeps its place, id and texts; only its picture changes (and the focal point returns to the centre, which belonged to the old picture). */
export function replaceSlideMedia(draft: HeroDraft, slideId: string, media: HeroMedia): Move {
  if (!draft.slides.some((slide) => slide.id === slideId)) return { ok: false, reason: "Ảnh này không còn trong danh sách." };
  return withSlides(draft, draft.slides.map((slide) => (slide.id === slideId ? { ...slide, mediaId: media.id, focalPosition: DEFAULT_FOCAL } : slide)));
}

export function removeSlide(draft: HeroDraft, slideId: string): Move {
  if (draft.slides.length <= MIN_SLIDES) return { ok: false, reason: "Banner cần ít nhất 1 ảnh. Hãy thêm ảnh khác trước khi xoá ảnh này." };
  return withSlides(draft, draft.slides.filter((slide) => slide.id !== slideId));
}

export function moveSlide(draft: HeroDraft, slideId: string, delta: -1 | 1): Move {
  const at = draft.slides.findIndex((slide) => slide.id === slideId);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= draft.slides.length) return { ok: false, reason: delta < 0 ? "Ảnh này đã ở đầu danh sách." : "Ảnh này đã ở cuối danh sách." };
  const slides = [...draft.slides];
  [slides[at], slides[to]] = [slides[to], slides[at]];
  return withSlides(draft, slides);
}

export function patchSlideText(draft: HeroDraft, slideId: string, part: "alt" | "caption", code: string, value: string): HeroDraft {
  return { ...draft, slides: draft.slides.map((slide) => (slide.id === slideId ? { ...slide, [part]: { ...slide[part], [code]: value } } : slide)) };
}

export function patchSharedText(draft: HeroDraft, field: SharedField, code: string, value: string): HeroDraft {
  return { ...draft, texts: { ...draft.texts, [field]: { ...draft.texts[field], [code]: value } } };
}

/** What a visitor of `locale` reads: that language's text, else the default language's, else the Vietnamese one. */
export function previewText(labels: LocalizedText, locale: string, defaultCode: string): string {
  return [labels[locale], labels[defaultCode], labels.vi].find((value) => (value ?? "").trim() !== "")?.trim() ?? "";
}

export type FieldTarget =
  | { kind: "fontKey" }
  | { kind: "interval" }
  | { kind: "slides" }
  | { kind: "shared"; field: SharedField; locale: string }
  | { kind: "slide"; slideId: string; part: "alt" | "caption" | "mediaId" | "id" | "focalPosition"; locale: string | null };

/** The server names the offending field (`slides[2].alt.vi`, `texts.title.en`, `intervalSeconds`); this finds it on the draft that was sent. */
export function locateField(field: string | null, draft: HeroDraft): FieldTarget | null {
  if (!field) return null;
  if (field === "fontKey") return { kind: "fontKey" };
  if (field === "intervalSeconds") return { kind: "interval" };
  if (field === "slides") return { kind: "slides" };
  const shared = /^texts\.(title|description|primaryAction|secondaryAction)\.([A-Za-z-]+)$/.exec(field);
  if (shared) return { kind: "shared", field: shared[1] as SharedField, locale: shared[2].toLowerCase() };
  const slide = /^slides\[(\d+)\]\.(alt|caption|mediaId|id|focalPosition)(?:\.([A-Za-z-]+))?$/.exec(field);
  if (slide) {
    const target = draft.slides[Number(slide[1])];
    if (!target) return null;
    return { kind: "slide", slideId: target.id, part: slide[2] as "alt" | "caption" | "mediaId" | "id" | "focalPosition", locale: slide[3]?.toLowerCase() ?? null };
  }
  return null;
}

/** A one-line account of what differs from the saved hero, for the Save bar. */
export function summarizeChanges(base: HeroDraft, draft: HeroDraft): string[] {
  const parts: string[] = [];
  const baseIds = base.slides.map((slide) => slide.id);
  const ids = draft.slides.map((slide) => slide.id);
  const added = ids.filter((id) => !baseIds.includes(id)).length;
  const removed = baseIds.filter((id) => !ids.includes(id)).length;
  if (added) parts.push(`thêm ${added} ảnh`);
  if (removed) parts.push(`xoá ${removed} ảnh`);
  const common = ids.filter((id) => baseIds.includes(id));
  if (common.some((id, index) => id !== baseIds.filter((other) => common.includes(other))[index])) parts.push("đổi thứ tự ảnh");
  if (common.some((id) => base.slides.find((slide) => slide.id === id)?.mediaId !== draft.slides.find((slide) => slide.id === id)?.mediaId)) parts.push("thay ảnh");
  const same = (a: HeroTexts, b: HeroTexts) => JSON.stringify(SHARED_FIELDS.map((field) => a[field])) === JSON.stringify(SHARED_FIELDS.map((field) => b[field]));
  // Only the slides both drafts have: a deleted or added slide is already counted above.
  const slideTexts = (d: HeroDraft) => JSON.stringify(d.slides.filter((slide) => common.includes(slide.id)).sort((a, b) => a.id.localeCompare(b.id)).map((slide) => [slide.id, slide.alt, slide.caption]));
  if (!same(base.texts, draft.texts) || slideTexts(base) !== slideTexts(draft)) parts.push("sửa nội dung chữ");
  if (base.fontKey !== draft.fontKey) parts.push("đổi font");
  if (base.autoplayEnabled !== draft.autoplayEnabled || base.interval.trim() !== draft.interval.trim()) parts.push("đổi cách tự chuyển ảnh");
  return parts;
}
