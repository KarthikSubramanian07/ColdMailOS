#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  Push your private config into Cloudflare KV so the deployed Worker can read
//  it. Run after editing source-urls.json / private-config.json / resume.md:
//
//      npm run config:push
//
//  This shells out to wrangler, which uses the KV binding + namespace id from
//  wrangler.toml. Writes to the REMOTE namespace by default (what the deployed
//  Worker reads). Pass `--local` to target the local dev namespace instead.
//
//  Resume/CV: if a `resume.md` or `resume.txt` file exists (both gitignored),
//  its full contents are folded into your profile as `resumeText` — so you can
//  drop in a whole resume without escaping it into JSON. It stays private: it's
//  only ever pushed to YOUR KV, never committed.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const local = process.argv.includes("--local");
// Wrangler v4 defaults KV commands to LOCAL, so pass --remote explicitly for the
// deployed namespace (or --local for the dev one).
const scopeArgs = local ? ["--local"] : ["--remote"];
const scopeLabel = local ? "local" : "remote";

// Target a specific deployment's KV namespace, e.g. `npm run config:push -- --env startups`.
const envIdx = process.argv.indexOf("--env");
const envName = envIdx >= 0 ? process.argv[envIdx + 1] : null;
const envArgs = envName ? ["--env", envName] : [];

const RESUME_FILES = ["resume.md", "resume.txt"];

let pushed = 0;
pushSourceUrls();
pushProfile();
const where = envName ? `${scopeLabel}, env=${envName}` : scopeLabel;
console.log(pushed ? `\n✓ Pushed ${pushed} config item(s) to KV (${where}).\n` : "\nNothing pushed.\n");

// ── source-urls.json → config:source-urls ───────────────────────────────────
function pushSourceUrls() {
  const file = "source-urls.json";
  if (!existsSync(file)) {
    console.error(`✗ ${file} not found. Copy source-urls.example.json → ${file}.`);
    return;
  }
  try {
    validateUrls(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    console.error(`✗ ${file} is invalid: ${err.message}`);
    process.exit(1);
  }
  console.log(`→ Pushing ${file} → KV["config:source-urls"]…`);
  kvPut("config:source-urls", file);
  pushed++;
}

// ── private-config.json (+ resume file) → config:profile ─────────────────────
function pushProfile() {
  const file = "private-config.json";
  if (!existsSync(file)) {
    console.error(`✗ ${file} not found. Copy private-config.example.json → ${file}.`);
    return;
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(file, "utf8"));
    validateProfile(profile);
  } catch (err) {
    console.error(`✗ ${file} is invalid: ${err.message}`);
    process.exit(1);
  }

  // Fold in a full resume/CV file if present (overrides resumeText).
  const resumeFile = RESUME_FILES.find((f) => existsSync(f));
  if (resumeFile) {
    const text = readFileSync(resumeFile, "utf8").trim();
    if (text) {
      profile.resumeText = text;
      console.log(`  ↳ merged ${resumeFile} into resumeText (${text.length} chars)`);
    }
  }

  console.log(`→ Pushing ${file} → KV["config:profile"]…`);
  // Write the merged object to a temp file so wrangler can --path it.
  const tmp = join(tmpdir(), `rmos-profile-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify(profile));
  try {
    kvPut("config:profile", tmp);
    pushed++;
  } finally {
    unlinkSync(tmp);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function kvPut(key, path) {
  const res = spawnSync(
    "npx",
    ["wrangler", "kv", "key", "put", key, "--path", path, "--binding", "KV", ...envArgs, ...scopeArgs],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (res.status !== 0) {
    console.error(`✗ wrangler failed for ${key}. Is your KV namespace id set in wrangler.toml?`);
    process.exit(res.status ?? 1);
  }
}

function validateUrls(v) {
  if (!Array.isArray(v) || v.length === 0) throw new Error("must be a non-empty array of URLs");
  for (const u of v) if (typeof u !== "string" || !/^https?:\/\//.test(u)) throw new Error(`bad URL: ${u}`);
}
function validateProfile(v) {
  if (!v || typeof v !== "object") throw new Error("must be an object");
  for (const k of ["name", "background", "researchInterests"]) {
    if (!v[k]) throw new Error(`missing required field: ${k}`);
  }
}
