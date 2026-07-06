import { describe, it, expect } from "vitest";
import { chunkText, candidatePages } from "../src/cron";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello")).toEqual(["hello"]);
  });
  it("splits long text into multiple overlapping chunks", () => {
    const text = "x".repeat(30_000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // overlap means the concatenated length exceeds the original
    const total = chunks.reduce((s, c) => s + c.length, 0);
    expect(total).toBeGreaterThan(text.length);
    // every character of the original is covered
    expect(chunks[0][0]).toBe("x");
    expect(chunks[chunks.length - 1].at(-1)).toBe("x");
  });
});

describe("candidatePages", () => {
  it("research mode probes only the given URL", () => {
    expect(candidatePages("https://x.edu/p", "research")).toEqual(["https://x.edu/p"]);
  });
  it("startup mode also probes /contact and /careers on the origin", () => {
    const pages = candidatePages("https://co.com/about", "startup");
    expect(pages).toContain("https://co.com/about");
    expect(pages).toContain("https://co.com/contact");
    expect(pages).toContain("https://co.com/careers");
  });
  it("falls back to the raw URL if it can't be parsed", () => {
    expect(candidatePages("not a url", "startup")).toEqual(["not a url"]);
  });
});
