import type { Contact, Env, Mode } from "../types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const COMMON_RULES = `Rules:
  - Do NOT fabricate any field. When in doubt, use null.
  - email: ONLY if an address is explicitly shown on the page. Never guess or infer from a name/domain pattern. If none is visible, use null.
  - Do NOT include generic contact addresses (info@, admin@, hello@) or navigation links as people.
  - Return STRICT JSON: {"contacts": [ {contact_name, role, entity_name, email, context_summary, backing_or_affiliation, profile_url}, ... ]}.
  - If the page lists no identifiable contacts, return {"contacts": []}.`;

const RESEARCH_PROMPT = `You extract researchers from academic web pages. You are precise and never invent information.

For each researcher, faculty member, or lab member on the page, return:
  - contact_name:            their full name.
  - role:                    their title if stated (e.g. "Associate Professor", "PhD student"), else null.
  - entity_name:             their lab, department, or institution, else null.
  - email:                   see rules.
  - context_summary:         one or two sentences on their research, using ONLY page content. Else null.
  - backing_or_affiliation:  a named center/group/affiliation if stated (e.g. "BAIR", "CHAI"), else null.
  - profile_url:             their personal/profile page if linked, else null.

${COMMON_RULES}`;

const STARTUP_PROMPT = `You extract startups and their founders from web pages such as VC portfolio pages or accelerator batch pages. You are precise and never invent information.

For each company on the page, return one entry:
  - contact_name:            the founder's name if listed, else null.
  - role:                    the founder's title (e.g. "Co-founder & CEO"), else null.
  - entity_name:             the company/startup name.
  - email:                   see rules (portfolio pages rarely show one — that's fine, use null).
  - context_summary:         one or two sentences on what the company does, using ONLY page content. Else null.
  - backing_or_affiliation:  the VC firm or accelerator backing them, inferred from page context (e.g. "YC W26", "a16z-backed", or the fund's own name). Else null.
  - profile_url:             the company's website URL if linked, else null.

${COMMON_RULES}`;

const EMAIL_HUNT_PROMPT = `You are given the text of a company website page. Find a single best contact or careers email address that is EXPLICITLY shown on the page (e.g. careers@, jobs@, hello@, or a founder's address). Do not guess or construct an address from a name/domain. Return STRICT JSON: {"email": "<address>"} or {"email": null} if none is visibly present.`;

export function extractionPrompt(mode: Mode): string {
  return mode === "startup" ? STARTUP_PROMPT : RESEARCH_PROMPT;
}

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** Run structured extraction over one page's plain text, per mode. */
export async function extractContacts(
  env: Env,
  pageText: string,
  sourceUrl: string,
  mode: Mode,
): Promise<Contact[]> {
  if (!pageText.trim()) return [];

  const content = await callGroq(env, [
    { role: "system", content: extractionPrompt(mode) },
    { role: "user", content: `PAGE URL: ${sourceUrl}\n\nPAGE TEXT:\n${pageText}` },
  ]);

  return parseContacts(content).map((c) => normalizeContact(c, sourceUrl));
}

/** Startup fallback: look for a visible contact/careers email on a company page. */
export async function huntEmail(env: Env, pageText: string): Promise<string | null> {
  if (!pageText.trim()) return null;
  const content = await callGroq(env, [
    { role: "system", content: EMAIL_HUNT_PROMPT },
    { role: "user", content: pageText },
  ]);
  try {
    const email = (JSON.parse(content) as { email?: unknown }).email;
    return typeof email === "string" ? validEmail(email) : null;
  } catch {
    return null;
  }
}

/** POST to Groq with json_object mode, retrying on 429/5xx with backoff. */
async function callGroq(env: Env, messages: { role: string; content: string }[]): Promise<string> {
  const payload = JSON.stringify({
    model: env.GROQ_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages,
  });

  let res: Response | null = null;
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: payload,
    });
    if (res.status !== 429 && res.status < 500) break;
    if (attempt === maxAttempts - 1) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
    await new Promise((r) => setTimeout(r, waitMs + 300));
  }

  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => "") : "no response";
    throw new Error(`Groq call failed (${res?.status}): ${detail}`);
  }
  const data = (await res.json()) as GroqResponse;
  if (data.error) throw new Error(`Groq error: ${data.error.message}`);
  return data.choices?.[0]?.message?.content ?? "{}";
}

export function parseContacts(content: string): Partial<Contact>[] {
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return [];
  }
  const arr = Array.isArray(obj)
    ? obj
    : Array.isArray((obj as { contacts?: unknown }).contacts)
      ? (obj as { contacts: unknown[] }).contacts
      : [];
  return arr.filter((x): x is Partial<Contact> => !!x && typeof x === "object");
}

export function normalizeContact(c: Partial<Contact>, sourceUrl: string): Contact {
  return {
    contact_name: clean(c.contact_name) ?? "",
    role: clean(c.role),
    entity_name: clean(c.entity_name),
    email: c.email ? validEmail(String(c.email)) : null,
    context_summary: clean(c.context_summary),
    backing_or_affiliation: clean(c.backing_or_affiliation),
    profile_url: clean(c.profile_url),
    source_url: sourceUrl,
  };
}

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "null" && t.toLowerCase() !== "n/a" ? t : null;
}

/** Guard against a fabricated address: require a real-looking email. */
export function validEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}
