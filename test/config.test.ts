import { describe, it, expect } from "vitest";
import { boolVar, intVar, normalizeMode } from "../src/config";

describe("boolVar", () => {
  it("is true only for 'true' (case-insensitive)", () => {
    expect(boolVar("true")).toBe(true);
    expect(boolVar("TRUE")).toBe(true);
    expect(boolVar("false")).toBe(false);
    expect(boolVar("")).toBe(false);
    expect(boolVar(undefined)).toBe(false);
    expect(boolVar("yes")).toBe(false);
  });
});

describe("intVar", () => {
  it("parses integers with a fallback", () => {
    expect(intVar("5", 1)).toBe(5);
    expect(intVar("0", 9)).toBe(0);
    expect(intVar("abc", 7)).toBe(7);
    expect(intVar(undefined, 3)).toBe(3);
    expect(intVar("", 4)).toBe(4);
  });
});

describe("normalizeMode", () => {
  it("defaults to research and lowercases", () => {
    expect(normalizeMode("startup")).toBe("startup");
    expect(normalizeMode("STARTUP")).toBe("startup");
    expect(normalizeMode("research")).toBe("research");
    expect(normalizeMode("")).toBe("research");
    expect(normalizeMode(undefined)).toBe("research");
    expect(normalizeMode(123)).toBe("research");
  });
});
