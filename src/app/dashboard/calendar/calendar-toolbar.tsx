"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addDays } from "@/lib/payments";
import { isRealDay, shiftMonth, startOfMonth } from "@/lib/calendar";
import { readIds, UNASSIGNED_USER } from "@/lib/calendar-filters";
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
  IconFilter,
} from "@/components/icons";
import { EventForm, type EventChoices } from "./event-form";
import { copyWeek } from "./actions";
import { FloatingMenu } from "@/components/floating-menu";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { saveUiPref } from "../prefs-actions";

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
  scope,
  layout,
  anchor,
  focus,
  today,
  choices,
  filters,
  labels,
}: {
  view: "agenda" | "month" | "week" | "team";
  // Mine / Team (BDR redesign, Nov 11, 2026): whose days the page shows
  // when the address bar names no users — the person's remembered choice
  // (User.uiPrefs calendar.scope), else Mine for a Member and Team for an
  // Owner or Admin. "custom" is a pick of users from the Users menu.
  scope: "mine" | "team" | "custom";
  layout: CalendarLayout;
  // The first of the month, or the Sunday of the week.
  anchor: string;
  // The day the address bar asked for. The grid snaps to its month or
  // week, but the day itself is kept, so Month -> Week -> Month lands
  // back where it started instead of a month earlier each round trip.
  focus: string;
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
  const [viewOpen, setViewOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const viewButton = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();

  // What the address bar will say once the last click lands. Every click
  // builds on this rather than on the page on screen: while a click is
  // still loading, the page (and useSearchParams) still show the one
  // before, and building on that undid the click — a filter ticked right
  // after "next month" threw you back a month (Sept 30, 2026).
  const live = useRef<URLSearchParams>(new URLSearchParams(params.toString()));
  useEffect(() => {
    live.current = new URLSearchParams(params.toString());
  }, [params]);

  const go = (changes: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(live.current.toString());
    for (const [key, value] of Object.entries(changes)) {
      const joined = Array.isArray(value) ? value.join(",") : value;
      if (joined === null || joined === "") next.delete(key);
      else next.set(key, joined);
    }
    live.current = next;
    router.push(`/dashboard/calendar?${next.toString()}`);
  };

  const liveView = () => {
    const value = live.current.get("view");
    return value === "week" || value === "team" || value === "agenda" ? value : "month";
  };

  // Agenda / Week / Month is remembered for the person (Round 2); the Team
  // week is a look at everyone, not a way of working, so it isn't.
  const showView = (option: "agenda" | "week" | "month" | "team") => {
    if (option !== "team") void saveUiPref("calendar", "view", option);
    goView(option);
  };
  const goView = (option: "agenda" | "week" | "month" | "team") =>
    go(
      option === "month"
        ? { view: live.current.get("on") ? null : "month", layout: null }
        : option === "agenda"
          ? { view: "agenda", layout: null, on: null }
          : { view: option },
    );

  // Mine / Team is remembered for the person before the page moves, so
  // the next visit (and the server drawing this one) opens on it.
  const pickScope = (next: "mine" | "team") =>
    start(async () => {
      await saveUiPref("calendar", "scope", next);
      go({ users: next === "mine" ? [choices.me] : null });
      router.refresh();
    });
  const liveFocus = () => {
    const value = live.current.get("on") ?? undefined;
    return isRealDay(value) ? value : today;
  };

  // Paging keeps a real day in the address bar, never just the snapped
  // 1st or Sunday: a month step lands on today when it comes back to this
  // month, a week step moves the day itself by seven.
  const step = (direction: -1 | 1) => {
    const day = liveFocus();
    if (liveView() === "agenda") {
      go({ view: "week", on: addDays(day, direction * 7) });
    } else if (liveView() === "month") {
      const month = shiftMonth(startOfMonth(day), direction);
      go({ on: month === startOfMonth(today) ? today : month });
    } else {
      go({ on: addDays(day, direction * 7) });
    }
  };

  // A filter list as the address bar will have it, not as the page shows it.
  const toggleIn = (key: string, value: string) => {
    const list = readIds(live.current.get(key) ?? undefined);
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  };

  const filtering =
    Boolean(filters.crewId || filters.type) ||
    filters.userIds.length + filters.companyIds.length + filters.contactIds.length + filters.projectIds.length > 0;

  const justMe = scope === "mine";
  const userName = (id: string) =>
    id === UNASSIGNED_USER ? "Unassigned" : (choices.users.find((user) => user.id === id)?.name ?? "…");

  const filterCount =
    (filters.crewId ? 1 : 0) +
    (filters.type ? 1 : 0) +
    filters.userIds.length +
    filters.companyIds.length +
    filters.contactIds.length +
    filters.projectIds.length;
  const crewName = choices.crews.find((crew) => crew.id === filters.crewId)?.name ?? "…";
  const clearAll = () =>
    start(async () => {
      await saveUiPref("calendar", "scope", "team");
      go({ crew: null, type: null, users: null, companies: null, contacts: null, projects: null });
      router.refresh();
    });

  // BDR redesign (Nov 11, 2026): one row — [Mine | Team] [Agenda · Week ·
  // Month] [‹ Today ›] [View ▾] [Filters (n)] [+ New]. Nothing went away:
  // the Team week, Calendar / Log / Calendar + Log and Copy this week into
  // next are in View; Users, Companies, Contacts, Projects, the crew and
  // the activity are in Filters, a sheet (a bottom sheet on a phone), and
  // every filter that is on shows as a chip under the row. On a phone,
  // Month sits in View.
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Whose calendar">
          <button
            type="button"
            aria-pressed={justMe}
            onClick={() => pickScope(justMe ? "team" : "mine")}
            className={`btn btn-sm pointer-coarse:min-h-11 ${justMe ? "btn-primary" : "btn-ghost"}`}
            data-testid="cal-just-me"
          >
            Mine
          </button>
          <button
            type="button"
            aria-pressed={scope === "team"}
            onClick={() => pickScope("team")}
            className={`btn btn-sm pointer-coarse:min-h-11 ${scope === "team" ? "btn-primary" : "btn-ghost"}`}
            data-testid="cal-everyone"
          >
            Team
          </button>
        </div>

        <div className="flex gap-1" role="tablist" aria-label="How much to show">
          {(["agenda", "week", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              // The day stays put; the server snaps it to the month or
              // week. Snapping here, from the already-snapped anchor,
              // lost a month every Month -> Week -> Month.
              onClick={() => showView(option)}
              className={`btn btn-sm pointer-coarse:min-h-11 ${option === "month" ? "hidden sm:inline-flex" : ""} ${view === option ? "btn-primary" : "btn-ghost"}`}
              data-testid={`cal-view-${option}`}
            >
              {option === "agenda" ? "Agenda" : option === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>

        {layout !== "log" && view !== "agenda" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={view === "month" ? "The month before" : "The week before"}
              className="btn btn-ghost btn-sm !px-1.5 pointer-coarse:min-h-11"
              data-testid="cal-prev"
            >
              <IconChevronLeft size={14} />
            </button>
            <button type="button" onClick={() => go({ on: null })} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="cal-today">
              Today
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={view === "month" ? "The month after" : "The week after"}
              className="btn btn-ghost btn-sm !px-1.5 pointer-coarse:min-h-11"
              data-testid="cal-next"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            ref={viewButton}
            type="button"
            onClick={() => setViewOpen(!viewOpen)}
            aria-expanded={viewOpen}
            aria-haspopup="menu"
            className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
            data-testid="cal-view-menu"
          >
            View
            <IconChevronDown size={12} className="opacity-70" />
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-haspopup="dialog"
            className={`btn btn-sm pointer-coarse:min-h-11 ${filterCount > 0 ? "btn-primary" : "btn-ghost"}`}
            data-testid="cal-filters-open"
          >
            <IconFilter size={12} />
            Filters{filterCount > 0 ? ` (${filterCount})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn btn-primary btn-sm pointer-coarse:min-h-11"
            data-testid="cal-add-event"
          >
            <IconPlus size={13} />
            New
          </button>
        </div>
      </div>

      <FloatingMenu anchor={viewButton} open={viewOpen} onClose={() => setViewOpen(false)} width={260} testId="cal-view-panel" label="View">
        <div className="space-y-3 p-3">
          <div className="sm:hidden">
            <button
              type="button"
              onClick={() => {
                setViewOpen(false);
                showView("month");
              }}
              className={`btn btn-sm w-full min-h-11 ${view === "month" ? "btn-primary" : "btn-ghost"}`}
              data-testid="cal-view-month-phone"
            >
              Month
            </button>
          </div>
          <div>
            <p className="eyebrow mb-1">The team</p>
            <button
              type="button"
              role="tab"
              aria-selected={view === "team"}
              onClick={() => {
                setViewOpen(false);
                showView("team");
              }}
              className={`btn btn-sm w-full pointer-coarse:min-h-11 ${view === "team" ? "btn-primary" : "btn-ghost"}`}
              data-testid="cal-view-team"
            >
              Team week, a row each
            </button>
          </div>
          {view !== "agenda" && (
            <div role="tablist" aria-label="How to lay it out">
              <p className="eyebrow mb-1">Lay it out as</p>
              <div className="grid gap-1">
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
                    onClick={() => {
                      setViewOpen(false);
                      go({ layout: option === "calendar" ? null : option });
                    }}
                    className={`btn btn-sm pointer-coarse:min-h-11 ${layout === option ? "btn-primary" : "btn-ghost"}`}
                    data-testid={`cal-layout-${option}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
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
                  setViewOpen(false);
                })
              }
              className="btn btn-ghost btn-sm w-full pointer-coarse:min-h-11"
              data-testid="cal-copy-week"
            >
              <IconCopy size={13} />
              {pending ? "Copying…" : "Copy this week into next"}
            </button>
          )}
        </div>
      </FloatingMenu>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        testId="cal-filters-sheet"
        footer={
          <div className="flex gap-2">
            {filtering && (
              <button type="button" onClick={clearAll} className="btn btn-ghost min-h-11" data-testid="cal-filters-clear">
                Clear all
              </button>
            )}
            <button type="button" onClick={() => setFiltersOpen(false)} className="btn btn-primary ml-auto min-h-11" data-testid="cal-filters-done">
              Done
            </button>
          </div>
        }
      >
        <div className="space-y-3" data-testid="cal-filters">
          <section className="space-y-1.5">
            <p className="eyebrow">Who</p>
            <MultiSelect
              label="Users"
              testId="cal-users"
              values={filters.userIds}
              rows={[...choices.users, { id: UNASSIGNED_USER, name: "Unassigned" }]}
              onToggle={(id) => go({ users: toggleIn("users", id) })}
              onReset={() => go({ users: null })}
            />
            <SearchSelect
              label="Companies"
              testId="cal-companies"
              values={filters.companyIds}
              selected={labels.companies}
              fallback={choices.companies}
              searchUrl="/dashboard/companies/search"
              onToggle={(id) => go({ companies: toggleIn("companies", id) })}
              onReset={() => go({ companies: null })}
            />
            <SearchSelect
              label="Contacts"
              testId="cal-contacts"
              values={filters.contactIds}
              selected={labels.contacts}
              fallback={choices.contacts}
              searchUrl="/dashboard/contacts/search"
              onToggle={(id) => go({ contacts: toggleIn("contacts", id) })}
              onReset={() => go({ contacts: null })}
            />
          </section>
          <section className="space-y-1.5">
            <p className="eyebrow">Work</p>
            <MultiSelect
              label="Projects"
              testId="cal-projects"
              values={filters.projectIds}
              rows={[
                ...labels.projects.filter((project) => !choices.projects.some((entry) => entry.id === project.id)),
                ...choices.projects.map((project) => ({ id: project.id, name: project.label })),
              ]}
              onToggle={(id) => go({ projects: toggleIn("projects", id) })}
              onReset={() => go({ projects: null })}
              searchable
            />
            <select
              value={filters.crewId}
              onChange={(fired) => go({ crew: fired.target.value || null })}
              aria-label="Which crew's days to show"
              className="select w-full"
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
              className="select w-full"
              data-testid="cal-type-filter"
            >
              <option value="">Every activity</option>
              {choices.eventTypes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </section>
        </div>
      </Sheet>

      {filtering && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="cal-active-filters">
          {filters.userIds.map((id) => (
            <Chip key={`u-${id}`} onRemove={() => go({ users: toggleIn("users", id) })}>
              {userName(id)}
            </Chip>
          ))}
          {filters.companyIds.map((id) => (
            <Chip key={`c-${id}`} onRemove={() => go({ companies: toggleIn("companies", id) })}>
              Company: {labels.companies.find((row) => row.id === id)?.name ?? "…"}
            </Chip>
          ))}
          {filters.contactIds.map((id) => (
            <Chip key={`p-${id}`} onRemove={() => go({ contacts: toggleIn("contacts", id) })}>
              Contact: {labels.contacts.find((row) => row.id === id)?.name ?? "…"}
            </Chip>
          ))}
          {filters.projectIds.map((id) => (
            <Chip key={`j-${id}`} onRemove={() => go({ projects: toggleIn("projects", id) })}>
              {labels.projects.find((row) => row.id === id)?.name ?? "…"}
            </Chip>
          ))}
          {filters.crewId && <Chip onRemove={() => go({ crew: null })}>Crew: {crewName}</Chip>}
          {filters.type && <Chip onRemove={() => go({ type: null })}>{filters.type}</Chip>}
          <button type="button" onClick={clearAll} className="btn btn-ghost btn-sm pointer-coarse:min-h-11">
            Clear
          </button>
        </div>
      )}

      <FormError message={copyState.error} />
      <FormSuccess message={copyState.success} />

      <Sheet open={adding} onClose={() => setAdding(false)} title="New entry" testId="cal-new-sheet">
        <EventForm
          choices={choices}
          quick
          defaults={{
            startOn: view !== "month" && view !== "agenda" && layout !== "log" ? focus : today,
            type: choices.eventTypes.find((name) => name.toLowerCase() === "call"),
          }}
          onDone={() => setAdding(false)}
        />
      </Sheet>
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
    <div ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
        className={`btn btn-sm w-full justify-between pointer-coarse:min-h-11 ${count > 0 ? "btn-primary" : "btn-ghost"}`}
      >
        {label}
        {count > 0 && <span className="num rounded-full bg-[var(--tint-5)] px-1.5 text-[0.65rem]">{count}</span>}
        <IconChevronDown size={12} className="opacity-70" />
      </button>
      {/* In the Filters sheet the list opens in place, under its button. */}
      {open && <div className="card popover mt-1 w-full py-1">{children}</div>}
    </div>
  );
}

function Row({ row, on, onToggle }: { row: Named; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-[var(--hover)]">
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
    <div className="border-t border-[var(--hairline-3)] px-3 py-1.5">
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
        <div className="border-b border-[var(--hairline-3)] p-2">
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
      <div className="border-b border-[var(--hairline-3)] p-2">
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
