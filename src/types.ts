/** Shared types for ColdMailOS. */

/** Cloudflare Worker environment - bindings, secrets, and vars. */
export interface Env {
  /** KV: holds per-user config (config:*) and per-URL content hashes (hash:*). */
  KV: KVNamespace;

  //  Secrets (wrangler secret put ...) 
  GROQ_API_KEY: string;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  WEBHOOK_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  /** Optional: enables JS-rendered page extraction via Jina Reader (r.jina.ai). */
  JINA_API_KEY?: string;

  //  Vars (wrangler.toml [vars])
  GROQ_MODEL: string;
  NOTION_VERSION: string;
  ENABLE_PROFILE_SECOND_PASS: string;
  MAX_PAGES_PER_RUN: string;
  LLM_THROTTLE_MS: string;
  /** Free-plan Workers allow 50 subrequests per invocation; stay under it. */
  MAX_SUBREQUESTS: string;
  /** Cap LLM extraction calls per run so a single /scrape finishes quickly. */
  MAX_LLM_CALLS_PER_RUN: string;
}

/** Outreach mode. Free string (not a strict enum) so new modes are trivial. */
export type Mode = "research" | "startup" | (string & {});

/**
 * One extracted contact. Field names are generalized so they read naturally for
 * either mode (see the mapping in the README). Everything except contact_name
 * and entity_name may be null/absent.
 */
export interface Contact {
  contact_name: string;
  role: string | null;
  entity_name: string | null;
  email: string | null;
  context_summary: string | null;
  backing_or_affiliation: string | null;
  profile_url: string | null;
  source_url?: string;
}

/** The user's private background - feeds the drafting prompt. */
export interface ProfileConfig {
  /** "research" | "startup" | ... - selects extraction + drafting wording. */
  mode: Mode;
  name: string;
  background: string;
  /** What you want: research topics, or the kind of company/role you're after. */
  interests: string;
  /** Startup mode: e.g. "internship or full-time". Optional. */
  opportunityType?: string;
  resumeText?: string;
  tone?: string;
  signature?: string;
  senderEmail?: string;
}

/** A generated outreach email. */
export interface DraftResult {
  subject: string;
  body: string;
}
