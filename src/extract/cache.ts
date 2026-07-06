import type { Contact, Env } from "../types";
import { KV_KEYS } from "../config";

/** SHA-256 hex digest of a string (used as a page content fingerprint). */
export async function hashText(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True if the page content is byte-identical to the last FULLY-SYNCED run. */
export async function isUnchanged(env: Env, url: string, hash: string): Promise<boolean> {
  const previous = await env.KV.get(KV_KEYS.hash(url));
  return previous === hash;
}

/** Record the content hash so a fully-synced page is skipped next run. */
export async function saveHash(env: Env, url: string, hash: string): Promise<void> {
  await env.KV.put(KV_KEYS.hash(url), hash);
}

/**
 * Extraction state, keyed by page content hash. A big page is extracted a few
 * chunks per run (so one /scrape stays fast and never times out); progress is
 * persisted here so the next run resumes at `nextChunk` instead of re-calling
 * the LLM. `done` flips true once every chunk is extracted. KV ops don't count
 * against the subrequest budget. 30-day TTL.
 */
export interface ExtractionState {
  done: boolean;
  nextChunk: number;
  contacts: Contact[];
}

export async function getExtractionState(env: Env, hash: string): Promise<ExtractionState | null> {
  const raw = await env.KV.get(KV_KEYS.contacts(hash));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExtractionState;
  } catch {
    return null;
  }
}

export async function putExtractionState(
  env: Env,
  hash: string,
  state: ExtractionState,
): Promise<void> {
  await env.KV.put(KV_KEYS.contacts(hash), JSON.stringify(state), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}
