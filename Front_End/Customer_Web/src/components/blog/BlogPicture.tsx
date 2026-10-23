import React from "react";
import type { BlogVariant } from "@/lib/blog/blog";

interface Props {
  /** The address the plain picture route serves (the article-size fallback). */
  src: string;
  alt: string;
  width: number;
  height: number;
  variants: BlogVariant[];
  sizes: string;
  className?: string;
  /** The picture the page leads with is loaded at once; the rest wait until they are near. */
  eager?: boolean;
}

const srcSet = (list: BlogVariant[]) => list.map((v) => `${v.url} ${v.width}w`).join(", ");

/**
 * BHA-BLOG-001-CP04: a Blog picture exactly as the API published it — WebP first, the JPEG/PNG fallback second, the sizes it made. It is a plain
 * `<picture>`/`<img>` at the API's own address and NOT the Next image optimizer: the optimizer would keep its own copy of a picture after the article stopped
 * being public, while a direct address is answered (and refused) by the API on every request and kept by a browser for at most the API's 300 seconds.
 * The width and height stay on the element so the page does not jump while it loads.
 */
export default function BlogPicture({ src, alt, width, height, variants, sizes, className, eager = false }: Props) {
  const webp = variants.filter((v) => v.format === "webp");
  const fallback = variants.filter((v) => v.format !== "webp");
  return (
    <picture>
      {webp.length > 0 && <source type="image/webp" srcSet={srcSet(webp)} sizes={sizes} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        srcSet={fallback.length > 0 ? srcSet(fallback) : undefined}
        sizes={fallback.length > 0 ? sizes : undefined}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={className}
      />
    </picture>
  );
}
