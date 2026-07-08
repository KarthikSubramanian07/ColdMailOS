import type { Env } from "../types";
import { USER_AGENT } from "./robots";

/** Safety cap on total page text (very large pages are chunked by the caller). */
const MAX_TEXT_CHARS = 250_000;
/** Below this, a page is likely a JS-rendered shell; try a renderer if configured. */
const THIN_SHELL_CHARS = 600;

/**
 * Fetch a URL and return readable plain text (boilerplate stripped).
 *
 * Default path is a plain fetch + readability-style strip (free, no deps). If
 * that yields a thin shell (a JavaScript-rendered SPA returns almost no text to
 * a plain fetch) AND a Jina Reader key is configured, we escalate to Jina,
 * which renders JS server-side and returns clean markdown. The native result is
 * always the fallback, so the tool works fully without any renderer key.
 */
export async function fetchPage(url: string, env?: Env): Promise<string> {
  const native = await fetchNative(url);
  if (native.length >= THIN_SHELL_CHARS || !env?.JINA_API_KEY) return native;
  try {
    const rendered = await fetchViaJina(url, env.JINA_API_KEY);
    return rendered.length > native.length ? rendered : native;
  } catch {
    return native; // renderer failed/blocked: keep whatever the native path got
  }
}

async function fetchNative(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status} ${res.statusText}) for ${url}`);
  return htmlToText(await res.text());
}

/** Render a JS page to clean markdown via Jina Reader (r.jina.ai). */
async function fetchViaJina(url: string, apiKey: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Return-Format": "markdown",
      "X-With-Links-Summary": "true", // append a deduped href/mailto footer
      "X-Timeout": "30",
    },
  });
  if (!res.ok) throw new Error(`Jina Reader failed (${res.status})`);
  const text = await res.text();
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

/**
 * Lightweight readability-style extraction. We deliberately keep this simple
 * (no DOM parser in the Worker runtime) but do two things that matter for
 * this use case:
 *   1. Preserve `mailto:` addresses and anchor targets as inline text, because
 *      emails and profile links usually live in <a href> attributes.
 *   2. Drop nav/header/footer/script/style noise before flattening tags.
 */
export function htmlToText(html: string): string {
  let s = html;

  // Surface useful hrefs BEFORE we destroy the tags. Note: no angle brackets -
  // the tag-stripper below would delete anything that looks like "<...>", which
  // would drop the email we're trying to preserve.
  //   <a href="mailto:x@y.edu">Name</a>  ->  "Name x@y.edu"
  s = s.replace(
    /<a\b[^>]*href\s*=\s*["']mailto:([^"'?]+)[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, email, inner) => `${stripTags(inner)} ${decodeEntities(email)}`,
  );
  //   <a href="https://.../~jdoe">Jane Doe</a>  ->  "Jane Doe (https://.../~jdoe)"
  s = s.replace(
    /<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => `${stripTags(inner)} (${decodeEntities(href)})`,
  );

  // Remove clearly non-content regions.
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Turn block boundaries into newlines so people/rows stay separated.
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*\/?>/gi, "\n");

  s = stripTags(s);
  s = decodeEntities(s);

  // Collapse whitespace while keeping line structure.
  s = s
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) : s;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
}
