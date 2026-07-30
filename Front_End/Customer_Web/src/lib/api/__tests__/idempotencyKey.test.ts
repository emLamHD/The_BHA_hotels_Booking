import { describe, expect, it, vi } from "vitest";
import { generateIdempotencyKey } from "../idempotencyKey";

describe("generateIdempotencyKey", () => {
  it("returns a non-empty value bounded well within 256 UTF-8 bytes", () => {
    const key = generateIdempotencyKey();
    expect(key.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(key).length).toBeLessThanOrEqual(256);
  });

  it("generates a different key on each call", () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toBe(b);
  });

  it("uses crypto.randomUUID rather than Math.random", () => {
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID");
    const mathRandomSpy = vi.spyOn(Math, "random");

    generateIdempotencyKey();

    expect(randomUuidSpy).toHaveBeenCalledTimes(1);
    expect(mathRandomSpy).not.toHaveBeenCalled();

    randomUuidSpy.mockRestore();
    mathRandomSpy.mockRestore();
  });

  it("throws rather than silently falling back when secure randomness is unavailable", () => {
    const original = crypto.randomUUID;
    // @ts-expect-error -- simulating an environment without crypto.randomUUID
    crypto.randomUUID = undefined;

    expect(() => generateIdempotencyKey()).toThrow();

    crypto.randomUUID = original;
  });
});
