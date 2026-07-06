import type { Env } from "../types";

const NOTION_API = "https://api.notion.com/v1";

/** Thin wrapper over the Notion REST API using the Worker's bound secrets. */
export class NotionClient {
  constructor(private env: Env) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${NOTION_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.env.NOTION_TOKEN}`,
        "Notion-Version": this.env.NOTION_VERSION,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Notion ${init.method ?? "GET"} ${path} failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as T;
  }

  /** Fetch a single page (used by the webhook to read row properties). */
  getPage(pageId: string) {
    return this.request<NotionPage>(`/pages/${pageId}`);
  }

  /** Iterate every page in the database (paginated) — used to build the dedupe index. */
  async *queryAll(databaseId: string): AsyncGenerator<NotionPage> {
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = await this.request<QueryResponse>(`/databases/${databaseId}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      for (const page of res.results) yield page;
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
  }

  createPage(databaseId: string, properties: Record<string, unknown>) {
    return this.request<NotionPage>("/pages", {
      method: "POST",
      body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    });
  }

  updatePage(pageId: string, properties: Record<string, unknown>) {
    return this.request<NotionPage>(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
  }

  /** Archive (move to trash) a page — used by Remove and dedupe. Recoverable in Notion. */
  archivePage(pageId: string) {
    return this.request<NotionPage>(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    });
  }
}

// ── Property builders (Notion's shape is verbose; keep it in one place) ──────

export const prop = {
  title: (text: string) => ({ title: [{ text: { content: truncate(text, 2000) } }] }),
  // Notion caps a single rich_text object at 2000 chars, so split longer values
  // across multiple blocks instead of truncating (e.g. a full email draft body).
  richText: (text: string | null) =>
    text ? { rich_text: splitRichText(text) } : { rich_text: [] },
  email: (email: string | null) => ({ email: email || null }),
  url: (url: string | null) => ({ url: url || null }),
  select: (name: string) => ({ select: { name } }),
  checkbox: (checked: boolean) => ({ checkbox: checked }),
};

// ── Property readers ────────────────────────────────────────────────────────

export function readTitle(page: NotionPage, name: string): string {
  const p = page.properties?.[name];
  return p?.title?.map((t) => t.plain_text).join("") ?? "";
}
export function readRichText(page: NotionPage, name: string): string {
  const p = page.properties?.[name];
  return p?.rich_text?.map((t) => t.plain_text).join("") ?? "";
}
export function readEmail(page: NotionPage, name: string): string | null {
  return page.properties?.[name]?.email ?? null;
}
export function readUrl(page: NotionPage, name: string): string | null {
  return page.properties?.[name]?.url ?? null;
}
export function readCheckbox(page: NotionPage, name: string): boolean {
  return page.properties?.[name]?.checkbox ?? false;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Split text into ≤2000-char rich_text blocks (Notion caps ~100 blocks). */
function splitRichText(text: string): { text: { content: string } }[] {
  const blocks: { text: { content: string } }[] = [];
  for (let i = 0; i < text.length && blocks.length < 100; i += 2000) {
    blocks.push({ text: { content: text.slice(i, i + 2000) } });
  }
  return blocks;
}

// ── Minimal Notion response types (only what we read) ───────────────────────

export interface NotionPage {
  id: string;
  url?: string;
  properties?: Record<string, NotionProperty>;
}
interface NotionProperty {
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  email?: string | null;
  url?: string | null;
  checkbox?: boolean;
  select?: { name: string } | null;
}
interface QueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}
