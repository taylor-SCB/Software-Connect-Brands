import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@/lib/constants";

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
  fav: boolean;
  deals: boolean;
  attn: boolean;
};

// The sub-panes ("Favorite Contacts", "Companies with Deals") are the same
// list with one toggle held on; the bar hides that toggle there.
export type ListLock = { fav?: boolean; deals?: boolean };

type RawParams = Record<string, string | string[] | undefined>;

// One value per repeated parameter (?state=TX&state=CO). Never split on
// commas: "Food, Beverage" is one industry.
function list(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(values.map((v) => v.trim().slice(0, 120)).filter(Boolean))).slice(0, 50);
}

// The search box's text. % and _ are SQL wildcards inside a "contains"
// match and Prisma passes them through, so they become spaces here: a
// search for "%" then finds nothing instead of everything.
export function cleanSearch(value: string | undefined) {
  return (value ?? "").replace(/[%_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function parseListParams(raw: RawParams, lock: ListLock = {}): ListParams {
  const per = Number(Array.isArray(raw.per) ? raw.per[0] : raw.per);
  const page = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  return {
    q: cleanSearch(Array.isArray(raw.q) ? raw.q[0] : raw.q),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    per: (PAGE_SIZES as readonly number[]).includes(per) ? per : DEFAULT_PAGE_SIZE,
    states: list(raw.state),
    industries: list(raw.industry),
    types: list(raw.type),
    companies: list(raw.company),
    fav: lock.fav || raw.fav === "1",
    deals: lock.deals || raw.deals === "1",
    attn: raw.attn === "1",
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
  if (next.fav && !lock.fav) search.set("fav", "1");
  if (next.deals && !lock.deals) search.set("deals", "1");
  if (next.attn) search.set("attn", "1");
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function activeFilterCount(params: ListParams, lock: ListLock = {}) {
  return (
    params.states.length +
    params.industries.length +
    params.types.length +
    params.companies.length +
    (params.fav && !lock.fav ? 1 : 0) +
    (params.deals && !lock.deals ? 1 : 0) +
    (params.attn ? 1 : 0)
  );
}

export function pageWindow(total: number, per: number, page: number) {
  const pages = Math.max(1, Math.ceil(total / per));
  const current = Math.min(page, pages);
  return { pages, current, skip: (current - 1) * per, from: total === 0 ? 0 : (current - 1) * per + 1, to: Math.min(total, current * per) };
}
