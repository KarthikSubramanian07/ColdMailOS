/**
 * The Notion database property names ResearchMailOS reads and writes.
 *
 * These strings must EXACTLY match your database's column names. If you rename a
 * column in Notion, change it here too (and redeploy). The README's "Notion
 * dashboard" section walks through creating a database with these exact columns.
 */
export const PROPS = {
  name: "Name", // title
  institution: "Institution", // rich text
  researchFocus: "Research Focus", // rich text
  email: "Email", // email
  profileUrl: "Profile URL", // url
  sourceUrl: "Source", // url  — the page we found them on
  status: "Status", // select
  trigger: "Draft Email", // checkbox — flipping this ON fires the webhook
  draftSubject: "Draft Subject", // rich text
  draftBody: "Draft Body", // rich text
  gmailDraft: "Gmail Draft", // url
} as const;

/** Status select options (create these as options on the Status column). */
export const STATUS = {
  notContacted: "Not Contacted",
  emailed: "Emailed",
  replied: "Replied",
  noResponse: "No Response",
} as const;
