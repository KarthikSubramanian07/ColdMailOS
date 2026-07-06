/** Shared types for ResearchMailOS. */

/** Cloudflare Worker environment — bindings, secrets, and vars. */
export interface Env {
  /** KV: holds per-user config (config:*) and per-URL content hashes (hash:*). */
  KV: KVNamespace;

  // ── Secrets (wrangler secret put …) ──────────────────────────────────────
  GROQ_API_KEY: string;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  WEBHOOK_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;

  // ── Vars (wrangler.toml [vars]) ──────────────────────────────────────────
  GROQ_MODEL: string;
  NOTION_VERSION: string;
  ENABLE_PROFILE_SECOND_PASS: string;
  MAX_PAGES_PER_RUN: string;
  LLM_THROTTLE_MS: string;
}

/** One extracted researcher. Every field except `name` may be null/absent. */
export interface Person {
  name: string;
  title: string | null;
  email: string | null;
  research_focus: string | null;
  profile_url: string | null;
  /** Filled in by the pipeline, not the LLM. */
  institution?: string | null;
  source_url?: string;
}

/** The user's private background — feeds the drafting prompt. */
export interface ProfileConfig {
  name: string;
  background: string;
  researchInterests: string;
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
