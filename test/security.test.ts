import { describe, it, expect } from "vitest";
import { timingSafeEqual, checkSharedSecret, isSafeHttpUrl } from "../src/security";

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

describe("checkSharedSecret", () => {
  it("rejects when the configured secret is missing", () => {
    expect(checkSharedSecret("", "")).toBe(false);
    expect(checkSharedSecret("x", "")).toBe(false);
    expect(checkSharedSecret("x", undefined)).toBe(false);
  });
  it("accepts a matching secret", () => {
    expect(checkSharedSecret("abc", "abc")).toBe(true);
    expect(checkSharedSecret("abc", "xyz")).toBe(false);
  });
});

describe("isSafeHttpUrl", () => {
  it("allows http and https", () => {
    expect(isSafeHttpUrl("https://example.com/x")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });
  it("rejects dangerous schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,hi")).toBe(false);
  });
});
