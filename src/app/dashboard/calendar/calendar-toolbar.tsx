"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { addDays } from "@/lib/payments";
import { shiftMonth, startOfMonth, startOfWeek } from "@/lib/calendar";
import { FormError, FormSuccess } from "@/components/ui";
import { IconChevronLeft, IconChevronRight, IconCopy, IconPlus } from "@/components/icons";
import { EventForm, type EventChoices } from "./event-form";
import { copyWeek } from "./actions";

// Paging, the month/week switch, the filters and "+ Event". Everything
// that moves the view is in the address bar, so a week you are looking at
// can be sent to somebody or kept as a bookmark.
export function CalendarToolbar({
  view,
  anchor,
  today,
  choices,
  crewId,
  type,
}: {
  view: "month" | "week";
  // The first of the month, or the Sunday of the week.
  anchor: string;
  today: string;
  choices: EventChoices;
  crewId: string;
  type: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [copyState, setCopyState] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.push(`/dashboard/calendar?${next.toString()}`);
  };

  const step = (direction: -1 | 1) =>
    go({ on: view === "month" ? shiftMonth(anchor, direction) : addDays(anchor, direction * 7) });

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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

        <select
          value={crewId}
          onChange={(fired) => go({ crew: fired.target.value || null })}
          aria-label="Whose days to show"
          className="select input-sm w-44"
          data-testid="cal-crew-filter"
        >
          <option value="">Everyone</option>
          {choices.crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
              {crew.kind === "SUBCONTRACTOR" ? " (sub)" : ""}
            </option>
          ))}
        </select>

        <select
          value={type}
          onChange={(fired) => go({ type: fired.target.value || null })}
          aria-label="Which kind of day to show"
          className="select input-sm w-40"
          data-testid="cal-type-filter"
        >
          <option value="">Every kind of day</option>
          {choices.eventTypes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {(crewId || type) && (
          <button type="button" onClick={() => go({ crew: null, type: null })} className="btn btn-ghost btn-sm">
            Clear
          </button>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {view === "week" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setCopyState({});
                  const result = await copyWeek({
                    weekOf: anchor,
                    crewId: crewId || undefined,
                    type: type || undefined,
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

      <FormError message={copyState.error} />
      <FormSuccess message={copyState.success} />

      {adding && (
        <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4">
          <EventForm
            choices={choices}
            defaults={{ startOn: view === "week" ? anchor : today }}
            onDone={() => setAdding(false)}
          />
        </div>
      )}
    </div>
  );
}
