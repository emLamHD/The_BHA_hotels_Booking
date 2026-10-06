import React, { CSSProperties, FC } from "react";
import type { StaticImageData } from "next/image";
import { PhotoIcon } from "@heroicons/react/24/outline";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: stands in for `next/image` inside the template's sample (service
 * preview) sections. Those pictures are template assets or third-party hotlinks without rights
 * evidence (PROJECT_BIBLE §14), so the public page keeps the template's frame, ratio and rounding
 * and shows a neutral block instead of fetching or bundling the picture. It requests nothing.
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

const FRAME =
  "flex items-center justify-center bg-neutral-100 text-neutral-300 dark:bg-neutral-800 dark:text-neutral-600";

const PreviewImage: FC<PreviewImageProps> = ({ src, fill, className = "", width, height, style }) => {
  if (fill) {
    return (
      <div aria-hidden="true" className={`absolute inset-0 ${FRAME} ${className}`} style={style}>
        <PhotoIcon className="h-1/4 max-h-16 w-1/4 max-w-[4rem]" />
      </div>
    );
  }

  // Out-of-flow decoration (scattered avatars, quotation marks) is dropped: a grey block there would
  // only cover the sample text.
  if (/\babsolute\b/.test(className)) return null;

  const w = width ?? (typeof src === "object" ? src.width : undefined);
  const h = height ?? (typeof src === "object" ? src.height : undefined);
  const ratio = w && h ? { aspectRatio: `${w} / ${h}` } : undefined;
  // `next/image` shows a bundled picture at its natural width unless the class says otherwise.
  const sizing = /\bw-/.test(className) ? undefined : { width: w ? `${w}px` : "100%", maxWidth: "100%" };
  return (
    <div
      aria-hidden="true"
      className={`${FRAME} ${className}`}
      style={{ ...ratio, ...sizing, ...style }}
    >
      <PhotoIcon className="h-12 w-12" />
    </div>
  );
};

export default PreviewImage;
