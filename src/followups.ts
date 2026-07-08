import type { Contact, Env } from "./types";
import { intVar, loadProfile } from "./config";
import {
  NotionClient,
  prop,
  readTitle,
  readRichText,
  readEmail,
  readUrl,
  readSelect,
  readNumber,
  readDate,
} from "./notion/client";
import { PROPS, STATUS, EMAIL_CONFIDENCE } from "./notion/schema";
import { draftFollowUp } from "./drafting/groq";
import { createDraft } from "./gmail/drafts";
import { isSuppressed, unsubscribeUrl } from "./suppress";

export interface FollowUpReport {
  scanned: number;
  baselined: number; // rows where we recorded the "emailed" date for the first time
  drafted: number;
  skipped: number;
  stoppedEarly: boolean;
  errors: string[];
}

const SAFETY_MARGIN = 4;

/** Pure: is a follow-up due for a row in the Emailed state? */
export function isFollowUpDue(
  lastEmailedIso: string | null,
  followUps: number,
  nowMs: number,
  cadenceDays: number,
  maxFollowUps: number,
): boolean {
  if (!lastEmailedIso) return false; // no baseline yet
  if (followUps >= maxFollowUps) return false;
  const ageDays = (nowMs - Date.parse(lastEmailedIso)) / 86_400_000;
  // Space each follow-up further out: cadence, then 2x cadence, etc.
  return ageDays >= cadenceDays * (followUps + 1);
}

/**
 * Draft due follow-ups (draft-only, no Gmail read scope). Scans rows in the
 * Emailed state: records a baseline "Last Emailed" date the first time it sees
 * one, then after the cadence drafts a short nudge as a Gmail draft, bumping the
 * Follow-ups count. Never sends; skips suppressed and risky/blank addresses.
 */
export async function runFollowUps(env: Env, origin: string, nowMs: number): Promise<FollowUpReport> {
  const notion = new NotionClient(env);
  const profile = await loadProfile(env);
  const cadenceDays = intVar(env.FOLLOWUP_DAYS, 4);
  const maxFollowUps = intVar(env.MAX_FOLLOWUPS, 2);
  let budget = intVar(env.MAX_SUBREQUESTS, 45);
  const today = new Date(nowMs).toISOString().slice(0, 10);

  const report: FollowUpReport = {
    scanned: 0,
    baselined: 0,
    drafted: 0,
    skipped: 0,
    stoppedEarly: false,
    errors: [],
  };

  for await (const page of notion.queryAll(env.NOTION_DATABASE_ID)) {
    if (readSelect(page, PROPS.status) !== STATUS.emailed) continue;
    report.scanned++;

    const last = readDate(page, PROPS.lastEmailed);
    const followUps = readNumber(page, PROPS.followUps) ?? 0;

    if (!last) {
      // First time we see it as Emailed: record the baseline date, don't draft yet.
      try {
        await notion.updatePage(page.id, { [PROPS.lastEmailed]: prop.date(today) });
        report.baselined++;
      } catch (err) {
        report.errors.push(`baseline ${page.id}: ${errText(err)}`);
      }
      continue;
    }

    if (!isFollowUpDue(last, followUps, nowMs, cadenceDays, maxFollowUps)) continue;
    if (budget <= SAFETY_MARGIN) {
      report.stoppedEarly = true;
      break;
    }

    const email = readEmail(page, PROPS.email);
    const confidence = readSelect(page, PROPS.emailConfidence);
    if (!email || confidence === EMAIL_CONFIDENCE.risky || (await isSuppressed(env, email))) {
      report.skipped++;
      continue;
    }

    const contact: Contact = {
      contact_name: readTitle(page, PROPS.contactName),
      role: readRichText(page, PROPS.role) || null,
      entity_name: readRichText(page, PROPS.entity) || null,
      email,
      context_summary: readRichText(page, PROPS.contextSummary) || null,
      backing_or_affiliation: readRichText(page, PROPS.backing) || null,
      profile_url: readUrl(page, PROPS.profileUrl),
    };

    try {
      const draft = await draftFollowUp(env, contact, profile, followUps + 1);
      const gmail = await createDraft(env, {
        to: email,
        subject: draft.subject,
        body: draft.body,
        from: profile.senderEmail,
        listUnsubscribe: await unsubscribeUrl(origin, env.WEBHOOK_SECRET, email),
      });
      await notion.updatePage(page.id, {
        [PROPS.draftSubject]: prop.richText(draft.subject),
        [PROPS.draftBody]: prop.richText(draft.body),
        [PROPS.gmailDraft]: prop.url(gmail.link),
        [PROPS.followUps]: prop.number(followUps + 1),
        [PROPS.lastEmailed]: prop.date(today),
      });
      budget -= 4;
      report.drafted++;
    } catch (err) {
      report.errors.push(`followup ${contact.contact_name}: ${errText(err)}`);
    }
  }

  console.log("[followups]", JSON.stringify(report));
  return report;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
