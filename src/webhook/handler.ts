import type { Env, Person } from "../types";
import { loadProfile } from "../config";
import { NotionClient, prop, readTitle, readRichText, readEmail, readCheckbox, readUrl } from "../notion/client";
import { PROPS } from "../notion/schema";
import { draftEmail } from "../drafting/groq";
import { createDraft } from "../gmail/drafts";

/**
 * Handles the POST from Notion's "Send webhook" automation, fired when someone
 * flips the "Draft Email" checkbox on a row. Verifies the shared secret, reads
 * the row, drafts a personalized email, writes it back, and creates a Gmail
 * draft (never sends).
 */
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null);

  // Notion webhook endpoint verification handshake — echo the token/challenge.
  const challenge = extractChallenge(body);
  if (challenge) return json({ challenge });

  if (!verifySecret(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }

  const pageId = findPageId(body);
  if (!pageId) return json({ error: "no page id in payload" }, 400);

  // Process asynchronously would be ideal, but Notion expects a quick 2xx and
  // the work is short. We do it inline and return the result.
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

  // Ignore fires where the checkbox is off (e.g. someone un-checked it).
  if (!readCheckbox(page, PROPS.trigger)) {
    return { skipped: "trigger not checked" };
  }

  // Idempotency: if we already made a draft for this row, don't make another.
  if (readUrl(page, PROPS.gmailDraft)) {
    return { skipped: "draft already exists" };
  }

  const person: Person = {
    name: readTitle(page, PROPS.name),
    title: null,
    email: readEmail(page, PROPS.email),
    research_focus: readRichText(page, PROPS.researchFocus) || null,
    profile_url: readUrl(page, PROPS.profileUrl),
    institution: readRichText(page, PROPS.institution) || null,
  };
  if (!person.name) return { skipped: "row has no name" };

  const profile = await loadProfile(env);

  // 1) Draft the email.
  const draft = await draftEmail(env, person, profile);

  // 2) Write the draft text back so it's visible in Notion.
  await notion.updatePage(pageId, {
    [PROPS.draftSubject]: prop.richText(draft.subject),
    [PROPS.draftBody]: prop.richText(draft.body),
  });

  // 3) Create the Gmail draft (recipient pre-filled only if we have an email).
  const gmail = await createDraft(env, {
    to: person.email,
    subject: draft.subject,
    body: draft.body,
    from: profile.senderEmail,
  });

  // 4) Save the draft link back into Notion.
  await notion.updatePage(pageId, {
    [PROPS.gmailDraft]: prop.url(gmail.link),
  });

  return {
    person: person.name,
    recipientPrefilled: Boolean(person.email),
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

/** Constant-time string comparison to avoid leaking the secret via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  const candidates = [
    b.data?.id,
    b.data?.page?.id,
    b.page?.id,
    b.entity?.id,
    b.record?.id,
    b.id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && isUuid(c)) return c;
  }
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
