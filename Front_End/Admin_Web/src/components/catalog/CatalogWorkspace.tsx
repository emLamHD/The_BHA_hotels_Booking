"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useStaffSession } from "@/components/auth/StaffSession";
import { useWebsiteHost } from "@/components/website/WebsiteAccessGate";
import { useWebsiteList, useWriteAction, describeFailure } from "@/components/website/useWebsiteData";
import { createAmenity, getCatalog, getCatalogProducts, getCatalogProperties, getPhysicalRooms, createProperty, createRoomType, createPhysicalRoom, saveCatalog, uploadCatalog, catalogImage, bodyOf, removeImage, type CatalogBody, type CatalogEditor, type CatalogProductSummary, type GalleryItem, type CreatePropertyInput, type CreateRoomTypeInput, type CreatePhysicalRoomInput } from "@/lib/api/catalog";

const box = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 read-only:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:read-only:bg-gray-800";
const btn = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/5";
const editorKey = (p: string, r: string | null) => `${p}:${r ?? "property"}`;
type Draft = { key: string; body: CatalogBody; baseline: CatalogBody };
type WorkspaceView = { kind: "list" } | { kind: "property" } | { kind: "product"; roomId: string };
type WorkspaceTarget = { propertyId: string; roomId: string; view: WorkspaceView };
const isRiversideIdentity = (property: { name: string; slug: string }) =>
  ["the-bha-hotel", "the-bha-riverside"].includes(property.slug) &&
  ["The BHA Hotel", "The BHA Riverside"].includes(property.name);
const propertyName = (property: { name: string; slug: string }) =>
  ["the-bha-hotel", "the-bha-riverside"].includes(property.slug) && property.name === "The BHA Hotel" ? "The BHA Riverside" : property.name;
const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
type CreateDialog = { kind: "property" | "room" | "physical"; operationId: string; propertyId: string; roomTypeId: string; unknown: boolean };
type CreateRequest = CreatePropertyInput | CreateRoomTypeInput | CreatePhysicalRoomInput;
type PendingCreate = { actorStaffId: string; dialog: CreateDialog; request: CreateRequest };
const pendingCreateStorageKey = "bha-admin-catalog-create-pending";
const initialProperty = (name = ""): CreatePropertyInput => ({ name, slug: slugify(name), description: null, address: "", city: "", country: "", timeZone: "Asia/Ho_Chi_Minh", checkInTime: "14:00:00", checkOutTime: "12:00:00", isActive: false });
const initialRoomType = (): CreateRoomTypeInput => ({ code: "", name: "", slug: "", description: null, baseOccupancy: 1, maxOccupancy: 2, areaSquareMeters: null, bedrooms: null, bedDescription: null, isActive: false });
const initialPhysicalRoom = (): CreatePhysicalRoomInput => ({ roomNumber: "", floor: 1, operationalStatus: "Inactive" });

function CatalogPhoto({ src, alt, compact = false, retry = true }: { src: string | null; alt: string | null; compact?: boolean; retry?: boolean }) {
  return <CatalogPhotoState key={src ?? "empty"} src={src} alt={alt} compact={compact} retry={retry} />;
}

function CatalogPhotoState({ src, alt, compact, retry }: { src: string | null; alt: string | null; compact: boolean; retry: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!src || failed) return <div role="img" aria-label={alt || "Ảnh chưa tải được"} className={`flex ${compact ? "aspect-[4/3]" : "aspect-video"} w-full flex-col items-center justify-center gap-2 rounded-lg bg-gray-100 p-3 text-center text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300`}>
    <span>{failed ? "Không tải được ảnh này." : "Chưa có ảnh bìa."}</span>
    {src && failed && retry && <button type="button" className={btn} onClick={() => { setFailed(false); setAttempt(x => x + 1); }}>Tải lại ảnh</button>}

  </div>;
  return <Image key={`${src}:${attempt}`} unoptimized width={960} height={720} src={src} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} className={`w-full ${compact ? "aspect-[4/3]" : "aspect-video"} rounded-lg bg-gray-100 object-cover dark:bg-gray-800`} />;
}

export default function CatalogWorkspace() {
  const host = useWebsiteHost();
  const staff = useStaffSession();
  const actorStaffId = staff.state.status === "authenticated" ? staff.state.session.staffAccountId : "";
  const router = useRouter();
  const props = useWebsiteList(getCatalogProperties, []);
  const [owner, setOwner] = useState("");
  const [view, setView] = useState<WorkspaceView>({ kind: "list" });
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [switchPrompt, setSwitchPrompt] = useState<WorkspaceTarget | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [amenity, setAmenity] = useState({ code: "", name: "", category: "" });
  const [createDialog, setCreateDialog] = useState<CreateDialog | null>(null);
  const [propertyForm, setPropertyForm] = useState<CreatePropertyInput>(initialProperty());
  const [roomTypeForm, setRoomTypeForm] = useState<CreateRoomTypeInput>(initialRoomType());
  const [physicalRoomForm, setPhysicalRoomForm] = useState<CreatePhysicalRoomInput>(initialPhysicalRoom());
  const [createBaseline, setCreateBaseline] = useState<CreateRequest>(initialProperty());
  const [createMessage, setCreateMessage] = useState("");
  const [createDiscardPrompt, setCreateDiscardPrompt] = useState(false);
  const [createLeaveTarget, setCreateLeaveTarget] = useState<string | null>(null);
  const createModalRef = useRef<HTMLElement | null>(null);
  const activeCreateRequest: CreateRequest | null = createDialog?.kind === "property" ? propertyForm : createDialog?.kind === "room" ? roomTypeForm : createDialog?.kind === "physical" ? physicalRoomForm : null;
  const createDirty = !!activeCreateRequest && JSON.stringify(activeCreateRequest) !== JSON.stringify(createBaseline);
  const requestCreateDismiss = useCallback(() => {
    if (!createDialog || busy.current || createDialog.unknown) return;
    if (createDirty) setCreateDiscardPrompt(true);
    else setCreateDialog(null);
  }, [createDialog, createDirty]);
  const discardCreateDraft = () => {
    const target = createLeaveTarget;
    setCreateLeaveTarget(null);
    setCreateDiscardPrompt(false);
    setCreateDialog(null);
    setCreateMessage("");
    if (target) {
      if (dirty) setLeaveHref(target);
      else router.push(target);
    }
  };
  const propertyData = props.state.status === "ready" ? props.state.data : [];
  const ownerId = owner || propertyData.find(isRiversideIdentity)?.id || "@unconfigured:the-bha-riverside";
  const selected = propertyData.find(x => x.id === ownerId);
  const currentId = selected ? ownerId : "";
  const room = view.kind === "product" ? view.roomId : "";
  const isEditor = view.kind !== "list";
  const ownerKey = editorKey(currentId, room || null);
  const scope = useRef(ownerKey);
  scope.current = ownerKey;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(pendingCreateStorageKey);
      if (!raw) return;
      const pending = JSON.parse(raw) as PendingCreate;
      if (!pending?.dialog?.operationId || !["property", "room", "physical"].includes(pending.dialog.kind) || !pending.request) return;
      if (!actorStaffId || pending.actorStaffId !== actorStaffId) { sessionStorage.removeItem(pendingCreateStorageKey); return; }
      const dialog = { ...pending.dialog, unknown: true };
      setCreateDialog(dialog);
      if (dialog.kind === "property") setPropertyForm(pending.request as CreatePropertyInput);
      else if (dialog.kind === "room") setRoomTypeForm(pending.request as CreateRoomTypeInput);
      else setPhysicalRoomForm(pending.request as CreatePhysicalRoomInput);
      if (dialog.propertyId) setOwner(dialog.propertyId);
      setCreateMessage("Tìm thấy yêu cầu tạo chưa được xác minh. Hãy xác minh lại cùng yêu cầu; không tạo khóa mới.");
    } catch { /* An unreadable local recovery record cannot authorize another request. */ }
  }, [actorStaffId]);
  const data = useWebsiteList(signal => isEditor && currentId ? getCatalog(currentId, room || null, signal) : Promise.resolve({ kind: "network", message: "Chọn cơ sở đã có catalog." } as const), [currentId, room, isEditor]);
  const products = useWebsiteList(async signal => {
    if (!currentId) return { kind: "network", message: "Chọn cơ sở đã có catalog." } as const;
    const result = await getCatalogProducts(currentId, signal);
    if (result.kind !== "ok") return result;
    if (result.data.some(product => product.propertyId !== currentId)) return { kind: "invalid-response", message: "Danh sách trả về sản phẩm không thuộc cơ sở đã chọn. Hãy thử tải lại." } as const;
    return { ...result, data: { propertyId: currentId, products: result.data } };
  }, [currentId]);
  const physicalRooms = useWebsiteList(signal => view.kind === "product" && currentId
    ? getPhysicalRooms(currentId, room, signal)
    : Promise.resolve({ kind: "network", message: "Chọn loại phòng để xem danh sách phòng." } as const), [currentId, room, view.kind]);
  const load = data.reload;
  const [draftState, setDraftState] = useState<Draft | null>(null);
  const [note, setNote] = useState("");
  const [fileError, setFileError] = useState("");
  const [previewId, setPreviewId] = useState("");
  const write = useWriteAction();
  const upload = useWriteAction();
  const addWrite = useWriteAction();
  // Includes readback, unlike the POST's own status. The ref also rejects same-tick actions.
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const locked = working || host.signingOut;
  const unknown = [write, upload, addWrite].some(x => x.status.phase === "unverified");
  const blocked = locked || unknown;
  const ready = data.state.status === "ready" ? data.state.data : null;
  const base = ready && editorKey(ready.propertyId, ready.roomTypeId) === ownerKey ? ready : null;
  const serverBody = base ? bodyOf(base) : null;
  const local = draftState?.key === ownerKey ? draftState : null;
  const draft = local?.body ?? serverBody;
  const pristine = local?.baseline ?? serverBody;
  const setDraft = (next: CatalogBody | null | ((previous: CatalogBody | null) => CatalogBody | null)) => setDraftState(previous => {
    const same = previous?.key === ownerKey ? previous : null;
    const body = typeof next === "function" ? next(same?.body ?? serverBody) : next;
    return body === null ? null : { key: ownerKey, body, baseline: same?.baseline ?? serverBody! };
  });
  const replaceDraft = (fresh: CatalogEditor) => {
    const body = bodyOf(fresh);
    setDraftState({ key: editorKey(fresh.propertyId, fresh.roomTypeId), body, baseline: body });
  };
  const dirty = !!(draft && pristine && JSON.stringify(draft) !== JSON.stringify(pristine));
  const gallery = draft?.gallery ?? [];
  const matches = (fresh: CatalogEditor | null) => mounted.current && scope.current === ownerKey && fresh !== null && editorKey(fresh.propertyId, fresh.roomTypeId) === ownerKey;
  const finish = () => { busy.current = false; if (mounted.current) setWorking(false); };
  const switchTo = (target: WorkspaceTarget) => {
    const returningToSameList = target.view.kind === "list" && target.propertyId === currentId;
    setDraftState(null);
    setNote(""); setFileError(""); setPreviewId(""); setAmenity({ code: "", name: "", category: "" });
    write.reset(); upload.reset(); addWrite.reset();
    setOwner(target.propertyId); setView(target.view); setSwitchPrompt(null);
    if (returningToSameList) {
      setSummaryRefreshing(true);
      void products.reload().finally(() => setSummaryRefreshing(false));
    }
  };
  const currentViewKey = `${view.kind}:${view.kind === "product" ? view.roomId : ""}`;
  const askSwitch = (target: WorkspaceTarget) => {
    if (busy.current || blocked || switchPrompt || (target.propertyId === ownerId && `${target.view.kind}:${target.view.kind === "product" ? target.view.roomId : ""}` === currentViewKey)) return;
    if (dirty) setSwitchPrompt(target);
    else switchTo(target);
  };
  const acceptSwitch = () => { if (switchPrompt && !busy.current && !blocked) switchTo(switchPrompt); };
  const propertyChanged = (id: string) => askSwitch({ propertyId: id, roomId: "", view: { kind: "list" } });
  const openPropertyEditor = () => askSwitch({ propertyId: ownerId, roomId: "", view: { kind: "property" } });
  const openProduct = (roomId: string) => askSwitch({ propertyId: ownerId, roomId, view: { kind: "product", roomId } });
  const backToList = () => askSwitch({ propertyId: ownerId, roomId: "", view: { kind: "list" } });
  const openCreate = (kind: CreateDialog["kind"], propertyNameHint = "", roomTypeId = "") => {
    setCreateMessage("");
    setCreateDiscardPrompt(false); setCreateLeaveTarget(null);
    if (kind === "property") { const form = initialProperty(propertyNameHint); setPropertyForm(form); setCreateBaseline(form); }
    if (kind === "room") { const form = initialRoomType(); setRoomTypeForm(form); setCreateBaseline(form); }
    if (kind === "physical") { const form = initialPhysicalRoom(); setPhysicalRoomForm(form); setCreateBaseline(form); }
    setCreateDialog({ kind, operationId: crypto.randomUUID(), propertyId: currentId, roomTypeId, unknown: false });
  };
  const submitCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = createDialog;
    if (!target || busy.current || locked || (blocked && !target.unknown)) return;
    const operationId = target.operationId;
    const request = target.kind === "property" ? { ...propertyForm, checkInTime: propertyForm.checkInTime.length === 5 ? `${propertyForm.checkInTime}:00` : propertyForm.checkInTime, checkOutTime: propertyForm.checkOutTime.length === 5 ? `${propertyForm.checkOutTime}:00` : propertyForm.checkOutTime } : target.kind === "room" ? { ...roomTypeForm } : { ...physicalRoomForm };
    try { sessionStorage.setItem(pendingCreateStorageKey, JSON.stringify({ actorStaffId, dialog: target, request } satisfies PendingCreate)); }
    catch { setCreateMessage("Không thể lưu thông tin khôi phục của yêu cầu này trong trình duyệt. Chưa gửi dữ liệu; hãy bật lưu trữ phiên rồi thử lại."); return; }
    let switchAfterCreate: string | null = null;
    busy.current = true; setWorking(true); setCreateMessage("");
    addWrite.reset();
    try {
      const result = await addWrite.run<{ id: string }>(async () => {
        if (target.kind === "property") {
          const created = await createProperty(request as CreatePropertyInput, operationId);
          if (created.kind !== "ok") return created;
          const readback = await getCatalogProperties();
          return readback.kind === "ok" && readback.data.some(x => x.id === created.data.id && x.slug === created.data.slug)
            ? { kind: "ok" as const, data: { id: created.data.id } } : { kind: "unverified" as const, message: "Cơ sở đã được gửi nhưng chưa đối chiếu được từ máy chủ. Hãy xác minh lại bằng cùng yêu cầu." };
        }
        if (target.kind === "room") {
          const created = await createRoomType(target.propertyId, request as CreateRoomTypeInput, operationId);
          if (created.kind !== "ok") return created;
          const readback = await getCatalogProducts(target.propertyId);
          return readback.kind === "ok" && readback.data.some(x => x.roomTypeId === created.data.roomTypeId && x.code === created.data.code)
            ? { kind: "ok" as const, data: { id: created.data.roomTypeId } } : { kind: "unverified" as const, message: "Loại phòng đã được gửi nhưng chưa đối chiếu được danh sách. Hãy xác minh lại bằng cùng yêu cầu." };
        }
        const created = await createPhysicalRoom(target.propertyId, target.roomTypeId, request as CreatePhysicalRoomInput, operationId);
        if (created.kind !== "ok") return created;
        const readback = await getPhysicalRooms(target.propertyId, target.roomTypeId);
        return readback.kind === "ok" && readback.data.some(x => x.id === created.data.id && x.roomNumber === created.data.roomNumber)
          ? { kind: "ok" as const, data: { id: created.data.id } } : { kind: "unverified" as const, message: "Phòng đã được gửi nhưng chưa đối chiếu được danh sách. Hãy xác minh lại bằng cùng yêu cầu." };
      });
      if (!mounted.current) return;
      if (result?.kind === "ok") {
        sessionStorage.removeItem(pendingCreateStorageKey);
        setCreateDialog(null); setCreateMessage("");
        if (target.kind === "property") { await props.reload(); switchAfterCreate = result.data.id; }
        else if (target.kind === "room") { await products.reload(); switchAfterCreate = target.propertyId; }
        else { await physicalRooms.reload(); await products.reload(); }
      } else if (result) {
        const message = result.kind === "refused" ? result.detail : describeFailure(result);
        setCreateMessage(message);
        if (result.kind === "unverified" || result.kind === "network" || result.kind === "invalid-response" || result.kind === "error") setCreateDialog(x => x ? { ...x, unknown: true } : x);
        else sessionStorage.removeItem(pendingCreateStorageKey);
      }
    } finally { busy.current = false; if (mounted.current) setWorking(false); if (switchAfterCreate) queueMicrotask(() => askSwitch({ propertyId: switchAfterCreate!, roomId: "", view: { kind: "list" } })); }
  };
  useEffect(() => { host.setUnsaved(dirty || createDirty || working || unknown); return () => host.setUnsaved(false); }, [dirty, createDirty, working, unknown, host]);
  useEffect(() => {
    if (!dirty && !createDirty && !locked && !unknown) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      event.preventDefault(); event.stopPropagation();
      if (!busy.current && !unknown) {
        const target = `${url.pathname}${url.search}${url.hash}`;
        if (createDirty) { setCreateLeaveTarget(target); setCreateDiscardPrompt(true); }
        else setLeaveHref(target);
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", navigate, true); };
  }, [dirty, createDirty, locked, unknown]);
  const change = <K extends keyof CatalogBody>(key: K, value: CatalogBody[K]) => {
    if (busy.current || blocked) return;
    setDraft(x => x ? { ...x, [key]: value } : x);
  };
  const imageSource = (item: GalleryItem) => base ? catalogImage(base.propertyId, base.roomTypeId, item.mediaId) : null;
  const doSave = async (): Promise<boolean> => {
    if (!base || !draft || busy.current || blocked) return false;
    if (draft.name.trim().length === 0 || draft.name.length > 200 || (draft.description?.length ?? 0) > 4000 || gallery.some(x => (x.altText?.length ?? 0) > 500) || (base.roomTypeId !== null && (draft.areaSquareMeters !== null && (!Number.isFinite(draft.areaSquareMeters) || draft.areaSquareMeters <= 0 || draft.areaSquareMeters > 10000) || draft.bedrooms !== null && (!Number.isInteger(draft.bedrooms) || draft.bedrooms < 0 || draft.bedrooms > 100)))) { setNote("Hãy kiểm tra trường bắt buộc và giới hạn độ dài/số đo trước khi lưu."); return false; }
    const body = { ...draft }; // Revision belongs to the draft snapshot, never the latest background read.
    busy.current = true; setWorking(true);
    try {
      const result = await write.run(async () => {
        const saved = await saveCatalog(base.propertyId, base.roomTypeId, body);
        if (saved.kind !== "ok") return saved;
        const fresh = await load(); // Hold the host's slot (including Sign out) through readback.
        return matches(fresh) && editorKey(saved.data.propertyId, saved.data.roomTypeId) === ownerKey && fresh!.version >= saved.data.version
          ? { kind: "ok" as const, data: fresh! }
          : { kind: "unverified" as const, message: "Máy chủ đã nhận Lưu nhưng chưa đối chiếu được dữ liệu. Đọc lại trước khi tiếp tục; không gửi lại Lưu cũ." };
      });
      if (!mounted.current || scope.current !== ownerKey) return false;
      if (result?.kind === "ok") { replaceDraft(result.data); setNote("Đã lưu và đọc lại nội dung từ máy chủ."); return true; }
      if (result) setNote(result.kind === "refused" ? `${result.detail}${result.status === 409 ? " Tải lại để xem phiên bản mới; nội dung đang sửa vẫn được giữ." : ""}` : describeFailure(result));
      return false;
    } finally { finish(); }
  };
  const readAgain = async () => {
    if (busy.current || locked || !host.beginWrite()) return;
    const unknownUpload = upload.status.phase === "unverified";
    busy.current = true; setWorking(true);
    try {
      const fresh = await load();
      if (!matches(fresh)) return; // Failed, superseded or wrong owner never resolves unknown.
      replaceDraft(fresh!); write.reset(); upload.reset(); addWrite.reset(); setFileError("");
      setNote(unknownUpload
        ? "Đã đối chiếu gallery đã lưu. Kết quả ảnh tải lên cũ chưa xác định: ảnh có thể đã được tạo nhưng chưa gắn; không tự tải lại ảnh cũ. Bạn có thể chủ động chọn ảnh khác hoặc tiếp tục sửa."
        : "Đã đồng bộ phiên bản từ máy chủ.");
    } finally { host.endWrite(); finish(); }
  };
  const uploadFile = async (file: File | undefined) => {
    if (!file || !base || busy.current || blocked) return;
    if (file.size > 10 * 1024 * 1024) { setFileError("Ảnh vượt quá 10 MB."); return; }
    busy.current = true; setWorking(true);
    try {
      const result = await upload.run(() => uploadCatalog(base.propertyId, base.roomTypeId, file));
      if (!mounted.current || scope.current !== ownerKey) return;
      if (result?.kind === "ok") { setDraft(x => x ? { ...x, gallery: [...x.gallery, { ...result.data, isCover: x.gallery.length === 0 }] } : x); setFileError(""); setPreviewId(result.data.mediaId); }
      else if (result) setFileError(result.kind === "refused" ? result.detail : describeFailure(result));
    } finally { finish(); }
  };
  const move = (index: number, delta: number) => {
    if (!draft) return; const next = [...gallery]; const target = index + delta; if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; change("gallery", next);
  };
  const setCover = (id: string) => change("gallery", gallery.map(x => ({ ...x, isCover: x.mediaId === id })));
  const remove = (id: string) => change("gallery", removeImage(gallery, id));
  const addAmenity = async () => {
    if (!selected || busy.current || blocked || !amenity.name.trim() || !amenity.code.trim() || !amenity.category.trim()) return;
    busy.current = true; setWorking(true);
    try {
      const result = await addWrite.run(async () => {
        const added = await createAmenity(selected.id, amenity);
        if (added.kind !== "ok") return added;
        const fresh = await load();
        return matches(fresh) ? added : { kind: "unverified" as const, message: "Tiện nghi đã được tạo nhưng chưa đọc lại được danh sách. Đọc lại trước khi tiếp tục." };
      });
      if (!mounted.current || scope.current !== ownerKey) return;
      if (result?.kind === "ok") { setDraft(x => x ? { ...x, amenityIds: [...x.amenityIds, result.data.id] } : x); setAmenity({ code: "", name: "", category: "" }); }
      else if (result) setNote(result.kind === "refused" ? result.detail : describeFailure(result));
    } finally { finish(); }
  };
  useEffect(() => {
    if (!switchPrompt && !leaveHref) return;
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const previous = document.activeElement as HTMLElement | null;
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy.current) { setSwitchPrompt(null); setLeaveHref(null); }
      if (event.key === "Tab") {
        const buttons = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [switchPrompt, leaveHref]);
  useEffect(() => {
    if (!createDialog || createDiscardPrompt) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = createModalRef.current;
    dialog?.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy.current && !createDialog.unknown) requestCreateDismiss();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog?.querySelectorAll<HTMLElement>("input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),[href]") ?? []);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [createDialog, createDiscardPrompt, createDirty, requestCreateDismiss]);
  useEffect(() => {
    if (!createDiscardPrompt) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[data-create-discard]");
    const buttons = () => Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    buttons()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setCreateDiscardPrompt(false); setCreateLeaveTarget(null); }
      if (event.key !== "Tab") return;
      const controls = buttons();
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [createDiscardPrompt]);
  if (props.state.status !== "ready") return <section role={props.state.status === "error" ? "alert" : "status"} className="rounded-2xl border border-gray-200 bg-white p-6 text-sm dark:border-gray-800 dark:bg-white/[0.03]">{props.state.status === "error" ? <>{props.state.message} <button className={btn} onClick={() => void props.reload()}>Thử lại</button></> : "Đang tải danh sách cơ sở…"}</section>;
  const propertyChoices = props.state.data;
  const hasRiverside = propertyChoices.some(isRiversideIdentity);
  const productList = products.state.status === "ready" && products.state.data.propertyId === currentId ? products.state.data.products : null;
  const listLoading = summaryRefreshing || products.state.status === "loading" || (products.state.status === "ready" && productList === null);
  const legacySamples = selected && isRiversideIdentity(selected) ? (productList ?? []).filter(x => ["DLX-KING", "FAMILY"].includes(x.code)) : [];
  const productsToShow = (productList ?? []).filter(x => !legacySamples.some(sample => sample.roomTypeId === x.roomTypeId));
  return <div className="flex min-w-0 flex-col gap-5 text-gray-900 dark:text-gray-100" data-testid="catalog-workspace">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{view.kind === "list" ? "Cơ sở & loại phòng" : view.kind === "property" ? "Thông tin cơ sở" : "Chi tiết sản phẩm"}</h1><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{view.kind === "list" ? "Chọn cơ sở để xem các loại phòng; thông tin vận hành và giá được giữ nguyên." : "Sửa nội dung, tiện nghi và thư viện ảnh; thông tin vận hành và giá được giữ nguyên."}</p></div>{isEditor && <button type="button" className={btn} onClick={backToList} disabled={blocked}>← Quay lại danh sách</button>}</header>
    <fieldset disabled={blocked} className="grid min-w-0 gap-4 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] dark:border-gray-800 dark:bg-white/[0.03]">
      <label className="min-w-0 text-sm font-medium text-gray-800 dark:text-gray-200">Cơ sở<select aria-label="Cơ sở" data-testid="property-select" className={`${box} mt-1`} value={ownerId} onChange={e => propertyChanged(e.target.value)}>{propertyChoices.map(p => <option className="bg-white text-gray-900 dark:bg-gray-900 dark:text-white" value={p.id} key={p.id}>{propertyName(p)}</option>)}{!hasRiverside && <option className="bg-white text-gray-900 dark:bg-gray-900 dark:text-white" value="@unconfigured:the-bha-riverside">The BHA Riverside — chưa thiết lập</option>}{[ ["the-bha-house", "The BHA House"], ["the-bha-villa", "The BHA Villa"] ].filter(([slug]) => !propertyChoices.some(p => p.slug === slug)).map(([slug, label]) => <option className="bg-white text-gray-900 dark:bg-gray-900 dark:text-white" value={"@unconfigured:" + slug} key={slug}>{label} — chưa thiết lập</option>)}</select></label>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        {selected && <button type="button" className={btn} onClick={openPropertyEditor} disabled={blocked}>Chỉnh sửa thông tin cơ sở</button>}
        <button type="button" className={btn} onClick={() => openCreate("property", !selected && ownerId.startsWith("@unconfigured:") ? (ownerId.endsWith("the-bha-house") ? "The BHA House" : ownerId.endsWith("the-bha-villa") ? "The BHA Villa" : "The BHA Riverside") : "")} disabled={blocked}>Thêm cơ sở</button>
        <button type="button" className={btn} onClick={() => openCreate("room")} disabled={blocked || !selected} title={!selected ? "Chọn hoặc tạo cơ sở đã lưu trước." : undefined}>Thêm loại phòng</button>
        <button type="button" className={btn} onClick={() => openCreate("physical", "", view.kind === "product" ? room : "")} disabled={blocked || !selected || (productList?.length ?? 0) === 0} title={!selected ? "Chọn cơ sở đã lưu trước." : (productList?.length ?? 0) === 0 ? "Tạo loại phòng trước." : undefined}>Thêm phòng</button>
      </div>
      {!selected && <p role="status" className="self-center text-sm text-gray-600 dark:text-gray-300">Cơ sở này chưa thiết lập catalog. Chưa có nội dung để sửa.</p>}
    </fieldset>
    {view.kind === "list" && selected && <section aria-label="Danh sách sản phẩm" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-xl font-semibold text-gray-900 dark:text-white">{propertyName(selected)}</h2><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{listLoading ? "Đang tải sản phẩm…" : `${productsToShow.length} loại phòng`}</p></div>{products.state.status === "error" && <button type="button" className={btn} onClick={() => void products.reload()}>Thử lại</button>}</div>
      {products.state.status === "error" ? <p role="alert" className="rounded-xl border border-error-200 bg-error-50 p-4 text-sm text-error-800 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-200">{products.state.message}</p> : listLoading ? <p role="status" className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">Đang tải danh sách sản phẩm…</p> : productList?.length === 0 ? <p role="status" className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">Cơ sở này chưa có loại phòng để hiển thị.</p> : <>
        {productsToShow.length > 0 && <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">{productsToShow.map(product => <ProductCard key={product.roomTypeId} product={product} propertyId={currentId} onOpen={() => openProduct(product.roomTypeId)} />)}</div>}
        {legacySamples.length > 0 && <details className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]"><summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">Dữ liệu mẫu cũ ({legacySamples.length})</summary><p className="my-3 text-sm text-gray-600 dark:text-gray-300">Deluxe King và Family Suite là loại phòng mẫu cũ; dữ liệu và lịch sử hiện có được giữ riêng.</p><div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">{legacySamples.map(product => <ProductCard key={product.roomTypeId} product={product} propertyId={currentId} onOpen={() => openProduct(product.roomTypeId)} />)}</div></details>}
      </>}
    </section>}
    {isEditor && !selected ? <p role="status" className="text-sm text-gray-600 dark:text-gray-300">Cơ sở này chưa thiết lập catalog.</p> : isEditor && data.state.status === "loading" ? <p role="status" className="text-sm text-gray-600 dark:text-gray-300">Đang tải catalog…</p> : isEditor && data.state.status === "error" ? <p role="alert" className="text-sm text-error-700 dark:text-error-300">{data.state.message} <button className={btn} onClick={() => void readAgain()}>Thử lại</button></p> : isEditor && !base ? <p role="status" className="text-sm text-gray-600 dark:text-gray-300">Đang mở sản phẩm…</p> : isEditor && base && draft ? <fieldset disabled={blocked} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300"><span>{base.roomTypeId ? `${base.code} · ${base.physicalRoomCount} phòng vật lý · sức chứa ${base.baseOccupancy}–${base.maxOccupancy}` : `${base.slug} · ${base.physicalRoomCount} phòng vật lý`} · {base.isActive ? "Đang hoạt động" : "Ngừng hoạt động"} · giờ {base.checkInTime} / {base.checkOutTime} · {base.timeZone} · phiên bản bản sửa {draft.expectedVersion}</span><button disabled={!dirty || locked} className={btn} onClick={() => void readAgain()}>Bỏ sửa và tải lại</button></div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
        <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]" aria-label="Thông tin catalog">
          <h2 className="text-lg font-semibold">{base.roomTypeId ? "Loại phòng" : "Cơ sở"}</h2>
{base.translationOverrideKeys.length > 0 && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Có bản dịch riêng cho trường nội dung này. Chúng được giữ nguyên và vẫn có thể ghi đè nội dung nguồn trên Customer Web; xem màn Bản dịch để chỉnh từng ngôn ngữ.</p>}
          <Field label="Tên" value={draft.name} max={200} onChange={v => change("name", v)} required />
          <Field label={`Mô tả (${base.sourceLocale})`} value={draft.description ?? ""} max={4000} area onChange={v => change("description", v || null)} />
          {base.roomTypeId ? <><Field label="Diện tích (m²)" type="number" value={draft.areaSquareMeters ?? ""} onChange={v => change("areaSquareMeters", v === "" ? null : Number(v))} /><Field label="Số phòng ngủ" type="number" value={draft.bedrooms ?? ""} onChange={v => change("bedrooms", v === "" ? null : Number(v))} /><Field label="Thông tin giường" value={draft.bedDescription ?? ""} max={500} onChange={v => change("bedDescription", v || null)} /></> : <><Field label="Địa chỉ" value={draft.address ?? ""} max={500} onChange={v => change("address", v)} /><Field label="Thành phố" value={draft.city ?? ""} max={120} onChange={v => change("city", v)} /><Field label="Quốc gia" value={draft.country ?? ""} max={120} onChange={v => change("country", v)} /></>}
          <div><h3 className="mb-2 text-sm font-medium">Tiện nghi</h3><div className="grid gap-2 sm:grid-cols-2">{base.amenities.map(a => <label key={a.id} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2 text-sm dark:border-gray-800"><input type="checkbox" checked={draft.amenityIds.includes(a.id)} onChange={e => change("amenityIds", e.target.checked ? [...draft.amenityIds, a.id] : draft.amenityIds.filter(x => x !== a.id))} />{a.name} <span className="text-xs text-gray-400">{a.category}</span></label>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-3">{(["code", "name", "category"] as const).map(k => <input key={k} className={box} placeholder={{ code: "Mã tiện nghi", name: "Tên tiện nghi", category: "Nhóm" }[k]} aria-label={{ code: "Mã tiện nghi", name: "Tên tiện nghi", category: "Nhóm" }[k]} value={amenity[k]} onChange={e => { if (!busy.current && !blocked) setAmenity(x => ({ ...x, [k]: e.target.value })); }} />)}</div><button className={`${btn} mt-2`} disabled={locked || !amenity.code || !amenity.name || !amenity.category} onClick={() => void addAmenity()}>Thêm tiện nghi</button></div>
        </section>
        <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]" aria-label="Thư viện ảnh">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Ảnh ({gallery.length})</h2><label className={`${btn} cursor-pointer`}>Tải ảnh lên<input aria-label="Tải ảnh lên" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={e => { void uploadFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label></div>
          {fileError && <p role="alert" className="text-sm text-error-700 dark:text-error-300">{fileError}</p>}
          {gallery.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">Chưa có ảnh. Gallery rỗng không có ảnh bìa.</p> : <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{gallery.map((item, i) => { const src = imageSource(item); return <li key={`${ownerKey}:${item.mediaId}`} className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"><CatalogPhoto src={src} alt={item.altText} /><button type="button" className="mt-2 text-xs font-medium text-brand-600 underline hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200" onClick={() => setPreviewId(item.mediaId)}>Xem trước ảnh</button><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"><input type="radio" name="cover" checked={item.isCover} onChange={() => setCover(item.mediaId)} />Ảnh bìa</label><div className="flex flex-wrap gap-1"><button className={btn} aria-label={`Đưa ảnh ${i + 1} lên`} disabled={i === 0 || locked} onClick={() => move(i, -1)}>↑</button><button className={btn} aria-label={`Đưa ảnh ${i + 1} xuống`} disabled={i === gallery.length - 1 || locked} onClick={() => move(i, 1)}>↓</button><button className={btn} disabled={locked} onClick={() => remove(item.mediaId)}>Gỡ ảnh</button></div></div><label className="mt-2 block text-xs text-gray-700 dark:text-gray-300">Mô tả ảnh (alt)<input className={`${box} mt-1`} maxLength={500} value={item.altText ?? ""} onChange={e => change("gallery", gallery.map(x => x.mediaId === item.mediaId ? { ...x, altText: e.target.value } : x))} /></label></li>; })}</ul>}
          <div className="rounded-xl border border-brand-200 bg-gray-50 p-4 text-gray-900 dark:border-brand-700 dark:bg-gray-900 dark:text-white"><h3 className="mb-2 font-medium">Xem trước bản đang sửa</h3>{gallery.length ? <><CatalogPhoto src={imageSource(gallery.find(x => x.mediaId === previewId) ?? gallery.find(x => x.isCover) ?? gallery[0])} alt={gallery.find(x => x.mediaId === previewId)?.altText ?? gallery.find(x => x.isCover)?.altText ?? ""} /><p className="mt-2 font-semibold">{draft.name}</p><p className="text-sm text-gray-700 dark:text-gray-300">{draft.description || "Chưa có mô tả"}</p><p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{base.amenities.filter(a => draft.amenityIds.includes(a.id)).map(a => a.name).join(" · ")}</p></> : <><p className="font-semibold">{draft.name}</p><p className="text-sm text-gray-700 dark:text-gray-300">{draft.description || "Chưa có mô tả"}</p></>}</div>
        </section>
      </div>
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"><button className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!dirty || locked || write.status.phase === "unverified" || !gallery.every(x => x.altText == null || x.altText.length <= 500)} onClick={() => void doSave()}>{locked ? "Đang lưu…" : "Lưu thay đổi"}</button><span className="text-sm" role={note ? "status" : undefined}>{note || (dirty ? "Có thay đổi chưa lưu." : "Đã đồng bộ với máy chủ.")}</span></section>
    </fieldset> : null}

    {view.kind === "product" && selected && <section aria-labelledby="physical-room-heading" className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="physical-room-heading" className="text-lg font-semibold">Phòng thuộc loại này</h2><p className="text-sm text-gray-600 dark:text-gray-300">{base ? base.name : "Đang tải loại phòng…"} · phòng thực tế từ máy chủ</p></div><button type="button" className={btn} onClick={() => void physicalRooms.reload()} disabled={working}>Tải lại</button></div>
      {physicalRooms.state.status === "loading" ? <p role="status" className="mt-3 text-sm text-gray-600 dark:text-gray-300">Đang tải phòng…</p>
        : physicalRooms.state.status === "error" ? <p role="alert" className="mt-3 text-sm text-error-700 dark:text-error-300">{physicalRooms.state.message} <button type="button" className={btn} onClick={() => void physicalRooms.reload()}>Thử lại</button></p>
        : physicalRooms.state.data.length === 0 ? <p role="status" className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">Loại phòng này chưa có phòng thực tế. Dùng “Thêm phòng” phía trên để tạo.</p>
        : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead className="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"><tr><th className="p-2">Số phòng</th><th className="p-2">Tầng</th><th className="p-2">Trạng thái</th></tr></thead><tbody>{physicalRooms.state.data.map(x => <tr key={x.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800"><td className="p-2 font-medium">{x.roomNumber}</td><td className="p-2">{x.floor}</td><td className="p-2">{x.operationalStatus === "Active" ? "Đang hoạt động" : x.operationalStatus === "Inactive" ? "Ngừng hoạt động" : "Ngoài khai thác"}</td></tr>)}</tbody></table></div>}
    </section>}

    {unknown && <button disabled={locked} className={btn} onClick={() => void readAgain()}>Đọc lại trước khi tiếp tục</button>}
    {leaveHref && <div role="dialog" aria-modal="true" aria-labelledby="leave-title" className="fixed inset-0 z-99999 flex items-center justify-center bg-black/60 p-4"><section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-white"><h2 id="leave-title" className="text-lg font-semibold">Rời màn hình?</h2><p className="my-3 text-sm text-gray-700 dark:text-gray-300">Có nội dung chưa lưu. Bạn có thể lưu, bỏ nội dung sửa, hoặc tiếp tục ở lại.</p><div className="flex flex-wrap justify-end gap-2"><button className={btn} disabled={locked} onClick={() => { if (!busy.current) setLeaveHref(null); }}>Tiếp tục sửa</button><button className={btn} disabled={locked} onClick={() => void doSave().then(ok => { if (ok && leaveHref) { const target = leaveHref; setLeaveHref(null); router.push(target); } })}>Lưu rồi rời</button><button className="rounded-lg bg-brand-500 px-3 py-2 text-sm text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50" disabled={locked} onClick={() => { if (busy.current) return; const target = leaveHref; setLeaveHref(null); if (target) router.push(target); }}>Bỏ sửa và rời</button></div></section></div>}
    {switchPrompt && <div role="dialog" aria-modal="true" aria-labelledby="switch-title" className="fixed inset-0 z-99999 flex items-center justify-center bg-black/60 p-4"><section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-white"><h2 id="switch-title" className="text-lg font-semibold">Rời phần đang sửa?</h2><p className="my-3 text-sm text-gray-700 dark:text-gray-300">Có thay đổi chưa lưu. Bạn có thể lưu trước, bỏ phần sửa, hoặc tiếp tục chỉnh sửa.</p><div className="flex flex-wrap justify-end gap-2"><button className={btn} data-testid="switch-keep" disabled={locked} onClick={() => { if (!busy.current) setSwitchPrompt(null); }}>Tiếp tục sửa</button><button className={btn} onClick={() => void doSave().then(ok => { if (ok && switchPrompt) switchTo(switchPrompt); })} disabled={locked}>Lưu rồi chuyển</button><button className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50" disabled={locked} onClick={acceptSwitch}>{switchPrompt.view.kind === "list" ? "Bỏ sửa và về danh sách" : "Bỏ sửa và chuyển"}</button></div></section></div>}
    {createDialog && <div className="fixed inset-0 z-99999 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onMouseDown={e => { if (e.target === e.currentTarget) requestCreateDismiss(); }}>
      <section ref={createModalRef} role="dialog" aria-modal="true" aria-labelledby="create-title" className="my-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
        <h2 id="create-title" className="text-xl font-semibold">{createDialog.kind === "property" ? "Thêm cơ sở" : createDialog.kind === "room" ? "Thêm loại phòng" : "Thêm phòng thực tế"}</h2>
        {createDialog.kind !== "property" && <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Cơ sở cha: <strong>{selected ? propertyName(selected) : "—"}</strong></p>}
        {createDialog.unknown && <p role="status" className="mt-3 rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-200">{createMessage || "Kết quả chưa xác định. Giữ nguyên nội dung và khóa để xác minh."}</p>}
        <form className="mt-4 space-y-4" onSubmit={submitCreate}>
          <fieldset disabled={working || createDialog.unknown || (createDialog.kind !== "property" && !selected)} className="space-y-3">
          {createDialog.kind === "property" && <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Tên cơ sở *<input required maxLength={200} className={box + " mt-1"} value={propertyForm.name} onChange={e => setPropertyForm(x => ({...x,name:e.target.value,slug:x.slug===slugify(x.name)?slugify(e.target.value):x.slug}))} /></label>
            <label className="text-sm">Slug *<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={200} className={box + " mt-1"} value={propertyForm.slug} onChange={e => setPropertyForm(x => ({...x,slug:e.target.value.toLowerCase()}))} /></label>
            <label className="text-sm sm:col-span-2">Mô tả<textarea maxLength={4000} rows={2} className={box + " mt-1"} value={propertyForm.description ?? ""} onChange={e => setPropertyForm(x => ({...x,description:e.target.value||null}))} /></label>
            <label className="text-sm sm:col-span-2">Địa chỉ *<input required maxLength={500} className={box + " mt-1"} value={propertyForm.address} onChange={e => setPropertyForm(x => ({...x,address:e.target.value}))} /></label>
            <label className="text-sm">Thành phố *<input required maxLength={120} className={box + " mt-1"} value={propertyForm.city} onChange={e => setPropertyForm(x => ({...x,city:e.target.value}))} /></label>
            <label className="text-sm">Quốc gia *<input required maxLength={120} className={box + " mt-1"} value={propertyForm.country} onChange={e => setPropertyForm(x => ({...x,country:e.target.value}))} /></label>
            <label className="text-sm">Múi giờ *<input required maxLength={100} className={box + " mt-1"} value={propertyForm.timeZone} onChange={e => setPropertyForm(x => ({...x,timeZone:e.target.value}))} /><small className="block text-gray-500 dark:text-gray-400">Mã múi giờ IANA; mặc định chỉnh được.</small></label>
            <label className="text-sm">Giờ nhận phòng *<input required type="time" className={box + " mt-1"} value={propertyForm.checkInTime} onChange={e => setPropertyForm(x => ({...x,checkInTime:e.target.value}))} /></label>
            <label className="text-sm">Giờ trả phòng *<input required type="time" className={box + " mt-1"} value={propertyForm.checkOutTime} onChange={e => setPropertyForm(x => ({...x,checkOutTime:e.target.value}))} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={propertyForm.isActive} onChange={e => setPropertyForm(x => ({...x,isActive:e.target.checked}))} />Đang hoạt động (mặc định tắt)</label>
          </div>}
          {createDialog.kind === "room" && <div className="grid gap-3 sm:grid-cols-2">
            <p className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800 sm:col-span-2">Cơ sở cha: {selected ? propertyName(selected) : "—"}</p>
            <label className="text-sm">Mã loại phòng *<input required maxLength={50} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" className={box + " mt-1 uppercase"} value={roomTypeForm.code} onChange={e => setRoomTypeForm(x => ({...x,code:e.target.value.toUpperCase()}))} /></label>
            <label className="text-sm">Tên *<input required maxLength={200} className={box + " mt-1"} value={roomTypeForm.name} onChange={e => setRoomTypeForm(x => ({...x,name:e.target.value,slug:x.slug===slugify(x.name)?slugify(e.target.value):x.slug}))} /></label>
            <label className="text-sm">Slug *<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={200} className={box + " mt-1"} value={roomTypeForm.slug} onChange={e => setRoomTypeForm(x => ({...x,slug:e.target.value.toLowerCase()}))} /></label>
            <label className="text-sm">Mô tả<textarea maxLength={4000} className={box + " mt-1"} value={roomTypeForm.description ?? ""} onChange={e => setRoomTypeForm(x => ({...x,description:e.target.value||null}))} /></label>
            <label className="text-sm">Sức chứa tiêu chuẩn *<input required type="number" min={1} step={1} className={box + " mt-1"} value={roomTypeForm.baseOccupancy} onChange={e => setRoomTypeForm(x => ({...x,baseOccupancy:Number(e.target.value)}))} /></label>
            <label className="text-sm">Sức chứa tối đa *<input required type="number" min={1} step={1} className={box + " mt-1"} value={roomTypeForm.maxOccupancy} onChange={e => setRoomTypeForm(x => ({...x,maxOccupancy:Number(e.target.value)}))} /></label>
            <label className="text-sm">Diện tích (m²)<input type="number" min={0.01} max={10000} step="0.01" className={box + " mt-1"} value={roomTypeForm.areaSquareMeters ?? ""} onChange={e => setRoomTypeForm(x => ({...x,areaSquareMeters:e.target.value?Number(e.target.value):null}))} /></label>
            <label className="text-sm">Phòng ngủ trong căn<input type="number" min={0} max={100} step={1} className={box + " mt-1"} value={roomTypeForm.bedrooms ?? ""} onChange={e => setRoomTypeForm(x => ({...x,bedrooms:e.target.value?Number(e.target.value):null}))} /></label>
            <label className="text-sm sm:col-span-2">Mô tả giường<input maxLength={500} className={box + " mt-1"} value={roomTypeForm.bedDescription ?? ""} onChange={e => setRoomTypeForm(x => ({...x,bedDescription:e.target.value||null}))} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roomTypeForm.isActive} onChange={e => setRoomTypeForm(x => ({...x,isActive:e.target.checked}))} />Đang hoạt động (mặc định tắt; chưa tự mở bán)</label>
          </div>}
          {createDialog.kind === "physical" && <>
            <label className="block text-sm">Loại phòng cha *<select required className={box + " mt-1"} value={createDialog.roomTypeId} onChange={e => setCreateDialog(x => x ? {...x,roomTypeId:e.target.value}:x)}><option value="">Chọn loại phòng</option>{(productList ?? []).map(x => <option key={x.roomTypeId} value={x.roomTypeId}>{x.code} · {x.name}</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Số phòng *<input required maxLength={50} className={box + " mt-1"} value={physicalRoomForm.roomNumber} onChange={e => setPhysicalRoomForm(x => ({...x,roomNumber:e.target.value}))} /></label>
              <label className="text-sm">Tầng *<input required type="number" step={1} className={box + " mt-1"} value={physicalRoomForm.floor} onChange={e => setPhysicalRoomForm(x => ({...x,floor:Number(e.target.value)}))} /></label>
              <label className="text-sm sm:col-span-2">Trạng thái vận hành<select className={box + " mt-1"} value={physicalRoomForm.operationalStatus} onChange={e => setPhysicalRoomForm(x => ({...x,operationalStatus:e.target.value as CreatePhysicalRoomInput["operationalStatus"]}))}><option value="Inactive">Ngừng hoạt động</option><option value="Active">Đang hoạt động</option><option value="OutOfService">Ngoài khai thác</option></select><small className="block text-gray-500 dark:text-gray-400">Mặc định ngừng hoạt động. Chỉ phòng Active tham gia nguồn phòng theo nghiệp vụ hiện hành.</small></label>
            </div>
          </>}
          </fieldset>
          {createMessage && !createDialog.unknown && <p role="alert" className="rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-800 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-200">{createMessage}</p>}
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700"><button type="button" className={btn} disabled={working || createDialog.unknown} onClick={requestCreateDismiss}>Hủy</button><button type="submit" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={working || host.signingOut || (createDialog.kind !== "property" && !selected)}>{working ? "Đang lưu và xác minh…" : createDialog.unknown ? "Xác minh lại cùng yêu cầu" : "Tạo"}</button></div>
        </form>
      </section>
    </div>}

    {createDiscardPrompt && createDialog && <div className="fixed inset-0 z-100000 flex items-center justify-center bg-black/70 p-4">
      <section data-create-discard role="alertdialog" aria-modal="true" aria-labelledby="create-discard-title" className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-white">
        <h2 id="create-discard-title" className="text-lg font-semibold">Bỏ thông tin đang nhập?</h2>
        <p className="my-3 text-sm text-gray-700 dark:text-gray-300">Biểu mẫu chưa được gửi. Nếu bỏ, dữ liệu đang nhập sẽ mất và chưa có thay đổi nào được lưu.</p>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className={btn} onClick={() => { setCreateDiscardPrompt(false); setCreateLeaveTarget(null); }}>Tiếp tục nhập</button><button type="button" className="rounded-lg bg-error-600 px-3 py-2 text-sm font-semibold text-white hover:bg-error-700 focus-visible:outline-2 focus-visible:outline-error-500" onClick={discardCreateDraft}>{createLeaveTarget ? "Bỏ bản nháp và rời" : "Bỏ bản nháp"}</button></div>
      </section>
    </div>}

  </div>;
}

function Field({ label, value, onChange, max, area, type = "text", required = false }: { label: string; value: string | number; onChange: (x: string) => void; max?: number; area?: boolean; type?: string; required?: boolean }) {
  return <label className="block min-w-0 text-sm font-medium text-gray-800 dark:text-gray-200">{label}{required && <span className="text-error-600 dark:text-error-400"> *</span>}{area ? <textarea required={required} maxLength={max} rows={4} className={`${box} mt-1`} value={value} onChange={e => onChange(e.target.value)} /> : <input required={required} type={type} min={type === "number" ? 0 : undefined} maxLength={max} max={type === "number" ? 10000 : undefined} step={type === "number" ? "0.01" : undefined} className={`${box} mt-1`} value={value} onChange={e => onChange(e.target.value)} />}{max && <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">{String(value).length}/{max}</span>}</label>;
}

function ProductCard({ product, propertyId, onOpen }: { product: CatalogProductSummary; propertyId: string; onOpen: () => void }) {
  const source = product.coverMediaId ? catalogImage(propertyId, product.roomTypeId, product.coverMediaId) : null;
  return <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-sm dark:border-gray-800 dark:bg-white/[0.03]">
    <div className="p-3"><CatalogPhoto src={source} alt={product.coverAltText} compact /></div>
    <div className="flex min-w-0 flex-1 flex-col p-4 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">{product.code}</span><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${product.isActive ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>{product.isActive ? "Đang hoạt động" : "Ngừng hoạt động"}</span></div>
      <h3 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">{product.name}</h3>
      <p className="mt-1 min-h-10 text-sm text-gray-600 dark:text-gray-300">{product.description || "Chưa có mô tả."}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-gray-200 pt-3 text-sm dark:border-gray-800"><div><dt className="text-gray-600 dark:text-gray-400">Sức chứa</dt><dd className="font-medium text-gray-900 dark:text-gray-100">{product.baseOccupancy}–{product.maxOccupancy} khách</dd></div><div><dt className="text-gray-600 dark:text-gray-400">Phòng vật lý</dt><dd className="font-medium text-gray-900 dark:text-gray-100">{product.physicalRoomCount}</dd></div><div><dt className="text-gray-600 dark:text-gray-400">Ảnh</dt><dd className="font-medium text-gray-900 dark:text-gray-100">{product.galleryCount}</dd></div></dl>
      <button type="button" className="mt-4 w-full rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50" onClick={onOpen}>Xem / Chỉnh sửa</button>
    </div>
  </article>;
}
