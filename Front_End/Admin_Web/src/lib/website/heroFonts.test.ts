import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HERO_FONT_KEYS, HERO_FONT_LABELS, HERO_FONT_STACKS, heroPreviewFamily } from "./heroFonts";

/** The Customer's table, read from its source: the preview is only honest while the two agree. */
const customer = readFileSync(resolve(__dirname, "../../../../Customer_Web/src/lib/hero/hero.ts"), "utf8");
const backend = readFileSync(resolve(__dirname, "../../../../../Back_End/src/TheBha.Domain/Website/WebsiteHero.cs"), "utf8");

describe("the fonts the hero offers", () => {
  it("are the Customer's and the API's, in the same order, with the same stacks", () => {
    const keys = [...customer.matchAll(/^export const HERO_FONT_KEYS = \[(.*)\] as const;/gm)][0][1].split(",").map((item) => item.trim().replace(/"/g, ""));
    expect(keys).toEqual([...HERO_FONT_KEYS]);
    for (const [key, family] of Object.entries(HERO_FONT_STACKS)) {
      if (family === null) {
        expect(customer).toMatch(new RegExp(`\\b${key}: null,`));
      } else {
        expect(customer, key).toContain(`${JSON.stringify(key)}: '${family}'`);
      }
    }
    for (const key of HERO_FONT_KEYS) expect(backend).toContain(`"${key}"`);
    expect(Object.keys(HERO_FONT_LABELS)).toEqual([...HERO_FONT_KEYS]);
  });

  it("name no URL, import or arbitrary value: only family names and generic families", () => {
    for (const family of Object.values(HERO_FONT_STACKS)) expect(family ?? "").not.toMatch(/url\(|@import|https?:|;|\{|\}/i);
  });

  it("each system stack ends in a generic family, and the theme default is Poppins", () => {
    expect(HERO_FONT_STACKS["system-sans"]).toMatch(/sans-serif$/);
    expect(HERO_FONT_STACKS["system-serif"]).toMatch(/serif$/);
    expect(heroPreviewFamily("default")).toContain("Poppins");
    expect(heroPreviewFamily("be-vietnam-pro")).toContain("--font-header");
  });
});
