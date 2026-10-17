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
  "menu-url-invalid": "Link không hợp lệ. Dùng đường dẫn bắt đầu bằng /, một mốc #, hoặc địa chỉ https://.",
  "menu-label-invalid": "Nhãn chỉ là chữ thường: không dùng < >, không ký tự điều khiển, tối đa 80 ký tự.",
  "menu-label-required": "Thiếu nhãn bắt buộc (tiếng Việt và ngôn ngữ mặc định).",
  "menu-duplicate-item": "Một mục xuất hiện hai lần trong menu.",
  "menu-parent-missing": "Mục cha không tồn tại.",
  "menu-cycle": "Không thể đặt một mục vào bên trong chính nó hoặc mục con của nó.",
  "menu-too-deep": "Menu chỉ có tối đa 4 cấp.",
  "menu-too-many": "Menu có quá nhiều mục (tối đa 200).",
  "menu-placement-invalid": "Mục cấp cao nhất cần thuộc hàng chính hoặc nhóm phụ.",
  "menu-delete-has-children": "Không thể xoá mục còn mục con. Hãy chuyển hoặc xoá các mục con trước.",
  "menu-unknown-locale": "Có nhãn cho một ngôn ngữ không tồn tại.",
  "hero-font-invalid": "Hãy chọn một trong các font trong danh sách.",
  "hero-interval-invalid": "Thời gian giữa hai lần chuyển ảnh là số nguyên giây từ 3 đến 60.",
  "hero-slides-count": "Banner cần từ 1 đến 10 ảnh.",
  "hero-duplicate-slide": "Một ảnh xuất hiện hai lần trong danh sách.",
  "hero-media-missing": "Ảnh này không còn dùng được. Hãy tải lại ảnh hoặc chọn ảnh khác.",
  "hero-focal-invalid": "Vị trí lấy nét của ảnh không hợp lệ.",
  "hero-text-invalid": "Văn bản chỉ là chữ thường: không dùng < >, không xuống dòng, không vượt quá độ dài cho phép.",
  "hero-text-required": "Thiếu văn bản bắt buộc (tiếng Việt và ngôn ngữ mặc định).",
  "hero-unknown-locale": "Có văn bản cho một ngôn ngữ không tồn tại.",
  "hero-image-empty": "Chưa chọn tệp ảnh hoặc tệp rỗng.",
  "hero-image-too-large": "Ảnh lớn hơn 10 MB.",
  "hero-image-unsupported": "Chỉ nhận ảnh JPEG, PNG hoặc WebP (không nhận SVG, GIF, ảnh động hay tệp khác).",
  "hero-image-corrupt": "Tệp ảnh bị hỏng hoặc chưa đủ dữ liệu. Hãy xuất lại ảnh rồi tải lên.",
  "hero-image-dimensions": "Kích thước ảnh không phù hợp (nhỏ nhất 320×160, lớn nhất 8000 px mỗi cạnh và 40 megapixel).",
  "hero-storage-not-configured": "Máy chủ chưa cấu hình nơi lưu ảnh (WebsiteMedia:RootPath) nên chưa tải ảnh lên được.",
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
