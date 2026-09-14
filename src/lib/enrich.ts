// The rules behind "tag every imported company and fill in missing
// phones and websites". Pure functions with no database access, so
// they can be unit-tested and read top to bottom. Two sources only:
// the spreadsheet a company came in on, and the people at that company.
// Nothing here looks anything up outside the workspace.

import { DEFAULT_INDUSTRIES, GENERAL_COMPANY_TYPE } from "@/lib/constants";

// Same rule as normalizeWebsite in src/lib/companies.ts, repeated here so
// this file stays free of the database client that module pulls in.
function normalizeWebsite(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export const UNCATEGORIZED_INDUSTRY = "Uncategorized";
export const DISTRIBUTOR_COMPANY_TYPE = "Distributor";

// Names must match DEFAULT_INDUSTRIES exactly so a suggestion lands on
// the pick-list row the workspace already has, not a lookalike.
const SERVICE_PROVIDER = "Service Provider";
const MDU = "MDU";

export type TagSuggestion = { industry: string; companyType: string };

// First hit wins, so the specific trades sit above the broad buckets:
// "Acme Electric Supply" is an electrician before it is a supplier.
const NAME_RULES: [RegExp, TagSuggestion][] = [
  [/\b(electric|electrical|electrician)/, { industry: SERVICE_PROVIDER, companyType: "Electrician" }],
  [/\b(door hardware|hardware)\b/, { industry: SERVICE_PROVIDER, companyType: "Door Hardware" }],
  [/\b(gate|gates)\b/, { industry: SERVICE_PROVIDER, companyType: "Gates" }],
  [/(lock|locksmith|security|access control|alarm|surveillance|camera)/, { industry: SERVICE_PROVIDER, companyType: "Access Control" }],
  [/(network|isp|internet|wifi|wi-fi|fiber|telecom|broadband)/, { industry: SERVICE_PROVIDER, companyType: "Networks/ISP" }],
  [/(integrat|cabling|structured|audio|video|\bav\b|low voltage|automation|smart home|technolog)/, { industry: SERVICE_PROVIDER, companyType: "Integrator" }],
  [/(supply|supplies|distribut|wholesale|depot|warehouse)/, { industry: SERVICE_PROVIDER, companyType: DISTRIBUTOR_COMPANY_TYPE }],
  [
    /(roof|paint|drywall|plumb|hvac|heating|cooling|builder|construction|remodel|contractor|landscap|concrete|floor|carpent|siding|window|gutter|fenc|paving|masonry|insulat|excavat|handyman|restoration)/,
    { industry: "Construction", companyType: GENERAL_COMPANY_TYPE },
  ],
  [/(university|college|student|campus|dorm)/, { industry: "Student", companyType: "Property Management" }],
  [
    /(apartment|residence|towers|lofts|property management|realty|real estate|communit|village|living|estates|manor|park place|at the|the [a-z]+ at)/,
    { industry: MDU, companyType: "Property Management" },
  ],
  [/(capital|holdings|partners|investment|equity|ventures|fund|reit)/, { industry: MDU, companyType: "Capital Group" }],
  [/(develop)/, { industry: MDU, companyType: "Developer" }],
  [
    /(hotel|restaurant|retail|store|shop|clinic|dental|medical|office|church|school|bank|salon|gym|cafe|grill|market|auto|dealer)/,
    { industry: "Commercial", companyType: GENERAL_COMPANY_TYPE },
  ],
  [
    /(\bllc\b|\binc\b|\bcorp\b|\bco\b|company|\bltd\b|services|solutions|group|enterprises|associates)/,
    { industry: "Small Business", companyType: GENERAL_COMPANY_TYPE },
  ],
];

// A person's job title says what kind of place they work at; it is
// checked before the name so "Leasing Manager at Acme" reads as a
// property, whatever Acme is called.
const TITLE_RULES: [RegExp, TagSuggestion][] = [
  [/(property manager|leasing|community manager|regional manager)/, { industry: MDU, companyType: "Property Management" }],
  [/(electrician)/, { industry: SERVICE_PROVIDER, companyType: "Electrician" }],
];

export const FALLBACK_TAGS: TagSuggestion = { industry: UNCATEGORIZED_INDUSTRY, companyType: GENERAL_COMPANY_TYPE };

// Personal mail: an address here says nothing about the company.
export const FREE_MAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
  "msn.com",
  "protonmail.com",
  "proton.me",
  "ymail.com",
  "mail.com",
] as const;

// A person's LinkedIn or Facebook page is not their company's website.
const PROFILE_SITES = ["linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com"];

// Just the digits, without a leading US country code, so "1 (555) 010-0100"
// and "555-010-0100" read as the same number.
export function normalizePhoneDigits(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

// "https://www.Acme.com/about" -> "acme.com". Null when there is no host.
export function websiteDomain(website: string | null | undefined) {
  if (!website) return null;
  const host = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return host && host.includes(".") ? host : null;
}

export function emailDomain(email: string | null | undefined) {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.includes(".") ? domain : null;
}

export function isFreeMailDomain(domain: string) {
  return (FREE_MAIL_DOMAINS as readonly string[]).includes(domain.toLowerCase());
}

function isProfileSite(domain: string) {
  return PROFILE_SITES.some((site) => domain === site || domain.endsWith(`.${site}`));
}

// The Industry / Company Type a company most likely is, read from its
// name, its website's domain, the domain its people's work emails use,
// and their job titles. Always answers: a company nobody can place is
// "Uncategorized / General", which is still a tag the filters can find.
export function suggestTags(input: {
  name: string;
  website?: string | null;
  titles?: (string | null | undefined)[];
  emails?: (string | null | undefined)[];
}): TagSuggestion {
  const titles = (input.titles ?? []).filter((t): t is string => Boolean(t)).map((t) => t.toLowerCase());
  for (const title of titles) {
    for (const [pattern, tags] of TITLE_RULES) if (pattern.test(title)) return tags;
  }
  const domains = new Set<string>();
  const site = websiteDomain(input.website);
  if (site) domains.add(site);
  for (const email of input.emails ?? []) {
    const domain = emailDomain(email);
    if (domain && !isFreeMailDomain(domain)) domains.add(domain);
  }
  const haystack = [input.name, ...domains, ...titles].join(" ").toLowerCase();
  for (const [pattern, tags] of NAME_RULES) if (pattern.test(haystack)) return tags;
  return FALLBACK_TAGS;
}

// Titles that mark the person whose number is the company's number.
const MAIN_LINE_TITLES = /(owner|office|admin|manager|main|reception|front desk|president|ceo|principal|dispatch)/i;

export type ContactHint = {
  phone?: string | null;
  email?: string | null;
  title?: string | null;
  website?: string | null;
};

// One list of people from two sources — the rows of the file being
// imported and what is already on file — with the same person counted
// once. The rules below count titles and numbers, so a person listed
// twice would read as two people agreeing. The first source wins the
// spot, so the batch's rows come first in the merged list.
export function mergeContactHints(first: ContactHint[], second: ContactHint[]) {
  const seen = new Set<string>();
  const merged: ContactHint[] = [];
  for (const hint of [...first, ...second]) {
    const key = [hint.phone, hint.email, hint.title, hint.website].map((value) => (value ?? "").trim().toLowerCase()).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hint);
  }
  return merged;
}

// The phone and website a company's own people give away. Cautious on
// purpose: two different numbers and no title to pick between them means
// no phone; two different work-email domains means no website.
export function copyUpFromContacts(contacts: ContactHint[]): { phone: string | null; website: string | null } {
  return { phone: pickPhone(contacts), website: pickWebsite(contacts) };
}

function pickPhone(contacts: ContactHint[]) {
  const withPhone = contacts.filter((c) => c.phone && normalizePhoneDigits(c.phone).length >= 7);
  if (withPhone.length === 0) return null;
  const mainLine = withPhone.filter((c) => c.title && MAIN_LINE_TITLES.test(c.title));
  if (mainLine.length === 1) return mainLine[0].phone!.trim();
  const numbers = new Set(withPhone.map((c) => normalizePhoneDigits(c.phone!)));
  return numbers.size === 1 ? withPhone[0].phone!.trim() : null;
}

function pickWebsite(contacts: ContactHint[]) {
  const sites = new Map<string, string>();
  for (const contact of contacts) {
    const normalized = normalizeWebsite(contact.website?.trim() || null);
    const domain = websiteDomain(normalized);
    if (!normalized || !domain || isProfileSite(domain)) continue;
    if (!sites.has(domain)) sites.set(domain, normalized.replace(/\/$/, ""));
  }
  if (sites.size === 1) return Array.from(sites.values())[0];

  // No website on anyone, or people listing different ones (personal
  // pages, say): the domain their work email shares decides instead.
  const domains = new Set<string>();
  for (const contact of contacts) {
    const domain = emailDomain(contact.email);
    if (domain && !isFreeMailDomain(domain)) domains.add(domain);
  }
  return domains.size === 1 ? `https://${Array.from(domains)[0]}` : null;
}

// The pick-list arguments ensureIndustryOptions wants, for a set of
// suggestions, so an import batch or a fill batch makes one call.
export function pickListRequest(suggestions: TagSuggestion[]) {
  const industries: string[] = [];
  const typesByIndustry: Record<string, string[]> = {};
  for (const { industry, companyType } of suggestions) {
    if (!industries.includes(industry)) industries.push(industry);
    const types = (typesByIndustry[industry] ??= []);
    if (!types.includes(companyType)) types.push(companyType);
  }
  return { industries, typesByIndustry };
}

// Names of the fields the app may fill on its own, as stored in
// Company.autoFilled.
export const AUTO_FIELDS = ["industries", "companyTypes", "phone", "website"] as const;
export type AutoField = (typeof AUTO_FIELDS)[number];

export function withAuto(current: string[], add: AutoField[]) {
  const out = [...current];
  for (const field of add) if (!out.includes(field)) out.push(field);
  return out;
}

export function withoutAuto(current: string[], drop: AutoField[]) {
  return current.filter((field) => !(drop as readonly string[]).includes(field));
}

// True when two tag lists carry the same names (order and case aside).
export function sameTags(a: string[], b: string[]) {
  const norm = (list: string[]) => Array.from(new Set(list.map((v) => v.trim().toLowerCase()))).sort();
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Companies per request when "Fill in missing" runs, same as the import.
export const FILL_BATCH_SIZE = 500;

// What one pass filled in, for the running totals in the dialogs.
export type EnrichCounts = {
  tagged: number;
  phonesFilled: number;
  websitesFilled: number;
  // Companies that still lack tags, a phone or a website after the pass:
  // nothing on file could say.
  stillMissing: number;
};

export const emptyEnrichCounts = (): EnrichCounts => ({ tagged: 0, phonesFilled: 0, websitesFilled: 0, stillMissing: 0 });

export function addEnrichCounts(into: EnrichCounts, add: EnrichCounts) {
  into.tagged += add.tagged;
  into.phonesFilled += add.phonesFilled;
  into.websitesFilled += add.websitesFilled;
  into.stillMissing += add.stillMissing;
}

// "Tagged 812 · 340 phones · 511 websites filled in", "Tagged 812",
// "5 phones filled in", or the `nothing` line when no count moved. "filled
// in" only ever follows a phone or website count — tags are "tagged", so
// a tags-only pass never reads "Tagged 812 filled in". The `nothing` line
// is the dialog's to choose: a run that went looking and found nothing
// says so differently from an import that had nothing to look for.
export function describeFilled(counts: { tagged: number; phonesFilled: number; websitesFilled: number }, nothing: string) {
  const tagged = counts.tagged > 0 ? `Tagged ${counts.tagged.toLocaleString()}` : null;
  const filled: string[] = [];
  if (counts.phonesFilled > 0) filled.push(`${counts.phonesFilled.toLocaleString()} ${counts.phonesFilled === 1 ? "phone" : "phones"}`);
  if (counts.websitesFilled > 0) filled.push(`${counts.websitesFilled.toLocaleString()} ${counts.websitesFilled === 1 ? "website" : "websites"}`);
  const parts = [tagged, filled.length > 0 ? `${filled.join(" · ")} filled in` : null].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : nothing;
}

// A quick sanity check that the vocabulary above still matches the seed
// lists; a renamed default would otherwise tag companies with a name
// the pick list doesn't have.
export function suggestionVocabularyProblems(): string[] {
  const problems: string[] = [];
  const known = new Map(DEFAULT_INDUSTRIES.map((i) => [i.name, i.types]));
  for (const [, tags] of [...TITLE_RULES, ...NAME_RULES]) {
    const types = known.get(tags.industry);
    if (!types) {
      problems.push(`industry "${tags.industry}" is not a default`);
      continue;
    }
    if (!types.includes(tags.companyType) && tags.companyType !== DISTRIBUTOR_COMPANY_TYPE) {
      problems.push(`type "${tags.companyType}" is not under ${tags.industry}`);
    }
  }
  return problems;
}
