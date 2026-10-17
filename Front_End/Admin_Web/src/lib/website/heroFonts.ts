/**
 * CUST-WEB-HERO-001-CP01: the fonts the hero's title and description can use, as the Customer draws them. The tokens are a closed list the
 * API enforces; the stacks repeat `Customer_Web/src/lib/hero/hero.ts` exactly (a test reads that file and fails on any difference), so the
 * Admin preview shows the font a visitor gets. `be-vietnam-pro` and `default` need the two families the Admin layout loads with
 * `next/font` (CSS variables `--font-header` and `--font-poppins`); the system stacks need nothing.
 */
export const HERO_FONT_KEYS = ["default", "be-vietnam-pro", "system-sans", "system-serif"] as const;
export type HeroFontKey = (typeof HERO_FONT_KEYS)[number];

export const HERO_FONT_LABELS: Readonly<Record<HeroFontKey, string>> = {
  default: "Mặc định của giao diện (Poppins)",
  "be-vietnam-pro": "Be Vietnam Pro",
  "system-sans": "Chữ không chân của hệ thống",
  "system-serif": "Chữ có chân của hệ thống",
};

export const HERO_FONT_STACKS: Readonly<Record<HeroFontKey, string | null>> = {
  default: null,
  "be-vietnam-pro": 'var(--font-header), "Be Vietnam Pro", ui-sans-serif, system-ui, "Noto Sans", sans-serif',
  "system-sans": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "DejaVu Sans", sans-serif',
  "system-serif": 'ui-serif, Georgia, Cambria, "Noto Serif", "DejaVu Serif", "Times New Roman", serif',
};

/** The family the preview applies: the theme default is Poppins, which the Customer sets on its page body (Admin loads it as `--font-poppins`). */
export const heroPreviewFamily = (key: HeroFontKey): string => HERO_FONT_STACKS[key] ?? 'var(--font-poppins), Poppins, sans-serif';
