// Loading events for a screen, and turning them into the shape the views
// read. One place, because five screens show the same card.

import { prisma } from "@/lib/prisma";
import { getEventTypes } from "@/lib/event-types";
import { OPEN_PROJECT_STAGES } from "@/lib/constants";
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
  projectId: true,
  scopeId: true,
  companyId: true,
  contactId: true,
  crewId: true,
  crew: { select: { name: true } },
  project: { select: { number: true, name: true } },
  scope: { select: { name: true } },
  company: { select: { name: true } },
  contact: { select: { name: true } },
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
  projectId: string | null;
  scopeId: string | null;
  companyId: string | null;
  contactId: string | null;
  crewId: string | null;
  crew: { name: string } | null;
  project: { number: number; name: string } | null;
  scope: { name: string } | null;
  company: { name: string } | null;
  contact: { name: string } | null;
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
    attendeeIds: event.attendees.map((row) => row.id),
    crewName: event.crew?.name ?? null,
    projectLabel: event.project?.name ?? null,
    projectNumber: event.project?.number ?? null,
    scopeName: event.scope?.name ?? null,
    companyName: event.company?.name ?? null,
    contactName: event.contact?.name ?? null,
    attendeeNames: event.attendees.map((row) => row.name),
    doneAt: event.doneAt ? event.doneAt.toISOString() : null,
  };
}

// Events touching a window of days. An event that started before the
// window but runs into it still belongs on the screen, which is what the
// endOn clause is for.
export async function loadEvents(
  organizationId: string,
  window: { from: Date; to: Date },
  filters?: { crewId?: string; type?: string; projectId?: string },
) {
  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId,
      ...(filters?.crewId ? { crewId: filters.crewId } : {}),
      ...(filters?.type ? { type: filters.type } : {}),
      ...(filters?.projectId ? { projectId: filters.projectId } : {}),
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

// Everything the event form needs to offer. The pickers are capped: a
// workspace with a big imported CRM does not need every contact in a
// dropdown, and the ones you schedule with are the ones you deal with.
export async function loadEventChoices(organizationId: string): Promise<EventChoices> {
  const [eventTypes, crews, projects, contacts, companies] = await Promise.all([
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
  };
}

export { EVENT_SELECT };

// What is coming up with one person, company or job — today onwards, the
// next few, for the card on their page. A day that started earlier but
// runs into today still counts as coming up.
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
