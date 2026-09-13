"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconSearch, IconChevronDown, IconX, IconStar, IconTrending, IconFilter, IconCheck, IconBuilding } from "@/components/icons";
import { INDIVIDUAL_COMPANY_TYPE, PAGE_SIZES } from "@/lib/constants";
import { listHref, activeFilterCount, type ListParams, type ListLock } from "@/lib/list-params";
import { useSearch } from "@/lib/use-search";

export type FilterBarOptions = {
  states: string[];
  industries: { name: string; types: string[] }[];
};

// The bar above the Contacts and Companies tables: the search box, the
// multi-select dropdowns (State, Industry, Company Type, and Company on
// contacts), the Favorites / With deals / Needs attention toggles, and
// the per-page choice. Every change is a navigation to a new address, so
// the server does the filtering and the view is bookmarkable.
export function ListFilters({
  basePath,
  params: current,
  lock = {},
  options,
  kind,
  selectedCompanies = [],
  placeholder,
}: {
  basePath: string;
  params: ListParams;
  lock?: ListLock;
  options: FilterBarOptions;
  kind: "contacts" | "companies";
  selectedCompanies?: { id: string; name: string }[];
  placeholder: string;
}) {
  const router = useRouter();
  // The bar shows the new choice the instant it is clicked and holds it
  // until the server has answered with the matching rows.
  const [, startTransition] = useTransition();
  const [params, setShown] = useOptimistic(current);
  const go = (overrides: Partial<ListParams>) =>
    startTransition(() => {
      setShown({ ...params, ...overrides, page: 1 });
      router.push(listHref(basePath, current, overrides, lock));
    });

  const industryNames = options.industries.map((industry) => industry.name);
  // Company types on offer: those under the industries picked, or all of
  // them when no industry is picked; contacts also get Individual / Personal.
  const typeSource = params.industries.length
    ? options.industries.filter((industry) => params.industries.includes(industry.name))
    : options.industries;
  const typeNames = Array.from(new Set(typeSource.flatMap((industry) => industry.types)));
  if (kind === "contacts") typeNames.push(INDIVIDUAL_COMPANY_TYPE);

  const active = activeFilterCount(params, lock);
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("q") as HTMLInputElement;
            go({ q: input.value.trim() });
          }}
          className="relative"
          role="search"
        >
          <IconSearch
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            key={params.q}
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder={placeholder}
            aria-label={placeholder}
            className="input input-sm w-60 pl-8"
          />
        </form>

        <MultiSelect
          label="State"
          values={params.states}
          choices={options.states}
          onToggle={(value) => go({ states: toggle(params.states, value) })}
          onClear={() => go({ states: [] })}
          empty="No states on file yet."
        />
        <MultiSelect
          label="Industry"
          values={params.industries}
          choices={industryNames}
          onToggle={(value) => go({ industries: toggle(params.industries, value) })}
          onClear={() => go({ industries: [] })}
          empty="No industries yet."
        />
        <MultiSelect
          label="Company type"
          values={params.types}
          choices={typeNames}
          onToggle={(value) => go({ types: toggle(params.types, value) })}
          onClear={() => go({ types: [] })}
          empty="Pick an industry to see its company types."
        />
        {kind === "contacts" && (
          <CompanySelect
            selected={selectedCompanies}
            selectedIds={params.companies}
            onToggle={(id) => go({ companies: toggle(params.companies, id) })}
            onClear={() => go({ companies: [] })}
          />
        )}

        {!lock.fav && (
          <Toggle on={params.fav} onClick={() => go({ fav: !params.fav })} testId="filter-fav">
            <IconStar size={13} filled={params.fav} className={params.fav ? "text-[var(--warn)]" : ""} />
            Favorites
          </Toggle>
        )}
        {!lock.deals && (
          <Toggle on={params.deals} onClick={() => go({ deals: !params.deals })} testId="filter-deals">
            <IconTrending size={13} />
            With deals
          </Toggle>
        )}
        <Toggle on={params.attn} onClick={() => go({ attn: !params.attn })} testId="filter-attn">
          <IconFilter size={13} />
          Needs attention
        </Toggle>

        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <span className="faint">Per page</span>
          <select
            value={params.per}
            onChange={(event) => go({ per: Number(event.target.value) })}
            aria-label="Rows per page"
            className="select input-sm w-[4.75rem] py-1 pr-7"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(active > 0 || params.q) && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="active-filters">
          {params.q && <Chip onRemove={() => go({ q: "" })}>“{params.q}”</Chip>}
          {params.states.map((state) => (
            <Chip key={`s-${state}`} onRemove={() => go({ states: toggle(params.states, state) })}>
              State: {state}
            </Chip>
          ))}
          {params.industries.map((industry) => (
            <Chip key={`i-${industry}`} onRemove={() => go({ industries: toggle(params.industries, industry) })}>
              Industry: {industry}
            </Chip>
          ))}
          {params.types.map((type) => (
            <Chip key={`t-${type}`} onRemove={() => go({ types: toggle(params.types, type) })}>
              Type: {type}
            </Chip>
          ))}
          {params.companies.map((id) => (
            <Chip key={`c-${id}`} onRemove={() => go({ companies: toggle(params.companies, id) })}>
              Company: {selectedCompanies.find((company) => company.id === id)?.name ?? "…"}
            </Chip>
          ))}
          {params.fav && !lock.fav && <Chip onRemove={() => go({ fav: false })}>Favorites</Chip>}
          {params.deals && !lock.deals && <Chip onRemove={() => go({ deals: false })}>With deals</Chip>}
          {params.attn && <Chip onRemove={() => go({ attn: false })}>Needs attention</Chip>}
          <button
            type="button"
            onClick={() =>
              go({ q: "", states: [], industries: [], types: [], companies: [], fav: false, deals: false, attn: false })
            }
            className="btn btn-ghost btn-sm"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
      className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
    >
      {children}
    </button>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="badge gap-1 border-[var(--border-strong)]">
      {children}
      <button type="button" onClick={onRemove} aria-label="Remove filter" className="opacity-70 hover:opacity-100">
        <IconX size={10} />
      </button>
    </span>
  );
}

// A button that opens a list of checkboxes. Closes on outside click or
// Escape. Ticks apply straight away.
function Dropdown({
  label,
  count,
  children,
  testId,
  onOpenChange,
}: {
  label: string;
  count: number;
  children: (close: () => void) => React.ReactNode;
  testId: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
        className={`btn btn-sm ${count > 0 ? "btn-primary" : "btn-ghost"}`}
      >
        {label}
        {count > 0 && <span className="num rounded-full bg-[rgb(255_255_255/0.2)] px-1.5 text-[0.65rem]">{count}</span>}
        <IconChevronDown size={12} className="opacity-70" />
      </button>
      {open && (
        <div className="card absolute left-0 top-full z-30 mt-1 w-64 py-1 shadow-xl">{children(() => setOpen(false))}</div>
      )}
    </div>
  );
}

function MultiSelect({
  label,
  values,
  choices,
  onToggle,
  onClear,
  empty,
}: {
  label: string;
  values: string[];
  choices: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  empty: string;
}) {
  // Anything ticked that is no longer on offer (an industry filter changed
  // underneath a type pick) stays listed so it can be unticked.
  const all = Array.from(new Set([...choices, ...values]));
  return (
    <Dropdown label={label} count={values.length} testId={`filter-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      {() => (
        <>
          <ul role="listbox" aria-label={label} aria-multiselectable="true" className="max-h-64 overflow-y-auto">
            {all.length === 0 && <li className="faint px-3 py-3 text-xs">{empty}</li>}
            {all.map((choice) => {
              const on = values.includes(choice);
              return (
                <li key={choice}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[rgb(255_255_255/0.04)]">
                    <input type="checkbox" checked={on} onChange={() => onToggle(choice)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
                    <span className="min-w-0 flex-1 truncate">{choice}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {values.length > 0 && (
            <div className="border-t border-[var(--border)] px-3 py-1.5">
              <button type="button" onClick={onClear} className="link text-xs">
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </>
      )}
    </Dropdown>
  );
}

// The Company filter on contacts: type to search, since a workspace can
// hold thousands of companies and a checklist of all of them is useless.
function CompanySelect({
  selected,
  selectedIds,
  onToggle,
  onClear,
}: {
  // Names for the chips (resolved by the server) and the ids that are
  // ticked right now (optimistic, so a click shows at once).
  selected: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useSearch<{ id: string; name: string }>(
    open ? `/dashboard/companies/search?q=${encodeURIComponent(query.trim())}` : null,
  );
  const rows = [...selected.filter((s) => !results.some((r) => r.id === s.id)), ...results];

  return (
    <Dropdown label="Company" count={selectedIds.length} testId="filter-company" onOpenChange={setOpen}>
      {() => {
        return (
          <>
            <div className="border-b border-[var(--border)] p-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search companies…"
                aria-label="Search companies"
                autoFocus
                className="input input-sm"
              />
            </div>
            <ul role="listbox" aria-label="Company" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
              {rows.map((company) => {
                const on = selectedIds.includes(company.id);
                return (
                  <li key={company.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[rgb(255_255_255/0.04)]">
                      <input type="checkbox" checked={on} onChange={() => onToggle(company.id)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
                      <IconBuilding size={12} className="text-[var(--text-faint)]" />
                      <span className="min-w-0 flex-1 truncate">{company.name}</span>
                      {on && <IconCheck size={11} className="text-[var(--ok)]" />}
                    </label>
                  </li>
                );
              })}
              {!loading && rows.length === 0 && (
                <li className="faint px-3 py-3 text-xs">{query.trim() ? "No companies match." : "Type to search companies."}</li>
              )}
            </ul>
            {selectedIds.length > 0 && (
              <div className="border-t border-[var(--border)] px-3 py-1.5">
                <button type="button" onClick={onClear} className="link text-xs">
                  Clear company
                </button>
              </div>
            )}
          </>
        );
      }}
    </Dropdown>
  );
}
