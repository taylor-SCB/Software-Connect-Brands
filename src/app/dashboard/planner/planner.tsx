"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { MultiSelect } from "@/components/list-filters";
import { EntryActions } from "@/components/entry-actions";
import { useHowDidItGo } from "@/components/how-did-it-go/how-did-it-go";
import { IconCalendar, IconSparkles, IconTrash, IconPlus } from "@/components/icons";
import { formatDay } from "@/lib/format";
import type { PlannedEntry, PlannerChoices, PlannerCriteria, PlannerKind, PlannerPerson, PlannerType } from "@/lib/planner";
import { createPlannerBatch, plannerFromText, previewPlanner, undoPlannerBatch } from "./actions";

const MAX_ROWS = 6;
const TYPE_WORDS: Record<PlannerType, string> = { PHONE_CALL: "Call", EMAIL: "Email", TEXT: "Text" };
const KINDS: { key: PlannerKind; label: string; sub: string }[] = [
  { key: "warm", label: "Warm leads", sub: "People with at least one logged touch, warmest first" },
  { key: "cold", label: "Cold leads", sub: "Nobody has logged a touch yet, newest first" },
  { key: "mix", label: "Warm + Cold mix", sub: "Half and half, topped up from whichever has more" },
];

type Row = { on: string; type: PlannerType };

function plusDays(day: string, n: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function Planner({
  today,
  tab,
  choices,
  statusLabels,
  initial,
  ai,
  planned,
}: {
  today: string;
  tab: "plan" | "planned";
  choices: PlannerChoices;
  statusLabels: Record<string, string>;
  initial: { criteria: PlannerCriteria; kind: PlannerKind | null; text: string };
  ai: boolean;
  planned: { entries: PlannedEntry[]; more: boolean };
}) {
  return (
    <div className="space-y-5">
      <nav className="flex gap-1.5" aria-label="Planner" data-testid="planner-tabs">
        <Link
          href="/dashboard/planner"
          className={`btn btn-sm pointer-coarse:min-h-11 ${tab === "plan" ? "btn-primary" : "btn-ghost"}`}
          aria-current={tab === "plan" ? "page" : undefined}
          data-testid="planner-tab-plan"
        >
          Plan
        </Link>
        <Link
          href="/dashboard/planner?tab=planned"
          className={`btn btn-sm pointer-coarse:min-h-11 ${tab === "planned" ? "btn-primary" : "btn-ghost"}`}
          aria-current={tab === "planned" ? "page" : undefined}
          data-testid="planner-tab-planned"
        >
          Planned{planned.entries.length ? ` · ${planned.entries.length}${planned.more ? "+" : ""}` : ""}
        </Link>
      </nav>
      {tab === "plan" ? (
        <PlanTab today={today} choices={choices} statusLabels={statusLabels} initial={initial} ai={ai} />
      ) : (
        <PlannedTab today={today} planned={planned} />
      )}
    </div>
  );
}

/* --------------------------------- Plan --------------------------------- */

function PlanTab({
  today,
  choices,
  statusLabels,
  initial,
  ai,
}: {
  today: string;
  choices: PlannerChoices;
  statusLabels: Record<string, string>;
  initial: { criteria: PlannerCriteria; kind: PlannerKind | null; text: string };
  ai: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial.text);
  const [criteria, setCriteria] = useState<PlannerCriteria>(initial.criteria);
  const [kind, setKind] = useState<PlannerKind | null>(initial.kind);
  const [rows, setRows] = useState<Row[]>([{ on: today, type: "PHONE_CALL" }]);
  const [people, setPeople] = useState<PlannerPerson[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [toast, setToast] = useState<{ batchId: string; words: string; at: number } | null>(null);
  const [pending, start] = useTransition();
  const ranText = useRef(false);

  const toggle = (key: keyof Omit<PlannerCriteria, "neverContacted">) => (value: string) => {
    setPeople(null);
    setCriteria((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((v) => v !== value) : [...current[key], value],
    }));
  };
  const clear = (key: keyof Omit<PlannerCriteria, "neverContacted">) => () => {
    setPeople(null);
    setCriteria((current) => ({ ...current, [key]: [] }));
  };

  function readText(words = text) {
    if (!words.trim()) return;
    setError(null);
    setAiNote(null);
    setReading(true);
    start(async () => {
      const result = await plannerFromText(words);
      start(() => {
        setReading(false);
        if ("error" in result) {
          setAiNote(result.error);
          return;
        }
        setPeople(null);
        setCriteria(result.criteria);
        if (result.kind && !kind) setKind(result.kind as PlannerKind);
        const picked = Object.values(result.criteria).flat().filter((v) => typeof v === "string").length + (result.criteria.neverContacted ? 1 : 0);
        setAiNote(
          picked
            ? `Filters set from your words${result.dropped ? ` (${result.dropped} not in your CRM left out)` : ""}. Change any of them below.`
            : "Couldn't match those words to your CRM's titles, industries, types, stages or places. Pick the filters below.",
        );
      });
    });
  }

  // Opened from the dashboard's box with words: read them once.
  useEffect(() => {
    if (ranText.current || !initial.text || !ai) return;
    ranText.current = true;
    readText(initial.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowsOk = rows.length > 0 && rows.every((row) => row.on && row.on >= today);

  function generate() {
    if (!kind) return setError("Pick Warm, Cold or Warm + Cold mix first.");
    if (!rowsOk) return setError("Every row needs a date, today or later.");
    setError(null);
    start(async () => {
      const result = await previewPlanner({ criteria, kind, rows });
      start(() => {
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setPeople(result.people);
        setTicked(new Set(result.people.map((person) => person.id)));
      });
    });
  }

  function create() {
    const ids = (people ?? []).filter((person) => ticked.has(person.id)).map((person) => person.id);
    if (!ids.length) return setError("Tick at least one person.");
    setError(null);
    start(async () => {
      const result = await createPlannerBatch({ contactIds: ids, rows });
      start(() => {
        if ("error" in result) {
          setError(result.error);
          return;
        }
        const skipped = result.skipped ? ` · ${result.skipped} skipped (booked or worked since)` : "";
        setToast({
          batchId: result.batchId,
          words: `Planned ${result.people} ${result.people === 1 ? "person" : "people"} · ${result.entries} ${result.entries === 1 ? "entry" : "entries"} on your calendar${skipped}`,
          at: Date.now(),
        });
        setPeople(null);
        router.refresh();
      });
    });
  }

  const tickedCount = people?.filter((person) => ticked.has(person.id)).length ?? 0;
  const anyFilter = useMemo(() => Object.values(criteria).some((value) => (Array.isArray(value) ? value.length > 0 : value)), [criteria]);

  return (
    <div className="space-y-5" data-testid="planner-plan">
      <Card className="space-y-3 p-4 sm:p-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Who do you want to reach?</span>
          <textarea
            className="textarea"
            rows={2}
            maxLength={600}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. property managers in Texas we've never contacted"
            data-testid="planner-text"
          />
        </label>
        {ai ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => readText()} disabled={pending || !text.trim()} data-testid="planner-read">
              <IconSparkles size={13} />
              {reading ? "Reading…" : "Turn into filters"}
            </button>
            {aiNote && (
              <span className="muted text-xs" role="status" data-testid="planner-ai-note">
                {aiNote}
              </span>
            )}
          </div>
        ) : (
          <p className="faint text-xs">Pick the filters below.</p>
        )}

        <div className="flex flex-wrap items-center gap-2" data-testid="planner-filters">
          <MultiSelect label="Job title" values={criteria.titles} choices={choices.titles} onToggle={toggle("titles")} onClear={clear("titles")} empty="No job titles on file" searchable />
          <MultiSelect label="Industry" values={criteria.industries} choices={choices.industries} onToggle={toggle("industries")} onClear={clear("industries")} empty="No industries on file" searchable />
          <MultiSelect label="Company type" values={criteria.companyTypes} choices={choices.companyTypes} onToggle={toggle("companyTypes")} onClear={clear("companyTypes")} empty="No company types on file" searchable />
          <MultiSelect label="Stage" values={criteria.statuses} choices={choices.statuses} labels={statusLabels} onToggle={toggle("statuses")} onClear={clear("statuses")} empty="No stages" />
          <MultiSelect label="State" values={criteria.states} choices={choices.states} onToggle={toggle("states")} onClear={clear("states")} empty="No states on file" searchable />
          <MultiSelect label="City" values={criteria.cities} choices={choices.cities} onToggle={toggle("cities")} onClear={clear("cities")} empty="No cities on file" searchable />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={criteria.neverContacted}
              onChange={(e) => {
                setPeople(null);
                setCriteria((current) => ({ ...current, neverContacted: e.target.checked }));
              }}
              className="h-4 w-4 accent-[var(--brand)]"
              data-testid="planner-never"
            />
            Never contacted
          </label>
        </div>
        {anyFilter && (
          <p className="flex flex-wrap gap-1.5 text-xs" data-testid="planner-chips">
            {[
              ...criteria.titles.map((v) => ["Title", v]),
              ...criteria.industries.map((v) => ["Industry", v]),
              ...criteria.companyTypes.map((v) => ["Type", v]),
              ...criteria.statuses.map((v) => ["Stage", statusLabels[v] ?? v]),
              ...criteria.states.map((v) => ["State", v]),
              ...criteria.cities.map((v) => ["City", v]),
              ...(criteria.neverContacted ? [["", "Never contacted"]] : []),
            ].map(([label, value]) => (
              <span key={`${label}:${value}`} className="rounded-full bg-[var(--tint-2)] px-2 py-0.5" data-testid="planner-chip">
                {label ? <span className="faint">{label}: </span> : null}
                {value}
              </span>
            ))}
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <p className="text-sm font-medium">Which leads?</p>
        <div role="radiogroup" aria-label="Which leads" className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={kind === option.key}
              onClick={() => {
                setPeople(null);
                setKind(option.key);
              }}
              className={`rounded-lg border p-3 text-left text-sm ${kind === option.key ? "border-[var(--brand)] bg-[var(--tint-2)]" : "border-[var(--border)]"}`}
              data-testid={`planner-kind-${option.key}`}
            >
              <span className="block font-medium">{option.label}</span>
              <span className="faint block text-xs">{option.sub}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <p className="text-sm font-medium">What to put on your calendar</p>
          <p className="faint text-xs">Everyone you plan gets every row. Email and Text rows are reminders; nothing is sent.</p>
        </div>
        <div className="space-y-2" data-testid="planner-rows">
          <div className="faint grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 text-xs">
            <span>Date</span>
            <span>Activity</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2" data-testid="planner-row">
              <input
                type="date"
                min={today}
                value={row.on}
                onChange={(e) => {
                  setPeople(null);
                  setRows(rows.map((r, i) => (i === index ? { ...r, on: e.target.value } : r)));
                }}
                className="input input-sm min-w-0"
                aria-label={`Row ${index + 1} date`}
                data-testid={`planner-row-day-${index}`}
              />
              <select
                value={row.type}
                onChange={(e) => {
                  setPeople(null);
                  setRows(rows.map((r, i) => (i === index ? { ...r, type: e.target.value as PlannerType } : r)));
                }}
                className="select input-sm min-w-0"
                aria-label={`Row ${index + 1} activity`}
                data-testid={`planner-row-type-${index}`}
              >
                {(Object.keys(TYPE_WORDS) as PlannerType[]).map((type) => (
                  <option key={type} value={type}>
                    {TYPE_WORDS[type]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
                disabled={rows.length === 1}
                onClick={() => {
                  setPeople(null);
                  setRows(rows.filter((_, i) => i !== index));
                }}
                aria-label={`Remove row ${index + 1}`}
                data-testid={`planner-row-remove-${index}`}
              >
                <IconTrash size={13} />
              </button>
            </div>
          ))}
          {rows.length < MAX_ROWS && (
            <button
              type="button"
              className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
              onClick={() => {
                setPeople(null);
                const last = rows[rows.length - 1];
                setRows([...rows, { on: plusDays(last?.on && last.on >= today ? last.on : today, 3), type: "PHONE_CALL" }]);
              }}
              data-testid="planner-add-row"
            >
              <IconPlus size={13} />
              Add a row ({MAX_ROWS - rows.length} more)
            </button>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary pointer-coarse:min-h-11" onClick={generate} disabled={pending || !kind || !rowsOk} data-testid="planner-generate">
          {pending && !people ? "Finding people…" : "Generate leads"}
        </button>
        {!kind && <span className="faint text-xs">Pick Warm, Cold or Mix first.</span>}
        {error && (
          <span className="text-sm text-[var(--danger)]" role="alert" data-testid="planner-error">
            {error}
          </span>
        )}
      </div>

      {people && (
        <Card className="p-0" >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hairline-3)] px-4 py-3 sm:px-5">
            <p className="min-w-0 flex-1 text-sm" data-testid="planner-count">
              {people.length === 0
                ? "Nobody matches right now. Loosen a filter or pick another kind of lead."
                : `${people.length} ${people.length === 1 ? "person" : "people"} found · ${tickedCount} ticked · ${tickedCount * rows.length} ${tickedCount * rows.length === 1 ? "entry" : "entries"}`}
            </p>
            {people.length > 0 && (
              <>
                <button type="button" className="link text-xs" onClick={() => setTicked(new Set(people.map((p) => p.id)))} data-testid="planner-tick-all">
                  Tick all
                </button>
                <button type="button" className="link text-xs" onClick={() => setTicked(new Set())} data-testid="planner-tick-none">
                  Untick all
                </button>
              </>
            )}
          </div>
          {people.length > 0 && (
            <ul className="divide-y divide-[var(--hairline-3)]" data-testid="planner-results">
              {people.map((person) => (
                <li key={person.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5 sm:px-5" data-testid="planner-person" data-contact-id={person.id} data-company-id={person.companyId ?? ""}>
                  <input
                    type="checkbox"
                    checked={ticked.has(person.id)}
                    onChange={() =>
                      setTicked((current) => {
                        const next = new Set(current);
                        if (next.has(person.id)) next.delete(person.id);
                        else next.add(person.id);
                        return next;
                      })
                    }
                    className="h-4 w-4 shrink-0 accent-[var(--brand)] pointer-coarse:h-5 pointer-coarse:w-5"
                    aria-label={`Plan ${person.name}`}
                    data-testid="planner-tick"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-baseline gap-2">
                      <Link href={`/dashboard/contacts/${person.id}`} className="truncate font-medium hover:underline">
                        {person.name}
                      </Link>
                      <span className={`shrink-0 rounded-full px-1.5 text-[0.7rem] ${person.warm ? "bg-[var(--tint-3)]" : "bg-[var(--tint-1)]"}`} data-testid="planner-warmth">
                        {person.warm ? "Warm" : "Cold"}
                      </span>
                    </p>
                    <p className="muted truncate text-xs">
                      {[person.title, person.company, person.place].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <span className="faint hidden shrink-0 text-xs sm:block" data-testid="planner-owner">
                    {person.owner === "you" ? "Yours" : person.owner === "unowned" ? "Unowned" : `${person.ownerName ?? "Teammate"}'s · quiet 45+ days`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {people.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--hairline-3)] px-4 py-3 sm:px-5">
              <button type="button" className="btn btn-primary pointer-coarse:min-h-11" onClick={create} disabled={pending || tickedCount === 0} data-testid="planner-create">
                <IconCalendar size={14} />
                {pending ? "Creating…" : `Create ${tickedCount * rows.length} ${tickedCount * rows.length === 1 ? "entry" : "entries"}`}
              </button>
              <span className="faint text-xs">On your calendar only. Nobody&apos;s owner changes.</span>
            </div>
          )}
        </Card>
      )}

      {toast && <PlannerToast key={toast.at} toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// "Planned 12 people · 36 entries · Undo": one Undo for the whole batch.
function PlannerToast({ toast, onDone }: { toast: { batchId: string; words: string }; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [words, setWords] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (pending) return;
    const timer = window.setTimeout(onDone, words ? 4000 : 15_000);
    return () => window.clearTimeout(timer);
  }, [pending, words, onDone]);
  if (!ready) return null;
  return createPortal(
    <div
      className="popover fixed inset-x-3 z-50 mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-sm shadow-lg sm:inset-x-auto sm:right-6"
      style={{ bottom: "calc(var(--phone-tabbar-h, 0px) + 16px)" }}
      role="status"
      aria-live="polite"
      data-testid="planner-toast"
    >
      <span className="min-w-0 flex-1">{words ?? toast.words}</span>
      {!words && (
        <>
          <Link href="/dashboard/planner?tab=planned" className="link text-xs" data-testid="planner-toast-planned">
            See planned
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
            disabled={pending}
            data-testid="planner-undo"
            onClick={() =>
              start(async () => {
                const result = await undoPlannerBatch(toast.batchId);
                start(() => {
                  setWords(result.error ?? `Undone · ${result.removed ?? 0} ${result.removed === 1 ? "entry" : "entries"} taken off`);
                  router.refresh();
                });
              })
            }
          >
            Undo
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

/* -------------------------------- Planned -------------------------------- */

function PlannedTab({ today, planned }: { today: string; planned: { entries: PlannedEntry[]; more: boolean } }) {
  const router = useRouter();
  const how = useHowDidItGo();
  const [notice, setNotice] = useState<string | null>(null);
  const groups = useMemo(() => {
    const byDay = new Map<string, PlannedEntry[]>();
    for (const entry of planned.entries) {
      const key = entry.startOn < today ? "overdue" : entry.startOn;
      byDay.set(key, [...(byDay.get(key) ?? []), entry]);
    }
    return [...byDay.entries()];
  }, [planned.entries, today]);

  if (!planned.entries.length) {
    return (
      <Card className="p-6">
        <p className="muted text-sm" data-testid="planned-empty">
          Nothing planned yet. Use Plan to put people on your calendar.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4" data-testid="planner-planned">
      {notice && (
        <p className="muted text-sm" role="status" data-testid="planned-notice">
          {notice}
        </p>
      )}
      {groups.map(([day, entries]) => (
        <Card key={day} className="p-0">
          <h2 className={`border-b border-[var(--hairline-3)] px-4 py-2.5 text-sm font-medium sm:px-5 ${day === "overdue" ? "text-[var(--danger)]" : ""}`} data-testid="planned-day">
            {day === "overdue" ? "Overdue" : day === today ? `Today · ${formatDay(`${day}T12:00:00Z`)}` : formatDay(`${day}T12:00:00Z`)}
            <span className="faint ml-2 text-xs font-normal">{entries.length}</span>
          </h2>
          <ul className="divide-y divide-[var(--hairline-3)]">
            {entries.map((entry) => (
              <li key={entry.id} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5" data-testid="planned-row" data-entry-id={entry.id}>
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <p className="truncate text-sm font-medium">
                    {entry.contactId ? (
                      <Link href={`/dashboard/contacts/${entry.contactId}`} className="hover:underline">
                        {entry.title}
                      </Link>
                    ) : (
                      entry.title
                    )}
                  </p>
                  <p className="muted truncate text-xs">
                    {[entry.company, day === "overdue" ? formatDay(`${entry.startOn}T12:00:00Z`) : null, entry.type === "Email" ? entry.email : entry.phone].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <EntryActions
                  entry={entry}
                  today={today}
                  onDone={() =>
                    how.open({
                      event: {
                        id: entry.id,
                        type: entry.type,
                        title: entry.title,
                        notes: entry.notes,
                        startOn: entry.startOn,
                        startTime: entry.startTime,
                        contactId: entry.contactId,
                        contactName: entry.contactName,
                        companyId: entry.companyId,
                        companyName: entry.company,
                      },
                      name: entry.contactName ?? undefined,
                      today,
                      onChanged: () => router.refresh(),
                    })
                  }
                  onChanged={(words) => {
                    setNotice(words);
                    router.refresh();
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {planned.more && <p className="faint text-xs">Showing the first 300. Finish or move some to see the rest.</p>}
      {how.element}
    </div>
  );
}
