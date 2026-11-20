/**
 * BHA-ADMIN-BADGE-001-PR05: how a read of the unseen list or the history is sorted into what the screen shows. A 404 is the API's one answer for "unknown menu", "not yours" and "no membership
 * at that Property": it is shown as one general message and the scope's data is dropped, never as a hint that the scope exists. 401 and 403 go to the shared session by the caller.
 */

import type { WebsiteResult } from "@/lib/api/website";

export type View<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "gone" } | { state: "error"; message: string };

export const GONE_MESSAGE = "Không xem được mục này. Mục có thể không còn tồn tại hoặc tài khoản không còn quyền xem nó.";

export function toView<T>(result: WebsiteResult<T>): View<T> {
  switch (result.kind) {
    case "ok":
      return { state: "ok", data: result.data };
    case "refused":
      return result.status === 404 ? { state: "gone" } : { state: "error", message: "Máy chủ từ chối yêu cầu này. Hãy chọn lại hoặc thử lại." };
    case "unauthenticated":
      return { state: "error", message: "Phiên đăng nhập đã hết. Hãy đăng nhập lại." };
    case "denied":
      return { state: "error", message: "Không thể kiểm tra quyền xem. Hãy thử lại." };
    case "config":
    case "network":
    case "error":
    case "invalid-response":
    case "unverified":
      return { state: "error", message: result.message };
  }
}
