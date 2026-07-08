import type { Contact } from "../types";
import { NotionClient, prop, readTitle, readRichText, readEmail } from "./client";
import { PROPS, STATUS } from "./schema";

/** Notion property payload for a new contact row. */
export function contactToProperties(contact: Contact): Record<string, unknown> {
  return {
    [PROPS.contactName]: prop.title(contact.contact_name),
    [PROPS.role]: prop.richText(contact.role),
    [PROPS.entity]: prop.richText(contact.entity_name),
    [PROPS.contextSummary]: prop.richText(contact.context_summary),
    [PROPS.backing]: prop.richText(contact.backing_or_affiliation),
    [PROPS.email]: prop.email(contact.email),
    [PROPS.profileUrl]: prop.url(contact.profile_url),
    [PROPS.sourceUrl]: prop.url(contact.source_url ?? null),
    [PROPS.status]: prop.select(STATUS.notContacted),
    [PROPS.trigger]: prop.checkbox(false),
    [PROPS.remove]: prop.checkbox(false),
  };
}

/**
 * Dedupe keys for a contact. The name+entity key is ALWAYS present and is the
 * stable identity; the email key is added when an email exists. A contact is a
 * duplicate if ANY of its keys matches a seen key - this collapses the case
 * where the same person appears with an email in one source and without it in
 * another (which would otherwise create two rows).
 */
export function nameKey(name: string, entity: string | null): string {
  return `ne:${norm(name)}|${norm(entity ?? "")}`;
}
export function emailKeyOf(email: string | null): string | null {
  return email ? `email:${email.toLowerCase().trim()}` : null;
}
export function contactKeys(c: Contact): string[] {
  const keys = [nameKey(c.contact_name, c.entity_name)];
  const ek = emailKeyOf(c.email);
  if (ek) keys.push(ek);
  return keys;
}

/** Collapse duplicates within a single scrape batch (by name+entity), merging info. */
export function dedupeBatch(contacts: Contact[]): Contact[] {
  const map = new Map<string, Contact>();
  for (const c of contacts) {
    if (!c.contact_name) continue;
    const key = nameKey(c.contact_name, c.entity_name);
    const existing = map.get(key);
    map.set(key, existing ? mergeContacts(existing, c) : c);
  }
  return [...map.values()];
}

//  Existing-row indexing + duplicate detection (for the removal pass) 

export interface ExistingRow {
  pageId: string;
  nameKey: string; // grouping identity (always present)
  keys: string[]; // all keys this row occupies (name+entity, and email if any)
  filled: number; // completeness score (which optional fields are populated)
}

/** Read every row and index it with its dedupe keys and a completeness score. */
export async function loadExistingRows(
  notion: NotionClient,
  databaseId: string,
): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = [];
  for await (const page of notion.queryAll(databaseId)) {
    const name = readTitle(page, PROPS.contactName);
    const entity = readRichText(page, PROPS.entity) || null;
    const email = readEmail(page, PROPS.email);
    const nk = nameKey(name, entity);
    const ek = emailKeyOf(email);
    const filled =
      (email ? 1 : 0) +
      (readRichText(page, PROPS.contextSummary) ? 1 : 0) +
      (readRichText(page, PROPS.role) ? 1 : 0) +
      (entity ? 1 : 0);
    rows.push({ pageId: page.id, nameKey: nk, keys: ek ? [nk, ek] : [nk], filled });
  }
  return rows;
}

/**
 * Given all rows, return the page IDs of duplicates to archive - grouping by the
 * name+entity identity and keeping, per group, the most complete row (ties keep
 * the first). Grouping by name+entity (not email) catches same-person rows that
 * differ only by whether an email was captured.
 */
export function duplicatePageIds(rows: ExistingRow[]): string[] {
  const byKey = new Map<string, ExistingRow[]>();
  for (const r of rows) {
    const group = byKey.get(r.nameKey);
    if (group) group.push(r);
    else byKey.set(r.nameKey, [r]);
  }
  const toArchive: string[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.filled - a.filled); // keep the most complete
    toArchive.push(...group.slice(1).map((r) => r.pageId));
  }
  return toArchive;
}

//  helpers 

function mergeContacts(a: Contact, b: Contact): Contact {
  return {
    contact_name: a.contact_name || b.contact_name,
    role: a.role ?? b.role,
    entity_name: a.entity_name ?? b.entity_name,
    email: a.email ?? b.email,
    context_summary: longer(a.context_summary, b.context_summary),
    backing_or_affiliation: a.backing_or_affiliation ?? b.backing_or_affiliation,
    profile_url: a.profile_url ?? b.profile_url,
    source_url: a.source_url ?? b.source_url,
  };
}

function longer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
