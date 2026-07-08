import { describe, it, expect } from "vitest";
import {
  isSuppressed,
  suppress,
  unsubscribeToken,
  verifyUnsubscribe,
  unsubscribeUrl,
} from "../src/suppress";

// In-memory KV stub
function fakeEnv() {
  const store = new Map<string, string>();
  return {
    KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    },
  } as any;
}

describe("suppression list", () => {
  it("suppresses and reports case-insensitively", async () => {
    const env = fakeEnv();
    expect(await isSuppressed(env, "Jane@X.edu")).toBe(false);
    await suppress(env, "jane@x.edu");
    expect(await isSuppressed(env, "JANE@X.EDU")).toBe(true);
  });
});

describe("unsubscribe tokens", () => {
  const secret = "s3cret-value";
  it("round-trips a valid token and rejects a bad one", async () => {
    const t = await unsubscribeToken(secret, "jane@x.edu");
    expect(await verifyUnsubscribe(secret, "jane@x.edu", t)).toBe(true);
    expect(await verifyUnsubscribe(secret, "jane@x.edu", "deadbeef")).toBe(false);
    expect(await verifyUnsubscribe(secret, "other@x.edu", t)).toBe(false);
    expect(await verifyUnsubscribe("wrong-secret", "jane@x.edu", t)).toBe(false);
  });
  it("builds a URL carrying the email and token", async () => {
    const u = await unsubscribeUrl("https://w.example", secret, "jane@x.edu");
    expect(u.startsWith("https://w.example/unsubscribe?e=jane%40x.edu&t=")).toBe(true);
  });
});
