/** Constant-time string comparison to avoid leaking a secret via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Authenticate a shared Worker secret. Returns false if the configured secret
 * is missing/empty (so an unset env can never open the endpoint via "" === "").
 */
export function checkSharedSecret(provided: string, configured: string | undefined): boolean {
  if (!configured) return false;
  return timingSafeEqual(provided, configured);
}

/** True only for absolute http(s) URLs — used to block javascript:/data: redirects. */
export function isSafeHttpUrl(target: string): boolean {
  try {
    const u = new URL(target);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
