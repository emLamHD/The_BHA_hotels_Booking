"use client";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: add or update a language from a pack — one of the library that ships with the product, or a
 * JSON file the operator uploads. The flow is always the same and always on the server: choose → check (the server validates
 * and says exactly what installing would do, changing nothing) → confirm → apply (one transaction, bound to the check by its
 * token). A stale check, a double click or a lost answer can neither install twice nor report a success that did not happen.
 * A pack is data, parsed and validated — never executed, never fetched from a URL.
 */

import React, { useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import {
  applyPack,
  downloadPackTemplate,
  listLibraryPacks,
  previewPack,
  type LibraryPack,
  type PackIssue,
  type PackMode,
  type PackPreview,
  type PackSource,
  type WebsiteLanguage,
} from "@/lib/api/website";
import { downloadText } from "@/lib/website/download";
import { refusalText } from "@/lib/website/wording";
import { useWebsiteHost } from "./WebsiteAccessGate";
import { describeFailure, useWebsiteList, useWriteAction } from "./useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel, WriteFeedback } from "./WebsiteUi";

const MAX_FILE_BYTES = 6 * 1024 * 1024;

/** The text of a chosen file (`Blob.text` where the browser has it, a `FileReader` where it does not). */
function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

type Choice = { kind: "library"; pack: LibraryPack } | { kind: "file"; name: string; json: string };

const sourceOf = (choice: Choice): PackSource => (choice.kind === "library" ? { builtInPackId: choice.pack.id } : { json: choice.json });

const LIBRARY_STATE: Record<string, { label: string; color: "success" | "warning" | "light"; action: string }> = {
  available: { label: "Chưa cài", color: "light", action: "Cài" },
  installed: { label: "Đã cài bản mới nhất", color: "success", action: "Cài lại" },
  "update-available": { label: "Có bản cập nhật", color: "warning", action: "Cập nhật" },
};

export default function LanguagePackDialog({
  initialTab,
  preselect,
  languages,
  reload,
  onClose,
  onDone,
}: {
  initialTab: "library" | "upload";
  preselect: string | null;
  languages: WebsiteLanguage[];
  reload: () => Promise<WebsiteLanguage[] | null>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const host = useWebsiteHost();
  const library = useWebsiteList(listLibraryPacks, []);
  const { status, run, reset } = useWriteAction();
  const [tab, setTab] = useState<"library" | "upload">(initialTab);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [mode, setMode] = useState<PackMode>("keep-manual");
  const [enable, setEnable] = useState(false);
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  // Once the server has installed the pack, this dialog has done its job: the same preview token is never sent twice.
  const [applied, setApplied] = useState(false);

  const working = status.phase === "pending" || checking || verifying;
  const locked = working || applied || status.phase === "unverified" || host.signingOut;

  /** Anything the preview described is void the moment the source or the mode changes. */
  const choose = (next: Choice | null) => {
    setChoice(next);
    setPreview(null);
    setPreviewError(null);
    setServerNote(null);
    setEnable(false);
    reset();
  };

  const check = async (next: Choice | null = choice, nextMode: PackMode = mode) => {
    if (!next || locked) return;
    setChecking(true);
    setPreview(null);
    setPreviewError(null);
    setServerNote(null);
    reset();
    try {
      const result = await previewPack(sourceOf(next), nextMode);
      if (result.kind === "ok") {
        setPreview(result.data);
        setEnable(result.data.canEnable);
      } else if (result.kind === "refused") {
        setPreviewError(refusalText(result));
      } else if (result.kind === "unauthenticated") {
        host.onUnauthenticated();
      } else if (result.kind === "denied") {
        void host.onDenied();
      } else {
        setPreviewError(describeFailure(result));
      }
    } finally {
      setChecking(false);
    }
  };

  const onFile = async (file: File | null) => {
    setFileError(null);
    if (!file) return choose(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError("Tệp lớn hơn 6 MB nên không được nhận.");
      return choose(null);
    }
    try {
      const json = await readText(file);
      choose({ kind: "file", name: file.name, json });
    } catch {
      setFileError("Không đọc được tệp này.");
      choose(null);
    }
  };

  const setModeAndInvalidate = (next: PackMode) => {
    setMode(next);
    setPreview(null);
    setPreviewError(null);
    setEnable(false);
    reset();
  };

  const apply = async () => {
    if (!choice || !preview || locked || !preview.canApply) return;
    const result = await run(() => applyPack(sourceOf(choice), mode, preview.previewToken, enable && preview.canEnable));
    if (result?.kind === "ok") {
      setApplied(true);
      const c = result.data.counts;
      onDone(
        `Đã ${preview.isNewLanguage ? "thêm" : "cập nhật"} ngôn ngữ ${result.data.language.nativeName} (${result.data.language.code}) từ gói: thêm ${c.added}, cập nhật ${c.updated}, giữ ${c.keptManual} bản chỉnh tay.${result.data.enabled ? " Ngôn ngữ đã được bật." : ""}`
      );
    } else if (result?.kind === "refused" && result.code === "stale-preview") {
      setPreview(null);
    }
  };

  /** After a lost answer: read the server and say whether this pack is the one installed now. */
  const verify = async () => {
    if (!preview) return;
    setVerifying(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("Không đọc được máy chủ. Hãy thử lại trước khi thay đổi gì.");
        return;
      }
      const installed = fresh.find((language) => language.code.toLowerCase() === preview.locale.toLowerCase());
      reset();
      if (installed && installed.packVersion === preview.packVersion && installed.packId === preview.packId) {
        setServerNote(`Đã kiểm tra: máy chủ đang có gói ${preview.packId} ${preview.packVersion} cho ${installed.code}. Việc cài đặt đã được ghi nhận.`);
      } else {
        setServerNote("Đã kiểm tra: máy chủ chưa có gói này nên chưa được cài. Hãy kiểm tra gói lại rồi áp dụng.");
        setPreview(null);
      }
    } finally {
      setVerifying(false);
    }
  };

  const downloadTemplate = async () => {
    setTemplateError(null);
    const result = await downloadPackTemplate(languages.find((language) => language.isDefault)?.code);
    if (result.kind === "ok") downloadText("bha-language-template.json", result.data);
    else setTemplateError(result.kind === "refused" ? refusalText(result) : describeFailure(result));
  };

  const preselected = preselect ? library.state.status === "ready" ? library.state.data.find((pack) => pack.id === preselect) : undefined : undefined;
  const autoChecked = React.useRef(false);
  React.useEffect(() => {
    if (preselected && !autoChecked.current) {
      autoChecked.current = true;
      const next: Choice = { kind: "library", pack: preselected };
      setChoice(next);
      void check(next);
    }
    // runs once when the library has loaded and a pack was preselected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected]);

  return (
    <DialogShell title="Thêm hoặc cập nhật ngôn ngữ từ gói" onClose={onClose} busy={working} testId="pack-dialog" wide>
      <div className="flex gap-2" role="tablist" aria-label="Nguồn gói">
        {(
          [
            ["library", "Thư viện có sẵn"],
            ["upload", "Tải tệp JSON"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            disabled={working}
            onClick={() => {
              setTab(id);
              choose(null);
            }}
            data-testid={`pack-tab-${id}`}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === id ? "bg-brand-500 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "library" && (
        <div data-testid="pack-library">
          {library.state.status === "loading" && <LoadingPanel what="thư viện gói" />}
          {library.state.status === "error" && <ErrorPanel message={library.state.message} onRetry={() => void library.reload()} />}
          {library.state.status === "ready" && (
            <ul className="flex flex-col gap-2">
              {library.state.data.map((pack) => {
                const state = LIBRARY_STATE[pack.state] ?? LIBRARY_STATE.available;
                const selected = choice?.kind === "library" && choice.pack.id === pack.id;
                return (
                  <li key={pack.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${selected ? "border-brand-500" : "border-gray-200 dark:border-gray-800"}`} data-testid={`library-${pack.locale}`}>
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 dark:text-white/90">
                        {pack.nativeName} <span className="font-mono text-xs text-gray-500">({pack.locale})</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Gói {pack.version} · {pack.texts} câu{pack.missingFromCatalog > 0 ? ` · thiếu ${pack.missingFromCatalog} câu so với danh mục` : ""}
                        {pack.installedVersion ? ` · đang cài ${pack.installedVersion}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge color={state.color}>{state.label}</Badge>
                      <ActionButton
                        variant="outline"
                        disabled={locked}
                        testId={`library-pick-${pack.locale}`}
                        onClick={() => {
                          const next: Choice = { kind: "library", pack };
                          choose(next);
                          void check(next);
                        }}
                      >
                        {state.action}
                      </ActionButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "upload" && (
        <div className="flex flex-col gap-3" data-testid="pack-upload">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Chọn tệp JSON của một gói ngôn ngữ (tối đa 6 MB). Máy chủ sẽ kiểm tra tệp trước khi có bất kỳ thay đổi nào. Chưa có tệp? Tải mẫu về, dịch rồi nhập lại.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">
              <input
                type="file"
                accept=".json,application/json"
                data-testid="pack-file"
                disabled={locked}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  void onFile(file);
                }}
              />
              Chọn tệp…
            </label>
            <ActionButton variant="outline" onClick={() => void downloadTemplate()} testId="pack-template" disabled={locked}>
              Tải mẫu
            </ActionButton>
            {choice?.kind === "file" && <span className="text-sm text-gray-700 dark:text-gray-200">{choice.name}</span>}
          </div>
          {fileError && <Banner tone="error">{fileError}</Banner>}
          {templateError && <Banner tone="error">{templateError}</Banner>}
          {choice?.kind === "file" && !preview && (
            <div>
              <ActionButton onClick={() => void check()} disabled={locked} testId="pack-check">
                {checking ? "Đang kiểm tra…" : "Kiểm tra gói"}
              </ActionButton>
            </div>
          )}
        </div>
      )}

      {choice && (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800" disabled={locked}>
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-gray-500">Khi một câu đã được chỉnh tay</legend>
          {(
            [
              ["keep-manual", "Giữ bản chỉnh tay của tôi (khuyên dùng)"],
              ["overwrite", "Ghi đè bằng nội dung trong gói"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input type="radio" name="pack-mode" value={value} checked={mode === value} onChange={() => setModeAndInvalidate(value)} data-testid={`pack-mode-${value}`} />
              {label}
            </label>
          ))}
          {preview === null && !checking && tab === "library" && (
            <div className="pt-1">
              <ActionButton variant="outline" onClick={() => void check()} disabled={locked} testId="pack-recheck">
                Kiểm tra lại với lựa chọn này
              </ActionButton>
            </div>
          )}
        </fieldset>
      )}

      {checking && <LoadingPanel what="kết quả kiểm tra" />}
      {previewError && (
        <Banner tone="error" testId="pack-preview-error">
          <p className="font-medium">Gói chưa dùng được. Chưa có gì được thay đổi.</p>
          <p className="mt-1">{previewError}</p>
        </Banner>
      )}
      {preview && <PreviewView preview={preview} enable={enable} onEnable={setEnable} disabled={locked} />}

      <WriteFeedback status={status} working={working} serverNote={serverNote} onCheckServer={() => void verify()} />
      <DialogActions>
        <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
          Đóng
        </ActionButton>
        {preview && (
          <ActionButton onClick={() => void apply()} disabled={locked || !preview.canApply} testId="pack-apply">
            {status.phase === "pending" ? "Đang áp dụng…" : preview.isNewLanguage ? "Thêm ngôn ngữ" : "Cập nhật ngôn ngữ"}
          </ActionButton>
        )}
      </DialogActions>
    </DialogShell>
  );
}

function PreviewView({ preview, enable, onEnable, disabled }: { preview: PackPreview; enable: boolean; onEnable: (value: boolean) => void; disabled: boolean }) {
  const c = preview.counts;
  const covered = Math.max(0, c.required - c.missingAfter);
  const rows: [string, number, string][] = [
    ["Thêm mới", c.added, "added"],
    ["Cập nhật", c.updated, "updated"],
    ["Giữ nguyên", c.unchanged, "unchanged"],
    ["Giữ bản chỉnh tay", c.keptManual, "keptManual"],
    ["Ghi đè bản chỉnh tay", c.overwrittenManual, "overwrittenManual"],
    ["Bỏ qua (không thuộc danh mục)", c.ignored, "ignored"],
    ["Bị từ chối (lỗi)", c.rejected, "rejected"],
  ];
  return (
    <section data-testid="pack-preview" className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-gray-800 dark:text-white/90">
            {preview.nativeName} <span className="font-mono text-xs text-gray-500">({preview.locale})</span> · gói {preview.packVersion}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {preview.isNewLanguage ? "Ngôn ngữ mới" : `Cập nhật ngôn ngữ đang có (phiên bản ${preview.languageVersion})`}
            {preview.defaultCurrency ? ` · tiền mặc định ${preview.defaultCurrency}` : ""}
          </div>
        </div>
        <Badge color={preview.canEnable ? "success" : "warning"}>
          {covered}/{c.required} câu bắt buộc {preview.canEnable ? "— đủ để bật" : "— chưa đủ để bật"}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {rows.map(([label, value, id]) => (
          <div key={id} className="flex justify-between gap-3" data-testid={`count-${id}`}>
            <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="font-medium text-gray-800 dark:text-white/90">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3" data-testid="count-missingAfter">
          <dt className="text-gray-500 dark:text-gray-400">Còn thiếu sau khi cài</dt>
          <dd className="font-medium text-gray-800 dark:text-white/90">{c.missingAfter}</dd>
        </div>
      </dl>
      {preview.issues.length > 0 && <IssueList issues={preview.issues} truncated={preview.issuesTruncated} />}
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" checked={enable && preview.canEnable} disabled={disabled || !preview.canEnable} onChange={(event) => onEnable(event.target.checked)} data-testid="pack-enable" />
        Bật ngôn ngữ cho khách ngay sau khi cài
        {!preview.canEnable && <span className="text-xs text-gray-500">(cần đủ mọi câu bắt buộc và không có lỗi)</span>}
      </label>
      {!preview.canApply && (
        <Banner tone="warning">Gói có lỗi nên chưa áp dụng được. Hãy sửa tệp rồi kiểm tra lại. Chưa có gì được thay đổi.</Banner>
      )}
    </section>
  );
}

function IssueList({ issues, truncated }: { issues: PackIssue[]; truncated: boolean }) {
  return (
    <div data-testid="pack-issues">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Vấn đề phát hiện</p>
      <ul className="max-h-48 overflow-auto rounded-lg border border-gray-200 text-sm dark:border-gray-800">
        {issues.slice(0, 100).map((issue, index) => (
          <li key={index} className="flex gap-2 border-b border-gray-100 px-3 py-1.5 last:border-0 dark:border-gray-800">
            <Badge color={issue.severity === "error" ? "error" : "warning"}>{issue.severity === "error" ? "Lỗi" : "Lưu ý"}</Badge>
            <span className="min-w-0 break-words">
              {issue.key && <span className="mr-2 font-mono text-xs text-gray-500">{issue.key}</span>}
              {issue.message}
            </span>
          </li>
        ))}
      </ul>
      {(truncated || issues.length > 100) && <p className="mt-1 text-xs text-gray-500">Danh sách bị cắt bớt; hãy sửa các lỗi trên rồi kiểm tra lại để xem phần còn lại.</p>}
    </div>
  );
}
