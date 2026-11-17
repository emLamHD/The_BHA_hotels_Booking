"use client";

import Link from "next/link";
import { useState } from "react";
import { getNewsletterSender, saveNewsletterSenderProfile, startNewsletterConnect, disconnectNewsletterSender, type NewsletterSender } from "@/lib/api/website";
import { useWebsiteList, useWriteAction } from "./useWebsiteData";
import { SENDER_CODE_TEXT, SENDER_STATUS_TEXT } from "./newsletterSenderWording";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, TextField, WriteFeedback, formatWhen } from "./WebsiteUi";

/**
 * BHA-NEWSLETTER-002: the Gmail account the confirmation e-mails are sent from. Everything here is display and input: the server
 * decides who may read or change it. The Client Secret is WRITE-ONLY: it is sent once and never shown again; an empty field means
 * "keep the stored one". Connecting sends the browser to Google; Google returns it to `/website/newsletter/sender/callback`.
 */
export default function NewsletterSenderPanel() {
  const list = useWebsiteList(getNewsletterSender, []);
  if (list.state.status === "loading") return <LoadingPanel what="cấu hình email gửi" />;
  if (list.state.status === "error") return <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />;
  return <Editor initial={list.state.data} reload={list.reload} />;
}

/** The browser is only ever sent to an https address the API produced; anything else is not followed. */
const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

function Editor({ initial, reload }: { initial: NewsletterSender; reload: () => Promise<NewsletterSender | null> }) {
  const [sender, setSender] = useState(initial);
  const [clientId, setClientId] = useState(initial.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [name, setName] = useState(initial.senderName ?? "");
  const [replyTo, setReplyTo] = useState(initial.replyTo ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const connect = useWriteAction();
  const profile = useWriteAction();
  const disconnect = useWriteAction();
  const busy = [connect, profile, disconnect].some((action) => action.status.phase === "pending");
  const unverified = [connect, profile, disconnect].some((action) => action.status.phase === "unverified");
  const locked = busy || unverified;

  const connected = sender.status === "Connected";
  const startLabel = sender.status === "NotConnected" ? "Kết nối Gmail" : sender.status === "NeedsReconnect" ? "Kết nối lại Gmail" : "Đổi tài khoản";

  const start = async () => {
    if (locked) return;
    setNotice(null);
    const result = await connect.run(() => startNewsletterConnect({ clientId: clientId.trim(), clientSecret: clientSecret.trim() === "" ? null : clientSecret.trim(), switchAccount: connected }));
    if (result?.kind === "ok" && isHttps(result.data.authorizationUrl)) {
      setClientSecret("");
      window.location.assign(result.data.authorizationUrl);
    } else if (result?.kind === "ok") {
      setNotice("Địa chỉ Google nhận được không hợp lệ nên trình duyệt không được chuyển đi.");
    }
  };

  const saveProfile = async () => {
    if (locked) return;
    setNotice(null);
    const result = await profile.run(() => saveNewsletterSenderProfile({ expectedVersion: sender.version, senderName: name.trim() || null, replyTo: replyTo.trim() || null }));
    if (result?.kind === "ok") {
      setSender(result.data);
      setName(result.data.senderName ?? "");
      setReplyTo(result.data.replyTo ?? "");
      setNotice("Đã lưu tên người gửi và Reply-To. Áp dụng cho email chưa từng được thử gửi.");
    }
  };

  const doDisconnect = async () => {
    if (locked) return;
    setNotice(null);
    setConfirmingDisconnect(false);
    const result = await disconnect.run(disconnectNewsletterSender);
    if (result?.kind === "ok") {
      setSender(result.data);
      setNotice("Đã ngắt kết nối Gmail. Khách vẫn đăng ký được nhưng chưa nhận được email xác nhận cho tới khi kết nối lại.");
    }
  };

  const check = async () => {
    const fresh = await reload();
    if (fresh) {
      setSender(fresh);
      connect.reset();
      profile.reset();
      disconnect.reset();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sender.redirectUri ?? "");
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  const refusal = (action: ReturnType<typeof useWriteAction>) =>
    action.status.phase === "refused" ? SENDER_CODE_TEXT[action.status.failure.code ?? ""] ?? action.status.failure.detail : null;
  const fieldError = (action: ReturnType<typeof useWriteAction>, field: string) =>
    action.status.phase === "refused" && action.status.failure.field === field ? refusal(action) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title="Cấu hình email gửi">
        Tài khoản Gmail dùng để gửi email xác nhận đăng ký nhận tin. Chưa kết nối thì khách vẫn đăng ký được nhưng chưa nhận email xác nhận.{" "}
        <Link href="/website/newsletter" className="text-brand-600 underline dark:text-brand-400">Xem danh sách đăng ký</Link>
      </PageHeader>

      {notice && <Banner tone="success" testId="sender-notice" onDismiss={() => setNotice(null)}>{notice}</Banner>}
      {sender.status === "Connected" && (
        <Banner tone="success" testId="sender-status-connected">
          <p className="font-medium">{SENDER_STATUS_TEXT.Connected}: email đang được gửi từ <strong>{sender.connectedEmail}</strong></p>
          {sender.connectedAtUtc && <p className="mt-1">Kết nối lúc {formatWhen(sender.connectedAtUtc)}. {sender.pendingRequests > 0 ? `${sender.pendingRequests} email đang chờ gửi.` : "Không có email nào đang chờ."}</p>}
        </Banner>
      )}
      {sender.status === "NeedsReconnect" && (
        <Banner tone="warning" testId="sender-status-reconnect">
          <p className="font-medium">{SENDER_STATUS_TEXT.NeedsReconnect}{sender.connectedEmail ? ` (${sender.connectedEmail})` : ""}</p>
          <p className="mt-1">Google đã thu hồi quyền gửi, hoặc khoá bảo mật cũ không còn đọc được. Hãy bấm Kết nối lại Gmail. {sender.pendingRequests > 0 ? `${sender.pendingRequests} email đang chờ và sẽ được gửi sau khi kết nối lại.` : ""}</p>
        </Banner>
      )}
      {sender.status === "NotConnected" && (
        <Banner tone="info" testId="sender-status-none">
          <p className="font-medium">{SENDER_STATUS_TEXT.NotConnected}{sender.connectedEmail ? ` (trước đó: ${sender.connectedEmail})` : ""}</p>
          <p className="mt-1">Khách vẫn đăng ký được; địa chỉ được ghi nhận ở trạng thái &ldquo;Chưa xác minh email&rdquo; và không có email nào được gửi.</p>
        </Banner>
      )}
      {!sender.customerOriginReady && (
        <Banner tone="warning" testId="sender-origin-missing">
          Chưa có địa chỉ HTTPS của Customer Web (<code>Website:Newsletter:CustomerOrigin</code> hoặc <code>Cors:AllowedOrigins</code>), nên link xác nhận chưa tạo được và chưa gửi email nào.
        </Banner>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]" aria-labelledby="sender-guide">
        <h2 id="sender-guide" className="text-base font-semibold text-gray-900 dark:text-white">Thiết lập trên Google Cloud (làm một lần)</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>Trong Google Cloud Console, chọn hoặc tạo một project rồi bật <strong>Gmail API</strong>.</li>
          <li>Vào <strong>OAuth consent screen</strong>, chọn <strong>External</strong>. Thêm Gmail sẽ dùng để gửi vào <strong>Test users</strong> khi app còn ở trạng thái Testing.</li>
          <li>Vào <strong>Credentials → Create credentials → OAuth client ID → Web application</strong>. Ở <strong>Authorized redirect URIs</strong>, dán đúng địa chỉ bên dưới (khớp từng ký tự).</li>
          <li>Sao chép <strong>Client ID</strong> và <strong>Client secret</strong> vào form bên dưới, bấm <strong>{startLabel}</strong>, chọn tài khoản Gmail và bấm <strong>Cho phép</strong> với quyền gửi email.</li>
        </ol>
        <div className="mt-4">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Redirect URI</p>
          {sender.redirectUri ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code data-testid="sender-redirect-uri" className="break-all rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-800 dark:bg-white/10 dark:text-gray-100">{sender.redirectUri}</code>
              <ActionButton variant="outline" onClick={() => void copy()} testId="sender-copy-redirect">Sao chép</ActionButton>
              {copied === "done" && <span role="status" className="text-xs text-success-700 dark:text-success-300">Đã sao chép</span>}
              {copied === "failed" && <span role="alert" className="text-xs text-error-600">Không sao chép được: hãy chọn và sao chép bằng tay.</span>}
            </div>
          ) : (
            <p className="mt-1 text-sm text-error-600">Chưa tạo được: thiếu địa chỉ HTTPS của Admin (<code>Cors:AdminOrigins</code>).</p>
          )}
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Quyền xin: <code>{sender.scopes.join(" ")}</code>. Chỉ dùng để gửi email và biết địa chỉ Gmail đã xác minh.</p>
        </div>
        <p className="mt-4 rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:bg-warning-500/10 dark:text-warning-200" data-testid="sender-testing-note">
          Lưu ý: app Google ở trạng thái <strong>External / Testing</strong> bị giới hạn người thử, và refresh token của quyền gửi Gmail có thể hết hạn sau 7 ngày, khi đó trang này báo &ldquo;Cần kết nối lại&rdquo;. Chuyển app sang <strong>In production</strong> (kèm xác minh của Google nếu được yêu cầu) để kết nối bền vững.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]" aria-labelledby="sender-credentials">
        <h2 id="sender-credentials" className="text-base font-semibold text-gray-900 dark:text-white">Kết nối Gmail</h2>
        <TextField label="Client ID" value={clientId} onChange={setClientId} maxLength={256} testId="sender-client-id" error={fieldError(connect, "clientId")} placeholder="xxxxxxxx.apps.googleusercontent.com" />
        <TextField
          label="Client Secret"
          type="password"
          value={clientSecret}
          onChange={setClientSecret}
          maxLength={256}
          testId="sender-client-secret"
          error={fieldError(connect, "clientSecret")}
          placeholder={sender.hasClientSecret ? "Đã lưu — để trống để giữ nguyên" : "GOCSPX-…"}
          hint="Chỉ ghi: secret được gửi một lần, lưu được mã hoá và không bao giờ hiển thị lại."
        />
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => void start()} disabled={locked || clientId.trim() === "" || !sender.redirectUri} testId="sender-connect">{startLabel}</ActionButton>
          {sender.status !== "NotConnected" && !confirmingDisconnect && <ActionButton variant="outline" onClick={() => setConfirmingDisconnect(true)} disabled={locked} testId="sender-disconnect">Ngắt kết nối</ActionButton>}
          {confirmingDisconnect && (
            <span className="inline-flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              Ngắt kết nối và thu hồi quyền tại Google?
              <ActionButton onClick={() => void doDisconnect()} disabled={locked} testId="sender-disconnect-confirm">Ngắt kết nối</ActionButton>
              <ActionButton variant="outline" onClick={() => setConfirmingDisconnect(false)} testId="sender-disconnect-cancel">Giữ kết nối</ActionButton>
            </span>
          )}
        </div>
        {refusal(connect) && !fieldError(connect, "clientId") && !fieldError(connect, "clientSecret") && <Banner tone="error" testId="sender-connect-refused">{refusal(connect)}</Banner>}
        {refusal(disconnect) && <Banner tone="error">{refusal(disconnect)}</Banner>}
        <WriteFeedback status={connect.status.phase === "refused" ? { phase: "idle" } : connect.status} working={busy} serverNote={null} onCheckServer={() => void check()} />
        <WriteFeedback status={disconnect.status.phase === "refused" ? { phase: "idle" } : disconnect.status} working={busy} serverNote={null} onCheckServer={() => void check()} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]" aria-labelledby="sender-profile">
        <h2 id="sender-profile" className="text-base font-semibold text-gray-900 dark:text-white">Người gửi</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Email &ldquo;From&rdquo; luôn là Gmail đã kết nối{sender.connectedEmail ? ` (${sender.connectedEmail})` : ""}. Khi đổi tài khoản, email chưa từng được thử gửi sẽ đi từ tài khoản mới; email đã thử gửi từ tài khoản cũ sẽ bị huỷ để khách đăng ký lại, không bao giờ âm thầm đổi người gửi.
        </p>
        <TextField label="Tên người gửi" value={name} onChange={setName} maxLength={100} testId="sender-name" error={fieldError(profile, "senderName")} placeholder="The BHA" />
        <TextField label="Reply-To (tuỳ chọn)" value={replyTo} onChange={setReplyTo} maxLength={254} testId="sender-reply-to" error={fieldError(profile, "replyTo")} placeholder="letan@thebha.vn" />
        <div>
          <ActionButton onClick={() => void saveProfile()} disabled={locked || (name.trim() === (sender.senderName ?? "") && replyTo.trim() === (sender.replyTo ?? ""))} testId="sender-save-profile">Lưu</ActionButton>
        </div>
        {refusal(profile) && !fieldError(profile, "senderName") && !fieldError(profile, "replyTo") && (
          <Banner tone="error" testId="sender-profile-refused">
            {refusal(profile)}{" "}
            {profile.status.phase === "refused" && profile.status.failure.code === "newsletter-sender-version-conflict" && <button type="button" className="font-medium underline" onClick={() => void check()}>Tải lại</button>}
          </Banner>
        )}
        <WriteFeedback status={profile.status.phase === "refused" ? { phase: "idle" } : profile.status} working={busy} serverNote={null} onCheckServer={() => void check()} />
      </section>
    </div>
  );
}
