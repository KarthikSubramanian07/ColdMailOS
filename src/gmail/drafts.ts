import type { Env } from "../types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

export interface DraftInput {
  to: string | null; // recipient — left blank if no email was found
  subject: string;
  body: string;
  from?: string; // optional From display; defaults to the authenticated account
}

export interface DraftOutput {
  draftId: string;
  messageId: string;
  link: string;
}

/** Exchange the stored refresh token for a short-lived access token. */
export async function getAccessToken(env: Env): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail token refresh failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Gmail token refresh returned no access_token.");
  return data.access_token;
}

/**
 * Create a Gmail DRAFT (never sends — the OAuth scope is gmail.compose only).
 * The recipient is pre-filled when we found an email; otherwise it's left blank.
 */
export async function createDraft(env: Env, input: DraftInput): Promise<DraftOutput> {
  const accessToken = await getAccessToken(env);
  const raw = buildRawMessage(input);

  const res = await fetch(DRAFTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail draft create failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { id?: string; message?: { id?: string } };
  const draftId = data.id ?? "";
  const messageId = data.message?.id ?? "";
  // Opens the draft in the Gmail web UI. Falls back to the Drafts list if the
  // deep-link id isn't recognized by the client.
  const link = messageId
    ? `https://mail.google.com/mail/u/0/#drafts/${messageId}`
    : "https://mail.google.com/mail/u/0/#drafts";

  return { draftId, messageId, link };
}

/** Build an RFC 2822 message and base64url-encode it for the Gmail API. */
export function buildRawMessage({ to, subject, body, from }: DraftInput): string {
  const headers = [
    from ? `From: ${sanitizeHeader(from)}` : null,
    to ? `To: ${sanitizeHeader(to)}` : null,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);

  const message = `${headers.join("\r\n")}\r\n\r\n${bytesToBase64(utf8(body))}`;
  return base64UrlEncode(message);
}

/** Strip CR/LF so a header value can't inject additional headers (e.g. Bcc). */
export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047 encode a header value if it contains non-ASCII characters. */
export function encodeHeader(value: string): string {
  const clean = sanitizeHeader(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${bytesToBase64(utf8(clean))}?=`;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64UrlEncode(s: string): string {
  return bytesToBase64(utf8(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
