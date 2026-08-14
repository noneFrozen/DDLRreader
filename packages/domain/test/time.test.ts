import { describe, expect, it } from "vitest";
import { effectiveCapacityBlocks, toBlockCount } from "../src/time.js";

describe("30-minute normalization", () => {
  it.each([[0, 0], [1, 1], [30, 1], [31, 2], [90, 3]])(
    "rounds %i minutes up to %i blocks",
    (minutes, expected) => expect(toBlockCount(minutes)).toBe(expected),
  );

  it("reserves ten percent and floors to whole blocks", () => {
    expect(effectiveCapacityBlocks(11, 0.1)).toBe(9);
  });
});

describe("toBlockCount boundary cases", () => {
  it("rejects negative minutes", () => {
    expect(() => toBlockCount(-1)).toThrow(RangeError);
    expect(() => toBlockCount(-1)).toThrow("minutes must be finite and non-negative");
  });

  it("rejects NaN", () => {
    expect(() => toBlockCount(NaN)).toThrow(RangeError);
    expect(() => toBlockCount(NaN)).toThrow("minutes must be finite and non-negative");
  });

  it("rejects Infinity", () => {
    expect(() => toBlockCount(Infinity)).toThrow(RangeError);
    expect(() => toBlockCount(Infinity)).toThrow("minutes must be finite and non-negative");
  });

  it("accepts zero", () => {
    expect(toBlockCount(0)).toBe(0);
  });
});

describe("effectiveCapacityBlocks boundary cases", () => {
  it("rejects negative blocks", () => {
    expect(() => effectiveCapacityBlocks(-1, 0.1)).toThrow(RangeError);
    expect(() => effectiveCapacityBlocks(-1, 0.1)).toThrow("blocks must be a non-negative integer");
  });

  it("rejects fractional blocks", () => {
    expect(() => effectiveCapacityBlocks(1.5, 0.1)).toThrow(RangeError);
    expect(() => effectiveCapacityBlocks(1.5, 0.1)).toThrow("blocks must be a non-negative integer");
  });

  it("rejects bufferRatio === 1", () => {
    expect(() => effectiveCapacityBlocks(10, 1)).toThrow(RangeError);
    expect(() => effectiveCapacityBlocks(10, 1)).toThrow("bufferRatio must be in [0, 1)");
  });

  it("rejects negative bufferRatio", () => {
    expect(() => effectiveCapacityBlocks(10, -0.1)).toThrow(RangeError);
    expect(() => effectiveCapacityBlocks(10, -0.1)).toThrow("bufferRatio must be in [0, 1)");
  });

  it("accepts bufferRatio === 0", () => {
    expect(effectiveCapacityBlocks(10, 0)).toBe(10);
  });
});