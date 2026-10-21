import type { DiscountKind, PromotionBody, PromotionEditor, PromotionStatus, PromotionTexts } from "@/lib/api/promotions";

/**
 * BHA-BOOKING-PROMOTIONS-001: the editor's draft of one promotion, and the checks that give fast feedback before a request. The server checks
 * every rule again (and against the real rates); these only say what is already wrong on the screen. The rules are the ones in
 * `PromotionRules` (Back_End): a percentage is above 0 and below 100 with two decimals — a free booking is not supported — and a
 * fixed amount is per room per night in the rate plan's currency.
 */

export const LIMITS = { slug: 120, title: 200, summary: 300, altText: 300, bodyParagraphs: 8, bodyParagraphLength: 1000, maxMinNights: 30, maxSortOrder: 9999, maxFixed: 9_999_999_999 } as const;
export const COVER_MIN = { width: 600, height: 400 } as const;
export const COVER_MAX_BYTES = 10 * 1024 * 1024;
export const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SOURCE_CURRENCY = "VND";

export interface TextsDraft { title: string; summary: string; coverAltText: string; body: string[] }

export interface PromotionDraft {
  slug: string; title: string; summary: string; body: string[];
  coverMediaId: string | null; coverAltText: string;
  kind: DiscountKind; value: string; currencyCode: string;
  allRoomTypes: boolean; roomTypeIds: string[];
  bookingFrom: string; bookingTo: string; stayFrom: string; stayTo: string; minNights: string;
  showOnHomepage: boolean; sortOrder: string; displayFrom: string; displayTo: string;
  translations: Record<string, TextsDraft>;
}

export const emptyDraft = (): PromotionDraft => ({
  slug: "", title: "", summary: "", body: [""], coverMediaId: null, coverAltText: "",
  kind: "Percent", value: "", currencyCode: SOURCE_CURRENCY, allRoomTypes: true, roomTypeIds: [],
  bookingFrom: "", bookingTo: "", stayFrom: "", stayTo: "", minNights: "1",
  showOnHomepage: false, sortOrder: "0", displayFrom: "", displayTo: "", translations: {},
});

const textsDraft = (t: PromotionTexts | undefined): TextsDraft => ({ title: t?.title ?? "", summary: t?.summary ?? "", coverAltText: t?.coverAltText ?? "", body: t?.body ? [...t.body] : [] });

export function draftOf(editor: PromotionEditor): PromotionDraft {
  const translations: Record<string, TextsDraft> = {};
  for (const language of editor.languages.filter(l => !l.isSource)) translations[language.code] = textsDraft(editor.translations[language.code]);
  return {
    slug: editor.slug, title: editor.title, summary: editor.summary, body: editor.body.length ? [...editor.body] : [""],
    coverMediaId: editor.coverMediaId, coverAltText: editor.coverAltText ?? "",
    kind: editor.kind, value: String(editor.value), currencyCode: editor.currencyCode ?? SOURCE_CURRENCY,
    allRoomTypes: editor.allRoomTypes, roomTypeIds: [...editor.roomTypeIds],
    bookingFrom: editor.bookingFrom ?? "", bookingTo: editor.bookingTo ?? "", stayFrom: editor.stayFrom ?? "", stayTo: editor.stayTo ?? "",
    minNights: String(editor.minNights), showOnHomepage: editor.showOnHomepage, sortOrder: String(editor.sortOrder),
    displayFrom: editor.displayFrom ?? "", displayTo: editor.displayTo ?? "", translations,
  };
}

/** Two drafts are the same when nothing the server would store differs (blank trailing paragraphs and spacing do not count). */
export function fingerprint(draft: PromotionDraft): string {
  return JSON.stringify(toBody(draft, true));
}

const blank = (s: string) => s.trim() === "";
const orNull = (s: string) => (blank(s) ? null : s.trim());

/** Vietnamese title → a URL slug: no accents, đ → d, lowercase, single hyphens. */
export function slugify(title: string): string {
  return title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.slug).replace(/-+$/, "");
}

export function toBody(draft: PromotionDraft, withTranslations: boolean): PromotionBody {
  const body: PromotionBody = {
    slug: draft.slug.trim(), title: draft.title.trim(), summary: draft.summary.trim(), body: draft.body.map(p => p.trim()).filter(p => p !== ""),
    coverMediaId: draft.coverMediaId, coverAltText: draft.coverMediaId ? orNull(draft.coverAltText) : null,
    kind: draft.kind, value: Number(draft.value.trim().replace(",", ".")), currencyCode: draft.kind === "FixedAmount" ? draft.currencyCode.trim().toUpperCase() : null,
    allRoomTypes: draft.allRoomTypes, roomTypeIds: draft.allRoomTypes ? [] : [...draft.roomTypeIds].sort(),
    bookingFrom: orNull(draft.bookingFrom), bookingTo: orNull(draft.bookingTo), stayFrom: orNull(draft.stayFrom), stayTo: orNull(draft.stayTo),
    minNights: Number(draft.minNights.trim()), showOnHomepage: draft.showOnHomepage, sortOrder: Number(draft.sortOrder.trim()),
    displayFrom: orNull(draft.displayFrom), displayTo: orNull(draft.displayTo),
  };
  if (withTranslations) {
    const translations: Record<string, PromotionTexts> = {};
    for (const [code, t] of Object.entries(draft.translations)) {
      translations[code] = { title: orNull(t.title), summary: orNull(t.summary), coverAltText: orNull(t.coverAltText), body: t.body.map(p => p.trim()).filter(p => p !== "") };
    }
    body.translations = translations;
  }
  return body;
}

export type FieldErrors = Record<string, string>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const decimals = (s: string) => (s.includes(".") ? s.split(".")[1].length : 0);

/** What is already wrong on the screen, by field name (the same names the server uses in a refusal). Empty = nothing wrong here. */
export function validateDraft(d: PromotionDraft): FieldErrors {
  const e: FieldErrors = {};
  const plain = (text: string, max: number) => (/[<>]/.test(text) ? "Chỉ dùng chữ thường, không dùng < >." : /[\u0000-\u001f\u007f]/.test(text) ? "Không dùng ký tự xuống dòng hoặc điều khiển." : text.trim().length > max ? `Tối đa ${max} ký tự.` : null);
  if (blank(d.title)) e.title = "Nhập tiêu đề."; else { const p = plain(d.title, LIMITS.title); if (p) e.title = p; }
  if (blank(d.summary)) e.summary = "Nhập mô tả ngắn."; else { const p = plain(d.summary, LIMITS.summary); if (p) e.summary = p; }
  if (!SLUG.test(d.slug.trim()) || d.slug.trim().length > LIMITS.slug) e.slug = "Chữ thường không dấu, số và dấu gạch ngang giữa các từ.";
  const paragraphs = d.body.filter(p => !blank(p));
  if (paragraphs.length > LIMITS.bodyParagraphs) e.body = `Tối đa ${LIMITS.bodyParagraphs} đoạn.`;
  d.body.forEach((p, i) => { if (!blank(p)) { const m = plain(p, LIMITS.bodyParagraphLength); if (m) e[`body${i + 1}`] = m; } });
  if (d.coverMediaId && blank(d.coverAltText)) e.coverAltText = "Nhập mô tả ảnh (alt text) để người dùng đọc màn hình hiểu được ảnh.";
  if (d.coverMediaId && d.coverAltText.length > LIMITS.altText) e.coverAltText = `Tối đa ${LIMITS.altText} ký tự.`;
  if (d.showOnHomepage && !d.coverMediaId) e.showOnHomepage = "Ưu đãi hiện trên trang chủ cần có ảnh bìa.";

  const value = d.value.trim().replace(",", ".");
  const number = Number(value);
  if (blank(value) || !Number.isFinite(number)) e.value = "Nhập giá trị giảm.";
  else if (d.kind === "Percent") {
    if (number <= 0 || number >= 100) e.value = "Phần trăm lớn hơn 0 và nhỏ hơn 100 (chưa hỗ trợ đặt phòng miễn phí).";
    else if (decimals(value) > 2) e.value = "Tối đa 2 chữ số thập phân.";
  } else {
    const code = d.currencyCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) e.currencyCode = "Mã tiền tệ gồm 3 chữ cái, ví dụ VND.";
    if (number <= 0 || number > LIMITS.maxFixed) e.value = "Số tiền lớn hơn 0.";
    else if (code === SOURCE_CURRENCY ? decimals(value) > 0 : decimals(value) > 2) e.value = code === SOURCE_CURRENCY ? "Số tiền VND là số nguyên." : "Tối đa 2 chữ số thập phân.";
  }

  if (!d.allRoomTypes && d.roomTypeIds.length === 0) e.roomTypeIds = "Chọn ít nhất một loại phòng hoặc chọn tất cả.";
  const order = (from: string, to: string, field: string, text: string) => { if (from && to && to < from) e[field] = text; };
  order(d.bookingFrom, d.bookingTo, "bookingTo", "Ngày kết thúc không được trước ngày bắt đầu.");
  order(d.stayFrom, d.stayTo, "stayTo", "Ngày kết thúc không được trước ngày bắt đầu.");
  order(d.displayFrom, d.displayTo, "displayTo", "Ngày kết thúc không được trước ngày bắt đầu.");
  const nights = Number(d.minNights.trim());
  if (!Number.isInteger(nights) || nights < 1 || nights > LIMITS.maxMinNights) e.minNights = `Số đêm tối thiểu từ 1 đến ${LIMITS.maxMinNights}.`;
  const sort = Number(d.sortOrder.trim());
  if (!Number.isInteger(sort) || sort < 0 || sort > LIMITS.maxSortOrder) e.sortOrder = `Thứ tự hiển thị từ 0 đến ${LIMITS.maxSortOrder}.`;
  for (const [code, t] of Object.entries(d.translations)) {
    if (!blank(t.title)) { const p = plain(t.title, LIMITS.title); if (p) e[`translations.${code}.title`] = p; }
    if (!blank(t.summary)) { const p = plain(t.summary, LIMITS.summary); if (p) e[`translations.${code}.summary`] = p; }
    if (!blank(t.coverAltText)) { const p = plain(t.coverAltText, LIMITS.altText); if (p) e[`translations.${code}.coverAltText`] = p; }
    t.body.forEach((p, i) => { if (!blank(p)) { const m = plain(p, LIMITS.bodyParagraphLength); if (m) e[`translations.${code}.body${i + 1}`] = m; } });
  }
  return e;
}

const money = new Intl.NumberFormat("vi-VN");

/** The rule in one sentence, from the rule fields (never typed by hand). */
export function discountLabel(kind: DiscountKind, value: number, currencyCode: string | null): string {
  return kind === "Percent" ? `Giảm ${value}% mỗi đêm` : `Giảm ${money.format(value)} ${currencyCode === "VND" || currencyCode === null ? "₫" : currencyCode} mỗi phòng mỗi đêm`;
}

export const STATUS_LABEL: Record<PromotionStatus, string> = { Draft: "Nháp", Active: "Đang bật", Disabled: "Đã tắt" };
