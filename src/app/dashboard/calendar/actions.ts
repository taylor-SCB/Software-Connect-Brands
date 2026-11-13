"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { parseForm, keepFields, type ActionState } from "@/lib/forms";
import { isoToDate, todayIso, addDays } from "@/lib/payments";
import { cleanTime, eventDays, MAX_EVENT_DAYS } from "@/lib/calendar";
import { formatDay } from "@/lib/format";
import { ensureEventType } from "@/lib/event-types";
import { ACTIVITY_TYPES, INSTALL_EVENT_TYPE } from "@/lib/constants";
import { logEventDone, unlogEventDone } from "@/lib/calendar-auto";
import { markMeetingSet } from "@/lib/status";
import { UNASSIGNED_USER } from "@/lib/calendar-filters";
import { zonedMoment } from "@/lib/calendar-auto";
import { markSchema, nextStepSchema, outcomeProblem, outcomeSchema, reasonSchema } from "@/lib/outcomes";

const idSchema = z.string().trim().min(1, "Missing record reference");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day");

function revalidateCalendar(projectId?: string | null) {
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard");
  if (projectId) {
    revalidatePath(`/dashboard/projects/${projectId}/schedule`);
    revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/projects");
  }
}

const eventSchema = z.object({
  eventId: z.string().trim().optional(),
  title: z.string().trim().min(1, "Give it a name").max(160),
  type: z.string().trim().min(1, "Pick what kind of day it is").max(60),
  startOn: isoDate,
  endOn: z.union([isoDate, z.literal("")]).optional(),
  location: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  projectId: z.string().trim().optional(),
  scopeId: z.string().trim().optional(),
  dealId: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
  contactId: z.string().trim().optional(),
  crewId: z.string().trim().optional(),
  ownerId: z.string().trim().optional(),
});

// The text fields the form can put back when a save is refused.
const EVENT_FIELDS = [
  "title",
  "type",
  "startOn",
  "endOn",
  "startTime",
  "endTime",
  "location",
  "notes",
] as const;

// One form creates and edits any kind of day: an install, a site walk, a
// construction meeting with the owner's team. Everything it can be tied
// to is optional, because a site walk often happens before there is a job
// and a coffee with a contact belongs to nothing at all.
export async function saveEvent(_prev: ActionState, formData: FormData): Promise<ActionState & { eventId?: string }> {
  const { organizationId, userId } = await requireSession();
  // Whatever was typed, ready to hand back with any refusal below.
  const kept = keepFields(formData, EVENT_FIELDS);
  const parsed = parseForm(eventSchema, {
    eventId: formData.get("eventId") ?? undefined,
    title: formData.get("title"),
    type: formData.get("type"),
    startOn: formData.get("startOn"),
    endOn: formData.get("endOn") ?? undefined,
    location: formData.get("location") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    projectId: formData.get("projectId") ?? undefined,
    scopeId: formData.get("scopeId") ?? undefined,
    dealId: formData.get("dealId") ?? undefined,
    companyId: formData.get("companyId") ?? undefined,
    contactId: formData.get("contactId") ?? undefined,
    crewId: formData.get("crewId") ?? undefined,
    ownerId: formData.get("ownerId") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error, kept };

  const startOn = parsed.data.startOn;
  const endOn = parsed.data.endOn || "";
  if (endOn && endOn < startOn) {
    return { error: "The last day cannot be before the first one.", kept };
  }
  if (endOn && eventDays({ startOn, endOn }).length >= MAX_EVENT_DAYS) {
    return { error: `That is more than ${MAX_EVENT_DAYS} days. Book it in shorter stretches.`, kept };
  }

  const startTime = cleanTime(formData.get("startTime"));
  const endTime = cleanTime(formData.get("endTime"));
  // A day that runs backwards on the clock is a typo, not a night shift
  // spanning midnight — those are two days and get two events.
  if (startTime && endTime && endTime <= startTime && (!endOn || endOn === startOn)) {
    return { error: "The finish time is before the start time.", kept };
  }

  const type = (await ensureEventType(organizationId, parsed.data.type)) ?? parsed.data.type;

  // Everything it points at has to be this workspace's.
  const project = parsed.data.projectId
    ? await prisma.project.findFirst({
        where: { id: parsed.data.projectId, organizationId },
        select: { id: true, stage: true, startOn: true, siteAddress: true, companyId: true, contactId: true },
      })
    : null;
  const scope = parsed.data.scopeId && project
    ? await prisma.projectScope.findFirst({
        where: { id: parsed.data.scopeId, projectId: project.id },
        select: { id: true },
      })
    : null;
  const deal = parsed.data.dealId
    ? await prisma.deal.findFirst({ where: { id: parsed.data.dealId, organizationId }, select: { id: true } })
    : null;
  const company = parsed.data.companyId
    ? await prisma.company.findFirst({ where: { id: parsed.data.companyId, organizationId }, select: { id: true } })
    : null;
  const contact = parsed.data.contactId
    ? await prisma.contact.findFirst({ where: { id: parsed.data.contactId, organizationId }, select: { id: true } })
    : null;
  const crew = parsed.data.crewId
    ? await prisma.crew.findFirst({ where: { id: parsed.data.crewId, organizationId }, select: { id: true } })
    : null;
  // Whose calendar. A form that does not carry the field (a page that
  // predates it) puts the day on the calendar of whoever is saving. A
  // removed teammate can still be kept as the owner — that is the form
  // handing back what was there, not a new assignment.
  const ownerField = formData.get("ownerId");
  const owner =
    ownerField === null
      ? { id: userId }
      : parsed.data.ownerId
        ? await prisma.user.findFirst({ where: { id: parsed.data.ownerId, organizationId }, select: { id: true } })
        : null;

  // Who is expected. Scoped to the workspace the same way, so a guessed
  // id cannot put somebody else's contact on your calendar.
  const attendeeIds = formData
    .getAll("attendees")
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const attendees = attendeeIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: attendeeIds }, organizationId },
        select: { id: true },
      })
    : [];

  const data = {
    title: parsed.data.title,
    type,
    startOn: isoToDate(startOn)!,
    endOn: endOn ? isoToDate(endOn) : null,
    startTime,
    endTime,
    // A job's site address is the answer nine times out of ten, so it
    // fills in when nothing was typed — and stays editable.
    location: parsed.data.location || project?.siteAddress || null,
    notes: parsed.data.notes ?? "",
    projectId: project?.id ?? null,
    scopeId: scope?.id ?? null,
    dealId: deal?.id ?? null,
    companyId: company?.id ?? project?.companyId ?? null,
    contactId: contact?.id ?? project?.contactId ?? null,
    crewId: crew?.id ?? null,
    ownerId: owner?.id ?? null,
  };

  let eventId = parsed.data.eventId ?? "";
  // The job it was on before, so moving a day off a job — or off jobs
  // altogether — recomputes that job too. Without it the old job kept a
  // start date and an Active stage with nothing scheduled on it.
  let previousProjectId: string | null = null;
  if (eventId) {
    const existing = await prisma.calendarEvent.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true, projectId: true },
    });
    if (!existing) return { error: "That day is no longer on the calendar", kept };
    previousProjectId = existing.projectId;
    await prisma.calendarEvent.update({
      where: { id: existing.id },
      data: { ...data, attendees: { set: attendees.map((row) => ({ id: row.id })) } },
    });
  } else {
    const created = await prisma.calendarEvent.create({
      data: { organizationId, ...data, createdById: userId, attendees: { connect: attendees.map((row) => ({ id: row.id })) } },
      select: { id: true },
    });
    eventId = created.id;
  }

  // A meeting on the calendar with someone sets it (Sept 30, 2026) — the
  // first one for that person; anyone already past Meeting Set stays put.
  if (type === "Meeting") {
    const people = [data.contactId, ...attendees.map((row) => row.id)].filter((id): id is string => Boolean(id));
    // The meeting's moment in the workspace's clock (audit, Nov 11, 2026),
    // as the Book meeting sheet writes it: the bare day was midnight UTC,
    // the evening before in the US, so the one meeting rule called a 4pm
    // meeting "already happened" from 7pm the night before, and an edit
    // here overwrote the sheet's right moment with it.
    const timeZone = await getTimeZone();
    const at = zonedMoment(startOn, startTime ?? "12:00", timeZone);
    await markMeetingSet({ organizationId, userId }, Array.from(new Set(people)), new Date(), { on: at, eventId });
  }

  await startJobOnFirstDatedDay(organizationId, project?.id);
  if (previousProjectId && previousProjectId !== project?.id) {
    await startJobOnFirstDatedDay(organizationId, previousProjectId);
    revalidateCalendar(previousProjectId);
  }
  revalidateCalendar(project?.id);
  if (data.contactId) revalidatePath(`/dashboard/contacts/${data.contactId}`);
  if (data.companyId) revalidatePath(`/dashboard/companies/${data.companyId}`);
  return { success: `${parsed.data.title} is on the calendar`, eventId };
}

// A job stops being merely Awarded the moment work is actually dated, and
// its start date is the first day anybody is due on site. Only ever moves
// a job forward: a Delayed or Completed job keeps the stage a person set.
async function startJobOnFirstDatedDay(organizationId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, stage: true },
  });
  if (!project) return;

  const first = await prisma.calendarEvent.findFirst({
    where: { organizationId, projectId, type: INSTALL_EVENT_TYPE },
    orderBy: { startOn: "asc" },
    select: { startOn: true },
  });

  await prisma.project.updateMany({
    where: { id: projectId, organizationId },
    data: {
      startOn: first?.startOn ?? null,
      ...(first && project.stage === "AWARDED" ? { stage: "ACTIVE" as const } : {}),
    },
  });
}

export async function deleteEvent(eventId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();
  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, organizationId },
    select: { id: true, title: true, projectId: true, ownerId: true, createdById: true },
  });
  if (!event) return { error: "That day is no longer on the calendar" };
  // Delegated to you by a teammate (Taylor, Nov 12, 2026): it can be
  // handed back to them, not deleted.
  if (isDelegatedTo(event, userId)) return { error: "A teammate put this on your calendar. Hand it back to them instead of deleting it." };

  await prisma.calendarEvent.deleteMany({ where: { id: event.id, organizationId } });
  await startJobOnFirstDatedDay(organizationId, event.projectId);
  revalidateCalendar(event.projectId);
  return { success: `${event.title} taken off the calendar` };
}

export async function setEventDone(eventId: string, done: boolean): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, organizationId },
    select: { id: true, projectId: true, contactId: true, companyId: true },
  });
  if (!event) return { error: "That day is no longer on the calendar" };

  // Unticking an entry that was logged from the calendar takes its
  // history line back out with it.
  if (!done) await unlogEventDone(organizationId, event.id);

  await prisma.calendarEvent.updateMany({
    where: { id: event.id, organizationId },
    data: { doneAt: done ? new Date() : null },
  });
  revalidateCalendar(event.projectId);
  if (event.contactId) revalidatePath(`/dashboard/contacts/${event.contactId}`);
  if (event.companyId) revalidatePath(`/dashboard/companies/${event.companyId}`);
  return { success: done ? "Done" : "Back on the list" };
}

// "How did it go?": ticks the entry done and writes what happened into
// the history of whoever it was with, so a scheduled call becomes a
// logged call in one step. Since Nov 11, 2026 it also takes how it went
// (`outcome`), an Interested / Not interested `mark` with its `reason`,
// the next step (`next`, the same shape as logActivity's), and `early` to
// say a meeting still ahead happened early. A meeting still ahead marked
// Held without `early` comes back as { confirmEarly: "yyyy-mm-dd" } and
// nothing is written. `batchId` is what undoLog takes back.
export async function completeEventWithLog(
  eventId: string,
  input: {
    activityType: string;
    note: string;
    outcome?: string | null;
    mark?: string | null;
    reason?: string | null;
    next?: unknown;
    early?: boolean;
  },
): Promise<ActionState & { batchId?: string; confirmEarly?: string; notices?: string[]; opportunityId?: string | null }> {
  const { organizationId, userId } = await requireSession();
  const parsed = z
    .object({
      eventId: idSchema,
      activityType: z.enum(ACTIVITY_TYPES),
      note: z.string().trim().max(5000),
      outcome: outcomeSchema.nullish(),
      mark: markSchema.nullish(),
      reason: reasonSchema.nullish(),
      next: nextStepSchema.optional(),
      early: z.boolean().optional(),
    })
    .safeParse({ eventId, ...input });
  if (!parsed.success) return { error: "Pick what kind of touch it was" };
  const problem = outcomeProblem(parsed.data.activityType, parsed.data.outcome);
  if (problem) return { error: problem };

  const result = await logEventDone({
    organizationId,
    userId,
    eventId: parsed.data.eventId,
    activityType: parsed.data.activityType,
    note: parsed.data.note,
    outcome: parsed.data.outcome ?? null,
    mark: parsed.data.mark ?? null,
    reason: parsed.data.mark === "NOT_INTERESTED" ? (parsed.data.reason ?? null) : null,
    next: parsed.data.next,
    early: parsed.data.early,
  });
  if ("error" in result) return { error: result.error, ...(result.confirmEarly ? { confirmEarly: result.confirmEarly } : {}) };

  const event = await prisma.calendarEvent.findFirst({
    where: { id: parsed.data.eventId, organizationId },
    select: { projectId: true },
  });
  revalidateCalendar(event?.projectId);
  for (const contactId of result.contactIds) revalidatePath(`/dashboard/contacts/${contactId}`);
  if (result.companyId) revalidatePath(`/dashboard/companies/${result.companyId}`);
  if (result.opportunityId) revalidatePath("/dashboard/deals");
  return { success: ["Done and logged", ...result.notices].join(" · "), batchId: result.batchId, notices: result.notices, opportunityId: result.opportunityId ?? null };
}

// Dragging is a mouse gesture a phone cannot do, so moving a day is a
// date: same event, new days, the length kept.
export async function moveEvent(eventId: string, startOn: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = z.object({ eventId: idSchema, startOn: isoDate }).safeParse({ eventId, startOn });
  if (!parsed.success) return { error: "Pick a day to move it to" };

  const event = await prisma.calendarEvent.findFirst({
    where: { id: parsed.data.eventId, organizationId },
    select: { id: true, startOn: true, endOn: true, startTime: true, projectId: true },
  });
  if (!event) return { error: "That day is no longer on the calendar" };

  const wasStart = event.startOn.toISOString().slice(0, 10);
  const wasEnd = event.endOn ? event.endOn.toISOString().slice(0, 10) : null;
  const length = wasEnd ? eventDays({ startOn: wasStart, endOn: wasEnd }).length - 1 : 0;

  await prisma.calendarEvent.updateMany({
    where: { id: event.id, organizationId },
    data: {
      startOn: isoToDate(parsed.data.startOn)!,
      endOn: length > 0 ? isoToDate(addDays(parsed.data.startOn, length)) : null,
    },
  });
  // A booked meeting moves with its entry (audit, Nov 11, 2026): its row
  // kept the old moment, so a meeting moved to next week was "waiting for
  // Held / No-show" from its old time on Up next, My day and the Pipeline.
  // Only meetings not yet answered; the entry's id ties them to this one.
  const timeZone = await getTimeZone();
  await prisma.opportunityMeeting.updateMany({
    where: { eventId: event.id, outcome: null, opportunity: { organizationId } },
    data: { on: zonedMoment(parsed.data.startOn, event.startTime ?? "12:00", timeZone) },
  });
  await startJobOnFirstDatedDay(organizationId, event.projectId);
  revalidateCalendar(event.projectId);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/deals");
  return { success: "Moved" };
}

/* ----------------------------- Copy this week ----------------------------- */

// The same week again: a crew on the same site Monday to Friday for a
// month is one press a week rather than five entries. Copies the days a
// crew has in one week into the next, keeping the weekday, the times and
// what each day belongs to.
export async function copyWeek(input: {
  weekOf: string;
  crewId?: string;
  projectId?: string;
  // Whatever the screen is filtering by, so the copy matches what is on
  // it. Copying while filtered to Install used to duplicate the hidden
  // site walks and meetings too, and report a count nobody could see.
  type?: string;
  // Mine (the viewer's own days), and the Users / Companies / Contacts /
  // Projects filters, as the screen has them.
  mine?: boolean;
  userIds?: string[];
  companyIds?: string[];
  contactIds?: string[];
  projectIds?: string[];
}): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();
  const ids = z.array(z.string().trim().min(1).max(64)).max(50).optional();
  const parsed = z
    .object({
      weekOf: isoDate,
      crewId: z.string().trim().optional(),
      projectId: z.string().trim().optional(),
      type: z.string().trim().max(60).optional(),
      mine: z.boolean().optional(),
      userIds: ids,
      companyIds: ids,
      contactIds: ids,
      projectIds: ids,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Pick the week to copy" };
  const users = parsed.data.userIds?.length ? parsed.data.userIds : parsed.data.mine ? [userId] : [];
  const realUsers = users.filter((id) => id !== UNASSIGNED_USER);
  const contactIds = parsed.data.contactIds ?? [];

  const from = parsed.data.weekOf;
  const to = addDays(from, 7);
  const source = await prisma.calendarEvent.findMany({
    where: {
      organizationId,
      startOn: { gte: isoToDate(from)!, lt: isoToDate(to)! },
      // A week of work is what gets copied. The app's own entries — a
      // quote that went out, a call that was logged — happened once and
      // would be nonsense a week later.
      auto: false,
      ...(parsed.data.crewId ? { crewId: parsed.data.crewId } : {}),
      ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {}),
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
      ...(parsed.data.companyIds?.length ? { companyId: { in: parsed.data.companyIds } } : {}),
      ...(parsed.data.projectIds?.length ? { projectId: { in: parsed.data.projectIds } } : {}),
      AND: [
        ...(contactIds.length ? [{ OR: [{ contactId: { in: contactIds } }, { attendees: { some: { id: { in: contactIds } } } }] }] : []),
        ...(users.length
          ? [{ OR: [...(realUsers.length ? [{ ownerId: { in: realUsers } }] : []), ...(users.includes(UNASSIGNED_USER) ? [{ ownerId: null }] : [])] }]
          : []),
      ],
    },
    select: {
      title: true,
      type: true,
      startOn: true,
      endOn: true,
      startTime: true,
      endTime: true,
      location: true,
      notes: true,
      projectId: true,
      scopeId: true,
      dealId: true,
      companyId: true,
      contactId: true,
      crewId: true,
      ownerId: true,
      attendees: { select: { id: true } },
    },
  });
  if (source.length === 0) return { error: "There is nothing in that week to copy." };

  for (const event of source) {
    const startOn = addDays(event.startOn.toISOString().slice(0, 10), 7);
    const endOn = event.endOn ? addDays(event.endOn.toISOString().slice(0, 10), 7) : null;
    await prisma.calendarEvent.create({
      data: {
        organizationId,
        title: event.title,
        type: event.type,
        startOn: isoToDate(startOn)!,
        endOn: endOn ? isoToDate(endOn) : null,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location,
        notes: event.notes,
        projectId: event.projectId,
        scopeId: event.scopeId,
        dealId: event.dealId,
        companyId: event.companyId,
        contactId: event.contactId,
        crewId: event.crewId,
        ownerId: event.ownerId,
        attendees: { connect: event.attendees.map((row) => ({ id: row.id })) },
      },
    });
  }

  revalidateCalendar(parsed.data.projectId);
  return {
    success: `${source.length} ${source.length === 1 ? "day" : "days"} copied into the week of ${formatDay(
      `${addDays(from, 7)}T12:00:00Z`,
    )}`,
  };
}

/* -------------------------- Scheduling install days -------------------------- */

// "Schedule install" on a scope of work: books the days, on the crew
// already assigned to that scope, without making anybody fill in a form
// about what kind of day it is.
export async function scheduleInstall(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();
  const timeZone = await getTimeZone();
  const parsed = parseForm(
    z.object({
      projectId: idSchema,
      scopeId: z.string().trim().optional(),
      startOn: isoDate,
      endOn: z.union([isoDate, z.literal("")]).optional(),
    }),
    {
      projectId: formData.get("projectId"),
      scopeId: formData.get("scopeId") ?? undefined,
      startOn: formData.get("startOn") || todayIso(timeZone),
      endOn: formData.get("endOn") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: { id: true, name: true, siteAddress: true, companyId: true, contactId: true },
  });
  if (!project) return { error: "Project not found" };

  const scope = parsed.data.scopeId
    ? await prisma.projectScope.findFirst({
        where: { id: parsed.data.scopeId, projectId: project.id },
        select: { id: true, name: true, isDefault: true, crewId: true },
      })
    : null;

  const endOn = parsed.data.endOn || "";
  if (endOn && endOn < parsed.data.startOn) return { error: "The last day cannot be before the first one." };
  if (endOn && eventDays({ startOn: parsed.data.startOn, endOn }).length >= MAX_EVENT_DAYS) {
    return { error: `That is more than ${MAX_EVENT_DAYS} days. Book it in shorter stretches.` };
  }

  const type = (await ensureEventType(organizationId, INSTALL_EVENT_TYPE)) ?? INSTALL_EVENT_TYPE;
  const startTime = cleanTime(formData.get("startTime"));
  const endTime = cleanTime(formData.get("endTime"));

  await prisma.calendarEvent.create({
    data: {
      organizationId,
      // Named after the work, not the app: "Roofing — Harbor reroof".
      title: scope && !scope.isDefault ? `${scope.name} — ${project.name}` : project.name,
      type,
      startOn: isoToDate(parsed.data.startOn)!,
      endOn: endOn ? isoToDate(endOn) : null,
      startTime,
      endTime,
      location: project.siteAddress,
      projectId: project.id,
      scopeId: scope?.id ?? null,
      crewId: scope?.crewId ?? null,
      companyId: project.companyId,
      contactId: project.contactId,
      ownerId: userId,
    },
  });

  await startJobOnFirstDatedDay(organizationId, project.id);
  revalidateCalendar(project.id);
  return { success: "Install booked" };
}

/* ------------------------------ Things to do ------------------------------ */

export async function addTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = parseForm(
    z.object({
      projectId: idSchema,
      title: z.string().trim().min(1, "What needs doing?").max(200),
      dueOn: z.union([isoDate, z.literal("")]).optional(),
    }),
    {
      projectId: formData.get("projectId"),
      title: formData.get("title"),
      dueOn: formData.get("dueOn") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: { id: true, _count: { select: { tasks: true } } },
  });
  if (!project) return { error: "Project not found" };

  await prisma.projectTask.create({
    data: {
      organizationId,
      projectId: project.id,
      title: parsed.data.title,
      dueOn: parsed.data.dueOn ? isoToDate(parsed.data.dueOn) : null,
      position: project._count.tasks,
    },
  });
  revalidateCalendar(project.id);
  return { success: "Added" };
}

export async function setTaskDone(taskId: string, done: boolean): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const task = await prisma.projectTask.findFirst({
    where: { id: taskId, organizationId },
    select: { id: true, projectId: true },
  });
  if (!task) return { error: "That task is gone" };

  await prisma.projectTask.updateMany({
    where: { id: task.id, organizationId },
    data: { doneAt: done ? new Date() : null },
  });
  revalidateCalendar(task.projectId);
  return { success: done ? "Done" : "Back on the list" };
}

export async function deleteTask(taskId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const task = await prisma.projectTask.findFirst({
    where: { id: taskId, organizationId },
    select: { id: true, projectId: true },
  });
  if (!task) return { error: "That task is gone" };

  await prisma.projectTask.deleteMany({ where: { id: task.id, organizationId } });
  revalidateCalendar(task.projectId);
  return { success: "Removed" };
}

// On this person's calendar, put there by someone else who is still around
// to take it back.
function isDelegatedTo(event: { ownerId: string | null; createdById: string | null }, userId: string) {
  return event.ownerId === userId && Boolean(event.createdById) && event.createdById !== userId;
}

// "Hand back": a delegated entry goes back onto the calendar of whoever put
// it on yours (Taylor, Nov 12, 2026), after a Save / Cancel.
export async function handBackEvent(eventId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();
  const parsed = idSchema.safeParse(eventId);
  if (!parsed.success) return { error: "That day is no longer on the calendar" };
  const event = await prisma.calendarEvent.findFirst({
    where: { id: parsed.data, organizationId },
    select: { id: true, title: true, projectId: true, ownerId: true, createdById: true, createdBy: { select: { name: true, removedAt: true } } },
  });
  if (!event) return { error: "That day is no longer on the calendar" };
  if (!isDelegatedTo(event, userId) || !event.createdBy) return { error: "Only an entry a teammate put on your calendar can be handed back" };
  if (event.createdBy.removedAt) return { error: `${event.createdBy.name} is no longer on this account, so it can't go back to them` };
  const moved = await prisma.calendarEvent.updateMany({
    where: { id: event.id, organizationId, ownerId: userId },
    data: { ownerId: event.createdById },
  });
  if (!moved.count) return { error: "It has already moved" };
  revalidateCalendar(event.projectId);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/planner");
  return { success: `Handed back to ${event.createdBy.name}` };
}
