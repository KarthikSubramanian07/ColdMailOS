import type { Contact, Env, Mode } from "./types";
import { boolVar, intVar, loadMode, loadSourceUrls } from "./config";
import { fetchPage } from "./extract/fetchPage";
import { extractContacts, huntEmail } from "./extract/extractWithLLM";
import {
  hashText,
  isUnchanged,
  saveHash,
  getCachedContacts,
  putCachedContacts,
} from "./extract/cache";
import { NotionClient } from "./notion/client";
import {
  contactKey,
  contactToProperties,
  dedupeBatch,
  duplicatePageIds,
  loadExistingRows,
} from "./notion/sync";

export interface ScrapeReport {
  mode: Mode;
  urlsConfigured: number;
  urlsProcessed: number;
  urlsUnchanged: number;
  urlsFailed: number;
  created: number;
  skippedDuplicate: number;
  duplicatesArchived: number;
  emailsFoundViaFallback: number;
  stoppedEarly: boolean;
  errors: string[];
}

/** Subrequests reserved as headroom before the free-plan cap of 50. */
const SAFETY_MARGIN = 3;
/** Characters per LLM extraction chunk (large pages are split, then merged). */
const CHUNK_CHARS = 24_000;
const CHUNK_OVERLAP = 800;

/**
 * The scrape job. Fetches each page, skips unchanged ones (content hash),
 * extracts contacts per mode — CHUNKING large pages so nobody is truncated
 * away — then incrementally creates Notion rows within the free-plan
 * subrequest budget. Extractions are cached by content hash, so a big page
 * that needs several runs to fully sync is only sent to the LLM once. A page's
 * hash is saved ONLY when all its contacts are written. Also archives exact
 * duplicates.
 */
export async function runScrape(env: Env): Promise<ScrapeReport> {
  const urls = await loadSourceUrls(env);
  const mode = await loadMode(env);
  const maxPages = intVar(env.MAX_PAGES_PER_RUN, 200);
  const throttleMs = intVar(env.LLM_THROTTLE_MS, 2200);
  const enrichEnabled = mode === "startup" || boolVar(env.ENABLE_PROFILE_SECOND_PASS);
  const budgetMax = intVar(env.MAX_SUBREQUESTS, 45);
  const maxLlmPerRun = intVar(env.MAX_LLM_CALLS_PER_RUN, 6);

  const notion = new NotionClient(env);
  const report: ScrapeReport = {
    mode,
    urlsConfigured: urls.length,
    urlsProcessed: 0,
    urlsUnchanged: 0,
    urlsFailed: 0,
    created: 0,
    skippedDuplicate: 0,
    duplicatesArchived: 0,
    emailsFoundViaFallback: 0,
    stoppedEarly: false,
    errors: [],
  };

  let budget = budgetMax;
  let llmCalls = 0;
  const throttle = async () => {
    if (llmCalls > 0) await sleep(throttleMs);
    llmCalls++;
  };

  // 1) Index existing rows, archive exact duplicates, build the "seen" set.
  const existing = await loadExistingRows(notion, env.NOTION_DATABASE_ID);
  budget -= Math.max(1, Math.ceil(existing.length / 100));
  const seen = new Set(existing.map((r) => r.key));
  for (const pageId of duplicatePageIds(existing)) {
    if (budget <= SAFETY_MARGIN) break;
    try {
      await notion.archivePage(pageId);
      budget--;
      report.duplicatesArchived++;
    } catch (err) {
      report.errors.push(`archive dup ${pageId}: ${errText(err)}`);
    }
  }

  // 2) Process each source page.
  let maxEnrich = 10; // cap costly fallback LLM calls per run
  for (const url of urls.slice(0, maxPages)) {
    if (budget <= SAFETY_MARGIN) {
      report.stoppedEarly = true;
      break;
    }

    let text: string;
    try {
      text = await fetchPage(url);
      budget--;
    } catch (err) {
      report.urlsFailed++;
      report.errors.push(`${url}: ${errText(err)}`);
      continue;
    }

    const hash = await hashText(text);
    if (await isUnchanged(env, url, hash)) {
      report.urlsUnchanged++;
      continue;
    }

    // Extract (or reuse cached extraction for this exact page content).
    let contacts = await getCachedContacts(env, hash);
    if (!contacts) {
      // Bound LLM work per run: defer this (uncached) page to the next run so a
      // single /scrape stays fast. Cached pages above still got created.
      if (llmCalls >= maxLlmPerRun) {
        report.stoppedEarly = true;
        break;
      }
      const built: Contact[] = [];
      let extractionComplete = true;
      for (const chunk of chunkText(text)) {
        if (budget <= SAFETY_MARGIN) {
          extractionComplete = false;
          report.stoppedEarly = true;
          break;
        }
        try {
          await throttle();
          built.push(...(await extractContacts(env, chunk, url, mode)));
          budget--;
        } catch (err) {
          report.errors.push(`extract ${url}: ${errText(err)}`);
          extractionComplete = false;
          break;
        }
      }
      if (!extractionComplete) {
        // Out of budget mid-extraction → stop the run; error → skip this page.
        if (budget <= SAFETY_MARGIN) break;
        report.urlsFailed++;
        continue;
      }
      contacts = dedupeBatch(built);
      await putCachedContacts(env, hash, contacts); // KV write — not a subrequest
    }

    // Create rows incrementally; only hash the page once fully synced.
    let fullyProcessed = true;
    for (const contact of contacts) {
      if (!contact.contact_name) continue;
      if (seen.has(contactKey(contact))) {
        report.skippedDuplicate++;
        continue;
      }
      if (budget <= SAFETY_MARGIN + 1) {
        fullyProcessed = false;
        report.stoppedEarly = true;
        break;
      }

      // Optional email fallback on a linked page (always on in startup mode).
      if (!contact.email && contact.profile_url && enrichEnabled && maxEnrich > 0 && budget > 8) {
        maxEnrich--;
        const found = await tryFindEmail(env, contact.profile_url, mode, throttle, () => budget--);
        if (found) {
          contact.email = found;
          report.emailsFoundViaFallback++;
          if (seen.has(contactKey(contact))) {
            report.skippedDuplicate++;
            continue;
          }
        }
      }

      seen.add(contactKey(contact));
      try {
        await notion.createPage(env.NOTION_DATABASE_ID, contactToProperties(contact));
        budget--;
        report.created++;
      } catch (err) {
        report.errors.push(`create ${contact.contact_name}: ${errText(err)}`);
        fullyProcessed = false;
        break;
      }
    }

    if (fullyProcessed) {
      await saveHash(env, url, hash);
      report.urlsProcessed++;
    } else {
      break; // out of budget — leave unhashed so the next run resumes this page
    }
  }

  console.log("[scrape]", JSON.stringify(report));
  return report;
}

/** Split large page text into overlapping chunks so no one gets truncated away. */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const chunks: string[] = [];
  const step = CHUNK_CHARS - CHUNK_OVERLAP;
  for (let i = 0; i < text.length; i += step) chunks.push(text.slice(i, i + CHUNK_CHARS));
  return chunks;
}

/** Try a few common paths on a company/profile site for a visible email. */
async function tryFindEmail(
  env: Env,
  baseUrl: string,
  mode: Mode,
  throttle: () => Promise<void>,
  spend: () => void,
): Promise<string | null> {
  for (const candidate of candidatePages(baseUrl, mode)) {
    let text: string;
    try {
      text = await fetchPage(candidate);
      spend();
    } catch {
      continue;
    }
    await throttle();
    const email = await huntEmail(env, text);
    spend();
    if (email) return email;
  }
  return null;
}

function candidatePages(url: string, mode: Mode): string[] {
  if (mode !== "startup") return [url];
  try {
    const origin = new URL(url).origin;
    return [...new Set([url, `${origin}/contact`, `${origin}/careers`])];
  } catch {
    return [url];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
