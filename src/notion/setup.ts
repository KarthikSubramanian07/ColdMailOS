import type { Env } from "../types";
import { NotionClient, type NotionDatabase } from "./client";
import { PROPS, STATUS, EMAIL_CONFIDENCE } from "./schema";

/**
 * One-shot setup so a database matches the current code:
 *   1. ensureProperties - add any missing columns (required: newer features write
 *      to columns like Email Confidence / Follow-ups / Opened that older DBs lack).
 *   2. configureView - best-effort column order/visibility/freeze via Notion's
 *      Views API (2025-09-03). Isolated + non-fatal: if the Views API shape isn't
 *      available, columns still exist and can be arranged by hand.
 */

const VIEWS_VERSION = "2025-09-03";

/** Column schema for every non-title property (title already exists). */
function desiredProperties(): Record<string, unknown> {
  const rt = { rich_text: {} };
  return {
    [PROPS.contextSummary]: rt,
    [PROPS.entity]: rt,
    [PROPS.role]: rt,
    [PROPS.backing]: rt,
    [PROPS.email]: { email: {} },
    [PROPS.emailConfidence]: {
      select: {
        options: [
          { name: EMAIL_CONFIDENCE.safe, color: "green" },
          { name: EMAIL_CONFIDENCE.risky, color: "yellow" },
          { name: EMAIL_CONFIDENCE.unknown, color: "gray" },
        ],
      },
    },
    [PROPS.status]: {
      select: {
        options: [
          { name: STATUS.notContacted, color: "gray" },
          { name: STATUS.emailed, color: "blue" },
          { name: STATUS.replied, color: "green" },
          { name: STATUS.noResponse, color: "yellow" },
        ],
      },
    },
    [PROPS.trigger]: { checkbox: {} },
    [PROPS.remove]: { checkbox: {} },
    [PROPS.followUps]: { number: {} },
    [PROPS.lastEmailed]: { date: {} },
    [PROPS.gmailDraft]: { url: {} },
    [PROPS.profileUrl]: { url: {} },
    [PROPS.opened]: { number: {} },
    [PROPS.clicked]: { number: {} },
    [PROPS.lastActivity]: { date: {} },
    [PROPS.sourceUrl]: { url: {} },
    [PROPS.draftSubject]: rt,
    [PROPS.draftBody]: rt,
  };
}

/** Left-to-right column order a human wants; drafts/provenance hidden. */
const COLUMN_ORDER: string[] = [
  PROPS.contactName,
  PROPS.contextSummary,
  PROPS.entity,
  PROPS.role,
  PROPS.backing,
  PROPS.email,
  PROPS.emailConfidence,
  PROPS.status,
  PROPS.trigger,
  PROPS.remove,
  PROPS.followUps,
  PROPS.lastEmailed,
  PROPS.gmailDraft,
  PROPS.profileUrl,
  PROPS.opened,
  PROPS.clicked,
  PROPS.lastActivity,
  PROPS.sourceUrl,
  PROPS.draftSubject,
  PROPS.draftBody,
];
const HIDDEN = new Set<string>([PROPS.sourceUrl, PROPS.draftSubject, PROPS.draftBody]);

export async function ensureProperties(env: Env): Promise<{ added: string[] }> {
  const notion = new NotionClient(env);
  const db = await notion.getDatabase(env.NOTION_DATABASE_ID);
  const existing = new Set(Object.keys(db.properties ?? {}));
  const toAdd: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(desiredProperties())) {
    if (!existing.has(name)) toAdd[name] = def;
  }
  if (Object.keys(toAdd).length > 0) {
    await notion.updateDatabase(env.NOTION_DATABASE_ID, toAdd);
  }
  return { added: Object.keys(toAdd) };
}

/** Best-effort column layout via the Views API. Never throws. */
export async function configureView(env: Env): Promise<{ status: string; detail?: string }> {
  const notion = new NotionClient(env);
  try {
    const db = await notion.requestVersioned<NotionDatabase>(
      `/databases/${env.NOTION_DATABASE_ID}`,
      VIEWS_VERSION,
    );
    const dsId = db.data_sources?.[0]?.id;
    if (!dsId) return { status: "skipped", detail: "no data source on this database" };

    const ds = await notion.requestVersioned<NotionDatabase>(`/data_sources/${dsId}`, VIEWS_VERSION);
    const nameToId = new Map<string, string>();
    for (const [name, p] of Object.entries(ds.properties ?? {})) if (p.id) nameToId.set(name, p.id);

    const views = await notion.requestVersioned<{ results?: { id: string; type?: string }[] }>(
      `/data_sources/${dsId}/views`,
      VIEWS_VERSION,
    );
    const view = views.results?.find((v) => v.type === "table") ?? views.results?.[0];
    if (!view) return { status: "skipped", detail: "no table view found" };

    const properties = COLUMN_ORDER.filter((n) => nameToId.has(n)).map((n) => ({
      property_id: nameToId.get(n)!,
      visible: !HIDDEN.has(n),
    }));

    await notion.requestVersioned(`/views/${view.id}`, VIEWS_VERSION, {
      method: "PATCH",
      body: JSON.stringify({ configuration: { properties, frozen_column_index: 0 } }),
    });
    return { status: "configured", detail: `${properties.length} columns ordered` };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function runSetup(env: Env): Promise<{ added: string[]; view: { status: string; detail?: string } }> {
  const props = await ensureProperties(env);
  const view = await configureView(env);
  console.log("[setup]", JSON.stringify({ added: props.added, view }));
  return { added: props.added, view };
}
