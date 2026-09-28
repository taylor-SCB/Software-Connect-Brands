"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addDays } from "@/lib/payments";
import { shiftMonth, startOfMonth, startOfWeek } from "@/lib/calendar";
import { UNASSIGNED_USER } from "@/lib/calendar-filters";
import { useSearch } from "@/lib/use-search";
import { FormError, FormSuccess } from "@/components/ui";
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconPlus,
  IconX,
} from "@/components/icons";
import { EventForm, type EventChoices } from "./event-form";
import { copyWeek } from "./actions";

export type CalendarLayout = "calendar" | "log" | "both";

export type CalendarFilterState = {
  crewId: string;
  type: string;
  userIds: string[];
  companyIds: string[];
  contactIds: string[];
  projectIds: string[];
};

type Named = { id: string; name: string };

// Paging, the month/week switch, the layout switch, the filters and
// "+ Event". Everything that moves the view is in the address bar, so a
// week you are looking at can be sent to somebody or kept as a bookmark.
export function CalendarToolbar({
  view,
  layout,
  anchor,
  today,
  choices,
  filters,
  labels,
}: {
  view: "month" | "week";
  layout: CalendarLayout;
  // The first of the month, or the Sunday of the week.
  anchor: string;
  today: string;
  choices: EventChoices;
  filters: CalendarFilterState;
  // Names for the ids in the filters, resolved by the server, so a chip
  // reads as a company and not a code — including one the pickers' 200
  // do not reach.
  labels: { companies: Named[]; contacts: Named[]; projects: Named[] };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [copyState, setCopyState] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();

  const go = (changes: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      const joined = Array.isArray(value) ? value.join(",") : value;
      if (joined === null || joined === "") next.delete(key);
      else next.set(key, joined);
    }
    router.push(`/dashboard/calendar?${next.toString()}`);
  };

  const step = (direction: -1 | 1) =>
    go({ on: view === "month" ? shiftMonth(anchor, direction) : addDays(anchor, direction * 7) });

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const filtering =
    Boolean(filters.crewId || filters.type) ||
    filters.userIds.length + filters.companyIds.length + filters.contactIds.length + filters.projectIds.length > 0;

  const justMe = filters.userIds.length === 1 && filters.userIds[0] === choices.me;
  const userName = (id: string) =>
    id === UNASSIGNED_USER ? "Unassigned" : (choices.users.find((user) => user.id === id)?.name ?? "…");

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {layout !== "log" && (
          <>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={view === "month" ? "The month before" : "The week before"}
                className="btn btn-ghost btn-sm !px-1.5"
                data-testid="cal-prev"
              >
                <IconChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => go({ on: view === "month" ? startOfMonth(today) : startOfWeek(today) })}
                className="btn btn-ghost btn-sm"
                data-testid="cal-today"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={view === "month" ? "The month after" : "The week after"}
                className="btn btn-ghost btn-sm !px-1.5"
                data-testid="cal-next"
              >
                <IconChevronRight size={14} />
              </button>
            </div>

            <div className="flex gap-1" role="tablist" aria-label="How much to show">
              {(["month", "week"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={view === option}
                  onClick={() =>
                    go({
                      view: option,
                      on: option === "month" ? startOfMonth(anchor) : startOfWeek(anchor),
                    })
                  }
                  className={`btn btn-sm ${view === option ? "btn-primary" : "btn-ghost"}`}
                  data-testid={`cal-view-${option}`}
                >
                  {option === "month" ? "Month" : "Week"}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex gap-1" role="tablist" aria-label="How to lay it out">
          {(
            [
              ["calendar", "Calendar"],
              ["log", "Log"],
              ["both", "Calendar + Log"],
            ] as const
          ).map(([option, label]) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={layout === option}
              onClick={() => go({ layout: option === "calendar" ? null : option })}
              className={`btn btn-sm ${layout === option ? "btn-primary" : "btn-ghost"}`}
              data-testid={`cal-layout-${option}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {view === "week" && layout !== "log" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setCopyState({});
                  const result = await copyWeek({
                    weekOf: anchor,
                    crewId: filters.crewId || undefined,
                    type: filters.type || undefined,
                  });
                  setCopyState(result ?? {});
                })
              }
              className="btn btn-ghost btn-sm"
              data-testid="cal-copy-week"
            >
              <IconCopy size={13} />
              {pending ? "Copying…" : "Copy this week into next"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding(!adding)}
            className="btn btn-primary btn-sm"
            data-testid="cal-add-event"
          >
            <IconPlus size={13} />
            {adding ? "Close" : "Event"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="cal-filters">
        {/* The company view: everyone's days, or just mine, or a pick of teammates. */}
        <div className="flex gap-1" role="group" aria-label="Whose calendar">
          <button
            type="button"
            aria-pressed={filters.userIds.length === 0}
            onClick={() => go({ users: null })}
            className={`btn btn-sm ${filters.userIds.length === 0 ? "btn-primary" : "btn-ghost"}`}
            data-testid="cal-everyone"
          >
            Everyone
          </button>
          <button
            type="button"
            aria-pressed={justMe}
            onClick={() => go({ users: justMe ? null : [choices.me] })}
            className={`btn btn-sm ${justMe ? "btn-primary" : "btn-ghost"}`}
            data-testid="cal-just-me"
          >
            Just me
          </button>
        </div>
        <MultiSelect
          label="Users"
          testId="cal-users"
          values={filters.userIds}
          rows={[...choices.users, { id: UNASSIGNED_USER, name: "Unassigned" }]}
          onToggle={(id) => go({ users: toggle(filters.userIds, id) })}
          onReset={() => go({ users: null })}
        />
        <SearchSelect
          label="Companies"
          testId="cal-companies"
          values={filters.companyIds}
          selected={labels.companies}
          fallback={choices.companies}
          searchUrl="/dashboard/companies/search"
          onToggle={(id) => go({ companies: toggle(filters.companyIds, id) })}
          onReset={() => go({ companies: null })}
        />
        <SearchSelect
          label="Contacts"
          testId="cal-contacts"
          values={filters.contactIds}
          selected={labels.contacts}
          fallback={choices.contacts}
          searchUrl="/dashboard/contacts/search"
          onToggle={(id) => go({ contacts: toggle(filters.contactIds, id) })}
          onReset={() => go({ contacts: null })}
        />
        <MultiSelect
          label="Projects"
          testId="cal-projects"
          values={filters.projectIds}
          rows={[
            ...labels.projects.filter((project) => !choices.projects.some((entry) => entry.id === project.id)),
            ...choices.projects.map((project) => ({ id: project.id, name: project.label })),
          ]}
          onToggle={(id) => go({ projects: toggle(filters.projectIds, id) })}
          onReset={() => go({ projects: null })}
          searchable
        />

        <select
          value={filters.crewId}
          onChange={(fired) => go({ crew: fired.target.value || null })}
          aria-label="Which crew's days to show"
          className="select input-sm w-40"
          data-testid="cal-crew-filter"
        >
          <option value="">Every crew</option>
          {choices.crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
              {crew.kind === "SUBCONTRACTOR" ? " (sub)" : ""}
            </option>
          ))}
        </select>

        <select
          value={filters.type}
          onChange={(fired) => go({ type: fired.target.value || null })}
          aria-label="Which kind of activity to show"
          className="select input-sm w-44"
          data-testid="cal-type-filter"
        >
          <option value="">Every activity</option>
          {choices.eventTypes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {filtering && (
          <button
            type="button"
            onClick={() => go({ crew: null, type: null, users: null, companies: null, contacts: null, projects: null })}
            className="btn btn-ghost btn-sm"
          >
            Clear
          </button>
        )}
      </div>

      {filters.userIds.length + filters.companyIds.length + filters.contactIds.length + filters.projectIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="cal-active-filters">
          {filters.userIds.map((id) => (
            <Chip key={`u-${id}`} onRemove={() => go({ users: toggle(filters.userIds, id) })}>
              {userName(id)}
            </Chip>
          ))}
          {filters.companyIds.map((id) => (
            <Chip key={`c-${id}`} onRemove={() => go({ companies: toggle(filters.companyIds, id) })}>
              Company: {labels.companies.find((row) => row.id === id)?.name ?? "…"}
            </Chip>
          ))}
          {filters.contactIds.map((id) => (
            <Chip key={`p-${id}`} onRemove={() => go({ contacts: toggle(filters.contactIds, id) })}>
              Contact: {labels.contacts.find((row) => row.id === id)?.name ?? "…"}
            </Chip>
          ))}
          {filters.projectIds.map((id) => (
            <Chip key={`j-${id}`} onRemove={() => go({ projects: toggle(filters.projectIds, id) })}>
              {labels.projects.find((row) => row.id === id)?.name ?? "…"}
            </Chip>
          ))}
        </div>
      )}

      <FormError message={copyState.error} />
      <FormSuccess message={copyState.success} />

      {adding && (
        <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4">
          <EventForm
            choices={choices}
            defaults={{ startOn: view === "week" && layout !== "log" ? anchor : today }}
            onDone={() => setAdding(false)}
          />
        </div>
      )}
    </div>
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
// Escape. Ticks apply straight away. Drawn on .popover, never bare
// .card: it floats over the calendar and has to be opaque.
function Dropdown({
  label,
  count,
  children,
  testId,
  onOpenChange,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
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
      {open && <div className="card popover absolute left-0 top-full z-30 mt-1 w-72 py-1">{children}</div>}
    </div>
  );
}

function Row({ row, on, onToggle }: { row: Named; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[rgb(255_255_255/0.04)]">
        <input type="checkbox" checked={on} onChange={onToggle} className="h-3.5 w-3.5 accent-[var(--brand)]" />
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        {on && <IconCheck size={11} className="text-[var(--ok)]" />}
      </label>
    </li>
  );
}

function ResetLine({ label, count, onReset }: { label: string; count: number; onReset: () => void }) {
  if (count === 0) return null;
  return (
    <div className="border-t border-[var(--border)] px-3 py-1.5">
      <button type="button" onClick={onReset} className="link text-xs">
        Reset {label.toLowerCase()}
      </button>
    </div>
  );
}

// A checklist over a list the page already has (users, open projects),
// with a search box when the list is long enough to want one.
function MultiSelect({
  label,
  testId,
  values,
  rows,
  onToggle,
  onReset,
  searchable = false,
}: {
  label: string;
  testId: string;
  values: string[];
  rows: Named[];
  onToggle: (id: string) => void;
  onReset: () => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((row) => row.name.toLowerCase().includes(q) || values.includes(row.id)) : rows;
  return (
    <Dropdown label={label} count={values.length} testId={testId}>
      {searchable && (
        <div className="border-b border-[var(--border)] p-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label.toLowerCase()}`}
            autoFocus
            className="input input-sm"
          />
        </div>
      )}
      <ul role="listbox" aria-label={label} aria-multiselectable="true" className="max-h-64 overflow-y-auto">
        {shown.length === 0 && <li className="faint px-3 py-3 text-xs">Nothing to pick from yet.</li>}
        {shown.map((row) => (
          <Row key={row.id} row={row} on={values.includes(row.id)} onToggle={() => onToggle(row.id)} />
        ))}
      </ul>
      <ResetLine label={label} count={values.length} onReset={onReset} />
    </Dropdown>
  );
}

// A checklist that searches the server as you type (companies, contacts),
// because a workspace can hold thousands of either. Until something is
// typed it offers the first two hundred by name, with whatever is ticked
// kept at the top.
function SearchSelect({
  label,
  testId,
  values,
  selected,
  fallback,
  searchUrl,
  onToggle,
  onReset,
}: {
  label: string;
  testId: string;
  values: string[];
  selected: Named[];
  fallback: Named[];
  searchUrl: string;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim();
  const { results, loading } = useSearch<Named>(open && q ? `${searchUrl}?q=${encodeURIComponent(q)}` : null);
  const pool = q ? results : fallback;
  const rows = [...selected.filter((row) => !pool.some((other) => other.id === row.id)), ...pool];

  return (
    <Dropdown label={label} count={values.length} testId={testId} onOpenChange={setOpen}>
      <div className="border-b border-[var(--border)] p-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          aria-label={`Search ${label.toLowerCase()}`}
          autoFocus
          className="input input-sm"
        />
      </div>
      <ul role="listbox" aria-label={label} aria-multiselectable="true" className="max-h-64 overflow-y-auto">
        {rows.map((row) => (
          <Row key={row.id} row={row} on={values.includes(row.id)} onToggle={() => onToggle(row.id)} />
        ))}
        {!loading && rows.length === 0 && (
          <li className="faint px-3 py-3 text-xs">{q ? `No ${label.toLowerCase()} match.` : `No ${label.toLowerCase()} yet.`}</li>
        )}
      </ul>
      <ResetLine label={label} count={values.length} onReset={onReset} />
    </Dropdown>
  );
}
