import { existsSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import manifest from "../../scripts/homepage-media/manifest.json";
import { HERO_SLIDES, MEDIA_CREDITS, creditForFile, creditLine, travelMediaUrl } from "./heroSlides";

interface Derivative {
  file: string;
  width: number;
  height: number;
  alt: string;
}
interface Entry {
  id: string;
  commonsTitle: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  attributionRequired: boolean;
  originalSha1: string;
  derivatives: Derivative[];
}
const entries = (manifest as { entries: Entry[] }).entries;
const mediaDir = path.resolve(__dirname, "../../public/media/the-bha-travel");

describe("home photographs: credits, manifest and files agree", () => {
  it("every credit mirrors its manifest entry (author, licence, links, files)", () => {
    expect(MEDIA_CREDITS.map((credit) => credit.id).sort()).toEqual(entries.map((entry) => entry.id).sort());
    for (const credit of MEDIA_CREDITS) {
      const entry = entries.find((item) => item.id === credit.id);
      expect(entry, credit.id).toBeDefined();
      expect(credit.commonsTitle).toBe(entry?.commonsTitle);
      expect(credit.author).toBe(entry?.author);
      expect(credit.license).toBe(entry?.license);
      expect(credit.licenseUrl).toBe(entry?.licenseUrl);
      expect(credit.sourceUrl).toBe(entry?.sourceUrl);
      expect([...credit.files].sort()).toEqual(entry?.derivatives.map((d) => d.file).sort());
    }
  });

  it("every .webp under public/media/the-bha-travel has a manifest entry, and every entry's file exists", () => {
    const onDisk = readdirSync(mediaDir).filter((name) => name.endsWith(".webp")).sort();
    const listed = entries.flatMap((entry) => entry.derivatives.map((d) => d.file)).sort();
    expect(onDisk).toEqual(listed);
    for (const file of listed) expect(existsSync(path.join(mediaDir, file))).toBe(true);
  });

  it("only free licences, each with a verifiable original", () => {
    for (const entry of entries) {
      expect(["CC0", "CC BY 2.0", "CC BY 4.0", "CC BY-SA 2.0", "CC BY-SA 4.0"]).toContain(entry.license);
      expect(entry.licenseUrl).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(entry.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(entry.originalSha1).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.attributionRequired).toBe(entry.license !== "CC0");
    }
  });

  it("file names stay inside the namespace the media route allows (one hyphenated segment, .webp)", () => {
    for (const entry of entries) for (const d of entry.derivatives) expect(d.file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/);
  });

  it("looks a credit up by file and writes a short caption line without the Commons dot prefix", () => {
    const credit = creditForFile("hero-my-khe-beach.webp");
    expect(credit?.license).toBe("CC BY 2.0");
    expect(credit && creditLine(credit)).toBe("Ảnh: Ray in Manila · CC BY 2.0");
    expect(creditForFile("nope.webp")).toBeUndefined();
    expect(travelMediaUrl("hero-my-khe-beach.webp")).toBe("/media/the-bha-travel/hero-my-khe-beach.webp");
  });
});

describe("hero slides", () => {
  it("are at least three distinct, credited photographs", () => {
    expect(HERO_SLIDES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(HERO_SLIDES.map((slide) => slide.file)).size).toBe(HERO_SLIDES.length);
    expect(new Set(HERO_SLIDES.map((slide) => creditForFile(slide.file)?.id)).size).toBe(HERO_SLIDES.length);
    for (const slide of HERO_SLIDES) {
      expect(creditForFile(slide.file), slide.file).toBeDefined();
      expect(slide.alt.trim().length).toBeGreaterThan(0);
      const derivative = entries.flatMap((entry) => entry.derivatives).find((d) => d.file === slide.file);
      expect([derivative?.width, derivative?.height]).toEqual([1920, 900]);
    }
  });

  it("claim nothing about the property's rooms or their view", () => {
    const text = JSON.stringify(HERO_SLIDES);
    expect(text).not.toMatch(/phòng|view|tầm nhìn từ|The BHA/i);
  });
});
