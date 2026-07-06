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
  nameKey,
  emailKeyOf,
  contactKeys,
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
  it("richText is empty for null and splits >2000 chars into blocks", () => {
    expect(prop.richText(null)).toEqual({ rich_text: [] });
    const r = prop.richText("x".repeat(2500)) as { rich_text: { text: { content: string } }[] };
    expect(r.rich_text).toHaveLength(2);
    expect(r.rich_text[0].text.content.length).toBe(2000);
    expect(r.rich_text[1].text.content.length).toBe(500);
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

describe("dedupe keys", () => {
  it("nameKey is case/space-insensitive on name+entity", () => {
    expect(nameKey("Jane  Doe", "MIT Lab")).toBe(nameKey("jane doe", "mit lab"));
    expect(nameKey("A", "B")).toBe("ne:a|b");
  });
  it("emailKeyOf lowercases, or null when absent", () => {
    expect(emailKeyOf("J@X.EDU")).toBe("email:j@x.edu");
    expect(emailKeyOf(null)).toBe(null);
  });
  it("contactKeys always includes name+entity, plus email when present", () => {
    expect(contactKeys(mk({ contact_name: "A", entity_name: "B" }))).toEqual(["ne:a|b"]);
    expect(contactKeys(mk({ contact_name: "A", entity_name: "B", email: "a@b.co" }))).toEqual([
      "ne:a|b",
      "email:a@b.co",
    ]);
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
  it("collapses the same person listed with and without an email", () => {
    const out = dedupeBatch([
      mk({ contact_name: "Jane", entity_name: "MIT" }),
      mk({ contact_name: "Jane", entity_name: "MIT", email: "jane@x.edu" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("jane@x.edu");
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
  it("groups by name+entity and archives all but the most complete row", () => {
    const rows = [
      { pageId: "a", nameKey: "ne:jane|mit", keys: ["ne:jane|mit"], filled: 1 },
      { pageId: "b", nameKey: "ne:jane|mit", keys: ["ne:jane|mit", "email:j@x.edu"], filled: 3 },
      { pageId: "c", nameKey: "ne:solo|", keys: ["ne:solo|"], filled: 0 },
    ];
    // catches the email/no-email duplicate of the same person (a is archived, b kept)
    expect(duplicatePageIds(rows)).toEqual(["a"]);
  });
  it("returns nothing when there are no duplicates", () => {
    expect(duplicatePageIds([{ pageId: "a", nameKey: "k1", keys: ["k1"], filled: 0 }])).toEqual([]);
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
