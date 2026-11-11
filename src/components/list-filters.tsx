"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IconSearch, IconChevronDown, IconX, IconStar, IconTrending, IconFilter, IconCheck, IconBuilding, IconSparkles, IconFileText } from "@/components/icons";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS, INDIVIDUAL_COMPANY_TYPE, type ContactStatusValue } from "@/lib/constants";
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
  type ListScope,
  type ListSort,
  type PulseKey,
  LIST_SCOPES,
  PULSE_KEYS,
  PULSE_LABELS,
  sortsFor,
  SCOPE_LABELS,
  SORT_LABELS,
  PRESET_LABELS,
  presetsFor,
  effectiveSort,
} from "@/lib/list-params";
import { NO_LEAD_LABEL } from "@/lib/lead-labels";
import { COLUMN_LABELS, columnsFor } from "@/lib/list-columns";
import { saveUiPref } from "@/app/dashboard/prefs-actions";
import { SelectToggle } from "@/components/bulk-assign";
import { useSearch } from "@/lib/use-search";
import { FloatingMenu } from "@/components/floating-menu";

export type FilterBarOptions = {
  states: string[];
  industries: { name: string; types: string[] }[];
};

// Below this the list is a card list and the Filters panel a bottom sheet.
const PHONE_QUERY = "(max-width: 767px)";
function useIsPhone(initial = false) {
  const [phone, setPhone] = useState(initial);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

// The bar above the Contacts and Companies lists (BDR redesign, Nov 11,
// 2026): [Mine | Everyone | Unowned], the search box, Filters (n), Sort,
// and Columns on one line (rows per page is in the list's footer since
// round 2), the one-tap presets under it, and
// the active filters as chips that come off with a tap. Every filter there
// was before is still here, one tap deeper, grouped Who / Stage / Where /
// Data quality in the Filters panel (a bottom sheet on a phone). Every
// change is a navigation to a new address, so the server does the
// filtering and the view is bookmarkable; scope, preset, sort and columns
// are also remembered for the person (uiPrefs contacts.* / companies.*,
// through saveUiPref; read back by resolveListView).
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
  total = 0,
  columns,
  initialPhone = false,
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
  // How many match, for the phone sheet's "Show 27 people".
  total?: number;
  // The extra columns showing now; the Columns menu is left out without it.
  columns?: string[];
  // The server's guess from the user agent (as ResponsiveList), so a phone
  // gets its own layout in the first paint; the screen width decides after.
  initialPhone?: boolean;
}) {
  const router = useRouter();
  const phone = useIsPhone(initialPhone);
  const [panelOpen, setPanelOpen] = useState(false);
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
  const remember = (patch: { scope?: ListScope; preset?: string; sort?: ListSort | null; columns?: string[] }) => {
    // One key at a time, in turn, so each merge sees the one before.
    return (async () => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) await saveUiPref(kind, key, value);
      }
    })().catch(() => undefined);
  };

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
  if (params.me && repNames[params.me]) repLabels[params.me] = `Me (${repNames[params.me]})`;
  // "Me" first on the Rep filter, then Unassigned, then everyone else.
  const repChoices = [
    ...(params.me && repNames[params.me] ? [params.me] : []),
    UNASSIGNED,
    ...reps.map((rep) => rep.id).filter((id) => id !== params.me),
  ];
  const labelNames: Record<string, string> = { [NO_LEAD_LABEL]: "On a deal, no label yet" };
  const presenceLabel = (field: string, value: Presence) => `${value === "yes" ? "Has" : "No"} ${field}`;
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const presets = presetsFor(kind);
  const sort = effectiveSort(params);
  const noun = kind === "contacts" ? (total === 1 ? "person" : "people") : total === 1 ? "company" : "companies";

  function pickScope(scope: ListScope) {
    // My accounts is Mine by definition; leaving Mine leaves it.
    const preset = params.preset === "accounts" && scope !== "mine" ? "" : params.preset;
    go({ scope, preset });
    remember(preset !== params.preset ? { scope, preset: "none" } : { scope });
  }
  function pickPreset(preset: string) {
    const next = params.preset === preset ? "" : preset;
    // "My call list" and "My accounts" are a person's own: picked from
    // Everyone they switch to Mine. From Unowned the call list stays on
    // the leads nobody owns.
    const scope: ListScope | "" =
      next === "accounts" || (next === "call" && params.scope === "all") ? "mine" : params.scope;
    go({ preset: next, sort: "", scope });
    remember({ preset: next || "none", sort: null, ...(scope && scope !== params.scope ? { scope } : {}) });
  }

  const sortControl = (
<label className="flex items-center gap-1.5 text-xs">
          <span className="faint">Sort</span>
          <select
            value={sort}
            onChange={(event) => {
              const value = event.target.value as ListSort | "meeting";
              const next = value === "meeting" ? "" : value;
              go({ sort: next });
              remember({ sort: next || null });
            }}
            aria-label="Sort"
            data-testid="sort"
            className="select input-sm min-h-[44px] w-[11.5rem] py-1 pr-7 md:min-h-0"
          >
            {sort === "meeting" && <option value="meeting">Meeting time</option>}
            {sortsFor(kind).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
  );
  const groups = (
    <div className="space-y-3" data-testid="filters-panel">
      <FilterGroup title="Who">
        <MultiSelect
          label="Rep"
          values={params.reps}
          choices={repChoices}
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
      </FilterGroup>
      <FilterGroup title="Stage">
        {/* The status ladder, in its own order rather than alphabetical,
            so Not Actioned reads above Attempted above Interested. The
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
        {kind === "contacts" && (
          <MultiSelect
            label="Pulse"
            values={params.pulses}
            choices={[...PULSE_KEYS]}
            labels={PULSE_LABELS}
            onToggle={(value) => go({ pulses: toggle(params.pulses, value) as PulseKey[] })}
            onClear={() => go({ pulses: [] })}
            empty="No choices."
          />
        )}
        <ActivitySelect value={params.act} onPick={(act) => go({ act })} />
        <MultiSelect
          label="Lead Label"
          values={params.labels}
          choices={leadLabels}
          labels={labelNames}
          onToggle={(value) => go({ labels: toggle(params.labels, value) })}
          onClear={() => go({ labels: [] })}
          empty="No lead labels yet."
        />
        {!lock.deals && (
          <Toggle on={params.deals} onClick={() => go({ deals: !params.deals })} testId="filter-deals">
            <IconTrending size={13} />
            With deals
          </Toggle>
        )}
        {!lock.fav && (
          <Toggle on={params.fav} onClick={() => go({ fav: !params.fav })} testId="filter-fav">
            <IconStar size={13} filled={params.fav} className={params.fav ? "text-[var(--warn)]" : ""} />
            Favorites
          </Toggle>
        )}
        <Toggle on={params.owed} onClick={() => go({ owed: !params.owed })} testId="filter-owed">
          <IconFileText size={13} />
          Owes money
        </Toggle>
      </FilterGroup>
      <FilterGroup title="Where">
        <MultiSelect
          label="State"
          values={params.states}
          choices={options.states}
          onToggle={(value) => go({ states: toggle(params.states, value) })}
          onClear={() => go({ states: [] })}
          empty="No states on file yet."
        />
        {kind === "contacts" && (
          <CompanySelect
            selected={selectedCompanies}
            selectedIds={params.companies}
            onToggle={(id) => go({ companies: toggle(params.companies, id) })}
            onClear={() => go({ companies: [] })}
          />
        )}
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
          <TitleSelect
            values={params.titles}
            onToggle={(title) =>
              go({ titles: params.titles.some((t) => t.toLowerCase() === title.toLowerCase()) ? params.titles.filter((t) => t.toLowerCase() !== title.toLowerCase()) : [...params.titles, title] })
            }
            onClear={() => go({ titles: [] })}
          />
        )}
      </FilterGroup>
      <FilterGroup title="Data quality">
        <PresenceSelect
          fields={kind === "contacts" ? (["mobile", "email"] as const) : (["email", "phone"] as const)}
          params={params}
          onPick={(field, value) => go({ [field]: value })}
        />
        {/* "Needs attention" until Nov 11, 2026: it means the data is
            missing, not that the account is going cold. */}
        <Toggle on={params.attn} onClick={() => go({ attn: !params.attn })} testId="filter-attn">
          <IconFilter size={13} />
          Missing info
        </Toggle>
        <AddedSelect from={params.from} to={params.to} onApply={(from, to) => go({ from, to })} />
        {kind === "companies" && (
          <Toggle on={params.auto} onClick={() => go({ auto: !params.auto })} testId="filter-auto">
            <IconSparkles size={13} />
            Auto-filled
          </Toggle>
        )}
      </FilterGroup>
    </div>
  );

  const locked = Boolean(lock.fav || lock.deals || lock.interested);
  const scopeGroup = (
    <div className="inline-flex shrink-0 gap-1" role="group" aria-label="Whose records" data-testid="scope">
      {LIST_SCOPES.map((scope) => (
        <button
          key={scope}
          type="button"
          aria-pressed={params.scope === scope}
          onClick={() => pickScope(scope)}
          data-testid={`scope-${scope}`}
          className={`btn btn-sm min-h-[44px] shrink-0 md:min-h-0 ${params.scope === scope ? "btn-primary" : "btn-ghost"}`}
        >
          {SCOPE_LABELS[scope]}
        </button>
      ))}
    </div>
  );
  const searchForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("q") as HTMLInputElement;
        go({ q: input.value.trim() });
      }}
      className={phone ? "relative w-full" : "relative order-first w-full md:order-none md:w-auto"}
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
        className={phone ? "input w-full min-h-[44px] pl-8" : "input input-sm w-full pl-8 md:w-60"}
      />
    </form>
  );
  const filtersToggle = (
    <button
      type="button"
      onClick={() => setPanelOpen(!panelOpen)}
      aria-expanded={panelOpen}
      data-testid="filters-toggle"
      className={`btn btn-sm min-h-[44px] shrink-0 whitespace-nowrap md:min-h-0 ${active > 0 ? "btn-primary" : "btn-ghost"}`}
    >
      <IconFilter size={13} />
      Filters{active > 0 ? ` (${active})` : ""}
      <IconChevronDown size={12} className={`opacity-70 transition-transform ${panelOpen ? "rotate-180" : ""}`} />
    </button>
  );
  const presetButtons = presets.map((preset) => (
    <button
      key={preset}
      type="button"
      aria-pressed={params.preset === preset}
      onClick={() => pickPreset(preset)}
      data-testid={`preset-${preset}`}
      className={`btn btn-sm min-h-[44px] shrink-0 whitespace-nowrap md:min-h-0 ${params.preset === preset ? "btn-primary" : "btn-ghost"}`}
    >
      {PRESET_LABELS[kind][preset]}
    </button>
  ));

  // A phone (round 2, Nov 11, 2026): the search on top, with the page's
  // ⋯ and + beside it (ListHeader places them there), then one row that
  // scrolls sideways: Mine · Everyone · Unowned, Filters, Select and the
  // presets. Sort is in the Filters sheet, per page in the footer. The
  // first card starts about 180px down instead of about 430.
  const top = phone ? (
    <>
      <div className="pr-[6.5rem]" data-testid="list-search-row">
        {searchForm}
      </div>
      <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1" data-testid="list-chips">
        {scopeGroup}
        {filtersToggle}
        <span className="shrink-0">
          <SelectToggle />
        </span>
        {!locked && (
          <div className="flex shrink-0 gap-1.5" role="group" aria-label="Presets" data-testid="presets">
            {presetButtons}
          </div>
        )}
      </div>
    </>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {scopeGroup}
        {searchForm}
        {filtersToggle}
        <div className="hidden md:contents">{sortControl}</div>
        {columns && (
          <div className="hidden md:contents">
            <ColumnsMenu kind={kind} columns={columns} onSave={(next) => remember({ columns: next })} />
          </div>
        )}
      </div>

      {locked && (
        <div className="flex justify-end">
          <SelectToggle />
        </div>
      )}
      {!locked && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0" role="group" aria-label="Presets" data-testid="presets">
          {presetButtons}
          {/* Select mode: the row boxes stay out until a row is hovered or
              focused, or this is on (round 2: on desktop too). */}
          <span className="order-first shrink-0 md:order-last md:ml-auto">
            <SelectToggle />
          </span>
        </div>
      )}
    </>
  );

  return (
    <div className={`min-w-0 ${phone ? "mb-2 space-y-2" : "mb-4 space-y-3"}`}>
      {top}

      {panelOpen && !phone && <div className="card popover p-3">{groups}</div>}
      {panelOpen && phone && (
        <PhoneSheet title="Filters" onClose={() => setPanelOpen(false)} showLabel={`Show ${total.toLocaleString()} ${noun}`}>
          <div className="mb-3">
            <FilterGroup title="Order">
              {sortControl}
            </FilterGroup>
          </div>
          {groups}
        </PhoneSheet>
      )}

      {/* On a phone the search box itself shows what was typed (and clears
          it), so a search alone adds no row above the cards (round 2). */}
      {(active > 0 || (params.q && !phone)) && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="active-filters">
          {params.q && !phone && <Chip onRemove={() => go({ q: "" })}>“{params.q}”</Chip>}
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
          {params.attn && <Chip onRemove={() => go({ attn: false })}>Missing info</Chip>}
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
          {params.pulses.map((pulse) => (
            <Chip key={`p-${pulse}`} onRemove={() => go({ pulses: toggle(params.pulses, pulse) as PulseKey[] })}>
              Pulse: {PULSE_LABELS[pulse]}
            </Chip>
          ))}
          {params.labels.map((label) => (
            <Chip key={`l-${label}`} onRemove={() => go({ labels: toggle(params.labels, label) })}>
              Lead Label: {labelNames[label] ?? label}
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

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
      <p className="eyebrow w-28 shrink-0">{title}</p>
      <div className="flex flex-wrap items-center gap-2 [&_.btn]:max-md:min-h-[44px]">{children}</div>
    </div>
  );
}

// The Filters panel on a phone: a sheet from the bottom, drawn on the page
// body, with "Show 27 people" pinned at its foot. The dropdowns inside it
// float above it (FloatingMenu sits higher).
function PhoneSheet({ title, onClose, showLabel, children }: { title: string; onClose: () => void; showLabel: string; children: React.ReactNode }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end bg-[var(--scrim)]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="popover flex max-h-[85vh] w-full flex-col rounded-t-2xl border-t border-[var(--hairline-3)]"
        data-testid="filters-sheet"
      >
        <div className="flex items-center justify-between border-b border-[var(--hairline-3)] px-4 py-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm h-11 w-11 !px-0">
            <IconX size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        <div className="border-t border-[var(--hairline-3)] p-3">
          <button type="button" onClick={onClose} className="btn btn-primary h-12 w-full" data-testid="filters-show">
            {showLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Columns: the extra columns a person brings back, remembered for them.
// Ticks show at once (the page is redrawn with the server's columns once
// the choice is saved).
function ColumnsMenu({ kind, columns, onSave }: { kind: "contacts" | "companies"; columns: string[]; onSave: (next: string[]) => Promise<void> | void }) {
  const router = useRouter();
  const [shown, setShown] = useState(columns);
  const [, start] = useTransition();
  useEffect(() => setShown(columns), [columns]);
  const all = columnsFor(kind);
  return (
    <Dropdown label="Columns" count={shown.length} testId="columns">
      {() => (
        <ul aria-label="Columns" className="max-h-72 overflow-y-auto">
          {all.map((key) => (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[var(--hover)]">
                <input
                  type="checkbox"
                  checked={shown.includes(key)}
                  data-testid={`column-${key}`}
                  onChange={() => {
                    const next = shown.includes(key) ? shown.filter((k) => k !== key) : all.filter((k) => k === key || shown.includes(k));
                    setShown(next);
                    start(async () => {
                      await onSave(next);
                      router.refresh();
                    });
                  }}
                  className="h-3.5 w-3.5 accent-[var(--brand)]"
                />
                <span>{COLUMN_LABELS[key]}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
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
//
// Drawn at the end of the page, the menu is no longer next to its button
// in the Tab order, so the keyboard is walked through it by hand. Opened
// with Enter or Space (or a screen reader), the cursor goes to its first
// choice; opened with a click it stays on the button, as it always did,
// and Tab from the button goes into the menu. Tab past the last choice
// closes it and moves on to the filter after the button, Shift+Tab before
// the first closes it back onto the button, and Escape or a pick that
// closes the menu puts the cursor back on the button. A search box marked
// data-autofocus takes the cursor however the menu was opened. The edges
// are two empty stops either side of the choices (FocusGuard), so the
// browser still walks a date box's month / day / year and a radio group.
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
function tabStops(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.tabIndex < 0 || (el as HTMLInputElement).disabled || el.hasAttribute("data-focus-guard") || el.getClientRects().length === 0) return false;
    // A radio group is one stop: its ticked radio, or its first.
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      const group = Array.from(root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`));
      return (group.find((radio) => radio.checked) ?? group[0]) === el;
    }
    return true;
  });
}
function FocusGuard({ onFocus }: { onFocus: () => void }) {
  return <span tabIndex={0} data-focus-guard="" className="sr-only" onFocus={onFocus} />;
}

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

  // Where the cursor goes in: the search box, else the first choice.
  const firstStop = () => panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? (panel.current ? tabStops(panel.current)[0] : undefined);
  // Opened from the keyboard: a click with no click count (Enter, Space,
  // a screen reader's press).
  const fromKeys = useRef(false);

  // The menu is drawn hidden until it has measured where it fits, and a
  // hidden box can't take focus, so the cursor goes in on the next frame,
  // once the menu is on screen.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const box = panel.current;
      if (!box || box.contains(document.activeElement)) return;
      const target = fromKeys.current ? firstStop() : box.querySelector<HTMLElement>("[data-autofocus]");
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Closed while the cursor was inside (Escape, a pick that closes it):
  // the box it was in has gone, so it goes back to the button. Only when it
  // was left on nothing; a click on something else keeps it there.
  const inside = useRef(false);
  useEffect(() => {
    if (!open) {
      const left = inside.current;
      inside.current = false;
      if (left && (!document.activeElement || document.activeElement === document.body)) button.current?.focus({ preventScroll: true });
      return;
    }
    const track = () => {
      inside.current = !!panel.current?.contains(document.activeElement);
    };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, [open]);

  // Tabbed off either end of the menu: back to the button, or on to the
  // next thing after it on the page.
  function leave(forward: boolean) {
    const anchor = button.current;
    const next = forward && anchor
      ? tabStops(document.body).find((el) => !panel.current?.contains(el) && !!(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
      : null;
    (next ?? anchor)?.focus();
    close();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={(event) => {
          fromKeys.current = event.detail === 0;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (!open || event.key !== "Tab" || event.shiftKey) return;
          const target = firstStop();
          if (!target) return;
          event.preventDefault();
          target.focus({ preventScroll: true });
        }}
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
        <FocusGuard onFocus={() => leave(false)} />
        <div ref={panel} className="py-1">
          {children(close)}
        </div>
        <FocusGuard onFocus={() => leave(true)} />
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
            <div className="border-b border-[var(--hairline-3)] p-2">
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
            <div className="border-t border-[var(--hairline-3)] px-3 py-1.5">
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
            <div className="border-b border-[var(--hairline-3)] p-2">
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
              <div className="border-t border-[var(--hairline-3)] px-3 py-1.5">
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
            <li className="border-t border-[var(--hairline-3)] px-3 py-1.5">
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
          <div className="border-b border-[var(--hairline-3)] p-2">
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
            <div className="border-t border-[var(--hairline-3)] px-3 py-1.5">
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
