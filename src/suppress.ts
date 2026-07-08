import type { Env } from "./types";
import { timingSafeEqual } from "./security";

/**
 * Suppression list: addresses that should never be drafted to (opt-outs,
 * bounces, "remove me"). Stored in KV. Unsubscribe links carry an HMAC token so
 * only URLs we generated can suppress an address (no open suppression endpoint).
 */

const norm = (email: string) => email.trim().toLowerCase();

export async function isSuppressed(env: Env, email: string): Promise<boolean> {
  return (await env.KV.get(`suppress:${norm(email)}`)) !== null;
}

export async function suppress(env: Env, email: string): Promise<void> {
  await env.KV.put(`suppress:${norm(email)}`, "1");
}

/** HMAC-SHA256(email) hex, used as the unsubscribe-link token. */
export async function unsubscribeToken(secret: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(norm(email)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyUnsubscribe(
  secret: string,
  email: string,
  token: string,
): Promise<boolean> {
  return timingSafeEqual(await unsubscribeToken(secret, email), token);
}

/** Build the unsubscribe URL embedded in the List-Unsubscribe header. */
export async function unsubscribeUrl(origin: string, secret: string, email: string): Promise<string> {
  const t = await unsubscribeToken(secret, email);
  return `${origin}/unsubscribe?e=${encodeURIComponent(norm(email))}&t=${t}`;
}
