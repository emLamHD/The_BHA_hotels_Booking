"use client";

import { useMemo, useState } from "react";
import Checkbox from "@/components/form/input/Checkbox";
import { getSocialSettings, saveSocialSettings, type SocialSettingsDraft, type WebsiteSocialSettings } from "@/lib/api/website";
import { useLeaveGuard } from "./useLeaveGuard";
import { useWebsiteList, useWriteAction } from "./useWebsiteData";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, TextField, WriteFeedback, formatWhen } from "./WebsiteUi";

const draftOf = (value: WebsiteSocialSettings): SocialSettingsDraft => ({ phoneEnabled: value.phoneEnabled, phoneNumber: value.phoneNumber,
  messengerEnabled: value.messengerEnabled, messengerUrl: value.messengerUrl, zaloEnabled: value.zaloEnabled,
  zaloNumber: value.zaloNumber, backToTopEnabled: value.backToTopEnabled });
const same = (a: SocialSettingsDraft, b: SocialSettingsDraft) => JSON.stringify(a) === JSON.stringify(b);

export default function SocialMediaPanel() {
  const list = useWebsiteList(getSocialSettings, []);
  if (list.state.status === "loading") return <LoadingPanel what="cấu hình Social media" />;
  if (list.state.status === "error") return <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />;
  return <Editor initial={list.state.data} reload={list.reload} />;
}

function Editor({ initial, reload }: { initial: WebsiteSocialSettings; reload: () => Promise<WebsiteSocialSettings | null> }) {
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState<SocialSettingsDraft>(draftOf(initial));
  const [saved, setSaved] = useState<string | null>(null);
  const write = useWriteAction();
  const dirty = !same(draft, draftOf(base));
  useLeaveGuard(dirty, "Bạn có thay đổi Social media chưa lưu. Rời trang này sẽ bỏ chúng. Vẫn rời đi?");
  const previewZalo = useMemo(() => {
    const digits = (draft.zaloNumber ?? "").replace(/[ .()\-]/g, "");
    const vn = digits.startsWith("+84") ? `0${digits.slice(3)}` : digits;
    return /^0\d{9}$/.test(vn) ? `https://zalo.me/${vn}` : null;
  }, [draft.zaloNumber]);
  const locked = write.status.phase === "pending" || write.status.phase === "unverified";
  const save = async () => {
    if (!dirty || locked) return;
    setSaved(null);
    const result = await write.run(() => saveSocialSettings(base.revision, draft));
    if (result?.kind === "ok") { setBase(result.data); setDraft(draftOf(result.data)); setSaved(`Đã lưu lúc ${formatWhen(result.data.updatedAtUtc)}. Tab Customer đang mở cập nhật trong tối đa 15 giây.`); }
  };
  const check = async () => { const fresh = await reload(); if (fresh) { setBase(fresh); write.reset(); if (same(draft, draftOf(fresh))) setDraft(draftOf(fresh)); } };
  const fieldError = (name: string) => write.status.phase === "refused" && write.status.failure.field === name ? write.status.failure.detail : undefined;
  const patch = (value: Partial<SocialSettingsDraft>) => setDraft(current => ({ ...current, ...value }));
  return <div className="flex max-w-3xl flex-col gap-4">
    <PageHeader title="Social media">Cấu hình cụm liên hệ nổi của Customer Web. Thứ tự Phone → Messenger → Zalo và ngưỡng Về đầu trang 400 px được cố định.</PageHeader>
    {saved && <Banner tone="success" testId="social-saved">{saved}</Banner>}
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">{dirty ? <span className="text-warning-700 dark:text-warning-300">Có thay đổi chưa lưu</span> : <>Đã lưu — phiên bản {base.revision}, {formatWhen(base.updatedAtUtc)}.</>}</p>
      <Channel title="Điện thoại" enabled={draft.phoneEnabled} onEnabled={v => patch({ phoneEnabled: v })}>
        <TextField label="Số điện thoại" value={draft.phoneNumber} onChange={v => patch({ phoneNumber: v })} error={fieldError("phoneNumber")} />
        <p className="text-xs text-gray-500 dark:text-gray-400">Link gọi hiện tại: {base.phoneHref}</p>
      </Channel>
      <Channel title="Messenger" enabled={draft.messengerEnabled} onEnabled={v => patch({ messengerEnabled: v })}>
        <TextField label="Link chat Messenger" value={draft.messengerUrl ?? ""} onChange={v => patch({ messengerUrl: v || null })} error={fieldError("messengerUrl")} />
        <p className="text-xs text-gray-500 dark:text-gray-400">Lấy username thật của Facebook Page, tạo <code>https://m.me/&lt;username-cua-trang&gt;</code>, tự mở thử link rồi mới bật và Lưu. Không dùng display name.</p>
      </Channel>
      <Channel title="Zalo" enabled={draft.zaloEnabled} onEnabled={v => patch({ zaloEnabled: v })}>
        <TextField label="Số điện thoại Zalo" value={draft.zaloNumber ?? ""} onChange={v => patch({ zaloNumber: v || null })} error={fieldError("zaloNumber")} />
        <p className="text-xs text-gray-500 dark:text-gray-400">Nhập đúng số gắn với tài khoản cần nhận liên hệ, tự mở thử link rồi mới bật và Lưu.</p>
        <p className="text-sm text-gray-700 dark:text-gray-300">Preview: {previewZalo ? <a className="text-brand-600 underline dark:text-brand-400" href={previewZalo} target="_blank" rel="noopener noreferrer">{previewZalo}</a> : "Chưa có link hợp lệ"}</p>
      </Channel>
      <Channel title="Về đầu trang" enabled={draft.backToTopEnabled} onEnabled={v => patch({ backToTopEnabled: v })}><p className="text-xs text-gray-500 dark:text-gray-400">Hiện sau khi cuộn quá 400 px.</p></Channel>
      <div className="mt-5 flex gap-2"><ActionButton variant="outline" onClick={() => { setDraft(draftOf(base)); write.reset(); }} disabled={!dirty || locked}>Huỷ</ActionButton><ActionButton onClick={() => void save()} disabled={!dirty || locked}>{write.status.phase === "pending" ? "Đang lưu…" : "Lưu"}</ActionButton></div>
    </div>
    <WriteFeedback status={write.status} working={write.status.phase === "pending"} serverNote={null} onReloadLatest={() => void check()} onCheckServer={() => void check()} fieldErrorOf={() => false} />
  </div>;
}

function Channel({ title, enabled, onEnabled, children }: { title: string; enabled: boolean; onEnabled: (value: boolean) => void; children: React.ReactNode }) {
  return <section className="border-t border-gray-100 py-4 dark:border-gray-800"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-gray-800 dark:text-white/90">{title}</h2><Checkbox checked={enabled} onChange={onEnabled} label={enabled ? "Bật" : "Tắt"} /></div><div className="space-y-2">{children}</div></section>;
}
