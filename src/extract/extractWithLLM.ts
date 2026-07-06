import type { Env, Person } from "../types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You extract people from academic web pages. You are precise and never invent information.

Extract every researcher, faculty member, or lab member mentioned on the page.
For each person return these fields:
  - name:           their full name.
  - title:          their role/title if stated (e.g. "Associate Professor", "PhD student"), else null.
  - email:          ONLY if an email address is explicitly shown on the page. Never guess, never infer from a name/domain pattern. If no email is visibly present, use null.
  - research_focus: one or two sentences describing their research, using ONLY information present on the page. If none is stated, use null.
  - profile_url:    the URL of their personal/profile page if one is linked on the page, else null.

Rules:
  - Do NOT fabricate any field. When in doubt, use null.
  - Do NOT include administrative staff, generic contact addresses (info@, admin@), or navigation links as "people".
  - Return STRICT JSON, an object of the form: {"people": [ {name, title, email, research_focus, profile_url}, ... ]}.
  - If the page lists no identifiable people, return {"people": []}.`;

interface GroqChoice {
  message?: { content?: string };
}
interface GroqResponse {
  choices?: GroqChoice[];
  error?: { message?: string };
}

/** Run structured extraction over one page's plain text. */
export async function extractPeople(env: Env, pageText: string, sourceUrl: string): Promise<Person[]> {
  if (!pageText.trim()) return [];

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `PAGE URL: ${sourceUrl}\n\nPAGE TEXT:\n${pageText}` },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq extraction failed (${res.status}) for ${sourceUrl}: ${detail}`);
  }

  const data = (await res.json()) as GroqResponse;
  if (data.error) throw new Error(`Groq error: ${data.error.message}`);

  const content = data.choices?.[0]?.message?.content ?? "{}";
  const people = parsePeople(content);

  return people.map((p) => normalizePerson(p, sourceUrl));
}

function parsePeople(content: string): Partial<Person>[] {
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return [];
  }
  const arr = Array.isArray(obj)
    ? obj
    : Array.isArray((obj as { people?: unknown }).people)
      ? (obj as { people: unknown[] }).people
      : [];
  return arr.filter((x): x is Partial<Person> => !!x && typeof x === "object");
}

function normalizePerson(p: Partial<Person>, sourceUrl: string): Person {
  const clean = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t && t.toLowerCase() !== "null" && t.toLowerCase() !== "n/a" ? t : null;
  };
  const name = clean(p.name) ?? "";
  const email = clean(p.email);
  return {
    name,
    title: clean(p.title),
    // Guard against a fabricated address slipping through: require a real-looking email.
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.toLowerCase() : null,
    research_focus: clean(p.research_focus),
    profile_url: clean(p.profile_url),
    source_url: sourceUrl,
  };
}
