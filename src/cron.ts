import type { Env, Person } from "./types";
import { boolVar, intVar, loadSourceUrls } from "./config";
import { fetchPage } from "./extract/fetchPage";
import { extractPeople } from "./extract/extractWithLLM";
import { hashText, isUnchanged, saveHash } from "./extract/cache";
import { syncPeopleToNotion, type SyncSummary } from "./notion/sync";

export interface ScrapeReport extends SyncSummary {
  urlsConfigured: number;
  urlsProcessed: number;
  urlsUnchanged: number;
  urlsFailed: number;
  profilePagesFetched: number;
  errors: string[];
}

/**
 * The weekly job: fetch each configured page, skip anything unchanged since last
 * run (content-hash cache), extract people with the LLM, optionally deep-dive
 * linked profile pages, then dedupe and push new rows to Notion.
 */
export async function runScrape(env: Env): Promise<ScrapeReport> {
  const urls = await loadSourceUrls(env);
  const maxPages = intVar(env.MAX_PAGES_PER_RUN, 200);
  const throttleMs = intVar(env.LLM_THROTTLE_MS, 2200);
  const secondPass = boolVar(env.ENABLE_PROFILE_SECOND_PASS);

  const report: ScrapeReport = {
    urlsConfigured: urls.length,
    urlsProcessed: 0,
    urlsUnchanged: 0,
    urlsFailed: 0,
    profilePagesFetched: 0,
    created: 0,
    skippedDuplicate: 0,
    people: 0,
    errors: [],
  };

  const collected: Person[] = [];
  let llmCalls = 0;

  for (const url of urls.slice(0, maxPages)) {
    try {
      const text = await fetchPage(url);
      const hash = await hashText(text);
      if (await isUnchanged(env, url, hash)) {
        report.urlsUnchanged++;
        continue;
      }

      if (llmCalls > 0) await sleep(throttleMs);
      const people = await extractPeople(env, text, url);
      llmCalls++;
      collected.push(...people);
      report.urlsProcessed++;

      // Optional second pass: fetch each linked, distinct profile page.
      if (secondPass) {
        for (const person of people) {
          const profileUrl = person.profile_url;
          if (!profileUrl || sameUrl(profileUrl, url)) continue;
          try {
            const profileText = await fetchPage(profileUrl);
            await sleep(throttleMs);
            const refined = await extractPeople(env, profileText, profileUrl);
            llmCalls++;
            report.profilePagesFetched++;
            // Keep only the record matching this person (best-effort by name).
            const match = refined.find((r) => sameName(r.name, person.name)) ?? refined[0];
            if (match) collected.push({ ...match, institution: person.institution });
          } catch (err) {
            report.errors.push(`profile ${profileUrl}: ${errText(err)}`);
          }
        }
      }

      // Only persist the hash after a successful extraction.
      await saveHash(env, url, hash);
    } catch (err) {
      report.urlsFailed++;
      report.errors.push(`${url}: ${errText(err)}`);
    }
  }

  const summary = await syncPeopleToNotion(env, collected);
  report.created = summary.created;
  report.skippedDuplicate = summary.skippedDuplicate;
  report.people = summary.people;

  console.log("[scrape]", JSON.stringify(report));
  return report;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sameUrl(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}
function normalizeUrl(u: string): string {
  return u.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
}
function sameName(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\s+/g, " ").trim() === b.toLowerCase().replace(/\s+/g, " ").trim();
}
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
