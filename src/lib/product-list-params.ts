import { DEFAULT_PAGE_SIZE, LINE_ITEM_TAGS, PAGE_SIZES, type LineItemTagValue } from "@/lib/constants";
import { cleanSearch } from "@/lib/list-params";

// What the Products list can be narrowed by, read from the address bar so
// Back and bookmarks keep the view — the same footing as the Contacts and
// Companies lists. Every filter is optional and they all stack.
export type ProductListParams = {
  q: string;
  page: number;
  per: number;
  suppliers: string[];
  makers: string[];
  tags: LineItemTagValue[];
  services: string[];
  // "active", "inactive", both or neither (neither and both both mean all).
  statuses: ProductStatusValue[];
};

export const PRODUCT_STATUSES = ["active", "inactive"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];
export const PRODUCT_STATUS_LABELS: Record<ProductStatusValue, string> = { active: "Active", inactive: "Inactive" };

type RawParams = Record<string, string | string[] | undefined>;

// One value per repeated parameter (?tag=LABOR&tag=MATERIALS), never split
// on commas.
function list(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(values.map((v) => v.trim().slice(0, 120)).filter(Boolean))).slice(0, 50);
}

export function parseProductListParams(raw: RawParams): ProductListParams {
  const per = Number(Array.isArray(raw.per) ? raw.per[0] : raw.per);
  const page = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  return {
    q: cleanSearch(Array.isArray(raw.q) ? raw.q[0] : raw.q),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    per: (PAGE_SIZES as readonly number[]).includes(per) ? per : DEFAULT_PAGE_SIZE,
    suppliers: list(raw.supplier),
    makers: list(raw.maker),
    tags: list(raw.tag).filter((value): value is LineItemTagValue => (LINE_ITEM_TAGS as readonly string[]).includes(value)),
    services: list(raw.service),
    statuses: list(raw.status).filter((value): value is ProductStatusValue => (PRODUCT_STATUSES as readonly string[]).includes(value)),
  };
}

// The address for a view, with any overrides applied; page resets to 1 on
// any change other than an explicit page.
export function productListHref(basePath: string, params: ProductListParams, overrides: Partial<ProductListParams> = {}) {
  const next = { ...params, ...overrides };
  if (!("page" in overrides)) next.page = 1;
  const search = new URLSearchParams();
  if (next.q) search.set("q", next.q);
  if (next.page > 1) search.set("page", String(next.page));
  if (next.per !== DEFAULT_PAGE_SIZE) search.set("per", String(next.per));
  for (const id of next.suppliers) search.append("supplier", id);
  for (const id of next.makers) search.append("maker", id);
  for (const tag of next.tags) search.append("tag", tag);
  for (const service of next.services) search.append("service", service);
  for (const status of next.statuses) search.append("status", status);
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function activeProductFilterCount(params: ProductListParams) {
  return params.suppliers.length + params.makers.length + params.tags.length + params.services.length + params.statuses.length;
}

// What the filter bar's dropdowns offer (getProductFilterOptions fills it).
export type ProductFilterOptions = {
  suppliers: { id: string; name: string }[];
  makers: { id: string; name: string }[];
  services: string[];
};
