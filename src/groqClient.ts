import type { Env } from "./types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string };
}

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqOptions {
  temperature?: number;
  /** A JSON Schema ({name, strict, schema}). When set, uses structured outputs. */
  schema?: object;
  maxTokens?: number;
}

/**
 * One place for Groq chat completions. When `schema` is given it uses
 * structured outputs (`response_format: json_schema`, strict) so the model is
 * constrained to emit valid, schema-shaped JSON; otherwise it falls back to
 * plain JSON mode. Retries 429/5xx with backoff (honoring Retry-After) and
 * returns the assistant message content. Throws on a terminal error.
 */
export async function groqJson(
  env: Env,
  messages: GroqMessage[],
  opts: GroqOptions = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: env.GROQ_MODEL,
    temperature: opts.temperature ?? 0,
    max_completion_tokens: opts.maxTokens ?? 8000,
    messages,
    response_format: opts.schema
      ? { type: "json_schema", json_schema: opts.schema }
      : { type: "json_object" },
  };
  // gpt-oss reasoning models take a reasoning_effort; "low" is plenty for
  // extraction/drafting and keeps latency and cost down. Only send it when the
  // model supports it so swapping to a non-reasoning model won't 400.
  if (env.GROQ_MODEL.includes("gpt-oss")) body.reasoning_effort = "low";

  const payload = JSON.stringify(body);
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
