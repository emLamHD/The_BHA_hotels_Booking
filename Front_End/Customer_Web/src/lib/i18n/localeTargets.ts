/**
 * BHA-BLOG-001-CP04: where the language switch goes from the page the visitor is on. A Blog page names, for every language of the site, the URL of the same
 * content in that language (the translation, or that language's Blog index when there is none); the switch then navigates there instead of only refreshing,
 * so the page and its URL stay the same language. Elsewhere there are no targets and the switch behaves as before (cookie + refresh).
 */
let current: Record<string, string> | null = null;

export const setLocaleTargets = (targets: Record<string, string> | null) => {
  current = targets;
};

export const localeTargetFor = (code: string): string | null => current?.[code] ?? null;
