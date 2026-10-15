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
      <PageHeader title="Tiền tệ & tỷ giá">
        VND là tiền tệ gốc của website và không thay đổi được. Các tiền tệ khác chỉ để hiển thị giá tham khảo: tỷ giá là &ldquo;số VND cho một đơn vị&rdquo; và do bạn nhập tay
        (không có nguồn tỷ giá tự động). Một tiền tệ chưa có tỷ giá thì chưa bật được và chưa chọn làm mặc định được. Giá phòng, giữ chỗ và đặt phòng luôn tính bằng VND.
      </PageHeader>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" testId="website-success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      {state.status === "loading" && <LoadingPanel what="tiền tệ" />}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => void reload()} />}
      {currencies && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {currencies.length} tiền tệ
            </p>
            <ActionButton testId="add-currency" onClick={() => open({ kind: "create" })} disabled={busy}>
              Thêm tiền tệ
            </ActionButton>
          </div>
          <div className={TABLE_CLASSES.wrap}>
            <table className={TABLE_CLASSES.table}>
              <thead className={TABLE_CLASSES.head}>
                <tr>
                  <th className={TABLE_CLASSES.headCell}>Tiền tệ</th>
                  <th className={TABLE_CLASSES.headCell}>Trạng thái</th>
                  <th className={TABLE_CLASSES.headCell}>Tỷ giá (VND cho 1 đơn vị)</th>
                  <th className={TABLE_CLASSES.headCell}>Tỷ giá nhập lúc</th>
                  <th className={TABLE_CLASSES.headCell}>
                    <span className="sr-only">Thao tác</span>
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
                        Ký hiệu {currency.symbol} · {currency.minorUnits} chữ số thập phân · thứ tự {currency.sortOrder}
                      </div>
                    </td>
                    <td className={TABLE_CLASSES.cell}>
                      <div className="flex flex-wrap gap-1.5">
                        {currency.isBase && <Badge color="primary">Gốc</Badge>}
                        {currency.isDefault && <Badge color="success">Mặc định hiển thị</Badge>}
                        <Badge color={currency.isActive ? "info" : "light"}>{currency.isActive ? "Đang bật" : "Đã tắt"}</Badge>
                        {currency.vndPerUnit === null && <Badge color="warning">Chưa có tỷ giá</Badge>}
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
                          <span className="self-center text-xs text-gray-500 dark:text-gray-400">Cố định: tỷ giá 1, luôn bật</span>
                          {!currency.isDefault && (
                            <ActionButton variant="outline" testId={`default-${currency.code}`} onClick={() => open({ kind: "default", currency })} disabled={busy}>
                              Đặt mặc định
                            </ActionButton>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionButton variant="outline" testId={`edit-${currency.code}`} onClick={() => open({ kind: "edit", currency })} disabled={busy}>
                            Chỉnh sửa
                          </ActionButton>
                          <ActionButton variant="outline" testId={`rate-edit-${currency.code}`} onClick={() => open({ kind: "rate", currency })} disabled={busy}>
                            {currency.vndPerUnit === null ? "Nhập tỷ giá" : "Đổi tỷ giá"}
                          </ActionButton>
                          <ActionButton variant="outline" testId={`toggle-${currency.code}`} onClick={() => open({ kind: "toggle", currency })} disabled={busy}>
                            {currency.isActive ? "Tắt" : "Bật"}
                          </ActionButton>
                          {!currency.isDefault && (
                            <ActionButton variant="outline" testId={`default-${currency.code}`} onClick={() => open({ kind: "default", currency })} disabled={busy}>
                              Đặt mặc định
                            </ActionButton>
                          )}
                          {!currency.isDefault && (
                            <ActionButton variant="outline" testId={`delete-${currency.code}`} onClick={() => open({ kind: "delete", currency })} disabled={busy}>
                              Xoá
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
        <CurrencyFormDialog mode="create" currency={null} nextOrder={nextOrder} reload={reload} onClose={() => setDialog(null)} onSaved={(currency) => done(`Đã thêm ${currency.code}. Tiền tệ đang tắt và chưa có tỷ giá.`)} />
      )}
      {dialog?.kind === "edit" && (
        <CurrencyFormDialog mode="edit" currency={dialog.currency} nextOrder={nextOrder} reload={reload} onClose={() => setDialog(null)} onSaved={(currency) => done(`Đã lưu ${currency.code}.`)} />
      )}
      {dialog?.kind === "rate" && (
        <RateDialog currency={dialog.currency} reload={reload} onClose={() => setDialog(null)} onSaved={(currency) => done(`Đã lưu tỷ giá ${currency.code}: 1 ${currency.code} = ${currency.vndPerUnit} VND.`)} />
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
  return `phiên bản ${currency.version}: "${currency.name}" (${currency.symbol}), ${currency.minorUnits} chữ số thập phân, ${currency.isActive ? "đang bật" : "đã tắt"}${currency.isDefault ? ", mặc định" : ""}, tỷ giá ${currency.vndPerUnit === null ? "chưa có" : `${currency.vndPerUnit} VND`}, cập nhật ${formatWhen(currency.updatedAtUtc)}`;
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
    name: name.trim() === "" ? "Nhập tên tiền tệ." : name.trim().length > 100 ? "Tối đa 100 ký tự." : null,
    symbol: symbol.trim() === "" ? "Nhập ký hiệu." : symbol.trim().length > 10 ? "Tối đa 10 ký tự." : null,
    minorUnits: /^[0-4]$/.test(minorUnits.trim()) ? null : "Một số nguyên từ 0 đến 4.",
    sortOrder: /^\d{1,5}$/.test(sortOrder.trim()) && Number(sortOrder) <= 10000 ? null : "Một số nguyên từ 0 đến 10000.",
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
        setServerNote("Không đọc được máy chủ. Hãy thử lại trước khi thay đổi gì.");
        return;
      }
      const target = mode === "edit" ? currency!.code : code.trim();
      const latest = fresh.find((item) => same(item.code, target)) ?? null;
      reset();
      if (mode === "create") {
        setBlocked(latest !== null);
        setServerNote(latest ? `Máy chủ đã có ${latest.code} (${describe(latest)}). Việc lưu đã được ghi nhận: hãy đóng hộp thoại.` : "Đã kiểm tra: máy chủ chưa có tiền tệ này nên chưa được lưu. Bạn có thể lưu lại.");
        return;
      }
      if (!latest) {
        setBlocked(true);
        setServerNote(`${target} không còn tồn tại trên máy chủ. Hãy đóng hộp thoại.`);
        return;
      }
      setBase(latest);
      setBlocked(false);
      setServerNote(`Bản mới nhất trên máy chủ — ${describe(latest)}. Bản nháp của bạn không đổi; Lưu sẽ áp dụng nó lên phiên bản này.`);
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
    <DialogShell title={mode === "create" ? "Thêm tiền tệ" : `Chỉnh sửa ${currency!.code}`} onClose={onClose} busy={working} testId="currency-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {mode === "create" ? (
          <TextField label="Mã tiền tệ" value={code} onChange={setCode} error={shown("code")} hint="Mã ISO 4217 như USD. Không đổi được sau này. Tiền tệ mới ở trạng thái tắt và chưa có tỷ giá." disabled={locked} maxLength={3} testId="field-code" autoFocus />
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Code <span className="font-mono font-medium">{currency!.code}</span> (fixed)
          </p>
        )}
        <TextField label="Tên" value={name} onChange={setName} error={shown("name")} disabled={locked} maxLength={100} testId="field-name" />
        <TextField label="Ký hiệu" value={symbol} onChange={setSymbol} error={shown("symbol")} disabled={locked} maxLength={10} testId="field-symbol" />
        <TextField label="Số chữ số thập phân" value={minorUnits} onChange={setMinorUnits} error={shown("minorUnits")} hint="Số chữ số sau dấu thập phân khi hiển thị số tiền (0 đến 4)." inputMode="numeric" disabled={locked} maxLength={1} testId="field-minorUnits" />
        <TextField label="Thứ tự hiển thị" value={sortOrder} onChange={setSortOrder} error={shown("sortOrder")} inputMode="numeric" disabled={locked} maxLength={5} testId="field-sortOrder" />
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
            Huỷ
          </ActionButton>
          <ActionButton type="submit" disabled={locked} testId="dialog-save">
            {status.phase === "pending" ? "Đang lưu…" : mode === "create" ? "Thêm tiền tệ" : "Lưu"}
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
        setServerNote("Không đọc được máy chủ. Hãy thử lại trước khi thay đổi gì.");
        return;
      }
      const latest = fresh.find((item) => same(item.code, currency.code)) ?? null;
      reset();
      if (!latest) {
        setGone(true);
        setServerNote(`${currency.code} không còn tồn tại trên máy chủ. Hãy đóng hộp thoại.`);
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
    <DialogShell title={`${currency.vndPerUnit === null ? "Nhập" : "Đổi"} tỷ giá ${currency.code}`} onClose={onClose} busy={working} testId="rate-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <p className="text-sm text-gray-700 dark:text-gray-200">
          Nhập một <span className="font-medium">{currency.code}</span> bằng bao nhiêu <span className="font-medium">VND</span>. Ví dụ
          {" "}<span className="font-mono">25000.5</span> nghĩa là 1 {currency.code} = 25.000,5 VND, và 1.000.000 VND được hiển thị là 1.000.000 ÷ 25000.5 {currency.code}. Chỉ dùng chữ số và
          một dấu chấm. Hãy lấy tỷ giá từ nguồn thật (ví dụ trang tỷ giá của ngân hàng bạn dùng) và ghi nhớ nguồn cùng thời điểm. Nguồn: {RATE_SOURCE_LABEL} — không có nguồn tự động.
        </p>
        <TextField
          label={`VND cho 1 ${currency.code}`}
          value={rate}
          onChange={setRate}
          error={(touched ? error : null) ?? refused}
          hint="Tối đa 12 chữ số trước và 8 sau dấu chấm, lớn hơn 0; không dấu phẩy, khoảng trắng hay số mũ."
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
            Huỷ
          </ActionButton>
          <ActionButton type="submit" disabled={locked} testId="dialog-save">
            {status.phase === "pending" ? "Đang lưu…" : "Lưu tỷ giá"}
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
      ? `Đã xoá ${currency.code}.`
      : mode === "default"
        ? `${currency.code} hiện là tiền tệ mặc định hiển thị.`
        : turningOn
          ? `${currency.code} đã được bật.`
          : `${currency.code} đã được tắt.`;

  const compareWithServer = async () => {
    setChecking(true);
    try {
      const fresh = await reload();
      if (fresh === null) {
        setServerNote("Không đọc được máy chủ. Hãy thử lại trước khi thay đổi gì.");
        return;
      }
      const latest = fresh.find((item) => same(item.code, currency.code)) ?? null;
      reset();
      if (mode === "delete" && latest === null) {
        setGone(true);
        setServerNote(`${currency.code} không còn trên máy chủ: đã được xoá.`);
        return;
      }
      if (latest === null) {
        setGone(true);
        setServerNote(`${currency.code} không còn tồn tại trên máy chủ. Hãy đóng hộp thoại.`);
        return;
      }
      if ((mode === "default" && latest.isDefault) || (mode === "toggle" && latest.isActive === turningOn)) {
        setGone(true);
        setServerNote(`Máy chủ đã áp dụng thay đổi này: ${describe(latest)}.`);
        return;
      }
      setBase(latest);
      setServerNote(`Bản mới nhất trên máy chủ — ${describe(latest)}. Hãy xác nhận lại để áp dụng cho phiên bản này.`);
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
      title={mode === "delete" ? `Xoá ${currency.code}?` : mode === "default" ? `Đặt ${currency.code} làm tiền mặc định hiển thị?` : `${turningOn ? "Bật" : "Tắt"} ${currency.code}?`}
      onClose={onClose}
      busy={working}
      testId={`currency-${mode}-dialog`}
    >
      <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
        {mode === "delete" && (
          <p>
            Thao tác này xoá <span className="font-medium">{currency.name}</span> ({currency.code}) cùng tỷ giá của nó và không hoàn tác được. Tiền tệ đang bật hoặc đang là mặc định không xoá được: hãy tắt nó trước.
          </p>
        )}
        {mode === "default" && (
          <p>
            Số tiền tham khảo sẽ mặc định hiển thị bằng <span className="font-medium">{currency.code}</span>
            {current && (
              <>
                {" "}thay vì <span className="font-mono">{current.code}</span>
              </>
            )}
            . Tiền gốc vẫn là VND. Tiền tệ phải đang bật và có tỷ giá{currency.vndPerUnit === null ? " — hiện chưa có nên máy chủ sẽ từ chối" : ""}.
          </p>
        )}
        {mode === "toggle" && turningOn && (
          <p>
            Khách sẽ thấy và chọn được {currency.code}.{" "}
            {currency.vndPerUnit === null ? "Chưa có tỷ giá nên máy chủ sẽ từ chối: hãy nhập tỷ giá trước." : `Tỷ giá đang dùng: 1 ${currency.code} = ${currency.vndPerUnit} VND.`}
          </p>
        )}
        {mode === "toggle" && !turningOn && (
          <p>
            Khách sẽ không còn thấy {currency.code}. Tỷ giá vẫn được giữ. Tiền mặc định không tắt được: hãy chọn tiền mặc định khác trước.
          </p>
        )}
      </div>
      <WriteFeedback status={status} working={working} serverNote={serverNote} onReloadLatest={() => void compareWithServer()} onCheckServer={() => void compareWithServer()} />
      <DialogActions>
        <ActionButton variant="outline" onClick={onClose} disabled={working} testId="dialog-cancel">
          {gone ? "Đóng" : "Huỷ"}
        </ActionButton>
        {!gone && (
          <ActionButton onClick={() => void confirm()} disabled={locked} testId="dialog-confirm">
            {status.phase === "pending" ? "Đang xử lý…" : mode === "delete" ? "Xoá tiền tệ" : mode === "default" ? "Đặt mặc định" : turningOn ? "Bật" : "Tắt"}
          </ActionButton>
        )}
        {gone && (
          <ActionButton onClick={() => onDone(doneMessage())} testId="dialog-done">
            Xong
          </ActionButton>
        )}
      </DialogActions>
    </DialogShell>
  );
}
