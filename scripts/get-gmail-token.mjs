#!/usr/bin/env node
// 
//  One-time Gmail OAuth - mints a refresh token for the gmail.compose scope.
//  Zero dependencies. Run once locally:  npm run gmail:auth
//
//  Prereqs (see README -> "Gmail"):
//    - A Google Cloud OAuth 2.0 "Web application" client.
//    - Authorized redirect URI: http://localhost:5173/oauth2callback
//    - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (copy .env.example).
// 

import http from "node:http";
import { readFileSync } from "node:fs";
import { exec } from "node:child_process";

const SCOPE = "https://www.googleapis.com/auth/gmail.compose";

loadDotenv();
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_PORT || 5173);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\nMissing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.\n" +
      "  Copy .env.example -> .env and fill them in first.\n",
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // force a refresh_token every time
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/html" }).end(`<h2>OAuth failed: ${error}</h2>`);
    console.error("\nOAuth error:", error);
    server.close();
    process.exit(1);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const data = await tokenRes.json();

    if (!data.refresh_token) {
      throw new Error(
        "No refresh_token returned. Revoke prior access at " +
          "https://myaccount.google.com/permissions and re-run.",
      );
    }

    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Done - you can close this tab and return to the terminal.</h2>",
    );

    console.log("\nSuccess! Store this as a Cloudflare secret:\n");
    console.log("  wrangler secret put GMAIL_REFRESH_TOKEN");
    console.log("  (paste the value below when prompted)\n");
    console.log("".repeat(60));
    console.log(data.refresh_token);
    console.log("".repeat(60) + "\n");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" }).end(`<h2>${err.message}</h2>`);
    console.error("\n", err.message);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
});

server.listen(PORT, () => {
  console.log(`\nOpening your browser to authorize Gmail (draft-only) access...`);
  console.log(`If it doesn't open, visit:\n\n${authUrl}\n`);
  open(authUrl);
});

//  tiny helpers 

function open(target) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${target}"`, () => {});
}

function loadDotenv() {
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // no .env - rely on real env vars
  }
}
