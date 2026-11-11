"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDay } from "@/lib/format";
import { colorForType, formatTimeRange, eventDayCount } from "@/lib/calendar";
import { Card, CardHeader, Badge } from "@/components/ui";
import { IconCalendar } from "@/components/icons";
import { EventForm, type EventChoices } from "@/app/dashboard/calendar/event-form";

export type UpcomingEvent = {
  id: string;
  title: string;
  type: string;
  startOn: string;
  endOn: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  projectId: string | null;
  projectNumber: number | null;
};

// What is coming up with this person or this company, and one button to
// put something else on. A site walk is usually booked while you are
// looking at whoever asked for it, not from the calendar.
export function UpcomingCard({
  events,
  choices,
  defaults,
  label,
  phoneFold = false,
}: {
  events: UpcomingEvent[];
  choices: EventChoices;
  defaults: { contactId?: string; companyId?: string; startOn: string; type?: string };
  label: string;
  // Folded on a phone until tapped (the contact page, where the Next step
  // strip already names the first thing booked).
  phoneFold?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const folded = phoneFold && !unfolded && !adding;

  return (
    <Card lit>
      <CardHeader
        title="Coming up"
        subtitle={events.length === 0 ? `Nothing booked with ${label} yet.` : `Days booked with ${label}.`}
        actions={
          <>
            {phoneFold && (
              <button
                type="button"
                onClick={() => setUnfolded(!unfolded)}
                aria-expanded={!folded}
                className="btn btn-ghost btn-sm pointer-coarse:min-h-11 lg:hidden"
                data-testid="upcoming-toggle"
              >
                {folded ? `Show${events.length ? ` ${events.length}` : ""}` : "Hide"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdding(!adding)}
              className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
              data-testid="upcoming-add-event"
            >
              <IconCalendar size={13} />
              {adding ? "Close" : "+ Event"}
            </button>
          </>
        }
      />
      <div className={`space-y-2 p-5 ${folded ? "max-lg:hidden" : ""}`} data-testid="upcoming-card">
        {adding && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--tint-1)] p-3">
            <EventForm choices={choices} defaults={defaults} onDone={() => setAdding(false)} />
          </div>
        )}
        {events.length === 0 && !adding && (
          <p className="faint text-xs">
            A site walk, a meeting, a service call — put it on here and it lands on the calendar.
          </p>
        )}
        {events.map((event) => {
          const times = formatTimeRange(event.startTime, event.endTime);
          const span = eventDayCount(event);
          return (
            <div
              key={event.id}
              className="flex flex-wrap items-baseline justify-between gap-2"
              data-testid="upcoming-row"
            >
              <div className="min-w-0">
                <p className="text-sm">{event.title}</p>
                <p className="faint num text-xs">
                  {formatDay(`${event.startOn}T12:00:00Z`)}
                  {span > 1 && ` · ${span} days`}
                  {times && ` · ${times}`}
                  {event.location && ` · ${event.location}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={colorForType(event.type)}>{event.type}</Badge>
                {event.projectId && (
                  <Link href={`/dashboard/projects/${event.projectId}/schedule`} className="link text-xs">
                    PRJ-{event.projectNumber}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
