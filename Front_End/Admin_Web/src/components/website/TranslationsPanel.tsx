"use client";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the translation editor. One language at a time, the reference text on the left and the
 * language's own text on the right, row by row. The filtering, paging and counting are the server's (a language has thousands
 * of texts); what a row shows as "translated" is a text that really exists — a fallback is never shown as one. Drafts live in
 * this screen until they are saved: changing the filter, the scope or the page keeps them, changing the language asks first,
 * and leaving the page warns. A save is checked against the version the row had when editing began (a 409 keeps the draft and
 * offers the latest), and a lost answer is never retried before the server has been read.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import {
  clearTranslation,
  listLanguages,
  listTranslations,
  saveTranslation,
  type WebsiteLanguage,
  type WebsiteTranslationList,
  type WebsiteTranslationRow,
} from "@/lib/api/website";
import { percent, refusalText } from "@/lib/website/wording";
import { useWebsiteHost } from "./WebsiteAccessGate";
import { describeFailure, useWebsiteList, useWriteAction } from "./useWebsiteData";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, formatWhen } from "./WebsiteUi";

const SCOPE_LABELS: Record<string, string> = {
  customer: "Giao diện khách",
  shared: "Dùng chung",
  admin: "Quản trị",
  content: "Nội dung",
};

const STATUS_FILTERS: [string, string][] = [
  ["", "Tất cả"],
  ["todo", "Cần làm (thiếu hoặc cũ)"],
  ["missing", "Chưa dịch"],
  ["outdated", "Cần cập nhật"],
  ["manual", "Đã chỉnh sửa tay"],
  ["translated", "Đã dịch"],
];

const STATUS_BADGE: Record<string, { label: string; color: "success" | "warning" | "error" }> = {
  translated: { label: "Đã dịch", color: "success" },
  missing: { label: "Chưa dịch", color: "error" },
  outdated: { label: "Cần cập nhật", color: "warning" },
};

const PAGE_SIZE = 25;
const FIELD_CLASSES =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** What the operator typed for a row, and the version of the row it was typed against (`null`: no text existed yet). */
interface Draft {
  text: string;
  baseVersion: number | null;
}

export default function TranslationsPanel({ initialLocale }: { initialLocale?: string | null }) {
  const languages = useWebsiteList(listLanguages, []);
  const [chosen, setChosen] = useState<string | null>(initialLocale ?? null);
  const list = languages.state.status === "ready" ? languages.state.data : null;
  // The chosen language is kept only while it exists; otherwise the default (or the first) one is shown.
  const locale = useMemo(() => {
    if (!list || list.length === 0) return null;
    return list.find((item) => item.code.toLowerCase() === chosen?.toLowerCase())?.code ?? list.find((item) => item.isDefault)?.code ?? list[0].code;
  }, [list, chosen]);

  return (
    <div data-testid="translations-panel">
      <PageHeader title="Bản dịch">
        Sửa từng câu của một ngôn ngữ, đối chiếu với câu nguồn. Câu thiếu được lấy tạm từ ngôn ngữ mặc định cho khách nhưng ở đây vẫn
        tính là chưa dịch. Thêm cả một ngôn ngữ cùng lúc bằng gói ở màn{" "}
        <Link href="/website/languages" className="font-medium text-brand-500 underline hover:text-brand-600 dark:text-brand-400">
          Ngôn ngữ
        </Link>
        .
      </PageHeader>
      {languages.state.status === "loading" && <LoadingPanel what="ngôn ngữ" />}
      {languages.state.status === "error" && <ErrorPanel message={languages.state.message} onRetry={() => void languages.reload()} />}
      {languages.state.status === "ready" && locale !== null && (
        <Editor key={locale} locale={locale} languages={languages.state.data} onLocale={setChosen} />
      )}
      {languages.state.status === "ready" && languages.state.data.length === 0 && (
        <Banner tone="warning">Chưa có ngôn ngữ nào. Hãy thêm ở màn Ngôn ngữ.</Banner>
      )}
    </div>
  );
}

function Editor({ locale, languages, onLocale }: { locale: string; languages: WebsiteLanguage[]; onLocale: (code: string) => void }) {
  const host = useWebsiteHost();
  const [scope, setScope] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("todo");
  const [reference, setReference] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowNotes, setRowNotes] = useState<Record<string, { tone: "error" | "warning" | "info"; text: string; canRefresh?: boolean }>>({});
  const [pendingLocale, setPendingLocale] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const write = useWriteAction();
  const dirtyCount = Object.keys(drafts).length;

  // The search is sent a moment after typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Leaving the page with unsaved text asks first.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const { state, reload } = useWebsiteList(
    (signal) => listTranslations(locale, { scope, group, status, search: applied, reference, page, pageSize: PAGE_SIZE }, signal),
    [locale, scope, group, status, applied, reference, page]
  );
  const data = state.status === "ready" ? state.data : null;
  const language = languages.find((item) => item.code === locale);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const setNote = (key: string, note: { tone: "error" | "warning" | "info"; text: string; canRefresh?: boolean } | null) =>
    setRowNotes((current) => {
      const next = { ...current };
      if (note) next[key] = note;
      else delete next[key];
      return next;
    });
  const edit = (row: WebsiteTranslationRow, text: string) => {
    setNotice(null);
    setDrafts((current) => ({ ...current, [row.key]: { text, baseVersion: current[row.key]?.baseVersion ?? row.version } }));
  };
  const discard = (key: string) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setNote(key, null);
  };

  const save = async (row: WebsiteTranslationRow) => {
    const draft = drafts[row.key];
    if (!draft || savingKey !== null) return;
    setSavingKey(row.key);
    setNote(row.key, null);
    try {
      const result = await write.run(() => saveTranslation(locale, row.key, draft.text.trim(), draft.baseVersion));
      if (result?.kind === "ok") {
        discard(row.key);
        setNotice(`Đã lưu câu ${row.key} (${locale}).`);
        void reload();
      } else if (result?.kind === "refused") {
        setNote(row.key, {
          tone: "error",
          text: result.code === "stale-version" ? "Câu này đã thay đổi trên máy chủ. Bản nháp của bạn vẫn được giữ, chưa có gì được lưu." : refusalText(result),
          canRefresh: result.code === "stale-version",
        });
      } else if (result?.kind === "unverified") {
        setNote(row.key, { tone: "warning", text: `${result.message} Hệ thống không tự gửi lại.`, canRefresh: true });
      } else if (result) {
        setNote(row.key, { tone: "error", text: describeFailure(result) });
      }
    } finally {
      setSavingKey(null);
    }
  };

  /** Reads the server again for a row after a conflict or a lost answer; the draft text stays, only its base version moves. */
  const refreshRow = async (row: WebsiteTranslationRow) => {
    const fresh = await reload();
    write.reset();
    if (!fresh) {
      setNote(row.key, { tone: "error", text: "Không đọc được máy chủ. Hãy thử lại." });
      return;
    }
    const latest = fresh.rows.find((item) => item.key === row.key);
    const draft = drafts[row.key];
    if (!latest) {
      setNote(row.key, { tone: "info", text: "Câu này không còn trong danh sách hiện tại (có thể do bộ lọc)." });
      return;
    }
    if (draft && latest.value !== null && latest.value === draft.text.trim() && latest.version !== draft.baseVersion) {
      discard(row.key);
      setNotice(`Đã kiểm tra: máy chủ đã có đúng nội dung này cho ${row.key}. Việc lưu đã được ghi nhận.`);
      return;
    }
    setDrafts((current) => (current[row.key] ? { ...current, [row.key]: { ...current[row.key], baseVersion: latest.version } } : current));
    setNote(row.key, {
      tone: "info",
      text: latest.value === null ? "Máy chủ chưa có bản dịch cho câu này. Lưu sẽ tạo mới." : `Bản trên máy chủ (phiên bản ${latest.version}, ${formatWhen(latest.updatedAtUtc)}): "${latest.value}". Lưu sẽ ghi đè lên bản đó.`,
    });
  };

  const remove = async (row: WebsiteTranslationRow) => {
    if (row.version === null || savingKey !== null) return;
    setSavingKey(row.key);
    setNote(row.key, null);
    try {
      const result = await write.run(() => clearTranslation(locale, row.key, row.version!));
      if (result?.kind === "ok") {
        discard(row.key);
        setNotice(`Đã xoá bản dịch ${locale} của ${row.key}; câu này lại thiếu.`);
        void reload();
      } else if (result?.kind === "refused") {
        setNote(row.key, { tone: "error", text: result.code === "stale-version" ? "Câu này đã thay đổi trên máy chủ. Chưa có gì bị xoá." : refusalText(result), canRefresh: result.code === "stale-version" });
      } else if (result?.kind === "unverified") {
        setNote(row.key, { tone: "warning", text: `${result.message} Hệ thống không tự gửi lại.`, canRefresh: true });
      } else if (result) {
        setNote(row.key, { tone: "error", text: describeFailure(result) });
      }
    } finally {
      setSavingKey(null);
    }
  };

  const changeLocale = (code: string) => {
    if (code === locale) return;
    if (dirtyCount > 0) setPendingLocale(code);
    else onLocale(code);
  };

  const facets = data?.facets;
  const done = facets ? percent(facets.translated, facets.required) : 0;

  return (
    <>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Ngôn ngữ đang dịch
          <select data-testid="locale-select" value={locale} onChange={(event) => changeLocale(event.target.value)} className={FIELD_CLASSES} disabled={savingKey !== null}>
            {languages.map((item) => (
              <option key={item.code} value={item.code}>
                {item.nativeName} ({item.code}){item.isDefault ? " — mặc định" : ""}
                {item.isActive ? "" : " — đang tắt"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Ngôn ngữ nguồn để đối chiếu
          <select data-testid="reference-select" value={reference} onChange={(event) => { setReference(event.target.value); setPage(1); }} className={FIELD_CLASSES}>
            <option value="">Mặc định của hệ thống{data ? ` (${data.referenceLocale})` : ""}</option>
            {languages.filter((item) => item.code !== locale).map((item) => (
              <option key={item.code} value={item.code}>
                {item.nativeName} ({item.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Trạng thái
          <select data-testid="status-select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={FIELD_CLASSES}>
            {STATUS_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Mô-đun
          <select data-testid="group-select" value={group} onChange={(event) => { setGroup(event.target.value); setPage(1); }} className={FIELD_CLASSES}>
            <option value="">Tất cả mô-đun</option>
            {(facets?.groups ?? []).map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} ({item.count})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="Phạm vi" className="flex flex-wrap gap-2">
          {[["", "Tất cả"], ...(facets?.scopes ?? []).map((item): [string, string] => [item.name, `${SCOPE_LABELS[item.name] ?? item.name} (${item.count})`])].map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              role="tab"
              aria-selected={scope === value}
              data-testid={`scope-${value || "all"}`}
              onClick={() => { setScope(value); setGroup(""); setPage(1); }}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${scope === value ? "bg-brand-500 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex w-full flex-col gap-1 text-sm font-medium text-gray-700 sm:w-72 dark:text-gray-300">
          Tìm theo chữ hoặc khoá
          <input data-testid="search-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ví dụ: đặt phòng, hold" autoComplete="off" className={FIELD_CLASSES} />
        </label>
      </div>

      {pendingLocale && (
        <div className="mb-3">
          <Banner tone="warning" testId="leave-warning">
            <p>
              Có {dirtyCount} câu chưa lưu. Chuyển sang ngôn ngữ khác sẽ bỏ các thay đổi này.
            </p>
            <div className="mt-2 flex gap-3">
              <ActionButton onClick={() => { const next = pendingLocale; setPendingLocale(null); onLocale(next); }} testId="leave-yes">
                Bỏ thay đổi và chuyển
              </ActionButton>
              <ActionButton variant="outline" onClick={() => setPendingLocale(null)} testId="leave-no">
                Ở lại
              </ActionButton>
            </div>
          </Banner>
        </div>
      )}
      {notice && (
        <div className="mb-3">
          <Banner tone="success" testId="website-success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}
      {dirtyCount > 0 && (
        <p className="mb-3 text-sm text-warning-700 dark:text-warning-300" data-testid="dirty-count">
          Có {dirtyCount} câu chưa lưu. Đổi bộ lọc hay trang không làm mất chúng.
        </p>
      )}

      {state.status === "loading" && !data && <LoadingPanel what="bản dịch" />}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => void reload()} />}
      {data && facets && (
        <>
          <p data-testid="coverage" className="mb-3 text-sm text-gray-600 dark:text-gray-300">
            <span className="font-medium">{language?.nativeName ?? data.locale}</span>
            {language && !language.isActive ? " (đang tắt)" : ""}: đã dịch {facets.translated}/{facets.required} câu bắt buộc ({done}%) · thiếu {facets.missing} · cần cập nhật {facets.outdated} · chỉnh tay {facets.manual}. Đang hiển thị {data.total} câu theo bộ lọc.
          </p>
          <ul className="flex flex-col gap-3" data-testid="translation-rows">
            {data.rows.length === 0 && (
              <li className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700" data-testid="no-rows">
                Không có câu nào khớp bộ lọc.
              </li>
            )}
            {data.rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                data={data}
                draft={drafts[row.key]}
                note={rowNotes[row.key]}
                saving={savingKey === row.key}
                disabled={savingKey !== null || host.signingOut}
                onEdit={(text) => edit(row, text)}
                onSave={() => void save(row)}
                onDiscard={() => discard(row.key)}
                onRemove={() => void remove(row)}
                onRefresh={() => void refreshRow(row)}
              />
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label="Phân trang" className="mt-4 flex items-center justify-between gap-3">
              <ActionButton variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} testId="page-prev">
                Trang trước
              </ActionButton>
              <span className="text-sm text-gray-600 dark:text-gray-300" data-testid="page-info">
                Trang {page}/{pages}
              </span>
              <ActionButton variant="outline" onClick={() => setPage((current) => Math.min(pages, current + 1))} disabled={page >= pages} testId="page-next">
                Trang sau
              </ActionButton>
            </nav>
          )}
        </>
      )}
    </>
  );
}

/** What the row's textarea says about itself, before the server is asked (the server validates again and decides). */
function localProblem(row: WebsiteTranslationRow, text: string): string | null {
  const value = text.trim();
  if (value === "") return "Hãy nhập nội dung.";
  if (value.length > 4000) return "Tối đa 4000 ký tự.";
  if (/[\u0000-\u001F\u007F]/.test(value)) return "Không dùng xuống dòng hay ký tự điều khiển.";
  if (/[<>]/.test(value)) return "Chỉ dùng chữ thường: không dùng '<' và '>'.";
  const missing = row.placeholders.filter((name) => !new RegExp(`\\{\\s*${name}\\s*[,}]`).test(value));
  return missing.length > 0 ? `Cần giữ lại ${missing.map((name) => `{${name}}`).join(", ")}.` : null;
}

function Row({
  row,
  data,
  draft,
  note,
  saving,
  disabled,
  onEdit,
  onSave,
  onDiscard,
  onRemove,
  onRefresh,
}: {
  row: WebsiteTranslationRow;
  data: WebsiteTranslationList;
  draft: Draft | undefined;
  note: { tone: "error" | "warning" | "info"; text: string; canRefresh?: boolean } | undefined;
  saving: boolean;
  disabled: boolean;
  onEdit: (text: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const text = draft ? draft.text : row.value ?? "";
  const problem = draft ? localProblem(row, draft.text) : null;
  const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE.translated;

  const insert = (name: string) => {
    const element = area.current;
    const token = `{${name}}`;
    if (!element) return onEdit(`${text}${token}`);
    const start = element.selectionStart ?? text.length;
    const end = element.selectionEnd ?? text.length;
    onEdit(`${text.slice(0, start)}${token}${text.slice(end)}`);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <li data-testid={`row-${row.key}`} className={`rounded-2xl border bg-white p-4 dark:bg-white/[0.03] ${draft ? "border-warning-300 dark:border-warning-500/40" : "border-gray-200 dark:border-gray-800"}`}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Câu nguồn ({data.referenceLocale})</p>
          <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-white/90" data-testid={`source-${row.key}`}>
            {row.sourceText}
          </p>
          {row.context && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Ngữ cảnh: {row.context}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge size="sm" color={badge.color}>
              {badge.label}
            </Badge>
            {row.isManual && (
              <Badge size="sm" color="info">
                Đã chỉnh tay
              </Badge>
            )}
            <Badge size="sm" color="light">
              {SCOPE_LABELS[row.scope] ?? row.scope} · {row.group}
            </Badge>
          </div>
          <p className="mt-2 break-all font-mono text-[11px] text-gray-400">{row.key}</p>
        </div>
        <div className="min-w-0">
          <label htmlFor={`value-${row.key}`} className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Bản dịch ({data.locale})
          </label>
          <textarea
            id={`value-${row.key}`}
            ref={area}
            data-testid={`value-${row.key}`}
            rows={Math.min(8, Math.max(2, Math.ceil(Math.max(text.length, row.sourceText.length) / 60)))}
            value={text}
            disabled={disabled}
            onChange={(event) => onEdit(event.target.value)}
            maxLength={4000}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `problem-${row.key}` : undefined}
            placeholder={row.status === "missing" ? "Chưa có bản dịch — nhập vào đây" : undefined}
            className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm text-gray-800 focus:outline-hidden focus:ring-3 disabled:opacity-60 dark:bg-gray-900 dark:text-white/90 ${problem ? "border-error-500 focus:ring-error-500/20" : "border-gray-300 focus:border-brand-300 focus:ring-brand-500/10 dark:border-gray-700"}`}
          />
          {row.placeholders.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">Biến cần giữ nguyên:</span>
              {row.placeholders.map((name) => (
                <button key={name} type="button" onClick={() => insert(name)} disabled={disabled} className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700 hover:bg-brand-100 disabled:opacity-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300" title="Chèn vào vị trí con trỏ" data-testid={`placeholder-${row.key}-${name}`}>
                  {`{${name}}`}
                </button>
              ))}
            </div>
          )}
          {problem && (
            <p id={`problem-${row.key}`} role="alert" className="mt-1.5 text-xs text-error-500">
              {problem}
            </p>
          )}
          {note && (
            <div className="mt-2">
              <Banner tone={note.tone} testId={`note-${row.key}`}>
                <p>{note.text}</p>
                {note.canRefresh && (
                  <p className="mt-1">
                    <button type="button" onClick={onRefresh} disabled={disabled} className="font-medium underline disabled:opacity-50" data-testid={`refresh-${row.key}`}>
                      Kiểm tra bản trên máy chủ
                    </button>
                  </p>
                )}
              </Banner>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ActionButton onClick={onSave} disabled={disabled || !draft || problem !== null} testId={`save-${row.key}`}>
              {saving ? "Đang lưu…" : "Lưu"}
            </ActionButton>
            <ActionButton variant="outline" onClick={onDiscard} disabled={disabled || !draft} testId={`discard-${row.key}`}>
              Hoàn tác
            </ActionButton>
            {!data.isDefaultLocale && row.version !== null && (
              <ActionButton variant="outline" onClick={onRemove} disabled={disabled || draft !== undefined} testId={`remove-${row.key}`}>
                Xoá bản dịch
              </ActionButton>
            )}
            {row.updatedAtUtc && <span className="text-xs text-gray-400">Cập nhật {formatWhen(row.updatedAtUtc)}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}
