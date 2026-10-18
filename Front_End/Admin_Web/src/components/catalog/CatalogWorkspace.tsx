"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useWebsiteHost } from "@/components/website/WebsiteAccessGate";
import { useWebsiteList, useWriteAction, describeFailure } from "@/components/website/useWebsiteData";
import { createAmenity, getCatalog, getCatalogProperties, saveCatalog, uploadCatalog, catalogImage, bodyOf, removeImage, type CatalogBody, type CatalogEditor, type GalleryItem } from "@/lib/api/catalog";

const box = "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2.5 text-sm dark:border-gray-700 dark:text-white";
const btn = "rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-white/5";
const editorKey = (p: string, r: string | null) => `${p}:${r ?? "property"}`;
type Draft = { key: string; body: CatalogBody; baseline: CatalogBody };

export default function CatalogWorkspace() {
  const host = useWebsiteHost();
  const router = useRouter();
  const props = useWebsiteList(getCatalogProperties, []);
  const [owner, setOwner] = useState("");
  const [room, setRoom] = useState("");
  const [switchPrompt, setSwitchPrompt] = useState<{ propertyId: string; roomId: string } | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [amenity, setAmenity] = useState({ code: "", name: "", category: "" });
  const propertyData = props.state.status === "ready" ? props.state.data : [];
  const ownerId = owner || propertyData.find(x => x.slug === "the-bha-riverside")?.id || "@unconfigured:the-bha-riverside";
  const selected = propertyData.find(x => x.id === ownerId);
  const currentId = selected ? ownerId : "";
  const ownerKey = editorKey(currentId, room || null);
  const scope = useRef(ownerKey);
  scope.current = ownerKey;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const data = useWebsiteList(signal => currentId ? getCatalog(currentId, room || null, signal) : Promise.resolve({ kind: "network", message: "Chọn cơ sở đã có catalog." } as const), [currentId, room]);
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
  const switchTo = (target: { propertyId: string; roomId: string }) => {
    setDraftState(null);
    setNote(""); setFileError(""); setPreviewId(""); setAmenity({ code: "", name: "", category: "" });
    write.reset(); upload.reset(); addWrite.reset();
    setOwner(target.propertyId); setRoom(target.roomId); setSwitchPrompt(null);
  };
  const askSwitch = (propertyId: string, roomId: string) => {
    if (busy.current || blocked || switchPrompt || editorKey(propertyId, roomId || null) === ownerKey) return;
    setSwitchPrompt({ propertyId, roomId });
  };
  const acceptSwitch = () => { if (switchPrompt && !busy.current && !blocked) switchTo(switchPrompt); };
  const propertyChanged = (id: string) => askSwitch(id, "");
  const roomChanged = (id: string) => askSwitch(ownerId, id);
  useEffect(() => { host.setUnsaved(dirty || working || unknown); return () => host.setUnsaved(false); }, [dirty, working, unknown, host]);
  useEffect(() => {
    if (!dirty && !locked && !unknown) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      event.preventDefault(); event.stopPropagation();
      if (!busy.current && !unknown) setLeaveHref(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", navigate, true); };
  }, [dirty, locked, unknown]);
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
  if (props.state.status !== "ready") return <section role={props.state.status === "error" ? "alert" : "status"} className="rounded-2xl border border-gray-200 bg-white p-6 text-sm dark:border-gray-800 dark:bg-white/[0.03]">{props.state.status === "error" ? <>{props.state.message} <button className={btn} onClick={() => void props.reload()}>Thử lại</button></> : "Đang tải danh sách cơ sở…"}</section>;
  const propertyChoices = props.state.data;
  return <div className="flex min-w-0 flex-col gap-5" data-testid="catalog-workspace">
    <header><h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Cơ sở & loại phòng</h1><p className="mt-1 text-sm text-gray-500">Sửa nội dung, tiện nghi và thư viện ảnh; thông tin vận hành và giá được giữ nguyên.</p></header>
    <fieldset disabled={blocked} className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-2 dark:border-gray-800 dark:bg-white/[0.03]">
      <label className="text-sm font-medium">Cơ sở<select aria-label="Cơ sở" data-testid="property-select" className={`${box} mt-1`} value={ownerId} onChange={e => propertyChanged(e.target.value)}>{propertyChoices.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}{[["the-bha-riverside", "Riverside"], ["the-bha-house", "House"], ["the-bha-villa", "Villa"]].filter(([slug]) => !propertyChoices.some(p => p.slug === slug)).map(([slug, name]) => <option value={"@unconfigured:" + slug} key={slug}>{name} — chưa thiết lập</option>)}</select></label>
      {selected ? <label className="text-sm font-medium">Loại phòng<select aria-label="Loại phòng" data-testid="room-select" className={`${box} mt-1`} value={room} onChange={e => roomChanged(e.target.value)}><option value="">Thông tin cơ sở</option>{data.state.status === "ready" && data.state.data.propertyId === currentId && data.state.data.roomTypes.map(r => <option key={r.id} value={r.id}>{r.name} · {r.code}</option>)}</select></label> : <p role="status" className="self-center text-sm text-gray-500">Cơ sở này chưa thiết lập catalog. Chưa có nội dung để sửa.</p>}
    </fieldset>
    {!selected ? null : data.state.status === "loading" ? <p role="status" className="text-sm">Đang tải catalog…</p> : data.state.status === "error" ? <p role="alert" className="text-sm">{data.state.message} <button className={btn} onClick={() => void readAgain()}>Thử lại</button></p> : !base || !draft ? null : <fieldset disabled={blocked} className="min-w-0 space-y-5">
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
          {fileError && <p role="alert" className="text-sm text-red-600">{fileError}</p>}
          {gallery.length === 0 ? <p className="text-sm text-gray-500">Chưa có ảnh. Gallery rỗng không có ảnh bìa.</p> : <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{gallery.map((item, i) => { const src = imageSource(item); return <li key={item.mediaId} className="min-w-0 overflow-hidden rounded-xl border border-gray-200 p-2 dark:border-gray-800"><button type="button" onClick={() => setPreviewId(item.mediaId)} className="w-full text-left focus-visible:outline-2 focus-visible:outline-brand-500" aria-label={`Xem trước ảnh ${i + 1}`}><Image unoptimized width={960} height={540} src={src ?? "/images/placeholder.svg"} alt={item.altText ?? ""} loading="lazy" onError={e => { e.currentTarget.style.opacity = "0.25"; }} className="aspect-video w-full rounded-lg bg-gray-100 object-cover dark:bg-gray-800" /></button><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 text-sm"><input type="radio" name="cover" checked={item.isCover} onChange={() => setCover(item.mediaId)} />Ảnh bìa</label><div className="flex gap-1"><button className={btn} aria-label={`Đưa ảnh ${i + 1} lên`} disabled={i === 0 || locked} onClick={() => move(i, -1)}>↑</button><button className={btn} aria-label={`Đưa ảnh ${i + 1} xuống`} disabled={i === gallery.length - 1 || locked} onClick={() => move(i, 1)}>↓</button><button className={btn} disabled={locked} onClick={() => remove(item.mediaId)}>Gỡ ảnh</button></div></div><label className="mt-2 block text-xs">Mô tả ảnh (alt)<input className={`${box} mt-1`} maxLength={500} value={item.altText ?? ""} onChange={e => change("gallery", gallery.map(x => x.mediaId === item.mediaId ? { ...x, altText: e.target.value } : x))} /></label></li>; })}</ul>}
          <div className="rounded-xl border border-brand-200 bg-gray-50 p-4 dark:border-brand-700 dark:bg-white/5"><h3 className="mb-2 font-medium">Xem trước bản đang sửa</h3>{gallery.length ? <><Image unoptimized width={960} height={540} src={imageSource(gallery.find(x => x.mediaId === previewId) ?? gallery.find(x => x.isCover) ?? gallery[0]) ?? "/images/placeholder.svg"} alt={gallery.find(x => x.mediaId === previewId)?.altText ?? gallery.find(x => x.isCover)?.altText ?? ""} className="aspect-video max-h-72 w-full rounded-lg bg-gray-100 object-cover" onError={e => { e.currentTarget.style.opacity = "0.25"; }} /><p className="mt-2 font-semibold">{draft.name}</p><p className="text-sm text-gray-600 dark:text-gray-300">{draft.description || "Chưa có mô tả"}</p><p className="mt-1 text-xs">{base.amenities.filter(a => draft.amenityIds.includes(a.id)).map(a => a.name).join(" · ")}</p></> : <><p className="font-semibold">{draft.name}</p><p className="text-sm">{draft.description || "Chưa có mô tả"}</p></>}</div>
        </section>
      </div>
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"><button className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!dirty || locked || write.status.phase === "unverified" || !gallery.every(x => x.altText == null || x.altText.length <= 500)} onClick={() => void doSave()}>{locked ? "Đang lưu…" : "Lưu thay đổi"}</button><span className="text-sm" role={note ? "status" : undefined}>{note || (dirty ? "Có thay đổi chưa lưu." : "Đã đồng bộ với máy chủ.")}</span></section>
    </fieldset>}
    {unknown && <button disabled={locked} className={btn} onClick={() => void readAgain()}>Đọc lại trước khi tiếp tục</button>}
    {leaveHref && <div role="dialog" aria-modal="true" aria-labelledby="leave-title" className="fixed inset-0 z-99999 flex items-center justify-center bg-black/50 p-4"><section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"><h2 id="leave-title" className="text-lg font-semibold">Rời màn hình?</h2><p className="my-3 text-sm">Có nội dung chưa lưu. Bạn có thể lưu, bỏ nội dung sửa, hoặc tiếp tục ở lại.</p><div className="flex flex-wrap justify-end gap-2"><button className={btn} disabled={locked} onClick={() => { if (!busy.current) setLeaveHref(null); }}>Tiếp tục sửa</button><button className={btn} disabled={locked} onClick={() => void doSave().then(ok => { if (ok && leaveHref) { const target = leaveHref; setLeaveHref(null); router.push(target); } })}>Lưu rồi rời</button><button className="rounded-lg bg-brand-500 px-3 py-2 text-sm text-white" disabled={locked} onClick={() => { if (busy.current) return; const target = leaveHref; setLeaveHref(null); if (target) router.push(target); }}>Bỏ sửa và rời</button></div></section></div>}
    {switchPrompt && <div role="dialog" aria-modal="true" aria-labelledby="switch-title" className="fixed inset-0 z-99999 flex items-center justify-center bg-black/50 p-4"><section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"><h2 id="switch-title" className="text-lg font-semibold">Chuyển catalog?</h2><p className="my-3 text-sm">{dirty ? "Có nội dung chưa lưu. Bạn có thể lưu trước, bỏ phần sửa, hoặc tiếp tục ở lại." : "Mở catalog đã chọn?"}</p><div className="flex flex-wrap justify-end gap-2"><button className={btn} data-testid="switch-keep" disabled={locked} onClick={() => { if (!busy.current) setSwitchPrompt(null); }}>Tiếp tục sửa</button>{dirty && <button className={btn} onClick={() => void doSave().then(ok => { if (ok && switchPrompt) { switchTo(switchPrompt); } })} disabled={locked}>Lưu rồi chuyển</button>}<button className="rounded-lg bg-brand-500 px-3 py-2 text-sm text-white" disabled={locked} onClick={acceptSwitch}>Bỏ sửa và chuyển</button></div></section></div>}
  </div>;
}

function Field({ label, value, onChange, max, area, type = "text", required = false }: { label: string; value: string | number; onChange: (x: string) => void; max?: number; area?: boolean; type?: string; required?: boolean }) {
  return <label className="block min-w-0 text-sm font-medium">{label}{required && <span className="text-red-600"> *</span>}{area ? <textarea required={required} maxLength={max} rows={4} className={`${box} mt-1`} value={value} onChange={e => onChange(e.target.value)} /> : <input required={required} type={type} min={type === "number" ? 0 : undefined} maxLength={max} max={type === "number" ? 10000 : undefined} step={type === "number" ? "0.01" : undefined} className={`${box} mt-1`} value={value} onChange={e => onChange(e.target.value)} />}{max && <span className="mt-1 block text-xs text-gray-500">{String(value).length}/{max}</span>}</label>;
}
