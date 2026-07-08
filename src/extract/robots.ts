import robotsParser from "robots-parser";
import type { Env } from "../types";

/** One honest identity, reused for the robots check and every page fetch. */
export const USER_AGENT =
  "ColdMailOS/0.1 (+https://github.com/KarthikSubramanian07/ColdMailOS) - public contact directory reader";

/** The product token robots.txt groups are matched against. */
const BOT_TOKEN = "ColdMailOS";
/** Cache each origin's robots.txt for a day (KV reads are off the subrequest budget). */
const ROBOTS_TTL = 24 * 60 * 60;

interface RobotsCache {
  mode: "rules" | "allow" | "block";
  body?: string;
}

export interface RobotsVerdict {
  allowed: boolean;
  crawlDelayMs: number;
  /** True only when we had to fetch robots.txt this call (a cache miss = 1 subrequest). */
  fetched: boolean;
}

/**
 * Whether we may crawl `url`, plus any crawl-delay. robots.txt is fetched once
 * per origin and cached in KV. Missing/invalid robots.txt => allow (per RFC
 * 9309); a 5xx or network error => skip the site, to stay polite.
 */
export async function checkRobots(env: Env, url: string): Promise<RobotsVerdict> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { allowed: false, crawlDelayMs: 0, fetched: false };
  }

  const key = `robots:${origin}`;
  const hit = await env.KV.get(key); // KV read: not a subrequest
  let cache: RobotsCache;
  let fetched = false;
  if (hit !== null) {
    cache = JSON.parse(hit) as RobotsCache;
  } else {
    cache = await fetchRobots(origin);
    fetched = true;
    await env.KV.put(key, JSON.stringify(cache), { expirationTtl: ROBOTS_TTL });
  }

  if (cache.mode === "allow") return { allowed: true, crawlDelayMs: 0, fetched };
  if (cache.mode === "block") return { allowed: false, crawlDelayMs: 0, fetched };

  const robots = robotsParser(`${origin}/robots.txt`, cache.body ?? "");
  const allowed = robots.isAllowed(url, BOT_TOKEN) ?? true; // undefined => allowed
  const crawlDelayMs = (robots.getCrawlDelay(BOT_TOKEN) ?? 0) * 1000;
  return { allowed, crawlDelayMs, fetched };
}

async function fetchRobots(origin: string): Promise<RobotsCache> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    if (res.ok) return { mode: "rules", body: await res.text() }; // 2xx
    if (res.status >= 400 && res.status < 500) return { mode: "allow" }; // no file => allow
    return { mode: "block" }; // 5xx => skip, stay polite
  } catch {
    return { mode: "block" }; // network error => skip
  }
}
