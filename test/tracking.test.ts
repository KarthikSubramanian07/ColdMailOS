import { describe, it, expect } from "vitest";
import { toTrackedHtml, newTrackId } from "../src/tracking";

describe("toTrackedHtml", () => {
  const body = "Hi,\nSee https://acme.com/work & say hi.\nBest";

  it("rewrites links through /c when click tracking is on", () => {
    const html = toTrackedHtml("https://w.example", "abc", body, { clicks: true, opens: false });
    expect(html).toContain('href="https://w.example/c/abc?u=https%3A%2F%2Facme.com%2Fwork"');
    expect(html).not.toContain("/o/abc"); // no pixel
  });

  it("leaves links direct when click tracking is off", () => {
    const html = toTrackedHtml("https://w.example", "abc", body, { clicks: false, opens: false });
    expect(html).toContain('href="https://acme.com/work"');
  });

  it("adds the open pixel only when open tracking is on", () => {
    const on = toTrackedHtml("https://w.example", "abc", body, { clicks: false, opens: true });
    expect(on).toContain('<img src="https://w.example/o/abc"');
  });

  it("escapes HTML special characters and keeps newlines as <br>", () => {
    const html = toTrackedHtml("https://w.example", "abc", body, { clicks: false, opens: false });
    expect(html).toContain("&amp;");
    expect(html).toContain("<br>");
  });
});

describe("newTrackId", () => {
  it("is a hex id with no dashes and is unique", () => {
    const a = newTrackId();
    const b = newTrackId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
