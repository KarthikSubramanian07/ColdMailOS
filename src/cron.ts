import type { Env, Mode } from "./types";
import { boolVar, intVar, loadMode, loadSourceUrls } from "./config";
import { fetchPage } from "./extract/fetchPage";
import { checkRobots } from "./extract/robots";
import { extractContacts, huntEmail } from "./extract/extractWithLLM";
import { verifyEmail } from "./verify/email";
import { EMAIL_CONFIDENCE } from "./notion/schema";
import {
  hashText,
  isUnchanged,
  saveHash,
  getExtractionState,
  putExtractionState,
  type ExtractionState,
} from "./extract/cache";
import { NotionClient } from "./notion/client";
import {
  contactKeys,
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
  robotsBlocked: number;
  stoppedEarly: boolean;
  errors: string[];
}

/** Subrequests reserved as headroom before the free-plan cap of 50. */
const SAFETY_MARGIN = 3;
/**
 * Characters per LLM extraction chunk. Kept modest on purpose: a dense
 * directory chunk yields one JSON object per person, and too many at once
 * overflows the model's output-token limit -> truncated, unparseable JSON ->
 * zero contacts. Smaller chunks keep each response comfortably parseable.
 */
const CHUNK_CHARS = 7_000;
const CHUNK_OVERLAP = 500;

/**
 * The scrape job. Fetches each page, skips unchanged ones (content hash),
 * extracts contacts per mode - CHUNKING large pages so nobody is truncated
 * away - then incrementally creates Notion rows within the free-plan
 * subrequest budget. Extractions are cached by content hash, so a big page
 * that needs several runs to fully sync is only sent to the LLM once. A page's
 * hash is saved ONLY when all its contacts are written. Also archives exact
 * duplicates.
 */
export async function runScrape(env: Env, onlyUrl?: string): Promise<ScrapeReport> {
  // Queue consumers pass a single URL (one message = one fresh-budget invocation);
  // the cron/manual path processes the whole configured list.
  const urls = onlyUrl ? [onlyUrl] : await loadSourceUrls(env);
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
    robotsBlocked: 0,
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
  const seen = new Set(existing.flatMap((r) => r.keys));
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

    // Respect robots.txt before touching the page (cached per origin in KV).
    const gate = await checkRobots(env, url);
    if (gate.fetched) budget--;
    if (!gate.allowed) {
      report.robotsBlocked++;
      report.errors.push(`robots.txt disallows ${url}`);
      continue;
    }
    if (gate.crawlDelayMs) await sleep(Math.min(gate.crawlDelayMs, 10_000));

    let text: string;
    try {
      text = await fetchPage(url, env);
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

    // Extract incrementally: a bounded number of chunks per run, persisting
    // progress so the next run resumes at nextChunk instead of re-calling the
    // LLM. This keeps a single /scrape fast enough to never time out, even on a
    // huge directory page that needs several runs to fully extract.
    const chunks = chunkText(text);
    const state: ExtractionState =
      (await getExtractionState(env, hash)) ?? { done: false, nextChunk: 0, contacts: [] };

    while (!state.done && state.nextChunk < chunks.length) {
      if (llmCalls >= maxLlmPerRun || budget <= SAFETY_MARGIN) {
        report.stoppedEarly = true;
        break;
      }
      try {
        await throttle();
        state.contacts.push(...(await extractContacts(env, chunks[state.nextChunk], url, mode)));
        budget--;
        state.nextChunk++;
      } catch (err) {
        report.errors.push(`extract ${url} chunk ${state.nextChunk}: ${errText(err)}`);
        state.nextChunk++; // skip a persistently-failing chunk so the page can still finish
      }
      await putExtractionState(env, hash, state); // KV write - not a subrequest
    }
    if (state.nextChunk >= chunks.length) {
      state.done = true;
      await putExtractionState(env, hash, state);
    }
    if (!state.done) break; // out of per-run budget mid-extraction - resume next run

    const contacts = dedupeBatch(state.contacts);

    // Create rows incrementally; only hash the page once fully synced.
    let fullyProcessed = true;
    for (const contact of contacts) {
      if (!contact.contact_name) continue;
      if (contactKeys(contact).some((k) => seen.has(k))) {
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
          if (contactKeys(contact).some((k) => seen.has(k))) {
            report.skippedDuplicate++;
            continue;
          }
        }
      }

      // Grade any email we have (syntax + role/disposable + MX-via-DoH) so the
      // board shows confidence and drafting only pre-fills a "Safe" recipient.
      if (contact.email && budget > SAFETY_MARGIN) {
        const verdict = await verifyEmail(env, contact.email, () => budget--);
        contact.email_confidence = EMAIL_CONFIDENCE[verdict.grade];
      }

      // Reserve all of this contact's keys (name+entity and email) so later
      // pages/runs don't create an email/no-email duplicate of the same person.
      for (const k of contactKeys(contact)) seen.add(k);
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
      break; // out of budget - leave unhashed so the next run resumes this page
    }
  }

  console.log("[scrape]", JSON.stringify(report));
  return report;
}

/** Split large page text into overlapping chunks so no one gets truncated away. */
export function chunkText(text: string): string[] {
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
    const gate = await checkRobots(env, candidate);
    if (!gate.allowed) continue; // honor robots.txt on fallback fetches too
    let text: string;
    try {
      text = await fetchPage(candidate, env);
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

export function candidatePages(url: string, mode: Mode): string[] {
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
