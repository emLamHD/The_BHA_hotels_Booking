"use client";

/**
 * BHA-BLOG-001-CP03: the Blog settings the backend has — which category the home page section shows (`HomeSectionCategoryId`, linked by id, so renaming
 * the category changes nothing). Written with BlogPublish against the settings version. Nothing else is shown because nothing else exists.
 *
 * Writes (C3): the version a save carries is the one the screen BASES the choice on (`base`), pinned when the settings are first read and moved only by a
 * save's own answer or by the person's explicit choice in the comparison — never by a re-read. A stale version shows the server's value beside the local choice
 * and locks Save until the person decides. A lost answer is judged against the choice and version that were SENT (an immutable snapshot), not the select as it
 * is now.
 */

import React, { useEffect, useRef, useState } from "react";
import { getSettings, listCategories, saveSettings, type BlogCategory, type BlogSettings } from "@/lib/api/blog";
import { describeBlogFailure } from "@/lib/blog/blogModel";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader } from "@/components/website/WebsiteUi";
import BlogWriteFeedback from "./BlogWriteFeedback";
import { useBlogRights } from "./BlogAccessGate";
import { useWebsiteHost } from "@/components/website/WebsiteAccessGate";
import { useActiveLanguages } from "./useBlogReference";

const nameOf = (category: BlogCategory, locales: string[]) => {
  for (const locale of locales) if (category.translations[locale]?.name) return category.translations[locale].name;
  return Object.values(category.translations)[0]?.name ?? "(chưa có tên)";
};

/** What one Save sent. Never changes after it is taken. */
interface Snapshot {
  expectedVersion: number;
  choice: string | null;
}

/** The server's settings beside the local choice, kept apart from the screen's base until the person chooses. */
interface Conflict {
  fresh: BlogSettings;
  mine: string | null;
  mineVersion: number;
  askUseServer: boolean;
}

export default function SettingsScreen() {
  const rights = useBlogRights();
  const host = useWebsiteHost();
  const settings = useWebsiteList((signal) => getSettings(signal), []);
  const categories = useWebsiteList((signal) => listCategories(signal), []);
  const languages = useActiveLanguages();
  const write = useWriteAction();
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [pinned, setPinned] = useState<BlogSettings | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);

  // The settings the choice is based on. The hook's data is read once, and a later re-read must not move the version a save carries.
  const loaded = settings.state.status === "ready" ? settings.state.data : null;
  const base = pinned ?? loaded;
  const current = choice === undefined ? (base?.homeSectionCategoryId ?? null) : choice;
  const dirty = base !== null && choice !== undefined && choice !== base.homeSectionCategoryId;
  useEffect(() => {
    host.setUnsaved(dirty);
    return () => host.setUnsaved(false);
  }, [dirty, host]);

  if (settings.state.status === "loading" || categories.state.status === "loading") return <LoadingPanel what="cấu hình Blog" />;
  if (settings.state.status === "error") return <ErrorPanel message={settings.state.message} onRetry={() => void settings.reload()} />;
  if (categories.state.status === "error") return <ErrorPanel message={categories.state.message} onRetry={() => void categories.reload()} />;
  const list = categories.state.status === "ready" ? categories.state.data : [];
  const locales = languages.status === "ready" ? languages.data.map((l) => l.code) : ["vi"];
  const working = write.status.phase === "pending";
  const labelOf = (id: string | null) => (id === null ? "— Không chọn —" : (() => { const found = list.find((c) => c.id === id); return found ? nameOf(found, locales) : `(chuyên mục không còn trong danh sách) ${id}`; })());

  const doSave = async () => {
    if (!base || conflict) return;
    const snap: Snapshot = { expectedVersion: base.version, choice: current };
    snapshotRef.current = snap;
    setNote(null);
    const result = await write.run(() => saveSettings(snap.expectedVersion, snap.choice));
    if (result?.kind === "ok") {
      snapshotRef.current = null;
      setPinned(result.data); // the answer is the new base (version and value), so no re-read is needed to know what to send next
      setChoice(undefined);
      void categories.reload();
    }
  };

  /** After a stale version (409): read the server's settings and show them BESIDE the local choice. The base (and so the version a save carries) does not move. */
  const reloadLatest = async () => {
    if (!base) return;
    const result = await getSettings();
    if (result.kind !== "ok") {
      setNote(`${describeBlogFailure(result)} Chưa tải được cấu hình mới nhất; lựa chọn của bạn vẫn còn, hãy thử lại.`);
      return;
    }

    write.reset();
    setConflict({ fresh: result.data, mine: current, mineVersion: base.version, askUseServer: false });
    setNote(`Cấu hình đã được thay đổi trên máy chủ (phiên bản ${result.data.version}). Xem so sánh bên dưới rồi chọn; chưa có gì được gửi.`);
  };

  /** The answer to a save was lost. Read, and judge what the server shows against what was SENT; nothing is sent from here. */
  const checkServer = async () => {
    const snap = snapshotRef.current;
    if (!snap || !base) return;
    const result = await getSettings();
    if (snapshotRef.current !== snap) return;
    if (result.kind !== "ok") {
      setNote(`${describeBlogFailure(result)} Chưa kiểm tra được máy chủ; lựa chọn của bạn vẫn còn và thao tác vẫn là chưa xác nhận, hãy thử kiểm tra lại.`);
      return;
    }

    const fresh = result.data;
    const matches = fresh.homeSectionCategoryId === snap.choice;
    snapshotRef.current = null;
    write.reset();
    if (matches && fresh.version > snap.expectedVersion) {
      setPinned(fresh);
      // A choice made after the send is a newer, unsaved edit: it stays, on top of the version that was confirmed.
      setChoice((live) => (live === undefined || live === snap.choice ? undefined : live));
      setNote(`Máy chủ đã có đúng lựa chọn đã gửi (phiên bản ${fresh.version}). Đây là kết quả đọc lại, không phải gửi lại.`);
    } else if (matches) {
      setNote(`Máy chủ đang có đúng giá trị này nhưng phiên bản chưa đổi (${fresh.version}), nên chưa đủ bằng chứng rằng lần lưu này đã chạy. Bạn có thể lưu lại.`);
    } else if (fresh.version === snap.expectedVersion) {
      setNote("Máy chủ chưa có thay đổi của bạn. Bạn có thể lưu lại.");
    } else {
      // `mine` is what the select shows NOW (the person may have changed it while the answer was missing); the snapshot only decided what happened to the send.
      setConflict({ fresh, mine: current, mineVersion: snap.expectedVersion, askUseServer: false });
      setNote(`Cấu hình đã đổi trên máy chủ (phiên bản ${fresh.version}) thành một giá trị khác lựa chọn đã gửi. Xem so sánh bên dưới; chưa có gì được gửi.`);
    }
  };

  const keepMine = () => {
    if (!conflict) return;
    // The ONLY place the version moves by choice: the person has seen both and writes theirs on top of the server's version.
    setPinned(conflict.fresh);
    setChoice(conflict.mine === conflict.fresh.homeSectionCategoryId ? undefined : conflict.mine);
    setConflict(null);
    setNote(`Giữ lựa chọn của bạn trên phiên bản ${conflict.fresh.version}. Chưa có gì được gửi — bấm Lưu để ghi.`);
  };

  const useServerCopy = () => {
    if (!conflict) return;
    setPinned(conflict.fresh);
    setChoice(undefined);
    setConflict(null);
    setNote(`Đã dùng cấu hình trên máy chủ (phiên bản ${conflict.fresh.version}); lựa chọn chưa lưu của bạn đã bị bỏ.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cấu hình Blog">Mục “Điểm đến nổi bật” trên trang chủ lấy bài từ một chuyên mục. Liên kết bằng mã chuyên mục: đổi tên chuyên mục không làm mất liên kết.</PageHeader>
      <section className="flex max-w-xl flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <label className="text-sm font-medium text-gray-800 dark:text-white/90" htmlFor="home-section">Chuyên mục của mục trang chủ</label>
        <select id="home-section" data-testid="home-section-select" value={current ?? ""} disabled={!rights.publish || working || conflict !== null} onChange={(e) => setChoice(e.target.value === "" ? null : e.target.value)}
          className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90">
          <option value="">— Không chọn —</option>
          {list.map((category) => <option key={category.id} value={category.id}>{nameOf(category, locales)}{category.systemKey ? " (mặc định)" : ""}</option>)}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-400">Phiên bản cấu hình: {base?.version}. Thay đổi có hiệu lực ngay khi lưu; Customer chưa nối với API Blog ở bước này.</p>
        {!rights.publish && <Banner tone="info">Chỉ tài khoản có quyền xuất bản Blog mới đổi được cấu hình.</Banner>}
        {note && <Banner tone="info" testId="settings-note">{note}</Banner>}
        {conflict && (
          <Banner tone="warning" testId="settings-conflict">
            <p className="font-medium">Lựa chọn của bạn (dựa trên phiên bản {conflict.mineVersion}) khác cấu hình trên máy chủ (phiên bản {conflict.fresh.version}).</p>
            <table className="mt-2 w-full text-left text-xs">
              <thead><tr><th className="pr-3">Trường</th><th className="pr-3">Của bạn</th><th>Trên máy chủ</th></tr></thead>
              <tbody><tr className={conflict.mine !== conflict.fresh.homeSectionCategoryId ? "font-semibold" : ""}><td className="pr-3 align-top">Chuyên mục trang chủ</td><td className="pr-3 align-top break-words">{labelOf(conflict.mine)}</td><td className="align-top break-words">{labelOf(conflict.fresh.homeSectionCategoryId)}</td></tr></tbody>
            </table>
            {conflict.askUseServer ? (
              <div className="mt-3">
                <p className="text-xs">Bỏ lựa chọn của bạn và dùng cấu hình của máy chủ? Lựa chọn chưa lưu của bạn sẽ mất.</p>
                <div className="mt-2 flex gap-2"><ActionButton onClick={useServerCopy} testId="settings-conflict-confirm">Đồng ý, dùng cấu hình máy chủ</ActionButton><ActionButton variant="outline" onClick={() => setConflict({ ...conflict, askUseServer: false })}>Không</ActionButton></div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton variant="outline" onClick={keepMine} testId="settings-conflict-keep">Giữ lựa chọn của tôi trên phiên bản {conflict.fresh.version}</ActionButton>
                <ActionButton variant="outline" onClick={() => setConflict({ ...conflict, askUseServer: true })} testId="settings-conflict-use-server">Dùng cấu hình của máy chủ…</ActionButton>
              </div>
            )}
            <p className="mt-2 text-xs">Không có lựa chọn nào tự gửi gì lên máy chủ; “Giữ lựa chọn của tôi” sẽ ghi đè giá trị trên máy chủ ở lần bấm Lưu tiếp theo.</p>
          </Banner>
        )}
        <BlogWriteFeedback status={write.status} working={working} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkServer()} />
        <div><ActionButton onClick={() => void doSave()} disabled={!rights.publish || working || !dirty || conflict !== null || write.status.phase === "unverified"} testId="settings-save">Lưu cấu hình</ActionButton></div>
      </section>
    </div>
  );
}
