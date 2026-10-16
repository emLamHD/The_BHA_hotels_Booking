"use client";

/**
 * CUST-WEB-HEADER-001-CP04: the Menu screen — the site's header navigation (not per Property). The draft lives only on this
 * screen until Save; one Save sends the whole tree, links and labels (or nothing), carrying the revision that was loaded. A
 * stale revision keeps the draft and says so; a lost answer is never retried — the screen reads the server and compares
 * the stored tree with the draft that was sent before it claims anything. Order, position and level are buttons (also
 * for a keyboard and a phone), not drag and drop. Nothing the editor does can build a cycle, a fifth level or an
 * orphan: the operations are in `lib/website/menuModel`, and the server repeats every rule.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Checkbox from "@/components/form/input/Checkbox";
import { getMenu, saveMenu, type MenuItem, type MenuLocale, type MenuPlacement, type WebsiteMenu } from "@/lib/api/website";
import {
  MAX_DEPTH, addItem, childrenOf, depthOf, descendantIds, draftProblems, find, fingerprint, hasBlockingProblem, indent, locateField,
  moveWithinSiblings, newId, outdent, patchItem, previewTree, rebaseDraft, removeItem, setPlacement, siblingsOf, summarizeChanges, type ItemProblems, type Move, type PreviewNode,
} from "@/lib/website/menuModel";
import { refusalText } from "@/lib/website/wording";
import { useWebsiteHost } from "./WebsiteAccessGate";
import { useWebsiteList, useWriteAction } from "./useWebsiteData";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, TextField, WriteFeedback, formatWhen } from "./WebsiteUi";

const PLACEMENTS: { id: MenuPlacement; title: string; hint: string }[] = [
  { id: "primary", title: "Hàng chính", hint: "Bên trái header, cạnh logo." },
  { id: "secondary", title: "Nhóm phụ", hint: "Bên phải header, cạnh ngôn ngữ và tài khoản." },
];

const PANEL = "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]";
const SMALL_BUTTON =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5";

/** Leaving with unsaved changes asks first: closing the tab, and following any link of this app. */
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      if (!window.confirm("Bạn có thay đổi menu chưa lưu. Rời trang này sẽ bỏ chúng. Vẫn rời đi?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

export default function MenusPanel() {
  const { state, reload } = useWebsiteList(getMenu, []);
  // Once the screen has a menu it keeps its draft even if a later read fails: the draft is the operator's work.
  const [held, setHeld] = useState<WebsiteMenu | null>(null);
  if (held === null && state.status === "ready") setHeld(state.data);
  const current = held ?? (state.status === "ready" ? state.data : null);
  if (current === null) {
    return state.status === "error" ? <ErrorPanel message={state.message} onRetry={() => void reload()} /> : <LoadingPanel what="menu" />;
  }
  return <MenuEditor initial={current} reload={reload} readError={state.status === "error" ? state.message : null} />;
}

function MenuEditor({ initial, reload, readError }: { initial: WebsiteMenu; reload: () => Promise<WebsiteMenu | null>; readError: string | null }) {
  const host = useWebsiteHost();
  const write = useWriteAction();
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState<MenuItem[]>(initial.items);
  const [selectedId, setSelectedId] = useState<string | null>(initial.items[0]?.id ?? null);
  const [previewLocale, setPreviewLocale] = useState(initial.locales.find((locale) => locale.isDefault)?.code ?? "vi");
  const [submitted, setSubmitted] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const sent = useRef<MenuItem[] | null>(null);

  const locales = base.locales;
  const defaultCode = locales.find((locale) => locale.isDefault)?.code ?? "vi";
  const problems = useMemo(() => draftProblems(draft, locales), [draft, locales]);
  const blocking = useMemo(() => [...problems.values()].filter(hasBlockingProblem).length, [problems]);
  const dirty = fingerprint(draft) !== fingerprint(base.items);
  const changes = useMemo(() => summarizeChanges(base.items, draft), [base.items, draft]);
  const working = write.status.phase === "pending" || checking;
  const locked = working || write.status.phase === "unverified" || host.signingOut;
  useLeaveGuard(dirty);
  // Sign out (a button of the gate, not a link) asks too while there is a draft.
  const setUnsaved = host.setUnsaved;
  useEffect(() => {
    setUnsaved(dirty);
    return () => setUnsaved(false);
  }, [dirty, setUnsaved]);

  const selected = selectedId ? find(draft, selectedId) : null;
  const serverField = write.status.phase === "refused" ? locateField(write.status.failure.field, draft) : null;

  const apply = (move: Move) => {
    if (move.ok) {
      setDraft(move.items);
      setMoveNote(null);
      setSavedNote(null);
    } else {
      setMoveNote(move.reason);
    }
  };
  const edit = (id: string, patch: Parameters<typeof patchItem>[2]) => {
    setDraft((items) => patchItem(items, id, patch));
    setSavedNote(null);
    setMoveNote(null);
  };

  const add = (parentId: string | null, placement: MenuPlacement) => {
    const labels = Object.fromEntries(locales.map((locale) => [locale.code, locale.isContentSource || locale.isDefault ? "Mục mới" : null]));
    const id = newId();
    const move = addItem(draft, parentId, placement, labels, id);
    apply(move);
    if (move.ok) setSelectedId(id);
  };

  const remove = (id: string) => {
    const move = removeItem(draft, id);
    apply(move);
    if (move.ok) setSelectedId(null);
  };

  const cancel = () => {
    setDraft(base.items);
    setSelectedId((current) => (current && find(base.items, current) ? current : base.items[0]?.id ?? null));
    setSubmitted(false);
    setMoveNote(null);
    setServerNote(null);
    setSavedNote(null);
    write.reset();
  };

  const save = async () => {
    setSubmitted(true);
    setServerNote(null);
    setSavedNote(null);
    if (blocking > 0 || !dirty || locked) return;
    sent.current = draft;
    const result = await write.run(() => saveMenu(base.revision, draft));
    if (result?.kind === "ok") {
      setBase(result.data);
      setDraft(result.data.items);
      setSubmitted(false);
      setSavedNote(`Đã lưu lúc ${formatWhen(result.data.updatedAtUtc)}. Khách thấy menu mới ngay ở lần tải tiếp theo, và trong tối đa 15 giây ở tab đang mở.`);
    } else if (result?.kind === "refused" && result.field) {
      const at = locateField(result.field, draft);
      if (at) setSelectedId(at.id);
    }
  };

  /** Reads the server: after a stale save (to see the latest) or a lost answer (to learn what really happened). */
  const readServer = useCallback(async (): Promise<WebsiteMenu | null> => {
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
    const rebased = rebaseDraft(base.items, draft, fresh.items);
    setBase(fresh);
    setDraft(rebased.items);
    const when = `Đã tải bản mới nhất của máy chủ (${fresh.items.length} mục, lưu lúc ${formatWhen(fresh.updatedAtUtc)}).`;
    setServerNote(
      rebased.how === "merged"
        ? `${when} Thay đổi của bạn được giữ và đặt lên trên bản mới, nên thay đổi của người khác ở các mục bạn không sửa vẫn còn. Kiểm tra rồi bấm Lưu; Huỷ bỏ nháp và dùng bản này.`
        : `${when} Bạn đã thêm, xoá hoặc chuyển mục nên không gộp tự động được: bản nháp được giữ nguyên và Lưu sẽ thay cả cây trên máy chủ bằng bản nháp này. Huỷ bỏ nháp và dùng bản mới.`
    );
  };

  const checkServer = async () => {
    const fresh = await readServer();
    if (!fresh) return;
    write.reset();
    setBase(fresh);
    if (sent.current && fingerprint(fresh.items) === fingerprint(sent.current)) {
      setDraft(fresh.items);
      setSubmitted(false);
      setServerNote("Máy chủ xác nhận: thay đổi đã được lưu, đúng một lần. Không cần lưu lại.");
    } else {
      setServerNote("Máy chủ chưa có thay đổi vừa gửi (hoặc đang khác bản nháp). Bản nháp được giữ; hãy kiểm tra rồi Lưu lại nếu bạn vẫn muốn.");
    }
  };

  const preview = useMemo(() => previewTree(draft, previewLocale, defaultCode), [draft, previewLocale, defaultCode]);
  const rootsOf = (placement: MenuPlacement) => draft.filter((item) => item.parentId === null && item.placement === placement);

  return (
    <div className="flex flex-col gap-4" data-testid="menus-panel">
      <PageHeader title="Menu header">
        Cây menu của website, dùng cho cả header trên máy tính và menu trên điện thoại. Chỉnh trên màn hình này chỉ là bản nháp cho tới khi bạn bấm Lưu; một lần Lưu áp toàn bộ cây, link và nhãn.
      </PageHeader>

      {readError && <Banner tone="error" testId="menus-read-error">{readError}</Banner>}
      {savedNote && <Banner tone="success" testId="website-success" onDismiss={() => setSavedNote(null)}>{savedNote}</Banner>}

      <div className={`${PANEL} flex flex-wrap items-center justify-between gap-3`} data-testid="menu-savebar">
        <p className="text-sm text-gray-700 dark:text-gray-200" data-testid="menu-state">
          {dirty ? (
            <>
              <span className="font-medium text-warning-700 dark:text-warning-300">Có thay đổi chưa lưu</span>
              {` — thêm ${changes.added}, sửa ${changes.edited}, xoá ${changes.removed}.`}
            </>
          ) : (
            <span>Đã lưu — phiên bản {base.version}, cập nhật {formatWhen(base.updatedAtUtc)}.</span>
          )}
          {submitted && blocking > 0 && <span className="ml-2 text-error-600 dark:text-error-400" data-testid="menu-blocking">Còn {blocking} mục cần sửa trước khi lưu.</span>}
        </p>
        <div className="flex gap-2">
          <ActionButton variant="outline" onClick={cancel} disabled={!dirty || working} testId="menu-cancel">
            Huỷ thay đổi
          </ActionButton>
          <ActionButton onClick={() => void save()} disabled={!dirty || locked} testId="menu-save">
            {write.status.phase === "pending" ? "Đang lưu…" : "Lưu menu"}
          </ActionButton>
        </div>
      </div>

      <WriteFeedback
        status={write.status}
        working={working}
        serverNote={serverNote}
        onReloadLatest={() => void reloadLatest()}
        onCheckServer={() => void checkServer()}
        fieldErrorOf={(field) => locateField(field, draft) !== null}
      />
      {moveNote && <Banner tone="warning" testId="menu-move-note" onDismiss={() => setMoveNote(null)}>{moveNote}</Banner>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Cây menu" data-testid="menu-tree">
          {PLACEMENTS.map((group) => (
            <div key={group.id} className={PANEL} data-testid={`group-${group.id}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{group.title}</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{group.hint}</p>
                </div>
                <ActionButton variant="outline" onClick={() => add(null, group.id)} disabled={locked} testId={`add-root-${group.id}`}>
                  Thêm mục
                </ActionButton>
              </div>
              {rootsOf(group.id).length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400" data-testid={`empty-${group.id}`}>Chưa có mục nào. Khách sẽ không thấy gì ở nhóm này.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {rootsOf(group.id).map((root) => (
                    <TreeNode key={root.id} item={root} items={draft} depth={1} selectedId={selectedId} onSelect={setSelectedId} problems={problems} defaultCode={defaultCode} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>

        <section className="flex min-w-0 flex-col gap-4" aria-label="Chỉnh sửa mục">
          {selected ? (
            <ItemEditor
              key={selected.id}
              item={selected}
              items={draft}
              locales={locales}
              problems={problems.get(selected.id)!}
              showErrors={submitted || serverField?.id === selected.id}
              serverField={serverField?.id === selected.id ? serverField : null}
              serverMessage={write.status.phase === "refused" && serverField?.id === selected.id ? refusalText(write.status.failure) : null}
              locked={locked}
              onEdit={(patch) => edit(selected.id, patch)}
              onMove={apply}
              onAddChild={() => add(selected.id, "primary")}
              onRemove={() => remove(selected.id)}
            />
          ) : (
            <div className={PANEL} data-testid="menu-nothing-selected">
              <p className="text-sm text-gray-600 dark:text-gray-300">Chọn một mục trong cây để sửa nhãn, link và vị trí, hoặc thêm mục mới.</p>
            </div>
          )}

          <div className={PANEL} data-testid="menu-preview">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Xem trước (khách thấy)</h2>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                Ngôn ngữ
                <select
                  value={previewLocale}
                  onChange={(event) => setPreviewLocale(event.target.value)}
                  data-testid="preview-locale"
                  className="h-9 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                >
                  {locales.map((locale) => (
                    <option key={locale.code} value={locale.code}>
                      {locale.nativeName} ({locale.code}){locale.isActive ? "" : " — đang tắt"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <PreviewGroup title="Hàng chính" nodes={preview.primary} testId="preview-primary" />
            <PreviewGroup title="Nhóm phụ" nodes={preview.secondary} testId="preview-secondary" />
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Chỉ mục đang bật; tắt một mục cha ẩn cả nhánh của nó. Nhãn thiếu hiện theo ngôn ngữ mặc định.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function TreeNode({
  item, items, depth, selectedId, onSelect, problems, defaultCode,
}: {
  item: MenuItem;
  items: MenuItem[];
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  problems: Map<string, ItemProblems>;
  defaultCode: string;
}) {
  const own = problems.get(item.id);
  const kids = childrenOf(items, item.id);
  const label = item.labels.vi?.trim() || item.labels[defaultCode]?.trim() || "(chưa có nhãn)";
  const selected = selectedId === item.id;
  return (
    <li data-testid={`node-${item.id}`}>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={selected ? "true" : undefined}
        data-testid={`select-${item.id}`}
        className={`flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-brand-500/20 ${
          selected ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-500/10" : "border-transparent hover:bg-gray-50 dark:hover:bg-white/5"
        }`}
      >
        <span className="min-w-0 break-words font-medium text-gray-800 dark:text-white/90">{label}</span>
        <span className="min-w-0 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{item.href}</span>
        {!item.isEnabled && <Chip tone="muted">Đang tắt</Chip>}
        {item.openInNewTab && <Chip tone="muted">Tab mới</Chip>}
        {own && hasBlockingProblem(own) && <Chip tone="error">Cần sửa</Chip>}
        {own && own.missing.length > 0 && <Chip tone="warn">Thiếu nhãn {own.missing.join(", ")}</Chip>}
      </button>
      {kids.length > 0 && (
        <ul className="ml-4 mt-1 flex flex-col gap-1 border-l border-gray-200 pl-3 dark:border-gray-700" data-depth={depth + 1}>
          {kids.map((child) => (
            <TreeNode key={child.id} item={child} items={items} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} problems={problems} defaultCode={defaultCode} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Chip({ tone, children }: { tone: "muted" | "warn" | "error"; children: React.ReactNode }) {
  const classes = {
    muted: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
    warn: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300",
    error: "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${classes}`}>{children}</span>;
}

function ItemEditor({
  item, items, locales, problems, showErrors, serverField, serverMessage, locked, onEdit, onMove, onAddChild, onRemove,
}: {
  item: MenuItem;
  items: MenuItem[];
  locales: MenuLocale[];
  problems: ItemProblems;
  showErrors: boolean;
  serverField: { prop: string; sub: string | null } | null;
  serverMessage: string | null;
  locked: boolean;
  onEdit: (patch: Parameters<typeof patchItem>[2]) => void;
  onMove: (move: Move) => void;
  onAddChild: () => void;
  onRemove: () => void;
}) {
  const siblings = siblingsOf(items, item.id);
  const at = siblings.findIndex((other) => other.id === item.id);
  const kids = childrenOf(items, item.id).length;
  const depth = depthOf(items, item.id);
  const hrefProblem = (showErrors ? problems.href : null) ?? (serverField?.prop === "href" ? serverMessage : null);
  const setLabel = (code: string, text: string) => onEdit({ labels: { ...item.labels, [code]: text } });

  return (
    <div className={`${PANEL} flex flex-col gap-4`} data-testid="menu-item-editor">
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Chỉnh mục</h2>

      <fieldset className="flex flex-col gap-3" disabled={locked}>
        <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">Nhãn theo ngôn ngữ</legend>
        {locales.map((locale) => {
          const required = locale.isContentSource || locale.isDefault;
          const shown = (showErrors ? problems.labels[locale.code] : undefined) ?? (serverField?.prop === "labels" && serverField.sub === locale.code ? serverMessage : null);
          const empty = (item.labels[locale.code] ?? "").trim() === "";
          return (
            <TextField
              key={locale.code}
              label={`${locale.nativeName} (${locale.code})${required ? " — bắt buộc" : ""}${locale.isActive ? "" : " — ngôn ngữ đang tắt"}`}
              value={item.labels[locale.code] ?? ""}
              onChange={(text) => setLabel(locale.code, text)}
              error={shown ?? null}
              hint={!required && empty ? "Chưa có nhãn: khách sẽ thấy nhãn của ngôn ngữ mặc định." : undefined}
              maxLength={80}
              testId={`label-${locale.code}`}
            />
          );
        })}
      </fieldset>

      <TextField
        label="Link"
        value={item.href}
        onChange={(text) => onEdit({ href: text })}
        error={hrefProblem}
        hint="Đường dẫn trong website (bắt đầu bằng /), một mốc # hoặc địa chỉ https://. Link không tự mở khoá trang đích: trang cần đăng nhập vẫn tự kiểm tra."
        disabled={locked}
        maxLength={2048}
        testId="field-href"
      />

      <div className="flex flex-col gap-2">
        <Checkbox id={`enabled-${item.id}`} label="Hiển thị trên website" checked={item.isEnabled} onChange={(checked) => onEdit({ isEnabled: checked })} disabled={locked} />
        <Checkbox id={`newtab-${item.id}`} label="Mở trong tab mới" checked={item.openInNewTab} onChange={(checked) => onEdit({ openInNewTab: checked })} disabled={locked} />
        {!item.isEnabled && kids > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">Tắt mục này ẩn cả {kids} mục con khỏi khách; trạng thái bật/tắt của từng mục con vẫn được giữ.</p>}
      </div>

      <div className="flex flex-col gap-2" role="group" aria-label="Vị trí">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Vị trí — cấp {depth} / {MAX_DEPTH}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SMALL_BUTTON} disabled={locked || at <= 0} onClick={() => onMove(moveWithinSiblings(items, item.id, -1))} data-testid="move-up">Lên</button>
          <button type="button" className={SMALL_BUTTON} disabled={locked || at >= siblings.length - 1} onClick={() => onMove(moveWithinSiblings(items, item.id, 1))} data-testid="move-down">Xuống</button>
          <button type="button" className={SMALL_BUTTON} disabled={locked || at <= 0} onClick={() => onMove(indent(items, item.id))} data-testid="move-in">Thụt vào (thành mục con của mục trên)</button>
          <button type="button" className={SMALL_BUTTON} disabled={locked || item.parentId === null} onClick={() => onMove(outdent(items, item.id))} data-testid="move-out">Lùi ra (ngang hàng với mục cha)</button>
          {item.parentId === null && (
            <button
              type="button"
              className={SMALL_BUTTON}
              disabled={locked}
              onClick={() => onMove(setPlacement(items, item.id, item.placement === "primary" ? "secondary" : "primary"))}
              data-testid="move-group"
            >
              Chuyển sang {item.placement === "primary" ? "nhóm phụ" : "hàng chính"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={SMALL_BUTTON} disabled={locked || depth >= MAX_DEPTH} onClick={onAddChild} data-testid="add-child">Thêm mục con</button>
        <button type="button" className={`${SMALL_BUTTON} !border-error-300 !text-error-700 dark:!text-error-300`} disabled={locked} onClick={onRemove} data-testid="remove-item">Xoá mục này</button>
      </div>
      {kids > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">Mục này có {kids} mục con ({descendantIds(items, item.id).length} mục trong cả nhánh): phải chuyển hoặc xoá chúng trước khi xoá mục này.</p>}

      <p className="break-all text-xs text-gray-400 dark:text-gray-500">ID {item.id} — khoá bản dịch content.menuItem.{item.id}.label (không đổi khi bạn đổi tên, link hay vị trí).</p>
    </div>
  );
}

function PreviewGroup({ title, nodes, testId }: { title: string; nodes: PreviewNode[]; testId: string }) {
  return (
    <div className="mb-3" data-testid={testId}>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h3>
      {nodes.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">Không có mục nào.</p> : <PreviewList nodes={nodes} />}
    </div>
  );
}

function PreviewList({ nodes }: { nodes: PreviewNode[] }) {
  return (
    <ul className="ml-1 flex flex-col gap-0.5 text-sm text-gray-700 dark:text-gray-200">
      {nodes.map((node) => (
        <li key={node.id}>
          <span className="break-words">{node.label}</span>
          <span className="ml-2 break-all font-mono text-xs text-gray-400">{node.href}{node.newTab ? " ↗" : ""}</span>
          {node.children.length > 0 && (
            <div className="ml-4 border-l border-gray-200 pl-3 dark:border-gray-700">
              <PreviewList nodes={node.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
