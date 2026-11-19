"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { completeNewsletterConnect } from "@/lib/api/website";
import { SENDER_CODE_TEXT } from "./newsletterSenderWording";
import { useWriteAction } from "./useWebsiteData";
import { Banner, PageHeader } from "./WebsiteUi";

type Outcome =
  | { kind: "working" }
  | { kind: "connected"; email: string | null }
  | { kind: "failed"; message: string };

/**
 * BHA-NEWSLETTER-002: where Google sends the browser back (the Redirect URI). It reads `code`, `state` and `error` from the address once,
 * removes them from the address bar and the history at once, and forwards them in a POST body with the Staff session: so the code is never in
 * an API log, and a different Staff member who opens the same address cannot finish someone else's attempt (the server checks who started it).
 * It sends one request; a reload does not send it again because the address no longer holds the code.
 */
export default function NewsletterSenderCallback() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "working" });
  const write = useWriteAction();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(window.location.search);
    const state = query.get("state");
    const code = query.get("code");
    const error = query.get("error");
    window.history.replaceState(null, "", window.location.pathname);
    if (!state || (!code && !error)) {
      setOutcome({ kind: "failed", message: SENDER_CODE_TEXT["newsletter-connect-state-invalid"] });
      return;
    }

    void (async () => {
      const result = await write.run(() => completeNewsletterConnect({ state, code, error }));
      if (result === null) setOutcome({ kind: "failed", message: "Không gửi được yêu cầu lúc này. Hãy bấm Kết nối Gmail để bắt đầu lại." });
      else if (result.kind === "ok") setOutcome({ kind: "connected", email: result.data.connectedEmail });
      else if (result.kind === "refused") setOutcome({ kind: "failed", message: SENDER_CODE_TEXT[result.code ?? ""] ?? result.detail });
      else if (result.kind === "unverified") setOutcome({ kind: "failed", message: "Chưa biết kết quả (máy chủ không trả lời). Mở lại trang cấu hình để xem trạng thái kết nối trước khi thử lại." });
      else if (result.kind === "unauthenticated" || result.kind === "denied") setOutcome({ kind: "failed", message: "Phiên đăng nhập hoặc quyền của bạn không còn hiệu lực. Đăng nhập lại rồi bấm Kết nối Gmail để bắt đầu lại." });
      else setOutcome({ kind: "failed", message: "message" in result ? result.message : "Không hoàn tất được kết nối." });
    })();
    // The state and code are read once, on purpose; `write` is stable for this page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title="Kết nối Gmail">Đang hoàn tất kết nối với Google.</PageHeader>
      {outcome.kind === "working" && <Banner tone="info" testId="callback-working">Đang hoàn tất kết nối…</Banner>}
      {outcome.kind === "connected" && (
        <Banner tone="success" testId="callback-connected">
          <p className="font-medium">Đã kết nối Gmail{outcome.email ? `: ${outcome.email}` : ""}.</p>
          <p className="mt-1">Từ giờ email xác nhận đăng ký được gửi từ tài khoản này.</p>
        </Banner>
      )}
      {outcome.kind === "failed" && <Banner tone="error" testId="callback-failed">{outcome.message}</Banner>}
      {outcome.kind !== "working" && (
        <p>
          <Link href="/website/newsletter/sender" className="text-brand-600 underline dark:text-brand-400" data-testid="callback-back">Về trang cấu hình email gửi</Link>
        </p>
      )}
    </div>
  );
}
