"use client";

import { useState, type FormEvent } from "react";
import {
  archiveNewsletterSubscription,
  createNewsletterSubscription,
  deleteNewsletterSubscription,
  restoreNewsletterSubscription,
  unsubscribeNewsletterSubscription,
  updateNewsletterSubscription,
  type NewsletterLanguage,
  type NewsletterSubscription,
  type WebsiteResult,
} from "@/lib/api/website";
import { refusalText } from "@/lib/website/wording";
import { useWriteAction } from "./useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, TextField } from "./WebsiteUi";
import { LANGUAGE_LABEL } from "./newsletterSubscriptionWording";

const SELECT_CLASSES =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export function LanguageSelect({ value, onChange, disabled }: { value: NewsletterLanguage; onChange: (value: NewsletterLanguage) => void; disabled: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
      Ngôn ngữ email
      <select data-testid="newsletter-language" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as NewsletterLanguage)} className={SELECT_CLASSES}>
        {(Object.keys(LANGUAGE_LABEL) as NewsletterLanguage[]).map((code) => (
          <option key={code} value={code}>{LANGUAGE_LABEL[code]}</option>
        ))}
      </select>
    </label>
  );
}

/** The screen's one write slot (shared by every dialog and the invitation, so a hold survives a dialog being closed) and the way back from an unknown outcome. */
export type WriteHandle = ReturnType<typeof useWriteAction>;
export type Reconcile = { run: () => void; reading: boolean; failed: boolean };

export const VERSION_CONFLICT = "newsletter-version-conflict";

/**
 * What a refused or lost write says inside a dialog. A version conflict is a CERTAIN refusal (nothing was applied) that leaves the dialog holding a row it now knows is
 * stale: `reload` is the way on (the screen reads the list again and, once that succeeds, closes the dialog so the row is opened again from fresh data).
 */
export function WriteOutcome({ status, reload, reconcile }: { status: WriteHandle["status"]; reload?: Reconcile; reconcile?: Reconcile }) {
  if (status.phase === "pending") return <Banner tone="info" testId="newsletter-write-pending">Đang gửi yêu cầu… chờ máy chủ trả lời.</Banner>;
  if (status.phase === "refused") {
    const stale = status.failure.code === VERSION_CONFLICT;
    return (
      <Banner tone="error" testId="newsletter-write-refused">
        <p className="font-medium">{refusalText(status.failure)}</p>
        {stale && reload && (
          <>
            <p className="mt-1">
              Chưa có gì được thay đổi, và bản đang xem không còn dùng để thao tác được nên sẽ không được gửi lại.{" "}
              <button type="button" onClick={reload.run} disabled={reload.reading} className="font-medium underline disabled:opacity-50" data-testid="newsletter-reload-latest">
                {reload.reading ? "Đang đọc lại…" : "Tải lại danh sách"}
              </button>{" "}
              rồi mở lại bản ghi từ danh sách để thao tác tiếp.
            </p>
            {reload.failed && !reload.reading && (
              <p className="mt-1 font-medium" data-testid="newsletter-reload-failed">Chưa đọc lại được từ máy chủ nên chưa thể thao tác tiếp trên bản ghi này: hãy thử đọc lại.</p>
            )}
          </>
        )}
      </Banner>
    );
  }
  if (status.phase === "failed") return <Banner tone="error" testId="newsletter-write-failed">{status.message} Chưa có gì được thay đổi.</Banner>;
  if (status.phase === "unverified") {
    return (
      <Banner tone="warning" testId="newsletter-write-unverified">
        <p>{status.message} Kết quả thao tác trước chưa rõ: máy chủ có thể đã ghi nhận hoặc chưa.</p>
        <p className="mt-1">Hệ thống không tự gửi lại, và mọi thao tác ghi bị khóa cho tới khi đọc lại được trạng thái từ máy chủ.</p>
        {reconcile && (
          <p className="mt-2">
            <button type="button" onClick={reconcile.run} disabled={reconcile.reading} className="font-medium underline disabled:opacity-50" data-testid="newsletter-reconcile">
              {reconcile.reading ? "Đang đọc lại…" : "Đọc lại trạng thái"}
            </button>
          </p>
        )}
        {reconcile?.failed && !reconcile.reading && (
          <p className="mt-1 font-medium" data-testid="newsletter-reconcile-failed">Chưa đọc lại được từ máy chủ. Các thao tác ghi vẫn bị khóa: hãy thử đọc lại.</p>
        )}
      </Banner>
    );
  }
  return null;
}

export function AddSubscriptionDialog({ write, reconcile, onClose, onDone, onOpenExisting }: {
  write: WriteHandle;
  reconcile: Reconcile;
  onClose: () => void;
  onDone: (row: NewsletterSubscription) => void;
  onOpenExisting: (email: string, archived: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<NewsletterLanguage>("vi");
  const busy = write.status.phase === "pending";
  const locked = busy || write.held;
  const duplicate = write.status.phase === "refused" && write.status.failure.code === "newsletter-subscription-duplicate" ? write.status.failure : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await write.run(() => createNewsletterSubscription({ email: email.trim(), language }));
    if (result?.kind === "ok") onDone(result.data);
  };

  return (
    <DialogShell title="Thêm đăng ký nhận tin" onClose={onClose} busy={busy} testId="newsletter-add-dialog">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Banner tone="info">
          Địa chỉ được ghi nhận từ <strong>Admin</strong> ở trạng thái <strong>Chờ xác minh</strong> và chưa có thư nào được gửi. Chỉ chủ hộp thư mới xác minh được: dùng <em>Gửi lời mời xác minh</em> ở dòng đó.
        </Banner>
        <TextField label="Email" value={email} onChange={setEmail} maxLength={254} placeholder="ten@example.com" disabled={locked} autoFocus testId="newsletter-add-email" />
        <LanguageSelect value={language} onChange={setLanguage} disabled={locked} />
        <WriteOutcome status={write.status} reconcile={reconcile} />
        {duplicate?.existingId && (
          <p className="text-sm text-gray-700 dark:text-gray-200">
            <button type="button" className="font-medium text-brand-600 underline dark:text-brand-400" data-testid="newsletter-open-existing" onClick={() => onOpenExisting(email.trim().toLowerCase(), duplicate.existingArchived === true)}>
              Mở bản ghi hiện có
            </button>
            {duplicate.existingArchived ? " (đang được lưu trữ)" : ""}
          </p>
        )}
        <DialogActions>
          <ActionButton variant="outline" onClick={onClose} disabled={busy} testId="newsletter-add-cancel">Hủy</ActionButton>
          <ActionButton type="submit" disabled={locked || email.trim() === ""} testId="newsletter-add-submit">Thêm đăng ký</ActionButton>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

export function EditSubscriptionDialog({ row, write, reconcile, reload, stale, onStale, onClose, onDone }: {
  row: NewsletterSubscription;
  write: WriteHandle;
  reconcile: Reconcile;
  reload: Reconcile;
  /** The server said this row's version moved: nothing more is sent with it. */
  stale: boolean;
  onStale: () => void;
  onClose: () => void;
  onDone: (row: NewsletterSubscription) => void;
}) {
  const [email, setEmail] = useState(row.email);
  const [language, setLanguage] = useState<NewsletterLanguage>(row.language);
  const busy = write.status.phase === "pending";
  const locked = busy || write.held || stale;
  const emailChanged = email.trim().toLowerCase() !== row.email;
  const languageChanged = language !== row.language;
  const needsReset = emailChanged && row.status !== "PendingVerification";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (stale) return;                                                              // the disabled button is not the guard: Enter or a direct submit gets here too
    const input = { expectedVersion: row.version, ...(emailChanged ? { email: email.trim() } : {}), ...(languageChanged ? { language } : {}) };
    const result = await write.run(() => updateNewsletterSubscription(row.id, input));
    if (result?.kind === "ok") onDone(result.data);
    else if (result?.kind === "refused" && result.code === VERSION_CONFLICT) onStale();
  };

  return (
    <DialogShell title="Sửa đăng ký" onClose={onClose} busy={busy} testId="newsletter-edit-dialog">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Email" value={email} onChange={setEmail} maxLength={254} disabled={locked} autoFocus testId="newsletter-edit-email" />
        <LanguageSelect value={language} onChange={setLanguage} disabled={locked} />
        {emailChanged && (
          <Banner tone="warning" testId="newsletter-edit-email-warning">
            Đổi địa chỉ đưa đăng ký về <strong>Chờ xác minh</strong>{needsReset ? ` (hiện là ${row.status === "Verified" ? "Đã xác minh" : "Đã ngừng nhận"})` : ""}, vô hiệu mọi liên kết đã gửi tới địa chỉ cũ và hủy các thư đang chờ gửi cho nó. Chủ hộp thư mới phải tự xác minh.
          </Banner>
        )}
        {!emailChanged && languageChanged && <Banner tone="info">Đổi ngôn ngữ giữ nguyên trạng thái xác minh. Thư đang chờ sẽ viết bằng ngôn ngữ mới.</Banner>}
        <WriteOutcome status={write.status} reload={reload} reconcile={reconcile} />
        <DialogActions>
          <ActionButton variant="outline" onClick={onClose} disabled={busy} testId="newsletter-edit-cancel">Hủy</ActionButton>
          <ActionButton type="submit" disabled={locked || email.trim() === "" || (!emailChanged && !languageChanged)} testId="newsletter-edit-submit">Lưu thay đổi</ActionButton>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

export type ConfirmAction = "unsubscribe" | "archive" | "restore" | "delete";

const CONFIRM_TEXT: Record<ConfirmAction, { title: string; button: string; body: (email: string) => React.ReactNode; tone: "warning" | "error" | "info" }> = {
  unsubscribe: {
    title: "Ngừng gửi cho email này?", button: "Ngừng nhận tin", tone: "warning",
    body: (email) => <>Từ nay <strong>{email}</strong> không nhận email của The BHA, và các thư đang chờ gửi cho địa chỉ này bị hủy. Địa chỉ chỉ nhận lại khi chính khách đăng ký lại và xác nhận qua email.</>,
  },
  archive: {
    title: "Lưu trữ đăng ký này?", button: "Lưu trữ", tone: "info",
    body: (email) => <><strong>{email}</strong> sẽ ẩn khỏi danh sách mặc định và các thư đang chờ gửi bị hủy. Lưu trữ không đổi việc khách đã đồng ý hay chưa, và bạn có thể khôi phục.</>,
  },
  restore: {
    title: "Khôi phục đăng ký này?", button: "Khôi phục", tone: "info",
    body: (email) => <><strong>{email}</strong> sẽ hiện lại trong danh sách mặc định. Các thư đã bị hủy khi lưu trữ không được gửi lại.</>,
  },
  delete: {
    title: "Xóa vĩnh viễn đăng ký này?", button: "Xóa vĩnh viễn", tone: "error",
    body: (email) => <>Bạn sắp xóa <strong>{email}</strong>. Không thể hoàn tác: dòng đăng ký, các liên kết xác nhận và hủy nhận tin đã gửi cho địa chỉ này, và mọi thư đang chờ gửi đều bị xóa. Lịch sử thao tác chỉ giữ ai làm gì và khi nào, không giữ email.</>,
  },
};

const SEND: Record<ConfirmAction, (row: NewsletterSubscription) => Promise<WebsiteResult<unknown>>> = {
  unsubscribe: (row) => unsubscribeNewsletterSubscription(row.id, row.version),
  archive: (row) => archiveNewsletterSubscription(row.id, row.version),
  restore: (row) => restoreNewsletterSubscription(row.id, row.version),
  delete: (row) => deleteNewsletterSubscription(row.id, row.version),
};

export function ConfirmSubscriptionDialog({ action, row, write, reconcile, reload, stale, onStale, onClose, onDone }: {
  action: ConfirmAction;
  row: NewsletterSubscription;
  write: WriteHandle;
  reconcile: Reconcile;
  reload: Reconcile;
  stale: boolean;
  onStale: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const busy = write.status.phase === "pending";
  const locked = busy || write.held || stale;
  const text = CONFIRM_TEXT[action];

  const submit = async () => {
    if (stale) return;
    const result = await write.run(() => SEND[action](row));
    if (result?.kind === "ok") onDone();
    else if (result?.kind === "refused" && result.code === VERSION_CONFLICT) onStale();
  };

  return (
    <DialogShell title={text.title} onClose={onClose} busy={busy} testId={`newsletter-${action}-dialog`}>
      <Banner tone={text.tone}>{text.body(row.email)}</Banner>
      <WriteOutcome status={write.status} reload={reload} reconcile={reconcile} />
      <DialogActions>
        <ActionButton variant="outline" onClick={onClose} disabled={busy} testId={`newsletter-${action}-cancel`}>Hủy</ActionButton>
        <ActionButton onClick={() => void submit()} disabled={locked} testId={`newsletter-${action}-confirm`}>{text.button}</ActionButton>
      </DialogActions>
    </DialogShell>
  );
}
