"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireSession } from "@/lib/session";
import { ACTIVITY_LABELS, STATUS_REASONS } from "@/lib/constants";
import { nextStepSchema, markSchema, reasonSchema } from "@/lib/outcomes";
import { healthSettings, contactHealth, companyHealth } from "@/lib/health-load";
import { todayIso, isoToDate } from "@/lib/payments";
import { cleanTime, formatTime, isRealDay } from "@/lib/calendar";
import { formatDay } from "@/lib/format";
import { dayInZone, planNextStep, writeNextStep } from "@/lib/calendar-auto";
import { bookMeetingCore, waitingMeetings } from "@/lib/meetings";
import { markByHand } from "@/lib/status";
import { stampLostReason } from "@/lib/opportunities";
import { mayJoinSave } from "@/lib/undo-log";
import { convertOpportunity, moveOpportunity } from "@/app/dashboard/deals/opportunity-actions";
import { bookingOptions } from "@/app/dashboard/contacts/actions";
import type { AfterLogInput, AfterLogResult, LogContext } from "./types";

// The server side of the "How did it go?" and Book meeting sheets (BDR
// redesign, Nov 11, 2026). The touch itself is saved by the actions every
// screen already uses (logActivity, completeEventWithLog, markMeetingHeld,
// markMeetingNoShow, rescheduleMeeting, bookMeeting); these add what the
// sheet needs around them: what to show when it opens, and the step after
// a one-tap save — the note typed afterwards, Interested / Not interested
// with its reason, and the next step — written into the same save
// (batchId), so one Undo takes it all back. Every id is checked against
// the workspace; nothing is trusted from the browser.

const idSchema = z.string().trim().min(1).max(100);
const batchSchema = z.string().trim().min(1).max(200);

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

// What the sheet reads when it opens. One record, a handful of statements.
// `opportunityId` (the Pipeline panel's tile): a Meeting outcome answers
// that tile's meeting, not whichever of the person's tiles comes first.
export async function logContext(input: {
  contactId?: string | null;
  companyId?: string | null;
  eventId?: string | null;
  opportunityId?: string | null;
}): Promise<LogContext | { error: string }> {
  const { organizationId } = await requireSession();
  const parsed = z
    .object({ contactId: idSchema.nullish(), companyId: idSchema.nullish(), eventId: idSchema.nullish(), opportunityId: idSchema.nullish() })
    .safeParse(input);
  if (!parsed.success) return { error: "Missing record reference" };
  const settings = await healthSettings(organizationId);
  const today = todayIso(settings.timeZone);

  let contactId = parsed.data.contactId ?? null;
  let companyId = parsed.data.companyId ?? null;
  let eventMeeting: { id: string; eventId: string | null; on: Date } | null = null;
  let event: { id: string; startOn: Date; startTime: string | null } | null = null;
  if (parsed.data.eventId) {
    const row = await prisma.calendarEvent.findFirst({
      where: { id: parsed.data.eventId, organizationId },
      select: { id: true, contactId: true, companyId: true, startOn: true, startTime: true },
    });
    if (!row) return { error: "That day is no longer on the calendar" };
    contactId = row.contactId;
    companyId = row.contactId ? null : row.companyId;
    event = row;
    eventMeeting = await prisma.opportunityMeeting.findFirst({
      where: { eventId: row.id, opportunity: { organizationId } },
      select: { id: true, eventId: true, on: true },
    });
  }

  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      select: { id: true, name: true, companyId: true, company: { select: { name: true } } },
    });
    if (!contact) return { error: "Contact not found" };
    const health = await contactHealth(organizationId, contact.id, { settings });
    let meeting: LogContext["meeting"] = null;
    if (event) {
      const day = event.startOn.toISOString().slice(0, 10);
      meeting = eventMeeting ? { id: eventMeeting.id, eventId: event.id, on: day, time: event.startTime, ahead: day > today } : null;
    } else {
      meeting = await meetingToAnswer(organizationId, contact.id, parsed.data.opportunityId ?? null, settings.timeZone);
    }
    return {
      today,
      contactId: contact.id,
      companyId: contact.companyId,
      name: contact.name,
      firstName: firstName(contact.name),
      companyName: contact.company?.name ?? null,
      park: Boolean(health?.park),
      tries: health?.counts.tries ?? 0,
      parkAfterTries: settings.parkAfterTries,
      meeting,
    };
  }
  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, organizationId }, select: { id: true, name: true } });
    if (!company) return { error: "Company not found" };
    const health = await companyHealth(organizationId, company.id, { settings });
    return {
      today,
      contactId: null,
      companyId: company.id,
      name: company.name,
      firstName: company.name,
      companyName: company.name,
      park: Boolean(health?.park),
      tries: health?.counts.tries ?? 0,
      parkAfterTries: settings.parkAfterTries,
      meeting: null,
    };
  }
  return { error: "Missing record reference" };
}

// The meeting a Meeting outcome answers, by the one rule every screen
// shares (waitingMeetings → toAnswer, src/lib/meeting-rule.ts): the latest
// one booked with them that has come and nobody marked; else the soonest
// one still ahead (Held asks "Did it happen early?", Rescheduled moves
// it); else the latest no-show with nothing booked since, which Held
// says did happen after all (as the Pipeline tile's "It did happen") —
// never a second meeting written beside it. Only tiles they are on as
// Primary or Associated; only the named tile when there is one.
async function meetingToAnswer(organizationId: string, contactId: string, opportunityId: string | null, timeZone: string): Promise<LogContext["meeting"]> {
  let key = contactId;
  let by: { contactIds: string[] } | { opportunityIds: string[] } = { contactIds: [contactId] };
  if (opportunityId) {
    const tile = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId, contacts: { some: { contactId } } }, select: { id: true } });
    if (tile) {
      key = tile.id;
      by = { opportunityIds: [tile.id] };
    }
  }
  const waiting = (await waitingMeetings(organizationId, by, { timeZone })).get(key);
  const pick = waiting?.toAnswer ?? null;
  if (!pick) return null;
  return {
    id: pick.id,
    eventId: pick.eventId,
    on: pick.day,
    time: pick.time,
    ahead: pick === waiting?.ahead,
    noShow: pick.outcome === "NO_SHOW",
  };
}

// A save this person may add to: one of theirs (or any, for an Owner or
// Admin) in this workspace. "m:<meetingId>:…" is a Pipeline meeting save.
async function saveOf(organizationId: string, userId: string, canManage: boolean, batchId: string) {
  const rows = await prisma.activity.findMany({
    where: { organizationId, batchId },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, contactId: true, companyId: true, type: true, body: true, occurredAt: true },
  });
  const meetingId = batchId.startsWith("m:") ? batchId.split(":")[1] || null : null;
  const meeting = meetingId
    ? await prisma.opportunityMeeting.findFirst({
        where: { id: meetingId, opportunity: { organizationId } },
        select: { id: true, opportunityId: true, opportunity: { select: { contacts: { where: { role: { not: "HIDDEN" } }, orderBy: { createdAt: "asc" }, select: { contactId: true } } } } },
      })
    : null;
  if (!rows.length && !meeting) return null;
  if (rows.length && !canManage && rows[0].userId !== userId) return null;

  let contactIds = [...new Set(rows.map((row) => row.contactId).filter((id): id is string => Boolean(id)))];
  let companyId = rows.find((row) => row.companyId)?.companyId ?? null;
  if (!rows.length && meeting) contactIds = meeting.opportunity.contacts.map((row) => row.contactId);
  if (contactIds.length && !companyId) {
    const first = await prisma.contact.findFirst({ where: { id: contactIds[0], organizationId }, select: { companyId: true } });
    companyId = first?.companyId ?? null;
  }
  const names = contactIds.length
    ? await prisma.contact.findFirst({ where: { id: contactIds[0], organizationId }, select: { name: true } })
    : companyId
      ? await prisma.company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } })
      : null;
  return {
    rows,
    contactIds,
    // The company the touch was on when nobody was (Front desk).
    companyOnly: contactIds.length ? null : companyId,
    companyId,
    primaryName: names?.name ?? "",
    opportunityId: meeting?.opportunityId ?? null,
  };
}

const afterSchema = z.object({
  batchId: batchSchema,
  note: z.string().trim().max(5000).nullish(),
  mark: markSchema.nullish(),
  reason: reasonSchema.nullish(),
  next: nextStepSchema.nullish(),
});

// The step after a one-tap save, written into that save: the note typed
// since (the chip's words otherwise stay), Interested / Not interested
// with its reason (a reason alone lands on the Not interested the save
// already made), and the next step (a follow-up, "Try to book a meeting",
// "Try again in 30 days", or the meeting booked now).
export async function afterLog(input: AfterLogInput): Promise<AfterLogResult> {
  const session = await requireAdminSession();
  const { organizationId, userId } = session;
  const parsed = afterSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the next step and try again" };
  const { batchId, note, mark, reason, next } = parsed.data;
  const save = await saveOf(organizationId, userId, session.allowed, batchId);
  if (!save) return { error: "That save is gone. Log it again." };

  const settings = await healthSettings(organizationId);
  const today = todayIso(settings.timeZone);
  const plan = next ? planNextStep(next, today) : null;
  if (plan && "error" in plan) return { error: plan.error };

  // Front desk / main line (nobody linked) is a try, never a talk: no
  // Interested or Not interested on it, whatever a forged call sends
  // (final audit, Nov 11, 2026; logActivity refuses the same).
  if (mark && save.companyOnly) return { error: "A front-desk log is a try. Mark Interested or Not interested on the person you spoke with." };

  const words: string[] = [];
  const who = { organizationId, userId, batchId };

  // The note, on every line of the save and the calendar copy beside it.
  if (note && save.rows.length && note !== save.rows[0].body) {
    const ids = save.rows.map((row) => row.id);
    await prisma.$transaction([
      prisma.activity.updateMany({ where: { organizationId, id: { in: ids } }, data: { body: note } }),
      // The calendar copy the log wrote (auto); a booked entry ticked done with
      // this line keeps its own notes.
      prisma.calendarEvent.updateMany({ where: { organizationId, activityId: { in: ids }, auto: true }, data: { notes: note } }),
    ]);
  }

  if (mark) {
    await markByHand(who, { contactIds: save.contactIds, companyId: save.companyOnly }, mark, new Date(), mark === "NOT_INTERESTED" ? (reason ?? null) : null);
    words.push(mark === "INTERESTED" ? "Interested" : "Not interested");
  } else if (reason) {
    const stamped = await prisma.statusChange.updateMany({
      where: { organizationId, batchId, toStatus: "NOT_INTERESTED", auto: false },
      data: { reason },
    });
    if (stamped.count) words.push("Reason saved");
  }

  let opportunityId: string | null = save.opportunityId;
  if (plan && plan.kind === "meeting") {
    const contactIds = [...new Set([...save.contactIds, ...plan.withContactIds])];
    const booked = await bookMeetingCore(who, {
      contactIds,
      companyId: save.companyId,
      on: plan.on,
      time: plan.time,
      where: plan.where,
      note: plan.note,
      opportunity: plan.opportunity,
    });
    if ("error" in booked) return { error: booked.error ?? "The meeting couldn't be booked" };
    words.push(booked.message);
    opportunityId = booked.opportunityId ?? opportunityId;
  } else if (plan) {
    const first = save.rows[0];
    const about = first
      ? `Follow up on the ${ACTIVITY_LABELS[first.type].toLowerCase()} logged ${formatDay(`${dayInZone(first.occurredAt, settings.timeZone)}T12:00:00Z`)}: ${(note || first.body).slice(0, 140)}`
      : `Follow up with ${save.primaryName}`;
    const step = await writeNextStep({
      organizationId,
      userId,
      batchId,
      plan,
      contactIds: save.contactIds,
      companyId: save.companyId,
      primaryName: save.primaryName,
      about,
    });
    words.push(step.words);
  }

  for (const id of save.contactIds) revalidatePath(`/dashboard/contacts/${id}`);
  if (save.companyId) revalidatePath(`/dashboard/companies/${save.companyId}`);
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard");
  if (opportunityId || mark) revalidatePath("/dashboard/deals");
  return { success: words.join(" · ") || "Saved", words, opportunityId };
}

// "Not moving forward" after a held meeting: the opportunity goes to Lost
// (converted with no paperwork when it is not a deal yet, as the
// Pipeline's "Yes – Move to Lost" does) with the optional reason. The move
// is written into the Held's save (final audit, Nov 11, 2026), so the one
// Undo takes both back: the deal it made goes (or the deal it moved goes
// back to its stage), the tile and its people return to where the Held
// found them. `batchId` comes back when that is so; without it (a save
// that isn't this person's, or is gone) the move stands on its own and the
// sheet offers no Undo.
export async function notMovingForward(input: {
  opportunityId?: string | null;
  batchId?: string | null;
  reason?: string | null;
}): Promise<{ success?: string; error?: string; opportunityId?: string; batchId?: string }> {
  const session = await requireAdminSession();
  const { organizationId } = session;
  const parsed = z
    .object({ opportunityId: idSchema.nullish(), batchId: batchSchema.nullish(), reason: z.enum(STATUS_REASONS).nullish() })
    .safeParse(input);
  if (!parsed.success) return { error: "Pick one of the reasons" };
  const joined =
    parsed.data.batchId && (await mayJoinSave(organizationId, parsed.data.batchId, { userId: session.userId, canManage: session.allowed }))
      ? parsed.data.batchId
      : undefined;
  let opportunityId = parsed.data.opportunityId ?? null;
  if (!opportunityId && parsed.data.batchId) {
    const batchId = parsed.data.batchId;
    const meetingId = batchId.startsWith("m:") ? batchId.split(":")[1] || null : null;
    const lines = await prisma.activity.findMany({ where: { organizationId, batchId }, select: { id: true } });
    const meeting = await prisma.opportunityMeeting.findFirst({
      where: {
        opportunity: { organizationId },
        OR: [...(meetingId ? [{ id: meetingId }] : []), ...(lines.length ? [{ activityId: { in: lines.map((row) => row.id) } }] : [])],
      },
      orderBy: { createdAt: "desc" },
      select: { opportunityId: true },
    });
    opportunityId = meeting?.opportunityId ?? null;
  }
  if (!opportunityId) return { error: "There's no opportunity on the Pipeline for this meeting" };
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId },
    select: { id: true, title: true, stage: true, deal: { select: { stage: true, title: true, valueCents: true } } },
  });
  if (!opportunity) return { error: "That opportunity is no longer on the board" };
  let moved = false;
  if (opportunity.deal?.stage !== "LOST") {
    const move = await moveOpportunity(opportunity.id, "LOST", { batchId: joined });
    if (move.error) return { error: move.error };
    if (move.convert) {
      // A Build Quote deal keeps its own name and amount: only its stage moves.
      const converted = await convertOpportunity({
        id: opportunity.id,
        stage: "LOST",
        mode: "manual",
        title: opportunity.deal?.title || opportunity.title,
        valueCents: opportunity.deal?.valueCents ?? 0,
        batchId: joined,
      });
      if (converted.error) return { error: converted.error };
    }
    moved = true;
  }
  if (parsed.data.reason) {
    const stamped = await stampLostReason(organizationId, opportunity.id, parsed.data.reason);
    if (stamped.error) return { error: stamped.error };
  }
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard");
  return { success: `${opportunity.title} moved to Lost`, opportunityId: opportunity.id, ...(joined && moved ? { batchId: joined } : {}) };
}

// Rescheduled, for a calendar meeting with no Pipeline meeting behind it:
// the entry moves to the new day and time. (One on the Pipeline goes
// through rescheduleMeeting, which keeps the tile.)
export async function rescheduleEntry(eventId: string, input: { on: string; time?: string | null }): Promise<{ success?: string; error?: string }> {
  const { organizationId } = await requireSession();
  const parsed = z
    .object({ eventId: idSchema, on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the new day"), time: z.string().max(8).nullish() })
    .safeParse({ eventId, ...input });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick the new day" };
  if (!isRealDay(parsed.data.on)) return { error: "That day isn't a real date" };
  const timeZone = (await healthSettings(organizationId)).timeZone;
  if (parsed.data.on < todayIso(timeZone)) return { error: "Pick today or a day ahead" };
  const moved = await prisma.calendarEvent.updateMany({
    where: { id: parsed.data.eventId, organizationId, doneAt: null },
    data: { startOn: isoToDate(parsed.data.on)!, endOn: null, startTime: cleanTime(parsed.data.time) },
  });
  if (!moved.count) return { error: "That entry is done or gone" };
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard");
  const time = cleanTime(parsed.data.time);
  return { success: `Moved to ${formatDay(`${parsed.data.on}T12:00:00Z`)}${time ? `, ${formatTime(time)}` : ""}` };
}

// What the Book meeting sheet offers (bookingOptions: who else at the
// company, the company's open opportunities) plus the workspace's today
// and the person's name, in one call. `opportunityId`: the tile the sheet
// was opened from, always among the choices.
export async function bookingChoices(contactId: string, opportunityId?: string | null): Promise<
  | {
      today: string;
      name: string;
      people: { id: string; name: string; title: string | null }[];
      opportunities: { id: string; title: string; primaryName: string | null; ownerName: string | null; includesThem: boolean }[];
    }
  | { error: string }
> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "Missing contact reference" };
  const [options, contact, settings] = await Promise.all([
    bookingOptions(id.data, opportunityId ?? null),
    prisma.contact.findFirst({ where: { id: id.data, organizationId }, select: { name: true } }),
    healthSettings(organizationId),
  ]);
  if ("error" in options) return options;
  if (!contact) return { error: "Contact not found" };
  return { ...options, today: todayIso(settings.timeZone), name: contact.name };
}
