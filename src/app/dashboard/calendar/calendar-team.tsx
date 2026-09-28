"use client";

import { useState } from "react";
import { WEEKDAY_NAMES, byTimeThenTitle, colorForType, dayOfMonth, eventDays, formatTimeRange, weekDays } from "@/lib/calendar";
import { UNASSIGNED_USER } from "@/lib/calendar-filters";
import { Card } from "@/components/ui";
import { IconHardHat, IconUsers } from "@/components/icons";
import type { EventChoices } from "./event-form";
import { DayPanel, type EventView } from "./calendar-views";

// The team's week: one row per teammate and per crew, seven day columns,
// with how loaded each row is. Where the week view answers "what is on
// Tuesday", this answers "what is Sam's week like" and "is the roofing
// crew free on Thursday". A row is a teammate's own days (whose calendar
// it is on) or a crew's days (who is going); the same entry can sit in
// both rows, because both people need to see it.
export function TeamView({
  weekOf,
  today,
  events,
  choices,
  crews,
}: {
  weekOf: string;
  today: string;
  events: EventView[];
  choices: EventChoices;
  crews: { id: string; name: string; kind: string }[];
}) {
  const [open, setOpen] = useState<{ day: string; rowKey: string } | null>(null);
  const days = weekDays(weekOf);

  type Row = { key: string; name: string; kind: "user" | "crew" | "unassigned"; matches: (event: EventView) => boolean };
  const rows: Row[] = [
    ...choices.users.map((user) => ({
      key: `u-${user.id}`,
      name: user.id === choices.me ? `${user.name} (me)` : user.name,
      kind: "user" as const,
      matches: (event: EventView) => event.ownerId === user.id,
    })),
    {
      key: `u-${UNASSIGNED_USER}`,
      name: "Unassigned",
      kind: "unassigned" as const,
      matches: (event: EventView) => !event.ownerId,
    },
    ...crews.map((crew) => ({
      key: `c-${crew.id}`,
      name: `${crew.name}${crew.kind === "SUBCONTRACTOR" ? " (sub)" : ""}`,
      kind: "crew" as const,
      matches: (event: EventView) => event.crewId === crew.id,
    })),
  ];

  // Each row's events, spread over the days they cover.
  const cells = new Map<string, Map<string, EventView[]>>();
  const loads = new Map<string, { things: number; days: Set<string> }>();
  for (const row of rows) {
    const byDay = new Map<string, EventView[]>();
    const load = { things: 0, days: new Set<string>() };
    for (const event of events) {
      if (!row.matches(event)) continue;
      let counted = false;
      for (const day of eventDays(event)) {
        if (!days.includes(day)) continue;
        byDay.set(day, [...(byDay.get(day) ?? []), event]);
        load.days.add(day);
        counted = true;
      }
      if (counted) load.things += 1;
    }
    cells.set(row.key, byDay);
    loads.set(row.key, load);
  }

  // An unassigned row with nothing in it is noise; a teammate's or a
  // crew's stays so an empty week reads as free, which is the point.
  const shown = rows.filter((row) => row.kind !== "unassigned" || (loads.get(row.key)?.things ?? 0) > 0);
  const openRow = open ? shown.find((row) => row.key === open.rowKey) : null;

  return (
    <>
      <Card lit>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm" data-testid="team-grid">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="eyebrow w-44 px-3 py-2 text-left">Who</th>
                {days.map((day, index) => (
                  <th key={day} className="eyebrow px-2 py-2 text-center">
                    {WEEKDAY_NAMES[index]}{" "}
                    <span className={`num ${day === today ? "rounded bg-[var(--brand)] px-1 text-white" : "faint"}`}>
                      {dayOfMonth(day)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const load = loads.get(row.key)!;
                const byDay = cells.get(row.key)!;
                return (
                  <tr
                    key={row.key}
                    className="border-b border-[rgb(255_255_255/0.045)] align-top"
                    data-testid="team-row"
                    data-row={row.key}
                    data-things={load.things}
                    data-days={load.days.size}
                  >
                    <td className="px-3 py-2">
                      <p className="flex items-center gap-1.5 font-medium">
                        {row.kind === "crew" ? <IconHardHat size={13} className="opacity-70" /> : <IconUsers size={13} className="opacity-70" />}
                        {row.name}
                      </p>
                      <p className="faint num text-xs" data-testid="team-load">
                        {load.things === 0
                          ? "Free all week"
                          : `${load.things} ${load.things === 1 ? "thing" : "things"} · ${load.days.size} of 7 days`}
                      </p>
                    </td>
                    {days.map((day) => {
                      const onThisDay = (byDay.get(day) ?? []).sort(byTimeThenTitle);
                      const heavy = onThisDay.length >= 3;
                      return (
                        <td key={day} className="p-1">
                          <button
                            type="button"
                            onClick={() => setOpen({ day, rowKey: row.key })}
                            aria-label={`${row.name}, ${day}, ${onThisDay.length} ${onThisDay.length === 1 ? "thing" : "things"} on`}
                            className={`block min-h-[3.5rem] w-full rounded p-1 text-left transition-colors hover:bg-[rgb(255_255_255/0.03)] ${
                              heavy ? "bg-[rgb(251_191_36/0.06)]" : ""
                            }`}
                            data-testid="team-cell"
                            data-day={day}
                            data-count={onThisDay.length}
                          >
                            {onThisDay.slice(0, 3).map((event) => (
                              <span
                                key={`${event.id}-${day}`}
                                className="block truncate rounded px-1 py-0.5 text-[0.68rem] leading-tight"
                                style={{
                                  background: `color-mix(in oklab, ${colorForType(event.type)} 20%, transparent)`,
                                  color: colorForType(event.type),
                                  textDecoration: event.doneAt ? "line-through" : undefined,
                                }}
                              >
                                {event.startTime && <span className="num">{formatTimeRange(event.startTime, null)?.replace("from ", "")} </span>}
                                {event.title}
                              </span>
                            ))}
                            {onThisDay.length > 3 && (
                              <span className="faint block px-1 text-[0.68rem]">+{onThisDay.length - 3} more</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {open && openRow && (
        <DayPanel
          day={open.day}
          events={(cells.get(openRow.key)?.get(open.day) ?? []).sort(byTimeThenTitle)}
          choices={choices}
          onClose={() => setOpen(null)}
          title={`${openRow.name} · ${open.day}`}
        />
      )}
    </>
  );
}
