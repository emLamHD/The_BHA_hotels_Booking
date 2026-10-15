import type { WebsiteFailure } from "@/lib/api/website";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the words of the website screens for a server refusal. One consistent Vietnamese sentence
 * per stable `code`; the English `detail` the server sends is shown only where a code cannot explain it (a rejected value).
 */
const REFUSALS: Record<string, string> = {
  "stale-version": "Dữ liệu đã thay đổi trên máy chủ kể từ khi bạn mở. Chưa có gì được lưu.",
  "already-exists": "Mục này đã tồn tại.",
  "default-language-required": "Website phải luôn có một ngôn ngữ mặc định đang bật.",
  "default-language-incomplete": "Ngôn ngữ mặc định phải có đủ các bản dịch bắt buộc.",
  "language-in-use": "Ngôn ngữ đang được dùng nên chưa thể xoá hoặc tắt.",
  "language-incomplete": "Ngôn ngữ chưa đủ bản dịch bắt buộc nên chưa bật được. Hãy nhập gói đầy đủ hoặc bổ sung các câu còn thiếu.",
  "unknown-key": "Câu này không nằm trong danh mục của website.",
  "default-currency-required": "Website phải luôn có một tiền tệ mặc định đang bật.",
  "rate-required": "Cần nhập tỷ giá trước khi bật tiền tệ này.",
  "base-currency-fixed": "VND là tiền tệ gốc nên không thể thay đổi, tắt hay xoá.",
  "currency-in-use": "Tiền tệ đang là tiền mặc định của một ngôn ngữ nên chưa thể tắt hoặc xoá.",
  "currency-inactive": "Tiền tệ này đang tắt. Hãy bật nó trước.",
  "unknown-currency": "Mã tiền tệ này chưa được cấu hình trong website.",
  "stale-preview": "Bản xem trước đã cũ vì dữ liệu đã thay đổi. Hãy kiểm tra gói lại rồi áp dụng.",
  "pack-invalid": "Gói không hợp lệ. Chưa có gì được thay đổi.",
  "pack-incompatible": "Gói không tương thích với danh mục hiện tại. Chưa có gì được thay đổi.",
};

/** A refusal in Vietnamese, with the server's own detail appended where it names the value that was rejected. */
export function refusalText(failure: Extract<WebsiteFailure, { kind: "refused" }>): string {
  const base = failure.code ? REFUSALS[failure.code] : undefined;
  if (!base) return failure.status === 404 ? "Mục này không còn tồn tại trên máy chủ." : failure.detail;
  return failure.code === "validation" ? failure.detail : base;
}

/** The clock time, then the date, in the operator's own format. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? iso : when.toLocaleString("vi-VN");
}

export function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.floor((part / whole) * 100);
}
