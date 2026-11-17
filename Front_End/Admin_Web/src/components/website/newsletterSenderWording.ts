import type { NewsletterSenderStatus } from "@/lib/api/website";

/** BHA-NEWSLETTER-002: the words for the stable codes the sender routes answer with. A code this list does not know falls back to the server's own detail. */
export const SENDER_CODE_TEXT: Record<string, string> = {
  "newsletter-sender-redirect-uri-missing": "Chưa cấu hình địa chỉ HTTPS của Admin (Cors:AdminOrigins hoặc Website:Newsletter:AdminOrigin) nên chưa tạo được Redirect URI.",
  "newsletter-sender-client-id-invalid": "Client ID không hợp lệ: không được để trống hoặc có khoảng trắng.",
  "newsletter-sender-client-secret-invalid": "Client Secret không hợp lệ.",
  "newsletter-sender-client-secret-required": "Hãy nhập Client Secret: chưa có secret đã lưu cho Client ID này.",
  "newsletter-sender-name-invalid": "Tên người gửi tối đa 100 ký tự và không được có ký tự xuống dòng hay điều khiển.",
  "newsletter-sender-reply-to-invalid": "Reply-To phải là một địa chỉ email hợp lệ (hoặc để trống).",
  "newsletter-sender-version-conflict": "Cấu hình đã thay đổi ở nơi khác. Chưa có gì được lưu; hãy tải lại rồi sửa lại.",
  "newsletter-connect-cancelled": "Bạn đã huỷ cấp quyền trên Google. Kết nối hiện tại được giữ nguyên.",
  "newsletter-connect-scope-missing": "Google chưa cấp quyền gửi email (gmail.send): hãy tick đủ quyền khi cho phép. Kết nối hiện tại được giữ nguyên.",
  "newsletter-connect-no-refresh-token": "Google không trả về quyền gửi lâu dài. Hãy thử Kết nối lại và chọn Cho phép. Kết nối hiện tại được giữ nguyên.",
  "newsletter-connect-email-unverified": "Không xác định được một địa chỉ Gmail đã xác minh của tài khoản này. Kết nối hiện tại được giữ nguyên.",
  "newsletter-connect-exchange-failed": "Google từ chối hoặc không trả lời khi đổi mã. Hãy kiểm tra Client ID, Client Secret và Redirect URI, rồi thử lại. Kết nối hiện tại được giữ nguyên.",
  "newsletter-connect-state-invalid": "Phiên kết nối đã hết hạn, đã được dùng hoặc không thuộc về bạn. Hãy bấm Kết nối Gmail để bắt đầu lại.",
};

export const SENDER_STATUS_TEXT: Record<NewsletterSenderStatus, string> = {
  NotConnected: "Chưa kết nối",
  Connected: "Đã kết nối",
  NeedsReconnect: "Cần kết nối lại",
};
