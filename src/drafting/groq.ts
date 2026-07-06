import type { DraftResult, Env, Person, ProfileConfig } from "../types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You write short, sincere research outreach emails on behalf of a person reaching out to an academic.

Hard rules:
  - Reference the recipient's SPECIFIC research focus (given below). Never use generic praise or vague admiration.
  - Under 200 words in the body. Every sentence earns its place.
  - Ground the sender's fit in their actual background/interests. Do not invent accomplishments.
  - End with ONE clear, low-pressure ask (e.g. whether they're taking students, or a short chat).
  - Plain, human, specific. No corporate tone.
  - BANNED phrases: "I came across your profile", "I was impressed by your work", "I hope this email finds you well", "reach out", "align with", "passionate about", "delve", "in today's fast-paced".
  - If a signature is provided, end the body with it verbatim. Otherwise sign with the sender's name.
  - Return STRICT JSON: {"subject": "...", "body": "..."}. The body uses real newlines between paragraphs.`;

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** Draft a personalized outreach email for one researcher. */
export async function draftEmail(
  env: Env,
  person: Person,
  profile: ProfileConfig,
): Promise<DraftResult> {
  const userPrompt = buildUserPrompt(person, profile);

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq drafting failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as GroqResponse;
  if (data.error) throw new Error(`Groq error: ${data.error.message}`);

  const content = data.choices?.[0]?.message?.content ?? "{}";
  return parseDraft(content, profile);
}

function buildUserPrompt(person: Person, profile: ProfileConfig): string {
  const lines = [
    "── RECIPIENT ──",
    `Name: ${person.name}`,
    person.title ? `Title: ${person.title}` : null,
    person.institution ? `Institution/Lab: ${person.institution}` : null,
    `Research focus: ${person.research_focus ?? "(not stated — write generally but honestly, and keep it brief)"}`,
    "",
    "── SENDER (the person emailing) ──",
    `Name: ${profile.name}`,
    `Background: ${profile.background}`,
    `Research interests: ${profile.researchInterests}`,
    profile.resumeText ? `CV highlights: ${profile.resumeText}` : null,
    profile.tone ? `Voice/tone: ${profile.tone}` : null,
    profile.signature ? `Signature (use verbatim at the end):\n${profile.signature}` : null,
    "",
    "Write the email now. Return only the JSON object.",
  ];
  return lines.filter(Boolean).join("\n");
}

function parseDraft(content: string, profile: ProfileConfig): DraftResult {
  try {
    const obj = JSON.parse(content) as Partial<DraftResult>;
    const subject = (obj.subject ?? "").trim();
    const body = (obj.body ?? "").trim();
    if (subject && body) return { subject, body };
  } catch {
    // fall through
  }
  // Last-resort fallback so the pipeline never hard-fails on a malformed draft.
  return {
    subject: `Interest in your research`,
    body: `Hi,\n\nI'd love to learn more about your work.\n\nBest,\n${profile.name}`,
  };
}
