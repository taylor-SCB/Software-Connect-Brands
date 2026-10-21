// Import Ratesheet: what a distributor's, manufacturer's or software
// provider's price list does to this workspace's catalog. Pure functions
// with no server dependencies, so the dialog's preview and the server's
// import run the same code and can never disagree.
//
// The rule the whole thing is built around: a ratesheet carries two
// numbers per item — what it costs *you*, and the supplier's MSRP. The
// first lands in COGS, never in your sell price; the second is kept
// beside it. Your sell price comes from your markup or margin, or from
// their MSRP. A sheet never sets your sell price on its own: only a
// column the person explicitly marks "Your sell price" does that.

import { parseTag, parseUnit } from "@/lib/csv";
import type { LineItemTagValue, UnitOfMeasureValue } from "@/lib/constants";
import type { SheetTable } from "@/lib/price-list-file";

// New products one sheet can add — the old Import CSV's limit. Every row
// is still checked against the catalog, so a 20,000-row manufacturer
// list updates every product already carried even though it can't add
// all of them. Kept here because the Products list and the quote's
// product picker still load every product (Oct 21, 2026: 8,600 products
// made the Products page 44 MB and 24 seconds); raise it once they page.
export const MAX_NEW_PRODUCTS = 2000;
const MAX_ROWS_READ = 25_000;
export const MAX_RATESHEET_BYTES = 4 * 1024 * 1024;
// Money is cents in a Postgres integer; anything past this is a typo.
export const MAX_CENTS = 2_000_000_000;
// Margin can't reach 100% (that would be an infinite price); markup is
// capped where a typo stops being plausible.
export const MAX_MARGIN_BP = 9500;
export const MAX_MARKUP_BP = 100_000;
// A cost that more than doubles or halves in one sheet is usually a unit
// change (a 1,000 ft box last quarter, per foot this quarter), not a price
// change. Those rows wait for a tick instead of coming in on their own.
const BIG_CHANGE_RATIO = 2;

export const COLUMN_ROLES = [
  "name",
  "sku",
  "description",
  "cost",
  "list",
  "sell",
  "manufacturer",
  "unit",
  "tag",
  "skip",
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  name: "Product name",
  sku: "SKU / part #",
  description: "Description",
  cost: "Your cost (COGS)",
  list: "MSRP",
  sell: "Your sell price",
  manufacturer: "Manufacturer",
  unit: "Unit",
  tag: "Tag",
  skip: "Don't import",
};

export const PRICE_RULES = ["MARKUP", "MARGIN", "LIST"] as const;
export type PriceRuleKind = (typeof PRICE_RULES)[number];

// What happens to the sell price of a product you already carry when
// this sheet moves its cost. MARGIN moves the price with the cost (your
// margin stays where it was), PRICE leaves it alone, RULE prices it
// fresh from the rule above.
export const EXISTING_MODES = ["MARGIN", "PRICE", "RULE"] as const;
export type ExistingMode = (typeof EXISTING_MODES)[number];

export type PricingOptions = {
  rule: PriceRuleKind;
  // Hundredths of a percent: 3500 is 35%. For LIST it is the discount
  // off MSRP (0 sells at MSRP).
  basisPoints: number;
  whenCostUp: ExistingMode;
  whenCostDown: ExistingMode;
};

export const DEFAULT_PRICING: PricingOptions = {
  rule: "MARKUP",
  basisPoints: 3000,
  whenCostUp: "MARGIN",
  whenCostDown: "PRICE",
};

// What the planner needs to know about a product already in the catalog.
export type CatalogItem = {
  id: string;
  name: string;
  sku: string | null;
  costCents: number;
  unitPriceCents: number;
  listPriceCents: number | null;
  distributorId: string | null;
  distributorName: string | null;
  active: boolean;
};

// ------------------------------------------------------------------
// Reading the sheet's layout
// ------------------------------------------------------------------

type DetectableRole = Exclude<ColumnRole, "skip" | "sell">;

// Header names suppliers actually use, normalised to lower case with
// punctuation collapsed to spaces. SKU aliases are ranked: a distributor
// file often has their own stock number *and* the manufacturer's part
// number, and the catalog is keyed on the manufacturer's.
const SKU_ALIASES: string[][] = [
  [
    "mfr part", "mfr part #", "mfr part number", "mfr #", "mfg part", "mfg part #", "mfg #", "manufacturer part",
    "manufacturer part number", "manufacturer part #", "vendor part", "vendor part #", "mpn", "model", "model #",
    "model number", "model no",
  ],
  ["sku", "sku #", "part", "part #", "part number", "part no", "part num", "catalog #", "catalog number", "cat #", "product code"],
  ["item #", "item number", "item no", "item code", "code", "stock #", "stock number", "stock no"],
];

const ALIASES: Record<Exclude<DetectableRole, "sku">, string[]> = {
  name: ["name", "product", "product name", "item", "item name", "title", "service", "line item", "product service"],
  description: ["description", "desc", "details", "notes", "product description", "long description", "item description", "short description"],
  cost: [
    "cost", "cogs", "unit cost", "our cost", "dealer cost", "dealer price", "dealer", "dealer net", "wholesale",
    "wholesale price", "net", "net price", "net cost", "your cost", "your price", "contractor price",
    "contractor cost", "cost each", "distributor price", "integrator price", "reseller price", "partner price",
    "buy price", "purchase price", "installer price", "customer price", "sale price", "promo price", "special price",
    "contract price",
  ],
  list: [
    "msrp", "list", "list price", "retail", "retail price", "suggested retail", "suggested retail price", "srp",
    "map", "map price", "mrp", "list each", "msrp each", "end user price", "end user", "suggested list",
    "suggested resale", "resale price", "suggested sell", "suggested price",
  ],
  manufacturer: ["manufacturer", "oem", "brand", "mfg", "mfr", "make", "maker", "oem manufacturer", "manufacturer name", "vendor"],
  unit: ["unit", "uom", "unit of measure", "unit of measurement", "units", "per", "measure", "sold by", "u m"],
  tag: ["tag", "default tag"],
};

// A bare "price" is your cost on a supplier's sheet; a second bare price
// column next to a cost is their MSRP.
const GENERIC_PRICE = ["price", "unit price", "rate", "price each", "each", "amount", "unit rate", "price ea", "ea"];
// Header words that might be our tag list — only used when the cells in
// that column actually are tags (a supplier's "Category" is usually
// "Card Readers", which is not one).
const MAYBE_TAG = ["category", "type", "group", "class", "kind"];
// A header with one of these in it is never a price, whatever else it
// says: "Qty Break Price", "% Change", "Price Effective Date", "Old Price".
const NOT_MONEY = /\b(qty|quantity|break|date|percent|pct|change|increase|decrease|discount|margin|markup|weight|lbs|page|lead|old|previous|prior|was)\b|%/;
// "New Price" beats any other price column. "Current" is not on this
// list: next to a "New Price" it is the old one, and on its own it is just
// the price.
const NEWER = /\b(new|now|effective)\b/;

export function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/%/g, " % ").replace(/[^a-z0-9#%]+/g, " ").trim();
}

type Guess = { role: DetectableRole | "generic" | "maybeTag"; exact: boolean; rank: number };

function guessRole(normalized: string): Guess | null {
  if (!normalized) return null;
  const words = ` ${normalized} `;
  const contains = (alias: string) => alias.length > 3 && words.includes(` ${alias} `);
  const moneyOk = !NOT_MONEY.test(normalized);

  for (let rank = 0; rank < SKU_ALIASES.length; rank += 1) {
    if (SKU_ALIASES[rank].includes(normalized)) return { role: "sku", exact: true, rank };
  }
  for (const role of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) {
    if (!ALIASES[role].includes(normalized)) continue;
    if ((role === "cost" || role === "list") && !moneyOk) return null;
    return { role, exact: true, rank: 0 };
  }
  if (GENERIC_PRICE.includes(normalized)) return { role: "generic", exact: true, rank: 0 };
  if (MAYBE_TAG.includes(normalized)) return { role: "maybeTag", exact: true, rank: 0 };

  // Contains-matching, most specific first, so "MSRP Each" is a list price
  // and "Price - Dealer" is a cost before the bare word "price" can
  // claim either.
  if (moneyOk && ALIASES.list.some(contains)) return { role: "list", exact: false, rank: 0 };
  if (moneyOk && ALIASES.cost.some(contains)) return { role: "cost", exact: false, rank: 0 };
  for (let rank = 0; rank < SKU_ALIASES.length; rank += 1) {
    if (SKU_ALIASES[rank].some(contains)) return { role: "sku", exact: false, rank };
  }
  for (const role of ["name", "description", "manufacturer", "unit"] as const) {
    if (ALIASES[role].some(contains)) return { role, exact: false, rank: 0 };
  }
  if (moneyOk && /\bprice\b/.test(normalized)) return { role: "generic", exact: false, rank: 0 };
  return null;
}

function headerScore(cells: string[]): number {
  return cells.reduce((score, cell) => score + (guessRole(normalizeHeader(cell)) ? 1 : 0), 0);
}

// Supplier sheets often start with a logo row, a title and an "effective"
// line before the real headers. The header is the first of the opening
// rows that reads like one.
export function findHeaderRow(rows: { cells: string[] }[]): number | null {
  const limit = Math.min(rows.length, 25);
  for (let index = 0; index < limit; index += 1) {
    if (headerScore(rows[index].cells) >= 2) return index;
  }
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function detectRoles(headers: string[], sampleRows: string[][] = []): ColumnRole[] {
  const normalized = headers.map(normalizeHeader);
  const guesses = normalized.map(guessRole);
  const roles: ColumnRole[] = headers.map(() => "skip");
  const columnMedian = (index: number) =>
    median(
      sampleRows
        .map((cells) => parseMoney(cells[index] ?? "").cents)
        .filter((cents): cents is number => cents !== null && cents > 0),
    );

  // Plain roles: the exact header wins over a looser one, then the
  // better-ranked alias, then the leftmost column.
  const pick = (role: DetectableRole) => {
    const candidates = guesses
      .map((guess, index) => ({ guess, index }))
      .filter(({ guess, index }) => guess?.role === role && roles[index] === "skip")
      .sort((a, b) => a.guess!.rank - b.guess!.rank || Number(b.guess!.exact) - Number(a.guess!.exact) || a.index - b.index);
    if (candidates[0]) roles[candidates[0].index] = role;
  };
  for (const role of ["sku", "name", "description", "manufacturer", "unit", "tag"] as const) pick(role);

  // Money. Every column that could be your cost competes: a "New Price"
  // beats any other, then the lowest typical amount (what you pay is
  // below what they suggest you charge). An explicit MSRP column is the
  // MSRP; failing that, the next price column up is.
  // A column only gets a money role when its cells mostly read as money
  // ("Price Notes" full of words doesn't).
  const readsAsMoney = (index: number) => {
    const values = sampleRows.map((cells) => (cells[index] ?? "").trim()).filter(Boolean);
    if (values.length === 0) return true;
    return values.filter((value) => parseMoney(value).cents !== null).length / values.length >= 0.5;
  };
  const moneyColumns = guesses
    .map((guess, index) => ({ guess, index }))
    .filter(
      ({ guess, index }) =>
        roles[index] === "skip" &&
        (guess?.role === "cost" || guess?.role === "generic" || guess?.role === "list") &&
        readsAsMoney(index),
    );
  const listExplicit = moneyColumns.filter(({ guess }) => guess!.role === "list");
  const costCandidates = moneyColumns.filter(({ guess }) => guess!.role !== "list");
  const ranked = costCandidates
    .map(({ guess, index }) => ({
      index,
      generic: guess!.role === "generic",
      newer: NEWER.test(normalized[index]),
      median: columnMedian(index),
    }))
    .sort(
      (a, b) =>
        Number(b.newer) - Number(a.newer) ||
        (a.median ?? Number.MAX_SAFE_INTEGER) - (b.median ?? Number.MAX_SAFE_INTEGER) ||
        Number(a.generic) - Number(b.generic) ||
        a.index - b.index,
    );
  if (ranked[0]) roles[ranked[0].index] = "cost";
  if (listExplicit[0]) {
    roles[listExplicit.sort((a, b) => Number(b.guess!.exact) - Number(a.guess!.exact) || a.index - b.index)[0].index] = "list";
  } else {
    const costMedian = ranked[0]?.median ?? null;
    const higher = ranked
      .slice(1)
      .filter((column) => column.generic && column.median !== null && (costMedian === null || column.median > costMedian));
    if (higher[0]) roles[higher[0].index] = "list";
  }

  const tagColumn = guesses.findIndex((guess, index) => guess?.role === "maybeTag" && roles[index] === "skip");
  if (tagColumn >= 0 && !roles.includes("tag")) {
    const values = sampleRows.map((cells) => (cells[tagColumn] ?? "").trim()).filter(Boolean);
    const tags = values.filter((value) => !parseTag(value).note).length;
    if (values.length > 0 && tags / values.length >= 0.5) roles[tagColumn] = "tag";
  }
  return roles;
}

export type TabLayout = {
  sheetIndex: number;
  name: string;
  headerIndex: number;
  headers: string[];
  roles: ColumnRole[];
  dataRows: number;
  // Ticked tabs import. A tab named Discontinued / Read Me starts unticked.
  included: boolean;
};

// Whole tab names, or the words that mean it: "Discontinued Items" and
// "EOL" are left out, "Coverage Plans" and "Wall Plates & Covers" are not.
const SKIPPED_TAB =
  /discontinu|obsolete|\beol\b|end[- ]of[- ]life|supersed|^\s*(read ?me|instructions|notes|cover( sheet| page)?|terms( (and|&) conditions)?)\s*$/i;

export function headerSignature(headers: string[]) {
  return headers.map(normalizeHeader).join("|");
}

// Every tab with something that reads like a header row, each with its
// own columns read. `remembered` is how this supplier's sheets were read
// last time, by header signature, so a fix made once sticks.
export function detectTabs(
  sheets: SheetTable[],
  remembered: Record<string, ColumnRole[]> = {},
): TabLayout[] {
  const tabs: TabLayout[] = [];
  sheets.forEach((sheet, sheetIndex) => {
    const headerIndex = findHeaderRow(sheet.rows);
    if (headerIndex === null) return;
    const headers = (sheet.rows[headerIndex]?.cells ?? []).map((cell) => cell.trim());
    const samples = sheet.rows.slice(headerIndex + 1, headerIndex + 41).map((row) => row.cells);
    const saved = remembered[headerSignature(headers)];
    const roles = saved && saved.length === headers.length ? saved : detectRoles(headers, samples);
    tabs.push({
      sheetIndex,
      name: sheet.name,
      headerIndex,
      headers,
      roles,
      dataRows: Math.max(0, sheet.rows.length - headerIndex - 1),
      included: sheets.length === 1 || !SKIPPED_TAB.test(sheet.name),
    });
  });
  if (tabs.length > 0 && !tabs.some((tab) => tab.included)) tabs[0].included = true;
  return tabs;
}

// A role picked by hand: one column per role within a tab (the column it
// moved from goes back to "Don't import"), and the same change made on
// every other tab with the same headers.
export function setRole(tabs: TabLayout[], sheetIndex: number, column: number, role: ColumnRole): TabLayout[] {
  const source = tabs.find((tab) => tab.sheetIndex === sheetIndex);
  if (!source) return tabs;
  const signature = headerSignature(source.headers);
  return tabs.map((tab) => {
    if (headerSignature(tab.headers) !== signature) return tab;
    return {
      ...tab,
      roles: tab.roles.map((current, position) => {
        if (position === column) return role;
        if (role !== "skip" && current === role) return "skip";
        return current;
      }),
    };
  });
}

// Pulls a "who sent this" guess and an "effective" date out of the file
// name and the rows above the header ("ADI — Price list effective
// 1/1/2027").
export function guessSupplier(
  fileName: string,
  sheets: SheetTable[],
  tabs: TabLayout[],
  suppliers: { id: string; name: string }[],
): string | null {
  const preface = tabs
    .flatMap((tab) => sheets[tab.sheetIndex].rows.slice(0, tab.headerIndex).flatMap((row) => row.cells))
    .join(" ");
  const haystack = ` ${normalizeHeader(`${fileName.replace(/\.[^.]+$/, "")} ${preface}`)} `;
  const hits = suppliers
    .map((supplier) => ({ supplier, key: normalizeHeader(supplier.name) }))
    .filter(({ key }) => key.length >= 2 && haystack.includes(` ${key} `))
    .sort((a, b) => b.key.length - a.key.length);
  return hits[0]?.supplier.id ?? null;
}

export function guessEffectiveDate(sheets: SheetTable[], tabs: TabLayout[]): string | null {
  for (const tab of tabs) {
    for (const row of sheets[tab.sheetIndex].rows.slice(0, tab.headerIndex)) {
      for (const cell of row.cells) {
        const iso = cell.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        const us = cell.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);
        if (us) {
          const year = us[3].length === 2 ? `20${us[3]}` : us[3];
          const month = us[1].padStart(2, "0");
          const day = us[2].padStart(2, "0");
          if (Number(month) <= 12 && Number(day) <= 31) return `${year}-${month}-${day}`;
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------
// Money
// ------------------------------------------------------------------

// "$1,234.50", "1234.5", "1.234,50", "12,50". Blank is null with no
// complaint; anything that isn't a plain non-negative amount ("Call",
// "N/A", "-", "(12.00)", "#N/A") is null *and* flagged, so a "Call for
// price" row can never be read as $0.
export function parseMoney(raw: string): { cents: number | null; bad: boolean } {
  let text = raw.trim();
  if (!text) return { cents: null, bad: false };
  text = text.replace(/\b(usd|cad|us)\b/gi, "").replace(/[$€£\s]/g, "");
  if (!text) return { cents: null, bad: false };

  let plain: string;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) || /^\d+(\.\d+)?$/.test(text) || /^\.\d+$/.test(text)) {
    plain = text.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) {
    plain = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(text)) {
    plain = text.replace(",", ".");
  } else {
    return { cents: null, bad: true };
  }
  const value = Number(plain);
  if (!Number.isFinite(value)) return { cents: null, bad: true };
  // toFixed first so 1.005 rounds to 101 cents, not 100.
  const cents = Math.round(Number((value * 100).toFixed(6)));
  if (cents > MAX_CENTS) return { cents: null, bad: true };
  return { cents, bad: false };
}

export function percentToBasisPoints(raw: string): number | null {
  const text = raw.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export function basisPointsToPercent(bp: number): string {
  const value = bp / 100;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function priceFromRule(
  rule: PriceRuleKind,
  basisPoints: number,
  costCents: number | null,
  listCents: number | null,
): number | null {
  if (rule === "LIST") {
    if (listCents === null) return null;
    return Math.round((listCents * (10_000 - basisPoints)) / 10_000);
  }
  if (costCents === null) return null;
  if (rule === "MARKUP") return Math.round((costCents * (10_000 + basisPoints)) / 10_000);
  if (basisPoints >= 10_000) return null;
  return Math.round((costCents * 10_000) / (10_000 - basisPoints));
}

// Both read straight off cost and price, so they always agree with each
// other and with whatever the person typed.
export function marginPercent(costCents: number, priceCents: number): number | null {
  if (priceCents <= 0) return null;
  return ((priceCents - costCents) / priceCents) * 100;
}

export function markupPercent(costCents: number, priceCents: number): number | null {
  if (costCents <= 0) return null;
  return ((priceCents - costCents) / costCents) * 100;
}

export function pricingError(options: PricingOptions): string | null {
  const bp = options.basisPoints;
  if (!Number.isInteger(bp) || bp < 0) return "Type a percentage of 0 or more.";
  if (options.rule === "MARKUP" && bp > MAX_MARKUP_BP) return "Markup has to be 1,000% or less.";
  if (options.rule === "MARGIN" && bp > MAX_MARGIN_BP) return "Margin has to be 95% or less.";
  if (options.rule === "LIST" && bp > 9900) return "The discount off MSRP has to be under 100%.";
  return null;
}

export function describeRule(options: Pick<PricingOptions, "rule" | "basisPoints">): string {
  const pct = `${basisPointsToPercent(options.basisPoints)}%`;
  if (options.rule === "MARKUP") return `${pct} markup on your cost`;
  if (options.rule === "MARGIN") return `${pct} margin`;
  return options.basisPoints === 0 ? "Sell at their MSRP" : `${pct} off their MSRP`;
}

// ------------------------------------------------------------------
// Matching against the catalog
// ------------------------------------------------------------------

// "HID-5355", "hid 5355" and "HID_5355" are one part; so are "012345" and
// the 12345 Excel leaves when it reads a part number as a number. A dot or
// a slash is part of the number: FUSE-1.5A is not FUSE-15A, and CPL-1/2 is
// not CPL-12.
export function skuKey(sku: string) {
  const key = sku.trim().toLowerCase().replace(/[\s\-_]+/g, "");
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key;
}

// "N/A", "TBD", "-" in the part number column mean there isn't one; read
// as a part number they would make every such row the same part.
export function placeholderSku(sku: string) {
  return /^(n\/?a|n\.a\.?|none|tbd|tba|null|nil|-+|—|\?+|\.+|x+|0+)$/i.test(sku.trim());
}

// Excel turns a long all-digit part number into 1.23457E+11; what is
// left is no longer the part number.
function damagedSku(sku: string) {
  return /^\d(\.\d+)?e\+?\d+$/i.test(sku.trim());
}

function nameKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildCatalogIndex(catalog: CatalogItem[]) {
  const bySku = new Map<string, CatalogItem[]>();
  const byName = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    if (item.sku && !placeholderSku(item.sku)) {
      const key = skuKey(item.sku);
      bySku.set(key, [...(bySku.get(key) ?? []), item]);
    }
    const key = nameKey(item.name);
    byName.set(key, [...(byName.get(key) ?? []), item]);
  }
  return { bySku, byName };
}
type CatalogIndex = ReturnType<typeof buildCatalogIndex>;

// SKU first. A name match only counts when it can't be a different part:
// never when both sides carry a SKU and they differ, and never when the
// name is shared by more than one product.
// When two products share a part number (bought from two suppliers),
// the one already bought from this supplier is the one this sheet
// updates.
function findMatch(
  index: CatalogIndex,
  sku: string | null,
  name: string,
  supplierId: string | null,
): { item: CatalogItem | null; by: "sku" | "name" | null; ambiguous: boolean } {
  if (sku) {
    const bySku = index.bySku.get(skuKey(sku)) ?? [];
    const exact = bySku.find((item) => supplierId && item.distributorId === supplierId) ?? bySku[0];
    if (exact) return { item: exact, by: "sku", ambiguous: false };
  }
  const named = (index.byName.get(nameKey(name)) ?? []).filter(
    (item) => !(sku && item.sku && !placeholderSku(item.sku) && skuKey(item.sku) !== skuKey(sku)),
  );
  if (named.length > 1) return { item: null, by: null, ambiguous: true };
  if (named.length === 1) return { item: named[0], by: "name", ambiguous: false };
  return { item: null, by: null, ambiguous: false };
}

// ------------------------------------------------------------------
// The plan
// ------------------------------------------------------------------

export type PriceSource = "typed" | "file" | "rule" | "margin" | "kept" | "none";
export type CostChange = "up" | "down" | "same" | "new" | "none";

export type PlanRow = {
  // "<tab>:<line>" — stable across re-plans, so ticks and typed prices
  // stick when the person changes the rule.
  key: string;
  tab: string;
  line: number;
  name: string;
  sku: string | null;
  description: string;
  manufacturer: string | null;
  defaultTag: LineItemTagValue;
  unitOfMeasure: UnitOfMeasureValue | null;
  // Cells as read from the sheet; null when blank or unreadable.
  costCents: number | null;
  listCents: number | null;
  fileSellCents: number | null;
  match: { id: string; name: string; by: "sku" | "name" } | null;
  // The supplier an existing product is bought from today, when that is
  // not the one this sheet came from.
  otherSupplier: string | null;
  oldCostCents: number | null;
  oldPriceCents: number | null;
  newCostCents: number;
  newPriceCents: number | null;
  priceSource: PriceSource;
  costChange: CostChange;
  bigChange: boolean;
  belowCost: boolean;
  aboveList: boolean;
  // Why a row starts unticked, if it does.
  holdReason: string | null;
  // False when the row can't come in at all until something changes (a
  // new product with no sell price; a second row for the same product).
  importable: boolean;
  included: boolean;
  notes: string[];
};

export type RatesheetPlan = {
  rows: PlanRow[];
  // Rows read but never shown: blank lines and section headings.
  skippedBlank: number;
  skippedDuplicates: number;
  truncated: number;
  // Products bought from this supplier that this sheet doesn't list.
  // Only worked out when nothing was cut off; an item on any tab counts.
  missing: { id: string; name: string; sku: string | null }[] | null;
  counts: {
    included: number;
    newProducts: number;
    updates: number;
    costUp: number;
    costDown: number;
    held: number;
    belowCost: number;
    aboveList: number;
    tooManyNew: number;
  };
};

export type PlanInput = {
  sheets: SheetTable[];
  tabs: TabLayout[];
  catalog: CatalogItem[];
  // The Distributor this sheet came from; null while it is still being
  // created ("+ Add New Distributor").
  supplierId: string | null;
  pricing: PricingOptions;
  // Sell prices typed into the preview, by row key.
  overrides?: Record<string, number>;
  // Row keys the person unticked, and held rows they ticked.
  excluded?: string[];
  forced?: string[];
  // On the server: exactly the rows the person had ticked. Nothing else
  // imports, whatever the defaults would say against today's catalog.
  selected?: string[];
};

export function rowKey(sheetIndex: number, line: number) {
  return `${sheetIndex}:${line}`;
}

export function planRatesheet(input: PlanInput): RatesheetPlan {
  const { pricing } = input;
  const overrides = input.overrides ?? {};
  const excluded = new Set(input.excluded ?? []);
  const forced = new Set(input.forced ?? []);
  const selected = input.selected ? new Set(input.selected) : null;
  const index = buildCatalogIndex(input.catalog);

  const seen = new Set<string>();
  // Product id → the line that already claimed it.
  const matched = new Map<string, string>();
  const rows: PlanRow[] = [];
  let skippedBlank = 0;
  let skippedDuplicates = 0;
  let truncated = 0;
  let budget = MAX_ROWS_READ;
  let newRows = 0;
  const tabs = input.tabs.filter((tab) => tab.included);

  for (const tab of tabs) {
    const sheet = input.sheets[tab.sheetIndex];
    if (!sheet) continue;
    const at = (role: ColumnRole) => tab.roles.indexOf(role);
    const col = {
      name: at("name"),
      sku: at("sku"),
      description: at("description"),
      cost: at("cost"),
      list: at("list"),
      sell: at("sell"),
      manufacturer: at("manufacturer"),
      unit: at("unit"),
      tag: at("tag"),
    };
    const dataRows = sheet.rows.slice(tab.headerIndex + 1);
    if (dataRows.length > budget) truncated += dataRows.length - budget;

    for (const { line, cells } of dataRows.slice(0, budget)) {
      budget -= 1;
      const cell = (position: number) => (position < 0 ? "" : (cells[position] ?? "").trim());
      const rawSku = placeholderSku(cell(col.sku)) ? "" : cell(col.sku).slice(0, 60);
      const skuDamaged = rawSku !== "" && damagedSku(rawSku);
      const sku = rawSku || null;
      let description = cell(col.description).slice(0, 2000);
      // Supplier sheets are often just "Part # | Description | Price": the
      // description is the product's name then, and a bare part number is
      // better than nothing.
      let name = cell(col.name);
      if (!name && description) {
        name = description;
        description = "";
      }
      if (!name && sku) name = sku;
      name = name.slice(0, 160);

      const cost = parseMoney(cell(col.cost));
      const list = parseMoney(cell(col.list));
      const sell = parseMoney(cell(col.sell));

      // A row with no name, or one filled cell and no price, is a blank
      // line or a section heading ("Card Readers") in the middle of the
      // sheet — whichever column the heading happens to sit in.
      const anyPriceCell = [cost, list, sell].some((money) => money.cents !== null || money.bad);
      const filled = cells.filter((value) => value.trim() !== "").length;
      if (!name || (!anyPriceCell && filled <= 1)) {
        skippedBlank += 1;
        continue;
      }

      const dupKey = sku && !skuDamaged ? `sku:${skuKey(sku)}` : `name:${nameKey(name)}`;
      if (seen.has(dupKey)) {
        skippedDuplicates += 1;
        continue;
      }
      seen.add(dupKey);

      const notes: string[] = [];
      if (cost.bad) notes.push(`Cost reads "${cell(col.cost)}", not a price`);
      if (list.bad) notes.push(`MSRP reads "${cell(col.list)}", not a price`);
      if (sell.bad) notes.push(`Sell price reads "${cell(col.sell)}", not a price`);
      if (skuDamaged) notes.push(`Excel turned this part number into ${rawSku}; it can't be matched`);

      const tag = parseTag(cell(col.tag));
      if (tag.note && cell(col.tag)) notes.push(tag.note);
      const unit = parseUnit(cell(col.unit), tag.tag);
      if (unit.note) notes.push(unit.note);

      const found = findMatch(index, skuDamaged ? null : sku, name, input.supplierId);
      const match = found.item;
      if (found.ambiguous) notes.push("More than one product already has this name, so this comes in as a new one");
      // Two rows of this sheet landing on the same product (a part number
      // written two ways): the first one has it, and the second can't be
      // ticked, so one product is never written twice.
      const sameAs = match ? (matched.get(match.id) ?? null) : null;
      if (match && !sameAs) matched.set(match.id, `${tab.name} line ${line}`);

      const otherSupplier =
        match && match.distributorId && match.distributorId !== input.supplierId
          ? (match.distributorName ?? "another supplier")
          : null;

      // A cost only counts when it is a real amount above zero. "Call",
      // "N/A", a dash or $0.00 leaves an existing product's cost where it
      // is.
      const usableCost = cost.cents !== null && cost.cents > 0 ? cost.cents : null;
      const usableList = list.cents !== null && list.cents > 0 ? list.cents : null;
      if (cost.cents === 0) notes.push("Cost is $0 on the sheet — left as it was");
      const costDecimals = cell(col.cost).match(/\.(\d+)/)?.[1] ?? "";
      if (usableCost !== null && costDecimals.length > 2 && usableCost < 100) {
        notes.push(`Cost ${cell(col.cost)} rounds to ${dollars(usableCost)} — this item may be priced per 100 or per 1,000`);
      }

      const oldCost = match ? match.costCents : null;
      const oldPrice = match ? match.unitPriceCents : null;
      const newCost = usableCost ?? oldCost ?? 0;
      const listForRule = usableList ?? match?.listPriceCents ?? null;

      let costChange: CostChange;
      if (!match) costChange = "new";
      else if (usableCost === null) costChange = "none";
      else if (usableCost > (oldCost ?? 0)) costChange = "up";
      else if (usableCost < (oldCost ?? 0)) costChange = "down";
      else costChange = "same";

      const bigChange =
        !!match &&
        usableCost !== null &&
        oldCost !== null &&
        oldCost > 0 &&
        (usableCost / oldCost > BIG_CHANGE_RATIO || oldCost / usableCost > BIG_CHANGE_RATIO);

      const fromRule = priceFromRule(pricing.rule, pricing.basisPoints, usableCost ?? oldCost, listForRule);
      const typed = overrides[rowKey(tab.sheetIndex, line)];
      let newPrice: number | null;
      let priceSource: PriceSource;

      if (typed !== undefined && Number.isInteger(typed) && typed >= 0 && typed <= MAX_CENTS) {
        newPrice = typed;
        priceSource = "typed";
      } else if (sell.cents !== null && sell.cents > 0) {
        newPrice = sell.cents;
        priceSource = "file";
      } else if (!match) {
        newPrice = fromRule;
        priceSource = fromRule === null ? "none" : "rule";
      } else {
        let mode: ExistingMode | null =
          costChange === "up" ? pricing.whenCostUp : costChange === "down" ? pricing.whenCostDown : null;
        // Selling at MSRP: a new MSRP is the price change, and keeping a
        // margin means nothing when the price is theirs.
        const listChanged = usableList !== null && usableList !== match.listPriceCents;
        if (pricing.rule === "LIST") {
          if (mode === "MARGIN") mode = "RULE";
          if (mode === null && listChanged) mode = "RULE";
        }
        if (mode === "RULE") {
          newPrice = fromRule ?? oldPrice;
          priceSource = fromRule === null ? "kept" : "rule";
        } else if (mode === "MARGIN" && oldCost && oldPrice && oldCost > 0 && oldPrice >= oldCost) {
          // Keep my margin: the price moves by the same proportion the
          // cost did, which holds both the margin and the markup where
          // they were.
          newPrice = Math.round((oldPrice * newCost) / oldCost);
          priceSource = "margin";
        } else if (mode === "MARGIN" && fromRule !== null && !(oldPrice && oldPrice > 0)) {
          // Nothing to keep yet (the product had no price): use the rule.
          newPrice = fromRule;
          priceSource = "rule";
        } else {
          newPrice = oldPrice;
          priceSource = "kept";
        }
        // A price at or below the new cost is never what anyone meant to
        // keep — it is usually the old importer's footprint, which put
        // the supplier's price in the sell price and left COGS at $0.
        if (priceSource === "kept" && newPrice !== null && newPrice <= newCost && fromRule !== null && fromRule > newCost) {
          notes.push(`Your price ${dollars(newPrice)} was at or below the new cost, so it was re-priced`);
          newPrice = fromRule;
          priceSource = "rule";
        }
      }
      if (newPrice !== null && newPrice > MAX_CENTS) {
        notes.push("That sell price is too large — type one");
        newPrice = null;
        priceSource = "none";
      }

      let holdReason: string | null = null;
      if (sameAs) {
        holdReason = `Same product as ${sameAs}`;
      } else if (!match && usableCost === null && usableList === null && sell.cents === null) {
        holdReason = "No price on the sheet";
      } else if (!match && newPrice === null) {
        holdReason = pricing.rule === "LIST" ? "No MSRP — type a sell price" : "Needs a sell price";
      } else if (bigChange) {
        holdReason = `Cost was ${dollars(oldCost!)}, now ${dollars(usableCost!)} — check the unit`;
      }
      let overLimit = false;
      if (!match && holdReason === null && !sameAs) {
        newRows += 1;
        if (newRows > MAX_NEW_PRODUCTS) {
          overLimit = true;
          holdReason = `Past the ${MAX_NEW_PRODUCTS.toLocaleString("en-US")} new-product limit for one sheet`;
        }
      }
      if (otherSupplier) notes.push(`Bought from ${otherSupplier} today; this moves it to this supplier`);
      if (match && found.by === "name") notes.push(`Matched by name to "${match.name}"`);
      if (match && !match.active) notes.push("This product is inactive in your catalog");

      const key = rowKey(tab.sheetIndex, line);
      // A new product with no sell price would land at $0, so it can't
      // come in until one is typed. A typed price is the person saying
      // "bring this in".
      const importable = !sameAs && !overLimit && (newPrice !== null || !!match);
      let included: boolean;
      if (selected) included = importable && selected.has(key);
      else if (excluded.has(key)) included = false;
      else if (forced.has(key) || priceSource === "typed") included = importable;
      else included = importable && holdReason === null;
      const belowCost = newPrice !== null && newPrice < newCost;
      const aboveList = newPrice !== null && listForRule !== null && newPrice > listForRule;

      rows.push({
        key,
        tab: tab.name,
        line,
        name,
        sku,
        description,
        manufacturer: cell(col.manufacturer).slice(0, 120) || null,
        defaultTag: tag.tag,
        unitOfMeasure: unit.unit,
        costCents: usableCost,
        listCents: usableList,
        fileSellCents: sell.cents,
        match: match && found.by ? { id: match.id, name: match.name, by: found.by } : null,
        otherSupplier,
        oldCostCents: oldCost,
        oldPriceCents: oldPrice,
        newCostCents: newCost,
        newPriceCents: newPrice,
        priceSource,
        costChange,
        bigChange,
        belowCost,
        aboveList,
        holdReason,
        importable,
        included,
        notes,
      });
    }
  }

  // "Not on this sheet anymore" counts an item listed on any tab as on the
  // sheet, ticked or not — a Discontinued tab left out still lists it.
  let missing: RatesheetPlan["missing"] = null;
  if (input.supplierId && truncated === 0) {
    const onSheet = new Set(matched.keys());
    for (const tab of input.tabs.filter((candidate) => !candidate.included)) {
      const sheet = input.sheets[tab.sheetIndex];
      if (!sheet) continue;
      const skuAt = tab.roles.indexOf("sku");
      const nameAt = tab.roles.indexOf("name") >= 0 ? tab.roles.indexOf("name") : tab.roles.indexOf("description");
      for (const { cells } of sheet.rows.slice(tab.headerIndex + 1)) {
        const rawSku = skuAt >= 0 ? (cells[skuAt] ?? "").trim() : "";
        const sku = placeholderSku(rawSku) ? "" : rawSku;
        const name = nameAt >= 0 ? (cells[nameAt] ?? "").trim() : "";
        if (!sku && !name) continue;
        const found = findMatch(index, sku && !damagedSku(sku) ? sku : null, name || sku, input.supplierId);
        if (found.item) onSheet.add(found.item.id);
      }
    }
    missing = input.catalog
      .filter((item) => item.distributorId === input.supplierId && item.active && !onSheet.has(item.id))
      .map((item) => ({ id: item.id, name: item.name, sku: item.sku }));
  }

  const ticked = rows.filter((row) => row.included);
  return {
    rows,
    skippedBlank,
    skippedDuplicates,
    truncated,
    missing,
    counts: {
      included: ticked.length,
      newProducts: ticked.filter((row) => !row.match).length,
      updates: ticked.filter((row) => row.match).length,
      costUp: ticked.filter((row) => row.costChange === "up").length,
      costDown: ticked.filter((row) => row.costChange === "down").length,
      held: rows.filter((row) => !row.included && row.holdReason).length,
      belowCost: ticked.filter((row) => row.belowCost).length,
      aboveList: ticked.filter((row) => row.aboveList).length,
      tooManyNew: Math.max(0, newRows - MAX_NEW_PRODUCTS),
    },
  };
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
