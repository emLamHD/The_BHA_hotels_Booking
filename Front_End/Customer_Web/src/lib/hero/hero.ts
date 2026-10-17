import type { CSSProperties } from "react";

/**
 * CUST-WEB-HERO-001-CP01: the home page hero as the API serves it (`GET /api/v1/website/hero`) — slides, texts, font and timing are the
 * Admin's. Nothing in code lists a slide, a text or an interval: a visitor sees what the Admin saved, the moment the next request or
 * the next check (≤ 15 s on an open page) reads it.
 */
export const HERO_FONT_KEYS = ["default", "be-vietnam-pro", "system-sans", "system-serif"] as const;
export type HeroFontKey = (typeof HERO_FONT_KEYS)[number];

/**
 * The families the Admin's dropdown offers, applied to the hero's title and description only. `default` inherits the theme's font.
 * Be Vietnam Pro is the header font the layout already loads (`--font-header`); the two system stacks name families with Vietnamese and
 * French letters on the common platforms (Noto / DejaVu on Linux), so every choice shows "Đường chân trời" and "crépuscule" in full.
 * The Admin preview repeats this table (`Admin_Web/src/lib/website/heroFonts.ts`); a test there reads this file and fails if they differ.
 */
export const HERO_FONT_STACKS: Readonly<Record<HeroFontKey, string | null>> = {
  default: null,
  "be-vietnam-pro": 'var(--font-header), "Be Vietnam Pro", ui-sans-serif, system-ui, "Noto Sans", sans-serif',
  "system-sans": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "DejaVu Sans", sans-serif',
  "system-serif": 'ui-serif, Georgia, Cambria, "Noto Serif", "DejaVu Serif", "Times New Roman", serif',
};

export const heroFontStyle = (key: HeroFontKey): CSSProperties | undefined => {
  const family = HERO_FONT_STACKS[key];
  return family ? { fontFamily: family } : undefined;
};

export const DEFAULT_INTERVAL_SECONDS = 6;
export const MIN_INTERVAL_SECONDS = 3;
export const MAX_INTERVAL_SECONDS = 60;

export interface HeroSlideData {
  id: string;
  /** Absolute: the API's base plus the picture's path. */
  imageUrl: string;
  /** Set for a built-in photograph (its credit is looked up by this file); null for an upload, which never inherits another picture's credit. */
  seedFile: string | null;
  /** CSS `object-position` on narrow screens. */
  focalPosition: string;
  alt: string;
  caption: string;
}

export interface HeroSnapshot {
  revision: string;
  /** The language the texts are in (the API's resolution of the visitor's choice). */
  locale: string;
  /** When the API read the hero (ms since epoch, the API's clock): answers are ordered by it, whatever order they arrive in. */
  generatedAt: number;
  fontKey: HeroFontKey;
  autoplayEnabled: boolean;
  intervalSeconds: number;
  title: string;
  description: string;
  primaryAction: string;
  secondaryAction: string;
  slides: HeroSlideData[];
}

const MEDIA_PATH = /^\/api\/v1\/website\/hero\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOCAL = /^(100|[0-9]{1,2})% (100|[0-9]{1,2})%$/;
const SEED_FILE = /^hero-[a-z0-9]+(-[a-z0-9]+)*\.webp$/;
const MAX_SLIDES = 10;

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function parseSlide(raw: unknown, apiBase: string): HeroSlideData | null {
  if (!raw || typeof raw !== "object") return null;
  const slide = raw as Record<string, unknown>;
  if (!text(slide.id) || !text(slide.alt) || !text(slide.caption)) return null;
  // A picture is only ever one of the API's own media paths: no other host, no other scheme is rendered from this field.
  if (typeof slide.imageUrl !== "string" || !MEDIA_PATH.test(slide.imageUrl)) return null;
  const seedFile = typeof slide.seedFile === "string" && SEED_FILE.test(slide.seedFile) ? slide.seedFile : null;
  const focalPosition = typeof slide.focalPosition === "string" && FOCAL.test(slide.focalPosition) ? slide.focalPosition : "50% 50%";
  return { id: slide.id, imageUrl: `${apiBase}${slide.imageUrl}`, seedFile, focalPosition, alt: slide.alt, caption: slide.caption };
}

/** The API's answer as a snapshot, or null when it is not one (a proxy's error page, an older API, no usable slide). An unknown font falls back to the theme's. */
export function parseHero(json: unknown, apiBase: string): HeroSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const generatedAt = typeof body.generatedAtUtc === "string" ? Date.parse(body.generatedAtUtc) : NaN;
  if (typeof body.revision !== "string" || typeof body.locale !== "string" || Number.isNaN(generatedAt)) return null;
  if (!text(body.title) || !text(body.description) || !text(body.primaryAction) || !text(body.secondaryAction)) return null;
  const interval = body.intervalSeconds;
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < MIN_INTERVAL_SECONDS || interval > MAX_INTERVAL_SECONDS) return null;
  if (typeof body.autoplayEnabled !== "boolean" || !Array.isArray(body.slides)) return null;
  const slides = body.slides.slice(0, MAX_SLIDES).map((raw) => parseSlide(raw, apiBase)).filter((slide): slide is HeroSlideData => slide !== null);
  if (slides.length === 0) return null;
  const fontKey = (HERO_FONT_KEYS as readonly unknown[]).includes(body.fontKey) ? (body.fontKey as HeroFontKey) : "default";
  return {
    revision: body.revision,
    locale: body.locale,
    generatedAt,
    fontKey,
    autoplayEnabled: body.autoplayEnabled,
    intervalSeconds: interval,
    title: body.title,
    description: body.description,
    primaryAction: body.primaryAction,
    secondaryAction: body.secondaryAction,
    slides,
  };
}

/** The same content (revision and language) is no news: the screen keeps the object it has, so nothing re-renders for a poll that found nothing new. */
export const isSameHero = (current: HeroSnapshot | null, next: HeroSnapshot) =>
  current !== null && current.revision === next.revision && current.locale === next.locale;
