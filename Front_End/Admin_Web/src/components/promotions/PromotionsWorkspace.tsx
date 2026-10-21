"use client";

/**
 * BHA-BOOKING-PROMOTIONS-001 (ADR 0009): "Ưu đãi đặt phòng". One promotion is both the discount rule the booking backend applies and the
 * content the website shows, so nothing is entered twice. Every request is authorized on the server for a Manager of the chosen
 * Property; this screen only shows what that Manager may manage.
 *
 * The honest parts: the page tells apart *hiệu lực tính giá* (Đang bật / Đã tắt) from *hiển thị trên trang chủ* (a placement only), a save
 * carries the version it was made from (a stale one is refused and the draft kept), a create carries an operation id (a lost answer is
 * checked on the server, never blindly resent), and nothing changes a price except the server.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useStaffSession } from "@/components/auth/StaffSession";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, TextAreaField, TextField, WriteFeedback, formatWhen } from "@/components/website/WebsiteUi";
import { useWebsiteHost, type GateRule } from "@/components/website/WebsiteAccessGate";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { useLeaveGuard } from "@/components/website/useLeaveGuard";
import {
  createPromotion, getPromotion, getPromotionRoomTypes, listPromotions, promotionCoverSrc, savePromotion, setPromotionStatus, uploadPromotionCover,
  type PromotionEditor, type PromotionFilter, type PromotionStatus, type PromotionSummary, type RoomTypeChoice,
} from "@/lib/api/promotions";
import {
  COVER_MAX_BYTES, COVER_MIN, COVER_TYPES, LIMITS, STATUS_LABEL, discountLabel, draftOf, emptyDraft, fingerprint, slugify, toBody, validateDraft,
  type FieldErrors, type PromotionDraft, type TextsDraft,
} from "@/lib/website/promotionModel";
import { refusalText } from "@/lib/website/wording";

/** The gate rule: a Manager of at least one Property. Display only: the server checks the role of the route's Property again. */
export const PROMOTION_RULE: GateRule = {
  isAllowed: (session) => session.memberships.some((m) => m.role === "Manager"),
  noPermission:
    "Tài khoản này không phải Manager của cơ sở nào nên không quản lý được ưu đãi đặt phòng. Quyền theo từng cơ sở (FrontDesk, Manager) do người vận hành cấp. Chưa có yêu cầu nào được gửi.",
  signInPrompt: "Hãy đăng nhập để quản lý ưu đãi đặt phòng.",
};

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800";
const FIELD_ERROR = "border-error-500 focus:border-error-300 focus:ring-error-500/20 dark:border-error-500";
const CARD = "rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]";
const BADGE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
const STATUS_TONE: Record<PromotionStatus, string> = {
  Draft: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200",
  Active: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300",
  Disabled: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
};

type View = { kind: "list" } | { kind: "editor"; id: string | null; seed?: PromotionEditor };

export default function PromotionsWorkspace() {
  const { state } = useStaffSession();
  const memberships = state.status === "authenticated" ? state.session.memberships.filter((m) => m.role === "Manager") : [];
  const [propertyId, setPropertyId] = useState<string>(memberships[0]?.propertyId ?? "");
  const [view, setView] = useState<View>({ kind: "list" });
  const selected = memberships.find((m) => m.propertyId === propertyId) ?? memberships[0];
  if (!selected) return null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Ưu đãi đặt phòng">
        Một ưu đãi vừa là quy tắc giảm giá backend tự áp dụng khi khách chọn ngày, vừa là nội dung giới thiệu hiện trên website. Khách luôn thấy giá do máy chủ tính; việc ẩn thẻ khỏi trang chủ không đổi giá.
      </PageHeader>
      {view.kind === "list" ? (
        <PromotionList
          key={selected.propertyId}
          memberships={memberships}
          propertyId={selected.propertyId}
          onProperty={setPropertyId}
          onOpen={(id) => setView({ kind: "editor", id })}
          onCreate={() => setView({ kind: "editor", id: null })}
        />
      ) : (
        <EditorLoader
          key={view.id ?? "new"}
          propertyId={selected.propertyId}
          propertyName={selected.propertyName}
          id={view.id}
          seed={view.seed}
          onBack={() => setView({ kind: "list" })}
          onCreated={(editor) => setView({ kind: "editor", id: editor.id, seed: editor })}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ list

function PromotionList({
  memberships, propertyId, onProperty, onOpen, onCreate,
}: {
  memberships: { propertyId: string; propertyName: string }[]; propertyId: string; onProperty: (id: string) => void; onOpen: (id: string) => void; onCreate: () => void;
}) {
  const [filter, setFilter] = useState<PromotionFilter>({ status: "", q: "", homepage: "" });
  const [applied, setApplied] = useState(filter);
  useEffect(() => {
    const timer = setTimeout(() => setApplied(filter), 300);
    return () => clearTimeout(timer);
  }, [filter]);
  const list = useWebsiteList((signal) => listPromotions(propertyId, applied, signal), [propertyId, applied.status, applied.q, applied.homepage]);
  const filtering = applied.status !== "" || applied.q.trim() !== "" || applied.homepage !== "";

  return (
    <>
      <div className={`${CARD} flex flex-wrap items-end gap-3`}>
        {memberships.length > 1 && (
          <label className="flex min-w-[12rem] flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
            Cơ sở
            <select aria-label="Cơ sở" data-testid="promotion-property" className={FIELD} value={propertyId} onChange={(e) => onProperty(e.target.value)}>
              {memberships.map((m) => <option key={m.propertyId} value={m.propertyId}>{m.propertyName}</option>)}
            </select>
          </label>
        )}
        <label className="flex min-w-[10rem] flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Trạng thái
          <select data-testid="promotion-filter-status" className={FIELD} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as PromotionFilter["status"] })}>
            <option value="">Tất cả</option>
            {(["Draft", "Active", "Disabled"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Thẻ trên trang chủ
          <select data-testid="promotion-filter-homepage" className={FIELD} value={filter.homepage} onChange={(e) => setFilter({ ...filter, homepage: e.target.value as PromotionFilter["homepage"] })}>
            <option value="">Tất cả</option>
            <option value="true">Được đặt hiển thị</option>
            <option value="false">Không hiển thị</option>
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Tìm theo tên hoặc đường dẫn
          <input data-testid="promotion-filter-q" className={FIELD} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Ví dụ: đặt sớm" />
        </label>
        <ActionButton variant="primary" size="md" testId="promotion-create" onClick={onCreate}>Tạo ưu đãi</ActionButton>
      </div>

      {list.state.status === "loading" && <LoadingPanel what="ưu đãi" />}
      {list.state.status === "error" && <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />}
      {list.state.status === "ready" && list.state.data.length === 0 && (
        <div role="status" data-testid="promotion-empty" className={`${CARD} text-sm text-gray-600 dark:text-gray-300`}>
          {filtering ? "Không có ưu đãi nào khớp bộ lọc." : "Cơ sở này chưa có ưu đãi nào. Bấm “Tạo ưu đãi” để bắt đầu."}
        </div>
      )}
      {list.state.status === "ready" && list.state.data.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="promotion-list">
          {list.state.data.map((p) => <PromotionCard key={p.id} p={p} propertyId={propertyId} onOpen={() => onOpen(p.id)} />)}
        </ul>
      )}
    </>
  );
}

function PromotionCard({ p, propertyId, onOpen }: { p: PromotionSummary; propertyId: string; onOpen: () => void }) {
  const cover = p.coverMediaId ? promotionCoverSrc(propertyId, p.coverMediaId) : null;
  return (
    <li className={`${CARD} flex flex-col gap-3`} data-testid={`promotion-${p.slug}`}>
      <div className="flex gap-3">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400 dark:bg-white/5">Chưa có ảnh</div>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-gray-800 dark:text-white/90">{p.title}</h3>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">/{p.slug}</p>
        </div>
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{discountLabel(p.kind, p.value, p.currencyCode)}</p>
      <div className="flex flex-wrap gap-2">
        <span className={`${BADGE} ${STATUS_TONE[p.status]}`} data-testid="promotion-status">{STATUS_LABEL[p.status]}</span>
        <span className={`${BADGE} ${p.publicNow ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"}`}>
          {p.publicNow ? "Đang hiện trên website" : p.showOnHomepage ? "Chưa/không còn hiện" : "Không đặt hiển thị"}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <dt>Phạm vi</dt><dd>{p.allRoomTypes ? "Mọi loại phòng" : `${p.roomTypeCount} loại phòng`}</dd>
        <dt>Tối thiểu</dt><dd>{p.minNights} đêm</dd>
        <dt>Cập nhật</dt><dd>{formatWhen(p.updatedAtUtc)}</dd>
      </dl>
      <div className="mt-auto"><ActionButton variant="outline" testId={`promotion-open-${p.slug}`} onClick={onOpen}>Xem / Chỉnh sửa</ActionButton></div>
    </li>
  );
}

// ------------------------------------------------------------------ editor

function EditorLoader({
  propertyId, propertyName, id, seed, onBack, onCreated,
}: {
  propertyId: string; propertyName: string; id: string | null; seed?: PromotionEditor; onBack: () => void; onCreated: (editor: PromotionEditor) => void;
}) {
  const rooms = useWebsiteList((signal) => getPromotionRoomTypes(propertyId, signal), [propertyId]);
  const loaded = useWebsiteList((signal) => (id && !seed ? getPromotion(propertyId, id, signal) : Promise.resolve({ kind: "ok", data: seed ?? null } as const)), [propertyId, id]);
  if (rooms.state.status === "error") return <ErrorPanel message={rooms.state.message} onRetry={() => void rooms.reload()} />;
  if (loaded.state.status === "error") return <ErrorPanel message={loaded.state.message} onRetry={() => void loaded.reload()} />;
  if (rooms.state.status !== "ready" || loaded.state.status !== "ready") return <LoadingPanel what="ưu đãi" />;
  return (
    <EditorForm
      propertyId={propertyId} propertyName={propertyName} roomTypes={rooms.state.data} initial={loaded.state.data as PromotionEditor | null}
      onBack={onBack} onCreated={onCreated}
    />
  );
}

function EditorForm({
  propertyId, propertyName, roomTypes, initial, onBack, onCreated,
}: {
  propertyId: string; propertyName: string; roomTypes: RoomTypeChoice[]; initial: PromotionEditor | null; onBack: () => void; onCreated: (editor: PromotionEditor) => void;
}) {
  const host = useWebsiteHost();
  const write = useWriteAction();
  const upload = useWriteAction();
  const [base, setBase] = useState<PromotionEditor | null>(initial);
  const [baseDraft, setBaseDraft] = useState<PromotionDraft>(() => (initial ? draftOf(initial) : emptyDraft()));
  const [draft, setDraft] = useState<PromotionDraft>(baseDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // One operation id for one create: a retry after a lost answer carries the same id and the same body, so it can never make a second promotion.
  const operation = useRef<{ id: string; fingerprint: string } | null>(null);
  const [unresolved, setUnresolved] = useState(false);

  const dirty = fingerprint(draft) !== fingerprint(baseDraft);
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const visibleErrors: FieldErrors = showErrors ? errors : {};
  useLeaveGuard(dirty, "Bạn có thay đổi chưa lưu trên ưu đãi này. Rời đi sẽ bỏ chúng. Vẫn rời đi?");
  useEffect(() => {
    host.setUnsaved(dirty);
    return () => host.setUnsaved(false);
  }, [dirty, host]);

  const set = useCallback(<K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => setDraft((d) => ({ ...d, [key]: value })), []);
  const adopt = useCallback((editor: PromotionEditor) => {
    setBase(editor);
    const next = draftOf(editor);
    setBaseDraft(next);
    setDraft(next);
  }, []);

  const disabled = write.status.phase === "pending" || write.status.phase === "unverified" || upload.status.phase === "pending";
  const fieldError = (name: string) => visibleErrors[name] ?? null;
  const serverFieldError = write.status.phase === "refused" && write.status.failure.field ? { [write.status.failure.field]: refusalText(write.status.failure) } : {};
  const errorOf = (name: string) => fieldError(name) ?? serverFieldError[name] ?? null;

  const submit = async () => {
    setSaved(null);
    setServerNote(null);
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    const body = toBody(draft, base !== null);
    const result = await write.run(async () => {
      if (base) return savePromotion(propertyId, base.id, base.version, body);
      const sent = JSON.stringify(body);
      if (!operation.current || operation.current.fingerprint !== sent) operation.current = { id: crypto.randomUUID(), fingerprint: sent };
      return createPromotion(propertyId, body, operation.current.id);
    });
    if (!result) return;
    if (result.kind === "ok") {
      operation.current = null;
      setShowErrors(false);
      if (base) {
        adopt(result.data);
        setSaved("Đã lưu. Thay đổi có hiệu lực ngay trên website và khi tính giá.");
      } else {
        onCreated(result.data);
      }
    } else if (result.kind === "unverified") setUnresolved(true);
  };

  /** A lost answer: read the server before anything else. For a create, look for the slug; for a save, compare what it holds with the draft. */
  const checkServer = async () => {
    setServerNote(null);
    if (base) {
      const fresh = await write.run(() => getPromotion(propertyId, base.id));
      if (!fresh || fresh.kind !== "ok") return;
      if (fingerprint(draftOf(fresh.data)) === fingerprint(draft)) {
        adopt(fresh.data);
        setSaved("Đã đối chiếu: máy chủ đã có đúng nội dung này.");
      } else {
        setBase(fresh.data);
        setServerNote(`Máy chủ chưa có thay đổi của bạn (phiên bản ${fresh.data.version}). Bản nháp vẫn được giữ; bạn có thể lưu lại.`);
      }
      write.reset();
      setUnresolved(false);
      return;
    }
    const found = await write.run(() => listPromotions(propertyId, { status: "", q: draft.slug.trim(), homepage: "" }));
    if (!found || found.kind !== "ok") return;
    const match = found.data.find((p) => p.slug === draft.slug.trim());
    if (match) {
      const full = await write.run(() => getPromotion(propertyId, match.id));
      if (full?.kind === "ok") {
        operation.current = null;
        onCreated(full.data);
      }
      return;
    }
    write.reset();
    setUnresolved(false);
    setServerNote("Máy chủ chưa có ưu đãi này. Bạn có thể bấm Tạo ưu đãi lại: cùng một thao tác sẽ không tạo trùng.");
  };

  const reloadLatest = async () => {
    if (!base) return;
    const fresh = await write.run(() => getPromotion(propertyId, base.id));
    if (!fresh || fresh.kind !== "ok") return;
    setBase(fresh.data);
    write.reset();
    setServerNote(`Đã tải phiên bản ${fresh.data.version} từ máy chủ. Bản nháp của bạn vẫn được giữ; Lưu bây giờ sẽ ghi đè phiên bản này.`);
  };

  const discardToServer = () => {
    if (base) adopt(base);
    setServerNote(null);
    write.reset();
  };

  const changeStatus = async (next: "Active" | "Disabled") => {
    if (!base) return;
    setSaved(null);
    setServerNote(null);
    const result = await write.run(() => setPromotionStatus(propertyId, base.id, base.version, next));
    if (result?.kind === "ok") {
      adopt(result.data);
      setSaved(next === "Active" ? "Đã bật: ưu đãi bắt đầu áp dụng cho các lần tìm phòng và giữ phòng hợp lệ." : "Đã tắt: ưu đãi không còn áp dụng cho giá mới. Booking đã giữ giá cũ vẫn giữ nguyên.");
    } else if (result?.kind === "unverified") setUnresolved(true);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!(COVER_TYPES as readonly string[]).includes(file.type)) { upload.setStatus({ phase: "failed", message: "Chỉ nhận ảnh JPEG, PNG hoặc WebP." }); return; }
    if (file.size > COVER_MAX_BYTES) { upload.setStatus({ phase: "failed", message: "Ảnh lớn hơn 10 MB." }); return; }
    const result = await upload.run(() => uploadPromotionCover(propertyId, file));
    if (result?.kind === "ok") set("coverMediaId", result.data.id);
  };

  const language = base?.languages.filter((l) => !l.isSource) ?? [];
  const coverSrc = draft.coverMediaId ? promotionCoverSrc(propertyId, draft.coverMediaId) : null;
  const statusButtons = base && (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`${BADGE} ${STATUS_TONE[base.status]}`} data-testid="editor-status">{STATUS_LABEL[base.status]}</span>
      {base.status !== "Active" && <ActionButton variant="primary" testId="promotion-activate" disabled={dirty || disabled} onClick={() => void changeStatus("Active")}>{base.status === "Draft" ? "Bật ưu đãi" : "Bật lại"}</ActionButton>}
      {base.status === "Active" && <ActionButton variant="outline" testId="promotion-disable" disabled={dirty || disabled} onClick={() => void changeStatus("Disabled")}>Tắt ưu đãi</ActionButton>}
      {dirty && <span className="text-xs text-gray-500 dark:text-gray-400">Lưu thay đổi trước khi đổi trạng thái.</span>}
    </div>
  );

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      aria-label={base ? "Chỉnh sửa ưu đãi" : "Tạo ưu đãi"}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => { if (!dirty || window.confirm("Bạn có thay đổi chưa lưu. Quay lại sẽ bỏ chúng. Vẫn quay lại?")) onBack(); }} className="text-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400" data-testid="promotion-back">
          ← Quay lại danh sách
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">{propertyName}{base ? ` · phiên bản ${base.version} · ${formatWhen(base.updatedAtUtc)}` : " · ưu đãi mới (nháp)"}</span>
      </div>

      {statusButtons}
      {base && (
        <Banner tone="info" testId="promotion-public-state">
          {base.publicNow
            ? "Thẻ đang hiện công khai trên website."
            : "Thẻ chưa hiện công khai. Thẻ hiện khi: ưu đãi Đang bật, được đặt hiển thị trên trang chủ, trong khoảng hiển thị và hạn đặt phòng chưa qua."}
          {" "}Việc ẩn thẻ chỉ ảnh hưởng nội dung quảng bá; ưu đãi vẫn tính giá chừng nào còn Đang bật.
        </Banner>
      )}
      {base?.status === "Active" && <Banner tone="warning">Ưu đãi đang bật: lưu thay đổi sẽ áp dụng cho các báo giá mới. Booking đã giữ hoặc đã xác nhận giữ nguyên giá đã chốt.</Banner>}
      {saved && <Banner tone="success" testId="promotion-saved" onDismiss={() => setSaved(null)}>{saved}</Banner>}

      <Section title="Nội dung giới thiệu" hint="Hiện trên thẻ ở trang chủ và trang chi tiết. Văn bản thuần, không dùng < >.">
        <TextField label="Tiêu đề *" testId="promotion-title" value={draft.title} maxLength={LIMITS.title} error={errorOf("title")} disabled={disabled}
          onChange={(v) => { set("title", v); if (!slugTouched) set("slug", slugify(v)); }} />
        <TextField label="Đường dẫn (slug) *" testId="promotion-slug" value={draft.slug} maxLength={LIMITS.slug} error={errorOf("slug")} disabled={disabled}
          hint={`Trang chi tiết: /offers/${draft.slug || "…"}`} onChange={(v) => { setSlugTouched(true); set("slug", v); }} />
        <TextAreaField label="Mô tả ngắn trên thẻ *" testId="promotion-summary" value={draft.summary} maxLength={LIMITS.summary} error={errorOf("summary")} disabled={disabled} rows={2} onChange={(v) => set("summary", v)} />
        <fieldset className="flex flex-col gap-3" disabled={disabled}>
          <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Nội dung chi tiết và điều kiện áp dụng</legend>
          {draft.body.map((paragraph, i) => (
            <div key={i} className="flex flex-col gap-1">
              <TextAreaField label={`Đoạn ${i + 1}`} testId={`promotion-body-${i + 1}`} value={paragraph} maxLength={LIMITS.bodyParagraphLength} rows={3} error={errorOf(`body${i + 1}`)}
                onChange={(v) => set("body", draft.body.map((p, j) => (j === i ? v : p)))} />
              <div className="flex gap-3 text-xs">
                <button type="button" className="underline disabled:opacity-40" disabled={i === 0} onClick={() => { const b = [...draft.body]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; set("body", b); }}>Lên</button>
                <button type="button" className="underline disabled:opacity-40" disabled={i === draft.body.length - 1} onClick={() => { const b = [...draft.body]; [b[i + 1], b[i]] = [b[i], b[i + 1]]; set("body", b); }}>Xuống</button>
                <button type="button" className="underline" onClick={() => set("body", draft.body.length > 1 ? draft.body.filter((_, j) => j !== i) : [""])}>Xoá đoạn</button>
              </div>
            </div>
          ))}
          {errorOf("body") && <p className="text-xs text-error-500">{errorOf("body")}</p>}
          <div><ActionButton variant="outline" testId="promotion-add-paragraph" disabled={draft.body.length >= LIMITS.bodyParagraphs} onClick={() => set("body", [...draft.body, ""])}>Thêm đoạn</ActionButton></div>
        </fieldset>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Ảnh bìa</span>
          <div className="flex flex-wrap items-center gap-4">
            {coverSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverSrc} alt={draft.coverAltText || "Ảnh bìa ưu đãi"} className="h-24 w-36 rounded-lg object-cover" data-testid="promotion-cover-preview" />
            ) : (
              <div className="flex h-24 w-36 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400 dark:bg-white/5">Chưa có ảnh</div>
            )}
            <div className="flex flex-col gap-2">
              <input type="file" accept={COVER_TYPES.join(",")} aria-label="Chọn ảnh bìa" data-testid="promotion-cover-input" disabled={disabled}
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
                className="block text-sm text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-medium dark:text-gray-300 dark:file:border-gray-700" />
              <span className="text-xs text-gray-500 dark:text-gray-400">JPEG, PNG hoặc WebP, tối đa 10 MB, tối thiểu {COVER_MIN.width}×{COVER_MIN.height}. Ảnh được kiểm tra trên máy chủ.</span>
              {draft.coverMediaId && <button type="button" className="w-fit text-xs underline" onClick={() => { set("coverMediaId", null); set("coverAltText", ""); set("showOnHomepage", false); }}>Gỡ ảnh bìa</button>}
            </div>
          </div>
          {upload.status.phase === "pending" && <Banner tone="info">Đang tải ảnh lên…</Banner>}
          {upload.status.phase === "refused" && <Banner tone="error" testId="promotion-cover-error">{refusalText(upload.status.failure)}</Banner>}
          {(upload.status.phase === "failed" || upload.status.phase === "unverified") && <Banner tone="error" testId="promotion-cover-error">{upload.status.message}</Banner>}
          {draft.coverMediaId && <TextField label="Mô tả ảnh (alt text) *" testId="promotion-alt" value={draft.coverAltText} maxLength={LIMITS.altText} error={errorOf("coverAltText")} disabled={disabled} onChange={(v) => set("coverAltText", v)} />}
        </div>
      </Section>

      <Section title="Quy tắc giảm giá" hint="Backend tự áp dụng khi khách chọn ngày. Chỉ giảm tiền phòng, không cộng dồn: mỗi booking dùng một ưu đãi có tổng giảm cao nhất.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Hình thức giảm" testId="promotion-kind" value={draft.kind} disabled={disabled} onChange={(v) => set("kind", v as PromotionDraft["kind"])}
            options={[["Percent", "Phần trăm (mỗi đêm)"], ["FixedAmount", "Số tiền cố định (mỗi phòng mỗi đêm)"]]} />
          <TextField label={draft.kind === "Percent" ? "Phần trăm giảm *" : "Số tiền giảm *"} testId="promotion-value" inputMode="decimal" value={draft.value} error={errorOf("value")} disabled={disabled}
            hint={draft.kind === "Percent" ? "Lớn hơn 0 và nhỏ hơn 100, tối đa 2 chữ số thập phân." : "Tính theo tiền tệ bên cạnh; VND là số nguyên."} onChange={(v) => set("value", v)} />
          {draft.kind === "FixedAmount" && <TextField label="Tiền tệ *" testId="promotion-currency" value={draft.currencyCode} maxLength={3} error={errorOf("currencyCode")} disabled={disabled} onChange={(v) => set("currencyCode", v.toUpperCase())} />}
        </div>
        <Banner tone="info">Giá mỗi đêm sau giảm luôn lớn hơn 0: một ưu đãi làm giá một đêm xuống dưới mức tối thiểu hợp lệ sẽ bị từ chối khi lưu, và không được áp dụng khi báo giá. Làm tròn từng đêm, từng phòng về đồng (VND).</Banner>
      </Section>

      <Section title="Phạm vi áp dụng">
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="sr-only">Loại phòng áp dụng</legend>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="radio" name="scope" checked={draft.allRoomTypes} onChange={() => set("allRoomTypes", true)} data-testid="promotion-scope-all" /> Tất cả loại phòng của {propertyName}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="radio" name="scope" checked={!draft.allRoomTypes} onChange={() => set("allRoomTypes", false)} data-testid="promotion-scope-some" /> Chỉ một số loại phòng
          </label>
          {!draft.allRoomTypes && (
            <div className="ml-6 flex flex-col gap-2" role="group" aria-label="Chọn loại phòng">
              {roomTypes.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={draft.roomTypeIds.includes(r.id)} data-testid={`promotion-room-${r.code}`}
                    onChange={(e) => set("roomTypeIds", e.target.checked ? [...draft.roomTypeIds, r.id] : draft.roomTypeIds.filter((x) => x !== r.id))} />
                  {r.name} <span className="text-xs text-gray-400">({r.code}{r.isActive ? "" : ", đang tắt"})</span>
                </label>
              ))}
              {errorOf("roomTypeIds") && <p className="text-xs text-error-500">{errorOf("roomTypeIds")}</p>}
            </div>
          )}
        </fieldset>
      </Section>

      <Section title="Điều kiện thời gian" hint="Ba khoảng khác nhau: ngày khách được đặt, các đêm lưu trú được giảm, và số đêm tối thiểu của cả booking. Ngày tính theo múi giờ của cơ sở, gồm cả hai đầu.">
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField label="Đặt phòng từ ngày" testId="promotion-booking-from" value={draft.bookingFrom} disabled={disabled} onChange={(v) => set("bookingFrom", v)} />
          <DateField label="Đặt phòng đến hết ngày" testId="promotion-booking-to" value={draft.bookingTo} error={errorOf("bookingTo")} disabled={disabled} onChange={(v) => set("bookingTo", v)} />
          <DateField label="Đêm lưu trú từ ngày" testId="promotion-stay-from" value={draft.stayFrom} disabled={disabled} onChange={(v) => set("stayFrom", v)} />
          <DateField label="Đêm lưu trú đến hết đêm" testId="promotion-stay-to" value={draft.stayTo} error={errorOf("stayTo")} disabled={disabled} onChange={(v) => set("stayTo", v)}
            hint="Ngày trả phòng không phải một đêm." />
          <TextField label="Số đêm tối thiểu của booking *" testId="promotion-min-nights" inputMode="numeric" value={draft.minNights} error={errorOf("minNights")} disabled={disabled} onChange={(v) => set("minNights", v)} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Để trống = không giới hạn. Booking chỉ có một phần số đêm nằm trong khoảng lưu trú chỉ được giảm các đêm nằm trong khoảng đó.</p>
      </Section>

      <Section title="Hiển thị trên website" hint="Chỉ điều khiển thẻ quảng bá ở trang chủ và trang /offers. Không đổi giá và không bật/tắt hiệu lực tính giá.">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={draft.showOnHomepage} disabled={disabled} data-testid="promotion-show" onChange={(e) => set("showOnHomepage", e.target.checked)} /> Hiện thẻ trên trang chủ
        </label>
        {errorOf("showOnHomepage") && <p className="text-xs text-error-500">{errorOf("showOnHomepage")}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Thứ tự hiển thị" testId="promotion-sort" inputMode="numeric" value={draft.sortOrder} error={errorOf("sortOrder")} disabled={disabled} hint="Số nhỏ hiện trước." onChange={(v) => set("sortOrder", v)} />
          <DateField label="Hiển thị từ ngày" testId="promotion-display-from" value={draft.displayFrom} disabled={disabled} onChange={(v) => set("displayFrom", v)} />
          <DateField label="Hiển thị đến hết ngày" testId="promotion-display-to" value={draft.displayTo} error={errorOf("displayTo")} disabled={disabled} onChange={(v) => set("displayTo", v)} />
        </div>
      </Section>

      {base && language.length > 0 && (
        <Section title="Bản dịch" hint="Tiếng Việt là bản gốc. Để trống một ô = website dùng bản tiếng Việt cho ô đó.">
          {language.map((l) => (
            <TranslationBlock key={l.code} code={l.code} name={l.displayName} draft={draft.translations[l.code] ?? { title: "", summary: "", coverAltText: "", body: [] }}
              source={draft} disabled={disabled} errorOf={errorOf} onChange={(next) => set("translations", { ...draft.translations, [l.code]: next })} />
          ))}
        </Section>
      )}

      <WriteFeedback status={write.status} working={write.status.phase === "pending" || upload.status.phase === "pending"} serverNote={serverNote} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkServer()}
        fieldErrorOf={(field) => field !== null && field in { ...visibleErrors }} />
      {serverNote && write.status.phase === "idle" && base && dirty && <div><ActionButton variant="outline" testId="promotion-discard" onClick={discardToServer}>Bỏ bản nháp, dùng bản máy chủ</ActionButton></div>}
      {showErrors && Object.keys(errors).length > 0 && <Banner tone="error" testId="promotion-errors">Còn {Object.keys(errors).length} mục cần sửa trước khi lưu.</Banner>}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white/95 p-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
        <ActionButton variant="primary" size="md" type="submit" testId="promotion-save" disabled={disabled || (base !== null && !dirty)}>
          {write.status.phase === "pending" ? "Đang lưu…" : base ? "Lưu thay đổi" : "Tạo ưu đãi"}
        </ActionButton>
        {dirty && <span className="text-sm text-warning-600 dark:text-warning-400" data-testid="promotion-dirty">Có thay đổi chưa lưu</span>}
        {unresolved && write.status.phase === "idle" && <span className="text-xs text-gray-500">Đã đối chiếu với máy chủ.</span>}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ small parts

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={`${CARD} flex flex-col gap-4`}>
      <div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h2>
        {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Select({ label, value, options, onChange, disabled, testId }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean; testId?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">{label}</label>
      <select id={id} data-testid={testId} className={FIELD} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  );
}

function DateField({ label, value, onChange, error, hint, disabled, testId }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; disabled?: boolean; testId?: string }) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">{label}</label>
      <input id={id} type="date" data-testid={testId} className={`${FIELD} ${error ? FIELD_ERROR : ""}`} value={value} disabled={disabled}
        aria-invalid={error ? true : undefined} aria-describedby={error || hint ? note : undefined} onChange={(e) => onChange(e.target.value)} />
      {(error || hint) && <p id={note} className={`mt-1.5 text-xs ${error ? "text-error-500" : "text-gray-500 dark:text-gray-400"}`}>{error ?? hint}</p>}
    </div>
  );
}

function TranslationBlock({
  code, name, draft, source, disabled, errorOf, onChange,
}: { code: string; name: string; draft: TextsDraft; source: PromotionDraft; disabled: boolean; errorOf: (field: string) => string | null; onChange: (next: TextsDraft) => void }) {
  const paragraphs = Math.max(source.body.filter((p) => p.trim() !== "").length, draft.body.length);
  return (
    <details className="rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-testid={`promotion-translation-${code}`}>
      <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-white/90">{name} ({code})</summary>
      <div className="mt-4 flex flex-col gap-4">
        <TextField label="Tiêu đề" testId={`promotion-${code}-title`} value={draft.title} placeholder={source.title} disabled={disabled} maxLength={LIMITS.title} error={errorOf(`translations.${code}.title`)} onChange={(v) => onChange({ ...draft, title: v })} />
        <TextAreaField label="Mô tả ngắn" testId={`promotion-${code}-summary`} value={draft.summary} disabled={disabled} maxLength={LIMITS.summary} rows={2} error={errorOf(`translations.${code}.summary`)} onChange={(v) => onChange({ ...draft, summary: v })} />
        {source.coverMediaId && <TextField label="Mô tả ảnh (alt text)" testId={`promotion-${code}-alt`} value={draft.coverAltText} disabled={disabled} maxLength={LIMITS.altText} error={errorOf(`translations.${code}.coverAltText`)} onChange={(v) => onChange({ ...draft, coverAltText: v })} />}
        {Array.from({ length: paragraphs }, (_, i) => (
          <TextAreaField key={i} label={`Đoạn ${i + 1}`} testId={`promotion-${code}-body-${i + 1}`} value={draft.body[i] ?? ""} disabled={disabled} maxLength={LIMITS.bodyParagraphLength} rows={3}
            error={errorOf(`translations.${code}.body${i + 1}`)}
            onChange={(v) => { const body = [...draft.body]; while (body.length <= i) body.push(""); body[i] = v; onChange({ ...draft, body }); }} />
        ))}
      </div>
    </details>
  );
}
