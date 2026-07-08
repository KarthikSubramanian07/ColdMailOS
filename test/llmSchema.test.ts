import { describe, it, expect } from "vitest";
import {
  ContactZ,
  ExtractionZ,
  DraftZ,
  EmailHitZ,
  CONTACTS_JSON_SCHEMA,
  DRAFT_JSON_SCHEMA,
  EMAIL_JSON_SCHEMA,
} from "../src/llmSchema";

describe("ExtractionZ / ContactZ", () => {
  it("accepts a fully-null contact and a full one", () => {
    expect(
      ExtractionZ.safeParse({
        contacts: [
          {
            contact_name: null,
            role: null,
            entity_name: null,
            email: null,
            context_summary: null,
            backing_or_affiliation: null,
            profile_url: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(ContactZ.safeParse({ contact_name: "Jane", role: "Prof", entity_name: "MIT", email: "j@x.edu", context_summary: "AI", backing_or_affiliation: null, profile_url: null }).success).toBe(true);
  });
  it("rejects a missing required key (strict shape)", () => {
    expect(ExtractionZ.safeParse({ contacts: [{ contact_name: "Jane" }] }).success).toBe(false);
    expect(ExtractionZ.safeParse({}).success).toBe(false);
  });
});

describe("DraftZ", () => {
  it("requires subject and body", () => {
    expect(DraftZ.safeParse({ subject: "S", body: "B" }).success).toBe(true);
    expect(DraftZ.safeParse({ subject: "S" }).success).toBe(false);
  });
});

describe("EmailHitZ", () => {
  it("allows string or null", () => {
    expect(EmailHitZ.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(EmailHitZ.safeParse({ email: null }).success).toBe(true);
  });
});

describe("Groq JSON schema literals", () => {
  it("are strict with additionalProperties:false and all-required", () => {
    for (const s of [CONTACTS_JSON_SCHEMA, DRAFT_JSON_SCHEMA, EMAIL_JSON_SCHEMA]) {
      expect(s.strict).toBe(true);
      expect(s.schema.additionalProperties).toBe(false);
      expect(Array.isArray(s.schema.required)).toBe(true);
    }
  });
});
