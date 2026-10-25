"use client";

import { useEffect, useRef, useState } from "react";
import { IconSearch } from "@/components/icons";
import { formatCents } from "@/lib/format";
import { UNIT_LABELS, type UnitOfMeasureValue } from "@/lib/constants";
import { useSearch } from "@/lib/use-search";
import type { EditorProduct } from "./line-items-editor";

export type CatalogResult = EditorProduct & { sku: string | null; manufacturerName: string | null };

// "Add from catalog": type a name or a part number and pick from the best
// matches. It used to be a dropdown of the whole catalog, which a
// distributor's sheet of thousands of products made unusable and slow to
// load. Arrow keys and Enter work; on a phone it is one box and a tap.
export function CatalogPicker({ onPick }: { onPick: (product: CatalogResult) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchUrl = (text: string) => `/dashboard/products/search?active=1&q=${encodeURIComponent(text.trim())}`;
  const { results, loading } = useSearch<CatalogResult>(open ? searchUrl(query) : null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Enter while the list still shows the last search's answer (typing
  // fast, or a barcode scanner, which types and presses Enter in a few
  // milliseconds) asks for this search's answer and adds its first match:
  // picking from the list on screen added the previous search's product.
  async function pickFirstMatch(text: string) {
    try {
      const response = await fetch(searchUrl(text), { credentials: "same-origin" });
      const rows = response.ok ? ((await response.json()) as CatalogResult[]) : [];
      if (rows[0]) pick(rows[0]);
    } catch {
      // The list catches up on its own and says what it found.
    }
  }

  function pick(product: CatalogResult) {
    onPick(product);
    setQuery("");
    setHighlight(0);
    // Stays open on the box, so a run of products can be added in a row.
    inputRef.current?.focus();
  }

  const current = Math.min(highlight, Math.max(0, results.length - 1));

  return (
    <div ref={wrapRef} className="relative w-full sm:w-72">
      <IconSearch
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlight(Math.max(0, Math.min(current + 1, results.length - 1)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight(Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            // Never submits a form around it.
            event.preventDefault();
            if (loading) void pickFirstMatch(query);
            else if (open && results[current]) pick(results[current]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Add from catalog: name or part #"
        aria-label="Add product from catalog"
        aria-expanded={open}
        aria-controls="catalog-picker-results"
        role="combobox"
        aria-autocomplete="list"
        className="input input-sm pl-8"
      />
      {open && (
        <ul
          id="catalog-picker-results"
          role="listbox"
          aria-label="Catalog matches"
          data-testid="catalog-results"
          className="card popover absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto py-1 sm:w-[26rem]"
        >
          {results.map((product, index) => {
            const unit = product.unitOfMeasure ? UNIT_LABELS[product.unitOfMeasure as UnitOfMeasureValue] : null;
            return (
              <li
                key={product.id}
                role="option"
                aria-selected={index === current}
                onMouseEnter={() => setHighlight(index)}
                // mousedown, not click: the box keeps focus, so the list
                // doesn't close before the pick lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(product);
                }}
                className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-sm ${
                  index === current ? "bg-[rgb(255_255_255/0.06)]" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.name}</p>
                  <p className="faint truncate text-xs">
                    {[product.sku, product.manufacturerName].filter(Boolean).join(" · ") || product.description || "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num font-medium">{formatCents(product.unitPriceCents)}</p>
                  {unit && <p className="faint text-[0.7rem]">{unit}</p>}
                </div>
              </li>
            );
          })}
          {!loading && results.length === 0 && (
            <li className="faint px-3 py-3 text-xs">
              {query.trim() ? "No active product matches. Add a blank line for a one-off." : "No active products in your catalog yet."}
            </li>
          )}
          {loading && results.length === 0 && <li className="faint px-3 py-3 text-xs">Searching…</li>}
        </ul>
      )}
    </div>
  );
}
