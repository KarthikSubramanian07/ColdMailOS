import type { Env } from "./types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * One place for Groq chat completions in JSON mode: sends the messages, retries
 * on rate limits (429) and transient 5xx with backoff (honoring Retry-After),
 * and returns the assistant message content. Throws on a terminal error.
 */
export async function groqJson(env: Env, messages: GroqMessage[], temperature = 0): Promise<string> {
  const payload = JSON.stringify({
    model: env.GROQ_MODEL,
    temperature,
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
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
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
