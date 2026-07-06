#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  Push your private config into Cloudflare KV so the deployed Worker can read
//  it. Run after editing source-urls.json / private-config.json:
//
//      npm run config:push
//
//  This shells out to wrangler, which uses the KV binding + namespace id from
//  wrangler.toml. Writes to the REMOTE namespace by default (what the deployed
//  Worker reads). Pass `--local` to target the local dev namespace instead.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const local = process.argv.includes("--local");
const scope = local ? "--local" : "--remote";

const targets = [
  { file: "source-urls.json", key: "config:source-urls", validate: validateUrls },
  { file: "private-config.json", key: "config:profile", validate: validateProfile },
];

let pushed = 0;
for (const { file, key, validate } of targets) {
  if (!existsSync(file)) {
    console.error(`✗ ${file} not found. Copy ${file.replace(".json", ".example.json")} → ${file}.`);
    continue;
  }
  try {
    validate(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    console.error(`✗ ${file} is invalid: ${err.message}`);
    process.exit(1);
  }

  console.log(`→ Pushing ${file} → KV["${key}"] (${scope.replace("--", "")})…`);
  const res = spawnSync(
    "npx",
    ["wrangler", "kv", "key", "put", key, "--path", file, "--binding", "KV", scope],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (res.status !== 0) {
    console.error(`✗ wrangler failed for ${key}. Is your KV namespace id set in wrangler.toml?`);
    process.exit(res.status ?? 1);
  }
  pushed++;
}

console.log(pushed ? `\n✓ Pushed ${pushed} config file(s) to KV.\n` : "\nNothing pushed.\n");

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
