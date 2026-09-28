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

// The two log columns: what has happened, newest first, and what is
// coming, soonest first. Both hang off today rather than the month on
// the grid — "previous" and "upcoming" mean relative to now, whichever
// month is being paged through above them. Capped, so a busy workspace's
// whole history does not render on one screen.
export const LOG_ROWS = 60;

export async function loadLogs(organizationId: string, today: string, filters?: EventFilters) {
  const from = new Date(`${today}T00:00:00.000Z`);
  const where = { organizationId, ...filterWhere(filters) };
  const [previous, upcoming] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { ...where, startOn: { lt: from }, OR: [{ endOn: null }, { endOn: { lt: from } }] },
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
  ]);
  return { previous: previous.map(toEventView), upcoming: upcoming.map(toEventView) };
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
