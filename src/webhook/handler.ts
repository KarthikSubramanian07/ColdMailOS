import type { Contact, Env } from "../types";
import { loadProfile } from "../config";
import {
  NotionClient,
  prop,
  readTitle,
  readRichText,
  readEmail,
  readCheckbox,
  readUrl,
} from "../notion/client";
import { PROPS } from "../notion/schema";
import { draftEmail } from "../drafting/groq";
import { createDraft } from "../gmail/drafts";
import { timingSafeEqual } from "../security";

/**
 * Handles the POST from Notion's "Send webhook" automations:
 *   • "Remove" checked      → archive (remove) the row.
 *   • "Draft Email" checked → draft a personalized email + create a Gmail draft.
 * Verifies the shared secret first.
 */
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null);

  // Notion webhook endpoint verification handshake — echo the token/challenge.
  const challenge = extractChallenge(body);
  if (challenge) return json({ challenge });

  if (!verifySecret(request, env)) return json({ error: "unauthorized" }, 401);

  const pageId = findPageId(body);
  if (!pageId) return json({ error: "no page id in payload" }, 400);

  try {
    const result = await processRow(env, pageId);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error("[webhook]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function processRow(env: Env, pageId: string) {
  const notion = new NotionClient(env);
  const page = await notion.getPage(pageId);

  // Remove takes precedence: archive and stop.
  if (readCheckbox(page, PROPS.remove)) {
    await notion.archivePage(pageId);
    return { archived: true };
  }

  if (!readCheckbox(page, PROPS.trigger)) return { skipped: "trigger not checked" };
  if (readUrl(page, PROPS.gmailDraft)) return { skipped: "draft already exists" };

  const contact: Contact = {
    contact_name: readTitle(page, PROPS.contactName),
    role: readRichText(page, PROPS.role) || null,
    entity_name: readRichText(page, PROPS.entity) || null,
    email: readEmail(page, PROPS.email),
    context_summary: readRichText(page, PROPS.contextSummary) || null,
    backing_or_affiliation: readRichText(page, PROPS.backing) || null,
    profile_url: readUrl(page, PROPS.profileUrl),
  };
  if (!contact.contact_name) return { skipped: "row has no name" };

  const profile = await loadProfile(env);

  // 1) Draft the email (mode comes from the profile).
  const draft = await draftEmail(env, contact, profile);

  // 2) Write the draft text back so it's visible in Notion.
  await notion.updatePage(pageId, {
    [PROPS.draftSubject]: prop.richText(draft.subject),
    [PROPS.draftBody]: prop.richText(draft.body),
  });

  // 3) Create the Gmail draft (recipient pre-filled only if we have an email).
  const gmail = await createDraft(env, {
    to: contact.email,
    subject: draft.subject,
    body: draft.body,
    from: profile.senderEmail,
  });

  // 4) Save the draft link back into Notion.
  await notion.updatePage(pageId, { [PROPS.gmailDraft]: prop.url(gmail.link) });

  return {
    contact: contact.contact_name,
    recipientPrefilled: Boolean(contact.email),
    gmailDraftLink: gmail.link,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function verifySecret(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  const provided =
    request.headers.get("X-RMOS-Secret") ??
    request.headers.get("x-rmos-secret") ??
    url.searchParams.get("secret") ??
    "";
  return timingSafeEqual(provided, env.WEBHOOK_SECRET);
}

function extractChallenge(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.challenge === "string") return b.challenge;
  if (typeof b.verification_token === "string") return b.verification_token;
  return null;
}

/** Dig the page id out of Notion's payload (shape varies by trigger type). */
function findPageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>;
  const candidates = [b.data?.id, b.data?.page?.id, b.page?.id, b.entity?.id, b.record?.id, b.id];
  for (const c of candidates) if (typeof c === "string" && isUuid(c)) return c;
  return null;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
