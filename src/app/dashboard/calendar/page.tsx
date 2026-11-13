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
import { LOG_ROWS, countEvents, loadAgenda, loadCrewRows, loadEvents, loadEventChoices, loadFilterLabels, loadLogs, loadOverdue, type AgendaDay, type EventFilters } from "@/lib/calendar-data";
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
  scope?: string;
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
  // A bare address opens the view the person last picked (uiPrefs
  // calendar.view, Round 2), else the Agenda for a Member and the Month for
  // an Owner or Admin (a phone swaps a bare Month for the Agenda).
  const rememberedView = prefChoice(prefs, "calendar", "view", ["agenda", "week", "month"] as const);
  const wanted = bare ? (rememberedView ?? (member ? "agenda" : "month")) : params.view;
  const view = wanted === "week" ? "week" : wanted === "team" ? "team" : wanted === "agenda" ? "agenda" : "month";
  // The Agenda takes Log and Calendar + Log too (audit, Nov 11, 2026): the
  // plan's "History is a tab". A Member's default calendar had no way to
  // the history short of switching to Week first.
  const layout = readLayout(params.layout);
  // Anything that is not a real day falls back to today rather than
  // taking the page down with it.
  const asked = isRealDay(params.on) ? params.on : today;
  const anchor = view === "month" ? startOfMonth(asked) : startOfWeek(asked);

  const urlUsers = readIds(params.users);
  // ?scope=team is the whole team without naming anyone (the Daily
  // Rundown's whole-team "See all"; audit, Nov 11, 2026); it is not saved.
  const remembered =
    params.scope === "team" ? "team" : (prefChoice(prefs, "calendar", "scope", ["mine", "team"] as const) ?? (member ? "mine" : "team"));
  // Audit fixes (Nov 12, 2026): a filter no longer drops a Member's Mine
  // (picking a company showed the whole team's days and flipped the toggle
  // to Team), and the Team week, a row per teammate, always reads everyone's
  // days (under Mine every other row read empty, as if they were free).
  const scope: "mine" | "team" | "custom" = urlUsers.length
    ? urlUsers.length === 1 && urlUsers[0] === userId
      ? "mine"
      : "custom"
    : view === "team"
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

  // The Agenda reads its days capped (perf fix, Nov 11, 2026): loadAgenda,
  // not the whole window, and the window's count on its own for the header.
  const agendaShown = view === "agenda" && layout !== "log";
  const [loaded, choices, logs, labels, crews, overdue, agendaRaw, agendaTotal] = await Promise.all([
    layout === "log" || agendaShown ? [] : loadEvents(organizationId, { from, to }, filters),
    loadEventChoices(organizationId, userId),
    layout === "calendar" ? null : loadLogs(organizationId, today, filters),
    loadFilterLabels(organizationId, {
      companyIds: filters.companyIds ?? [],
      contactIds: filters.contactIds ?? [],
      projectIds: filters.projectIds ?? [],
    }),
    view === "team" && layout !== "log" ? loadCrewRows(organizationId) : [],
    // The overdue read alone (final audit, Nov 11, 2026), not the whole log.
    view === "agenda" && layout === "calendar" ? loadOverdue(organizationId, today, filters) : Promise.resolve([] as EventView[]),
    agendaShown ? loadAgenda(organizationId, days, filters) : Promise.resolve([] as AgendaDay[]),
    agendaShown ? countEvents(organizationId, { from, to }, filters) : Promise.resolve(0),
  ]);

  // The Agenda's rows, each once (a multi-day entry sits under every day it
  // runs across), with their numbers put on in one statement.
  const agendaRows = new Map<string, EventView>();
  for (const entry of agendaRaw) for (const event of [...entry.open, ...entry.done]) agendaRows.set(event.id, event);
  const agendaPhoned = new Map((await withPhones(organizationId, [...agendaRows.values()])).map((event) => [event.id, event]));
  const agenda: AgendaDay[] = agendaRaw.map((entry) => ({
    ...entry,
    open: entry.open.map((event) => agendaPhoned.get(event.id) ?? event),
    done: entry.done.map((event) => agendaPhoned.get(event.id) ?? event),
  }));

  // Real tap-to-call: the person's mobile, else their phone, for every
  // entry with someone on it (one statement for the window).
  const events = agendaShown ? [...agendaPhoned.values()] : await withPhones(organizationId, loaded);
  const overdueRows = await withPhones(organizationId, logs ? logs.overdue : overdue);

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
  const thingsOn = agendaShown ? agendaTotal : events.length;

  const filtering =
    Boolean(params.crew || params.type) ||
    (scope === "mine" && urlUsers.length === 0 ? 0 : (filters.userIds?.length ?? 0)) +
      (filters.companyIds?.length ?? 0) +
      (filters.contactIds?.length ?? 0) +
      (filters.projectIds?.length ?? 0) >
      0;

  const subtitle =
    view === "agenda" && layout !== "log"
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
              {thingsOn} {thingsOn === 1 ? "thing on" : "things on"}
              {filtering && " with the filters on"}
            </p>
          )
        }
      />

      {bare && !rememberedView && view !== "agenda" && <PhoneAgenda />}
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
        layout !== "log" && (
          <AgendaView today={today} agenda={agenda} overdue={overdueRows} choices={choices} overdueCap={LOG_ROWS} />
        )
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
