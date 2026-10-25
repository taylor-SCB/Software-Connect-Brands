"use client";

import { useActionState, useState } from "react";
import { Field, FormError, FormSuccess, Card, CardHeader, TagBadge } from "@/components/ui";
import { IconSearch } from "@/components/icons";
import { formatCents } from "@/lib/format";
import {
  RATESHEET_VISIBILITIES,
  RATESHEET_VISIBILITY_LABELS,
  type RatesheetVisibilityValue,
  type LineItemTagValue,
} from "@/lib/constants";
import type { ActionState } from "@/lib/forms";
import { useSearch } from "@/lib/use-search";

export type PickerProduct = {
  id: string;
  name: string;
  sku: string | null;
  unitPriceCents: number;
  defaultTag: string;
  active: boolean;
};

export type RatesheetFormDefaults = {
  id?: string;
  name?: string;
  visibility?: string;
  expiresOn?: string;
  respondWithinDays?: number | null;
  productIds?: string[];
};

const VISIBILITY_BLURBS: Record<RatesheetVisibilityValue, string> = {
  PUBLIC: "Anyone in the system can search it and link it until it expires.",
  INVITE_APPROVE: "Searchable, but linking it sends you a request to approve or decline.",
  PARTNER_SPECIFIC: "Sent to one email address, which approves or declines it.",
};

const VISIBILITY_NOTES: Partial<Record<RatesheetVisibilityValue, string>> = {
  PUBLIC: "Searching other workspaces' sheets isn't live yet — share the link from the sheet's page meanwhile.",
  INVITE_APPROVE: "Searching other workspaces' sheets isn't live yet — send links from the sheet's page meanwhile.",
  PARTNER_SPECIFIC: "Nothing is emailed yet: you get a link to copy and send yourself.",
};

// Searching the catalog, 50 matches at a time, instead of being handed
// all of it: a distributor's sheet can bring in tens of thousands.
const SHOWN = 50;
// The most products one ratesheet holds (ratesheets/actions.ts).
const RATESHEET_MAX = 2000;

export function RatesheetForm({
  action,
  productTotal,
  selectedProducts = [],
  defaults,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  // How many products the workspace has, for "3 of 1,240 selected".
  productTotal: number;
  // The products already on the sheet, so they show ticked by name.
  selectedProducts?: PickerProduct[];
  defaults?: RatesheetFormDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const editing = !!defaults?.id;

  const [visibility, setVisibility] = useState<RatesheetVisibilityValue>(
    (defaults?.visibility as RatesheetVisibilityValue | undefined) ?? "PARTNER_SPECIFIC",
  );
  const [query, setQuery] = useState("");
  const needle = query.trim();
  const searchUrl = (params: string) => `/dashboard/products/search?q=${encodeURIComponent(needle)}${params}`;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaults?.productIds ?? []));
  const { results, loading } = useSearch<PickerProduct>(searchUrl(`&take=${SHOWN}`));
  // "Show 50 more" pages for the search on screen; a new search starts over.
  const [more, setMore] = useState<{ query: string; rows: PickerProduct[]; pages: number; done: boolean }>({
    query: "",
    rows: [],
    pages: 0,
    done: false,
  });
  const extra = more.query === needle ? more : { query: needle, rows: [], pages: 0, done: false };
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Every product seen so far, so a ticked one keeps its name and price
  // after the search moves on.
  const [known, setKnown] = useState<Map<string, PickerProduct>>(
    () => new Map(selectedProducts.map((product) => [product.id, product])),
  );
  function remember(product: PickerProduct) {
    if (!known.has(product.id)) setKnown((current) => new Map(current).set(product.id, product));
  }
  function rememberAll(rows: PickerProduct[]) {
    setKnown((current) => {
      const next = new Map(current);
      for (const row of rows) next.set(row.id, row);
      return next;
    });
  }
  // With no search, what is ticked comes first, then the catalog from the
  // top; with a search, just what matches. Each product once.
  const ticked = needle
    ? []
    : [...selected].map((id) => known.get(id)).filter((product): product is PickerProduct => Boolean(product));
  const listedIds = new Set<string>();
  const filtered = [...ticked, ...results, ...extra.rows].filter((product) =>
    listedIds.has(product.id) ? false : (listedIds.add(product.id), true),
  );
  const moreToShow = !extra.done && results.length >= SHOWN;

  async function fetchRows(params: string): Promise<PickerProduct[]> {
    const response = await fetch(searchUrl(params), { credentials: "same-origin" });
    return response.ok ? ((await response.json()) as PickerProduct[]) : [];
  }
  async function showMore() {
    setBusy(true);
    try {
      const page = await fetchRows(`&take=${SHOWN}&skip=${SHOWN * (extra.pages + 1)}`);
      setMore({ query: needle, rows: [...extra.rows, ...page], pages: extra.pages + 1, done: page.length < SHOWN });
    } finally {
      setBusy(false);
    }
  }
  // Every match, not just the ones on screen, up to what a ratesheet holds:
  // ticking only the shown 50 left the rest of a catalog out of reach.
  async function selectAll() {
    setBusy(true);
    setNotice(null);
    try {
      const rows = await fetchRows("&all=1");
      rememberAll(rows);
      setSelected((current) => {
        const next = new Set(current);
        for (const row of rows) next.add(row.id);
        return next;
      });
      if (rows.length >= RATESHEET_MAX) {
        setNotice(
          `A ratesheet holds up to ${RATESHEET_MAX.toLocaleString()} products, so the first ${RATESHEET_MAX.toLocaleString()} ${needle ? "matches" : "in your catalog"} are ticked.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function clearAll() {
    setNotice(null);
    if (!needle) {
      setSelected(new Set());
      return;
    }
    setBusy(true);
    try {
      const rows = await fetchRows("&all=1");
      setSelected((current) => {
        const next = new Set(current);
        for (const row of rows) next.delete(row.id);
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function toggle(product: PickerProduct) {
    remember(product);
    const id = product.id;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      {defaults?.id && <input type="hidden" name="ratesheetId" value={defaults.id} />}
      <input type="hidden" name="visibility" value={visibility} />
      {/* Ticked products travel as repeated fields, whatever the search box
          is currently hiding. */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="productIds" value={id} />
      ))}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card lit className="lg:col-span-3">
          <CardHeader title="Ratesheet details" />
          <div className="space-y-5 p-5">
            <Field
              label="Ratesheet name"
              name="name"
              placeholder="2026 contractor pricing"
              defaultValue={defaults?.name ?? ""}
              required
            />

            <div>
              <span className="label">Who can use it</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {RATESHEET_VISIBILITIES.map((option) => {
                  const on = visibility === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setVisibility(option)}
                      aria-pressed={on}
                      className="card card-hover p-3 text-left"
                      style={
                        on
                          ? {
                              borderColor: "color-mix(in srgb, var(--brand) 55%, transparent)",
                              background: "color-mix(in srgb, var(--brand) 10%, transparent)",
                            }
                          : undefined
                      }
                    >
                      <p className="text-sm font-semibold">{RATESHEET_VISIBILITY_LABELS[option]}</p>
                      <p className="faint mt-1 text-xs leading-relaxed">{VISIBILITY_BLURBS[option]}</p>
                    </button>
                  );
                })}
              </div>
              {VISIBILITY_NOTES[visibility] && (
                <p className="muted mt-2 text-xs">{VISIBILITY_NOTES[visibility]}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Expires On"
                name="expiresOn"
                type="date"
                defaultValue={defaults?.expiresOn ?? ""}
                hint="After this date nobody can select or answer it."
              />
              {visibility !== "PUBLIC" && (
                <Field
                  label="Approved/Decline Within"
                  name="respondWithinDays"
                  type="number"
                  placeholder="14"
                  defaultValue={defaults?.respondWithinDays ?? ""}
                  hint="Days a partner has to answer once sent. Leave blank for no limit."
                />
              )}
            </div>

            {visibility === "PARTNER_SPECIFIC" && !editing && (
              <div className="rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4">
                <p className="text-sm font-semibold">Send to</p>
                <p className="faint mt-0.5 mb-3 text-xs">
                  We don&apos;t email this yet — you&apos;ll get a link to copy and text or email yourself.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Partner email"
                    name="partnerEmail"
                    type="email"
                    placeholder="buyer@partner.com"
                    required
                  />
                  <Field
                    label="Partner / company name"
                    name="partnerName"
                    placeholder="Acme Supply"
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card lit className="lg:col-span-2">
          <CardHeader
            title="Products on this sheet"
            subtitle={`${selected.size.toLocaleString()} of ${productTotal.toLocaleString()} selected · inactive products stay hidden from partners`}
          />
          <div className="space-y-3 p-4">
            <div className="relative">
              <IconSearch
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or part #…"
                aria-label="Search products"
                className="input input-sm pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={selectAll} disabled={busy || productTotal === 0} className="btn btn-ghost btn-sm">
                {needle ? "Select all matching" : `Select all ${productTotal.toLocaleString()}`}
              </button>
              <button type="button" onClick={clearAll} disabled={busy || selected.size === 0} className="btn btn-ghost btn-sm">
                {needle ? "Clear matching" : "Clear"}
              </button>
            </div>
            {notice && <p className="text-xs text-[var(--warn)]">{notice}</p>}
            {selected.size > RATESHEET_MAX && (
              <p className="text-xs text-[var(--danger)]">
                That&apos;s more than the {RATESHEET_MAX.toLocaleString()} a ratesheet holds. Untick some before saving.
              </p>
            )}

            {productTotal === 0 ? (
              <p className="faint py-6 text-center text-xs">
                No products in your catalog yet. Add some first, then build the sheet.
              </p>
            ) : filtered.length === 0 ? (
              <p className="faint py-6 text-center text-xs">{loading ? "Searching…" : "Nothing matches that search."}</p>
            ) : (
              <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
                {filtered.map((product) => {
                  const on = selected.has(product.id);
                  return (
                    <li key={product.id}>
                      <label
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2"
                        style={{
                          borderColor: on ? "color-mix(in srgb, var(--brand) 45%, transparent)" : "var(--border)",
                          background: on ? "color-mix(in srgb, var(--brand) 8%, transparent)" : "transparent",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(product)}
                          aria-label={`Include ${product.name}`}
                          className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {product.name}
                            {!product.active && <span className="faint ml-1.5 text-xs font-normal">(inactive)</span>}
                          </p>
                          <p className="faint num text-xs">{product.sku ?? "—"}</p>
                        </div>
                        <TagBadge tag={product.defaultTag as LineItemTagValue} />
                        <span className="num shrink-0 text-sm font-medium">
                          {formatCents(product.unitPriceCents)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {moreToShow && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={showMore} disabled={busy} className="btn btn-ghost btn-sm">
                  Show {SHOWN} more
                </button>
                <span className="faint text-xs">or search by name or part number</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
