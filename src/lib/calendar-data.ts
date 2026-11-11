// Loading events for a screen, and turning them into the shape the views
// read. One place, because five screens show the same card.

import { prisma } from "@/lib/prisma";
import { getEventTypes } from "@/lib/event-types";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { OPEN_PROJECT_STAGES } from "@/lib/constants";
import { UNASSIGNED_USER } from "@/lib/calendar-filters";
import type { EventChoices } from "@/app/dashboard/calendar/event-form";
import type { EventView } from "@/app/dashboard/calendar/calendar-views";

const EVENT_SELECT = {
  id: true,
  title: true,
  type: true,
  startOn: true,
  endOn: true,
  startTime: true,
  endTime: true,
  location: true,
  notes: true,
  doneAt: true,
  auto: true,
  projectId: true,
  scopeId: true,
  companyId: true,
  contactId: true,
  crewId: true,
  ownerId: true,
  quoteId: true,
  contractId: true,
  activityId: true,
  crew: { select: { name: true } },
  project: { select: { number: true, name: true } },
  scope: { select: { name: true } },
  company: { select: { name: true } },
  contact: { select: { name: true } },
  owner: { select: { name: true } },
  quote: { select: { number: true } },
  contract: { select: { number: true } },
  attendees: { orderBy: { name: "asc" as const }, select: { id: true, name: true } },
} as const;

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

export function toEventView(event: {
  id: string;
  title: string;
  type: string;
  startOn: Date;
  endOn: Date | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  notes: string;
  doneAt: Date | null;
  auto: boolean;
  projectId: string | null;
  scopeId: string | null;
  companyId: string | null;
  contactId: string | null;
  crewId: string | null;
  ownerId: string | null;
  quoteId: string | null;
  contractId: string | null;
  activityId: string | null;
  crew: { name: string } | null;
  project: { number: number; name: string } | null;
  scope: { name: string } | null;
  company: { name: string } | null;
  contact: { name: string } | null;
  owner: { name: string } | null;
  quote: { number: number } | null;
  contract: { number: number } | null;
  attendees: { id: string; name: string }[];
}): EventView {
  return {
    id: event.id,
    title: event.title,
    type: event.type,
    startOn: iso(event.startOn)!,
    endOn: iso(event.endOn),
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    notes: event.notes,
    projectId: event.projectId,
    scopeId: event.scopeId,
    companyId: event.companyId,
    contactId: event.contactId,
    crewId: event.crewId,
    ownerId: event.ownerId,
    attendeeIds: event.attendees.map((row) => row.id),
    crewName: event.crew?.name ?? null,
    projectLabel: event.project?.name ?? null,
    projectNumber: event.project?.number ?? null,
    scopeName: event.scope?.name ?? null,
    companyName: event.company?.name ?? null,
    contactName: event.contact?.name ?? null,
    ownerName: event.owner?.name ?? null,
    attendeeNames: event.attendees.map((row) => row.name),
    doneAt: event.doneAt ? event.doneAt.toISOString() : null,
    auto: event.auto,
    quoteId: event.quoteId,
    quoteNumber: event.quote?.number ?? null,
    contractId: event.contractId,
    contractNumber: event.contract?.number ?? null,
    activityId: event.activityId,
  };
}

// What the calendar can be narrowed to. Every list is "any of": two
// users picked shows both their days. Lists stack with each other, so
// one user plus one company is that user's days with that company.
export type EventFilters = {
  crewId?: string;
  type?: string;
  projectId?: string;
  // "none" among the ids means days on nobody's calendar.
  userIds?: string[];
  companyIds?: string[];
  contactIds?: string[];
  projectIds?: string[];
};

function filterWhere(filters?: EventFilters) {
  if (!filters) return {};
  const users = filters.userIds ?? [];
  const realUsers = users.filter((id) => id !== UNASSIGNED_USER);
  const wantsUnassigned = users.includes(UNASSIGNED_USER);
  return {
    ...(filters.crewId ? { crewId: filters.crewId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.companyIds?.length ? { companyId: { in: filters.companyIds } } : {}),
    ...(filters.projectIds?.length ? { projectId: { in: filters.projectIds } } : {}),
    AND: [
      // A contact counts whether the day is with them or they are only
      // expected at it, the same way their own page reads.
      ...(filters.contactIds?.length
        ? [
            {
              OR: [
                { contactId: { in: filters.contactIds } },
                { attendees: { some: { id: { in: filters.contactIds } } } },
              ],
            },
          ]
        : []),
      ...(users.length
        ? [
            {
              OR: [
                ...(realUsers.length ? [{ ownerId: { in: realUsers } }] : []),
                ...(wantsUnassigned ? [{ ownerId: null }] : []),
              ],
            },
          ]
        : []),
    ],
  };
}

// Events touching a window of days. An event that started before the
// window but runs into it still belongs on the screen, which is what the
// endOn clause is for.
export async function loadEvents(
  organizationId: string,
  window: { from: Date; to: Date },
  filters?: EventFilters,
) {
  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId,
      ...filterWhere(filters),
      OR: [
        { startOn: { gte: window.from, lte: window.to } },
        { AND: [{ startOn: { lt: window.from } }, { endOn: { gte: window.from } }] },
      ],
    },
    orderBy: [{ startOn: "asc" }, { startTime: "asc" }],
    select: EVENT_SELECT,
  });
  return events.map(toEventView);
}

// The Agenda's days, capped (perf fix, Nov 11, 2026). A team's Agenda at
// 200,000 contacts held 1,144 open entries and 1,000 done ones on today
// alone: 2,204 rows and 4.4 MB of page the browser spent seconds drawing.
// Each day now reads at most AGENDA_DAY_ROWS open entries and as many done
// ones (the done ones sit folded under the open), soonest first, with the
// day's real counts beside them so the page can say "Showing 60 of N".
// An entry belongs to every day it runs across, as on the grid.
export const AGENDA_DAY_ROWS = 60;

export type AgendaDay = {
  day: string;
  open: EventView[];
  done: EventView[];
  openCount: number;
  doneCount: number;
};

export async function loadAgenda(organizationId: string, days: string[], filters?: EventFilters, cap = AGENDA_DAY_ROWS) {
  // filterWhere carries its own AND, so it goes in as one clause of ours.
  const base = { organizationId, ...filterWhere(filters) };
  const onDay = (day: string) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    return { startOn: { lte: date }, OR: [{ startOn: date }, { endOn: { gte: date } }] };
  };
  const orderBy = [{ startTime: { sort: "asc" as const, nulls: "last" as const } }, { title: "asc" as const }, { id: "asc" as const }];
  const read = (day: string, done: boolean) =>
    prisma.calendarEvent.findMany({
      where: { AND: [base, onDay(day), { doneAt: done ? { not: null } : null }] },
      orderBy,
      take: cap + 1,
      select: EVENT_SELECT,
    });
  const count = (day: string, done: boolean) =>
    prisma.calendarEvent.count({ where: { AND: [base, onDay(day), { doneAt: done ? { not: null } : null }] } });
  return Promise.all(
    days.map(async (day): Promise<AgendaDay> => {
      const [open, done] = await Promise.all([read(day, false), read(day, true)]);
      // Counted only where a day ran past the cap; otherwise the rows are the count.
      const [openCount, doneCount] = await Promise.all([
        open.length > cap ? count(day, false) : open.length,
        done.length > cap ? count(day, true) : done.length,
      ]);
      return {
        day,
        open: open.slice(0, cap).map(toEventView),
        done: done.slice(0, cap).map(toEventView),
        openCount,
        doneCount,
      };
    }),
  );
}

// The window's own count for the header ("N things on"), each entry once
// however many days it runs across, as loadEvents' length was.
export async function countEvents(organizationId: string, window: { from: Date; to: Date }, filters?: EventFilters) {
  return prisma.calendarEvent.count({
    where: {
      organizationId,
      ...filterWhere(filters),
      OR: [
        { startOn: { gte: window.from, lte: window.to } },
        { AND: [{ startOn: { lt: window.from } }, { endOn: { gte: window.from } }] },
      ],
    },
  });
}

// The two log columns: what has happened, newest first, and what is
// coming, soonest first. Both hang off today rather than the month on
// the grid — "previous" and "upcoming" mean relative to now, whichever
// month is being paged through above them. Capped, so a busy workspace's
// whole history does not render on one screen.
export const LOG_ROWS = 60;

// The kinds of entry a person is meant to do something about, so one
// whose day has gone by unticked is overdue rather than merely past. A
// day of work (an install, a delivery) happened whether or not anybody
// ticked it, so it stays in Previous.
export const OVERDUE_TYPES = ["Call", "Meeting", "Email", "Text", "Quote due", "Quote follow up", "Contract follow up"];

// Gone by, unticked, and a kind somebody was meant to do (OVERDUE_TYPES).
// An entry still running into today isn't late yet.
function pastBefore(from: Date) {
  return { startOn: { lt: from }, OR: [{ endOn: null }, { endOn: { lt: from } }] };
}
const OVERDUE_WHERE = { doneAt: null, type: { in: OVERDUE_TYPES } };

export async function loadLogs(organizationId: string, today: string, filters?: EventFilters) {
  const from = new Date(`${today}T00:00:00.000Z`);
  const where = { organizationId, ...filterWhere(filters) };
  const [previous, upcoming, overdue] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { ...where, ...pastBefore(from), NOT: OVERDUE_WHERE },
      orderBy: [{ startOn: "desc" }, { startTime: "desc" }],
      take: LOG_ROWS,
      select: EVENT_SELECT,
    }),
    prisma.calendarEvent.findMany({
      where: { ...where, OR: [{ startOn: { gte: from } }, { endOn: { gte: from } }] },
      orderBy: [{ startOn: "asc" }, { startTime: "asc" }],
      take: LOG_ROWS,
      select: EVENT_SELECT,
    }),
    loadOverdue(organizationId, today, filters),
  ]);
  return {
    previous: previous.map(toEventView),
    upcoming: upcoming.map(toEventView),
    overdue,
  };
}

// The Log's Overdue column on its own (final audit, Nov 11, 2026): the
// Agenda shows only this, and ran the whole loadLogs — three 60-row reads
// with every relation — for it. Oldest first: the one that has waited
// longest is at the top. Reads the open entries' index
// (CalendarEvent_open_startOn_idx), never the done history. The clauses
// are ANDed, not spread: spread, OVERDUE_WHERE's type list replaced the
// toolbar's Type filter, so ?type=Call still listed overdue emails and
// texts, and ?type=Install listed every overdue entry.
export async function loadOverdue(organizationId: string, today: string, filters?: EventFilters) {
  const from = new Date(`${today}T00:00:00.000Z`);
  const overdue = await prisma.calendarEvent.findMany({
    where: { AND: [{ organizationId, ...filterWhere(filters) }, pastBefore(from), OVERDUE_WHERE] },
    orderBy: [{ startOn: "asc" }, { startTime: "asc" }],
    take: LOG_ROWS,
    select: EVENT_SELECT,
  });
  return overdue.map(toEventView);
}

// The team view: one row per teammate and per crew, for one week. The
// same events as the week grid, with the crew list to name the rows.
export async function loadCrewRows(organizationId: string) {
  return prisma.crew.findMany({
    where: { organizationId, active: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true },
  });
}

// Names for whatever the filters point at, so a chip can read "Harbor
// Property Group" rather than an id — including a company past the 200
// the pickers offer.
export async function loadFilterLabels(
  organizationId: string,
  ids: { companyIds: string[]; contactIds: string[]; projectIds: string[] },
) {
  const [companies, contacts, projects] = await Promise.all([
    ids.companyIds.length
      ? prisma.company.findMany({ where: { organizationId, id: { in: ids.companyIds } }, select: { id: true, name: true } })
      : [],
    ids.contactIds.length
      ? prisma.contact.findMany({ where: { organizationId, id: { in: ids.contactIds } }, select: { id: true, name: true } })
      : [],
    ids.projectIds.length
      ? prisma.project.findMany({
          where: { organizationId, id: { in: ids.projectIds } },
          select: { id: true, number: true, name: true },
        })
      : [],
  ]);
  return {
    companies,
    contacts,
    projects: projects.map((project) => ({ id: project.id, name: `PRJ-${project.number} · ${project.name}` })),
  };
}

// Everything the event form needs to offer. The pickers are capped: a
// workspace with a big imported CRM does not need every contact in a
// dropdown, and the ones you schedule with are the ones you deal with.
export async function loadEventChoices(organizationId: string, me?: string): Promise<EventChoices> {
  const [eventTypes, crews, projects, contacts, companies, users] = await Promise.all([
    getEventTypes(organizationId),
    prisma.crew.findMany({
      where: { organizationId, active: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true },
    }),
    prisma.project.findMany({
      where: { organizationId, stage: { in: [...OPEN_PROJECT_STAGES] } },
      orderBy: { number: "desc" },
      take: 200,
      select: {
        id: true,
        number: true,
        name: true,
        scopes: { orderBy: { position: "asc" }, select: { id: true, name: true, isDefault: true } },
      },
    }),
    prisma.contact.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
    prisma.company.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
    loadWorkspaceUsers(organizationId),
  ]);

  return {
    eventTypes,
    crews,
    projects: projects.map((project) => ({
      id: project.id,
      label: `PRJ-${project.number} · ${project.name}`,
      scopes: project.scopes,
    })),
    contacts,
    companies,
    users: users.map((user) => ({ id: user.id, name: user.name })),
    me: me ?? "",
  };
}

export { EVENT_SELECT };

// What is coming up with one person, company or job — today onwards, the
// next few, for the card on their page. A day that started earlier but
// runs into today still counts as coming up. Anything already ticked
// done does not: the quote that went out this morning is history, and
// it was pushing the walk-through next month off the card.
export async function upcomingFor(
  organizationId: string,
  who: { contactId?: string; companyId?: string; projectId?: string },
  today: string,
  take = 5,
) {
  const from = new Date(`${today}T00:00:00.000Z`);
  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId,
      ...(who.contactId
        ? { OR: [{ contactId: who.contactId }, { attendees: { some: { id: who.contactId } } }] }
        : {}),
      ...(who.companyId ? { companyId: who.companyId } : {}),
      ...(who.projectId ? { projectId: who.projectId } : {}),
      doneAt: null,
      AND: [{ OR: [{ startOn: { gte: from } }, { endOn: { gte: from } }] }],
    },
    orderBy: [{ startOn: "asc" }, { startTime: "asc" }],
    take,
    select: {
      id: true,
      title: true,
      type: true,
      startOn: true,
      endOn: true,
      startTime: true,
      endTime: true,
      location: true,
      projectId: true,
      project: { select: { number: true } },
    },
  });

  return events.map((event) => ({
    id: event.id,
    title: event.title,
    type: event.type,
    startOn: iso(event.startOn)!,
    endOn: iso(event.endOn),
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    projectId: event.projectId,
    projectNumber: event.project?.number ?? null,
  }));
}
