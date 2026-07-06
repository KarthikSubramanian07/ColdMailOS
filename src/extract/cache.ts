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
 * Extraction cache, keyed by page content hash. Lets a run that only partially
 * synced a big page reuse the extraction on the next run instead of calling the
 * LLM again. KV ops don't count against the subrequest budget. 30-day TTL.
 */
export async function getCachedContacts(env: Env, hash: string): Promise<Contact[] | null> {
  const raw = await env.KV.get(KV_KEYS.contacts(hash));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Contact[];
  } catch {
    return null;
  }
}

export async function putCachedContacts(env: Env, hash: string, contacts: Contact[]): Promise<void> {
  await env.KV.put(KV_KEYS.contacts(hash), JSON.stringify(contacts), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}
