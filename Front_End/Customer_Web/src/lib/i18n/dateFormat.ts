/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: dates and times in the visitor's format locale. The names of months and weekdays come
 * from `Intl` for that locale, never from a table in code, so a language added later needs no code.
 */
export function formatInstant(iso: string, formatLocale: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : new Intl.DateTimeFormat(formatLocale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
/** `2026-10-15` (a calendar date, no time zone) → "15 Oct 2026" in the visitor's locale. */
export function formatStayDate(isoDate: string, formatLocale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(formatLocale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

