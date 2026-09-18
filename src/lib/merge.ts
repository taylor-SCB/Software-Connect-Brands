// Merge fields available in contract templates. Values are substituted
// once, when a contract is created, so the signed document is a frozen
// snapshot rather than something that changes if a contact is edited.
//
// Each field belongs to the screen its value comes from, named exactly as
// the sidebar names it, so the palette on the template form can filter to
// "only the fields that come from Contacts". Keys are what a template
// stores ({{client_name}}); labels are what a person sees.

export const MERGE_GROUPS = [
  "Contacts",
  "Companies",
  "Pipeline",
  "Products",
  "Quotes",
  "Contracts",
  "Projects",
  "Settings",
] as const;

export type MergeGroup = (typeof MERGE_GROUPS)[number];

export type MergeField = {
  key: string;
  label: string;
  group: MergeGroup;
  description: string;
};

export const MERGE_FIELDS: readonly MergeField[] = [
  // Contacts — the person the contract is addressed to.
  { key: "client_name", label: "Contact Name", group: "Contacts", description: "The contact's full name" },
  { key: "client_title", label: "Contact Title", group: "Contacts", description: "Their job title, e.g. Owner" },
  { key: "client_email", label: "Contact Email", group: "Contacts", description: "The contact's email" },
  { key: "client_phone", label: "Contact Phone", group: "Contacts", description: "The contact's phone" },
  { key: "client_city", label: "Contact City", group: "Contacts", description: "The contact's city" },
  { key: "client_state", label: "Contact State", group: "Contacts", description: "The contact's state" },

  // Companies — the business the contact works for. A residential
  // customer has none, so Company Name falls back to the contact's name.
  { key: "client_company", label: "Company Name", group: "Companies", description: "The customer's company (their name if they have no company)" },
  { key: "company_phone", label: "Company Phone", group: "Companies", description: "The company's phone" },
  { key: "company_email", label: "Company Email", group: "Companies", description: "The company's email" },
  { key: "company_website", label: "Company Website", group: "Companies", description: "The company's website" },
  { key: "company_city", label: "Company City", group: "Companies", description: "The company's city" },
  { key: "company_state", label: "Company State", group: "Companies", description: "The company's state" },

  // Pipeline — the deal this contract belongs to.
  { key: "deal_name", label: "Deal Name", group: "Pipeline", description: "The name of the deal" },
  { key: "deal_stage", label: "Deal Stage", group: "Pipeline", description: "Where the deal sits in the pipeline" },
  { key: "deal_value", label: "Deal Value", group: "Pipeline", description: "What the deal is worth, from its quotes" },

  // Products — what is on the quote.
  { key: "product_names", label: "Product Names", group: "Products", description: "Every product on the quote, comma separated" },
  { key: "product_list", label: "Product List", group: "Products", description: "One line per product: quantity, name and price" },

  // Quotes — the quote the numbers come from.
  { key: "quote_number", label: "Quote ID", group: "Quotes", description: "The quote's number, e.g. QUO-1004" },
  { key: "quote_title", label: "Quote Title", group: "Quotes", description: "The quote's title" },
  { key: "quote_total", label: "Quote Total", group: "Quotes", description: "The quote's grand total" },
  { key: "quote_valid_until", label: "Quote Valid Until", group: "Quotes", description: "The quote's expiry date" },
  { key: "quote_terms", label: "Quote Terms", group: "Quotes", description: "The terms written on the quote" },
  { key: "quote_labor_total", label: "Labor Total", group: "Quotes", description: "Total of the quote's Labor lines" },
  { key: "quote_materials_total", label: "Materials Total", group: "Quotes", description: "Total of the quote's Materials lines" },
  { key: "quote_software_total", label: "Software Total", group: "Quotes", description: "Total of the quote's Software lines" },
  { key: "quote_project_services_total", label: "Project Services Total", group: "Quotes", description: "Total of the quote's Project Services lines" },
  { key: "quote_shipping_total", label: "Shipping Total", group: "Quotes", description: "Total of the quote's Shipping lines" },
  { key: "quote_taxes_total", label: "Taxes Total", group: "Quotes", description: "Total of the quote's Taxes lines" },

  // Contracts — about the document itself and who is sending it.
  { key: "company_name", label: "Your Company Name", group: "Contracts", description: "Your business name, from Settings" },
  { key: "contract_number", label: "Contract Number", group: "Contracts", description: "The document number, e.g. CON-1004" },
  { key: "date", label: "Today's Date", group: "Contracts", description: "The date the contract is generated" },
  { key: "contract_total", label: "Contract Total", group: "Contracts", description: "Total of the line items on this contract (the quote total when no rows were split off)" },
  { key: "line_items", label: "Line Items", group: "Contracts", description: "One line per item on this contract: quantity, name and price" },
  { key: "payment_terms", label: "Payment Terms", group: "Contracts", description: "Net 30, Due on receipt... as set on the contract" },
  { key: "payment_schedule", label: "Payment Schedule", group: "Contracts", description: "One line per scheduled payment: label, amount and due date" },
  { key: "final_payment_date", label: "Final Payment Date", group: "Contracts", description: "The last due date on the payment schedule" },
  { key: "your_signer_name", label: "Your Company Signer", group: "Contracts", description: "Who signs for your company on this contract" },

  // Projects — the awarded job, on the paperwork raised against it.
  { key: "project_number", label: "Job Number", group: "Projects", description: "The job's number, e.g. PRJ-1000 (blank until the deal is won)" },
  { key: "project_name", label: "Job Name", group: "Projects", description: "What the job is called" },
  { key: "project_site_address", label: "Job Site Address", group: "Projects", description: "Where the work happens, when it is not the customer's own address" },

  // Settings — your own company, from Settings → Company Information.
  { key: "your_company_address", label: "Your Address", group: "Settings", description: "Your street address, city, state and ZIP on one line" },
  { key: "your_company_phone", label: "Your Phone", group: "Settings", description: "Your company phone, from Company Information" },
  { key: "your_company_email", label: "Your Email", group: "Settings", description: "Your company email, from Company Information" },
  { key: "your_company_website", label: "Your Website", group: "Settings", description: "Your company website, from Company Information" },
  { key: "your_company_description", label: "About Us", group: "Settings", description: "The company description from Company Information" },
  { key: "your_company_history", label: "Company History", group: "Settings", description: "The company history from Company Information" },
];

const FIELD_BY_KEY = new Map(MERGE_FIELDS.map((field) => [field.key, field]));

export function mergeFieldFor(key: string): MergeField | undefined {
  return FIELD_BY_KEY.get(key.toLowerCase());
}

export function mergeToken(key: string) {
  return `{{${key}}}`;
}

// What a template's fields resolve to for one customer. A null means the
// information is missing (no deal picked, contact has no email...) — the
// preview shows those as "Missing Information".
export type MergeContext = Record<string, string | null>;

const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gi;

// Only punctuation and spaces left on a line once its tokens went — a
// line like "{{your_company_phone}} · {{your_company_email}}" with
// neither filled in leaves " · " behind, which is worse than nothing.
const SEPARATORS_ONLY = /^[\s·,;:|/\\\-–—()[\]]*$/;

// A non-global twin of TOKEN_PATTERN: .test() on a /g regex carries
// lastIndex between calls and would skip every other line.
const HAS_TOKEN = /\{\{\s*[a-z_]+\s*\}\}/i;

// Removing a value from the middle of a list leaves the punctuation that
// was holding it: "Attn: Sam Rep · sam@acme.com · " when the phone is
// blank. Only ever applied to a line that carried a token, so prose the
// author wrote is never touched.
function tidySeparators(line: string) {
  return (
    line
      // A run of separators left by removed values collapses to one.
      // Bullets and pipes want a space each side; a comma or semicolon
      // wants one only after it.
      .replace(/\s*([·|])(?:\s*[·|])+\s*/g, " $1 ")
      .replace(/\s*([,;])(?:\s*[,;])+\s*/g, "$1 ")
      // A separator stranded straight after a label: "Attn: · 555".
      .replace(/([:—–-])\s*[·|,;]\s*/g, "$1 ")
      // One left hanging at either end of the line.
      .replace(/[\s·|,;]+$/, "")
      .replace(/^([ \t]*)[·|,;]+[ \t]*/, "$1")
      // Gaps the removals left behind, without eating indentation.
      .replace(/(\S)[ \t]{2,}/g, "$1 ")
  );
}

// Replaces {{token}} occurrences.
//
// A token with no value is REMOVED, and a line left holding nothing but
// separators goes with it. This used to leave the token visible so a
// missing detail would be obvious — good intention, wrong reader: the
// body is frozen when the contract is created, so what "obvious" meant in
// practice was a vendor opening an agreement addressed from
// "{{your_company_address}}". A workspace that has not filled in its
// address should send a document without that line, not one with the
// template's plumbing showing.
//
// The sender is still told: unresolvedMergeKeys names what was dropped,
// so the warning lands on the person who can fix it.
export function renderMergeFields(body: string, context: MergeContext) {
  const kept: string[] = [];

  // Line by line against the ORIGINAL, so "did this line have a token"
  // is known before anything is substituted — a value can itself contain
  // newlines (a product list does), which makes the rendered text a
  // different shape from the body it came from.
  for (const line of body.split("\n")) {
    const hadToken = HAS_TOKEN.test(line);
    const rendered = line.replace(TOKEN_PATTERN, (_match, key: string) => {
      return context[key.toLowerCase()] ?? "";
    });
    // A line that was only its tokens goes with them. A blank line the
    // author wrote is spacing and stays.
    if (hadToken && SEPARATORS_ONLY.test(rendered)) continue;
    kept.push(hadToken ? tidySeparators(rendered) : rendered);
  }

  // Three blank lines in a row is a hole where something used to be.
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

// The fields a body asks for that this customer has no value for. Named so
// the screen that is about to send the document can say which details are
// missing, rather than the customer finding out.
export function unresolvedMergeKeys(body: string, context: MergeContext): string[] {
  const missing = new Set<string>();
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const key = match[1].toLowerCase();
    if (!context[key]) missing.add(key);
  }
  return [...missing];
}

export type MergeSegment =
  | { kind: "text"; text: string }
  | { kind: "field"; key: string; field: MergeField | undefined; raw: string };

// Splits a body into plain text and merge tokens so the screen can draw
// each token as a chip. Anything that looks like a token but isn't a known
// field still comes back as a field segment (with `field` undefined) so
// the typo is visible.
export function splitMergeFields(body: string): MergeSegment[] {
  const segments: MergeSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: body.slice(last, start) });
    const key = match[1].toLowerCase();
    segments.push({ kind: "field", key, field: mergeFieldFor(key), raw: match[0] });
    last = start + match[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

// The keys a body actually uses, in order of first appearance.
export function mergeKeysIn(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(TOKEN_PATTERN)) seen.add(match[1].toLowerCase());
  return [...seen];
}
