"use client";

/**
 * CUST-WEB-HEADER-001-CP02: the Currencies and exchange rates screen. VND is the fixed base. A rate is typed as text and
 * means VND per ONE unit of the currency (so a reference amount is VND ÷ rate); it is sent and shown as the exact decimal
 * string, never as a number. A currency starts off with no rate and can be turned on or chosen as the default only once it
 * has one. These are reference amounts only: nothing here changes a room price, a hold or a reservation. The server owns
 * the rules and says why when it refuses.
 */

import React, { useCallback, useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import {
  checkCurrencyCode,
  checkRateText,
  createCurrency,
  deleteCurrency,
  listCurrencies,
  setCurrencyActive,
  setCurrencyRate,
  setDefaultCurrency,
  updateCurrency,
  type WebsiteCurrency,
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

// A dialog keeps the row it was opened on, so one whose row disappears from the server stays to say so.
type Dialog =
  | { kind: "create" }
  | { kind: "edit"; currency: WebsiteCurrency }
  | { kind: "rate"; currency: WebsiteCurrency }
  | { kind: "toggle"; currency: WebsiteCurrency }
  | { kind: "default"; currency: WebsiteCurrency }
  | { kind: "delete"; currency: WebsiteCurrency };

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();
const RATE_SOURCE_LABEL = "Nhập thủ công";

export default function CurrenciesPanel() {
  const host = useWebsiteHost();
  const { state, reload } = useWebsiteList(listCurrencies, []);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currencies = state.status === "ready" ? state.data : null;
  const open = (next: Dialog) => {
    setNotice(null);
    setDialog(next);
  };
  const done = useCallback(
    (message: string) => {
      setDialog(null);
      setNotice(message);
      void reload();
    },
    [reload]
  );
  const busy = host.signingOut;
  const nextOrder = currencies ? Math.max(0, ...currencies.map((currency) => currency.sortOrder)) + 10 : 10;

  return (
    <div data-testid="currencies-panel">
      <PageHeader title="Currencies and exchange rates">
        VND is the base currency of the website and is fixed. Other currencies are for reference prices only: a rate is
        &ldquo;VND per one unit&rdquo; and is typed by hand (there is no automatic rate feed). A currency has no rate until you set one, and it
        can only be turned on or chosen as the default once it has one. Room prices, holds and reservations stay in VND.
      </PageHeader>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" testId="website-success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      {state.status === "loading" && <LoadingPanel what="currencies" />}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => void reload()} />}
      {currencies && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {currencies.length} currenc{currencies.length === 1 ? "y" : "ies"}
            </p>
            <ActionButton testId="add-currency" onClick={() => open({ kind: "create" })} disabled={busy}>
              Add currency
            </ActionButton>
          </div>
          <div className={TABLE_CLASSES.wrap}>
            <table className={TABLE_CLASSES.table}>
              <thead className={TABLE_CLASSES.head}>
                <tr>
                  <th className={TABLE_CLASSES.headCell}>Currency</th>
                  <th className={TABLE_CLASSES.headCell}>Status</th>
                  <th className={TABLE_CLASSES.headCell}>Rate (VND per 1 unit)</th>
                  <th className={TABLE_CLASSES.headCell}>Rate entered</th>
                  <th className={TABLE_CLASSES.headCell}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((currency) => (
                  <tr key={currency.code} data-testid={`currency-row-${currency.code}`} className={TABLE_CLASSES.row}>
                    <td className={TABLE_CLASSES.cell}>
                      <div className="font-medium">
                        <span className="font-mono">{currency.code}</span> · {currency.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Symbol {currency.symbol} · {currency.minorUnits} decimal{currency.minorUnits === 1 ? "" : "s"} · order {currency.sortOrder}
                      </div>
                    </td>
                    <td className={TABLE_CLASSES.cell}>
                      <div className="flex flex-wrap gap-1.5">
                        {currency.isBase && <Badge color="primary">Base</Badge>}
                        {currency.isDefault && <Badge color="success">Display default</Badge>}
                        <Badge color={currency.isActive ? "info" : "light"}>{currency.isActive ? "On" : "Off"}</Badge>
                        {currency.vndPerUnit === null && <Badge color="warning">No rate yet</Badge>}
                      </div>
                    </td>
                    <td className={`${TABLE_CLASSES.cell} font-mono`}>
                      {currency.vndPerUnit === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <>
                          <span data-testid={`rate-${currency.code}`}>{currency.vndPerUnit}</span>
                          <div className="font-sans text-xs text-gray-500 dark:text-gray-400">
                            1 {currency.code} = {currency.vndPerUnit} VND
                          </div>
                        </>
                      )}
                    </td>
                    <td className={TABLE_CLASSES.cell}>
                      {currency.rateUpdatedAtUtc === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <>
                          <div>{formatWhen(currency.rateUpdatedAtUtc)}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{currency.rateSource === "manual" ? RATE_SOURCE_LABEL : currency.rateSource}</div>
                        </>
                      )}
                    </td>
                    <td className={`${TABLE_CLASSES.cell} whitespace-nowrap`}>
                      {currency.isBase ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <span className="self-center text-xs text-gray-500 dark:text-gray-400">Fixed: rate 1, always on</span>
                          {!currency.isDefault && (
                            <ActionButton variant="outline" testId={`default-${currency.code}`} onClick={() => open({ kind: "default", currency })} disabled={busy}>
                              Make default
                            </ActionButton>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionButton variant="outline" testId={`edit-${currency.code}`} onClick={() => open({ kind: "edit", currency })} disabled={busy}>
                            Edit
                          </ActionButton>
                          <ActionButton variant="outline" testId={`rate-edit-${currency.code}`} onClick={() => open({ kind: "rate", currency })} disabled={busy}>
                            {currency.vndPerUnit === null ? "Set rate" : "Change rate"}
                          </ActionButton>
                          <ActionButton variant="outline" testId={`toggle-${currency.code}`} onClick={() => open({ kind: "toggle", currency })} disabled={busy}>
                            {currency.isActive ? "Turn off" : "Turn on"}
                          </ActionButton>
                          {!currency.isDefault && (
                            <ActionButton variant="outline" testId={`default-${currency.code}`} onClick={() => open({ kind: "default", currency })} disabled={busy}>
                              Make default
                            </ActionButton>
                          )}
                          {!currency.isDefault && (
                            <ActionButton variant="outline" testId={`delete-${currency.code}`} onClick={() => open({ kind: "delete", currency })} disabled={busy}>
                              Delete
                            </ActionButton>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dialog?.kind === "create" && (
        <CurrencyFormDialog mode="create" currency={null} nextOrder={nextOrder} reload={reload} onClose={() => setDialog(null)} onSaved={(currency) => done(`Added ${currency.code}. It is off and has no rate yet.`)} />
      )}
      {dialog?.kind === "edit" && (
        <CurrencyFormDialog mode="edit" currency={dialog.currency} nextOrder={nextOrder} reload={reload} onClose={() => setDialog(null)} onSaved={(currency) => done(`Saved ${currency.code}.`)} />
      )}
      {dialog?.kind === "rate" && (
        <RateDialog currency={dialog.currency} reload={reload} onClose={() => setDialog(null)} onSaved={(currency) => done(`Rate of ${currency.code} saved: 1 ${currency.code} = ${currency.vndPerUnit} VND.`)} />
      )}
      {dialog && (dialog.kind === "toggle" || dialog.kind === "default" || dialog.kind === "delete") && (
        <CurrencyConfirmDialog
          mode={dialog.kind}
          currency={dialog.currency}
          current={currencies?.find((currency) => currency.isDefault) ?? null}
          reload={reload}
          onClose={() => setDialog(null)}
          onDone={(message) => done(message)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ shared compare logic

function describe(currency: WebsiteCurrency): string {
  return `version ${currency.version}: "${currency.name}" (${currency.symbol}), ${currency.minorUnits} decimals, ${currency.isActive ? "on" : "off"}${currency.isDefault ? ", default" : ""}, rate ${currency.vndPerUnit === null ? "none" : `${currency.vndPerUnit} VND`}, updated ${formatWhen(currency.updatedAtUtc)}`;
}

// ------------------------------------------------------------------------------------------------ add / edit

function CurrencyFormDialog({
  mode,
  currency,
  nextOrder,
  reload,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  currency: WebsiteCurrency | null;
  nextOrder: number;
  reload: () => Promise<WebsiteCurrency[] | null>;
  onClose: () => void;
  onSaved: (currency: WebsiteCurrency) => void;
}) {
  const host = useWebsiteHost();
  const { status, run, reset } = useWriteAction();
  const [code, setCode] = useState("");
  const [name, setName] = useState(currency?.name ?? "");
  const [symbol, setSymbol] = useState(currency?.symbol ?? "");
  const [minorUnits, setMinorUnits] = useState(String(currency?.minorUnits ?? 2));
  const [sortOrder, setSortOrder] = useState(String(currency?.sortOrder ?? nextOrder));
  const [base, setBase] = useState<WebsiteCurrency | null>(currency);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [touched, setTouched] = useState(false);

  const errors = {
    code: mode === "create" ? checkCurrencyCode(code) : null,
    name: name.trim() === "" ? "Enter a name." : name.trim().length > 100 ? "At most 100 characters." : null,
    symbol: symbol.trim() === "" ? "Enter a symbol." : symbol.trim().length > 10 ? "At most 10 characters." : null,
    minorUnits: /^[0-4]$/.test(minorUnits.trim()) ? null : "A whole number from 0 to 4.",
    sortOrder: /^\d{1,5}$/.test(sortOrder.trim()) && Number(sortOrder) <= 10000 ? null : "A whole number from 0 to 10000.",
  };
  const refusedField = status.phase === "refused" && status.failure.code === "validation" ? status.failure : null;
  const shown = (field: keyof typeof errors) => (touched ? errors[field] : null) ?? (refusedField?.field === field ? refusedField.detail : null);
  const valid = Object.values(errors).every((message) => message === null);
  const working = status.phase === "pending" || checking;
  const locked = working || status.phase === "unverified" || blocked || host.signingOut;

  const compareWithServer = async () => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("The server could not be read. Try again before changing anything.");
        return;
      }
      const target = mode === "edit" ? currency!.code : code.trim();
      const latest = fresh.find((item) => same(item.code, target)) ?? null;
      reset();
      if (mode === "create") {
        setBlocked(latest !== null);
        setServerNote(latest ? `The server already has ${latest.code} (${describe(latest)}). It was saved: close this dialog.` : "Checked: the server does not have this currency yet, so it was not saved. You can save it again.");
        return;
      }
      if (!latest) {
        setBlocked(true);
        setServerNote(`${target} no longer exists on the server. Close this dialog.`);
        return;
      }
      setBase(latest);
      setBlocked(false);
      setServerNote(`Latest on the server — ${describe(latest)}. Your draft is unchanged; Save applies it on top of this version.`);
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setTouched(true);
    if (!valid || locked) return;
    const input = { name: name.trim(), symbol: symbol.trim(), minorUnits: Number(minorUnits), sortOrder: Number(sortOrder) };
    const result = await run(() => (mode === "create" ? createCurrency(code, input) : updateCurrency(base!.code, base!.version, input)));
    if (result?.kind === "ok") onSaved(result.data);
  };

  return (
    <DialogShell title={mode === "create" ? "Add a currency" : `Edit ${currency!.code}`} onClose={onClose} busy={working} testId="currency-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {mode === "create" ? (
          <TextField label="Currency code" value={code} onChange={setCode} error={shown("code")} hint="An ISO 4217 code such as USD. It cannot be changed later. A new currency is off and has no rate." disabled={locked} maxLength={3} testId="field-code" autoFocus />
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Code <span className="font-mono font-medium">{currency!.code}</span> (fixed)
          </p>
        )}
        <TextField label="Name" value={name} onChange={setName} error={shown("name")} disabled={locked} maxLength={100} testId="field-name" />
        <TextField label="Symbol" value={symbol} onChange={setSymbol} error={shown("symbol")} disabled={locked} maxLength={10} testId="field-symbol" />
        <TextField label="Decimal places" value={minorUnits} onChange={setMinorUnits} error={shown("minorUnits")} hint="How many decimals an amount in this currency shows (0 to 4)." inputMode="numeric" disabled={locked} maxLength={1} testId="field-minorUnits" />
        <TextField label="Order" value={sortOrder} onChange={setSortOrder} error={shown("sortOrder")} inputMode="numeric" disabled={locked} maxLength={5} testId="field-sortOrder" />
        <WriteFeedback
          status={status}
          working={working}
          serverNote={serverNote}
          onReloadLatest={mode === "edit" ? () => void compareWithServer() : undefined}
          onCheckServer={() => void compareWithServer()}
          fieldErrorOf={(field) => ["code", "name", "symbol", "minorUnits", "sortOrder"].includes(field ?? "")}
        />
        <DialogActions>
          <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
            Cancel
          </ActionButton>
          <ActionButton type="submit" disabled={locked} testId="dialog-save">
            {status.phase === "pending" ? "Saving…" : mode === "create" ? "Add currency" : "Save"}
          </ActionButton>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

// ------------------------------------------------------------------------------------------------ rate

function RateDialog({
  currency,
  reload,
  onClose,
  onSaved,
}: {
  currency: WebsiteCurrency;
  reload: () => Promise<WebsiteCurrency[] | null>;
  onClose: () => void;
  onSaved: (currency: WebsiteCurrency) => void;
}) {
  const host = useWebsiteHost();
  const { status, run, reset } = useWriteAction();
  const [rate, setRate] = useState(currency.vndPerUnit ?? "");
  const [base, setBase] = useState(currency);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [gone, setGone] = useState(false);
  const [touched, setTouched] = useState(false);

  const error = checkRateText(rate);
  const refused = status.phase === "refused" && status.failure.field === "vndPerUnit" ? status.failure.detail : null;
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
      const latest = fresh.find((item) => same(item.code, currency.code)) ?? null;
      reset();
      if (!latest) {
        setGone(true);
        setServerNote(`${currency.code} no longer exists on the server. Close this dialog.`);
        return;
      }
      setBase(latest);
      setServerNote(`Latest on the server — ${describe(latest)}. Your typed rate is unchanged; Save applies it on top of this version.`);
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setTouched(true);
    if (error !== null || locked) return;
    const result = await run(() => setCurrencyRate(base.code, base.version, rate));
    if (result?.kind === "ok") onSaved(result.data);
  };

  return (
    <DialogShell title={`${currency.vndPerUnit === null ? "Set" : "Change"} the rate of ${currency.code}`} onClose={onClose} busy={working} testId="rate-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <p className="text-sm text-gray-700 dark:text-gray-200">
          Type how many <span className="font-medium">VND</span> one <span className="font-medium">{currency.code}</span> is worth. For example
          {" "}<span className="font-mono">25000.5</span> means 1 {currency.code} = 25,000.5 VND, and 1,000,000 VND is shown as 1,000,000 ÷ 25000.5 {currency.code}. Use digits and a
          single dot only. Source: {RATE_SOURCE_LABEL} — there is no automatic feed.
        </p>
        <TextField
          label={`VND per 1 ${currency.code}`}
          value={rate}
          onChange={setRate}
          error={(touched ? error : null) ?? refused}
          hint="Up to 12 digits before and 8 after the dot, greater than zero; no commas, spaces or exponent."
          inputMode="decimal"
          disabled={locked}
          maxLength={21}
          testId="field-rate"
          autoFocus
        />
        {currency.isActive && (
          <p className="text-xs text-warning-700 dark:text-warning-300">{currency.code} is on: visitors will see the new rate as soon as it is saved.</p>
        )}
        <WriteFeedback status={status} working={working} serverNote={serverNote} onReloadLatest={() => void compareWithServer()} onCheckServer={() => void compareWithServer()} fieldErrorOf={(field) => field === "vndPerUnit"} />
        <DialogActions>
          <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
            Cancel
          </ActionButton>
          <ActionButton type="submit" disabled={locked} testId="dialog-save">
            {status.phase === "pending" ? "Saving…" : "Save rate"}
          </ActionButton>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

// ------------------------------------------------------------------------------------------------ on/off, default, delete

function CurrencyConfirmDialog({
  mode,
  currency,
  current,
  reload,
  onClose,
  onDone,
}: {
  mode: "toggle" | "default" | "delete";
  currency: WebsiteCurrency;
  current: WebsiteCurrency | null;
  reload: () => Promise<WebsiteCurrency[] | null>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const host = useWebsiteHost();
  const { status, run, reset } = useWriteAction();
  const [base, setBase] = useState(currency);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [gone, setGone] = useState(false);
  const turningOn = mode === "toggle" && !currency.isActive;
  const working = status.phase === "pending" || checking;
  const locked = working || status.phase === "unverified" || gone || host.signingOut;
  const doneMessage = () =>
    mode === "delete"
      ? `Deleted ${currency.code}.`
      : mode === "default"
        ? `${currency.code} is now the display default currency.`
        : turningOn
          ? `${currency.code} is on.`
          : `${currency.code} is off.`;

  const compareWithServer = async () => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("The server could not be read. Try again before changing anything.");
        return;
      }
      const latest = fresh.find((item) => same(item.code, currency.code)) ?? null;
      reset();
      if (mode === "delete" && latest === null) {
        setGone(true);
        setServerNote(`${currency.code} is no longer on the server: it was deleted.`);
        return;
      }
      if (latest === null) {
        setGone(true);
        setServerNote(`${currency.code} no longer exists on the server. Close this dialog.`);
        return;
      }
      if ((mode === "default" && latest.isDefault) || (mode === "toggle" && latest.isActive === turningOn)) {
        setGone(true);
        setServerNote(`The server already has this applied: ${describe(latest)}.`);
        return;
      }
      setBase(latest);
      setServerNote(`Latest on the server — ${describe(latest)}. Confirm again to apply it to this version.`);
    } finally {
      setChecking(false);
    }
  };

  const confirm = async () => {
    if (locked) return;
    const result = await run<unknown>(() =>
      mode === "delete"
        ? deleteCurrency(base.code, base.version)
        : mode === "default"
          ? setDefaultCurrency(base.code, base.version)
          : setCurrencyActive(base.code, base.version, turningOn)
    );
    if (result?.kind === "ok") onDone(doneMessage());
  };

  return (
    <DialogShell
      title={mode === "delete" ? `Delete ${currency.code}?` : mode === "default" ? `Make ${currency.code} the display default?` : `${turningOn ? "Turn on" : "Turn off"} ${currency.code}?`}
      onClose={onClose}
      busy={working}
      testId={`currency-${mode}-dialog`}
    >
      <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
        {mode === "delete" && (
          <p>
            This removes <span className="font-medium">{currency.name}</span> ({currency.code}) and its rate. It cannot be undone. A currency that is on or is the default cannot be deleted: turn it off first.
          </p>
        )}
        {mode === "default" && (
          <p>
            Reference amounts are shown in <span className="font-medium">{currency.code}</span> by default
            {current && (
              <>
                {" "}instead of <span className="font-mono">{current.code}</span>
              </>
            )}
            . The base currency stays VND. It must be on and have a rate{currency.vndPerUnit === null ? " — it has none yet, so the server will refuse" : ""}.
          </p>
        )}
        {mode === "toggle" && turningOn && (
          <p>
            Visitors will be able to see and choose {currency.code}.{" "}
            {currency.vndPerUnit === null ? "It has no rate yet, so the server will refuse: set a rate first." : `It uses the rate 1 ${currency.code} = ${currency.vndPerUnit} VND.`}
          </p>
        )}
        {mode === "toggle" && !turningOn && (
          <p>
            Visitors will no longer see {currency.code}. The rate is kept. The default currency cannot be turned off: choose another default first.
          </p>
        )}
      </div>
      <WriteFeedback status={status} working={working} serverNote={serverNote} onReloadLatest={() => void compareWithServer()} onCheckServer={() => void compareWithServer()} />
      <DialogActions>
        <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
          {gone ? "Close" : "Cancel"}
        </ActionButton>
        {!gone && (
          <ActionButton onClick={() => void confirm()} disabled={locked} testId="dialog-confirm">
            {status.phase === "pending" ? "Working…" : mode === "delete" ? "Delete currency" : mode === "default" ? "Make default" : turningOn ? "Turn on" : "Turn off"}
          </ActionButton>
        )}
        {gone && (
          <ActionButton onClick={() => onDone(doneMessage())} testId="dialog-done">
            Done
          </ActionButton>
        )}
      </DialogActions>
    </DialogShell>
  );
}
