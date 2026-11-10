"use client";

import { ink } from "@/lib/ink";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
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
import { ACTIVITY_EVENT_TYPES } from "@/lib/constants";
import { formatDay } from "@/lib/format";
import { Card, CardHeader, Badge, FormError, EmptyState } from "@/components/ui";
import { IconCalendar, IconTrash, IconCheck, IconHardHat } from "@/components/icons";
import { EventForm, type EventChoices, type EventFormValues } from "./event-form";
import { deleteEvent, moveEvent, setEventDone } from "./actions";
import { DoneBox, canLogOnDone } from "./done-box";

export type EventView = EventFormValues & {
  crewName: string | null;
  projectLabel: string | null;
  projectNumber: number | null;
  contactName: string | null;
  companyName: string | null;
  scopeName: string | null;
  ownerName: string | null;
  attendeeNames: string[];
  doneAt: string | null;
  auto: boolean;
  quoteId: string | null;
  quoteNumber: number | null;
  contractId: string | null;
  contractNumber: number | null;
  // The history line this entry is tied to, when it has one.
  activityId: string | null;
};

// An entry that is an activity rather than a day of work, so a missing
// clock reads "No time set" and not "All day": a call is never all day.
export function isActivityType(type: string) {
  return ACTIVITY_EVENT_TYPES.some((name) => name.toLowerCase() === type.toLowerCase());
}

export function timeLabel(event: { type: string; startTime: string | null; endTime: string | null }) {
  return formatTimeRange(event.startTime, event.endTime) ?? (isActivityType(event.type) ? "No time set" : "All day");
}

// The quote or contract an entry the app wrote came from, as a link.
export function EventSourceLink({ event }: { event: EventView }) {
  if (event.quoteId) {
    return (
      <Link href={`/dashboard/quotes/${event.quoteId}`} className="link" data-testid="event-source-link">
        QUO-{event.quoteNumber}
      </Link>
    );
  }
  if (event.contractId) {
    return (
      <Link href={`/dashboard/contracts/${event.contractId}`} className="link" data-testid="event-source-link">
        CON-{event.contractNumber}
      </Link>
    );
  }
  return null;
}

// "Tue, Nov 10, 2026": the day as anyone reads it, for a panel's title.
export function readableDay(iso: string) {
  return `${WEEKDAY_NAMES[new Date(`${iso}T12:00:00Z`).getUTCDay()]}, ${formatDay(`${iso}T12:00:00Z`)}`;
}

// The ✓ / Edit / trash on a calendar row are hit with a thumb, often in
// a truck: at least 44px square on a phone with room between them, the
// usual small size from sm up (UX review, Nov 10, 2026).
export const ROW_BUTTON = "min-h-11 min-w-11 sm:min-h-0 sm:min-w-0";

// Unticking an entry that was ticked with "How did it go?" deletes the
// line it wrote in somebody's history (unlogEventDone). A call logged
// from the form (auto) keeps its line, so it needs no question.
export function untickDeletesHistory(event: { doneAt: string | null; activityId: string | null; auto: boolean }) {
  return Boolean(event.doneAt && event.activityId && !event.auto);
}

// Whose history that line is in, for the question.
function whoseHistory(event: EventView) {
  const people = [event.contactName, ...event.attendeeNames].filter((name): name is string => Boolean(name));
  const names = people.length ? people : event.companyName ? [event.companyName] : [];
  if (names.length === 0) return "the history";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list}'s history`;
}

// The question a row asks in place before it does something that can't
// be taken back with another tap: taking an entry off the calendar, or
// unticking one whose history line would go with it. Same look as the
// app's other inline deletes (DeleteButton): a red box, the question,
// Yes and Cancel; Escape backs out.
export function RowConfirm({
  kind,
  event,
  pending,
  onYes,
  onCancel,
  testId,
}: {
  kind: "delete" | "untick";
  event: EventView;
  pending: boolean;
  onYes: () => void;
  onCancel: () => void;
  testId: string;
}) {
  useEffect(() => {
    function onKey(key: KeyboardEvent) {
      if (key.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="group"
      aria-label={kind === "delete" ? "Confirm delete" : "Confirm not done"}
      className="mt-1.5 space-y-2 rounded-lg border border-[rgb(251_113_133/0.35)] bg-[rgb(251_113_133/0.08)] px-3 py-2"
      data-testid={testId}
      data-kind={kind}
    >
      <p className="text-xs font-medium">
        {kind === "delete" ? "Take this off the calendar?" : "Mark it not done?"}
      </p>
      {kind === "untick" && (
        <p className="faint text-[0.7rem] leading-relaxed">
          That also deletes what was logged in {whoseHistory(event)} when it was ticked.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onYes}
          className={`btn btn-danger btn-sm ${ROW_BUTTON}`}
          data-testid={`${testId}-yes`}
        >
          {kind === "delete" && <IconTrash size={12} />}
          {kind === "delete" ? (pending ? "Deleting…" : "Yes, delete") : pending ? "Saving…" : "Yes, not done"}
        </button>
        <button type="button" onClick={onCancel} className={`btn btn-ghost btn-sm ${ROW_BUTTON}`} data-testid={`${testId}-no`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

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
                aria-label={`${readableDay(day)}, ${onThisDay.length} ${onThisDay.length === 1 ? "thing" : "things"} on`}
                className={`min-h-[5.5rem] border-b border-r border-[var(--hairline)] p-1.5 text-left align-top transition-colors hover:bg-[var(--tint-2)] ${
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
                {/* On a phone a square is about 50px wide, and three chips
                    cut to "8:3…" said nothing, so it shows how many things
                    are on instead; tapping the day lists them. The chips
                    are unchanged from sm up. */}
                {onThisDay.length > 0 && (
                  <span
                    className="num mt-1 inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--tint-2)] px-1.5 py-0.5 text-xs font-semibold sm:hidden"
                    aria-hidden="true"
                    data-testid="month-count"
                  >
                    {onThisDay.length}
                  </span>
                )}
                <span className="mt-1 hidden space-y-0.5 sm:block">
                  {onThisDay.slice(0, 3).map((event) => (
                    <span
                      key={`${event.id}-${day}`}
                      className="block truncate rounded px-1 py-0.5 text-[0.68rem] leading-tight"
                      style={{
                        background: `color-mix(in oklab, ${colorForType(event.type)} 20%, transparent)`,
                        color: ink(colorForType(event.type)),
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

export function DayPanel({
  day,
  events,
  choices,
  onClose,
  title,
}: {
  day: string;
  events: EventView[];
  choices: EventChoices;
  onClose: () => void;
  // The team view names the row as well as the day.
  title?: string;
}) {
  const [adding, setAdding] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // The panel opens under the grid. On a phone that is a screen or more
  // below the square that was tapped, so the tap looked dead: bring it up
  // whenever its header would be off the bottom of the screen. Where its
  // header already shows (most desktops) nothing moves. The title is in
  // the deps because the team view opens it for another row on one day.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (element.getBoundingClientRect().top <= window.innerHeight - 80) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [day, title]);

  return (
    <div ref={panel} className="mt-4 scroll-mt-4" data-testid="day-panel-card">
      <Card lit>
        <CardHeader
          title={title ?? readableDay(day)}
          subtitle={`${events.length} ${events.length === 1 ? "thing" : "things"} on this day`}
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAdding(!adding)}
                className="btn btn-primary btn-sm"
                data-testid="day-add-event"
              >
                {adding ? "Cancel" : "+ Event"}
              </button>
              {/* "Close", not "Done": the rows under it use Done / Not done
                  for whether a thing happened. The add toggle reads Cancel
                  while its form is open, so the two never share a name. */}
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" data-testid="day-close">
                Close
              </button>
            </div>
          }
        />
        <div className="space-y-3 p-5" data-testid="day-panel" data-day={day}>
          {adding && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--tint-1)] p-3">
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
    </div>
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
  const [ticking, setTicking] = useState(false);
  // The trash and an untick that would delete a history line ask first.
  const [confirming, setConfirming] = useState<"delete" | "untick" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const color = colorForType(event.type);
  const times = timeLabel(event);
  const span = eventDays(event).length;

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
      setConfirming(null);
    });

  if (editing) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--tint-1)] p-3">
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
        {times}
        {span > 1 && ` · ${span} days`}
        {event.crewName && ` · ${event.crewName}`}
        {event.ownerName && <span data-testid="event-owner-name"> · {event.ownerName}</span>}
      </p>

      {!compact && (
        <div className="mt-1 space-y-0.5 text-xs">
          {(event.quoteId || event.contractId) && (
            <p className="muted">
              From <EventSourceLink event={event} />
            </p>
          )}
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

      <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            canLogOnDone(event)
              ? setTicking(!ticking)
              : untickDeletesHistory(event)
                ? setConfirming(confirming === "untick" ? null : "untick")
                : run(() => setEventDone(event.id, !event.doneAt))
          }
          className={`btn btn-ghost btn-sm ${ROW_BUTTON}`}
          data-testid="event-done"
        >
          <IconCheck size={12} />
          {event.doneAt ? "Not done" : "Done"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`btn btn-ghost btn-sm ${ROW_BUTTON}`}
          data-testid="event-edit"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setMoving(!moving)}
          className={`btn btn-ghost btn-sm ${ROW_BUTTON}`}
          data-testid="event-move"
        >
          Move
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(confirming === "delete" ? null : "delete")}
          aria-label={`Take ${event.title} off the calendar`}
          aria-expanded={confirming === "delete"}
          className={`btn btn-ghost btn-sm !px-1.5 ${ROW_BUTTON}`}
          data-testid="event-delete"
        >
          <IconTrash size={12} />
        </button>
      </div>

      {confirming && (
        <RowConfirm
          kind={confirming}
          event={event}
          pending={pending}
          onYes={() =>
            run(() => (confirming === "delete" ? deleteEvent(event.id) : setEventDone(event.id, false)))
          }
          onCancel={() => setConfirming(null)}
          testId="event-confirm"
        />
      )}

      {ticking && <DoneBox event={event} onClose={() => setTicking(false)} />}

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
