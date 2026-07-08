import type { Contact, DraftResult, Env, Mode, ProfileConfig } from "../types";
import { groqJson } from "../groqClient";
import { DRAFT_JSON_SCHEMA, DraftZ } from "../llmSchema";

const BANNED = `BANNED phrases: "I came across your profile", "I was impressed by your work", "I love what you're building", "I hope this email finds you well", "reach out", "align with", "passionate about", "delve", "in today's fast-paced".`;

const RESEARCH_SYSTEM = `You write short, sincere research-outreach emails on behalf of a person contacting an academic.

Hard rules:
  - Reference the recipient's SPECIFIC work (given as "context"). Never use generic praise.
  - Under 200 words in the body. Every sentence earns its place.
  - Ground the sender's fit in their real background/interests. Do not invent accomplishments.
  - End with ONE clear, low-pressure ask (e.g. whether they're taking students, or a short chat).
  - Plain, human, specific. No corporate tone.
  - ${BANNED}
  - If a signature is provided, end the body with it verbatim. Otherwise sign with the sender's name.
  - Return STRICT JSON: {"subject": "...", "body": "..."}. The body uses real newlines between paragraphs.`;

const STARTUP_SYSTEM = `You write short, confident cold emails on behalf of a person contacting a startup founder about joining their team or exploring opportunities.

Hard rules:
  - Reference the company's SPECIFIC work (given as "context"). Never use generic flattery.
  - Connect relevant, real background from the sender's profile to what the company does. Do not invent accomplishments.
  - If the sender stated an opportunity type (internship / full-time), reflect it.
  - If backing/affiliation is known (e.g. YC-backed), a brief nod is fine, but don't make it the focus.
  - Under 150 words in the body. Confident, not fawning.
  - End with ONE clear, low-pressure ask (e.g. "would love 15 minutes to learn more" or "happy to share my resume if there's a fit").
  - ${BANNED}
  - If a signature is provided, end the body with it verbatim. Otherwise sign with the sender's name.
  - Return STRICT JSON: {"subject": "...", "body": "..."}. The body uses real newlines between paragraphs.`;

export function systemPrompt(mode: Mode): string {
  return mode === "startup" ? STARTUP_SYSTEM : RESEARCH_SYSTEM;
}

/** Draft a personalized outreach email for one contact, per mode. */
export async function draftEmail(
  env: Env,
  contact: Contact,
  profile: ProfileConfig,
): Promise<DraftResult> {
  const content = await groqJson(
    env,
    [
      { role: "system", content: systemPrompt(profile.mode) },
      { role: "user", content: buildUserPrompt(contact, profile) },
    ],
    { temperature: 0.6, schema: DRAFT_JSON_SCHEMA },
  );
  return parseDraft(content, profile);
}

export function buildUserPrompt(contact: Contact, profile: ProfileConfig): string {
  const recipientLabel = profile.mode === "startup" ? "FOUNDER / COMPANY" : "RECIPIENT";
  const lines = [
    ` ${recipientLabel} `,
    `Name: ${contact.contact_name}`,
    contact.role ? `Role: ${contact.role}` : null,
    contact.entity_name ? `Entity: ${contact.entity_name}` : null,
    contact.backing_or_affiliation ? `Backing/affiliation: ${contact.backing_or_affiliation}` : null,
    `Context: ${contact.context_summary ?? "(not stated - keep it brief and honest)"}`,
    "",
    " SENDER (the person emailing) ",
    `Name: ${profile.name}`,
    `Background: ${profile.background}`,
    `Interests / goals: ${profile.interests}`,
    profile.opportunityType ? `Opportunity type: ${profile.opportunityType}` : null,
    profile.resumeText ? `Resume/CV highlights: ${profile.resumeText}` : null,
    profile.tone ? `Voice/tone: ${profile.tone}` : null,
    profile.signature ? `Signature (use verbatim at the end):\n${profile.signature}` : null,
    "",
    "Write the email now. Return only the JSON object.",
  ];
  return lines.filter(Boolean).join("\n");
}

export function parseDraft(content: string, profile: ProfileConfig): DraftResult {
  try {
    const parsed = DraftZ.safeParse(JSON.parse(content));
    if (parsed.success) {
      const subject = parsed.data.subject.trim();
      const body = parsed.data.body.trim();
      if (subject && body) return { subject, body };
    }
  } catch {
    // fall through
  }
  // Last-resort fallback so the pipeline never hard-fails on a malformed draft.
  return {
    subject: "Interest in your work",
    body: `Hi,\n\nI'd love to learn more about your work.\n\nBest,\n${profile.name}`,
  };
}
