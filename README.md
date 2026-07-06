<div align="center">

# 📬 ResearchMailOS

### Turn any list of lab pages into a Notion board of researchers — then turn a checkbox into a personalized Gmail draft.

Point it at any school, any department, any field. It reads the pages, pulls out the people and what they work on, and drops them into a Notion database. When you tick a box next to someone, it writes a genuinely personal outreach email that references *their* research and *your* background — and leaves it sitting as a Gmail draft for you to review and send.

**No servers. No monthly bill. No email ever sent without you hitting the button.**

<br>

![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)
![Cloudflare Workers](https://img.shields.io/badge/Runs%20on-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)
![Groq](https://img.shields.io/badge/LLM-Groq-000000)
![Notion](https://img.shields.io/badge/UI-Notion-000000?logo=notion&logoColor=white)
![Cost](https://img.shields.io/badge/Cost-%240%2Fmo-brightgreen)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-blueviolet.svg)

</div>

---

## The 30-second pitch

You're cold-emailing researchers — for a PhD spot, an internship, a UROP, a collaboration. The tedious parts are (1) finding who works on what, and (2) writing each email so it doesn't read like a mail-merge. ResearchMailOS does the finding automatically and drafts the emails for you, so all that's left is the part only you can do: reading it, tweaking a line, and hitting send.

```
┌─────────────┐   weekly cron    ┌──────────────┐   you tick ☑   ┌───────────────┐
│ Your list   │ ───────────────▶ │    Notion     │ ─────────────▶ │  Gmail draft   │
│ of URLs     │  fetch + extract │   dashboard   │  webhook fires │  (never sent)  │
│ (any pages) │   with an LLM    │ people + focus│  drafts email  │  ready to send │
└─────────────┘                  └──────────────┘                └───────────────┘
```

1. **Extract** — a Cloudflare Worker fetches each page you list, strips it to text, and asks an LLM to pull out every researcher's *name, role, email (only if it's actually on the page), research focus, and profile link*.
2. **Sync** — new people are de-duplicated and pushed into a Notion database you can browse, filter, and triage like a CRM.
3. **Draft** — tick the **Draft Email** checkbox on anyone, and a webhook writes a short, specific outreach email using your background + their research, then creates a Gmail draft with their address pre-filled.
4. **Send** — you review the draft in Gmail and send it yourself. Always. The tool literally cannot send mail (see [Design principles](#-design-principles-the-non-negotiables)).

---

## Why you might like it

- 🎓 **Works for any school, any field.** There is *zero* hardcoded university, department, or lab anywhere in this repo. You bring a list of URLs; it figures out the rest. PL theory at CMU, wet-lab bio at a small liberal-arts college, an indie research group's `/people` page — all the same to it.
- 🧠 **LLM extraction, not brittle scrapers.** Every faculty page has a different HTML layout. Instead of one parser per site, it reads the page like a person would. Add a new URL and it just works.
- 💸 **Genuinely free to run.** Cloudflare Workers (compute + cron + storage) and Groq (LLM) both have free tiers this comfortably fits inside. Notion and Gmail are free. Your bill is $0.
- ✍️ **Emails that don't sound like a template.** The draft references the *specific* thing the person researches and *your* actual background — with a banned-clichés list so you never send "I came across your profile and was impressed."
- 🔒 **Honest by construction.** It never invents an email address, and it can never send mail on your behalf. More on that below.
- 🧩 **Open source, self-hosted, yours.** Fork it, read every line, run it on your own infra with your own keys. Your background, your target list, and your drafts never touch anyone else's servers.

---

## 🧭 Design principles (the non-negotiables)

These are baked into the code, not just the docs:

| Principle | How it's enforced |
|---|---|
| **Never fabricate an email.** | The extraction prompt forbids guessing, and a regex guard drops anything that isn't a real address found on the page. No email on the page → the field stays blank and you fill it in. |
| **Never send mail automatically.** | The Gmail OAuth scope is `gmail.compose` — **draft-only**. There is no code path, and no *permission*, to send. You always press send. |
| **No hardcoded institutions.** | The public repo ships only generic examples. Your real target list and background live in gitignored files, pushed to your private Cloudflare KV. |
| **Respect the open web.** | It reads public directory pages with an honest User-Agent. Only point it at pages you're allowed to read; mind each site's `robots.txt` and terms. |

---

## ✅ What you'll need

Five free accounts and about 30–40 minutes for first-time setup. Grab these tabs:

- [ ] **[Cloudflare](https://dash.cloudflare.com/sign-up)** — hosts the Worker, cron, and KV storage.
- [ ] **[Groq](https://console.groq.com)** — free, fast LLM inference. One API key.
- [ ] **[Notion](https://notion.so)** — your dashboard + the checkbox that triggers drafting.
- [ ] **[Google Cloud](https://console.cloud.google.com)** — for a Gmail API OAuth client (draft-only).
- [ ] **Node.js 18+** and **npm** installed locally.

> **New to all this?** That's fine. Every step below is copy-pasteable, and the order matters less than you'd think — the only hard dependency is that you deploy the Worker *before* you point Notion's webhook at it.

---

## ⚡ Quickstart (for the impatient)

Already fluent in Cloudflare + Notion + Google Cloud? Here's the whole thing:

```bash
git clone https://github.com/YOU/researchmailos.git && cd researchmailos
npm install
npx wrangler login
npx wrangler kv namespace create KV        # paste the id into wrangler.toml

cp source-urls.example.json source-urls.json      # add your pages
cp private-config.example.json private-config.json # add your background
cp .env.example .env                               # add Google client id/secret

# set the 7 secrets (see the table below)
npx wrangler secret put GROQ_API_KEY
# … NOTION_TOKEN, NOTION_DATABASE_ID, WEBHOOK_SECRET,
#    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN

npm run gmail:auth        # one-time OAuth → prints GMAIL_REFRESH_TOKEN
npm run config:push       # source-urls.json + private-config.json → KV
npm run deploy            # ship the Worker
```

Then build the [Notion dashboard](#-the-notion-dashboard-design-that-doesnt-fight-you), add the automation webhook pointing at `https://<your-worker>.workers.dev/webhook/notion?secret=<WEBHOOK_SECRET>`, and you're live.

Everyone else — the full walkthrough is below. 👇

---

## 🛠️ Full setup

### Step 1 — Clone and install

```bash
git clone https://github.com/YOU/researchmailos.git
cd researchmailos
npm install
```

### Step 2 — Cloudflare (Worker + KV)

1. Log in with Wrangler (Cloudflare's CLI, installed by `npm install`):
   ```bash
   npx wrangler login
   ```
2. Create the KV namespace that stores your config and page-content hashes:
   ```bash
   npx wrangler kv namespace create KV
   ```
   It prints something like `id = "abc123…"`. Open **`wrangler.toml`** and paste that id in:
   ```toml
   [[kv_namespaces]]
   binding = "KV"
   id = "abc123…"   # ← your id here
   ```

### Step 3 — Groq API key

1. Sign in at [console.groq.com](https://console.groq.com) → **API Keys** → **Create API Key**.
2. Copy it. You'll set it as a secret in Step 7.

> The default model is `llama-3.3-70b-versatile` (set in `wrangler.toml` → `[vars]`). Swap it for any Groq-hosted model you prefer.

### Step 4 — Notion (database, integration, webhook)

This is the heart of the UI. First **build the dashboard** — jump to [The Notion dashboard](#-the-notion-dashboard-design-that-doesnt-fight-you) for the exact columns, colors, and views, then come back here. Once your database exists:

1. **Create an integration.** Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration** → give it a name (e.g. "ResearchMailOS") → copy the **Internal Integration Secret** (starts with `ntn_`). This is your `NOTION_TOKEN`.
2. **Share the database with it.** Open your database → **•••** menu → **Connections** → add your integration. (Without this, the API returns 404s.)
3. **Get the database ID.** Open the database as a full page. The URL looks like:
   ```
   https://www.notion.so/yourworkspace/8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d?v=…
                                        └──────────── this is the ID ────────────┘
   ```
   Copy the 32-character hex string (the part before `?v=`). This is your `NOTION_DATABASE_ID`.
4. **The automation webhook comes last** — you need your deployed Worker URL first (Step 10).

### Step 5 — Gmail (draft-only OAuth)

1. In [Google Cloud Console](https://console.cloud.google.com): create a project (or pick one) → **APIs & Services** → **Enable APIs** → enable the **Gmail API**.
2. **APIs & Services → OAuth consent screen**: choose **External**, fill in the basics, and add your own Google account as a **Test user** (so you don't need Google verification).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URI**: `http://localhost:5173/oauth2callback`
   - Create, then copy the **Client ID** and **Client secret**.
4. Put those two in your local `.env`:
   ```bash
   cp .env.example .env
   # edit .env → GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
   ```
5. Run the one-time flow — it opens your browser, you approve, and it prints a refresh token:
   ```bash
   npm run gmail:auth
   ```
   > The consent screen will say the app wants to *"Manage drafts and send emails"* — that's the closest bundled description Google shows, but the scope requested is `gmail.compose`, which **cannot send**. You can verify this in `scripts/get-gmail-token.mjs`.

   Copy the printed refresh token — that's your `GMAIL_REFRESH_TOKEN`.

### Step 6 — Fill in your two config files

These are **gitignored** — they never get committed. They're your private target list and background.

```bash
cp source-urls.example.json source-urls.json
cp private-config.example.json private-config.json
```

**`source-urls.json`** — a flat list of pages to read. Department pages, lab `/people` pages, faculty directories — mix freely:
```json
[
  "https://www.cs.someuniversity.edu/people/faculty",
  "https://somelab.someuniversity.edu/team",
  "https://www.someuniversity.edu/department/research-areas"
]
```

**`private-config.json`** — who you are and how you want to sound (see [`config.schema.json`](config.schema.json) for the full field reference):
```json
{
  "name": "Your Name",
  "background": "Second-year CS undergrad at X. Built a compiler over the summer; TA'd systems.",
  "researchInterests": "Programming languages and verification — making dependent types usable.",
  "resumeText": "Optional CV highlights the model can cite concretely.",
  "tone": "Warm but concise. Specific, low-pressure. No buzzwords, no flattery.",
  "signature": "Your Name\nB.S. CS, X University\nyou@x.edu",
  "senderEmail": "you@x.edu"
}
```

### Step 7 — Set your secrets

Secrets never live in files that get committed. Set all seven:

```bash
npx wrangler secret put GROQ_API_KEY          # from Step 3
npx wrangler secret put NOTION_TOKEN          # from Step 4.1
npx wrangler secret put NOTION_DATABASE_ID    # from Step 4.3
npx wrangler secret put WEBHOOK_SECRET        # any long random string you invent
npx wrangler secret put GOOGLE_CLIENT_ID      # from Step 5.3
npx wrangler secret put GOOGLE_CLIENT_SECRET  # from Step 5.3
npx wrangler secret put GMAIL_REFRESH_TOKEN   # from Step 5.5
```

> **`WEBHOOK_SECRET`** is a password you make up. It's the only thing guarding your webhook endpoint, so make it long and random (e.g. `openssl rand -hex 24`). You'll append it to the webhook URL in Step 10.

For local development (`npm run dev`) instead of production, put the same values in a `.dev.vars` file (`cp .dev.vars.example .dev.vars`).

### Step 8 — Push your config to KV

Your URLs and background go into KV so the deployed Worker can read them:

```bash
npm run config:push
```

Re-run this any time you edit `source-urls.json` or `private-config.json`.

### Step 9 — Deploy

```bash
npm run deploy
```

Wrangler prints your Worker's URL, e.g. `https://researchmailos.yourname.workers.dev`. Test it:

```bash
curl https://researchmailos.yourname.workers.dev/health   # → ok
```

Kick off the first scrape manually (don't wait for the weekly cron):

```bash
curl -X POST "https://researchmailos.yourname.workers.dev/scrape?secret=YOUR_WEBHOOK_SECRET"
```

Watch it work in real time with `npm run tail`. Within a minute or two, rows should start appearing in Notion. 🎉

### Step 10 — Wire up the Notion checkbox → webhook

Now connect the trigger:

1. In your Notion database, click **•••** (top-right) → **Automations** → **New automation**.
2. **Trigger:** *"Draft Email" is checked* (the checkbox property, set to ✓).
3. **Action:** **Send webhook**.
4. **URL:**
   ```
   https://researchmailos.yourname.workers.dev/webhook/notion?secret=YOUR_WEBHOOK_SECRET
   ```
5. Save.

That's it. Tick **Draft Email** on any row and, within a few seconds, the **Draft Subject / Draft Body** fill in and a **Gmail Draft** link appears. Click it, review, send.

> **Why the secret in the URL?** Cloudflare Access login walls don't work for server-to-server webhooks, so the endpoint verifies the `WEBHOOK_SECRET` you set. Keep the URL private.

---

## 🎨 The Notion dashboard — design that doesn't fight you

The whole point is that triage should feel good. Here's a layout that turns a wall of names into a clean pipeline. Create a new **Database — Table** and set it up like this.

### Properties (columns)

Create these **exactly** (names are matched by the code — see [`src/notion/schema.ts`](src/notion/schema.ts)):

| Property | Type | What it holds |
|---|---|---|
| **Name** | Title | The researcher's name |
| **Institution** | Text | Lab / department / school |
| **Research Focus** | Text | 1–2 sentences, straight from their page |
| **Email** | Email | Only if it was public — otherwise blank, you fill it |
| **Profile URL** | URL | Their personal/profile page |
| **Source** | URL | The page we found them on |
| **Status** | Select | Pipeline stage (options below) |
| **Draft Email** | Checkbox | **Tick this to generate a draft** ← the trigger |
| **Draft Subject** | Text | Written back by the tool |
| **Draft Body** | Text | Written back by the tool |
| **Gmail Draft** | URL | Deep-link into the Gmail draft |

### Status options + colors

Give **Status** these four options. Consistent colors make the board readable at a glance:

| Option | Color | Meaning |
|---|---|---|
| `Not Contacted` | ⚪️ Gray | Fresh from the scrape |
| `Emailed` | 🔵 Blue | You sent the draft |
| `Replied` | 🟢 Green | They wrote back |
| `No Response` | 🟡 Yellow | Follow up or let go |

### Recommended views

Add these views to the same database (top-left view switcher → **+**). Each is just a filter/group on the same rows:

**1. 🎯 To Draft** — *Table*, your daily workspace. Filter: `Draft Email` is unchecked **and** `Status` is `Not Contacted`. Sort by `Institution`. This is the list you skim, deciding who's worth reaching out to. Tick the box on the winners.

**2. 📮 Ready to Send** — *Table*. Filter: `Gmail Draft` is not empty **and** `Status` is `Not Contacted`. These have drafts waiting in Gmail. Open each link, read, send, then set Status → `Emailed`.

**3. 🗂️ Pipeline** — *Board*, grouped by `Status`. Your CRM view — drag cards between columns as things progress:

```
┌ Not Contacted ─┐  ┌ Emailed ───────┐  ┌ Replied ───────┐  ┌ No Response ───┐
│ ▢ Dr. A. Rivera │  │ ▣ Prof. K. Sato │  │ ▣ Dr. M. Osei   │  │ ▣ Prof. L. Berg │
│   Vision · MIT  │  │   NLP · CMU     │  │   Systems · UW  │  │   HCI · GT      │
│                 │  │                 │  │  ↳ reply! 🎉    │  │  ↳ follow up?   │
│ ▢ Dr. J. Park   │  │ ▣ Dr. S. Iyer   │  │                 │  │                 │
│   RL · Stanford │  │   Theory · UCB  │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

**4. 🖼️ Gallery** *(optional, nice for browsing)* — *Gallery* view with `Research Focus` shown on the card. Turns cold-emailing into something closer to reading a feed of interesting people.

### A few Notion polish tips

- **Hide the write-back columns** (`Draft Subject`, `Draft Body`, `Source`) in your main views to reduce clutter — open a row to see them. Keep them visible only where you're reviewing drafts.
- **Wrap text** on `Research Focus` (column header → **Wrap column**) so you can actually read it in Table view.
- **Icon + cover**: give the database a 📬 icon and a cover so it feels like a product, not a spreadsheet.
- **Template button**: if you add people manually sometimes, a Notion template row with `Status = Not Contacted` pre-set saves clicks.

---

## 🔁 The daily loop

Once it's running, your rhythm is:

1. **Weekly** (automatic): the cron scrapes your URLs and adds any new people. Unchanged pages are skipped via content hashing, so it barely uses the LLM.
2. **Whenever you're outreaching**: open **🎯 To Draft**, skim research focuses, and tick **Draft Email** on the people you like.
3. Seconds later, open **📮 Ready to Send**, click each **Gmail Draft** link, read the email, fix anything, and hit send.
4. Set **Status → Emailed**. Drag cards across the **🗂️ Pipeline** board as replies come in.

That's the whole product. The boring 80% is automated; the 20% that's actually you stays with you.

---

## ⚙️ Configuration reference

### Worker vars (`wrangler.toml` → `[vars]`)

| Var | Default | What it does |
|---|---|---|
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model for extraction + drafting |
| `NOTION_VERSION` | `2022-06-28` | Notion API version header |
| `ENABLE_PROFILE_SECOND_PASS` | `false` | Also fetch each person's linked profile page for a deeper extraction (catches emails/research that only live on personal pages). Uses more LLM calls. |
| `MAX_PAGES_PER_RUN` | `200` | Hard cap on pages per scrape (budget safety) |
| `LLM_THROTTLE_MS` | `2200` | Delay between LLM calls (stays under Groq's 30 req/min) |

### Config files (gitignored, pushed to KV)

| File | KV key | Shape |
|---|---|---|
| `source-urls.json` | `config:source-urls` | Array of URLs |
| `private-config.json` | `config:profile` | Your background — see [`config.schema.json`](config.schema.json) |

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhook/notion?secret=…` | Notion automation target (draft an email) |
| `POST` | `/scrape?secret=…` | Manually trigger a scrape |
| `GET` | `/health` | Health check |
| `GET` | `/` | Info page |

---

## 💰 Cost & rate limits

Designed to live entirely in free tiers:

- **Cloudflare Workers**: 100k requests/day free. A weekly cron + occasional webhooks is a rounding error.
- **Cloudflare KV**: 100k reads + 1k writes/day free. Way more than enough.
- **Groq**: free tier is ~30 requests/min and ~1k requests/day on Llama 3.3 70B. A weekly scrape of a few hundred pages fits easily — and **content-hash caching means unchanged pages don't call the LLM at all**, so week two onward is nearly free.
- **Notion & Gmail**: free.

The `LLM_THROTTLE_MS` and `MAX_PAGES_PER_RUN` knobs exist so a single run can never blow the daily budget.

---

## 🔐 Privacy, ethics & safety

- **Your data stays yours.** Your background, target list, and drafts live in *your* Cloudflare account and *your* Notion. This project has no shared backend.
- **It won't invent emails.** If a page doesn't publicly show an address, the field is blank. No pattern-guessing, no spray-and-pray.
- **It can't send email.** `gmail.compose` scope = drafts only. Sending is a human action, every time.
- **Read only what you're allowed to.** This is for public faculty/lab directories. Respect `robots.txt`, site terms, and don't point it at anything gated. Be a good citizen of the web and of people's inboxes — thoughtful, specific outreach only.

---

## 🧩 Customizing & extending

- **Change the voice of the emails**: edit the `SYSTEM_PROMPT` in [`src/drafting/groq.ts`](src/drafting/groq.ts) (there's a banned-clichés list you can tune).
- **Change what gets extracted**: edit the prompt in [`src/extract/extractWithLLM.ts`](src/extract/extractWithLLM.ts).
- **Add Notion columns**: add the property in Notion, then map it in [`src/notion/schema.ts`](src/notion/schema.ts) and [`src/notion/sync.ts`](src/notion/sync.ts).
- **Change the schedule**: edit the `crons` line in [`wrangler.toml`](wrangler.toml) (it's standard cron syntax).
- **Deeper extraction**: flip `ENABLE_PROFILE_SECOND_PASS` to `true` if you find listing pages often lack emails.

---

## 🩺 Troubleshooting

| Symptom | Likely fix |
|---|---|
| Notion API returns **404** | You didn't share the database with your integration (Step 4.2), or the `NOTION_DATABASE_ID` is wrong. |
| No rows appear after a scrape | Check `npm run tail` logs. Common causes: `config:source-urls` not pushed (`npm run config:push`), or a page that returned non-HTML. |
| Webhook does nothing when I tick the box | Confirm the automation trigger is the **checkbox** property (not a to-do block), the URL includes `?secret=…`, and the Worker is deployed. Check `npm run tail`. |
| **401** from the webhook | The `secret` in the automation URL doesn't match your `WEBHOOK_SECRET`. |
| `gmail:auth` says "No refresh_token" | Revoke prior access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and re-run — Google only returns a refresh token on first consent. |
| Gmail draft link opens the Drafts list, not the draft | Harmless — your newest draft is at the top. Some Gmail clients don't honor the deep-link id. |
| Draft created but recipient is blank | No public email was found on the page (by design). Fill in the **To** field in Gmail before sending. |
| Rows are duplicated | Names differ across pages (e.g. "J. Smith" vs "Jane Smith") with no email to match on. Add emails or merge in Notion. |

---

## 🗂️ Project structure

```
researchmailos/
├── src/
│   ├── index.ts              # Worker entry: routes cron + webhook
│   ├── cron.ts               # the weekly scrape pipeline
│   ├── config.ts             # loads per-user config from KV
│   ├── types.ts              # shared types
│   ├── extract/
│   │   ├── fetchPage.ts      # fetch + readability-style text extraction
│   │   ├── extractWithLLM.ts # Groq structured extraction (no-fabrication prompt)
│   │   └── cache.ts          # content-hash skip logic (KV)
│   ├── notion/
│   │   ├── client.ts         # thin Notion REST wrapper + property helpers
│   │   ├── schema.ts         # database property names (edit if you rename columns)
│   │   └── sync.ts           # dedupe + upsert people
│   ├── drafting/
│   │   └── groq.ts           # personalized outreach email generation
│   ├── gmail/
│   │   └── drafts.ts         # OAuth refresh + drafts.create (draft-only)
│   └── webhook/
│       └── handler.ts        # verify secret → read row → draft → Gmail draft
├── scripts/
│   ├── get-gmail-token.mjs   # one-time Gmail OAuth (zero deps)
│   └── push-config.mjs       # push config files → KV
├── config.schema.json        # shape of the two private config files
├── source-urls.example.json  # generic example URL list
├── private-config.example.json
├── wrangler.toml             # Worker config (bindings, cron, vars)
└── README.md
```

---

## 🤝 Contributing

Issues and PRs welcome. Good first contributions: better readability extraction, more resilient Notion payload parsing, additional draft-tone presets, or a one-click Notion database template. Keep the two non-negotiables intact — **never fabricate emails, never send mail** — and keep the repo free of any hardcoded institutions.

## 📄 License

[MIT](LICENSE). Do good things with it.

<div align="center">
<br>
<sub>Built for anyone who's ever stared at a blank email to a professor and thought "there has to be a better way."</sub>
</div>
