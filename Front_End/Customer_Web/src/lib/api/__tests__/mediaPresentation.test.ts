import { describe, expect, it } from "vitest";
import { coverHasFailed, pickMainImage, selectGalleryImages, visibleImages } from "../mediaPresentation";
import { MediaDto } from "../propertyTypes";

const image = (id: string, url: string | null, sortOrder: number, isCover = false, mediaType: MediaDto["mediaType"] = "Image"): MediaDto => ({
  id, url, altText: `alt ${id}`, mediaType, sortOrder, isCover,
});
const a = image("a", "https://shop.example.test/media/a.webp", 2);
const b = image("b", "https://shop.example.test/media/b.webp", 0);
const cover = image("c", "https://shop.example.test/media/c.webp", 5, true);

describe("selectGalleryImages", () => {
  it("puts the cover first, then sortOrder, then id", () => {
    expect(selectGalleryImages([a, b, cover]).map((m) => m.id)).toEqual(["c", "b", "a"]);
    expect(selectGalleryImages([image("z", "https://x.test/z.webp", 1), image("y", "https://x.test/y.webp", 1)]).map((m) => m.id)).toEqual(["y", "z"]);
  });

  it("drops what the browser must never be asked to load", () => {
    const usable = selectGalleryImages([
      a,
      image("ex", "https://images.example.com/x.jpg", 0), // reserved example host
      image("nul", null, 0),
      image("rel", "/relative/x.webp", 0), // not absolute
      image("ftp", "ftp://x.test/x.webp", 0),
      image("vid", "https://x.test/v.mp4", 0, false, "Video"),
    ]);
    expect(usable.map((m) => m.id)).toEqual(["a"]);
  });

  it("copes with no media at all", () => {
    expect(selectGalleryImages(null)).toEqual([]);
    expect(selectGalleryImages(undefined)).toEqual([]);
    expect(selectGalleryImages([])).toEqual([]);
  });

  it("does not change its input", () => {
    const input = [a, b, cover];
    selectGalleryImages(input);
    expect(input.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("visibleImages / pickMainImage", () => {
  const all = selectGalleryImages([a, b, cover]);

  it("removes only the images that failed", () => {
    expect(visibleImages(all, [b.url!]).map((m) => m.id)).toEqual(["c", "a"]);
    expect(visibleImages(all, [])).toHaveLength(3);
    expect(visibleImages(all, all.map((m) => m.url!))).toEqual([]);
  });

  it("shows the chosen image while it is visible, otherwise the first one", () => {
    expect(pickMainImage(all, a.url)?.id).toBe("a");
    expect(pickMainImage(all, null)?.id).toBe("c");
    expect(pickMainImage(visibleImages(all, [a.url!]), a.url)?.id).toBe("c"); // chosen one failed
    expect(pickMainImage([], a.url)).toBeUndefined();
  });
});

describe("coverHasFailed", () => {
  it("fails only for the URL that failed, so a different cover is not judged by an old failure", () => {
    expect(coverHasFailed(a, a.url)).toBe(true);
    expect(coverHasFailed(b, a.url)).toBe(false); // another offer / another search
    expect(coverHasFailed(a, null)).toBe(false);
  });

  it("counts a missing cover as failed so the placeholder is used", () => {
    expect(coverHasFailed(undefined, null)).toBe(true);
  });
});
