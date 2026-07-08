import type { Contact, Env, ProfileConfig } from "./types";
import { groqJson } from "./groqClient";
import { fetchPage } from "./extract/fetchPage";
import { checkRobots } from "./extract/robots";
import { INSIGHT_JSON_SCHEMA, InsightZ } from "./llmSchema";

/**
 * Research-before-draft: before writing the email, read the contact's own page
 * (their faculty/company site) and distill one concrete, referenceable detail
 * plus a fit angle. This lets the draft cite something specific and recent
 * instead of only the scraped one-liner. Page content only, never fabricated.
 * Cached per profile URL in KV for a day. Returns a prompt block, or null.
 */
export async function gatherInsight(
  env: Env,
  contact: Contact,
  profile: ProfileConfig,
  spend?: () => void,
): Promise<string | null> {
  const url = contact.profile_url;
  if (!url) return null;

  const cacheKey = `insight:${url}`;
  const cached = await env.KV.get(cacheKey);
  if (cached !== null) return cached || null; // "" means "checked, nothing useful"

  const gate = await checkRobots(env, url);
  if (!gate.allowed) return null;

  let text: string;
  try {
    text = await fetchPage(url, env);
    spend?.();
  } catch {
    return null;
  }
  if (text.length < 200) return null;

  let content: string;
  try {
    content = await groqJson(
      env,
      [
        {
          role: "system",
          content:
            "You research one person/company for a cold email. From the page text return: " +
            "summary (what they focus on, one line); specific_detail (ONE concrete, recent, " +
            "verifiable detail worth referencing - a paper, product, talk, or project - taken " +
            "ONLY from the page); fit_angle (one phrase on how the sender connects). Use only " +
            "page content. Null for anything not present. Never fabricate.",
        },
        {
          role: "user",
          content:
            `CONTACT: ${contact.contact_name}` +
            (contact.entity_name ? ` (${contact.entity_name})` : "") +
            `\nSENDER INTERESTS: ${profile.interests}\n\nPAGE TEXT:\n${text}`,
        },
      ],
      { schema: INSIGHT_JSON_SCHEMA, maxTokens: 500 },
    );
    spend?.();
  } catch {
    return null;
  }

  const parsed = InsightZ.safeParse(safeJson(content));
  if (!parsed.success) {
    await env.KV.put(cacheKey, "", { expirationTtl: 86400 });
    return null;
  }
  const { summary, specific_detail, fit_angle } = parsed.data;
  const lines = [
    summary ? `What they focus on: ${summary}` : null,
    specific_detail ? `Specific detail to reference: ${specific_detail}` : null,
    fit_angle ? `Possible fit angle: ${fit_angle}` : null,
  ].filter(Boolean);
  const block = lines.join("\n");
  await env.KV.put(cacheKey, block, { expirationTtl: 86400 });
  return block || null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
