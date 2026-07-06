import { describe, it, expect } from "vitest";
import {
  prop,
  readTitle,
  readRichText,
  readEmail,
  readUrl,
  readCheckbox,
  type NotionPage,
} from "../src/notion/client";
import {
  dedupeKey,
  contactKey,
  dedupeBatch,
  duplicatePageIds,
  contactToProperties,
} from "../src/notion/sync";
import type { Contact } from "../src/types";

const mk = (o: Partial<Contact>): Contact => ({
  contact_name: "",
  role: null,
  entity_name: null,
  email: null,
  context_summary: null,
  backing_or_affiliation: null,
  profile_url: null,
  ...o,
});

describe("prop builders", () => {
  it("title wraps content", () => {
    expect(prop.title("Jane")).toEqual({ title: [{ text: { content: "Jane" } }] });
  });
  it("richText is empty for null and truncates >2000 chars", () => {
    expect(prop.richText(null)).toEqual({ rich_text: [] });
    const r = prop.richText("x".repeat(2500)) as { rich_text: { text: { content: string } }[] };
    expect(r.rich_text[0].text.content.length).toBe(2000);
  });
  it("email is null when empty", () => {
    expect(prop.email("")).toEqual({ email: null });
    expect(prop.email("a@b.co")).toEqual({ email: "a@b.co" });
  });
  it("url/select/checkbox", () => {
    expect(prop.url("")).toEqual({ url: null });
    expect(prop.select("Not Contacted")).toEqual({ select: { name: "Not Contacted" } });
    expect(prop.checkbox(true)).toEqual({ checkbox: true });
  });
});

describe("property readers", () => {
  const page: NotionPage = {
    id: "1",
    properties: {
      Name: { title: [{ plain_text: "Jane" }, { plain_text: " Doe" }] },
      Focus: { rich_text: [{ plain_text: "AI safety" }] },
      Email: { email: "j@x.edu" },
      Link: { url: "https://x.edu" },
      Flag: { checkbox: true },
    },
  };
  it("reads each property type", () => {
    expect(readTitle(page, "Name")).toBe("Jane Doe");
    expect(readRichText(page, "Focus")).toBe("AI safety");
    expect(readEmail(page, "Email")).toBe("j@x.edu");
    expect(readUrl(page, "Link")).toBe("https://x.edu");
    expect(readCheckbox(page, "Flag")).toBe(true);
  });
  it("returns safe defaults for missing properties", () => {
    expect(readTitle(page, "Nope")).toBe("");
    expect(readEmail(page, "Nope")).toBe(null);
    expect(readCheckbox(page, "Nope")).toBe(false);
  });
});

describe("dedupeKey / contactKey", () => {
  it("prefers email (lowercased)", () => {
    expect(dedupeKey("Jane", "MIT", "J@X.EDU")).toBe("email:j@x.edu");
  });
  it("falls back to name+entity, case/space-insensitive", () => {
    expect(dedupeKey("Jane  Doe", "MIT Lab", null)).toBe(dedupeKey("jane doe", "mit lab", null));
  });
  it("contactKey uses the contact's fields", () => {
    expect(contactKey(mk({ contact_name: "A", entity_name: "B" }))).toBe("ne:a|b");
  });
});

describe("dedupeBatch", () => {
  it("merges same-key contacts, preferring the longer summary and filling gaps", () => {
    const a = mk({ contact_name: "Jane", entity_name: "MIT", context_summary: "short" });
    const b = mk({ contact_name: "Jane", entity_name: "MIT", context_summary: "a much longer summary", role: "Prof" });
    const out = dedupeBatch([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].context_summary).toBe("a much longer summary");
    expect(out[0].role).toBe("Prof");
  });
  it("keeps distinct people separate", () => {
    const out = dedupeBatch([
      mk({ contact_name: "Jane", entity_name: "MIT" }),
      mk({ contact_name: "John", entity_name: "MIT" }),
    ]);
    expect(out).toHaveLength(2);
  });
  it("drops entries with no name", () => {
    expect(dedupeBatch([mk({ contact_name: "" })])).toHaveLength(0);
  });
});

describe("duplicatePageIds", () => {
  it("archives all but the most complete row per key", () => {
    const rows = [
      { pageId: "a", key: "email:j@x.edu", filled: 1 },
      { pageId: "b", key: "email:j@x.edu", filled: 3 },
      { pageId: "c", key: "ne:solo|", filled: 0 },
    ];
    expect(duplicatePageIds(rows)).toEqual(["a"]);
  });
  it("returns nothing when there are no duplicates", () => {
    expect(duplicatePageIds([{ pageId: "a", key: "k1", filled: 0 }])).toEqual([]);
  });
});

describe("contactToProperties", () => {
  it("maps a contact into the Notion schema", () => {
    const props = contactToProperties(
      mk({ contact_name: "Jane", context_summary: "AI", email: null, source_url: "https://s" }),
    ) as Record<string, any>;
    expect(props["Contact Name"].title[0].text.content).toBe("Jane");
    expect(props["Context Summary"].rich_text[0].text.content).toBe("AI");
    expect(props["Email"].email).toBe(null);
    expect(props["Source URL"].url).toBe("https://s");
    expect(props["Status"].select.name).toBe("Not Contacted");
    expect(props["Draft Email"].checkbox).toBe(false);
    expect(props["Remove"].checkbox).toBe(false);
  });
});
