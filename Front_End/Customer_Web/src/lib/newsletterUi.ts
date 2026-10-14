/**
 * CUST-WEB-001-CP08a-C2: the home page's newsletter form is a UI preview. It checks that what was typed looks
 * like an e-mail address and says, truthfully, that nothing is subscribed: the address is not sent, stored,
 * put in a URL, logged or kept anywhere (handoff status: UI_PREVIEW_VALIDATED_NOT_PERSISTED). The result of
 * `validateNewsletterEmail` therefore never contains the address.
 */

export const NEWSLETTER_HEADING = "Nhận ưu đãi từ The BHA";
export const NEWSLETTER_BENEFIT = "Đăng ký để nhận thông tin ưu đãi và bài viết du lịch mới.";
export const NEWSLETTER_DISCLOSURE = "Bản demo: email chỉ được kiểm tra định dạng, không được gửi đi hay lưu lại.";
export const NEWSLETTER_NOT_STORED_MESSAGE = "Bản demo chưa tiếp nhận đăng ký. Email chưa được lưu.";
export const NEWSLETTER_REQUIRED_MESSAGE = "Vui lòng nhập email.";
export const NEWSLETTER_INVALID_MESSAGE = "Email chưa đúng định dạng. Ví dụ: ten@example.com.";

export type NewsletterValidation = { ok: true } | { ok: false; message: string };

const MAX_LENGTH = 254;
const LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function validateNewsletterEmail(raw: string): NewsletterValidation {
  const value = raw.trim();
  if (value === "") return { ok: false, message: NEWSLETTER_REQUIRED_MESSAGE };
  const invalid: NewsletterValidation = { ok: false, message: NEWSLETTER_INVALID_MESSAGE };
  if (value.length > MAX_LENGTH) return invalid;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return invalid;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return invalid;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return invalid;
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return invalid;
  return { ok: true };
}
