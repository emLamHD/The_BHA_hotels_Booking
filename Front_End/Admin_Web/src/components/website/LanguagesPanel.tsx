"use client";

/**
 * CUST-WEB-HEADER-001-CP02: the Languages screen — list, add, edit, turn on/off, choose the default, delete. Every
 * figure and every change comes from the Admin API; nothing is kept locally. The server owns the rules (exactly one
 * active default that has every managed key, no delete of a language that is on, the default or has translations);
 * this screen asks before the risky ones (default change, delete) and shows the server's reason when it refuses.
 */

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Checkbox from "@/components/form/input/Checkbox";
import {
  checkLanguageCode,
  createLanguage,
  deleteLanguage,
  listLanguages,
  setDefaultLanguage,
  updateLanguage,
  type WebsiteLanguage,
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
  TextField,
  WriteFeedback,
  formatWhen,
} from "./WebsiteUi";

// A dialog keeps the row it was opened on: if the row disappears from the server (deleted elsewhere, or by this very
// request whose answer was lost) the dialog stays to say so instead of vanishing.
type Dialog =
  | { kind: "create" }
  | { kind: "edit"; language: WebsiteLanguage }
  | { kind: "default"; language: WebsiteLanguage }
  | { kind: "delete"; language: WebsiteLanguage };

const sameCode = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export default function LanguagesPanel() {
  const host = useWebsiteHost();
  const { state, reload } = useWebsiteList(listLanguages, []);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const languages = state.status === "ready" ? state.data : null;
  const open = useCallback((next: Dialog) => {
    setNotice(null);
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

  const total = languages?.[0]?.totalKeys ?? 0;
  const nextOrder = useMemo(() => (languages ? Math.max(0, ...languages.map((language) => language.sortOrder)) + 10 : 10), [languages]);
  const busy = host.signingOut;

  return (
    <div data-testid="languages-panel">
      <PageHeader title="Languages">
        The languages the website can be shown in. Adding a language does not translate anything: until its texts are
        saved on the Translations screen it shows the default language&apos;s texts. Exactly one active language is the
        default, and it keeps a value for every managed key.
      </PageHeader>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" testId="website-success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      {state.status === "loading" && <LoadingPanel what="languages" />}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => void reload()} />}
      {languages && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {languages.length} language{languages.length === 1 ? "" : "s"}
            </p>
            <ActionButton testId="add-language" onClick={() => open({ kind: "create" })} disabled={busy}>
              Add language
            </ActionButton>
          </div>
          <div className={TABLE_CLASSES.wrap}>
            <table className={TABLE_CLASSES.table}>
              <thead className={TABLE_CLASSES.head}>
                <tr>
                  <th className={TABLE_CLASSES.headCell}>Code</th>
                  <th className={TABLE_CLASSES.headCell}>Name</th>
                  <th className={TABLE_CLASSES.headCell}>Order</th>
                  <th className={TABLE_CLASSES.headCell}>Status</th>
                  <th className={TABLE_CLASSES.headCell}>Translated keys</th>
                  <th className={TABLE_CLASSES.headCell}>Updated</th>
                  <th className={TABLE_CLASSES.headCell}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {languages.map((language) => (
                  <tr key={language.code} data-testid={`language-row-${language.code}`} className={TABLE_CLASSES.row}>
                    <td className={`${TABLE_CLASSES.cell} font-mono`}>{language.code}</td>
                    <td className={TABLE_CLASSES.cell}>
                      <div className="font-medium">{language.displayName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{language.nativeName}</div>
                    </td>
                    <td className={TABLE_CLASSES.cell}>{language.sortOrder}</td>
                    <td className={TABLE_CLASSES.cell}>
                      <div className="flex flex-wrap gap-1.5">
                        {language.isDefault && <Badge color="success">Default</Badge>}
                        <Badge color={language.isActive ? "info" : "light"}>{language.isActive ? "On" : "Off"}</Badge>
                      </div>
                    </td>
                    <td className={TABLE_CLASSES.cell}>
                      {language.translatedKeys} of {language.totalKeys}
                      {language.translatedKeys < language.totalKeys && (
                        <div className="text-xs text-warning-600 dark:text-warning-400">{language.totalKeys - language.translatedKeys} fall back to the default</div>
                      )}
                    </td>
                    <td className={TABLE_CLASSES.cell}>{formatWhen(language.updatedAtUtc)}</td>
                    <td className={`${TABLE_CLASSES.cell} whitespace-nowrap`}>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          href={`/website/translations?locale=${encodeURIComponent(language.code)}`}
                          className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
                        >
                          Translations
                        </Link>
                        <ActionButton variant="outline" testId={`edit-${language.code}`} onClick={() => open({ kind: "edit", language })} disabled={busy}>
                          Edit
                        </ActionButton>
                        {!language.isDefault && (
                          <ActionButton variant="outline" testId={`default-${language.code}`} onClick={() => open({ kind: "default", language })} disabled={busy}>
                            Make default
                          </ActionButton>
                        )}
                        {!language.isDefault && (
                          <ActionButton variant="outline" testId={`delete-${language.code}`} onClick={() => open({ kind: "delete", language })} disabled={busy}>
                            Delete
                          </ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            &ldquo;Translated keys&rdquo; counts the {total} UI texts managed here (menu, header and common controls), not the
            whole website. A language that is on and has no value for a key shows the default language&apos;s text for it.
          </p>
        </>
      )}

      {dialog?.kind === "create" && (
        <LanguageFormDialog mode="create" language={null} nextOrder={nextOrder} reload={reload} onClose={() => setDialog(null)} onSaved={(language) => done(`Added ${language.code}.`)} />
      )}
      {dialog?.kind === "edit" && (
        <LanguageFormDialog mode="edit" language={dialog.language} nextOrder={nextOrder} reload={reload} onClose={() => setDialog(null)} onSaved={(language) => done(`Saved ${language.code}.`)} />
      )}
      {dialog?.kind === "default" && (
        <LanguageConfirmDialog
          mode="default"
          language={dialog.language}
          current={languages?.find((language) => language.isDefault) ?? null}
          reload={reload}
          onClose={() => setDialog(null)}
          onDone={(language) => done(`${language.code} is now the default language.`)}
        />
      )}
      {dialog?.kind === "delete" && (
        <LanguageConfirmDialog
          mode="delete"
          language={dialog.language}
          current={null}
          reload={reload}
          onClose={() => setDialog(null)}
          onDone={(language) => done(`Deleted ${language.code}.`)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ add / edit

function LanguageFormDialog({
  mode,
  language,
  nextOrder,
  reload,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  language: WebsiteLanguage | null;
  nextOrder: number;
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
  // The version this editor loaded: what a save is checked against. Re-bound only when the operator reloads the latest.
  const [base, setBase] = useState<WebsiteLanguage | null>(language);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [touched, setTouched] = useState(false);

  const order = Number(sortOrder);
  const errors = {
    code: mode === "create" ? checkLanguageCode(code) : null,
    displayName: displayName.trim() === "" ? "Enter a name." : displayName.trim().length > 100 ? "At most 100 characters." : null,
    nativeName: nativeName.trim() === "" ? "Enter the name in the language itself." : nativeName.trim().length > 100 ? "At most 100 characters." : null,
    sortOrder: /^\d{1,5}$/.test(sortOrder.trim()) && order <= 10000 ? null : "A whole number from 0 to 10000.",
  };
  const refusedField = status.phase === "refused" && status.failure.code === "validation" ? status.failure : null;
  const shown = (field: keyof typeof errors) => (touched ? errors[field] : null) ?? (refusedField?.field === field ? refusedField.detail : null);
  const valid = Object.values(errors).every((message) => message === null);
  const working = status.phase === "pending" || checking;
  const locked = working || status.phase === "unverified" || blocked || host.signingOut;

  const compareWithServer = useCallback(async () => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("The server could not be read. Try again before changing anything.");
        return;
      }
      const target = mode === "edit" ? language!.code : code.trim();
      const latest = fresh.find((item) => sameCode(item.code, target)) ?? null;
      reset();
      if (mode === "create") {
        if (latest) {
          setBlocked(true);
          setServerNote(`The server already has ${latest.code} (version ${latest.version}, "${latest.displayName}"). It was saved: close this dialog and edit it there if needed.`);
        } else {
          setBlocked(false);
          setServerNote("Checked: the server does not have this language yet, so it was not saved. You can save it again.");
        }
        return;
      }
      if (!latest) {
        setBlocked(true);
        setServerNote(`${target} no longer exists on the server. Close this dialog.`);
        return;
      }
      setBase(latest);
      setBlocked(false);
      setServerNote(
        `Latest on the server — version ${latest.version}: "${latest.displayName}" / "${latest.nativeName}", order ${latest.sortOrder}, ${latest.isActive ? "on" : "off"}${latest.isDefault ? ", default" : ""}, updated ${formatWhen(latest.updatedAtUtc)}. Your draft is unchanged; Save applies it on top of this version.`
      );
    } finally {
      setChecking(false);
    }
  }, [reload, mode, language, code, reset]);

  const submit = async () => {
    setTouched(true);
    if (!valid || locked) return;
    const input = { displayName: displayName.trim(), nativeName: nativeName.trim(), sortOrder: order, isActive };
    const result = await run(() => (mode === "create" ? createLanguage(code, input) : updateLanguage(base!.code, base!.version, input)));
    if (result?.kind === "ok") onSaved(result.data);
  };

  return (
    <DialogShell title={mode === "create" ? "Add a language" : `Edit ${language!.code}`} onClose={onClose} busy={working} testId="language-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {mode === "create" ? (
          <TextField label="Language code" value={code} onChange={setCode} error={shown("code") ?? (refusedField?.field === "code" ? refusedField.detail : null)} hint="A BCP 47 tag, e.g. fr, en-US or zh-Hans. It cannot be changed later: a different code is a new language." disabled={locked} maxLength={20} testId="field-code" autoFocus />
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Code <span className="font-mono font-medium">{language!.code}</span> (fixed — a different code is a new language)
          </p>
        )}
        <TextField label="Name" value={displayName} onChange={setDisplayName} error={shown("displayName")} disabled={locked} maxLength={100} testId="field-displayName" />
        <TextField label="Native name" value={nativeName} onChange={setNativeName} error={shown("nativeName")} hint="How the language writes its own name, e.g. Français." disabled={locked} maxLength={100} testId="field-nativeName" />
        <TextField label="Order" value={sortOrder} onChange={setSortOrder} error={shown("sortOrder")} inputMode="numeric" disabled={locked} maxLength={5} testId="field-sortOrder" />
        <Checkbox
          label={mode === "edit" && language!.isDefault ? "On (the default language stays on)" : "On — visitors can choose it"}
          checked={isActive}
          onChange={setIsActive}
          disabled={locked || (mode === "edit" && language!.isDefault)}
        />
        <WriteFeedback
          status={status}
          working={working}
          serverNote={serverNote}
          onReloadLatest={mode === "edit" ? () => void compareWithServer() : undefined}
          onCheckServer={() => void compareWithServer()}
          fieldErrorOf={(field) => ["code", "displayName", "nativeName", "sortOrder"].includes(field ?? "")}
        />
        <DialogActions>
          <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
            Cancel
          </ActionButton>
          <ActionButton type="submit" disabled={locked} testId="dialog-save">
            {status.phase === "pending" ? "Saving…" : mode === "create" ? "Add language" : "Save"}
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
        setServerNote("The server could not be read. Try again before changing anything.");
        return;
      }
      const latest = fresh.find((item) => sameCode(item.code, language.code)) ?? null;
      reset();
      if (mode === "delete" && latest === null) {
        setGone(true);
        setServerNote(`${language.code} is no longer on the server: it was deleted.`);
        return;
      }
      if (mode === "default" && latest?.isDefault) {
        setGone(true);
        setServerNote(`${language.code} is already the default language on the server.`);
        return;
      }
      if (latest === null) {
        setGone(true);
        setServerNote(`${language.code} no longer exists on the server. Close this dialog.`);
        return;
      }
      setBase(latest);
      setServerNote(`Latest on the server — version ${latest.version}, ${latest.isActive ? "on" : "off"}, ${latest.translatedKeys} of ${latest.totalKeys} keys translated. Confirm again to apply it to this version.`);
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
    <DialogShell title={mode === "default" ? `Make ${language.code} the default language?` : `Delete ${language.code}?`} onClose={onClose} busy={working} testId={`language-${mode}-dialog`}>
      {mode === "default" ? (
        <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
          <p>
            <span className="font-medium">{language.displayName}</span> becomes the language visitors get when theirs is not available, and
            the language every other language falls back to for a missing text.
            {current && (
              <>
                {" "}
                <span className="font-mono">{current.code}</span> stops being the default.
              </>
            )}
          </p>
          <p>
            It must be on and have a value for every managed key; it has {language.translatedKeys} of {language.totalKeys}. The server refuses the change otherwise.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
          <p>
            This removes <span className="font-medium">{language.displayName}</span> ({language.code}). It cannot be undone.
          </p>
          <p>
            A language that is on, is the default or has saved translations cannot be deleted: turn it off instead. The server enforces this
            and says why when it refuses.
          </p>
        </div>
      )}
      <WriteFeedback status={status} working={working} serverNote={serverNote} onReloadLatest={() => void compareWithServer()} onCheckServer={() => void compareWithServer()} />
      <DialogActions>
        <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
          {gone ? "Close" : "Cancel"}
        </ActionButton>
        {!gone && (
          <ActionButton onClick={() => void confirm()} disabled={locked} testId="dialog-confirm">
            {status.phase === "pending" ? "Working…" : mode === "default" ? "Make default" : "Delete language"}
          </ActionButton>
        )}
        {gone && (
          <ActionButton onClick={() => onDone(language)} testId="dialog-done">
            Done
          </ActionButton>
        )}
      </DialogActions>
    </DialogShell>
  );
}
