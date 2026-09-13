// CSV import for Contacts + Companies. Pure functions with no server
// dependencies: the browser reads the whole file, plans it, shows the
// preview, then sends the planned rows up in batches (see
// contacts/import-actions.ts). One file can hold any number of rows; the
// batches are what keep each request small.

import { parseCsvLines } from "@/lib/csv";
import { normalizeState } from "@/lib/states";
import { CONTACT_STATUSES, type ContactStatusValue } from "@/lib/constants";

export const IMPORT_BATCH_SIZE = 500;

export const CONTACT_CSV_COLUMNS = [
  "name",
  "firstName",
  "lastName",
  "title",
  "email",
  "phone",
  "website",
  "city",
  "state",
  "birthday",
  "status",
  "companyName",
  "companyPhone",
  "companyEmail",
  "companyWebsite",
  "companyCity",
  "companyState",
  "companyStatus",
  "industry",
  "companyType",
] as const;
export type ContactCsvColumn = (typeof CONTACT_CSV_COLUMNS)[number];

export const CONTACT_CSV_LABELS: Record<ContactCsvColumn, string> = {
  name: "Name",
  firstName: "First name",
  lastName: "Last name",
  title: "Title",
  email: "Email",
  phone: "Phone",
  website: "Website",
  city: "City",
  state: "State",
  birthday: "Birthday",
  status: "Status",
  companyName: "Company Name",
  companyPhone: "Company Phone",
  companyEmail: "Company Email",
  companyWebsite: "Company Website",
  companyCity: "Company City",
  companyState: "Company State",
  companyStatus: "Company Status",
  industry: "Industry",
  companyType: "Company Type",
};

// The template's header row: contact fields first, then the company's.
export const TEMPLATE_HEADERS = [
  "Name", "Title", "Email", "Phone", "Website", "City", "State", "Birthday", "Status",
  "Company Name", "Company Phone", "Company Email", "Company Website", "Company City", "Company State",
  "Company Status", "Industry", "Company Type",
];

// Header spellings people actually use. Exact matches win. A looser
// "contains" pass then mops up the rest, but only for the fields where a
// partial header is unambiguous (an "E-mail 1 - Value" column is an email;
// a "Contact owner" column is NOT a name), and never for a header carrying
// a word that marks it as something else (Label, Phonetic, Middle, Owner,
// Source, ID...). Company-prefixed columns are claimed before bare ones.
const ALIASES: Record<ContactCsvColumn, string[]> = {
  companyName: ["company name", "company", "organization", "organisation", "organization name", "account", "account name", "business", "business name", "employer", "firm", "company account"],
  companyPhone: ["company phone", "main phone", "office phone", "business phone", "company phone number", "work phone", "office"],
  companyEmail: ["company email", "main email", "office email", "business email", "general email"],
  companyWebsite: ["company website", "company url", "domain", "company domain", "business website", "web site company"],
  companyCity: ["company city", "business city", "office city", "hq city"],
  companyState: ["company state", "business state", "office state", "hq state", "company province"],
  companyStatus: ["company status", "account status", "business status"],
  industry: ["industry", "industries", "vertical", "sector", "market", "segment"],
  companyType: ["company type", "company types", "type", "account type", "business type", "category", "role", "company role", "company category"],
  name: ["name", "full name", "contact", "contact name", "person", "customer", "customer name", "lead", "lead name", "client", "client name"],
  firstName: ["first name", "first", "given name", "firstname", "fname"],
  lastName: ["last name", "last", "surname", "family name", "lastname", "lname"],
  title: ["title", "job title", "position", "job", "occupation", "contact title"],
  email: ["email", "e mail", "email address", "contact email", "primary email", "e mail address", "mail", "email 1", "e mail 1", "e mail 1 value", "email 1 value"],
  phone: ["phone", "phone number", "mobile", "cell", "cell phone", "mobile phone", "telephone", "contact phone", "direct", "direct phone", "primary phone", "tel", "phone 1", "phone 1 value", "mobile phone number"],
  website: ["website", "web", "url", "web site", "site", "linkedin", "contact website", "website 1", "website 1 value"],
  city: ["city", "town", "contact city"],
  state: ["state", "province", "st", "region", "contact state", "state province"],
  birthday: ["birthday", "birth date", "date of birth", "dob", "birthdate", "born"],
  status: ["status", "contact status", "stage", "lead status", "type of contact"],
};

// Which fields a partial header match may claim, and with which words.
const CONTAINS: Partial<Record<ContactCsvColumn, string[]>> = {
  companyName: ["company name", "account name", "organization name", "business name"],
  companyPhone: ["company phone", "office phone", "business phone", "work phone"],
  companyEmail: ["company email", "office email", "business email"],
  companyWebsite: ["company website", "company url", "business website", "company domain"],
  companyCity: ["company city", "business city"],
  companyState: ["company state", "business state"],
  companyStatus: ["company status", "account status"],
  industry: ["industry"],
  companyType: ["company type", "account type", "business type"],
  firstName: ["first name", "given name"],
  lastName: ["last name", "surname", "family name"],
  title: ["job title"],
  email: ["email", "e mail"],
  phone: ["phone", "mobile", "cell", "telephone"],
  website: ["website", "web site"],
  birthday: ["birthday", "birth date", "date of birth"],
};

// A header carrying any of these is never a partial match: it describes
// a label, a code, a different person, or a different thing entirely.
const DISQUALIFIERS = ["label", "phonetic", "middle", "owner", "source", "id", "notes", "type", "prefix", "suffix", "extension", "ext", "fax", "assistant", "spouse", "manager", "secondary", "2", "3", "4"];

const CLAIM_ORDER: ContactCsvColumn[] = [
  "companyName", "companyPhone", "companyEmail", "companyWebsite", "companyCity", "companyState", "companyStatus",
  "industry", "companyType", "firstName", "lastName", "name", "title", "email", "phone", "website", "city", "state",
  "birthday", "status",
];

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function detectContactColumns(headers: string[]): Partial<Record<ContactCsvColumn, number>> {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const result: Partial<Record<ContactCsvColumn, number>> = {};
  for (const column of CLAIM_ORDER) {
    const index = normalized.findIndex((h, i) => !used.has(i) && ALIASES[column].includes(h));
    if (index >= 0) {
      result[column] = index;
      used.add(index);
    }
  }
  for (const column of CLAIM_ORDER) {
    if (result[column] !== undefined) continue;
    const words = CONTAINS[column];
    if (!words) continue;
    const index = normalized.findIndex((h, i) => {
      if (used.has(i)) return false;
      const tokens = h.split(" ");
      if (tokens.some((token) => DISQUALIFIERS.includes(token))) return false;
      return words.some((word) => h.includes(word));
    });
    if (index >= 0) {
      result[column] = index;
      used.add(index);
    }
  }
  return result;
}

export type ImportCompany = {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  status: ContactStatusValue | null;
  industries: string[];
  companyTypes: string[];
};

export type ImportContactRow = {
  line: number;
  // Null when the row only names a company.
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  birthday: string | null;
  status: ContactStatusValue | null;
  company: ImportCompany | null;
  notes: string[];
};

export type ContactImportPlan = {
  headers: string[];
  columns: Partial<Record<ContactCsvColumn, number>>;
  rows: ImportContactRow[];
  contactRows: number;
  companyOnlyRows: number;
  companiesNamed: number;
  skippedEmpty: number;
  skippedDuplicates: number;
};

export function parseStatus(raw: string): { status: ContactStatusValue | null; note?: string } {
  const value = raw.trim().toLowerCase();
  if (!value) return { status: null };
  const upper = value.toUpperCase();
  if ((CONTACT_STATUSES as readonly string[]).includes(upper)) return { status: upper as ContactStatusValue };
  // "Inactive" contains "active", so the archived words are checked first.
  if (/archiv|inactive|closed|lost|dead|old|former|churn/.test(value)) return { status: "ARCHIVED" };
  if (/lead|prospect|new|open|cold|warm/.test(value)) return { status: "LEAD" };
  if (/customer|client|won|active|current/.test(value)) return { status: "CUSTOMER" };
  return { status: null, note: `Unknown status "${raw.trim()}" — used Lead` };
}

// "1984-03-09", "3/9/1984", "03-09-84", "March 9, 1984" all land on the
// same calendar day; anything else is left blank with a note.
export function parseBirthday(raw: string): { birthday: string | null; note?: string } {
  const value = raw.trim();
  if (!value) return { birthday: null };
  const unreadable = { birthday: null, note: `Couldn't read birthday "${value}" — left blank` };
  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;
  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!match) {
    match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (match) {
      m = Number(match[1]);
      d = Number(match[2]);
      y = Number(match[3]);
      if (y < 100) y += y > new Date().getFullYear() % 100 ? 1900 : 2000;
    }
  }
  if (!match) {
    // "March 9, 1984" and friends. A value with no year ("March 9") would
    // be read as 2001 by the date parser, so a year has to be present.
    if (!/\d{4}/.test(value)) return unreadable;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) [y, m, d] = [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()];
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || y < 1900 || y > 2100) return unreadable;
  // 2/31 is not a day; Date would roll it into March.
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return unreadable;
  return { birthday: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

// "MDU; Student" or "MDU, Student" or "MDU | Student". A slash is not a
// separator, since "Networks/ISP" is one type.
export const MAX_TAGS_PER_CELL = 20;
export function splitList(raw: string): { values: string[]; note?: string } {
  const values: string[] = [];
  for (const piece of raw.split(/[;,|]/)) {
    const value = piece.trim().replace(/\s+/g, " ").replace(/\u001f/g, "").slice(0, 60);
    if (value && !values.some((v) => v.toLowerCase() === value.toLowerCase())) values.push(value);
  }
  if (values.length > MAX_TAGS_PER_CELL) {
    return { values: values.slice(0, MAX_TAGS_PER_CELL), note: `Only the first ${MAX_TAGS_PER_CELL} of ${values.length} tags kept` };
  }
  return { values };
}

function cleanEmail(raw: string) {
  const value = raw.trim().toLowerCase();
  if (!value) return { email: null as string | null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { email: null as string | null, note: `"${raw.trim()}" isn't an email — left blank` };
  return { email: value.slice(0, 200) };
}

function cleanWebsite(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  return (/^https?:\/\//i.test(value) ? value : `https://${value}`).slice(0, 200);
}

export function planContactImport(text: string): { ok: true; plan: ContactImportPlan } | { ok: false; error: string } {
  const table = parseCsvLines(text);
  if (table.length === 0) return { ok: false, error: "The file is empty." };

  const headers = table[0].cells.map((h) => h.trim());
  const columns = detectContactColumns(headers);
  const hasName = columns.name !== undefined || columns.firstName !== undefined || columns.lastName !== undefined;
  if (!hasName && columns.companyName === undefined) {
    return {
      ok: false,
      error:
        "Couldn't find a Name or Company Name column. Make the first row headers such as Name, Email, Phone, Company Name — or download the template.",
    };
  }

  const rows: ImportContactRow[] = [];
  const seen = new Set<string>();
  let skippedEmpty = 0;
  let skippedDuplicates = 0;
  let companyOnlyRows = 0;
  const companies = new Set<string>();

  table.slice(1).forEach(({ cells, line }) => {
    const cell = (column: ContactCsvColumn) => {
      const at = columns[column];
      return at === undefined ? "" : (cells[at] ?? "").trim();
    };
    const notes: string[] = [];

    const fullName = cell("name") || [cell("firstName"), cell("lastName")].filter(Boolean).join(" ");
    const name = fullName.replace(/\s+/g, " ").slice(0, 160) || null;
    const companyName = cell("companyName").replace(/\s+/g, " ").slice(0, 160) || null;
    if (!name && !companyName) {
      skippedEmpty += 1;
      return;
    }

    const email = cleanEmail(cell("email"));
    if (email.note) notes.push(email.note);
    const key = name
      ? email.email
        ? `email:${email.email}`
        : `person:${name.toLowerCase()}|${(companyName ?? "").toLowerCase()}`
      : `company:${companyName!.toLowerCase()}`;
    if (seen.has(key)) {
      skippedDuplicates += 1;
      return;
    }
    seen.add(key);

    const status = parseStatus(cell("status"));
    if (status.note) notes.push(status.note);
    const birthday = parseBirthday(cell("birthday"));
    if (birthday.note) notes.push(birthday.note);
    const companyStatus = parseStatus(cell("companyStatus"));
    if (companyStatus.note) notes.push(companyStatus.note.replace("status", "company status"));
    const companyEmail = cleanEmail(cell("companyEmail"));
    if (companyEmail.note) notes.push(companyEmail.note);

    // A row with no person is a company on its own. Its bare Phone, Email,
    // Website, City, State and Status then describe the company, so a plain
    // companies sheet imports with everything filled in.
    const companyOnly = !name;
    const industries = splitList(cell("industry"));
    if (industries.note) notes.push(industries.note);
    const companyTypes = splitList(cell("companyType"));
    if (companyTypes.note) notes.push(companyTypes.note);

    let company: ImportCompany | null = null;
    if (companyName) {
      companies.add(companyName.toLowerCase());
      const bareEmail = companyOnly ? email : { email: null };
      company = {
        name: companyName,
        phone: cell("companyPhone").slice(0, 40) || (companyOnly ? cell("phone").slice(0, 40) : "") || null,
        email: companyEmail.email ?? bareEmail.email,
        website: cleanWebsite(cell("companyWebsite")) ?? (companyOnly ? cleanWebsite(cell("website")) : null),
        city: cell("companyCity").slice(0, 120) || (companyOnly ? cell("city").slice(0, 120) : "") || null,
        state: normalizeState(cell("companyState")) ?? (companyOnly ? normalizeState(cell("state")) : null),
        status: companyStatus.status ?? (companyOnly ? status.status : null),
        industries: industries.values,
        companyTypes: companyTypes.values,
      };
    } else if (cell("industry") || cell("companyType")) {
      notes.push("Industry / Company Type need a Company Name — ignored");
    }
    if (companyOnly) companyOnlyRows += 1;

    rows.push({
      line,
      name,
      title: cell("title").slice(0, 120) || null,
      email: email.email,
      phone: cell("phone").slice(0, 40) || null,
      website: cleanWebsite(cell("website")),
      city: cell("city").slice(0, 120) || null,
      state: normalizeState(cell("state")),
      birthday: birthday.birthday,
      status: status.status,
      company,
      notes,
    });
  });

  return {
    ok: true,
    plan: {
      headers,
      columns,
      rows,
      contactRows: rows.length - companyOnlyRows,
      companyOnlyRows,
      companiesNamed: companies.size,
      skippedEmpty,
      skippedDuplicates,
    },
  };
}

export type ImportBatchResult = {
  contactsCreated: number;
  contactsUpdated: number;
  companiesCreated: number;
  companiesUpdated: number;
  skipped: { line: number; reason: string }[];
};

export function emptyBatchResult(): ImportBatchResult {
  return { contactsCreated: 0, contactsUpdated: 0, companiesCreated: 0, companiesUpdated: 0, skipped: [] };
}

export function addBatchResult(into: ImportBatchResult, result: ImportBatchResult) {
  into.contactsCreated += result.contactsCreated;
  into.contactsUpdated += result.contactsUpdated;
  into.companiesCreated += result.companiesCreated;
  into.companiesUpdated += result.companiesUpdated;
  into.skipped.push(...result.skipped);
}

// A CSV of the rows that did not import and why, for fixing and reloading.
export function skippedCsv(skipped: { line: number; reason: string }[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return ["Line,Reason", ...skipped.map((row) => `${row.line},${escape(row.reason)}`)].join("\r\n") + "\r\n";
}
