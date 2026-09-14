import { requireSession } from "@/lib/session";
import { formatDay } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { todayIso, isoToDate, addDays } from "@/lib/payments";
import {
  crewOverlaps,
  dayRangeTitle,
  eventDays,
  isRealDay,
  monthGrid,
  monthTitle,
  startOfMonth,
  startOfWeek,
  weekDays,
} from "@/lib/calendar";
import { loadEvents, loadEventChoices } from "@/lib/calendar-data";
import { PageHeader, Card } from "@/components/ui";
import { CalendarToolbar } from "./calendar-toolbar";
import { MonthView, WeekView } from "./calendar-views";

// Everything scheduled, in one place: the installs booked off a job, plus
// the site walks and meetings somebody put on by hand.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; on?: string | string[]; crew?: string; type?: string }>;
}) {
  const { organizationId } = await requireSession();
  const params = await searchParams;
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);

  const view = params.view === "week" ? "week" : "month";
  // Anything that is not a real day falls back to today rather than
  // taking the page down with it.
  const asked = isRealDay(params.on) ? params.on : today;
  const anchor = view === "month" ? startOfMonth(asked) : startOfWeek(asked);

  // The window is the grid, not the month: the six-week grid shows days
  // either side, and they should carry their events like any other day.
  const days = view === "month" ? monthGrid(anchor) : weekDays(anchor);
  const from = isoToDate(days[0])!;
  const to = isoToDate(days[days.length - 1])!;

  const [events, choices] = await Promise.all([
    loadEvents(organizationId, { from, to }, { crewId: params.crew, type: params.type }),
    loadEventChoices(organizationId),
  ]);

  // A crew in two places at once on the same day, with times that
  // actually collide. A note, not a refusal — sending half a crew to a
  // service call in the morning is a normal day.
  const clashes = crewOverlaps(
    events.map((event) => ({
      crewId: event.crewId,
      crew: event.crewName ? { name: event.crewName } : null,
      startOn: event.startOn,
      endOn: event.endOn,
      startTime: event.startTime,
      endTime: event.endTime,
    })),
  );

  // "Days booked" has to mean days: a three-day install is three of them,
  // and two things on the same day is one. Counted inside the window on
  // screen, so it matches what can be seen.
  const shown = new Set(days);
  const bookedDays = new Set<string>();
  for (const event of events) {
    for (const covered of eventDays(event)) {
      if (shown.has(covered)) bookedDays.add(covered);
    }
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={
          view === "month"
            ? monthTitle(anchor)
            : `Week of ${dayRangeTitle(days[0], days[days.length - 1])}`
        }
        actions={
          <p className="faint num text-xs" data-testid="cal-count">
            {bookedDays.size} {bookedDays.size === 1 ? "day booked" : "days booked"} ·{" "}
            {events.length} {events.length === 1 ? "thing on" : "things on"}
            {(params.crew || params.type) && " with the filters on"}
          </p>
        }
      />

      <CalendarToolbar
        view={view}
        anchor={anchor}
        today={today}
        choices={choices}
        crewId={params.crew ?? ""}
        type={params.type ?? ""}
      />

      {clashes.length > 0 && (
        <Card lit className="mb-4">
          <div className="space-y-1 p-4" data-testid="overlap-note">
            {clashes.slice(0, 5).map((note) => (
              <p key={`${note.crewId}-${note.day}`} className="text-sm text-[var(--warn)]">
                {note.crewName} is in {note.count} places on {formatDay(`${note.day}T12:00:00Z`)}. Worth a
                look.
              </p>
            ))}
            {clashes.length > 5 && (
              <p className="faint text-xs">and {clashes.length - 5} more days like it</p>
            )}
          </div>
        </Card>
      )}

      {view === "month" ? (
        <MonthView monthIso={anchor} today={today} events={events} choices={choices} />
      ) : (
        <WeekView weekOf={anchor} today={today} events={events} choices={choices} />
      )}

      {view === "week" && (
        <p className="faint mt-4 text-xs">
          Copying this week puts the same days, times and crews into the week of{" "}
          {formatDay(`${addDays(anchor, 7)}T12:00:00Z`)}.
        </p>
      )}
    </div>
  );
}
