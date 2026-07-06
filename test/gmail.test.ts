import { describe, it, expect } from "vitest";
import { base64UrlEncode, encodeHeader, buildRawMessage } from "../src/gmail/drafts";

const decode = (raw: string): string =>
  Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

describe("base64UrlEncode", () => {
  it("produces URL-safe output (no + / =)", () => {
    const e = base64UrlEncode("hello world ??? >>> ///");
    expect(e).not.toMatch(/[+/=]/);
  });
  it("round-trips", () => {
    expect(decode(base64UrlEncode("Hi there"))).toBe("Hi there");
  });
});

describe("encodeHeader", () => {
  it("passes ASCII through unchanged", () => {
    expect(encodeHeader("Interest in your research")).toBe("Interest in your research");
  });
  it("RFC 2047-encodes non-ASCII", () => {
    expect(encodeHeader("Café résumé")).toMatch(/^=\?UTF-8\?B\?.*\?=$/);
  });
});

describe("buildRawMessage", () => {
  it("includes To/From/Subject when provided", () => {
    const msg = decode(buildRawMessage({ to: "a@b.co", subject: "Hi", body: "Body", from: "me@x.co" }));
    expect(msg).toContain("To: a@b.co");
    expect(msg).toContain("From: me@x.co");
    expect(msg).toContain("Subject: Hi");
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"');
  });
  it("omits the To header when no recipient was found", () => {
    const msg = decode(buildRawMessage({ to: null, subject: "Hi", body: "Body" }));
    expect(msg).not.toContain("To:");
    expect(msg).toContain("Subject: Hi");
  });
});
