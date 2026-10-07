import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MediaGallery from "./MediaGallery";
import { MediaDto } from "@/lib/api/propertyTypes";

const media = (id: string, sortOrder: number, isCover = false, url = `https://shop.example.test/media/${id}.webp`): MediaDto => ({
  id, url, altText: `Mô tả ${id}`, mediaType: "Image", sortOrder, isCover,
});
const render = (props: Partial<React.ComponentProps<typeof MediaGallery>> & { media: MediaDto[] | null }) =>
  renderToStaticMarkup(React.createElement(MediaGallery, { name: "Căn hộ", ...props }));

describe("MediaGallery (first paint)", () => {
  it("shows the cover large with its own alt text and a thumbnail for every image", () => {
    const html = render({ media: [media("a", 1), media("cover", 9, true), media("b", 2)] });
    expect(html.match(/<img /g)).toHaveLength(4); // 1 large + 3 thumbnails
    expect(html).toContain('src="https://shop.example.test/media/cover.webp"');
    expect(html).toContain('alt="Mô tả cover"');
    expect(html.split("<li").length - 1).toBe(3);
    expect(html).toContain('aria-pressed="true"'); // the cover's thumbnail
    expect(html.indexOf("cover.webp")).toBeLessThan(html.indexOf("a.webp"));
  });

  it("shows no thumbnail row for a single image", () => {
    const html = render({ media: [media("only", 0, true)] });
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain("<ul");
  });

  it("uses the placeholder text, not a picture, when nothing is usable", () => {
    const html = render({ media: [media("ex", 0, true, "https://images.example.com/a.jpg")], emptyLabel: "Ảnh đang được cập nhật" });
    expect(html).toContain("Ảnh đang được cập nhật");
    expect(html).not.toContain("<img");
  });

  it("renders nothing when nothing is usable and no placeholder was asked for", () => {
    expect(render({ media: null })).toBe("");
    expect(render({ media: [] })).toBe("");
  });
});
