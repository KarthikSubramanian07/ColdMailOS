import { describe, it, expect } from "vitest";
import { timingSafeEqual } from "../src/security";

describe("timingSafeEqual", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqual("secret123", "secret123")).toBe(true);
    expect(timingSafeEqual("secret123", "secret124")).toBe(false);
  });
  it("is false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "x")).toBe(false);
  });
  it("handles empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
