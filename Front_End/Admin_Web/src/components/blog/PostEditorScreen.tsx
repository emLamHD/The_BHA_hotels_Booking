"use client";

/**
 * BHA-BLOG-001-CP03: one post — a tab per website language, each tab a `TranslationForm`. The screen owns what is shared between languages: the post as last
 * read, the lists the form needs (categories, languages, Properties), the one picture picker, and the rule that you cannot change language while a write is
 * on the wire, nor leave unsaved edits without being asked.
 */

import React, { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getPost, listCategories, type BlogPost } from "@/lib/api/blog";
import type { WebsiteResult } from "@/lib/api/website";
import { useWebsiteList } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader } from "@/components/website/WebsiteUi";
import { STATUS_LABEL, translationOf } from "@/lib/blog/blogModel";
import TranslationForm, { type PickMedia, type TranslationStatusReport } from "./TranslationForm";
import MediaPickerDialog from "./MediaPickerDialog";
import type { PickedMedia } from "./BodyEditorContext";
import { useActiveLanguages, useActiveProperties } from "./useBlogReference";
import { useBlogRights } from "./BlogAccessGate";

interface PickerRequest {
  options: { multiple: boolean; min?: number; max?: number; title: string };
  resolve: (picked: PickedMedia[] | null) => void;
}

export default function PostEditorScreen({ postId }: { postId: string | null }) {
  const rights = useBlogRights();
  const router = useRouter();
  const search = useSearchParams();
  const languages = useActiveLanguages();
  // Read again only when the person asks (the retry of the error below): never on a timer, never as a side effect of anything else.
  const [propertiesAttempt, setPropertiesAttempt] = useState(0);
  const properties = useActiveProperties(propertiesAttempt);
  const categories = useWebsiteList((signal) => listCategories(signal), []);
  const loaded = useWebsiteList<BlogPost | null>(
    async (signal): Promise<WebsiteResult<BlogPost | null>> => (postId === null ? { kind: "ok", data: null } : getPost(postId, signal)),
    [postId]
  );
  const [clientId] = useState(() => crypto.randomUUID());
  const [post, setPost] = useState<BlogPost | null>(null);
  const [locale, setLocale] = useState<string | null>(search.get("locale"));
  const [report, setReport] = useState<TranslationStatusReport>({ dirty: false, busy: false });
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const pickerOpen = useRef(false);

  const current = post ?? (loaded.state.status === "ready" ? loaded.state.data : null);
  const pickMedia = useCallback<PickMedia>(
    (options) =>
      new Promise((resolve) => {
        if (pickerOpen.current) return resolve(null);
        pickerOpen.current = true;
        setPicker({ options, resolve: (picked) => { pickerOpen.current = false; setPicker(null); resolve(picked); } });
      }),
    []
  );
  const onStatus = useCallback((next: TranslationStatusReport) => setReport((previous) => (previous.dirty === next.dirty && previous.busy === next.busy ? previous : next)), []);
  const onPost = useCallback((next: BlogPost) => setPost((previous) => (previous === null || previous.id === next.id ? next : previous)), []);
  const onCreated = useCallback((next: BlogPost) => { setPost(next); router.replace(`/website/blog/posts/${next.id}?locale=${encodeURIComponent(locale ?? "vi")}`); }, [router, locale]);

  const waiting = loaded.state.status === "loading" || languages.status === "loading" || categories.state.status === "loading" || properties.status === "loading";
  if (waiting) return <LoadingPanel what="bài viết" />;
  if (loaded.state.status === "error") return <ErrorPanel message={loaded.state.message} onRetry={() => void loaded.reload()} />;
  if (languages.status === "error") return <ErrorPanel message={languages.message} onRetry={() => window.location.reload()} />;
  if (categories.state.status === "error") return <ErrorPanel message={categories.state.message} onRetry={() => void categories.reload()} />;
  // The active Properties are an input of the editor (the property-intro block offers them): a failed lookup is not an empty list. The editor opens only
  // with an answer - an empty list that the server really sent is an answer.
  if (properties.status === "error") return <ErrorPanel message={`Không tải được danh sách cơ sở lưu trú (khối giới thiệu cơ sở cần nó). ${properties.message}`} onRetry={() => setPropertiesAttempt((n) => n + 1)} />;
  if (postId === null && !rights.edit) return <Banner tone="info" testId="new-needs-edit">Tạo bài mới cần quyền chỉnh sửa Blog.</Banner>;

  const active = languages.data;
  const codes = [...new Set([...active.map((l) => l.code), ...(current?.translations.map((t) => t.locale) ?? [])])];
  const defaultLocale = active.find((l) => l.isDefault)?.code ?? codes[0] ?? "vi";
  const selected = locale && codes.includes(locale) ? locale : (current?.translations[0]?.locale ?? defaultLocale);
  const translation = translationOf(current, selected);
  const title = translation?.draft?.title || translation?.published?.title || current?.translations[0]?.draft?.title || current?.translations[0]?.published?.title || (postId === null ? "Bài mới" : "Bài viết");

  const go = (code: string) => {
    setLocale(code);
    setSwitchTo(null);
    window.history.replaceState(null, "", `${window.location.pathname}?locale=${encodeURIComponent(code)}`);
  };
  const choose = (code: string) => {
    if (code === selected || report.busy) return;
    if (report.dirty) setSwitchTo(code);
    else go(code);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title}>Mỗi ngôn ngữ là một bản dịch riêng với nội dung, slug, chuyên mục và trạng thái xuất bản riêng.</PageHeader>
      <div role="tablist" aria-label="Ngôn ngữ của bài" className="flex flex-wrap gap-2" data-testid="locale-tabs">
        {codes.map((code) => {
          const t = translationOf(current, code);
          const on = code === selected;
          return (
            <button key={code} role="tab" type="button" aria-selected={on} disabled={report.busy && !on} onClick={() => choose(code)} data-testid={`locale-tab-${code}`}
              className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"}`}>
              {code.toUpperCase()} <span className="ml-1 text-xs font-normal text-gray-500">{t ? STATUS_LABEL[t.status] : postId === null && code === selected ? "mới" : "chưa có"}</span>
            </button>
          );
        })}
      </div>
      {switchTo && (
        <Banner tone="warning" testId="locale-switch-confirm">
          <p>Bạn có thay đổi chưa lưu ở bản dịch {selected.toUpperCase()}. Chuyển sang {switchTo.toUpperCase()} sẽ bỏ chúng.</p>
          <div className="mt-2 flex gap-2"><ActionButton onClick={() => go(switchTo)} testId="locale-switch-yes">Bỏ thay đổi và chuyển</ActionButton><ActionButton variant="outline" onClick={() => setSwitchTo(null)}>Ở lại</ActionButton></div>
        </Banner>
      )}
      {postId !== null && !current && <Banner tone="error">Không tìm thấy bài viết.</Banner>}
      {(postId === null || current) && (
        <TranslationForm
          // The key keeps to the route's own id: once the post exists the form must not remount (the id handed to it below changes, the key does not).
          key={`${postId ?? clientId}:${selected}`}
          postId={postId ?? post?.id ?? null}
          clientId={clientId}
          locale={selected}
          initial={translation}
          categories={categories.state.status === "ready" ? categories.state.data : []}
          properties={properties.status === "ready" ? properties.data : []}
          pickMedia={pickMedia}
          onPost={onPost}
          onCreated={onCreated}
          onStatus={onStatus}
          newRoute={postId === null}
        />
      )}
      {picker && (
        <MediaPickerDialog
          title={picker.options.title}
          multiple={picker.options.multiple}
          min={picker.options.min}
          max={picker.options.max}
          canUpload={rights.access}
          onChoose={(picked) => picker.resolve(picked)}
          onClose={() => picker.resolve(null)}
        />
      )}
    </div>
  );
}
