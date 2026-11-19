import type { NewsletterLanguage, NewsletterSubscription, NewsletterVerificationMail } from "@/lib/api/website";

/** BHA-NEWSLETTER-003: the words of the subscriber screen. The status says where the address is in double opt-in; hiding (archive) is a separate flag. */
export const STATUS_LABEL: Record<string, string> = {
  PendingVerification: "Chờ xác minh",
  Verified: "Đã xác minh",
  Unsubscribed: "Đã ngừng nhận",
};

export const SOURCE_LABEL: Record<string, string> = { homepage: "Trang chủ", admin: "Admin thêm" };

export const LANGUAGE_LABEL: Record<NewsletterLanguage, string> = { vi: "Tiếng Việt", en: "English", fr: "Français" };

export const MAIL_LABEL: Record<NewsletterVerificationMail, string> = {
  Pending: "Đang chờ gửi",
  Sending: "Đang gửi",
  Sent: "Đã gửi",
  Failed: "Gửi lỗi",
  Cancelled: "Đã hủy",
};

export const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Mọi trạng thái" },
  { value: "PendingVerification", label: STATUS_LABEL.PendingVerification },
  { value: "Verified", label: STATUS_LABEL.Verified },
  { value: "Unsubscribed", label: STATUS_LABEL.Unsubscribed },
];

export const SCOPE_FILTERS: ReadonlyArray<{ value: "active" | "archived" | "all"; label: string }> = [
  { value: "active", label: "Đang dùng" },
  { value: "archived", label: "Đã lưu trữ" },
  { value: "all", label: "Tất cả" },
];

/** A row Staff can invite: pending and not hidden. A verified or unsubscribed address is the visitor's to bring back. */
export const canInvite = (row: NewsletterSubscription) => row.status === "PendingVerification" && row.archivedAtUtc === null;
