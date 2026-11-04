"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IconSearch, IconX } from "@/components/icons";
import { FormError } from "@/components/ui";
import { formatCents } from "@/lib/format";
import { basisPointsToPercent, percentToBasisPoints } from "@/lib/price-list";
import {
  LINES_PER_BATCH,
  MAX_DISCOUNT_BP,
  MAX_MIN_MARKUP_BP,
  effectiveCostCents,
  minimumMarkupPriceCents,
} from "@/lib/supplier-math";
import { useSearch } from "@/lib/use-search";
import type { SheetLine } from "./files/[id]/lines/route";
import { finishRatesheetLines, prepareRatesheetLines, saveRatesheetLines } from "./lines-actions";

export type ProductListSheet = {
  id: string;
  name: string;
  supplierName: string | null;
  discountBp: number;
  minMarkupBp: number | null;
  // Null for a sheet imported before its lines were kept: read once on open.
  lineCount: number | null;
};

type Filter = "all" | "in" | "out";
const FILTER_LABELS: Record<Filter, string> = { all: "All", in: "In Products", out: "Not in Products" };
const PAGE = 50;

type Page = { total: number; counts: { all: number; in: number; out: number }; rows: SheetLine[] };

// See product list (Release 3a, Nov 4, 2026). Taylor: "a list of all the
// products that belong to that ratesheet. Here you select which products
// you want to add to your products module. You also see the cogs and msrp.
// You can also apply a cogs discount and also a required minimum markup.
// You have action buttons at the top and bottom of the pop out for cancel
// and also 'save and accept'… any box checked are then shown in your
// product's view."
//
// The list is read from the server a page at a time (a sheet holds up to
// 25,000), and ticks are kept as changes until Save and accept, which sends
// them in batches and then the sheet-wide discount and markup.
export function RatesheetProductList({
  sheet,
  initialQuery = "",
  onClose,
}: {
  sheet: ProductListSheet;
  initialQuery?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(sheet.lineCount !== null);
  const [lineCount, setLineCount] = useState(sheet.lineCount ?? 0);
  const [prepareError, setPrepareError] = useState("");

  const [discountText, setDiscountText] = useState(sheet.discountBp ? basisPointsToPercent(sheet.discountBp) : "");
  const [markupText, setMarkupText] = useState(sheet.minMarkupBp ? basisPointsToPercent(sheet.minMarkupBp) : "");
  const discountBp = discountText.trim() === "" ? 0 : percentToBasisPoints(discountText);
  const markupBp = markupText.trim() === "" ? null : percentToBasisPoints(markupText);
  const discountProblem =
    discountBp === null || discountBp > MAX_DISCOUNT_BP ? "Type the discount as a percentage under 95, like 10." : "";
  const markupProblem =
    markupText.trim() !== "" && (markupBp === null || markupBp > MAX_MIN_MARKUP_BP)
      ? "Type the minimum markup as a percentage, like 25."
      : "";

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const [pages, setPages] = useState(1);
  // What changes on Save and accept: line id → in Products or not.
  const [changes, setChanges] = useState<Map<string, boolean>>(() => new Map());
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string[] | null>(null);
  const [selecting, setSelecting] = useState(false);

  // Older sheets: their lines are read from the stored file once.
  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    prepareRatesheetLines(sheet.id)
      .then((answer) => {
        if (cancelled) return;
        if (answer.ok) {
          setLineCount(answer.lineCount);
          setReady(true);
        } else setPrepareError(answer.error);
      })
      .catch(() => !cancelled && setPrepareError("Couldn't read this sheet. Check your connection and open it again."));
    return () => {
      cancelled = true;
    };
  }, [ready, sheet.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  // Bumped after a save that stopped part-way, so every row is read again
  // as it now is: the batches that went through changed what's in Products.
  const [version, setVersion] = useState(0);
  const base = `/dashboard/products/ratesheets/files/${sheet.id}/lines?q=${encodeURIComponent(query.trim())}&filter=${filter}&v=${version}`;
  const pageUrls = Array.from({ length: pages }, (_, index) => `${base}&skip=${index * PAGE}&take=${PAGE}`);
  // Each page is its own search, so "Show 50 more" adds one without
  // reloading the ones on screen.
  const first = useSearch<Page>(ready ? pageUrls[0] : null, 200);
  const rest = useMorePages(ready ? pageUrls.slice(1) : []);
  const firstPage = first.results as unknown as Page | Page[] | undefined;
  const page0 = Array.isArray(firstPage) ? null : (firstPage ?? null);
  const rows = [...(page0?.rows ?? []), ...rest.flatMap((page) => page.rows)];
  const total = page0?.total ?? 0;
  const counts = page0?.counts ?? { all: 0, in: 0, out: 0 };

  // Back to one page when the search or the filter changes.
  const [seenSearch, setSeenSearch] = useState(base);
  if (base !== seenSearch) {
    setSeenSearch(base);
    setPages(1);
  }

  const checked = (line: SheetLine) => changes.get(line.id) ?? line.inProducts;
  function toggle(line: SheetLine) {
    setChanges((current) => {
      const next = new Map(current);
      const wanted = !checked(line);
      if (wanted === line.inProducts) next.delete(line.id);
      else next.set(line.id, wanted);
      return next;
    });
  }
  async function setAllMatching(inProducts: boolean) {
    setSelecting(true);
    try {
      const response = await fetch(`${base}&ids=1`, { credentials: "same-origin" });
      const { ids } = (await response.json()) as { ids: string[] };
      setChanges((current) => {
        const next = new Map(current);
        for (const id of ids) next.set(id, inProducts);
        return next;
      });
    } catch {
      setError("Couldn't fetch the matching products. Try again.");
    } finally {
      setSelecting(false);
    }
  }

  const toAdd = [...changes].filter(([, value]) => value).map(([id]) => id);
  const toRemove = [...changes].filter(([, value]) => !value).map(([id]) => id);

  async function save() {
    if (discountProblem || markupProblem || discountBp === null) {
      setError(discountProblem || markupProblem);
      return;
    }
    setError("");
    const batches: { tick: string[]; untick: string[] }[] = [];
    for (let start = 0; start < Math.max(toAdd.length, toRemove.length); start += LINES_PER_BATCH) {
      batches.push({ tick: toAdd.slice(start, start + LINES_PER_BATCH), untick: toRemove.slice(start, start + LINES_PER_BATCH) });
    }
    setSaving({ done: 0, total: toAdd.length + toRemove.length });
    const totals = { added: 0, attached: 0, alreadyIn: 0, removed: 0, turnedOff: 0, heldCount: 0 };
    const held: { name: string; reason: string }[] = [];
    const sent: string[] = [];
    // A batch refused or lost after others went through: those are saved,
    // so they come off the changes and the list is read again as it is now
    // — a box then shows what's stored, and unticking it sends the untick.
    const stopped = (message: string) => {
      if (sent.length > 0) {
        setChanges((current) => {
          const next = new Map(current);
          for (const id of sent) next.delete(id);
          return next;
        });
        setVersion((current) => current + 1);
        message += ` ${sent.length.toLocaleString("en-US")} of your changes were saved before it stopped; the list now shows what's in Products.`;
      }
      setError(message);
      setSaving(null);
    };
    try {
      for (const batch of batches) {
        const answer = await saveRatesheetLines({ linkedRatesheetId: sheet.id, discountBp, ...batch });
        if (!answer.ok) {
          stopped(answer.error);
          return;
        }
        sent.push(...batch.tick, ...batch.untick);
        totals.added += answer.added;
        totals.attached += answer.attached;
        totals.alreadyIn += answer.alreadyIn;
        totals.removed += answer.removed;
        totals.turnedOff += answer.turnedOff;
        totals.heldCount += answer.heldCount;
        held.push(...answer.held);
        setSaving((current) => current && { ...current, done: current.done + batch.tick.length + batch.untick.length });
      }
      const finished = await finishRatesheetLines({ linkedRatesheetId: sheet.id, discountBp, minMarkupBp: markupBp });
      if (!finished.ok) {
        stopped(finished.error);
        return;
      }
      const n = (value: number) => value.toLocaleString("en-US");
      const lines: string[] = [];
      const done = [
        totals.added ? `${n(totals.added)} added to Products` : "",
        totals.attached ? `${n(totals.attached)} linked to products you already had` : "",
        totals.alreadyIn ? `${n(totals.alreadyIn)} already in Products from another of their sheets (prices left as they are)` : "",
        totals.removed ? `${n(totals.removed)} taken off${totals.turnedOff ? ` (${n(totals.turnedOff)} turned off: no other supplier)` : ""}` : "",
      ].filter(Boolean);
      lines.push(done.length ? `Saved: ${done.join(", ")}.` : "Saved.");
      if (finished.discounted) {
        lines.push(
          `Your ${basisPointsToPercent(discountBp)}% discount is on ${n(finished.discounted)} ${finished.discounted === 1 ? "product" : "products"} from this sheet.`,
        );
      }
      if (finished.repricedCount) {
        lines.push(
          `${n(finished.repricedCount)} re-priced up to your ${basisPointsToPercent(markupBp ?? 0)}% minimum markup: ` +
            finished.repriced.map((item) => `${item.name} ${formatCents(item.fromCents)} → ${formatCents(item.toCents)}`).join(", ") +
            (finished.repricedCount > finished.repriced.length ? `, and ${n(finished.repricedCount - finished.repriced.length)} more.` : "."),
        );
      }
      if (totals.heldCount) {
        lines.push(
          `${n(totals.heldCount)} not added: ` +
            held.slice(0, 10).map((item) => `${item.name} (${item.reason})`).join("; ") +
            (totals.heldCount > 10 ? "; and more" : "") +
            ". Use Import prices to check them.",
        );
      }
      setResult(lines);
      setChanges(new Map());
      setSaving(null);
      router.refresh();
    } catch {
      stopped("That didn't reach the server. Check your connection and Save and accept again — what was saved stays saved.");
    }
  }

  const changeCount = toAdd.length + toRemove.length;
  const actions = (where: "top" | "bottom") => (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid={`product-list-actions-${where}`}>
      {where === "bottom" && changeCount > 0 && !saving && (
        <span className="faint mr-auto text-xs">
          {toAdd.length.toLocaleString("en-US")} ticked · {toRemove.length.toLocaleString("en-US")} unticked
        </span>
      )}
      {saving && (
        <span className="faint mr-auto text-xs" data-testid="product-list-progress">
          Saving… {saving.done.toLocaleString("en-US")} of {saving.total.toLocaleString("en-US")}
        </span>
      )}
      <button type="button" onClick={onClose} disabled={!!saving} className="btn btn-ghost btn-sm">
        Cancel
      </button>
      <button type="button" onClick={save} disabled={!!saving || !ready} className="btn btn-primary btn-sm">
        {saving ? "Saving…" : "Save and accept"}
      </button>
    </div>
  );

  return createPortal(
    <div className="modal-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-list-title"
        className="card card-lit popover max-h-[92vh] w-full max-w-5xl overflow-y-auto p-5"
        data-testid="product-list"
      >
        <div className="sticky -top-5 z-10 -mx-5 -mt-5 space-y-3 bg-[var(--overlay)] px-5 pb-3 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow mb-1">See product list</p>
              <h2 id="product-list-title" className="truncate text-base font-semibold">
                {sheet.name}
              </h2>
              <p className="faint text-xs">
                {[sheet.supplierName, ready ? `${lineCount.toLocaleString("en-US")} products on the sheet` : null, ready ? `${counts.in.toLocaleString("en-US")} in Products${query.trim() ? " (matching)" : ""}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={!!saving} aria-label="Close" className="btn btn-ghost btn-sm !px-1.5">
              <IconX size={14} />
            </button>
          </div>
          {!result && actions("top")}
        </div>

        {prepareError ? (
          <FormError message={prepareError} />
        ) : !ready ? (
          <p className="faint py-6 text-center text-sm">Reading the sheet…</p>
        ) : result ? (
          <div className="space-y-2 py-2" data-testid="product-list-result">
            {result.map((text) => (
              <p key={text} className="text-sm">
                {text}
              </p>
            ))}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="product-list-discount">
                  COGS discount %
                </label>
                <input
                  id="product-list-discount"
                  inputMode="decimal"
                  value={discountText}
                  onChange={(event) => setDiscountText(event.target.value)}
                  placeholder="0"
                  className="input num"
                />
                <p className={discountProblem ? "mt-1 text-xs text-[var(--danger)]" : "faint mt-1 text-xs"}>
                  {discountProblem || "Off their price on every product from this sheet: your COGS."}
                </p>
              </div>
              <div>
                <label className="label" htmlFor="product-list-markup">
                  Required minimum markup %
                </label>
                <input
                  id="product-list-markup"
                  inputMode="decimal"
                  value={markupText}
                  onChange={(event) => setMarkupText(event.target.value)}
                  placeholder="None"
                  className="input num"
                />
                <p className={markupProblem ? "mt-1 text-xs text-[var(--danger)]" : "faint mt-1 text-xs"}>
                  {markupProblem || "No product priced from this sheet sells under this; lower prices are raised on Save."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-56">
                <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search this sheet: name, part #, maker…"
                  aria-label="Search this sheet"
                  className="input input-sm pl-8"
                />
              </div>
              {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`btn btn-sm ${filter === key ? "btn-primary" : "btn-ghost"}`}
                  data-testid={`product-list-filter-${key}`}
                >
                  {FILTER_LABELS[key]} ({counts[key].toLocaleString("en-US")})
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAllMatching(true)} disabled={selecting || total === 0} className="btn btn-ghost btn-sm">
                {query.trim() || filter !== "all" ? "Select all matching" : `Select all ${counts.all.toLocaleString("en-US")}`}
              </button>
              <button type="button" onClick={() => setAllMatching(false)} disabled={selecting || total === 0} className="btn btn-ghost btn-sm">
                {query.trim() || filter !== "all" ? "Clear matching" : "Clear all"}
              </button>
            </div>

            <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
              <li className="faint hidden gap-3 px-3 py-2 text-[0.68rem] uppercase tracking-wide sm:flex">
                <span className="w-5" />
                <span className="flex-1">Product</span>
                <span className="w-24 text-right">Their cost</span>
                <span className="w-24 text-right">Your COGS</span>
                <span className="w-20 text-right">MSRP</span>
                <span className="w-24 text-right">Sell price</span>
              </li>
              {rows.map((line) => {
                const cogs = line.costCents === null ? null : effectiveCostCents(line.costCents, discountBp ?? 0);
                const minimum = cogs === null ? null : minimumMarkupPriceCents(cogs, markupBp);
                const product = line.product;
                const underMinimum =
                  !!product && product.starred && product.fromThisSheet && minimum !== null && product.unitPriceCents < minimum;
                return (
                  <li key={line.id} className="flex items-start gap-3 px-3 py-2" data-testid="product-list-row">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]"
                      checked={checked(line)}
                      onChange={() => toggle(line)}
                      aria-label={`In Products: ${line.name}`}
                    />
                    <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
                      <div className="min-w-0 sm:flex-1">
                        <p className="truncate text-sm font-medium">{line.name}</p>
                        <p className="faint truncate text-xs">
                          {[line.sku ?? "No part #", line.manufacturer].filter(Boolean).join(" · ")}
                          {product && !product.starred && " · beside your starred supplier"}
                          {product && product.starred && !product.fromThisSheet && " · priced from another of their sheets"}
                          {product && !product.active && " · off in Products"}
                        </p>
                      </div>
                      <div className="mt-1 flex justify-end gap-3 text-xs sm:mt-0">
                        <span className="num w-24 text-right">{line.costCents === null ? "—" : formatCents(line.costCents)}</span>
                        <span className="num w-24 text-right" data-testid="product-list-cogs">
                          {cogs === null ? "—" : formatCents(cogs)}
                        </span>
                        <span className="num faint w-20 text-right">{line.listPriceCents === null ? "—" : formatCents(line.listPriceCents)}</span>
                        <span className={`num w-24 text-right ${underMinimum ? "text-[var(--danger)]" : ""}`}>
                          {product ? formatCents(product.unitPriceCents) : "—"}
                          {underMinimum && <span className="block text-[0.68rem]">under {formatCents(minimum!)}</span>}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
              {rows.length === 0 && (
                <li className="faint px-3 py-4 text-center text-xs">{first.loading ? "Loading…" : "Nothing here."}</li>
              )}
            </ul>
            {rows.length < total && (
              <button type="button" onClick={() => setPages(pages + 1)} className="btn btn-ghost btn-sm">
                Show {PAGE} more ({(total - rows.length).toLocaleString("en-US")} left)
              </button>
            )}
          </div>
        )}

        <FormError message={error} />
        {!result && (
          <div className="popover sticky -bottom-5 z-10 -mx-5 -mb-5 mt-3 border-t border-[var(--border)] px-5 py-3">
            {actions("bottom")}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// "Show 50 more": every page after the first, fetched once each and kept.
function useMorePages(urls: string[]): Page[] {
  const [loaded, setLoaded] = useState<Map<string, Page>>(() => new Map());
  const asked = useRef(new Set<string>());
  const key = urls.join("|");
  useEffect(() => {
    for (const url of urls) {
      if (asked.current.has(url)) continue;
      asked.current.add(url);
      fetch(url, { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : null))
        .then((page: Page | null) => {
          if (page) setLoaded((current) => new Map(current).set(url, page));
        })
        .catch(() => asked.current.delete(url));
    }
    // urls is rebuilt each render; its joined key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls.map((url) => loaded.get(url)).filter((page): page is Page => !!page);
}
