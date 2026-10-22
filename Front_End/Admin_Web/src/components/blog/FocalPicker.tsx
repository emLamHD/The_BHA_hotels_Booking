"use client";

/**
 * BHA-BLOG-001-CP03: the focal point of a picture (x, y in 0..1) — the part a crop must keep. Click or drag on the picture, or use the arrow keys / number
 * fields; the three small frames show how a square, a wide and a tall crop would fall. It only edits the library's value; what the public page does with
 * it is not decided here (design §9.1).
 */

import React, { useRef } from "react";
import { StaffImage, useStaffImage } from "./useStaffImage";
import { mediaPreviewPath } from "@/lib/api/blog";

const clamp = (n: number) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));

export default function FocalPicker({ mediaId, x, y, onChange, disabled }: { mediaId: string; x: number; y: number; onChange: (x: number, y: number) => void; disabled?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const set = (clientX: number, clientY: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    onChange(clamp((clientX - box.left) / box.width), clamp((clientY - box.top) / box.height));
  };
  const path = mediaPreviewPath(mediaId, "article");
  const crops = [{ name: "Vuông 1:1", ratio: "1 / 1" }, { name: "Ngang 16:9", ratio: "16 / 9" }, { name: "Dọc 4:5", ratio: "4 / 5" }];
  return (
    <div className="flex flex-col gap-3" data-testid="focal-picker">
      <div
        ref={frame}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Điểm lấy nét: dùng phím mũi tên để dịch chuyển"
        aria-valuetext={`Ngang ${Math.round(x * 100)}%, dọc ${Math.round(y * 100)}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(x * 100)}
        aria-disabled={disabled}
        className={`relative inline-block max-w-full select-none overflow-hidden rounded-lg border border-gray-300 dark:border-gray-700 ${disabled ? "" : "cursor-crosshair"}`}
        onPointerDown={(e) => { if (disabled) return; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); set(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (!disabled && e.buttons === 1) set(e.clientX, e.clientY); }}
        onKeyDown={(e) => {
          if (disabled) return;
          const step = e.shiftKey ? 0.1 : 0.01;
          const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const delta = move[e.key];
          if (delta) { e.preventDefault(); onChange(clamp(x + delta[0]), clamp(y + delta[1])); }
        }}
      >
        <StaffImage path={path} alt="Ảnh để chọn điểm lấy nét" className="block max-h-72 w-auto max-w-full" testId="focal-image" />
        <span aria-hidden className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-500/70 shadow ring-2 ring-brand-600" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} data-testid="focal-marker" />
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="text-xs text-gray-600 dark:text-gray-300">Ngang (0–1)
          <input type="number" min={0} max={1} step={0.01} value={x} disabled={disabled} aria-label="Điểm lấy nét ngang" className="ml-2 h-8 w-24 rounded border border-gray-300 bg-transparent px-2 dark:border-gray-700" onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(clamp(v), y); }} />
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-300">Dọc (0–1)
          <input type="number" min={0} max={1} step={0.01} value={y} disabled={disabled} aria-label="Điểm lấy nét dọc" className="ml-2 h-8 w-24 rounded border border-gray-300 bg-transparent px-2 dark:border-gray-700" onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(x, clamp(v)); }} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3" aria-label="Minh hoạ các kiểu cắt">
        {crops.map((crop) => (
          <figure key={crop.name} className="text-center text-xs text-gray-500 dark:text-gray-400">
            <StaffCropImage path={path} ratio={crop.ratio} x={x} y={y} />
            <figcaption className="mt-1">{crop.name}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">Chỉ là minh hoạ; website công khai chưa dùng điểm lấy nét này.</p>
    </div>
  );
}


function StaffCropImage({ path, ratio, x, y }: { path: string; ratio: string; x: number; y: number }) {
  const image = useStaffImage(path);
  return (
    <div className="w-24 overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-white/5" style={{ aspectRatio: ratio }}>
      {image.status === "ready" && (
        // eslint-disable-next-line @next/next/no-img-element -- a Blob URL
        <img src={image.url} alt="" className="h-full w-full object-cover" style={{ objectPosition: `${x * 100}% ${y * 100}%` }} />
      )}
    </div>
  );
}
