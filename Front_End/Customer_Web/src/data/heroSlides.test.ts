import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import manifest from "../../scripts/homepage-media/manifest.json";
import { MEDIA_CREDITS, creditForFile, creditLine, travelMediaUrl } from "./heroSlides";

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
    expect(credit && creditLine(credit, "Ảnh")).toBe("Ảnh: Ray in Manila · CC BY 2.0");
    expect(credit && creditLine(credit, "Photo")).toBe("Photo: Ray in Manila · CC BY 2.0");
    expect(creditForFile("nope.webp")).toBeUndefined();
    expect(travelMediaUrl("hero-my-khe-beach.webp")).toBe("/media/the-bha-travel/hero-my-khe-beach.webp");
  });
});

describe("the built-in hero photographs (served by the API since CUST-WEB-HERO-001-CP01)", () => {
  const backend = path.resolve(__dirname, "../../../../Back_End/src/TheBha.Infrastructure");
  const seeded = Array.from(readFileSync(path.join(backend, "Persistence/WebsiteHeroSeed.cs"), "utf8").matchAll(/'seed\/(hero-[a-z0-9-]+\.webp)'/g)).map((match) => match[1]);

  it("the API seeds at least three, each credited and each with the dimensions its row states", () => {
    expect(seeded.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seeded.map((file) => creditForFile(file)?.id)).size).toBe(seeded.length);
    const sql = readFileSync(path.join(backend, "Persistence/WebsiteHeroSeed.cs"), "utf8");
    for (const file of seeded) {
      expect(creditForFile(file), file).toBeDefined();
      const derivative = entries.flatMap((entry) => entry.derivatives).find((d) => d.file === file);
      expect(sql, file).toContain(`'seed/${file}', 'image/webp', ${readFileSync(path.join(mediaDir, file)).length}, ${derivative?.width}, ${derivative?.height}`);
    }
  });

  it("the copies embedded in the API are byte for byte the files the credits page and the manifest describe", () => {
    expect(readdirSync(path.join(backend, "HeroMedia/Seed")).sort()).toEqual([...seeded].sort());
    for (const file of seeded) {
      expect(readFileSync(path.join(backend, "HeroMedia/Seed", file)).equals(readFileSync(path.join(mediaDir, file))), file).toBe(true);
    }
  });
});
