import type { Env, Person } from "../types";
import { NotionClient, prop, readTitle, readEmail } from "./client";
import { PROPS, STATUS } from "./schema";

export interface SyncSummary {
  created: number;
  skippedDuplicate: number;
  people: number;
}

/**
 * Dedupe extracted people and create a Notion row for each new one.
 *
 * Dedupe key: email if present (most reliable), else lowercased name. We match
 * against both the incoming batch AND rows already in the database, so re-runs
 * and overlap between department/lab pages don't create duplicates. Existing
 * rows are left untouched — we never overwrite a row you may have edited.
 */
export async function syncPeopleToNotion(env: Env, people: Person[]): Promise<SyncSummary> {
  const notion = new NotionClient(env);

  // Build the set of keys already in Notion.
  const seen = new Set<string>();
  for await (const page of notion.queryAll(env.NOTION_DATABASE_ID)) {
    const email = readEmail(page, PROPS.email);
    const name = readTitle(page, PROPS.name);
    seen.add(dedupeKey(name, email));
  }

  let created = 0;
  let skippedDuplicate = 0;

  for (const person of dedupeBatch(people)) {
    const key = dedupeKey(person.name, person.email);
    if (seen.has(key)) {
      skippedDuplicate++;
      continue;
    }
    seen.add(key);
    await notion.createPage(env.NOTION_DATABASE_ID, buildProperties(person));
    created++;
  }

  return { created, skippedDuplicate, people: people.length };
}

function buildProperties(person: Person): Record<string, unknown> {
  return {
    [PROPS.name]: prop.title(person.name),
    [PROPS.institution]: prop.richText(person.institution ?? null),
    [PROPS.researchFocus]: prop.richText(person.research_focus),
    [PROPS.email]: prop.email(person.email),
    [PROPS.profileUrl]: prop.url(person.profile_url),
    [PROPS.sourceUrl]: prop.url(person.source_url ?? null),
    [PROPS.status]: prop.select(STATUS.notContacted),
    [PROPS.trigger]: prop.checkbox(false),
  };
}

/** Collapse duplicates within a single scrape batch. */
function dedupeBatch(people: Person[]): Person[] {
  const map = new Map<string, Person>();
  for (const p of people) {
    if (!p.name) continue;
    const key = dedupeKey(p.name, p.email);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, p);
    } else {
      // Prefer the record with more information (email, research focus).
      map.set(key, mergePerson(existing, p));
    }
  }
  return [...map.values()];
}

function mergePerson(a: Person, b: Person): Person {
  return {
    name: a.name || b.name,
    title: a.title ?? b.title,
    email: a.email ?? b.email,
    research_focus: pickLonger(a.research_focus, b.research_focus),
    profile_url: a.profile_url ?? b.profile_url,
    institution: a.institution ?? b.institution,
    source_url: a.source_url ?? b.source_url,
  };
}

function pickLonger(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

function dedupeKey(name: string, email: string | null): string {
  if (email) return `email:${email.toLowerCase().trim()}`;
  return `name:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
}
