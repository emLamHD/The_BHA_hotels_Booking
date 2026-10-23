"use client";

/** BHA-BLOG-001-CP03: the one picture picker (cover, OG image, a body picture, a gallery): choose from the library or upload and choose. */

import React, { useCallback, useRef, useState } from "react";
import { DialogActions, DialogShell, ActionButton } from "@/components/website/WebsiteUi";
import MediaBrowser from "./MediaBrowser";
import type { BlogMedia } from "@/lib/api/blog";
import type { PickedMedia } from "./BodyEditorContext";

export default function MediaPickerDialog({
  title,
  multiple,
  min = 1,
  max = 1,
  canUpload,
  onChoose,
  onClose,
}: {
  title: string;
  multiple: boolean;
  min?: number;
  max?: number;
  canUpload: boolean;
  onChoose: (picked: PickedMedia[]) => void;
  onClose: () => void;
}) {
  // Order of choice is kept: a gallery follows the order the pictures were picked.
  const [chosen, setChosen] = useState<PickedMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const isBusy = useRef<() => boolean>(() => false);
  const trackBusy = useCallback((value: boolean, readBusy: () => boolean) => {
    isBusy.current = readBusy;
    setBusy(value);
  }, []);
  const activate = (media: BlogMedia) => {
    const entry = { id: media.id, description: media.description };
    if (!multiple) { if (!isBusy.current()) onChoose([entry]); return; }
    setChosen((current) => (current.some((x) => x.id === media.id) ? current.filter((x) => x.id !== media.id) : current.length < max ? [...current, entry] : current));
  };
  return (
    <DialogShell title={title} onClose={onClose} busy={busy} testId="media-picker" wide>
      <MediaBrowser selectedIds={new Set(chosen.map((x) => x.id))} onActivate={activate} canUpload={canUpload} onBusyChange={trackBusy} blockActivationWhileBusy={!multiple} />
      <DialogActions>
        {multiple && <span className="mr-auto text-sm text-gray-600 dark:text-gray-300" data-testid="picker-count">Đã chọn {chosen.length} (cần {min}–{max})</span>}
        <ActionButton variant="outline" onClick={onClose} disabled={busy} testId="picker-cancel">Đóng</ActionButton>
        {multiple && <ActionButton onClick={() => { if (!isBusy.current() && chosen.length >= min && chosen.length <= max) onChoose(chosen); }} disabled={busy || chosen.length < min || chosen.length > max} testId="picker-confirm">Chọn {chosen.length} ảnh</ActionButton>}
      </DialogActions>
    </DialogShell>
  );
}
