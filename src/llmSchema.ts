import { z } from "zod";

/**
 * Schemas for LLM output. We send a JSON Schema to Groq's structured-outputs
 * mode (`response_format: json_schema`, strict) so the model is constrained at
 * decode time to emit valid, schema-shaped JSON, and we validate the result
 * with the matching zod schema as a second line of defense (and for types).
 *
 * Strict-mode rules: every object needs additionalProperties:false and lists
 * every property in `required`; "optional" is expressed as a nullable type.
 */

// ── Extraction ───────────────────────────────────────────────────────────────

export const ContactZ = z.object({
  contact_name: z.string().nullable(),
  role: z.string().nullable(),
  entity_name: z.string().nullable(),
  email: z.string().nullable(),
  context_summary: z.string().nullable(),
  backing_or_affiliation: z.string().nullable(),
  profile_url: z.string().nullable(),
});
export const ExtractionZ = z.object({ contacts: z.array(ContactZ) });

const nullableStr = { type: ["string", "null"] } as const;

export const CONTACTS_JSON_SCHEMA = {
  name: "contacts_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["contacts"],
    properties: {
      contacts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "contact_name",
            "role",
            "entity_name",
            "email",
            "context_summary",
            "backing_or_affiliation",
            "profile_url",
          ],
          properties: {
            contact_name: nullableStr,
            role: nullableStr,
            entity_name: nullableStr,
            email: nullableStr,
            context_summary: nullableStr,
            backing_or_affiliation: nullableStr,
            profile_url: nullableStr,
          },
        },
      },
    },
  },
} as const;

// ── Drafting ─────────────────────────────────────────────────────────────────

export const DraftZ = z.object({ subject: z.string(), body: z.string() });

export const DRAFT_JSON_SCHEMA = {
  name: "email_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body"],
    properties: { subject: { type: "string" }, body: { type: "string" } },
  },
} as const;

// ── Email hunt (startup fallback) ────────────────────────────────────────────

export const EmailHitZ = z.object({ email: z.string().nullable() });

export const EMAIL_JSON_SCHEMA = {
  name: "email_hunt",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["email"],
    properties: { email: nullableStr },
  },
} as const;
