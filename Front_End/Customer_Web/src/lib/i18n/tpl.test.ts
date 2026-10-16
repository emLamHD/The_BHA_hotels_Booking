import { describe, expect, it } from "vitest";
import { loadPack } from "./testkit";
import { tplKey } from "./tpl";

describe("template text keys", () => {
  it("derive the same key the packs hold (hash of the NFC text), for every shipped language", () => {
    for (const locale of ["vi", "en", "fr"]) {
      const pack = loadPack(locale);
      expect(pack[tplKey("Starter")]).toBeTruthy();
      expect(pack[tplKey("Where are you going?")]).toBeTruthy();
    }
    expect(loadPack("fr")[tplKey("Starter")]).toBe("Démarrage");
  });

  it("is stable across Unicode forms and changes with the text", () => {
    expect(tplKey("Hu\u1ebf")).toBe(tplKey("Hue\u0302\u0301"));
    expect(tplKey("Starter")).not.toBe(tplKey("Starter "));
  });
});
