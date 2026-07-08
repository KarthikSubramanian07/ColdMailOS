<div align="center">

# 📬 ColdMailOS

### Point it at any list of pages - labs, VC portfolios, anywhere - and get a Notion board of contacts. Tick a box, get a personalized cold email drafted in Gmail.

It reads the pages, pulls out the people (and what they work on), and drops them into Notion. When you tick a box next to someone, it writes a personal outreach email that references *their* work and *your* background, then leaves it as a Gmail draft for you to review and send.

**One codebase, two modes: reaching researchers or reaching startup founders. No servers. No monthly bill. No email ever sent without you hitting the button.**

<br>

[![CI](https://github.com/KarthikSubramanian07/ColdMailOS/actions/workflows/ci.yml/badge.svg)](https://github.com/KarthikSubramanian07/ColdMailOS/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)
![Cloudflare Workers](https://img.shields.io/badge/Runs%20on-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)
![Groq](https://img.shields.io/badge/LLM-Groq-000000)
![Notion](https://img.shields.io/badge/UI-Notion-000000?logo=notion&logoColor=white)
![Cost](https://img.shields.io/badge/Cost-%240%2Fmo-brightgreen)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-blueviolet.svg)
[![Buy Me a Coffee](https://img.shields.io/badge/%E2%98%95%20Buy%20me%20a%20coffee-support-FFDD00)](https://buymeacoffee.com/winnerkarthik)

</div>

---

## What it does

You're cold-emailing people: professors for a PhD/UROP, or founders for an internship/role. The tedious parts are (1) finding who works on what, and (2) writing each email so it doesn't read like a mail-merge. ColdMailOS does the finding automatically and drafts the emails for you, so all that's left is the part only you can do: reading it, tweaking a line, and hitting send.

```
  your list of URLs
        |
        v
  [ weekly cron ]  fetch each page, extract contacts with an LLM
        |
        v
  Notion board  (name, entity, what they work on, email if public)
        |
        v
  you tick "Draft Email"  -->  webhook  -->  Gmail draft (never sent, ready to review)
```

1. **Extract** - a Cloudflare Worker fetches each page you list, strips it to text, and asks an LLM to pull out every contact: *name, role, entity, email (only if actually shown), what they work on, and a profile link*.
2. **Sync** - new contacts are de-duplicated and pushed into a Notion database you browse and triage like a CRM.
3. **Draft** - tick **Draft Email** on anyone, and a webhook writes a short, specific outreach email using your background + their work, then creates a Gmail draft with their address pre-filled.
4. **Send** - you review the draft in Gmail and send it yourself. Always. The tool literally cannot send mail (see [Design principles](#-design-principles-the-non-negotiables)).

Not interested in someone? Tick **Remove** and the row archives itself.

---

## 🎭 Two modes, one codebase

ColdMailOS runs in a `mode` you set in your config - no code fork. The same extraction and drafting pipeline just uses mode-appropriate wording. Deploy it twice (once per mode) and each deployment has its own target list, Notion database, and voice.

| Generalized field | `research` mode means... | `startup` mode means... |
|---|---|---|
| **Contact Name** | Professor / researcher | Founder |
| **Role** | "Associate Professor" | "Co-founder & CEO" |
| **Entity** | Lab / department / institution | Company / startup |
| **Context Summary** | Their research focus | What the company does |
| **Backing/Affiliation** | Center/group (e.g. "BAIR") | Investor/accelerator (e.g. "YC W26", "a16z-backed") |
| **Profile URL** | Faculty page | Company site / founder LinkedIn |

**Startup mode also adds an email fallback:** VC portfolio pages rarely show an email, so when one isn't on the listing, ColdMailOS follows the company's website link and checks its `/contact` and `/careers` pages for a *visible* address. If it still can't find one, it leaves the field blank - never a guessed `founder@company.com`.

---

## 🧭 Design principles (the non-negotiables)

Baked into the code, not just the docs - and true in **both** modes:

| Principle | How it's enforced |
|---|---|
| **Never fabricate an email.** | The extraction prompt forbids guessing, and a regex guard drops anything that isn't a real address found on the page. No email visible -> the field stays blank and you fill it in. |
| **Never send mail automatically.** | The Gmail OAuth scope is `gmail.compose` - **draft-only**. There is no code path, and no *permission*, to send. You always press send. |
| **No hardcoded targets.** | The public repo ships only generic examples. Your real target lists and background live in gitignored files, pushed to your private Cloudflare KV. |
| **Respect the open web.** | It reads public pages with an honest User-Agent and **checks `robots.txt` before every fetch** (cached per site, crawl-delay honored). Point it only at pages you're allowed to read. |

---

## ✅ What you'll need

Five free accounts, ~30-40 min for first-time setup:

- [ ] **[Cloudflare](https://dash.cloudflare.com/sign-up)** - hosts the Worker, cron, and KV storage.
- [ ] **[Groq](https://console.groq.com)** - free, fast LLM inference. One API key.
- [ ] **[Notion](https://notion.so)** - your dashboard + the checkboxes that trigger drafting/removal.
- [ ] **[Google Cloud](https://console.cloud.google.com)** - a Gmail API OAuth client (draft-only).
- [ ] **Node.js 22+** and **npm** (Wrangler v4 requires Node 22).

---

## ⚡ Quickstart (clone once, deploy per mode)

```bash
git clone https://github.com/YOU/coldmailos.git && cd coldmailos
npm install
npx wrangler login
npx wrangler kv namespace create KV        # paste the id into wrangler.toml (per env)

cp source-urls.example.research.json source-urls.json   # your pages
cp private-config.example.json private-config.json        # set "mode" + your background
cp .env.example .env                                      # Google client id/secret

# set the 7 secrets for the environment you're deploying (see the table below)
npx wrangler secret put GROQ_API_KEY --env research
# ... NOTION_TOKEN, NOTION_DATABASE_ID, WEBHOOK_SECRET, GOOGLE_CLIENT_ID,
#    GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN  (all --env research)

npm run gmail:auth                  # one-time OAuth -> prints GMAIL_REFRESH_TOKEN
npm run config:push -- --env research   # source-urls.json + private-config.json -> KV
npm run deploy:research             # ship it
```

Then build the [Notion dashboard](#-the-notion-dashboard), add the automations pointing at `https://coldmailos-research.<you>.workers.dev/webhook/notion?secret=<WEBHOOK_SECRET>`, and you're live. Repeat with `--env startups` for the second deployment.

---

## 🛠️ Full setup

### Step 1 - Clone and install
```bash
git clone https://github.com/YOU/coldmailos.git
cd coldmailos
npm install
```

### Step 2 - Cloudflare (Worker + KV)
```bash
npx wrangler login
npx wrangler kv namespace create KV
```
Paste the printed `id` into **`wrangler.toml`** under the environment you're setting up (`[env.research]` and/or `[env.startups]` -> `kv_namespaces`). Each deployment needs its own namespace.

### Step 3 - Groq API key
[console.groq.com](https://console.groq.com) -> **API Keys** -> **Create API Key**. Set it in Step 7. Default model is `openai/gpt-oss-120b`, which supports strict structured outputs so extractions come back as valid, schema-shaped JSON (change in `wrangler.toml` -> `[vars]`).

### Step 4 - Notion (database, integration)
Build the database first - jump to [The Notion dashboard](#-the-notion-dashboard) for the exact columns, then:
1. **Create an integration** at [notion.so/my-integrations](https://www.notion.so/my-integrations) -> **New integration** (type: **Internal**) -> copy the **Internal Integration Secret** (`ntn_...`). This is your `NOTION_TOKEN`. *(Use the token, not OAuth - OAuth is only for public multi-tenant apps.)*
2. **Share the database with it:** open the DB -> **---** -> **Connections** -> add your integration.
3. **Get the database ID:** from the DB URL, copy the 32-char hex before `?v=`. This is your `NOTION_DATABASE_ID`.

Two deployments = two databases (same schema). Repeat for each.

### Step 5 - Gmail (draft-only OAuth)
1. [Google Cloud Console](https://console.cloud.google.com) -> new project -> enable **Gmail API**.
2. **OAuth consent screen** -> **External** -> add your Google account as a **Test user**.
3. **Credentials -> Create -> OAuth client ID -> Web application** -> **Authorized redirect URI** `http://localhost:5173/oauth2callback` -> copy **Client ID** + **Client secret**.
4. Put those in `.env`, then run:
   ```bash
   cp .env.example .env    # fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
   npm run gmail:auth      # opens browser -> prints GMAIL_REFRESH_TOKEN
   ```
   > The consent screen says "Manage drafts and send emails" - that's Google's bundled label, but the scope requested is `gmail.compose`, which **cannot send**. Verify in `scripts/get-gmail-token.mjs`.

### Step 6 - Your config files

Gitignored - never committed.

```bash
cp source-urls.example.research.json source-urls.json    # or .startup.json
cp private-config.example.json private-config.json
```

**`source-urls.json`** - a flat list of pages to read (any mix):
```json
["https://www.cs.someuniv.edu/people/faculty", "https://somelab.someuniv.edu/team"]
```

**`private-config.json`** - who you are, how you sound, and the mode (see [`config.schema.json`](config.schema.json)):
```json
{
  "mode": "research",
  "name": "Your Name",
  "background": "Second-year CS undergrad at X. Built a compiler; TA'd systems.",
  "interests": "Programming languages and verification - making dependent types usable.",
  "opportunityType": "internship or full-time",
  "tone": "Warm but concise. Specific, low-pressure. No buzzwords.",
  "signature": "Your Name\nB.S. CS, X University\nyou@x.edu",
  "senderEmail": "you@x.edu"
}
```
`mode` is `"research"` or `"startup"` - it switches the extraction and drafting wording. Frame `background`/`interests` for the mode (research experience for research; builder/project experience for startup).

**Optional - your resume/CV:** `cp resume.example.md resume.md` and paste your real resume. `config:push` folds it into your profile automatically for richer, more specific drafts. It's gitignored (`resume.md`/`.txt`/`.pdf`) and only pushed to *your* KV.

### Step 7 - Set your secrets (per environment)
```bash
npx wrangler secret put GROQ_API_KEY --env research
npx wrangler secret put NOTION_TOKEN --env research
npx wrangler secret put NOTION_DATABASE_ID --env research
npx wrangler secret put WEBHOOK_SECRET --env research      # invent one: openssl rand -hex 24
npx wrangler secret put GOOGLE_CLIENT_ID --env research
npx wrangler secret put GOOGLE_CLIENT_SECRET --env research
npx wrangler secret put GMAIL_REFRESH_TOKEN --env research
```
Repeat with `--env startups` for the second deployment. (Notion/Groq/Gmail secrets *can* be identical across envs if it's the same accounts - they're just settable per env for flexibility.)

### Step 8 - Push your config to KV
```bash
npm run config:push -- --env research    # (or --env startups)
```
Re-run after editing `source-urls.json` / `private-config.json` / `resume.md`.

### Step 9 - Deploy
```bash
npm run deploy:research      # -> https://coldmailos-research.<you>.workers.dev
```
Test it, then kick off the first scrape (don't wait for the weekly cron):
```bash
curl https://coldmailos-research.<you>.workers.dev/health   # -> ok
curl -X POST "https://coldmailos-research.<you>.workers.dev/scrape?secret=YOUR_WEBHOOK_SECRET"
```
The scrape returns a JSON report. On large directories it writes in batches to stay within the free-tier limit and reports `stoppedEarly: true` - just run it again to continue; it resumes where it left off.

### Step 10 - Wire the Notion automations
In your database: **---** -> **Automations** -> **New automation**. Create **two**:

1. **Draft:** Trigger *"Draft Email" is checked* -> Action **Send webhook** -> URL:
   `https://coldmailos-research.<you>.workers.dev/webhook/notion?secret=YOUR_WEBHOOK_SECRET`
2. **Remove:** Trigger *"Remove" is checked* -> Action **Send webhook** -> **same URL**.

The worker tells them apart: **Remove** archives the row; **Draft Email** drafts the email + creates the Gmail draft.

> **Why the secret in the URL?** Server-to-server webhooks can't use a login wall, so the endpoint verifies your `WEBHOOK_SECRET`. Keep the URL private.

---

## 🎨 The Notion dashboard

Create a blank **Database - Table**, then run `POST /setup?secret=...` once: it adds every column the code needs (correct types + select options) and best-effort arranges the view. You don't have to build the columns by hand. For reference, the core columns are:

| Property | Type | Holds |
|---|---|---|
| **Contact Name** | Title | Person's name |
| **Context Summary** | Text | What they work on (the decision info) |
| **Entity** / **Role** / **Backing/Affiliation** | Text | Lab or company / title / center or investor |
| **Email** | Email | Only if public; else blank |
| **Email Confidence** | Select | Safe / Risky / Unknown (from verification) |
| **Status** | Select | Pipeline stage (options below) |
| **Draft Email** | Checkbox | **Tick -> generate a draft** |
| **Remove** | Checkbox | **Tick -> archive the row** |
| **Gmail Draft** / **Profile URL** / **Source URL** | URL | Draft deep-link / their page / where we found them |
| **Follow-ups** / **Last Emailed** | Number / Date | Follow-up sequencing state |
| **Opened** / **Clicked** / **Last Activity** | Number / Number / Date | Engagement (only when tracking is on) |
| **Draft Subject** / **Draft Body** | Text | Written back by the tool |

**Status options + colors:** `Not Contacted` (gray) - `Emailed` (blue) - `Replied` (green) - `No Response` (yellow).

### Make it pretty (60 seconds, one-time)

Notion's API can create the columns but **can't** set view formatting - column widths, text wrapping, hidden columns, or Board/filtered views. Those are quick manual touches:

- **Wrap** the `Context Summary` column (column header -> **Wrap column**) so you can read it.
- **Hide** `Draft Subject`, `Draft Body`, `Source URL` in your main table (they're still there when you open a row).
- **Reorder** columns by dragging if they didn't land in the order above.
- Add a **Board** view grouped by `Status` for a CRM feel, and a filtered **🎯 To Draft** view (`Draft Email` unchecked & `Status` = Not Contacted).

```
NOT CONTACTED       EMAILED            REPLIED            NO RESPONSE
- A. Rivera         - K. Sato          - M. Osei          - L. Berg
  Vision, MIT         NLP, CMU           Systems, UW        HCI, GT
```

---

## 🔁 The daily loop

1. **Weekly** (automatic): the cron scrapes your URLs, de-dupes, and adds new contacts. Unchanged pages are skipped via content hashing, so it barely touches the LLM.
2. Open your **🎯 To Draft** view, skim, and tick **Draft Email** on people you like (or **Remove** on ones you don't).
3. Open each **Gmail Draft** link, read, fix anything, send. Set **Status -> Emailed**.

---

## ⚙️ Configuration reference

**Vars** (`wrangler.toml` -> `[vars]` / per env):

| Var | Default | Purpose |
|---|---|---|
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model (supports strict structured outputs) |
| `NOTION_VERSION` | `2022-06-28` | Notion API version |
| `ENABLE_PROFILE_SECOND_PASS` | `false` | Research mode: also hunt emails on linked profile pages |
| `MAX_PAGES_PER_RUN` | `200` | Cap pages per scrape |
| `LLM_THROTTLE_MS` | `2200` | Delay between LLM calls (Groq 30 req/min) |
| `MAX_SUBREQUESTS` | `45` | Stay under the free-plan 50-subrequest/invocation cap |
| `MAX_LLM_CALLS_PER_RUN` | `6` | Chunks extracted per run (resumable across runs) |
| `ENABLE_INSIGHT` | `true` | Research the contact's page before drafting for a specific detail |
| `FOLLOWUP_DAYS` | `4` | Days before the first follow-up (later ones spaced further out) |
| `MAX_FOLLOWUPS` | `2` | Max follow-ups drafted per contact |
| `ENABLE_CLICK_TRACKING` | `false` | Opt-in: rewrite draft links through a redirect to count clicks |
| `ENABLE_OPEN_TRACKING` | `false` | Opt-in: embed an open pixel (unreliable; see note) |

**Optional secret:** `JINA_API_KEY` enables JavaScript-rendered pages. Most faculty/lab sites are static HTML and need nothing. JS-heavy directories (some VC portfolios) return an empty shell to a plain fetch; with a Jina Reader key set, ColdMailOS escalates only those pages to [r.jina.ai](https://jina.ai/reader/), which renders JS server-side. Without the key it still works, it just skips JS-only content.

**Config files** (gitignored, pushed to KV): `source-urls.json` -> `config:source-urls`; `private-config.json` (+ `resume.md`) -> `config:profile`.

**Endpoints:**

| Method + path | Purpose |
|---|---|
| `POST /setup?secret=` | Ensure all Notion columns exist + arrange the view (run once after creating the DB) |
| `POST /scrape?secret=` | Manually trigger a scrape (resumable) |
| `POST /followups?secret=` | Draft due follow-ups for rows in the Emailed state |
| `POST /webhook/notion?secret=` | Notion automation target (draft / remove) |
| `GET /unsubscribe?e=&t=` | One-click opt-out (HMAC-signed; adds to the suppression list) |
| `GET /c/<id>`, `GET /o/<id>` | Click redirect / open pixel (only used when tracking is on) |
| `GET /health`, `GET /` | Health check / info |

### Verification, deliverability & engagement

- **Email confidence.** Every found address is graded `Safe` / `Risky` / `Unknown` (syntax + role/disposable heuristics + MX via DNS-over-HTTPS) into an **Email Confidence** column. The Gmail draft pre-fills the recipient unless it's `Risky`. It never guesses an address.
- **Suppression + unsubscribe.** Drafts to a real recipient carry a `List-Unsubscribe` one-click header pointing at `/unsubscribe`; opting out adds the address to a KV suppression list that's never drafted to again.
- **Follow-ups.** `POST /followups` drafts a short, polite nudge for anyone still in the `Emailed` state after the cadence (up to `MAX_FOLLOWUPS`), driven entirely by Notion Status + dates so it needs no Gmail read access. Still draft-only.
- **Tracking (opt-in, off by default).** `ENABLE_CLICK_TRACKING` rewrites links through a redirect (reliable). `ENABLE_OPEN_TRACKING` embeds a 1x1 pixel; opens are **unreliable** (Apple/Gmail proxy and prefetch inflate them) and "time spent" isn't measurable in email at all, so clicks are the trustworthy signal. Both update `Opened` / `Clicked` / `Last Activity` columns.

### Optional: Cloudflare Queues

Free-tier Queues can replace inline scraping with one job per URL (each in its own fresh-budget invocation, so large lists never time out). It's off by default: create the queue (`wrangler queues create coldmailos-research-scrape`) and uncomment the `[[queues.*]]` blocks in `wrangler.toml`. Without it, scraping runs inline and resumes across runs.

---

## 💰 Cost & limits

Lives entirely in free tiers: Cloudflare Workers (100k req/day), KV (100k reads/day), Groq (~30 req/min, ~1k req/day on Llama 3.3 70B), Notion, Gmail.

**Free-plan subrequest cap:** Cloudflare allows 50 subrequests per invocation, and each Notion row write is one. ColdMailOS writes incrementally and only marks a page "done" once fully synced, so a big directory just takes a few `/scrape` runs to fully populate (each resumes where the last stopped). Content-hash caching means week-two onward is nearly free.

---

## 🔐 Privacy, ethics & safety

- **Your data stays yours.** Background, target lists, and drafts live in *your* Cloudflare + Notion. No shared backend.
- **It won't invent emails** (either mode). No public address -> blank field. No pattern-guessing.
- **It can't send email.** `gmail.compose` = drafts only. Sending is a human action, every time.
- **Read only what you're allowed to.** Public directories/portfolios only. `robots.txt` is checked and enforced before every fetch. Be thoughtful with people's inboxes.

---

## 🧩 Customizing & extending

- **Email voice:** edit the mode prompts in [`src/drafting/groq.ts`](src/drafting/groq.ts) (there's a banned-clichés list).
- **What gets extracted:** edit the prompts in [`src/extract/extractWithLLM.ts`](src/extract/extractWithLLM.ts).
- **A new mode:** `mode` is a free string - add a prompt branch in the two files above; everything else generalizes.
- **Notion columns:** add the property in Notion, then map it in [`src/notion/schema.ts`](src/notion/schema.ts) + [`src/notion/sync.ts`](src/notion/sync.ts).
- **Schedule:** edit `crons` in [`wrangler.toml`](wrangler.toml).

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| Notion **404** | Didn't share the DB with the integration, or wrong `NOTION_DATABASE_ID`. |
| Scrape reports `stoppedEarly: true` | Expected on big directories - run `/scrape` again to continue (free-tier subrequest budget). |
| Rows didn't appear but no errors | Check the scrape's JSON report / `npm run tail`. Confirm `config:push` ran for the right `--env`. |
| Webhook does nothing | Automation trigger must be the **checkbox** property; URL must include `?secret=`; worker deployed. Check `npm run tail`. |
| **401** from webhook | `secret` in the automation URL ≠ your `WEBHOOK_SECRET`. |
| `gmail:auth` "No refresh_token" | Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and re-run. |
| Draft recipient blank | No public email found (by design) - fill **To** in Gmail. |
| Duplicate rows | The next scrape archives exact duplicates (same email, or name+entity), keeping the most complete. You can also tick **Remove**. |

---

## 🗂️ Project structure

```
coldmailos/
  src/
    index.ts              # Worker entry: routes cron + webhook
    cron.ts               # budgeted, resumable scrape + dedupe archival
    config.ts             # loads per-user config + mode from KV
    groqClient.ts         # shared Groq client (structured outputs + retry)
    llmSchema.ts          # zod + JSON schemas for extraction/drafting/insight
    security.ts           # constant-time secret compare
    suppress.ts           # suppression list + HMAC unsubscribe tokens
    insight.ts            # research-before-draft (one specific detail)
    followups.ts          # cadence-driven follow-up drafts
    tracking.ts           # opt-in click redirect / open pixel
    queue.ts              # optional Queues driver (per-URL fan-out)
    types.ts              # shared types
    verify/email.ts       # email grading (MX via DoH + role/disposable)
    extract/
      fetchPage.ts        # fetch + readability strip; optional Jina JS-render
      robots.ts           # robots.txt fetch/cache/enforce + shared User-Agent
      extractWithLLM.ts   # mode-based extraction (structured outputs)
      cache.ts            # content-hash skip + resumable extraction state (KV)
    notion/
      client.ts           # Notion REST wrapper (retry, query/create/update/archive)
      schema.ts           # database property names
      sync.ts             # dedupe + duplicate detection
      setup.ts            # ensure columns + arrange the view (Views API)
    drafting/groq.ts      # mode-based outreach + follow-up drafting
    gmail/drafts.ts       # OAuth refresh + drafts.create (draft-only, HTML/List-Unsubscribe)
    webhook/handler.ts    # verify secret -> draft, or remove/archive
  scripts/
    get-gmail-token.mjs   # one-time Gmail OAuth
    push-config.mjs       # push config -> KV (--env aware)
  config.schema.json
  source-urls.example.research.json
  source-urls.example.startup.json
  private-config.example.json
  wrangler.toml           # research + startups environments
  README.md
```

---

## 🧪 Tests & CI/CD

Pure logic (extraction parsing, HTML->text, dedupe, prompt selection, MIME/base64, config) is covered by a [vitest](https://vitest.dev) unit suite:

```bash
npm test           # run once
npm run test:watch # watch mode
npm run typecheck  # tsc --noEmit
```

Two GitHub Actions pipelines ([.github/workflows](.github/workflows)):

- **CI** (`ci.yml`) - on every push/PR, across Node 20 & 22: typecheck -> unit tests -> a `wrangler --dry-run` build check.
- **CD** (`deploy.yml`) - on push to `main`: runs the tests, then deploys **both** environments. It's a no-op until you add a `CLOUDFLARE_API_TOKEN` repo secret (Settings -> Secrets and variables -> Actions), created from Cloudflare's "Edit Cloudflare Workers" API-token template. Runtime secrets (Groq/Notion/Gmail) already live in Cloudflare, so CD only ships code.

## 🤝 Contributing

Issues and PRs welcome. Keep the non-negotiables intact - **never fabricate emails, never send mail** - and keep the repo free of hardcoded targets. Good first PRs: more robust readability extraction, additional modes, tone presets, a one-click Notion template.

## ☕ Support

ColdMailOS is free and open source. If it helped you land a conversation - an advisor, an internship, a first reply - you can say thanks:

<a href="https://buymeacoffee.com/winnerkarthik"><img src="https://img.shields.io/badge/%E2%98%95%20Buy%20me%20a%20coffee-winnerkarthik-FFDD00?style=for-the-badge" alt="Buy me a coffee"></a>

No pressure, always appreciated. ⭐ Starring the repo helps too.

## 📄 License

[MIT](LICENSE). Do good things with it.

<div align="center">
<br>
<sub>Built for anyone who's ever stared at a blank email to a professor or a founder and thought "there has to be a better way."</sub>
</div>
