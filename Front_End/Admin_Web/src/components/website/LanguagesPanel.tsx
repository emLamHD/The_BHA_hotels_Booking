"use client";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: "Ngôn ngữ & bản dịch" — the languages of the website as cards: how much of each is really
 * translated (a fallback never counts), which currency a visitor gets with it, and every action — add or update from a pack,
 * export a pack, edit, switch on or off, make default, delete. Every figure and every change comes from the Admin API; nothing
 * is kept locally. The server owns the rules (exactly one active default that is complete, a language is switched on only when
 * every required text exists and is valid, no delete of one that is on or the default); this screen asks before the risky ones
 * and shows the server's reason when it refuses.
 */

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import {
  checkLanguageCode,
  createLanguage,
  deleteLanguage,
  exportPack,
  listCurrencies,
  listLanguages,
  setDefaultLanguage,
  updateLanguage,
  type LanguageInput,
  type WebsiteCurrency,
  type WebsiteLanguage,
} from "@/lib/api/website";
import { downloadText } from "@/lib/website/download";
import { percent, refusalText } from "@/lib/website/wording";
import { useWebsiteHost } from "./WebsiteAccessGate";
import { describeFailure, useWebsiteList, useWriteAction } from "./useWebsiteData";
import LanguagePackDialog from "./LanguagePackDialog";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel, PageHeader, TextField, WriteFeedback, formatWhen } from "./WebsiteUi";

// A dialog keeps the row it was opened on: if the row disappears from the server (deleted elsewhere, or by this very
// request whose answer was lost) the dialog stays to say so instead of vanishing.
type Dialog =
  | { kind: "pack"; tab: "library" | "upload"; preselect: string | null }
  | { kind: "create" }
  | { kind: "edit"; language: WebsiteLanguage }
  | { kind: "default"; language: WebsiteLanguage }
  | { kind: "delete"; language: WebsiteLanguage };

const sameCode = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const SECONDARY_LINK =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5";

export default function LanguagesPanel() {
  const host = useWebsiteHost();
  const { state, reload } = useWebsiteList(listLanguages, []);
  const currencies = useWebsiteList(listCurrencies, []);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const toggle = useWriteAction();

  const languages = state.status === "ready" ? state.data : null;
  const activeCurrencies = currencies.state.status === "ready" ? currencies.state.data.filter((currency) => currency.isActive) : [];
  const open = useCallback((next: Dialog) => {
    setNotice(null);
    setProblem(null);
    setDialog(next);
  }, []);
  const done = useCallback(
    (message: string) => {
      setDialog(null);
      setNotice(message);
      void reload();
    },
    [reload]
  );

  const nextOrder = useMemo(() => (languages ? Math.max(0, ...languages.map((language) => language.sortOrder)) + 10 : 10), [languages]);
  const busy = host.signingOut || toggle.status.phase === "pending" || exporting !== null;

  const exportOne = async (language: WebsiteLanguage) => {
    setExporting(language.code);
    setNotice(null);
    setProblem(null);
    try {
      const result = await exportPack(language.code);
      if (result.kind === "ok") {
        downloadText(`bha-language-${language.code}.json`, result.data);
        setNotice(`Đã xuất gói ${language.nativeName} (${language.code}). Gói chỉ gồm các câu thật sự đã có, không gồm câu dự phòng.`);
      } else {
        if (result.kind === "unauthenticated") host.onUnauthenticated();
        else if (result.kind === "denied") void host.onDenied();
        setProblem(describeFailure(result));
      }
    } finally {
      setExporting(null);
    }
  };

  /** Switch on or off, changing nothing else about the language. A language is switched on only while every required text exists. */
  const switchLanguage = async (language: WebsiteLanguage, isActive: boolean) => {
    setNotice(null);
    setProblem(null);
    const result = await toggle.run(() =>
      updateLanguage(language.code, language.version, {
        displayName: language.displayName,
        nativeName: language.nativeName,
        sortOrder: language.sortOrder,
        isActive,
        defaultCurrencyCode: language.defaultCurrencyCode,
        direction: language.direction,
        formatLocale: language.formatLocale,
      })
    );
    if (result?.kind === "ok") {
      setNotice(`${language.nativeName} (${language.code}) đã ${isActive ? "được bật" : "được tắt"}.`);
      void reload();
    } else if (result?.kind === "refused") {
      setProblem(refusalText(result));
      void reload();
    } else if (result) {
      setProblem(describeFailure(result));
    }
  };

  const setCurrency = async (language: WebsiteLanguage, defaultCurrencyCode: string | null) => {
    setNotice(null);
    setProblem(null);
    const result = await toggle.run(() =>
      updateLanguage(language.code, language.version, {
        displayName: language.displayName,
        nativeName: language.nativeName,
        sortOrder: language.sortOrder,
        isActive: language.isActive,
        defaultCurrencyCode,
        direction: language.direction,
        formatLocale: language.formatLocale,
      })
    );
    if (result?.kind === "ok") {
      setNotice(`Tiền tệ mặc định của ${language.nativeName} (${language.code}) là ${defaultCurrencyCode ?? "tiền mặc định của website"}.`);
      void reload();
    } else if (result) {
      setProblem(result.kind === "refused" ? refusalText(result) : describeFailure(result));
      void reload();
    }
  };

  return (
    <div data-testid="languages-panel">
      <PageHeader title="Ngôn ngữ & bản dịch">
        Các ngôn ngữ mà website có thể hiển thị. Mỗi ngôn ngữ chỉ được bật cho khách khi đã có đủ mọi câu bắt buộc; câu thiếu được lấy
        tạm từ ngôn ngữ mặc định nhưng không được tính là đã dịch. Thêm ngôn ngữ mới bằng một gói, không cần sửa mã hay khởi động lại.
      </PageHeader>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" testId="website-success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}
      {problem && (
        <div className="mb-3">
          <Banner tone="error" testId="website-problem" onDismiss={() => setProblem(null)}>
            {problem}
          </Banner>
        </div>
      )}
      {toggle.status.phase === "unverified" && (
        <div className="mb-3">
          <WriteFeedback status={toggle.status} working={false} serverNote={null} onCheckServer={() => void reload().then(toggle.reset)} />
        </div>
      )}

      {state.status === "loading" && <LoadingPanel what="ngôn ngữ" />}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => void reload()} />}
      {languages && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">{languages.length} ngôn ngữ</p>
            <div className="flex flex-wrap gap-2">
              <ActionButton testId="add-language" onClick={() => open({ kind: "pack", tab: "library", preselect: null })} disabled={busy}>
                Thêm ngôn ngữ
              </ActionButton>
              <ActionButton variant="outline" testId="import-pack" onClick={() => open({ kind: "pack", tab: "upload", preselect: null })} disabled={busy}>
                Nhập gói
              </ActionButton>
              <ActionButton variant="outline" testId="create-manual" onClick={() => open({ kind: "create" })} disabled={busy}>
                Tạo ngôn ngữ trống
              </ActionButton>
            </div>
          </div>

          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="language-cards">
            {languages.map((language) => (
              <LanguageCard
                key={language.code}
                language={language}
                currencies={activeCurrencies}
                busy={busy}
                exporting={exporting === language.code}
                onEdit={() => open({ kind: "edit", language })}
                onDefault={() => open({ kind: "default", language })}
                onDelete={() => open({ kind: "delete", language })}
                onExport={() => void exportOne(language)}
                onUpdatePack={() => open({ kind: "pack", tab: "library", preselect: language.packId })}
                onSwitch={(isActive) => void switchLanguage(language, isActive)}
                onCurrency={(code) => void setCurrency(language, code)}
              />
            ))}
          </ul>
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            &ldquo;Đã dịch&rdquo; chỉ đếm câu thật sự có trong ngôn ngữ đó. Tiền tệ mặc định là tiền khách nhận được khi chọn ngôn ngữ; khách vẫn có thể đổi
            tiền riêng và lựa chọn được nhớ cho riêng họ.
          </p>
        </>
      )}

      {dialog?.kind === "pack" && (
        <LanguagePackDialog
          initialTab={dialog.tab}
          preselect={dialog.preselect}
          languages={languages ?? []}
          reload={reload}
          onClose={() => {
            setDialog(null);
            void reload();
          }}
          onDone={done}
        />
      )}
      {dialog?.kind === "create" && (
        <LanguageFormDialog mode="create" language={null} nextOrder={nextOrder} currencies={activeCurrencies} reload={reload} onClose={() => setDialog(null)} onSaved={(language) => done(`Đã tạo ngôn ngữ ${language.code}. Hãy nhập gói hoặc dịch từng câu rồi mới bật.`)} />
      )}
      {dialog?.kind === "edit" && (
        <LanguageFormDialog mode="edit" language={dialog.language} nextOrder={nextOrder} currencies={activeCurrencies} reload={reload} onClose={() => setDialog(null)} onSaved={(language) => done(`Đã lưu ${language.code}.`)} />
      )}
      {dialog?.kind === "default" && (
        <LanguageConfirmDialog
          mode="default"
          language={dialog.language}
          current={languages?.find((language) => language.isDefault) ?? null}
          reload={reload}
          onClose={() => setDialog(null)}
          onDone={(language) => done(`${language.code} hiện là ngôn ngữ mặc định.`)}
        />
      )}
      {dialog?.kind === "delete" && (
        <LanguageConfirmDialog mode="delete" language={dialog.language} current={null} reload={reload} onClose={() => setDialog(null)} onDone={(language) => done(`Đã xoá ${language.code}.`)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ card

function LanguageCard({
  language,
  currencies,
  busy,
  exporting,
  onEdit,
  onDefault,
  onDelete,
  onExport,
  onUpdatePack,
  onSwitch,
  onCurrency,
}: {
  language: WebsiteLanguage;
  currencies: WebsiteCurrency[];
  busy: boolean;
  exporting: boolean;
  onEdit: () => void;
  onDefault: () => void;
  onDelete: () => void;
  onExport: () => void;
  onUpdatePack: () => void;
  onSwitch: (isActive: boolean) => void;
  onCurrency: (code: string | null) => void;
}) {
  const done = percent(language.translatedKeys, language.requiredKeys);
  const canSwitchOn = language.isComplete;
  return (
    <li data-testid={`language-card-${language.code}`} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">{language.nativeName}</h2>
          <p className="truncate text-sm text-gray-500 dark:text-gray-400">
            {language.displayName} · <span className="font-mono">{language.code}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {language.isDefault && <Badge color="success">Mặc định</Badge>}
          <Badge color={language.isActive ? "info" : "light"}>{language.isActive ? "Đang bật" : "Đã tắt"}</Badge>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-200">
            Đã dịch {language.translatedKeys}/{language.requiredKeys} <span className="text-gray-500">({done}%)</span>
          </span>
          {language.isComplete ? <span className="text-xs text-success-600 dark:text-success-400">Đủ để bật</span> : <span className="text-xs text-warning-600 dark:text-warning-400">Chưa đủ</span>}
        </div>
        <div
          role="progressbar"
          aria-label={`Mức hoàn thiện của ${language.nativeName}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={done}
          className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
        >
          <div className={`h-full ${language.isComplete ? "bg-success-500" : "bg-brand-500"}`} style={{ width: `${done}%` }} />
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400" data-testid={`coverage-${language.code}`}>
          Thiếu {language.missingKeys} · Cần cập nhật {language.outdatedKeys} · Chỉnh tay {language.manualKeys}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <dt>Gói đã cài</dt>
        <dd className="text-right text-gray-700 dark:text-gray-200">{language.packId ? `${language.packId} ${language.packVersion ?? ""}` : "Chưa có"}</dd>
        <dt>Phiên bản</dt>
        <dd className="text-right text-gray-700 dark:text-gray-200">{language.version}</dd>
        <dt>Cập nhật</dt>
        <dd className="text-right text-gray-700 dark:text-gray-200">{formatWhen(language.updatedAtUtc)}</dd>
      </dl>

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
        Tiền tệ mặc định của ngôn ngữ này
        <select
          data-testid={`currency-${language.code}`}
          value={language.defaultCurrencyCode ?? ""}
          disabled={busy}
          onChange={(event) => onCurrency(event.target.value === "" ? null : event.target.value)}
          className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        >
          <option value="">Tiền mặc định của website</option>
          {currencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code} — {currency.name}
            </option>
          ))}
          {language.defaultCurrencyCode && !currencies.some((currency) => currency.code === language.defaultCurrencyCode) && (
            <option value={language.defaultCurrencyCode}>{language.defaultCurrencyCode} (đang tắt)</option>
          )}
        </select>
      </label>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link href={`/website/translations?locale=${encodeURIComponent(language.code)}`} className={SECONDARY_LINK} data-testid={`translate-${language.code}`}>
          Dịch
        </Link>
        <ActionButton variant="outline" testId={`edit-${language.code}`} onClick={onEdit} disabled={busy}>
          Chỉnh sửa
        </ActionButton>
        {!language.isDefault && (
          <ActionButton variant="outline" testId={`switch-${language.code}`} onClick={() => onSwitch(!language.isActive)} disabled={busy || (!language.isActive && !canSwitchOn)}>
            {language.isActive ? "Tắt" : canSwitchOn ? "Bật" : "Chưa đủ để bật"}
          </ActionButton>
        )}
        {!language.isDefault && (
          <ActionButton variant="outline" testId={`default-${language.code}`} onClick={onDefault} disabled={busy || !language.isActive}>
            Đặt mặc định
          </ActionButton>
        )}
        <ActionButton variant="outline" testId={`export-${language.code}`} onClick={onExport} disabled={busy}>
          {exporting ? "Đang xuất…" : "Xuất gói"}
        </ActionButton>
        {language.packId && (
          <ActionButton variant="outline" testId={`update-pack-${language.code}`} onClick={onUpdatePack} disabled={busy}>
            Cập nhật từ thư viện
          </ActionButton>
        )}
        {!language.isDefault && !language.isActive && (
          <ActionButton variant="outline" testId={`delete-${language.code}`} onClick={onDelete} disabled={busy}>
            Xoá
          </ActionButton>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ add manually / edit

function LanguageFormDialog({
  mode,
  language,
  nextOrder,
  currencies,
  reload,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  language: WebsiteLanguage | null;
  nextOrder: number;
  currencies: WebsiteCurrency[];
  reload: () => Promise<WebsiteLanguage[] | null>;
  onClose: () => void;
  onSaved: (language: WebsiteLanguage) => void;
}) {
  const host = useWebsiteHost();
  const { status, run, reset } = useWriteAction();
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(language?.displayName ?? "");
  const [nativeName, setNativeName] = useState(language?.nativeName ?? "");
  const [sortOrder, setSortOrder] = useState(String(language?.sortOrder ?? nextOrder));
  const [isActive, setIsActive] = useState(language?.isActive ?? false);
  const [currency, setCurrency] = useState(language?.defaultCurrencyCode ?? "");
  const [direction, setDirection] = useState<"ltr" | "rtl">(language?.direction ?? "ltr");
  const [formatLocale, setFormatLocale] = useState(language?.formatLocale ?? "");
  // The version this editor loaded: what a save is checked against. Re-bound only when the operator reloads the latest.
  const [base, setBase] = useState<WebsiteLanguage | null>(language);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [touched, setTouched] = useState(false);

  const order = Number(sortOrder);
  const errors = {
    code: mode === "create" ? checkLanguageCode(code) : null,
    displayName: displayName.trim() === "" ? "Nhập tên ngôn ngữ." : displayName.trim().length > 100 ? "Tối đa 100 ký tự." : null,
    nativeName: nativeName.trim() === "" ? "Nhập tên ngôn ngữ viết bằng chính ngôn ngữ đó." : nativeName.trim().length > 100 ? "Tối đa 100 ký tự." : null,
    sortOrder: /^\d{1,5}$/.test(sortOrder.trim()) && order <= 10000 ? null : "Một số nguyên từ 0 đến 10000.",
    formatLocale: formatLocale.trim() === "" || checkLanguageCode(formatLocale) === null ? null : "Dùng mã như fr-FR hoặc en-US.",
  };
  const refusedField = status.phase === "refused" && status.failure.code === "validation" ? status.failure : null;
  const shown = (field: keyof typeof errors) => (touched ? errors[field] : null) ?? (refusedField?.field === field ? refusedField.detail : null);
  const valid = Object.values(errors).every((message) => message === null);
  const working = status.phase === "pending" || checking;
  const locked = working || status.phase === "unverified" || blocked || host.signingOut;
  const mayBeOn = mode === "edit" ? (language!.isComplete || language!.isActive) : false;

  const compareWithServer = useCallback(async () => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("Không đọc được máy chủ. Hãy thử lại trước khi thay đổi gì.");
        return;
      }
      const target = mode === "edit" ? language!.code : code.trim();
      const latest = fresh.find((item) => sameCode(item.code, target)) ?? null;
      reset();
      if (mode === "create") {
        if (latest) {
          setBlocked(true);
          setServerNote(`Máy chủ đã có ${latest.code} (phiên bản ${latest.version}, "${latest.displayName}"). Việc tạo đã được lưu: hãy đóng hộp thoại và chỉnh sửa ở đó nếu cần.`);
        } else {
          setBlocked(false);
          setServerNote("Đã kiểm tra: máy chủ chưa có ngôn ngữ này nên chưa được lưu. Bạn có thể lưu lại.");
        }
        return;
      }
      if (!latest) {
        setBlocked(true);
        setServerNote(`${target} không còn trên máy chủ. Hãy đóng hộp thoại.`);
        return;
      }
      setBase(latest);
      setBlocked(false);
      setServerNote(`Bản mới nhất trên máy chủ — phiên bản ${latest.version}: "${latest.displayName}" / "${latest.nativeName}", thứ tự ${latest.sortOrder}, ${latest.isActive ? "đang bật" : "đã tắt"}${latest.isDefault ? ", mặc định" : ""}, cập nhật ${formatWhen(latest.updatedAtUtc)}. Bản nháp của bạn không đổi; Lưu sẽ áp dụng nó lên phiên bản này.`);
    } finally {
      setChecking(false);
    }
  }, [reload, mode, language, code, reset]);

  const submit = async () => {
    setTouched(true);
    if (!valid || locked) return;
    const input: LanguageInput = {
      displayName: displayName.trim(),
      nativeName: nativeName.trim(),
      sortOrder: order,
      isActive,
      defaultCurrencyCode: currency === "" ? null : currency,
      direction,
      formatLocale: formatLocale.trim() === "" ? (mode === "create" ? code.trim() : base!.formatLocale) : formatLocale.trim(),
    };
    const result = await run(() => (mode === "create" ? createLanguage(code, input) : updateLanguage(base!.code, base!.version, input)));
    if (result?.kind === "ok") onSaved(result.data);
  };

  return (
    <DialogShell title={mode === "create" ? "Tạo ngôn ngữ trống" : `Chỉnh sửa ${language!.code}`} onClose={onClose} busy={working} testId="language-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {mode === "create" ? (
          <TextField label="Mã ngôn ngữ" value={code} onChange={setCode} error={shown("code") ?? (refusedField?.field === "code" ? refusedField.detail : null)} hint="Mã BCP 47, ví dụ fr, en-US hoặc zh-Hans. Không đổi được sau này: mã khác là một ngôn ngữ khác." disabled={locked} maxLength={20} testId="field-code" autoFocus />
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Mã <span className="font-mono font-medium">{language!.code}</span> (cố định — mã khác là ngôn ngữ khác)
          </p>
        )}
        <TextField label="Tên ngôn ngữ" value={displayName} onChange={setDisplayName} error={shown("displayName")} disabled={locked} maxLength={100} testId="field-displayName" />
        <TextField label="Tên bản địa" value={nativeName} onChange={setNativeName} error={shown("nativeName")} hint="Cách ngôn ngữ tự viết tên của mình, ví dụ Français." disabled={locked} maxLength={100} testId="field-nativeName" />
        <TextField label="Thứ tự hiển thị" value={sortOrder} onChange={setSortOrder} error={shown("sortOrder")} inputMode="numeric" disabled={locked} maxLength={5} testId="field-sortOrder" />
        <TextField label="Định dạng ngày và số" value={formatLocale} onChange={setFormatLocale} error={shown("formatLocale")} hint="Mã BCP 47 dùng để định dạng ngày, số và tiền, ví dụ fr-FR. Để trống thì dùng mã ngôn ngữ." disabled={locked} maxLength={35} testId="field-formatLocale" />
        <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
          Hướng chữ
          <select value={direction} disabled={locked} onChange={(event) => setDirection(event.target.value as "ltr" | "rtl")} data-testid="field-direction" className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900">
            <option value="ltr">Trái sang phải</option>
            <option value="rtl">Phải sang trái</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
          Tiền tệ mặc định
          <select value={currency} disabled={locked} onChange={(event) => setCurrency(event.target.value)} data-testid="field-currency" className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900">
            <option value="">Tiền mặc định của website</option>
            {currencies.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} — {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={isActive} disabled={locked || (mode === "edit" && language!.isDefault) || (!mayBeOn && !isActive)} onChange={(event) => setIsActive(event.target.checked)} data-testid="field-active" />
          {mode === "edit" && language!.isDefault ? "Đang bật (ngôn ngữ mặc định luôn bật)" : mayBeOn || isActive ? "Đang bật — khách có thể chọn" : "Chưa bật được: cần nhập gói hoặc dịch đủ mọi câu bắt buộc trước"}
        </label>
        <WriteFeedback
          status={status}
          working={working}
          serverNote={serverNote}
          onReloadLatest={mode === "edit" ? () => void compareWithServer() : undefined}
          onCheckServer={() => void compareWithServer()}
          fieldErrorOf={(field) => ["code", "displayName", "nativeName", "sortOrder", "formatLocale"].includes(field ?? "")}
        />
        <DialogActions>
          <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
            Huỷ
          </ActionButton>
          <ActionButton type="submit" disabled={locked} testId="dialog-save">
            {status.phase === "pending" ? "Đang lưu…" : mode === "create" ? "Tạo ngôn ngữ" : "Lưu"}
          </ActionButton>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

// ------------------------------------------------------------------------------------------------ default / delete

function LanguageConfirmDialog({
  mode,
  language,
  current,
  reload,
  onClose,
  onDone,
}: {
  mode: "default" | "delete";
  language: WebsiteLanguage;
  current: WebsiteLanguage | null;
  reload: () => Promise<WebsiteLanguage[] | null>;
  onClose: () => void;
  onDone: (language: WebsiteLanguage) => void;
}) {
  const host = useWebsiteHost();
  const { status, run, reset } = useWriteAction();
  const [base, setBase] = useState(language);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [gone, setGone] = useState(false);
  const working = status.phase === "pending" || checking;
  const locked = working || status.phase === "unverified" || gone || host.signingOut;

  const compareWithServer = async () => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("Không đọc được máy chủ. Hãy thử lại trước khi thay đổi gì.");
        return;
      }
      const latest = fresh.find((item) => sameCode(item.code, language.code)) ?? null;
      reset();
      if (mode === "delete" && latest === null) {
        setGone(true);
        setServerNote(`${language.code} không còn trên máy chủ: đã được xoá.`);
        return;
      }
      if (mode === "default" && latest?.isDefault) {
        setGone(true);
        setServerNote(`${language.code} đã là ngôn ngữ mặc định trên máy chủ.`);
        return;
      }
      if (latest === null) {
        setGone(true);
        setServerNote(`${language.code} không còn tồn tại trên máy chủ. Hãy đóng hộp thoại.`);
        return;
      }
      setBase(latest);
      setServerNote(`Bản mới nhất trên máy chủ — phiên bản ${latest.version}, ${latest.isActive ? "đang bật" : "đã tắt"}, đã dịch ${latest.translatedKeys}/${latest.requiredKeys}. Hãy xác nhận lại để áp dụng cho phiên bản này.`);
    } finally {
      setChecking(false);
    }
  };

  const confirm = async () => {
    if (locked) return;
    const result = await run<unknown>(() => (mode === "default" ? setDefaultLanguage(base.code, base.version) : deleteLanguage(base.code, base.version)));
    if (result?.kind === "ok") onDone(base);
  };

  return (
    <DialogShell title={mode === "default" ? `Đặt ${language.code} làm ngôn ngữ mặc định?` : `Xoá ${language.code}?`} onClose={onClose} busy={working} testId={`language-${mode}-dialog`}>
      {mode === "default" ? (
        <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
          <p>
            <span className="font-medium">{language.nativeName}</span> sẽ là ngôn ngữ khách nhận khi ngôn ngữ của họ không có, và là ngôn ngữ mà mọi ngôn ngữ khác lấy tạm khi thiếu một câu.
            {current && (
              <>
                {" "}
                <span className="font-mono">{current.code}</span> không còn là mặc định.
              </>
            )}
          </p>
          <p>
            Ngôn ngữ mặc định phải đang bật và có đủ mọi câu bắt buộc; hiện đã dịch {language.translatedKeys}/{language.requiredKeys}. Máy chủ sẽ từ chối nếu chưa đủ.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
          <p>
            Thao tác này xoá <span className="font-medium">{language.nativeName}</span> ({language.code}) cùng toàn bộ bản dịch của nó và không hoàn tác được.
          </p>
          <p>Ngôn ngữ đang bật hoặc là mặc định không xoá được: hãy tắt nó trước. Máy chủ kiểm tra điều này và nói rõ lý do khi từ chối.</p>
        </div>
      )}
      <WriteFeedback status={status} working={working} serverNote={serverNote} onReloadLatest={() => void compareWithServer()} onCheckServer={() => void compareWithServer()} />
      <DialogActions>
        <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
          {gone ? "Đóng" : "Huỷ"}
        </ActionButton>
        {!gone && (
          <ActionButton onClick={() => void confirm()} disabled={locked} testId="dialog-confirm">
            {status.phase === "pending" ? "Đang xử lý…" : mode === "default" ? "Đặt mặc định" : "Xoá ngôn ngữ"}
          </ActionButton>
        )}
        {gone && (
          <ActionButton onClick={() => onDone(language)} testId="dialog-done">
            Xong
          </ActionButton>
        )}
      </DialogActions>
    </DialogShell>
  );
}
