import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMessage, isValidMessage, messageVariables } from "./format";

// The one vector file shared with the C# validator and the Admin formatter.
const vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../Back_End/src/TheBha.Application/Website/Localization/icu-vectors.json"), "utf8")
).vectors as { name: string; locale: string; message: string; params?: Record<string, string | number>; variables?: string[]; output?: string; invalid?: boolean }[];

const plainSpaces = (text: string) => text.replace(/[  ]/g, " ");

describe("the message formatter, against the shared vectors", () => {
  it("has the shared vectors", () => {
    expect(vectors.length).toBeGreaterThan(25);
  });

  for (const vector of vectors) {
    it(vector.name, () => {
      if (vector.invalid) {
        expect(isValidMessage(vector.message)).toBe(false);
        return;
      }
      expect(isValidMessage(vector.message)).toBe(true);
      expect(messageVariables(vector.message)).toEqual(vector.variables);
      expect(plainSpaces(formatMessage(vector.message, vector.locale, vector.params ?? {}))).toBe(vector.output);
    });
  }

  it("shows an invalid message as written instead of throwing", () => {
    expect(formatMessage("Hello {name", "en", { name: "x" })).toBe("Hello {name");
  });

  it("is identical in Customer_Web and Admin_Web", () => {
    const customer = readFileSync(resolve(__dirname, "format.ts"), "utf8");
    const admin = readFileSync(resolve(__dirname, "../../../../Admin_Web/src/lib/i18n/format.ts"), "utf8");
    expect(admin).toBe(customer);
  });
});
