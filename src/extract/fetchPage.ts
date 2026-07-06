const USER_AGENT =
  "ResearchMailOS/0.1 (+https://github.com/researchmailos/researchmailos) — public directory reader";

/** Max characters of page text handed to the LLM (keeps token usage bounded). */
const MAX_TEXT_CHARS = 14_000;

/** Fetch a URL and return readable plain text (boilerplate stripped). */
export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status} ${res.statusText}) for ${url}`);

  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  // Non-HTML (e.g. a PDF served as text) — pass through, still stripped/truncated.
  return htmlToText(contentType.includes("html") ? raw : raw);
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

  // Surface useful hrefs BEFORE we destroy the tags.
  //   <a href="mailto:x@y.edu">Name</a>  →  "Name <x@y.edu>"
  s = s.replace(
    /<a\b[^>]*href\s*=\s*["']mailto:([^"'?]+)[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, email, inner) => `${stripTags(inner)} <${decodeEntities(email)}>`,
  );
  //   <a href="https://…/~jdoe">Jane Doe</a>  →  "Jane Doe (https://…/~jdoe)"
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
