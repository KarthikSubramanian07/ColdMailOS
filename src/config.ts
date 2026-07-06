import type { Env, Mode, ProfileConfig } from "./types";

/**
 * Per-user config lives in KV, not in the repo. It is pushed once with
 * `npm run config:push` (see scripts/push-config.mjs). Keys:
 *   config:source-urls  → string[]      (your list of pages to scrape)
 *   config:profile      → ProfileConfig (your mode + background / voice)
 */
export const KV_KEYS = {
  sourceUrls: "config:source-urls",
  profile: "config:profile",
  hash: (url: string) => `hash:${url}`,
} as const;

export async function loadSourceUrls(env: Env): Promise<string[]> {
  const raw = await env.KV.get(KV_KEYS.sourceUrls);
  if (!raw) {
    throw new Error(
      `No source URLs found in KV ('${KV_KEYS.sourceUrls}'). Run \`npm run config:push\` first.`,
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("config:source-urls must be a JSON array of URLs.");
  return parsed.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
}

export async function loadProfile(env: Env): Promise<ProfileConfig> {
  const raw = await env.KV.get(KV_KEYS.profile);
  if (!raw) {
    throw new Error(
      `No profile found in KV ('${KV_KEYS.profile}'). Run \`npm run config:push\` first.`,
    );
  }
  const parsed = JSON.parse(raw) as ProfileConfig;
  if (!parsed.name || !parsed.background || !parsed.interests) {
    throw new Error("config:profile must include name, background, and interests.");
  }
  parsed.mode = normalizeMode(parsed.mode);
  return parsed;
}

/** Read just the mode for the scrape (extraction). Defaults to "research". */
export async function loadMode(env: Env): Promise<Mode> {
  const raw = await env.KV.get(KV_KEYS.profile);
  if (!raw) return "research";
  try {
    return normalizeMode((JSON.parse(raw) as ProfileConfig).mode);
  } catch {
    return "research";
  }
}

const normalizeMode = (m: unknown): Mode =>
  typeof m === "string" && m.trim() ? (m.trim().toLowerCase() as Mode) : "research";

/** Parse a "true"/"false" string var into a boolean. */
export const boolVar = (v: string | undefined): boolean => v?.toLowerCase() === "true";

/** Parse a numeric string var, falling back to a default. */
export const intVar = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};
