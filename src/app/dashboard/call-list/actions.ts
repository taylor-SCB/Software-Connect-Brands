"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getOrganization } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { ACTIVITY_TYPES } from "@/lib/constants";
import { buildCallList, draftOpeners, scopeRows, MAX_OPENERS_PER_DRAFT } from "@/lib/call-list";
import { logEventDone } from "@/lib/calendar-auto";
import { logTouchNow } from "@/lib/touch";
import { advanceContact } from "@/lib/status";

// Whose list a request may read: your own, or anyone's for an owner or admin.
async function scopeFor(requested: string | undefined) {
  const session = await requireSession();
  const manager = session.role === "OWNER" || session.role === "ADMIN";
  if (!requested || requested === session.userId || !manager) return { session, scope: { userId: session.userId } as const };
  if (requested === "everyone") return { session, scope: "everyone" as const };
  const user = await prisma.user.findFirst({ where: { id: requested, organizationId: session.organizationId }, select: { id: true } });
  return { session, scope: { userId: user?.id ?? session.userId } as const };
}

// "Draft openers": one AI request for the top of the list that doesn't
// have an opener today yet. The rows are rebuilt here rather than taken
// from the browser, so only real reasons are ever written about.
export async function openersAction(whose?: string): Promise<{ error?: string; openers?: Record<string, string> }> {
  const { session, scope } = await scopeFor(whose);
  const organization = await getOrganization();
  const timeZone = organization.timeZone;
  const today = todayIso(timeZone);
  const { mine, nobodys } = scopeRows(await buildCallList(session.organizationId, today), scope);
  const rows = [...mine.slice(0, MAX_OPENERS_PER_DRAFT), ...nobodys.slice(0, 5)];
  const result = await draftOpeners({
    organizationId: session.organizationId,
    userId: session.userId,
    userName: session.name,
    businessName: organization.name,
    timeZone,
    today,
    rows,
  });
  return { error: result.ok ? undefined : result.error, openers: Object.fromEntries(result.openers) };
}

const logSchema = z.object({
  contactId: z.string().trim().optional(),
  // The follow-ups folded into the row. The first carries the log; the
  // rest are ticked, since this one call answered them all.
  followUpIds: z.array(z.string().trim().min(1)).max(20).default([]),
  type: z.enum(ACTIVITY_TYPES),
  note: z.string().trim().max(5000),
});

// The tick on a row: the touch goes in their history and on the calendar,
// which is what takes the row off the list. A follow-up row ticks its own
// calendar entry, so it isn't left overdue.
export async function logCallAction(input: z.input<typeof logSchema>): Promise<{ error?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick what kind of touch it was" };
  const { contactId, followUpIds, type } = parsed.data;
  const note = parsed.data.note || "Called from the Call List";
  const [eventId, ...others] = followUpIds;

  if (eventId) {
    const result = await logEventDone({ organizationId, userId, eventId, activityType: type, note });
    if ("error" in result) return { error: result.error };
    if (others.length) {
      await prisma.calendarEvent.updateMany({ where: { organizationId, id: { in: others }, doneAt: null }, data: { doneAt: new Date() } });
    }
  } else if (contactId) {
    const logged = await logTouchNow({ organizationId, userId, contactId, type, body: note });
    if (!logged) return { error: "That contact no longer exists" };
  } else {
    return { error: "Nobody to log it on" };
  }
  revalidatePath("/dashboard/call-list");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/calendar");
  if (contactId) revalidatePath(`/dashboard/contacts/${contactId}`);
  return {};
}

// "Mark held" on a meeting row: Meeting Completed, and the meeting goes in
// their history if it isn't there yet.
export async function markHeldAction(eventId: string): Promise<{ error?: string }> {
  const { organizationId, userId } = await requireSession();
  const event = await prisma.calendarEvent.findFirst({
    where: { id: String(eventId), organizationId },
    select: { id: true, contactId: true, doneAt: true, activityId: true },
  });
  if (!event?.contactId) return { error: "That meeting is no longer on the calendar" };
  if (!event.activityId) {
    const result = await logEventDone({ organizationId, userId, eventId: event.id, activityType: "MEETING", note: "Meeting held" });
    if ("error" in result) return { error: result.error };
  }
  await advanceContact({ organizationId, userId }, event.contactId, "MEETING_COMPLETED", { auto: false });
  revalidatePath("/dashboard/call-list");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${event.contactId}`);
  return {};
}
