"use client";

/**
 * CUST-WEB-HERO-001-CP01: the Banner trang chủ screen — the home page slideshow: its pictures and their order, the title, description and two
 * button labels shared by every slide, one font for the title and description, and whether and how fast the pictures change by themselves.
 *
 * The draft lives only on this screen until Save; one Save sends everything (or nothing) with the revision that was loaded. A picture is
 * uploaded the moment it is chosen (the server checks the bytes and stores the file), but an uploaded picture is part of the slideshow only
 * after a Save names it. A stale revision keeps the draft and says so; a lost answer — of the Save or of an upload — is never retried: the
 * screen reads the server before it claims anything. Order is buttons (up / down), not drag and drop. The preview below the fields is the
 * draft drawn the way the Customer draws it (same font stacks, same overlay), and changes nothing public until Save.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Checkbox from "@/components/form/input/Checkbox";
import { getHero, heroImageSrc, saveHero, uploadHeroImage, type HeroMedia, type HeroSlide, type MenuLocale, type WebsiteHero } from "@/lib/api/website";
import { HERO_FONT_KEYS, HERO_FONT_LABELS, heroPreviewFamily, type HeroFontKey } from "@/lib/website/heroFonts";
import {
  ACCEPTED_TYPES, MAX_LENGTH, MAX_SLIDES, MAX_UPLOAD_BYTES, SHARED_FIELDS, addSlide, draftOf, draftProblems, fingerprint, isRequiredLocale, locateField,
  moveSlide, patchSharedText, patchSlideText, previewText, removeSlide, replaceSlideMedia, summarizeChanges, toBody, type FieldTarget, type HeroDraft, type Move, type SharedField,
} from "@/lib/website/heroModel";
import { refusalText } from "@/lib/website/wording";
import { useLeaveGuard } from "./useLeaveGuard";
import { useWebsiteHost } from "./WebsiteAccessGate";
import { useWebsiteList, useWriteAction } from "./useWebsiteData";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, TextField, WriteFeedback, formatWhen } from "./WebsiteUi";

const PANEL = "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]";
const SMALL_BUTTON =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5";
const SELECT =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

const SHARED_LABELS: Record<SharedField, string> = {
  title: "Tiêu đề chính (H1)",
  description: "Mô tả ngắn",
  primaryAction: "Nút chính (mở form tìm phòng)",
  secondaryAction: "Nút phụ (đến trang Riverside)",
};

export default function HeroPanel() {
  const { state, reload } = useWebsiteList(getHero, []);
  // Once the screen has a hero it keeps its draft even if a later read fails: the draft is the operator's work.
  const [held, setHeld] = useState<WebsiteHero | null>(null);
  if (held === null && state.status === "ready") setHeld(state.data);
  const current = held ?? (state.status === "ready" ? state.data : null);
  if (current === null) {
    return state.status === "error" ? <ErrorPanel message={state.message} onRetry={() => void reload()} /> : <LoadingPanel what="banner trang chủ" />;
  }
  return <HeroEditor initial={current} reload={reload} readError={state.status === "error" ? state.message : null} />;
}

type PickTarget = { kind: "add" } | { kind: "replace"; slideId: string };

function HeroEditor({ initial, reload, readError }: { initial: WebsiteHero; reload: () => Promise<WebsiteHero | null>; readError: string | null }) {
  const host = useWebsiteHost();
  const write = useWriteAction();
  const upload = useWriteAction();
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState<HeroDraft>(() => draftOf(initial));
  const [selectedId, setSelectedId] = useState<string | null>(initial.slides[0]?.id ?? null);
  const [editLocale, setEditLocale] = useState(initial.locales.find((locale) => locale.isDefault)?.code ?? "vi");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [picker, setPicker] = useState<PickTarget | null>(null);
  const [uploaded, setUploaded] = useState<HeroMedia[]>([]);
  const [serverMedia, setServerMedia] = useState<HeroMedia[] | null>(null);
  const sent = useRef<HeroDraft | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<PickTarget>({ kind: "add" });

  const locales = base.locales;
  const defaultCode = locales.find((locale) => locale.isDefault)?.code ?? "vi";
  const baseDraft = useMemo(() => draftOf(base), [base]);
  const problems = useMemo(() => draftProblems(draft, locales), [draft, locales]);
  const dirty = fingerprint(draft) !== fingerprint(baseDraft);
  const changes = useMemo(() => summarizeChanges(baseDraft, draft), [baseDraft, draft]);
  const working = write.status.phase === "pending" || upload.status.phase === "pending" || checking;
  const locked = working || write.status.phase === "unverified" || upload.status.phase === "unverified" || host.signingOut;
  useLeaveGuard(dirty, "Bạn có thay đổi banner chưa lưu. Rời trang này sẽ bỏ chúng. Vẫn rời đi?");
  // Sign out (a button of the gate, not a link) asks too while there is a draft.
  const setUnsaved = host.setUnsaved;
  React.useEffect(() => {
    setUnsaved(dirty);
    return () => setUnsaved(false);
  }, [dirty, setUnsaved]);

  // Every picture the screen knows: the ones uploaded in this visit, then what the server listed (the library; newest first).
  const library = useMemo(() => {
    const seen = new Set<string>();
    return [...uploaded, ...(serverMedia ?? base.media)].filter((item) => !seen.has(item.id) && seen.add(item.id));
  }, [uploaded, serverMedia, base.media]);
  const mediaById = useMemo(() => new Map(library.map((item) => [item.id, item])), [library]);

  const target: FieldTarget | null = write.status.phase === "refused" ? locateField(write.status.failure.field, draft) : null;
  const serverMessage = write.status.phase === "refused" ? refusalText(write.status.failure) : null;
  const showErrors = submitted || target !== null;
  const shownLocale = target && "locale" in target && target.locale ? target.locale : editLocale;

  const apply = (move: Move) => {
    if (move.ok) {
      setDraft(move.draft);
      setMoveNote(null);
      setSavedNote(null);
    } else {
      setMoveNote(move.reason);
    }
    return move.ok;
  };
  const edit = (next: HeroDraft) => {
    setDraft(next);
    setSavedNote(null);
    setMoveNote(null);
  };

  const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`);

  const applyMedia = (media: HeroMedia, at: PickTarget) => {
    if (at.kind === "add") {
      const id = newId();
      if (apply(addSlide(draft, media, id, locales))) setSelectedId(id);
    } else {
      apply(replaceSlideMedia(draft, at.slideId, media));
    }
    setPicker(null);
  };

  const choose = (at: PickTarget) => {
    pickTarget.current = at;
    setUploadNote(null);
    fileInput.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file || locked) return;
    const at = pickTarget.current;
    if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      setUploadNote("Chỉ nhận ảnh JPEG, PNG hoặc WebP. Máy chủ sẽ kiểm tra lại nội dung tệp.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadNote(`Ảnh nặng ${(file.size / 1024 / 1024).toFixed(1)} MB, lớn hơn 10 MB. Hãy nén ảnh rồi thử lại.`);
      return;
    }
    if (at.kind === "add" && draft.slides.length >= MAX_SLIDES) {
      setUploadNote(`Banner có tối đa ${MAX_SLIDES} ảnh. Hãy xoá bớt một ảnh trước.`);
      return;
    }
    setUploadNote(null);
    const result = await upload.run(() => uploadHeroImage(file));
    if (result?.kind === "ok") {
      setUploaded((list) => [result.data, ...list]);
      applyMedia(result.data, at);
    }
  };

  const remove = (slideId: string) => {
    if (apply(removeSlide(draft, slideId)) && selectedId === slideId) setSelectedId(null);
  };

  const cancel = () => {
    setDraft(baseDraft);
    setSelectedId((current) => (current && base.slides.some((slide) => slide.id === current) ? current : base.slides[0]?.id ?? null));
    setSubmitted(false);
    setMoveNote(null);
    setServerNote(null);
    setSavedNote(null);
    setUploadNote(null);
    setPicker(null);
    write.reset();
    upload.reset();
  };

  const save = async () => {
    setSubmitted(true);
    setServerNote(null);
    setSavedNote(null);
    const body = toBody(draft);
    if (problems.blocking > 0 || body === null || !dirty || locked) return;
    sent.current = draft;
    const result = await write.run(() => saveHero(base.revision, body));
    if (result?.kind === "ok") {
      setBase(result.data);
      setDraft(draftOf(result.data));
      setServerMedia(result.data.media);
      setUploaded([]);
      setSubmitted(false);
      setSavedNote(`Đã lưu lúc ${formatWhen(result.data.updatedAtUtc)}. Khách thấy banner mới ngay ở lần tải tiếp theo, và trong tối đa 15 giây ở trang chủ đang mở.`);
    } else if (result?.kind === "refused") {
      const at = locateField(result.field, draft);
      if (at?.kind === "slide") setSelectedId(at.slideId);
      if (at && "locale" in at && at.locale) setEditLocale(at.locale);
    }
  };

  /** Reads the server: after a stale save (to see the latest) or a lost answer (to learn what really happened). */
  const readServer = useCallback(async (): Promise<WebsiteHero | null> => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) setServerNote("Không đọc được máy chủ. Hãy thử lại trước khi thay đổi gì.");
      return fresh;
    } finally {
      setChecking(false);
    }
  }, [reload]);

  const reloadLatest = async () => {
    const fresh = await readServer();
    if (!fresh) return;
    write.reset();
    setBase(fresh);
    setServerMedia(fresh.media);
    setServerNote(
      `Đã tải bản mới nhất của máy chủ (${fresh.slides.length} ảnh, lưu lúc ${formatWhen(fresh.updatedAtUtc)}). Bản nháp của bạn được giữ nguyên và Lưu sẽ thay cả banner trên máy chủ bằng bản nháp này. Bấm Huỷ thay đổi để bỏ nháp và dùng bản mới.`
    );
  };

  const checkSave = async () => {
    const fresh = await readServer();
    if (!fresh) return;
    write.reset();
    setBase(fresh);
    setServerMedia(fresh.media);
    if (sent.current && fingerprint(draftOf(fresh)) === fingerprint(sent.current)) {
      setDraft(draftOf(fresh));
      setSubmitted(false);
      setServerNote("Máy chủ xác nhận: thay đổi đã được lưu, đúng một lần. Không cần lưu lại.");
    } else {
      setServerNote("Máy chủ chưa có thay đổi vừa gửi (hoặc đang khác bản nháp). Bản nháp được giữ; hãy kiểm tra rồi Lưu lại nếu bạn vẫn muốn.");
    }
  };

  const checkUpload = async () => {
    const fresh = await readServer();
    if (!fresh) return;
    upload.reset();
    setServerMedia(fresh.media);
    setServerNote(`Đã đọc lại máy chủ: có ${fresh.media.length} ảnh trong thư viện. Nếu ảnh bạn vừa tải đã có ở đó, hãy dùng nút "Chọn ảnh đã có"; nếu không, hãy tải lại.`);
  };

  const previewSlides = draft.slides;
  const previewAt = Math.min(previewIndex, Math.max(previewSlides.length - 1, 0));
  const slideOf = previewSlides[previewAt];

  return (
    <div className="flex flex-col gap-4" data-testid="hero-panel">
      <PageHeader title="Banner trang chủ">
        Ảnh trượt, tiêu đề, mô tả, nhãn nút, font và cách tự chuyển ảnh của đầu trang chủ. Chỉnh trên màn hình này chỉ là bản nháp cho tới khi bạn bấm Lưu; ảnh vừa tải lên cũng chưa hiện ra với khách cho tới khi Lưu.
      </PageHeader>

      {readError && <Banner tone="error" testId="hero-read-error">{readError}</Banner>}
      {savedNote && <Banner tone="success" testId="website-success" onDismiss={() => setSavedNote(null)}>{savedNote}</Banner>}

      <div className={`${PANEL} flex flex-wrap items-center justify-between gap-3`} data-testid="hero-savebar">
        <p className="text-sm text-gray-700 dark:text-gray-200" data-testid="hero-state">
          {dirty ? (
            <>
              <span className="font-medium text-warning-700 dark:text-warning-300">Có thay đổi chưa lưu</span>
              {changes.length > 0 ? ` — ${changes.join(", ")}.` : "."}
            </>
          ) : (
            <span>Đã lưu — phiên bản {base.version}, cập nhật {formatWhen(base.updatedAtUtc)}.</span>
          )}
          {submitted && problems.blocking > 0 && <span className="ml-2 text-error-600 dark:text-error-400" data-testid="hero-blocking">Còn {problems.blocking} chỗ cần sửa trước khi lưu.</span>}
        </p>
        <div className="flex gap-2">
          <ActionButton variant="outline" onClick={cancel} disabled={!dirty || working} testId="hero-cancel">Huỷ thay đổi</ActionButton>
          <ActionButton onClick={() => void save()} disabled={!dirty || locked} testId="hero-save">{write.status.phase === "pending" ? "Đang lưu…" : "Lưu banner"}</ActionButton>
        </div>
      </div>

      <WriteFeedback status={write.status} working={working} serverNote={serverNote} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkSave()} fieldErrorOf={(field) => locateField(field, draft) !== null} />
      {(upload.status.phase === "refused" || upload.status.phase === "failed" || upload.status.phase === "unverified") && (
        <div data-testid="hero-upload-status">
          <WriteFeedback status={upload.status} working={working} serverNote={null} onCheckServer={() => void checkUpload()} />
        </div>
      )}
      {uploadNote && <Banner tone="error" testId="hero-upload-error" onDismiss={() => setUploadNote(null)}>{uploadNote}</Banner>}
      {moveNote && <Banner tone="warning" testId="hero-move-note" onDismiss={() => setMoveNote(null)}>{moveNote}</Banner>}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        hidden
        data-testid="hero-file-input"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Ảnh banner" data-testid="hero-slides">
          <div className={PANEL}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Ảnh banner ({draft.slides.length}/{MAX_SLIDES})</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Gợi ý ảnh ngang 1920×900. JPEG, PNG hoặc WebP, tối đa 10 MB; ảnh khác tỷ lệ vẫn dùng được (cắt vừa khung).</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton variant="outline" onClick={() => choose({ kind: "add" })} disabled={locked || draft.slides.length >= MAX_SLIDES} testId="add-upload">Tải ảnh lên</ActionButton>
                <ActionButton variant="outline" onClick={() => setPicker(picker?.kind === "add" ? null : { kind: "add" })} disabled={locked || draft.slides.length >= MAX_SLIDES} testId="add-library">Chọn ảnh đã có</ActionButton>
              </div>
            </div>
            {problems.slides && showErrors && <p className="mb-2 text-xs text-error-500" data-testid="slides-problem">{problems.slides}</p>}
            {target?.kind === "slides" && serverMessage && <p className="mb-2 text-xs text-error-500">{serverMessage}</p>}

            {picker && (
              <MediaPicker
                title={picker.kind === "add" ? "Chọn ảnh để thêm vào banner" : "Chọn ảnh thay cho ảnh đang chọn"}
                items={library}
                onPick={(media) => applyMedia(media, picker)}
                onClose={() => setPicker(null)}
              />
            )}

            <ul className="flex flex-col gap-2">
              {draft.slides.map((slide, index) => {
                const media = mediaById.get(slide.mediaId);
                const own = problems.slideTexts[slide.id];
                const broken = own && (Object.keys(own.alt).length > 0 || Object.keys(own.caption).length > 0);
                const isSelected = slide.id === selectedId;
                return (
                  <li key={slide.id} data-testid={`slide-${slide.id}`} className={`rounded-xl border p-2 ${isSelected ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-500/10" : "border-gray-200 dark:border-gray-800"}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => { setSelectedId(slide.id); setPreviewIndex(index); }} aria-current={isSelected ? "true" : undefined} data-testid={`select-${slide.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-brand-500/20">
                        <Thumb media={media} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-800 dark:text-white/90">Ảnh {index + 1}</span>
                          <span className="block break-words text-xs text-gray-500 dark:text-gray-400">{previewText(slide.caption, defaultCode, defaultCode) || "(chưa có chú thích)"}</span>
                          {media && <span className="block text-[11px] text-gray-400">{media.width}×{media.height}{media.kind === "seed" ? " · ảnh có sẵn" : ""}</span>}
                          {showErrors && broken && <span className="mt-0.5 inline-block rounded-full bg-error-50 px-2 py-0.5 text-[11px] font-medium text-error-700 dark:bg-error-500/10 dark:text-error-300">Cần sửa chữ</span>}
                        </span>
                      </button>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" className={SMALL_BUTTON} disabled={locked || index === 0} onClick={() => apply(moveSlide(draft, slide.id, -1))} data-testid={`up-${slide.id}`} aria-label={`Đưa ảnh ${index + 1} lên`}>Lên</button>
                        <button type="button" className={SMALL_BUTTON} disabled={locked || index === draft.slides.length - 1} onClick={() => apply(moveSlide(draft, slide.id, 1))} data-testid={`down-${slide.id}`} aria-label={`Đưa ảnh ${index + 1} xuống`}>Xuống</button>
                        <button type="button" className={SMALL_BUTTON} disabled={locked} onClick={() => choose({ kind: "replace", slideId: slide.id })} data-testid={`replace-upload-${slide.id}`}>Thay bằng ảnh tải lên</button>
                        <button type="button" className={SMALL_BUTTON} disabled={locked} onClick={() => setPicker(picker?.kind === "replace" && picker.slideId === slide.id ? null : { kind: "replace", slideId: slide.id })} data-testid={`replace-library-${slide.id}`}>Thay bằng ảnh đã có</button>
                        <button type="button" className={`${SMALL_BUTTON} !border-error-300 !text-error-700 dark:!text-error-300`} disabled={locked} onClick={() => remove(slide.id)} data-testid={`remove-${slide.id}`}>Xoá</button>
                      </div>
                    </div>
                    {isSelected && (
                      <SlideTexts
                        slide={slide}
                        locales={locales}
                        locale={shownLocale}
                        onLocale={setEditLocale}
                        problems={showErrors ? own : undefined}
                        serverField={target?.kind === "slide" && target.slideId === slide.id ? target : null}
                        serverMessage={serverMessage}
                        disabled={locked}
                        onChange={(part, code, value) => edit(patchSlideText(draft, slide.id, part, code, value))}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-4" aria-label="Nội dung và cách chạy">
          <div className={`${PANEL} flex flex-col gap-3`} data-testid="hero-texts">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Chữ trên banner</h2>
              <LocaleSelect locales={locales} value={shownLocale} onChange={setEditLocale} testId="edit-locale" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Dùng chung cho mọi ảnh. Nhập từng ngôn ngữ ở đây; bản dịch cũng nằm ở màn <Link href="/website/translations" className="underline">Bản dịch</Link> (khoá content.heroSlideshow.main.*), nên gói ngôn ngữ nhập/xuất vẫn mang theo.
            </p>
            <fieldset className="flex flex-col gap-3" disabled={locked}>
              {SHARED_FIELDS.map((field) => {
                const locale = locales.find((item) => item.code === shownLocale);
                const required = locale ? isRequiredLocale(locale) : false;
                const shown = (showErrors ? problems.texts[field][shownLocale] : undefined) ?? (target?.kind === "shared" && target.field === field && target.locale === shownLocale ? serverMessage : null);
                const empty = (draft.texts[field][shownLocale] ?? "").trim() === "";
                return (
                  <TextField
                    key={`${field}-${shownLocale}`}
                    label={`${SHARED_LABELS[field]}${required ? " — bắt buộc" : ""}`}
                    value={draft.texts[field][shownLocale] ?? ""}
                    onChange={(value) => edit(patchSharedText(draft, field, shownLocale, value))}
                    error={shown ?? null}
                    hint={!required && empty ? "Chưa có: khách ngôn ngữ này sẽ thấy chữ của ngôn ngữ mặc định." : `Tối đa ${MAX_LENGTH[field]} ký tự.`}
                    maxLength={MAX_LENGTH[field] + 40}
                    testId={`field-${field}`}
                  />
                );
              })}
            </fieldset>
          </div>

          <div className={`${PANEL} flex flex-col gap-3`} data-testid="hero-style">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Font chữ và tự chuyển ảnh</h2>
            <div>
              <label htmlFor="hero-font" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">Font của tiêu đề và mô tả</label>
              <select id="hero-font" data-testid="field-font" value={draft.fontKey} disabled={locked} onChange={(event) => edit({ ...draft, fontKey: event.target.value as HeroFontKey })} className={SELECT}>
                {HERO_FONT_KEYS.map((key) => <option key={key} value={key}>{HERO_FONT_LABELS[key]}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Chỉ áp dụng cho tiêu đề và mô tả trên banner — không đổi font của header, form tìm phòng hay các phần khác. Mọi font trong danh sách hiển thị đủ dấu tiếng Việt và tiếng Pháp.</p>
              {problems.fontKey && showErrors && <p className="mt-1 text-xs text-error-500">{problems.fontKey}</p>}
              {target?.kind === "fontKey" && serverMessage && <p className="mt-1 text-xs text-error-500">{serverMessage}</p>}
            </div>
            <Checkbox id="hero-autoplay" label="Tự chuyển ảnh" checked={draft.autoplayEnabled} onChange={(checked) => edit({ ...draft, autoplayEnabled: checked })} disabled={locked} />
            <TextField
              label="Thời gian giữa hai lần chuyển ảnh (giây)"
              value={draft.interval}
              onChange={(value) => edit({ ...draft, interval: value })}
              inputMode="numeric"
              maxLength={3}
              error={(showErrors ? problems.interval : null) ?? (target?.kind === "interval" ? serverMessage : null)}
              hint={
                draft.autoplayEnabled
                  ? "Là khoảng ảnh đứng yên giữa hai lần chuyển slide, không phải độ dài hiệu ứng mờ dần. Số nguyên từ 3 đến 60."
                  : "Đang tắt tự chuyển ảnh: khách chỉ chuyển ảnh bằng nút, chấm tròn hoặc vuốt; nút tạm dừng cũng được ẩn. Giá trị này được giữ cho lần bật lại."
              }
              disabled={locked}
              testId="field-interval"
            />
          </div>
        </section>
      </div>

      <div className={PANEL} data-testid="hero-preview">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Xem trước (khách thấy, ngôn ngữ {shownLocale})</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="preview-timing">
            {draft.autoplayEnabled ? `Tự chuyển sau mỗi ${draft.interval.trim() || "?"} giây` : "Không tự chuyển"} · bản nháp, chưa công khai
          </p>
        </div>
        {slideOf ? (
          <HeroPreview draft={draft} slide={slideOf} media={mediaById.get(slideOf.mediaId)} locale={shownLocale} defaultCode={defaultCode} index={previewAt} count={previewSlides.length} onStep={(delta) => setPreviewIndex((previewAt + delta + previewSlides.length) % previewSlides.length)} />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Chưa có ảnh nào.</p>
        )}
      </div>
    </div>
  );
}

function Thumb({ media }: { media: HeroMedia | undefined }) {
  const src = media ? heroImageSrc(media.url) : null;
  return src ? (
    // The picture is served by the API at an id-addressed URL; the Admin shows it as it is.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className="h-14 w-24 shrink-0 rounded-lg bg-gray-100 object-cover dark:bg-gray-800" data-testid="slide-thumb" />
  ) : (
    <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[11px] text-gray-400 dark:bg-gray-800">Không có ảnh</span>
  );
}

function LocaleSelect({ locales, value, onChange, testId }: { locales: MenuLocale[]; value: string; onChange: (code: string) => void; testId: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
      Ngôn ngữ đang sửa
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} className="h-9 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-700 dark:bg-gray-900">
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.nativeName} ({locale.code}){locale.isActive ? "" : " — đang tắt"}
          </option>
        ))}
      </select>
    </label>
  );
}

function SlideTexts({
  slide, locales, locale, onLocale, problems, serverField, serverMessage, disabled, onChange,
}: {
  slide: HeroSlide;
  locales: MenuLocale[];
  locale: string;
  onLocale: (code: string) => void;
  problems: { alt: Record<string, string>; caption: Record<string, string> } | undefined;
  serverField: Extract<FieldTarget, { kind: "slide" }> | null;
  serverMessage: string | null;
  disabled: boolean;
  onChange: (part: "alt" | "caption", code: string, value: string) => void;
}) {
  const info = locales.find((item) => item.code === locale);
  const required = info ? isRequiredLocale(info) : false;
  const parts = [
    { part: "alt" as const, label: "Mô tả ảnh (alt, cho người dùng đọc màn hình)", max: MAX_LENGTH.alt },
    { part: "caption" as const, label: "Chú thích hiện dưới banner", max: MAX_LENGTH.caption },
  ];
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-gray-200 pt-3 dark:border-gray-800" data-testid="slide-texts">
      <LocaleSelect locales={locales} value={locale} onChange={onLocale} testId="slide-locale" />
      {parts.map(({ part, label, max }) => {
        const shown = problems?.[part][locale] ?? (serverField?.part === part && serverField.locale === locale ? serverMessage : null);
        const empty = (slide[part][locale] ?? "").trim() === "";
        return (
          <TextField
            key={`${part}-${locale}`}
            label={`${label}${required ? " — bắt buộc" : ""}`}
            value={slide[part][locale] ?? ""}
            onChange={(value) => onChange(part, locale, value)}
            error={shown ?? null}
            hint={!required && empty ? "Chưa có: khách ngôn ngữ này sẽ thấy chữ của ngôn ngữ mặc định." : `Tối đa ${max} ký tự.`}
            maxLength={max + 40}
            disabled={disabled}
            testId={`slide-${part}`}
          />
        );
      })}
      {serverField && (serverField.part === "mediaId" || serverField.part === "id" || serverField.part === "focalPosition") && serverMessage && <p className="text-xs text-error-500" data-testid="slide-server-error">{serverMessage}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">Ảnh có sẵn giữ nguyên ghi công tác giả ở trang “Ghi công ảnh”; ảnh bạn tải lên không mang ghi công của ảnh nào khác.</p>
    </div>
  );
}

function MediaPicker({ title, items, onPick, onClose }: { title: string; items: HeroMedia[]; onPick: (media: HeroMedia) => void; onClose: () => void }) {
  return (
    <div className="mb-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800" data-testid="media-picker">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</h3>
        <button type="button" className={SMALL_BUTTON} onClick={onClose} data-testid="media-picker-close">Đóng</button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Chưa có ảnh nào trong thư viện.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((media) => (
            <li key={media.id}>
              <button type="button" onClick={() => onPick(media)} data-testid={`pick-${media.id}`} className="flex w-full flex-col gap-1 rounded-lg border border-gray-200 p-1.5 text-left hover:bg-gray-50 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-brand-500/20 dark:border-gray-800 dark:hover:bg-white/5">
                <Thumb media={media} />
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{media.width}×{media.height} · {media.kind === "seed" ? "có sẵn" : formatWhen(media.createdAtUtc)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The draft drawn the way the Customer draws the hero: same overlay, same text positions, same font stacks (not the real heights — this is a miniature). */
function HeroPreview({
  draft, slide, media, locale, defaultCode, index, count, onStep,
}: {
  draft: HeroDraft;
  slide: HeroSlide;
  media: HeroMedia | undefined;
  locale: string;
  defaultCode: string;
  index: number;
  count: number;
  onStep: (delta: -1 | 1) => void;
}) {
  const src = media ? heroImageSrc(media.url) : null;
  const family = heroPreviewFamily(draft.fontKey);
  const text = (field: SharedField) => previewText(draft.texts[field], locale, defaultCode);
  return (
    <div>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-neutral-900 sm:aspect-[1920/700]" data-testid="preview-frame">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: slide.focalPosition }} />
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center gap-2 p-4 sm:p-8">
          <div className="max-w-[80%] space-y-2 sm:max-w-[60%] sm:space-y-3">
            <p data-testid="preview-title" style={{ fontFamily: family }} className="break-words text-xl font-medium leading-[114%] text-white sm:text-3xl lg:text-4xl">{text("title")}</p>
            <p data-testid="preview-description" style={{ fontFamily: family }} className="break-words text-xs text-white/90 sm:text-base">{text("description")}</p>
            <div className="flex flex-wrap gap-2">
              <span data-testid="preview-primary" className="inline-flex h-8 max-w-full items-center rounded-full bg-white px-4 text-xs font-semibold text-neutral-900 sm:h-10 sm:text-sm">{text("primaryAction")}</span>
              <span data-testid="preview-secondary" className="inline-flex h-8 max-w-full items-center rounded-full border border-white/70 bg-black/25 px-4 text-xs font-semibold text-white sm:h-10 sm:text-sm">{text("secondaryAction")} →</span>
            </div>
          </div>
        </div>
        <p data-testid="preview-caption" className="absolute inset-x-3 bottom-2 break-words text-[11px] text-white/90 sm:text-xs">{previewText(slide.caption, locale, defaultCode)}</p>
      </div>
      {count > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <button type="button" className={SMALL_BUTTON} onClick={() => onStep(-1)} data-testid="preview-prev">Ảnh trước</button>
          <span className="text-xs text-gray-500 dark:text-gray-400" data-testid="preview-position">{index + 1} / {count}</span>
          <button type="button" className={SMALL_BUTTON} onClick={() => onStep(1)} data-testid="preview-next">Ảnh sau</button>
        </div>
      )}
    </div>
  );
}
