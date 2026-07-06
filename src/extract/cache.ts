import type { Env } from "../types";
import { KV_KEYS } from "../config";

/** SHA-256 hex digest of a string (used as a page content fingerprint). */
export async function hashText(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True if the page content is byte-identical to the last time we saw it. */
export async function isUnchanged(env: Env, url: string, hash: string): Promise<boolean> {
  const previous = await env.KV.get(KV_KEYS.hash(url));
  return previous === hash;
}

/** Record the current content hash so unchanged pages are skipped next run. */
export async function saveHash(env: Env, url: string, hash: string): Promise<void> {
  await env.KV.put(KV_KEYS.hash(url), hash);
}
