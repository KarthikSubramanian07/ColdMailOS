import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyEmail } from "../src/verify/email";

const env = { KV: { get: async () => null, put: async () => {} } } as any;

function stubMx(present: boolean) {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ Answer: present ? [{ type: 15 }] : [] }),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("verifyEmail", () => {
  it("grades a personal address on an MX domain as safe", async () => {
    stubMx(true);
    expect((await verifyEmail(env, "Jane.Doe@x.edu")).grade).toBe("safe");
  });

  it("grades a role-based address as risky", async () => {
    stubMx(true);
    const v = await verifyEmail(env, "info@x.edu");
    expect(v.grade).toBe("risky");
    expect(v.reasons).toContain("role_based");
  });

  it("grades a disposable domain as risky", async () => {
    stubMx(true);
    const v = await verifyEmail(env, "someone@mailinator.com");
    expect(v.grade).toBe("risky");
    expect(v.reasons).toContain("disposable");
  });

  it("grades a domain with no MX as risky", async () => {
    stubMx(false);
    const v = await verifyEmail(env, "jane@no-mail-here.example");
    expect(v.grade).toBe("risky");
    expect(v.reasons).toContain("no_mx");
  });

  it("returns unknown for invalid syntax without any DNS call", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("should not be called");
    });
    expect((await verifyEmail(env, "not-an-email")).grade).toBe("unknown");
  });

  it("returns unknown when the DNS lookup fails on an otherwise-clean address", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("dns down");
    });
    expect((await verifyEmail(env, "jane@x.edu")).grade).toBe("unknown");
  });

  it("spends a subrequest only when it hits DNS", async () => {
    stubMx(true);
    let spent = 0;
    await verifyEmail(env, "jane@x.edu", () => spent++);
    expect(spent).toBe(1);
    spent = 0;
    await verifyEmail(env, "bad", () => spent++); // invalid syntax, no DNS
    expect(spent).toBe(0);
  });
});
