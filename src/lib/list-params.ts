import { CONTACT_STATUSES, DEFAULT_PAGE_SIZE, PAGE_SIZES, type ContactStatusValue } from "@/lib/constants";

// Everything the Contacts and Companies lists can be narrowed by, read
// from the address bar so Back, bookmarks and "how I got there is how I
// go back" all keep the same view. Every filter is optional and they all
// stack: State AND Industry AND Company Type AND Company AND the toggles.
export type ListParams = {
  q: string;
  page: number;
  per: number;
  states: string[];
  industries: string[];
  types: string[];
  companies: string[];
  // Where they are on the status ladder (Oct 4, 2026): any of Not
  // Actioned … Archived, stacking like the other multi-selects. Empty
  // on the Interested sub-panes, whose lock already holds the status.
  statuses: ContactStatusValue[];
  fav: boolean;
  deals: boolean;
  attn: boolean;
  // Companies only: those with a value the app filled in on its own
  // (Company.autoFilled), for reviewing what it guessed. The Contacts
  // list forces it off after parsing.
  auto: boolean;
  // Only the people who still owe money on signed paperwork — the first
  // thing to look at in the morning.
  owed: boolean;
  // Only ever set by a sub-pane's lock, never from the address bar.
  interested: boolean;
  // Clean CRM data (Nov 10, 2026). Touched in / not touched in the last
  // 7, 30 or 90 days, or never: a touch is a call, text, email or meeting
  // anybody logged — never a marketing send — and for a company one on it
  // or on any of its people.
  act: ActivityWindow | "";
  // Contacts only: job titles, matched ignoring case.
  titles: string[];
  // Rep (Contact / Company ownerId); UNASSIGNED stands for nobody.
  reps: string[];
  // Who added it (createdById).
  addedBy: string[];
  // Added between these days (YYYY-MM-DD, the workspace's clock), either
  // end optional.
  from: string;
  to: string;
  // Has / has no mobile (contacts), email (both), phone (companies).
  mobile: Presence;
  email: Presence;
  phone: Presence;
  // On an opportunity with this Lead Label (a company: any of its people).
  labels: string[];
};

export const ACTIVITY_WINDOWS = ["t7", "t30", "t90", "n7", "n30", "n90", "never"] as const;
export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number];
export const ACTIVITY_WINDOW_LABELS: Record<ActivityWindow, string> = {
  t7: "Touched in the last 7 days",
  t30: "Touched in the last 30 days",
  t90: "Touched in the last 90 days",
  n7: "Not touched in the last 7 days",
  n30: "Not touched in the last 30 days",
  n90: "Not touched in the last 90 days",
  never: "Never touched",
};
export type Presence = "" | "yes" | "no";
// Bulk Assign on the lists takes at most this many records a go.
export const MAX_ASSIGN = 1000;
// The Rep filter's choice for records nobody owns.
export const UNASSIGNED = "none";

function presence(value: string | string[] | undefined): Presence {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "yes" || v === "no" ? v : "";
}

function day(value: string | string[] | undefined) {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : "";
}

// The sub-panes ("Favorite Contacts", "Companies with Deals") are the same
// list with one toggle held on; the bar hides that toggle there.
// "Interested Contacts" / "Interested Companies" (Sept 30, 2026) hold
// the status at Interested.
export type ListLock = { fav?: boolean; deals?: boolean; interested?: boolean };

type RawParams = Record<string, string | string[] | undefined>;

// One value per repeated parameter (?state=TX&state=CO). Never split on
// commas: "Food, Beverage" is one industry.
function list(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(values.map((v) => v.trim().slice(0, 120)).filter(Boolean))).slice(0, 50);
}

// The search box's text (the pickers' and the catalog's type-to-search;
// the Contacts and Companies lists use cleanListSearch below). % and _
// are SQL wildcards inside a "contains" match and Prisma passes them
// through, so they become spaces here: a search for "%" then finds
// nothing instead of everything. A backslash is the match's escape
// character, and one at the end made the database refuse the search
// outright (the catalog search, Oct 25, 2026), so it goes the same way.
export function cleanSearch(value: string | undefined) {
  return (value ?? "").replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

// The Contacts and Companies search box (UX review, Nov 10, 2026). It
// matches word by word now, so % _ and \ are kept as typed rather than
// turned into spaces — a space would split "r%a" into two words that
// match nearly everyone — and the list query matches them as plain
// characters (likeText in list-query.ts).
export function cleanListSearch(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

// A search that is a phone number, however it was typed (UX review, Nov
// 10, 2026): only digits and the marks people put in numbers, with at
// least seven digits. Phones are stored the way they were typed or
// imported, so the list also compares it digits-only, the last 10 like
// the duplicate finder: 512-555-0125, 5125550125, 512.555.0125 and
// +1 (512) 555-0125 all find "(512) 555-0125". Shorter runs of digits
// ("0125") already match the stored text as they are.
export const PHONE_SEARCH_MIN_DIGITS = 7;
export function phoneSearchDigits(term: string): string | null {
  if (!/^[\d\s+().\-/]+$/.test(term)) return null;
  const digits = term.replace(/\D/g, "");
  return digits.length >= PHONE_SEARCH_MIN_DIGITS ? digits.slice(-10) : null;
}

// The words of a search, each of which has to be found somewhere on the
// row (UX review, Nov 10, 2026): "alan delta" is Alan at Delta Door and
// "howard denise" is Denise Howard. A phone number stays one term, and
// past six words the rest are left out, as on Products.
export const MAX_SEARCH_WORDS = 6;
export function searchTerms(q: string): string[] {
  const text = q.trim();
  if (!text) return [];
  if (phoneSearchDigits(text)) return [text];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of text.split(" ")) {
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    terms.push(word);
  }
  return terms.slice(0, MAX_SEARCH_WORDS);
}

export function parseListParams(raw: RawParams, lock: ListLock = {}): ListParams {
  const per = Number(Array.isArray(raw.per) ? raw.per[0] : raw.per);
  const page = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  return {
    q: cleanListSearch(Array.isArray(raw.q) ? raw.q[0] : raw.q),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    per: (PAGE_SIZES as readonly number[]).includes(per) ? per : DEFAULT_PAGE_SIZE,
    states: list(raw.state),
    industries: list(raw.industry),
    types: list(raw.type),
    companies: list(raw.company),
    statuses: lock.interested
      ? []
      : list(raw.status).filter((value): value is ContactStatusValue => (CONTACT_STATUSES as readonly string[]).includes(value)),
    fav: lock.fav || raw.fav === "1",
    deals: lock.deals || raw.deals === "1",
    attn: raw.attn === "1",
    auto: raw.auto === "1",
    owed: raw.owed === "1",
    interested: Boolean(lock.interested),
    act: (ACTIVITY_WINDOWS as readonly string[]).includes(String(raw.act)) ? (raw.act as ActivityWindow) : "",
    titles: list(raw.title),
    reps: list(raw.rep),
    addedBy: list(raw.by),
    from: day(raw.from),
    to: day(raw.to),
    mobile: presence(raw.mobile),
    email: presence(raw.email),
    phone: presence(raw.phone),
    labels: list(raw.label),
  };
}

// The address for a view, with any overrides applied. Locked toggles are
// not written (the path carries them); page resets to 1 on any change
// other than an explicit page.
export function listHref(basePath: string, params: ListParams, overrides: Partial<ListParams> = {}, lock: ListLock = {}) {
  const next = { ...params, ...overrides };
  if (!("page" in overrides)) next.page = 1;
  const search = new URLSearchParams();
  if (next.q) search.set("q", next.q);
  if (next.page > 1) search.set("page", String(next.page));
  if (next.per !== DEFAULT_PAGE_SIZE) search.set("per", String(next.per));
  for (const state of next.states) search.append("state", state);
  for (const industry of next.industries) search.append("industry", industry);
  for (const type of next.types) search.append("type", type);
  for (const company of next.companies) search.append("company", company);
  if (!lock.interested) for (const status of next.statuses) search.append("status", status);
  if (next.fav && !lock.fav) search.set("fav", "1");
  if (next.deals && !lock.deals) search.set("deals", "1");
  if (next.attn) search.set("attn", "1");
  if (next.auto) search.set("auto", "1");
  if (next.owed) search.set("owed", "1");
  if (next.act) search.set("act", next.act);
  for (const title of next.titles) search.append("title", title);
  for (const rep of next.reps) search.append("rep", rep);
  for (const by of next.addedBy) search.append("by", by);
  if (next.from) search.set("from", next.from);
  if (next.to) search.set("to", next.to);
  if (next.mobile) search.set("mobile", next.mobile);
  if (next.email) search.set("email", next.email);
  if (next.phone) search.set("phone", next.phone);
  for (const label of next.labels) search.append("label", label);
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function activeFilterCount(params: ListParams, lock: ListLock = {}) {
  return (
    params.states.length +
    params.industries.length +
    params.types.length +
    params.companies.length +
    (lock.interested ? 0 : params.statuses.length) +
    (params.fav && !lock.fav ? 1 : 0) +
    (params.deals && !lock.deals ? 1 : 0) +
    (params.attn ? 1 : 0) +
    (params.auto ? 1 : 0) +
    (params.owed ? 1 : 0) +
    (params.act ? 1 : 0) +
    params.titles.length +
    params.reps.length +
    params.addedBy.length +
    (params.from || params.to ? 1 : 0) +
    (params.mobile ? 1 : 0) +
    (params.email ? 1 : 0) +
    (params.phone ? 1 : 0) +
    params.labels.length
  );
}

// Every filter off (the bar's Clear all); the search box and paging are
// the caller's.
export const NO_FILTERS = {
  states: [],
  industries: [],
  types: [],
  companies: [],
  statuses: [],
  fav: false,
  deals: false,
  attn: false,
  auto: false,
  owed: false,
  act: "",
  titles: [],
  reps: [],
  addedBy: [],
  from: "",
  to: "",
  mobile: "",
  email: "",
  phone: "",
  labels: [],
} satisfies Partial<ListParams>;

export function pageWindow(total: number, per: number, page: number) {
  const pages = Math.max(1, Math.ceil(total / per));
  const current = Math.min(page, pages);
  return { pages, current, skip: (current - 1) * per, from: total === 0 ? 0 : (current - 1) * per + 1, to: Math.min(total, current * per) };
}
