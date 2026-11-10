"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconSearch, IconChevronDown, IconX, IconStar, IconTrending, IconFilter, IconCheck, IconBuilding, IconSparkles, IconFileText } from "@/components/icons";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS, INDIVIDUAL_COMPANY_TYPE, PAGE_SIZES, type ContactStatusValue } from "@/lib/constants";
import {
  listHref,
  activeFilterCount,
  ACTIVITY_WINDOWS,
  ACTIVITY_WINDOW_LABELS,
  NO_FILTERS,
  UNASSIGNED,
  type ActivityWindow,
  type ListParams,
  type ListLock,
  type Presence,
} from "@/lib/list-params";
import { useSearch } from "@/lib/use-search";
import { FloatingMenu } from "@/components/floating-menu";

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
  reps = [],
  leadLabels = [],
}: {
  basePath: string;
  params: ListParams;
  lock?: ListLock;
  options: FilterBarOptions;
  kind: "contacts" | "companies";
  selectedCompanies?: { id: string; name: string }[];
  placeholder: string;
  // Clean CRM data filters (Nov 10, 2026): the workspace's people for Rep
  // and Added by, and the Lead Labels on offer.
  reps?: { id: string; name: string }[];
  leadLabels?: string[];
}) {
  const router = useRouter();
  // The bar shows the new choice the instant it is clicked and holds it
  // until the server has answered with the matching rows.
  const [, startTransition] = useTransition();
  const [params, setShown] = useOptimistic(current);
  // Built from the optimistic state, so a second click while the first
  // navigation is still loading keeps the first change instead of
  // overwriting it with the last server-rendered view.
  const go = (overrides: Partial<ListParams>) =>
    startTransition(() => {
      const next = { ...params, ...overrides, page: 1 };
      setShown(next);
      router.push(listHref(basePath, next, {}, lock));
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
  const repNames: Record<string, string> = Object.fromEntries(reps.map((rep) => [rep.id, rep.name]));
  const repLabels: Record<string, string> = { [UNASSIGNED]: "Unassigned", ...repNames };
  const presenceLabel = (field: string, value: Presence) => `${value === "yes" ? "Has" : "No"} ${field}`;
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
        {/* The status ladder, in its own order rather than alphabetical,
            so Not Actioned reads above Contacted above Interested. The
            Interested sub-panes hold the status already and hide this. */}
        {!lock.interested && (
          <MultiSelect
            label="Status"
            values={params.statuses}
            choices={[...CONTACT_STATUSES]}
            labels={CONTACT_STATUS_LABELS}
            onToggle={(value) => go({ statuses: toggle(params.statuses, value as ContactStatusValue) as ContactStatusValue[] })}
            onClear={() => go({ statuses: [] })}
            empty="No statuses."
          />
        )}

        <ActivitySelect value={params.act} onPick={(act) => go({ act })} />
        {kind === "contacts" && (
          <TitleSelect
            values={params.titles}
            onToggle={(title) =>
              go({ titles: params.titles.some((t) => t.toLowerCase() === title.toLowerCase()) ? params.titles.filter((t) => t.toLowerCase() !== title.toLowerCase()) : [...params.titles, title] })
            }
            onClear={() => go({ titles: [] })}
          />
        )}
        <MultiSelect
          label="Rep"
          values={params.reps}
          choices={[UNASSIGNED, ...reps.map((rep) => rep.id)]}
          labels={repLabels}
          onToggle={(value) => go({ reps: toggle(params.reps, value) })}
          onClear={() => go({ reps: [] })}
          empty="No teammates."
        />
        <MultiSelect
          label="Added by"
          values={params.addedBy}
          choices={reps.map((rep) => rep.id)}
          labels={repNames}
          onToggle={(value) => go({ addedBy: toggle(params.addedBy, value) })}
          onClear={() => go({ addedBy: [] })}
          empty="No teammates."
        />
        <AddedSelect from={params.from} to={params.to} onApply={(from, to) => go({ from, to })} />
        <PresenceSelect
          fields={kind === "contacts" ? (["mobile", "email"] as const) : (["email", "phone"] as const)}
          params={params}
          onPick={(field, value) => go({ [field]: value })}
        />
        <MultiSelect
          label="Lead Label"
          values={params.labels}
          choices={leadLabels}
          onToggle={(value) => go({ labels: toggle(params.labels, value) })}
          onClear={() => go({ labels: [] })}
          empty="No lead labels yet."
        />

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
        <Toggle on={params.owed} onClick={() => go({ owed: !params.owed })} testId="filter-owed">
          <IconFileText size={13} />
          Owes money
        </Toggle>
        {kind === "companies" && (
          <Toggle on={params.auto} onClick={() => go({ auto: !params.auto })} testId="filter-auto">
            <IconSparkles size={13} />
            Auto-filled
          </Toggle>
        )}

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
          {!lock.interested &&
            params.statuses.map((status) => (
              <Chip key={`st-${status}`} onRemove={() => go({ statuses: toggle(params.statuses, status) as ContactStatusValue[] })}>
                Status: {CONTACT_STATUS_LABELS[status]}
              </Chip>
            ))}
          {params.fav && !lock.fav && <Chip onRemove={() => go({ fav: false })}>Favorites</Chip>}
          {params.deals && !lock.deals && <Chip onRemove={() => go({ deals: false })}>With deals</Chip>}
          {params.attn && <Chip onRemove={() => go({ attn: false })}>Needs attention</Chip>}
          {params.owed && <Chip onRemove={() => go({ owed: false })}>Owes money</Chip>}
          {kind === "companies" && params.auto && <Chip onRemove={() => go({ auto: false })}>Auto-filled</Chip>}
          {params.act && <Chip onRemove={() => go({ act: "" })}>{ACTIVITY_WINDOW_LABELS[params.act]}</Chip>}
          {params.titles.map((title) => (
            <Chip key={`ti-${title}`} onRemove={() => go({ titles: params.titles.filter((t) => t !== title) })}>
              Title: {title}
            </Chip>
          ))}
          {params.reps.map((rep) => (
            <Chip key={`r-${rep}`} onRemove={() => go({ reps: toggle(params.reps, rep) })}>
              Rep: {repLabels[rep] ?? "…"}
            </Chip>
          ))}
          {params.addedBy.map((by) => (
            <Chip key={`b-${by}`} onRemove={() => go({ addedBy: toggle(params.addedBy, by) })}>
              Added by: {repNames[by] ?? "…"}
            </Chip>
          ))}
          {(params.from || params.to) && (
            <Chip onRemove={() => go({ from: "", to: "" })}>
              Added {params.from && params.to ? `${params.from} to ${params.to}` : params.from ? `from ${params.from}` : `up to ${params.to}`}
            </Chip>
          )}
          {params.mobile && <Chip onRemove={() => go({ mobile: "" })}>{presenceLabel("mobile", params.mobile)}</Chip>}
          {params.email && <Chip onRemove={() => go({ email: "" })}>{presenceLabel("email", params.email)}</Chip>}
          {params.phone && <Chip onRemove={() => go({ phone: "" })}>{presenceLabel("phone", params.phone)}</Chip>}
          {params.labels.map((label) => (
            <Chip key={`l-${label}`} onRemove={() => go({ labels: toggle(params.labels, label) })}>
              Lead Label: {label}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => go({ q: "", ...NO_FILTERS })}
            className="btn btn-ghost btn-sm"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

export function Toggle({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
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

export function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
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
//
// The list is a FloatingMenu (UX review, Nov 10, 2026): drawn on the page
// body and kept inside the window, flipping up when there is more room
// above. It used to hang off the button's left edge at a fixed 256px, so
// any button in the right half of a wrapped filter row — Rep, Added by,
// Contact info, Status on a phone, Lead Label on the Pipeline — opened a
// menu that ran off the screen, cut its names and widened the page.
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
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  // The menu is drawn hidden until it has measured where it fits, and a
  // hidden box can't take focus, so a search box marked data-autofocus is
  // focused on the next frame, once the menu is on screen.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
        className={`btn btn-sm ${count > 0 ? "btn-primary" : "btn-ghost"}`}
      >
        {label}
        {count > 0 && <span className="num rounded-full bg-[var(--tint-5)] px-1.5 text-[0.65rem]">{count}</span>}
        <IconChevronDown size={12} className="opacity-70" />
      </button>
      <FloatingMenu anchor={button} open={open} onClose={close} width={256} testId={`${testId}-menu`} label={label}>
        <div ref={panel} className="py-1">
          {children(close)}
        </div>
      </FloatingMenu>
    </>
  );
}

export function MultiSelect({
  label,
  values,
  choices,
  labels,
  onToggle,
  onClear,
  empty,
  searchable = false,
}: {
  label: string;
  values: string[];
  choices: string[];
  // What to print for a choice when it is a code rather than a name
  // (the status ladder's NOT_ACTIONED reads "Not Actioned").
  labels?: Partial<Record<string, string>>;
  onToggle: (value: string) => void;
  onClear: () => void;
  empty: string;
  // A box to narrow a long list (a catalog's manufacturers), shown once
  // there are more than a dozen to scroll through.
  searchable?: boolean;
}) {
  // Anything ticked that is no longer on offer (an industry filter changed
  // underneath a type pick) stays listed so it can be unticked.
  const all = Array.from(new Set([...choices, ...values]));
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle ? all.filter((choice) => (labels?.[choice] ?? choice).toLowerCase().includes(needle)) : all;
  return (
    <Dropdown label={label} count={values.length} testId={`filter-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      {() => (
        <>
          {searchable && all.length > 12 && (
            <div className="border-b border-[var(--border)] p-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                aria-label={`Search ${label.toLowerCase()}`}
                data-autofocus
                className="input input-sm"
              />
            </div>
          )}
          <ul role="listbox" aria-label={label} aria-multiselectable="true" className="max-h-64 overflow-y-auto">
            {all.length === 0 && <li className="faint px-3 py-3 text-xs">{empty}</li>}
            {all.length > 0 && shown.length === 0 && <li className="faint px-3 py-3 text-xs">Nothing matches.</li>}
            {shown.map((choice) => {
              const on = values.includes(choice);
              return (
                <li key={choice}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[var(--hover)]">
                    <input type="checkbox" checked={on} onChange={() => onToggle(choice)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
                    <span className="min-w-0 flex-1 truncate">{labels?.[choice] ?? choice}</span>
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
                data-autofocus
                className="input input-sm"
              />
            </div>
            <ul role="listbox" aria-label="Company" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
              {rows.map((company) => {
                const on = selectedIds.includes(company.id);
                return (
                  <li key={company.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[var(--hover)]">
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

// Activity (Nov 10, 2026): one window at a time — touched in, not touched
// in, or never touched. A touch never includes a marketing send.
function ActivitySelect({ value, onPick }: { value: ActivityWindow | ""; onPick: (value: ActivityWindow | "") => void }) {
  return (
    <Dropdown label="Activity" count={value ? 1 : 0} testId="filter-activity">
      {(close) => (
        <ul role="listbox" aria-label="Activity" className="max-h-72 overflow-y-auto">
          {ACTIVITY_WINDOWS.map((window) => (
            <li key={window}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[var(--hover)]">
                <input
                  type="radio"
                  name="activity-window"
                  checked={value === window}
                  onChange={() => {
                    onPick(window);
                    close();
                  }}
                  className="h-3.5 w-3.5 accent-[var(--brand)]"
                />
                <span>{ACTIVITY_WINDOW_LABELS[window]}</span>
              </label>
            </li>
          ))}
          {value && (
            <li className="border-t border-[var(--border)] px-3 py-1.5">
              <button type="button" onClick={() => (onPick(""), close())} className="link text-xs">
                Clear activity
              </button>
            </li>
          )}
        </ul>
      )}
    </Dropdown>
  );
}

// Job title (contacts): the workspace's distinct titles with how many
// people carry each, searched on the server since a CRM can hold
// thousands; ticked titles match ignoring case.
function TitleSelect({ values, onToggle, onClear }: { values: string[]; onToggle: (title: string) => void; onClear: () => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useSearch<{ name: string; count: number }>(
    open ? `/dashboard/contacts/titles?q=${encodeURIComponent(query.trim())}` : null,
  );
  const ticked = (name: string) => values.some((value) => value.toLowerCase() === name.toLowerCase());
  const rows = [
    ...values.filter((value) => !results.some((row) => row.name.toLowerCase() === value.toLowerCase())).map((name) => ({ name, count: null as number | null })),
    ...results,
  ];
  return (
    <Dropdown label="Job title" count={values.length} testId="filter-job-title" onOpenChange={setOpen}>
      {() => (
        <>
          <div className="border-b border-[var(--border)] p-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search job titles…"
              aria-label="Search job titles"
              data-autofocus
              className="input input-sm"
            />
          </div>
          <ul role="listbox" aria-label="Job title" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
            {rows.map((row) => (
              <li key={row.name}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[var(--hover)]">
                  <input type="checkbox" checked={ticked(row.name)} onChange={() => onToggle(row.name)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.count !== null && <span className="faint num text-xs">{row.count.toLocaleString()}</span>}
                </label>
              </li>
            ))}
            {!loading && rows.length === 0 && <li className="faint px-3 py-3 text-xs">{query.trim() ? "No titles match." : "No job titles on file yet."}</li>}
          </ul>
          {values.length > 0 && (
            <div className="border-t border-[var(--border)] px-3 py-1.5">
              <button type="button" onClick={onClear} className="link text-xs">
                Clear job title
              </button>
            </div>
          )}
        </>
      )}
    </Dropdown>
  );
}

// Added: a date range, either end optional, in the workspace's clock.
function AddedSelect({ from, to, onApply }: { from: string; to: string; onApply: (from: string, to: string) => void }) {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  return (
    <Dropdown
      label="Added"
      count={from || to ? 1 : 0}
      testId="filter-added"
      onOpenChange={(open) => {
        if (open) {
          setDraftFrom(from);
          setDraftTo(to);
        }
      }}
    >
      {(close) => (
        <div className="space-y-2 p-3 text-sm">
          <label className="block">
            <span className="faint text-xs">From</span>
            <input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} className="input input-sm" data-testid="added-from" />
          </label>
          <label className="block">
            <span className="faint text-xs">To</span>
            <input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} className="input input-sm" data-testid="added-to" />
          </label>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onApply(draftFrom, draftTo);
                close();
              }}
              className="btn btn-primary btn-sm"
              data-testid="added-apply"
            >
              Apply
            </button>
            {(from || to) && (
              <button type="button" onClick={() => (onApply("", ""), close())} className="link text-xs">
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

// Has / has no: mobile and email on contacts, email and phone on companies.
function PresenceSelect({
  fields,
  params,
  onPick,
}: {
  fields: readonly ("mobile" | "email" | "phone")[];
  params: ListParams;
  onPick: (field: "mobile" | "email" | "phone", value: Presence) => void;
}) {
  const count = fields.filter((field) => params[field]).length;
  return (
    <Dropdown label="Contact info" count={count} testId="filter-contact-info">
      {() => (
        <div className="space-y-2 p-3 text-sm">
          {fields.map((field) => (
            <fieldset key={field} className="flex items-center justify-between gap-2">
              <legend className="sr-only">{field}</legend>
              <span className="capitalize">{field}</span>
              <span className="flex gap-1">
                {(["", "yes", "no"] as const).map((value) => (
                  <button
                    key={value || "any"}
                    type="button"
                    aria-pressed={params[field] === value}
                    onClick={() => onPick(field, value)}
                    data-testid={`presence-${field}-${value || "any"}`}
                    className={`btn btn-sm !px-2 ${params[field] === value ? "btn-primary" : "btn-ghost"}`}
                  >
                    {value === "" ? "Any" : value === "yes" ? "Has" : "None"}
                  </button>
                ))}
              </span>
            </fieldset>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
