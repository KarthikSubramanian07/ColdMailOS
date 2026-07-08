import type { Env } from "./types";
import { NotionClient, prop, readNumber } from "./notion/client";
import { PROPS } from "./notion/schema";

/**
 * Optional engagement tracking (both OFF by default; opt-in per the README).
 *   Clicks: links are rewritten through /c/<id>, which records the click and
 *           302-redirects to the target. Reliable.
 *   Opens:  a 1x1 pixel at /o/<id>. Unreliable (Apple/Gmail proxy + prefetch)
 *           and only works in an HTML email; included only when enabled.
 * A random tracking id maps to the Notion page in KV so the routes can bump
 * the Opened/Clicked counts.
 */

const TRACK_TTL = 60 * 60 * 24 * 180; // keep the id->page mapping for ~6 months

export function newTrackId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function registerTracking(env: Env, trackId: string, pageId: string): Promise<void> {
  await env.KV.put(`track:${trackId}`, pageId, { expirationTtl: TRACK_TTL });
}

/** Record an open or click against the mapped Notion row. Safe to call in waitUntil. */
export async function recordEvent(
  env: Env,
  trackId: string,
  kind: "opened" | "clicked",
  nowMs: number,
): Promise<void> {
  const pageId = await env.KV.get(`track:${trackId}`);
  if (!pageId) return;
  const notion = new NotionClient(env);
  const page = await notion.getPage(pageId);
  const propName = kind === "opened" ? PROPS.opened : PROPS.clicked;
  const current = readNumber(page, propName) ?? 0;
  await notion.updatePage(pageId, {
    [propName]: prop.number(current + 1),
    [PROPS.lastActivity]: prop.date(new Date(nowMs).toISOString().slice(0, 10)),
  });
}

/** Build an HTML body: escaped text, links rewritten for click tracking, + open pixel. */
export function toTrackedHtml(
  origin: string,
  trackId: string,
  body: string,
  opts: { clicks: boolean; opens: boolean },
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = esc(body).replace(/https?:\/\/[^\s<]+/g, (u) => {
    const href = opts.clicks ? `${origin}/c/${trackId}?u=${encodeURIComponent(u)}` : u;
    return `<a href="${href}">${u}</a>`;
  });
  html = html.replace(/\n/g, "<br>\n");
  if (opts.opens) html += `\n<img src="${origin}/o/${trackId}" width="1" height="1" alt="">`;
  return `<div>${html}</div>`;
}

/** A 1x1 transparent GIF for the open pixel. */
export function pixelResponse(): Response {
  const gif = Uint8Array.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  ]);
  return new Response(gif, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
