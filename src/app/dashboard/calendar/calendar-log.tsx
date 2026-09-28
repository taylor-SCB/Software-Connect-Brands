"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatDay } from "@/lib/format";
import { colorForType, eventDays, formatTimeRange } from "@/lib/calendar";
import { Card, CardHeader, Badge, FormError, EmptyState } from "@/components/ui";
import { IconCalendar, IconCheck, IconTrash } from "@/components/icons";
import { EventForm, type EventChoices } from "./event-form";
import { EventSourceLink, type EventView } from "./calendar-views";
import { deleteEvent, setEventDone } from "./actions";

// The timeline: two columns of rows, what has happened on the left and
// what is coming on the right, each grouped by day. Where a month grid
// answers "what is on the 14th", this answers "what happened with this
// customer and what is next" — the same events, read as a story.
export function LogColumns({
  previous,
  upcoming,
  choices,
  today,
  capped,
}: {
  previous: EventView[];
  upcoming: EventView[];
  choices: EventChoices;
  today: string;
  // How many rows each column was cut at, for the note at the foot.
  capped: number;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="log-columns">
      <LogColumn
        title="Previous Activity Log"
        subtitle={previous.length === 0 ? "Nothing has happened yet." : `${previous.length} before today, newest first.`}
        events={previous}
        choices={choices}
        today={today}
        empty="Calls you log, quotes and contracts that go out, and days that have passed all land here."
        capped={capped}
        testId="log-previous"
      />
      <LogColumn
        title="Upcoming Log"
        subtitle={upcoming.length === 0 ? "Nothing coming up." : `${upcoming.length} from today on, soonest first.`}
        events={upcoming}
        choices={choices}
        today={today}
        empty="Follow-ups, due dates, installs and meetings that are still ahead."
        capped={capped}
        testId="log-upcoming"
      />
    </div>
  );
}

function LogColumn({
  title,
  subtitle,
  events,
  choices,
  today,
  empty,
  capped,
  testId,
}: {
  title: string;
  subtitle: string;
  events: EventView[];
  choices: EventChoices;
  today: string;
  empty: string;
  capped: number;
  testId: string;
}) {
  // Grouped by the day each event starts, in the order the list came in.
  const days: { day: string; events: EventView[] }[] = [];
  for (const event of events) {
    const last = days[days.length - 1];
    if (last && last.day === event.startOn) last.events.push(event);
    else days.push({ day: event.startOn, events: [event] });
  }

  return (
    <Card lit>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="divide-y divide-[rgb(255_255_255/0.045)]" data-testid={testId} data-count={events.length}>
        {events.length === 0 ? (
          <EmptyState icon={<IconCalendar size={20} />} title={`${title} is empty`} body={empty} />
        ) : (
          days.map((group) => (
            <div key={group.day} className="px-4 py-2.5" data-testid="log-day" data-day={group.day}>
              <p className="eyebrow mb-1.5">
                {group.day === today ? "Today · " : ""}
                {formatDay(`${group.day}T12:00:00Z`)}
              </p>
              <div className="space-y-1">
                {group.events.map((event) => (
                  <LogRow key={event.id} event={event} choices={choices} />
                ))}
              </div>
            </div>
          ))
        )}
        {events.length >= capped && (
          <p className="faint px-4 py-2 text-xs">
            Showing the {capped} closest. Narrow the filters, or page the calendar above, to see further.
          </p>
        )}
      </div>
    </Card>
  );
}

// One line of the log. Time, what it was, who it was with, whose it is;
// tick it done, open it to edit, or take it off.
function LogRow({ event, choices }: { event: EventView; choices: EventChoices }) {
  const [editing, setEditing] = useState(false);
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
      className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md py-1 pl-2.5 pr-1 hover:bg-[rgb(255_255_255/0.03)]"
      style={{ borderLeft: `3px solid ${color}` }}
      data-testid="log-row"
      data-event-id={event.id}
      data-type={event.type}
      data-start={event.startOn}
    >
      {/* The clock has a column of its own where there is room; on a
          phone it folds into the row so the words get the width. */}
      <span className="num faint hidden w-[5.5rem] shrink-0 pt-0.5 text-xs sm:block">
        {times ?? "All day"}
        {span > 1 && <span className="block">{span} days</span>}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="num faint text-xs sm:hidden">
            {times ?? "All day"}
            {span > 1 && ` · ${span} days`}
          </span>
          <p className={`text-sm ${event.doneAt ? "line-through opacity-60" : ""}`} data-testid="log-title">
            {event.title}
          </p>
          <Badge color={color}>{event.type}</Badge>
        </div>
        <p className="muted text-xs">
          {event.ownerName ? <span data-testid="log-owner">{event.ownerName}</span> : <span className="faint">Unassigned</span>}
          {event.contactName && (
            <>
              {" · "}
              <Link href={`/dashboard/contacts/${event.contactId}`} className="link">
                {event.contactName}
              </Link>
            </>
          )}
          {event.companyName && (
            <>
              {" · "}
              <Link href={`/dashboard/companies/${event.companyId}`} className="link">
                {event.companyName}
              </Link>
            </>
          )}
          {event.projectLabel && (
            <>
              {" · "}
              <Link href={`/dashboard/projects/${event.projectId}/schedule`} className="link">
                PRJ-{event.projectNumber}
              </Link>
            </>
          )}
          {(event.quoteId || event.contractId) && (
            <>
              {" · "}
              <EventSourceLink event={event} />
            </>
          )}
          {event.crewName && ` · ${event.crewName}`}
          {event.attendeeNames.length > 0 && ` · with ${event.attendeeNames.join(", ")}`}
        </p>
        {event.notes && <p className="faint mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs">{event.notes}</p>}
        <FormError message={error} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setEventDone(event.id, !event.doneAt))}
          aria-label={event.doneAt ? `Mark ${event.title} not done` : `Mark ${event.title} done`}
          className={`btn btn-ghost btn-sm !px-1.5 ${event.doneAt ? "text-[var(--ok)]" : ""}`}
          data-testid="log-done"
        >
          <IconCheck size={12} />
        </button>
        <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-sm" data-testid="log-edit">
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteEvent(event.id))}
          aria-label={`Take ${event.title} off the calendar`}
          className="btn btn-ghost btn-sm !px-1.5"
          data-testid="log-delete"
        >
          <IconTrash size={12} />
        </button>
      </div>
    </div>
  );
}
