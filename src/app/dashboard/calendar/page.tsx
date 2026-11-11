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
import { LOG_ROWS, loadCrewRows, loadEvents, loadEventChoices, loadFilterLabels, loadLogs, type EventFilters } from "@/lib/calendar-data";
import { readIds, readLayout } from "@/lib/calendar-filters";
import { PageHeader, Card } from "@/components/ui";
import { CalendarToolbar } from "./calendar-toolbar";
import { AgendaView, MonthView, WeekView, type EventView } from "./calendar-views";
import { PhoneAgenda } from "./phone-agenda";
import { prisma } from "@/lib/prisma";
import { prefChoice, prefFlag, readUiPrefs } from "@/lib/user-prefs";
import { TeamView } from "./calendar-team";
import { LogColumns } from "./calendar-log";

type Params = {
  view?: string;
  layout?: string;
  on?: string | string[];
  crew?: string;
  type?: string;
  users?: string;
  companies?: string;
  contacts?: string;
  projects?: string;
};

// Everything scheduled and everything that happened, in one place: the
// installs booked off a job, the site walks and meetings somebody put on
// by hand, the calls that were logged, and the quotes and contracts that
// went out and came back. Three ways to lay it out — the grid, the two
// log columns, or the grid with the logs beneath it — and filters by
// teammate, company, contact and project that stack.
//
// BDR redesign (Nov 11, 2026): Members, and phones, open on an Agenda for
// them — Overdue, Today, then the next 7 days, each row with Call / Text
// and Done (which opens How did it go?). Owners and Admins keep the Month
// grid with Everyone. Mine / Everyone is remembered per person
// (User.uiPrefs calendar.scope) and applies whenever the address names no
// users and no other filter. An address that names a day, a view or a
// layout opens what it names, as it always did.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organizationId, userId, role } = await requireSession();
  const params = await searchParams;
  const [timeZone, prefs] = await Promise.all([getTimeZone(), readUiPrefs(userId)]);
  const today = todayIso(timeZone);
  const member = role !== "OWNER" && role !== "ADMIN";

  const bare = !params.view && !params.on && !params.layout;
  const view =
    params.view === "week"
      ? "week"
      : params.view === "team"
        ? "team"
        : params.view === "agenda" || (bare && member)
          ? "agenda"
          : "month";
  const layout = view === "agenda" ? "calendar" : readLayout(params.layout);
  // Anything that is not a real day falls back to today rather than
  // taking the page down with it.
  const asked = isRealDay(params.on) ? params.on : today;
  const anchor = view === "month" ? startOfMonth(asked) : startOfWeek(asked);

  const urlUsers = readIds(params.users);
  const otherFilter = Boolean(params.crew || params.type || params.companies || params.contacts || params.projects);
  const remembered = prefChoice(prefs, "calendar", "scope", ["mine", "team"] as const) ?? (member ? "mine" : "team");
  const scope: "mine" | "team" | "custom" = urlUsers.length
    ? urlUsers.length === 1 && urlUsers[0] === userId
      ? "mine"
      : "custom"
    : otherFilter
      ? "team"
      : remembered;
  const filters: EventFilters = {
    crewId: params.crew,
    type: params.type,
    userIds: urlUsers.length ? urlUsers : scope === "mine" ? [userId] : [],
    companyIds: readIds(params.companies),
    contactIds: readIds(params.contacts),
    projectIds: readIds(params.projects),
  };

  // The window is the grid, not the month: the six-week grid shows days
  // either side, and they should carry their events like any other day.
  // The Agenda's window is today and the next 7 days; its Overdue comes
  // from the log's own overdue list.
  const days =
    view === "agenda" ? Array.from({ length: 8 }, (_, index) => addDays(today, index)) : view === "month" ? monthGrid(anchor) : weekDays(anchor);
  const from = isoToDate(days[0])!;
  const to = isoToDate(days[days.length - 1])!;

  const [loaded, choices, logs, labels, crews, overdue] = await Promise.all([
    layout === "log" ? [] : loadEvents(organizationId, { from, to }, filters),
    loadEventChoices(organizationId, userId),
    layout === "calendar" ? null : loadLogs(organizationId, today, filters),
    loadFilterLabels(organizationId, {
      companyIds: filters.companyIds ?? [],
      contactIds: filters.contactIds ?? [],
      projectIds: filters.projectIds ?? [],
    }),
    view === "team" && layout !== "log" ? loadCrewRows(organizationId) : [],
    view === "agenda" ? loadLogs(organizationId, today, filters).then((log) => log.overdue) : Promise.resolve([] as EventView[]),
  ]);

  // Real tap-to-call: the person's mobile, else their phone, for every
  // entry with someone on it (one statement for the window).
  const events = await withPhones(organizationId, loaded);
  const overdueRows = await withPhones(organizationId, overdue);

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

  const filtering =
    Boolean(params.crew || params.type) ||
    (filters.userIds?.length ?? 0) +
      (filters.companyIds?.length ?? 0) +
      (filters.contactIds?.length ?? 0) +
      (filters.projectIds?.length ?? 0) >
      0;

  const subtitle =
    view === "agenda"
      ? scope === "mine"
        ? "Your overdue, today and the next 7 days"
        : "Overdue, today and the next 7 days"
      : layout === "log"
      ? "What has happened, and what is next"
      : view === "month"
        ? monthTitle(anchor)
        : `${view === "team" ? "The team's week of" : "Week of"} ${dayRangeTitle(days[0], days[days.length - 1])}`;

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={subtitle}
        actions={
          layout === "log" ? (
            <p className="faint num text-xs" data-testid="cal-count">
              {logs?.previous.length ?? 0} before today · {logs?.upcoming.length ?? 0} coming up
              {(logs?.overdue.length ?? 0) > 0 && (
                <span className="text-[var(--danger)]"> · {logs?.overdue.length} overdue</span>
              )}
              {filtering && " with the filters on"}
            </p>
          ) : (
            <p className="faint num text-xs" data-testid="cal-count">
              {bookedDays.size} {bookedDays.size === 1 ? "day booked" : "days booked"} ·{" "}
              {events.length} {events.length === 1 ? "thing on" : "things on"}
              {filtering && " with the filters on"}
            </p>
          )
        }
      />

      {bare && view !== "agenda" && <PhoneAgenda />}
      <CalendarToolbar
        view={view}
        scope={scope}
        layout={layout}
        anchor={anchor}
        focus={asked}
        today={today}
        choices={choices}
        filters={{
          crewId: params.crew ?? "",
          type: params.type ?? "",
          userIds: urlUsers,
          companyIds: filters.companyIds ?? [],
          contactIds: filters.contactIds ?? [],
          projectIds: filters.projectIds ?? [],
        }}
        labels={labels}
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

      {view === "agenda" ? (
        <AgendaView today={today} days={days} events={events} overdue={overdueRows} choices={choices} />
      ) : layout !== "log" &&
        (view === "month" ? (
          <MonthView
            key={anchor}
            monthIso={anchor}
            today={today}
            events={events}
            choices={choices}
            showLogged={prefFlag(prefs, "calendar", "showLogged") ?? false}
          />
        ) : view === "team" ? (
          <TeamView weekOf={anchor} today={today} events={events} choices={choices} crews={crews} />
        ) : (
          <WeekView weekOf={anchor} today={today} events={events} choices={choices} />
        ))}

      {layout !== "log" && view === "week" && (
        <p className="faint mt-4 text-xs">
          Copying this week puts the same days, times and crews into the week of{" "}
          {formatDay(`${addDays(anchor, 7)}T12:00:00Z`)}.
        </p>
      )}

      {logs && (
        <div className={layout === "both" ? "mt-6" : ""}>
          <LogColumns
            previous={logs.previous}
            upcoming={logs.upcoming}
            overdue={logs.overdue}
            choices={choices}
            today={today}
            capped={LOG_ROWS}
          />
        </div>
      )}
    </div>
  );
}

// Each entry's person's number, for the tap-to-call buttons.
async function withPhones(organizationId: string, events: EventView[]): Promise<EventView[]> {
  const ids = [...new Set(events.map((event) => event.contactId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return events;
  const people = await prisma.contact.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, mobile: true, phone: true },
  });
  const phoneOf = new Map(people.map((person) => [person.id, person.mobile || person.phone || null]));
  return events.map((event) => ({ ...event, contactPhone: event.contactId ? (phoneOf.get(event.contactId) ?? null) : null }));
}
