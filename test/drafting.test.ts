import { describe, it, expect } from "vitest";
import { systemPrompt, buildUserPrompt, parseDraft } from "../src/drafting/groq";
import type { Contact, ProfileConfig } from "../src/types";

const profile: ProfileConfig = {
  mode: "research",
  name: "Ada Lovelace",
  background: "second-year CS undergrad",
  interests: "programming languages",
};

const contact: Contact = {
  contact_name: "Prof X",
  role: null,
  entity_name: "MIT",
  email: null,
  context_summary: "AI safety and alignment",
  backing_or_affiliation: null,
  profile_url: null,
};

describe("systemPrompt", () => {
  it("selects mode-specific framing", () => {
    expect(systemPrompt("startup").toLowerCase()).toContain("founder");
    expect(systemPrompt("research").toLowerCase()).toContain("academic");
  });
  it("bans clichés in both modes", () => {
    expect(systemPrompt("research")).toContain("BANNED");
    expect(systemPrompt("startup")).toContain("BANNED");
  });
});

describe("buildUserPrompt", () => {
  it("includes the recipient's context and the sender's background", () => {
    const p = buildUserPrompt(contact, profile);
    expect(p).toContain("Prof X");
    expect(p).toContain("AI safety and alignment");
    expect(p).toContain("Ada Lovelace");
    expect(p).toContain("programming languages");
  });
  it("labels the recipient by mode", () => {
    expect(buildUserPrompt(contact, { ...profile, mode: "startup" })).toContain("FOUNDER");
    expect(buildUserPrompt(contact, profile)).toContain("RECIPIENT");
  });
  it("includes research insight when provided, omits the section otherwise", () => {
    const withInsight = buildUserPrompt(contact, profile, "Specific detail to reference: new alignment paper");
    expect(withInsight).toContain("ADDITIONAL RESEARCH");
    expect(withInsight).toContain("new alignment paper");
    expect(buildUserPrompt(contact, profile)).not.toContain("ADDITIONAL RESEARCH");
  });
});

describe("parseDraft", () => {
  it("parses valid JSON", () => {
    expect(parseDraft('{"subject":"S","body":"B"}', profile)).toEqual({ subject: "S", body: "B" });
  });
  it("falls back safely on malformed output", () => {
    const d = parseDraft("not json", profile);
    expect(d.subject).toBeTruthy();
    expect(d.body).toContain("Ada Lovelace");
  });
  it("falls back when a field is missing", () => {
    const d = parseDraft('{"subject":"only subject"}', profile);
    expect(d.body).toBeTruthy();
  });
});
