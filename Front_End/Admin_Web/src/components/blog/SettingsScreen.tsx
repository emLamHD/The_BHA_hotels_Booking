"use client";

/**
 * BHA-BLOG-001-CP03: the Blog settings the backend has — which category the home page section shows (`HomeSectionCategoryId`, linked by id, so renaming
 * the category changes nothing). Written with BlogPublish against the settings version. Nothing else is shown because nothing else exists.
 */

import React, { useEffect, useState } from "react";
import { getSettings, listCategories, saveSettings, type BlogCategory } from "@/lib/api/blog";
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

export default function SettingsScreen() {
  const rights = useBlogRights();
  const host = useWebsiteHost();
  const settings = useWebsiteList((signal) => getSettings(signal), []);
  const categories = useWebsiteList((signal) => listCategories(signal), []);
  const languages = useActiveLanguages();
  const write = useWriteAction();
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);

  const server = settings.state.status === "ready" ? settings.state.data : null;
  const current = choice === undefined ? (server?.homeSectionCategoryId ?? null) : choice;
  const dirty = server !== null && choice !== undefined && choice !== server.homeSectionCategoryId;
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

  const doSave = async () => {
    if (!server) return;
    const result = await write.run(() => saveSettings(server.version, current));
    if (result?.kind === "ok") {
      setChoice(undefined);
      setNote(null);
      void settings.reload();
      void categories.reload();
    }
  };
  const reloadLatest = async () => {
    const latest = await settings.reload();
    if (latest) {
      write.reset();
      setNote("Đã tải cấu hình mới nhất; lựa chọn chưa lưu của bạn được giữ để so sánh với giá trị trên máy chủ.");
    }
  };
  const checkServer = async () => {
    const latest = await settings.reload();
    if (!latest) return;
    if (latest.homeSectionCategoryId === current && latest.version !== server?.version) {
      setChoice(undefined);
      write.reset();
      setNote("Máy chủ đã có đúng lựa chọn của bạn; thay đổi đã được lưu.");
    } else {
      setNote("Máy chủ chưa có thay đổi của bạn. Bạn có thể lưu lại.");
      write.reset();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cấu hình Blog">Mục “Điểm đến nổi bật” trên trang chủ lấy bài từ một chuyên mục. Liên kết bằng mã chuyên mục: đổi tên chuyên mục không làm mất liên kết.</PageHeader>
      <section className="flex max-w-xl flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <label className="text-sm font-medium text-gray-800 dark:text-white/90" htmlFor="home-section">Chuyên mục của mục trang chủ</label>
        <select id="home-section" data-testid="home-section-select" value={current ?? ""} disabled={!rights.publish || working} onChange={(e) => setChoice(e.target.value === "" ? null : e.target.value)}
          className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90">
          <option value="">— Không chọn —</option>
          {list.map((category) => <option key={category.id} value={category.id}>{nameOf(category, locales)}{category.systemKey ? " (mặc định)" : ""}</option>)}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-400">Phiên bản cấu hình: {server?.version}. Thay đổi có hiệu lực ngay khi lưu; Customer chưa nối với API Blog ở bước này.</p>
        {!rights.publish && <Banner tone="info">Chỉ tài khoản có quyền xuất bản Blog mới đổi được cấu hình.</Banner>}
        {note && <Banner tone="info" testId="settings-note">{note}</Banner>}
        <BlogWriteFeedback status={write.status} working={working} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkServer()} />
        <div><ActionButton onClick={() => void doSave()} disabled={!rights.publish || working || !dirty || write.status.phase === "unverified"} testId="settings-save">Lưu cấu hình</ActionButton></div>
      </section>
    </div>
  );
}
