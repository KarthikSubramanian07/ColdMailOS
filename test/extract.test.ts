import { describe, it, expect } from "vitest";
import {
  validEmail,
  normalizeContact,
  parseContacts,
  extractionPrompt,
} from "../src/extract/extractWithLLM";

describe("validEmail", () => {
  it("accepts a real address and lowercases it", () => {
    expect(validEmail("Jane@X.EDU")).toBe("jane@x.edu");
  });
  it("rejects non-addresses (no fabrication)", () => {
    expect(validEmail("not an email")).toBe(null);
    expect(validEmail("a@b")).toBe(null);
    expect(validEmail("jane[at]x.edu")).toBe(null);
    expect(validEmail("")).toBe(null);
  });
});

describe("normalizeContact", () => {
  it("nulls placeholder strings and guards the email field", () => {
    const c = normalizeContact(
      { contact_name: "Jane", role: "null", email: "guess-me", context_summary: "n/a" },
      "https://src",
    );
    expect(c.contact_name).toBe("Jane");
    expect(c.role).toBe(null);
    expect(c.email).toBe(null); // "guess-me" is not a valid email
    expect(c.context_summary).toBe(null);
    expect(c.source_url).toBe("https://src");
  });
  it("keeps a genuine email", () => {
    expect(normalizeContact({ contact_name: "J", email: "j@x.edu" }, "s").email).toBe("j@x.edu");
  });
});

describe("parseContacts", () => {
  it("reads {contacts:[...]}", () => {
    expect(parseContacts('{"contacts":[{"contact_name":"A"}]}')).toHaveLength(1);
  });
  it("reads a bare array", () => {
    expect(parseContacts('[{"contact_name":"A"}]')).toHaveLength(1);
  });
  it("returns [] for garbage", () => {
    expect(parseContacts("not json")).toEqual([]);
    expect(parseContacts("{}")).toEqual([]);
  });
  it("filters out non-object entries", () => {
    expect(parseContacts('{"contacts":[null,"x",5,{"contact_name":"A"}]}')).toHaveLength(1);
  });
});

describe("extractionPrompt", () => {
  it("selects mode-specific wording", () => {
    expect(extractionPrompt("startup").toLowerCase()).toContain("startup");
    expect(extractionPrompt("research").toLowerCase()).toContain("researcher");
  });
  it("forbids fabrication in both modes", () => {
    expect(extractionPrompt("startup")).toContain("Never guess");
    expect(extractionPrompt("research")).toContain("Never guess");
  });
});
