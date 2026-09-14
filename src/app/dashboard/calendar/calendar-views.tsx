"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  WEEKDAY_NAMES,
  byTimeThenTitle,
  colorForType,
  dayOfMonth,
  eventDays,
  formatTimeRange,
  isSameMonth,
  monthGrid,
  weekDays,
} from "@/lib/calendar";
import { Card, CardHeader, Badge, FormError, EmptyState } from "@/components/ui";
import { IconCalendar, IconTrash, IconCheck, IconHardHat } from "@/components/icons";
import { EventForm, type EventChoices, type EventFormValues } from "./event-form";
import { deleteEvent, moveEvent, setEventDone } from "./actions";

export type EventView = EventFormValues & {
  crewName: string | null;
  projectLabel: string | null;
  projectNumber: number | null;
  contactName: string | null;
  companyName: string | null;
  scopeName: string | null;
  attendeeNames: string[];
  doneAt: string | null;
};

/* --------------------------------- The month --------------------------------- */

// Six weeks, always, so the grid never changes height as you page
// through and nothing under it jumps.
export function MonthView({
  monthIso,
  today,
  events,
  choices,
}: {
  monthIso: string;
  today: string;
  events: EventView[];
  choices: EventChoices;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const days = monthGrid(monthIso);

  const byDay = new Map<string, EventView[]>();
  for (const event of events) {
    for (const day of eventDays(event)) {
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
  }

  return (
    <>
      <Card lit>
        <div className="grid grid-cols-7 border-b border-[var(--border)]">
          {WEEKDAY_NAMES.map((name) => (
            <div key={name} className="eyebrow px-2 py-2 text-center">
              {name}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const onThisDay = (byDay.get(day) ?? []).sort(byTimeThenTitle);
            const inMonth = isSameMonth(day, monthIso);
            const isToday = day === today;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setOpenDay(day)}
                aria-label={`${day}, ${onThisDay.length} ${onThisDay.length === 1 ? "thing" : "things"} on`}
                className={`min-h-[5.5rem] border-b border-r border-[rgb(255_255_255/0.045)] p-1.5 text-left align-top transition-colors hover:bg-[rgb(255_255_255/0.03)] ${
                  inMonth ? "" : "opacity-40"
                }`}
                data-testid="month-day"
                data-day={day}
                data-count={onThisDay.length}
              >
                <span
                  className={`num inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs ${
                    isToday ? "bg-[var(--brand)] font-semibold text-white" : "faint"
                  }`}
                >
                  {dayOfMonth(day)}
                </span>
                <span className="mt-1 block space-y-0.5">
                  {onThisDay.slice(0, 3).map((event) => (
                    <span
                      key={`${event.id}-${day}`}
                      className="block truncate rounded px-1 py-0.5 text-[0.68rem] leading-tight"
                      style={{
                        background: `color-mix(in oklab, ${colorForType(event.type)} 20%, transparent)`,
                        color: colorForType(event.type),
                        textDecoration: event.doneAt ? "line-through" : undefined,
                      }}
                      data-testid="month-chip"
                    >
                      {event.startTime && <span className="num">{formatTimeRange(event.startTime, null)?.replace("from ", "")} </span>}
                      {event.title}
                    </span>
                  ))}
                  {onThisDay.length > 3 && (
                    <span className="faint block px-1 text-[0.68rem]">+{onThisDay.length - 3} more</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {openDay && (
        <DayPanel
          day={openDay}
          events={(byDay.get(openDay) ?? []).sort(byTimeThenTitle)}
          choices={choices}
          onClose={() => setOpenDay(null)}
        />
      )}
    </>
  );
}

/* --------------------------------- The week --------------------------------- */

// Seven columns, each a full list rather than a summary, because a week
// is the view you work from the night before.
export function WeekView({
  weekOf,
  today,
  events,
  choices,
}: {
  weekOf: string;
  today: string;
  events: EventView[];
  choices: EventChoices;
}) {
  const days = weekDays(weekOf);
  const byDay = new Map<string, EventView[]>();
  for (const event of events) {
    for (const day of eventDays(event)) {
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {days.map((day) => {
        const onThisDay = (byDay.get(day) ?? []).sort(byTimeThenTitle);
        return (
          <Card key={day} lit={day === today}>
            <div className="border-b border-[var(--border)] px-3 py-2">
              <p className="text-sm font-semibold">
                {WEEKDAY_NAMES[weekDays(weekOf).indexOf(day)]}{" "}
                <span className="num faint font-normal">{dayOfMonth(day)}</span>
              </p>
            </div>
            <div className="space-y-2 p-3" data-testid="week-day" data-day={day} data-count={onThisDay.length}>
              {onThisDay.length === 0 ? (
                <p className="faint text-xs">Nothing on.</p>
              ) : (
                onThisDay.map((event) => (
                  <EventCard key={`${event.id}-${day}`} event={event} choices={choices} compact />
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* --------------------------------- One day --------------------------------- */

function DayPanel({
  day,
  events,
  choices,
  onClose,
}: {
  day: string;
  events: EventView[];
  choices: EventChoices;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card lit className="mt-4">
      <CardHeader
        title={day}
        subtitle={`${events.length} ${events.length === 1 ? "thing" : "things"} on this day`}
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(!adding)}
              className="btn btn-primary btn-sm"
              data-testid="day-add-event"
            >
              {adding ? "Close" : "+ Event"}
            </button>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Done
            </button>
          </div>
        }
      />
      <div className="space-y-3 p-5" data-testid="day-panel" data-day={day}>
        {adding && (
          <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3">
            <EventForm choices={choices} defaults={{ startOn: day }} onDone={() => setAdding(false)} />
          </div>
        )}
        {events.length === 0 && !adding ? (
          <EmptyState
            icon={<IconCalendar size={20} />}
            title="Nothing on this day"
            body="Put an install, a site walk or a meeting on it."
          />
        ) : (
          events.map((event) => <EventCard key={event.id} event={event} choices={choices} />)
        )}
      </div>
    </Card>
  );
}

/* -------------------------------- One event -------------------------------- */

export function EventCard({
  event,
  choices,
  compact = false,
  hideJob = false,
}: {
  event: EventView;
  choices: EventChoices;
  compact?: boolean;
  // On a job's own Schedule tab the job and its customer are in the
  // header already, so repeating them on every card is noise.
  hideJob?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const color = colorForType(event.type);
  const times = formatTimeRange(event.startTime, event.endTime);
  const span = eventDays(event).length;

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
    });

  if (editing) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3">
        <EventForm event={event} choices={choices} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-[var(--border)] p-2.5"
      style={{ borderLeft: `3px solid ${color}` }}
      data-testid="event-card"
      data-event-id={event.id}
      data-type={event.type}
      data-start={event.startOn}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          className={`text-sm font-medium ${event.doneAt ? "line-through opacity-60" : ""}`}
          data-testid="event-title-text"
        >
          {event.title}
        </p>
        <Badge color={color}>{event.type}</Badge>
      </div>

      <p className="faint num mt-0.5 text-xs">
        {times ?? "All day"}
        {span > 1 && ` · ${span} days`}
        {event.crewName && ` · ${event.crewName}`}
      </p>

      {!compact && (
        <div className="mt-1 space-y-0.5 text-xs">
          {event.projectLabel && !hideJob && (
            <p className="muted">
              <Link href={`/dashboard/projects/${event.projectId}/schedule`} className="link">
                PRJ-{event.projectNumber} {event.projectLabel}
              </Link>
              {event.scopeName && ` · ${event.scopeName}`}
            </p>
          )}
          {event.scopeName && hideJob && <p className="muted">{event.scopeName}</p>}
          {event.location && <p className="muted">{event.location}</p>}
          {(event.companyName || event.contactName) && !hideJob && (
            <p className="muted">
              {event.companyName && (
                <Link href={`/dashboard/companies/${event.companyId}`} className="link">
                  {event.companyName}
                </Link>
              )}
              {event.companyName && event.contactName && " · "}
              {event.contactName && (
                <Link href={`/dashboard/contacts/${event.contactId}`} className="link">
                  {event.contactName}
                </Link>
              )}
            </p>
          )}
          {event.attendeeNames.length > 0 && (
            <p className="muted" data-testid="event-attendee-names">
              Also expected: {event.attendeeNames.join(", ")}
            </p>
          )}
          {event.notes && <p className="faint whitespace-pre-wrap">{event.notes}</p>}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setEventDone(event.id, !event.doneAt))}
          className="btn btn-ghost btn-sm"
          data-testid="event-done"
        >
          <IconCheck size={12} />
          {event.doneAt ? "Not done" : "Done"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn btn-ghost btn-sm"
          data-testid="event-edit"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setMoving(!moving)}
          className="btn btn-ghost btn-sm"
          data-testid="event-move"
        >
          Move
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteEvent(event.id))}
          aria-label={`Take ${event.title} off the calendar`}
          className="btn btn-ghost btn-sm !px-1.5"
          data-testid="event-delete"
        >
          <IconTrash size={12} />
        </button>
      </div>

      {moving && (
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <label className="block text-xs">
            <span className="faint block">Move it to</span>
            <input
              type="date"
              defaultValue={event.startOn}
              onChange={(fired) => {
                const value = fired.target.value;
                if (!value) return;
                run(async () => {
                  const result = await moveEvent(event.id, value);
                  if (!result?.error) setMoving(false);
                  return result;
                });
              }}
              aria-label={`Move ${event.title} to another day`}
              className="input input-sm"
              data-testid="event-move-date"
            />
          </label>
          {span > 1 && <span className="faint text-xs">Keeps its {span} days.</span>}
        </div>
      )}

      <FormError message={error} />
    </div>
  );
}

// The list a job's own Schedule tab shows, and the sidebar-free view a
// contact or company page uses.
export function EventList({
  events,
  choices,
  empty,
  hideJob = false,
}: {
  events: EventView[];
  choices: EventChoices;
  empty: string;
  hideJob?: boolean;
}) {
  if (events.length === 0) {
    return <EmptyState icon={<IconHardHat size={20} />} title="Nothing scheduled yet" body={empty} />;
  }
  return (
    <div className="space-y-2">
      {events.map((event) => (
        <EventCard key={event.id} event={event} choices={choices} hideJob={hideJob} />
      ))}
    </div>
  );
}
