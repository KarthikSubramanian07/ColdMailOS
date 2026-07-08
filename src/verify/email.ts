import type { Env } from "../types";

/**
 * Lightweight, Workers-native email grading. We do everything that's possible
 * without SMTP (Cloudflare blocks outbound port 25, so mailbox-level checks and
 * catch-all detection are impossible): syntax, role/disposable heuristics, and
 * an MX lookup over DNS-over-HTTPS. The result is a confidence bucket, never a
 * guessed address:
 *   safe    - real-looking personal address on a domain that accepts mail
 *   risky   - role/disposable/no-MX; deliverable-ness is doubtful
 *   unknown - couldn't determine (bad syntax, or the DNS lookup failed)
 */
export type EmailGrade = "safe" | "risky" | "unknown";

export interface EmailVerdict {
  grade: EmailGrade;
  reasons: string[];
}

const SYNTAX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Generic mailboxes: real but not a person, so treat as risky for 1:1 outreach. */
const ROLE_PREFIXES = new Set([
  "info", "admin", "hello", "contact", "support", "sales", "careers", "jobs",
  "team", "office", "noreply", "no-reply", "help", "press", "media", "hr",
  "billing", "webmaster", "postmaster", "enquiries", "inquiries", "general",
]);

/** A representative disposable-domain set. Extend or load a full list into KV. */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "yopmail.com",
  "temp-mail.org", "tempmail.com", "throwawaymail.com", "getnada.com",
  "trashmail.com", "sharklasers.com", "maildrop.cc", "dispostable.com",
  "fakeinbox.com", "mvrht.com", "spam4.me", "mailnesia.com",
]);

const MX_TTL = 7 * 24 * 60 * 60; // cache MX result per domain for a week

/** Grade an address. `spend` is called once if a DNS subrequest was made. */
export async function verifyEmail(
  env: Env,
  email: string,
  spend?: () => void,
): Promise<EmailVerdict> {
  const e = email.trim().toLowerCase();
  if (!SYNTAX.test(e)) return { grade: "unknown", reasons: ["invalid_syntax"] };

  const [local, domain] = e.split("@");
  const reasons: string[] = [];
  if (ROLE_PREFIXES.has(local)) reasons.push("role_based");
  if (DISPOSABLE_DOMAINS.has(domain)) reasons.push("disposable");

  const mx = await hasMx(env, domain, spend);
  if (mx === false) reasons.push("no_mx");

  let grade: EmailGrade;
  if (reasons.length > 0) grade = "risky";
  else if (mx === null) grade = "unknown"; // lookup failed, no other red flags
  else grade = "safe";

  return { grade, reasons };
}

/** True/false if the domain has MX records; null if the lookup itself failed. */
async function hasMx(env: Env, domain: string, spend?: () => void): Promise<boolean | null> {
  const key = `mx:${domain}`;
  const cached = await env.KV.get(key);
  if (cached === "1") return true;
  if (cached === "0") return false;
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=MX`, {
      headers: { accept: "application/dns-json" },
    });
    spend?.();
    if (!res.ok) return null;
    const data = (await res.json()) as { Answer?: unknown[] };
    const has = Array.isArray(data.Answer) && data.Answer.length > 0;
    await env.KV.put(key, has ? "1" : "0", { expirationTtl: MX_TTL });
    return has;
  } catch {
    return null;
  }
}
