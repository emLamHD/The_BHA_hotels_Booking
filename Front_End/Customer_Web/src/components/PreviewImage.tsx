import React, { CSSProperties, FC } from "react";
import type { StaticImageData } from "next/image";
import { PhotoIcon } from "@heroicons/react/24/outline";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: stands in for `next/image` inside the template's sample (service
 * preview) sections. Those pictures are template assets or third-party hotlinks without rights
 * evidence (PROJECT_BIBLE §14), so the public page keeps the template's frame, ratio and rounding
 * and shows a neutral block instead of fetching or bundling the picture. It requests nothing.
 *
 * Without `fill` it renders an `<img>` whose source is an inline SVG data URI (nothing to fetch) with
 * the original's width and height, so it lays out exactly like `next/image` does: a replaced element
 * that is its natural size, capped by its container, whose classes (`w-full`, `mx-auto`, rounding …)
 * apply as they did to the picture.
 */
export interface PreviewImageProps {
  src?: string | StaticImageData;
  alt?: string;
  fill?: boolean;
  className?: string;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  style?: CSSProperties;
  [prop: string]: unknown;
}

const FRAME = "bg-neutral-100 dark:bg-neutral-800";

// Heroicons "photo" (outline, 24x24): the neutral mark in the middle of the frame.
const PHOTO_PATH =
  "m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z";

export function placeholderDataUri(width: number, height: number): string {
  const scale = Math.max(Math.min(width, height) / 4 / 24, 0.5);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>` +
    `<g transform='translate(${width / 2} ${height / 2}) scale(${scale}) translate(-12 -12)' fill='none' stroke='%23d4d4d4' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'>` +
    `<path d='${PHOTO_PATH}'/></g></svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

const PreviewImage: FC<PreviewImageProps> = ({ src, fill, className = "", width, height, style }) => {
  if (fill) {
    return (
      <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-center text-neutral-300 dark:text-neutral-600 ${FRAME} ${className}`} style={style}>
        <PhotoIcon className="h-1/4 max-h-16 w-1/4 max-w-[4rem]" />
      </div>
    );
  }

  // Out-of-flow decoration (scattered avatars, quotation marks) is dropped: a grey block there would
  // only cover the sample text.
  if (/\babsolute\b/.test(className)) return null;

  const w = width ?? (typeof src === "object" ? src.width : undefined) ?? 400;
  const h = height ?? (typeof src === "object" ? src.height : undefined) ?? 300;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      aria-hidden="true"
      alt=""
      src={placeholderDataUri(w, h)}
      width={w}
      height={h}
      className={`${FRAME} ${className}`}
      style={{ maxWidth: "100%", height: "auto", ...style }}
    />
  );
};

export default PreviewImage;
