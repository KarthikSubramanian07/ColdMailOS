/**
 * The Notion database property names ColdMailOS reads and writes.
 *
 * These strings must EXACTLY match your database's column names. If you rename a
 * column in Notion, change it here too (and redeploy). The README's "Notion
 * dashboard" section walks through creating a database with these exact columns.
 *
 * Names are generalized so one schema serves both modes:
 *   research  →  Contact = professor, Entity = lab/department
 *   startup   →  Contact = founder,   Entity = company
 */
export const PROPS = {
  contactName: "Contact Name", // title
  role: "Role", // rich text
  entity: "Entity", // rich text
  contextSummary: "Context Summary", // rich text
  backing: "Backing/Affiliation", // rich text
  email: "Email", // email
  profileUrl: "Profile URL", // url
  sourceUrl: "Source URL", // url
  status: "Status", // select
  trigger: "Draft Email", // checkbox — flipping ON drafts an email (the webhook)
  remove: "Remove", // checkbox — flipping ON archives (removes) the row
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
