"use client";

/**
 * CUST-WEB-HEADER-001-CP02: the UI translations screen. The managed keys are fixed in the backend (the header menu and the
 * common controls Customer Web shows today); an operator edits VALUES only, as plain text that keeps the placeholders a key
 * declares. Pick a language and a group, search a key or its text, see the source (Vietnamese) sentence, edit and save. A
 * language other than the default only stores what it overrides: removing an override returns that key to the default
 * language's text, and the default language always keeps a value for every key. Nothing here is machine-translated.
 */

import React, { useCallback, useEffect, useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import Label from "@/components/form/Label";
import {
  clearTranslation,
  listLanguages,
  listTranslations,
  saveTranslation,
  type WebsiteLanguage,
  type WebsiteTranslationList,
  type WebsiteTranslationRow,
} from "@/lib/api/website";
import { useWebsiteHost } from "./WebsiteAccessGate";
import { useWebsiteList, useWriteAction } from "./useWebsiteData";
import {
  ActionButton,
  Banner,
  DialogActions,
  DialogShell,
  ErrorPanel,
  LoadingPanel,
  PageHeader,
  TABLE_CLASSES,
  TextAreaField,
  WriteFeedback,
  formatWhen,
} from "./WebsiteUi";

const SELECT_CLASSES =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";
const GROUP_LABELS: Record<string, string> = {
  "header-menu": "Header and menu",
  "header-account": "Header account entries",
  common: "Common controls and messages",
};

export default function TranslationsPanel({ initialLocale }: { initialLocale: string | null }) {
  const languages = useWebsiteList(listLanguages, []);
  // The language the operator picked; until then, the one asked for in the link, else the default language.
  const [chosen, setChosen] = useState<string | null>(null);
  const list = languages.state.status === "ready" ? languages.state.data : null;
  const requested = list && initialLocale ? list.find((language) => language.code.toLowerCase() === initialLocale.toLowerCase()) : undefined;
  const locale = chosen ?? (list ? (requested ?? list.find((language) => language.isDefault) ?? list[0])?.code ?? null : null);

  return (
    <div data-testid="translations-panel">
      <PageHeader title="UI translations">
        The texts of the header menu and the common controls, per language. They are plain text: no markup, and a text keeps
        exactly the placeholders (such as {"{what}"}) its key declares. A language with no value for a key shows the default
        language&apos;s text. This covers only the managed texts listed here, not the whole website.
      </PageHeader>
      {languages.state.status === "loading" && <LoadingPanel what="languages" />}
      {languages.state.status === "error" && <ErrorPanel message={languages.state.message} onRetry={() => void languages.reload()} />}
      {languages.state.status === "ready" && locale !== null && (
        <TranslationsTable key={locale} locale={locale} languages={languages.state.data} onLocale={setChosen} />
      )}
      {languages.state.status === "ready" && languages.state.data.length === 0 && (
        <Banner tone="warning">There are no languages yet. Add one on the Languages screen.</Banner>
      )}
    </div>
  );
}

function TranslationsTable({ locale, languages, onLocale }: { locale: string; languages: WebsiteLanguage[]; onLocale: (code: string) => void }) {
  const host = useWebsiteHost();
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The search is sent a moment after typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { state, reload } = useWebsiteList((signal) => listTranslations(locale, { group, search: applied }, signal), [locale, group, applied]);
  const data = state.status === "ready" ? state.data : null;
  const selected = data?.rows.find((row) => row.key === editing) ?? null;
  const done = useCallback(
    (message: string) => {
      setEditing(null);
      setNotice(message);
      void reload();
    },
    [reload]
  );

  const language = languages.find((item) => item.code === locale);

  return (
    <>
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="tr-locale">Language</Label>
          <select id="tr-locale" data-testid="locale-select" value={locale} onChange={(event) => onLocale(event.target.value)} className={SELECT_CLASSES}>
            {languages.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} — {item.displayName}
                {item.isDefault ? " (default)" : ""}
                {item.isActive ? "" : " (off)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="tr-group">Group</Label>
          <select id="tr-group" data-testid="group-select" value={group} onChange={(event) => setGroup(event.target.value)} className={SELECT_CLASSES}>
            <option value="">All groups</option>
            {(data?.groups ?? []).map((item) => (
              <option key={item} value={item}>
                {GROUP_LABELS[item] ?? item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="tr-search">Search a key or text</Label>
          <input
            id="tr-search"
            data-testid="search-input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="e.g. menu, Ưu đãi, close"
            autoComplete="off"
            className={SELECT_CLASSES}
          />
        </div>
      </div>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" testId="website-success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      {state.status === "loading" && <LoadingPanel what="translations" />}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => void reload()} />}
      {data && (
        <>
          <p data-testid="coverage" className="mb-3 text-sm text-gray-600 dark:text-gray-300">
            <span className="font-medium">{data.locale}</span>
            {language && !language.isActive ? " (off)" : ""} has {data.translatedKeys} of {data.totalKeys} managed texts
            {data.isDefaultLocale ? " (the default language keeps all of them)" : `; the other ${data.totalKeys - data.translatedKeys} use the ${data.defaultLocale} text`}. This counts only the
            managed texts, not the whole website.
          </p>
          <div className={TABLE_CLASSES.wrap}>
            <table className={TABLE_CLASSES.table}>
              <thead className={TABLE_CLASSES.head}>
                <tr>
                  <th className={TABLE_CLASSES.headCell}>Key</th>
                  <th className={TABLE_CLASSES.headCell}>Source text</th>
                  <th className={TABLE_CLASSES.headCell}>Text in {data.locale}</th>
                  <th className={TABLE_CLASSES.headCell}>Updated</th>
                  <th className={TABLE_CLASSES.headCell}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className={`${TABLE_CLASSES.cell} text-center text-gray-500`} data-testid="no-rows">
                      Nothing matches.
                    </td>
                  </tr>
                )}
                {data.rows.map((row) => (
                  <tr key={row.key} data-testid={`row-${row.key}`} className={TABLE_CLASSES.row}>
                    <td className={TABLE_CLASSES.cell}>
                      <div className="font-mono text-xs">{row.key}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge size="sm" color="light">
                          {GROUP_LABELS[row.group] ?? row.group}
                        </Badge>
                        {row.placeholders.map((name) => (
                          <Badge key={name} size="sm" color="info">
                            {`{${name}}`}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className={TABLE_CLASSES.cell}>{row.sourceText}</td>
                    <td className={TABLE_CLASSES.cell}>
                      <span data-testid={`value-${row.key}`}>{row.effectiveValue}</span>
                      {row.isFallback && (
                        <div className="mt-1">
                          <Badge size="sm" color="warning">
                            Uses the {data.defaultLocale} text
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td className={TABLE_CLASSES.cell}>{formatWhen(row.updatedAtUtc)}</td>
                    <td className={`${TABLE_CLASSES.cell} whitespace-nowrap`}>
                      <ActionButton variant="outline" testId={`edit-${row.key}`} onClick={() => {
                          setNotice(null);
                          setEditing(row.key);
                        }} disabled={host.signingOut}>
                        {row.hasOverride ? "Edit" : "Translate"}
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && selected && (
        <TranslationDialog
          key={selected.key}
          locale={data.locale}
          isDefaultLocale={data.isDefaultLocale}
          defaultLocale={data.defaultLocale}
          row={selected}
          reload={reload}
          onClose={() => setEditing(null)}
          onDone={done}
        />
      )}
    </>
  );
}

function TranslationDialog({
  locale,
  isDefaultLocale,
  defaultLocale,
  row,
  reload,
  onClose,
  onDone,
}: {
  locale: string;
  isDefaultLocale: boolean;
  defaultLocale: string;
  row: WebsiteTranslationRow;
  reload: () => Promise<WebsiteTranslationList | null>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const host = useWebsiteHost();
  const { status, run, reset } = useWriteAction();
  const [value, setValue] = useState(row.value ?? row.effectiveValue);
  // The version this editor loaded: `null` is "no override yet". Re-bound only when the operator reloads the latest.
  const [base, setBase] = useState<WebsiteTranslationRow>(row);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [touched, setTouched] = useState(false);

  const localError = ((): string | null => {
    if (value.trim() === "") return "Enter the text.";
    if (value.length > 1000) return "At most 1000 characters.";
    if (/[<>]/.test(value)) return "Plain text only: '<' and '>' are not allowed.";
    if (/[\u0000-\u001F\u007F]/.test(value)) return "No line breaks or control characters.";
    const found = [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]);
    const leftover = value.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, "");
    if (/[{}]/.test(leftover)) return "A '{' or '}' must be part of a placeholder like {name}.";
    const missing = row.placeholders.filter((name) => !found.includes(name));
    if (missing.length > 0) return `Keep the placeholder ${missing.map((name) => `{${name}}`).join(", ")}.`;
    const extra = [...new Set(found)].filter((name) => !row.placeholders.includes(name));
    return extra.length > 0 ? `${extra.map((name) => `{${name}}`).join(", ")} is not declared for this key.` : null;
  })();
  const refusedField = status.phase === "refused" && status.failure.field === "value" ? status.failure.detail : null;
  const working = status.phase === "pending" || checking;
  const locked = working || status.phase === "unverified" || host.signingOut;
  const canRemove = !isDefaultLocale && base.hasOverride;

  const compareWithServer = async () => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("The server could not be read. Try again before changing anything.");
        return;
      }
      const latest = fresh.rows.find((item) => item.key === row.key) ?? null;
      reset();
      if (!latest) {
        setServerNote("This row is not in the current list (it may be filtered out). Close this dialog and reopen it.");
        return;
      }
      setBase(latest);
      setConfirmingRemove(false);
      setServerNote(
        latest.hasOverride
          ? `Latest on the server — version ${latest.version}: "${latest.value}", updated ${formatWhen(latest.updatedAtUtc)}. Your draft is unchanged; Save applies it on top of this version.`
          : `Latest on the server — no ${locale} text is saved for this key${isDefaultLocale ? "" : `; it uses the ${defaultLocale} text`}. Your draft is unchanged; Save creates it.`
      );
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setTouched(true);
    if (localError !== null || locked) return;
    const result = await run(() => saveTranslation(locale, row.key, value.trim(), base.version));
    if (result?.kind === "ok") onDone(`Saved ${row.key} (${locale}).`);
  };

  const remove = async () => {
    if (locked || base.version === null) return;
    const result = await run(() => clearTranslation(locale, row.key, base.version!));
    if (result?.kind === "ok") onDone(`Removed the ${locale} text of ${row.key}; it uses the ${defaultLocale} text again.`);
  };

  return (
    <DialogShell title={`${row.key} — ${locale}`} onClose={onClose} busy={working} testId="translation-dialog">
      <div className="text-sm text-gray-700 dark:text-gray-200">
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Source text (Vietnamese)</p>
        <p className="mt-1" data-testid="source-text">{row.sourceText}</p>
        {!isDefaultLocale && base.isFallback && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Currently shown from {defaultLocale}: {row.effectiveValue}</p>}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <TextAreaField
          label={`Text in ${locale}`}
          value={value}
          onChange={setValue}
          error={(touched ? localError : null) ?? refusedField}
          hint={row.placeholders.length > 0 ? `Plain text. Keep ${row.placeholders.map((name) => `{${name}}`).join(", ")} exactly as written.` : "Plain text, no markup."}
          disabled={locked}
          maxLength={1000}
          testId="field-value"
        />
        <WriteFeedback status={status} working={working} serverNote={serverNote} onReloadLatest={() => void compareWithServer()} onCheckServer={() => void compareWithServer()} fieldErrorOf={(field) => field === "value"} />
        {canRemove && confirmingRemove && (
          <Banner tone="warning" testId="remove-confirm">
            <p>Remove the {locale} text for this key? It will use the {defaultLocale} text again. The default language is never changed.</p>
            <div className="mt-2 flex gap-3">
              <ActionButton onClick={() => void remove()} disabled={locked} testId="remove-confirm-yes">
                Remove text
              </ActionButton>
              <ActionButton variant="outline" onClick={() => setConfirmingRemove(false)} disabled={working} testId="remove-confirm-no">
                Keep it
              </ActionButton>
            </div>
          </Banner>
        )}
        <DialogActions>
          {canRemove && !confirmingRemove && (
            <ActionButton variant="outline" onClick={() => setConfirmingRemove(true)} disabled={locked} testId="remove-text">
              Remove text
            </ActionButton>
          )}
          <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
            Cancel
          </ActionButton>
          <ActionButton type="submit" disabled={locked} testId="dialog-save">
            {status.phase === "pending" ? "Saving…" : "Save"}
          </ActionButton>
        </DialogActions>
      </form>
    </DialogShell>
  );
}
