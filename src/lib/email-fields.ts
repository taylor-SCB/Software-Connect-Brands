// Merge fields for marketing email. Kept apart from the contract fields in
// merge.ts on purpose: a contract is written against a deal and a quote,
// an email to a contact list has neither, and offering {{quote_total}} in
// an email would only ever fill in blank.
//
// Safe to import from the browser — the composer draws these as chips.

export type EmailField = { key: string; label: string; description: string };

export const EMAIL_FIELDS: readonly EmailField[] = [
  { key: "first_name", label: "First Name", description: "The contact's first name" },
  { key: "contact_name", label: "Contact Name", description: "The contact's full name" },
  { key: "contact_company", label: "Contact's Company", description: "The company the contact works for" },
  { key: "sender_name", label: "Your Name", description: "The person sending" },
  { key: "sender_title", label: "Your Title", description: "Your job title from My Account" },
  { key: "sender_email", label: "Your Email", description: "Where replies go" },
  { key: "sender_phone", label: "Your Mobile", description: "Your mobile from My Account" },
  { key: "business_name", label: "Your Company", description: "Your business name" },
  { key: "business_phone", label: "Company Phone", description: "From Settings → General" },
  { key: "business_website", label: "Company Website", description: "From Settings → General" },
];

// Most emails a person may send in one day, counted in the workspace's
// own time zone. Set with Taylor for the pilot (Sept 27, 2026); the
// email provider's plan is the real ceiling behind it.
export const DAILY_EMAIL_LIMIT = 40;

export const MAX_ATTACHMENTS = 5;
// Well under the provider's 40 MB per message: every file goes to every
// recipient, and forty large emails from one request is slow.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function emailToken(key: string) {
  return `{{${key}}}`;
}

/**
 * Fill the {{fields}} in. A known field with nothing behind it becomes
 * blank rather than "{{sender_title}}" — a customer must never see a
 * token. An unknown one is left alone so a typo is visible in the draft.
 */
export function fillEmailFields(text: string, values: Record<string, string>) {
  const known = new Set(EMAIL_FIELDS.map((field) => field.key));
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    known.has(key) ? (values[key] ?? "") : match,
  );
}
