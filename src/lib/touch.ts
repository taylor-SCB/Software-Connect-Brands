import { prisma } from "@/lib/prisma";
import { recordActivityEvent } from "@/lib/calendar-auto";
import { markContacted, markMeetingSet } from "@/lib/status";
import type { ActivityTypeValue } from "@/lib/constants";

// One touch with one person, logged now: the line in their history, its
// copy on the calendar under whoever logged it, and the status ladder
// moved on — exactly what "Log activity" on their page does for a touch
// that happened today. Used by the Call List's tick and by Meeting notes.
export async function logTouchNow(input: {
  organizationId: string;
  userId: string;
  contactId: string;
  type: ActivityTypeValue;
  body: string;
}) {
  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, organizationId: input.organizationId },
    select: { id: true, name: true, companyId: true },
  });
  if (!contact) return null;
  const occurredAt = new Date();
  const activity = await prisma.activity.create({
    data: {
      organizationId: input.organizationId,
      contactId: contact.id,
      userId: input.userId,
      type: input.type,
      body: input.body,
      occurredAt,
    },
    select: { id: true },
  });
  await recordActivityEvent({
    organizationId: input.organizationId,
    userId: input.userId,
    activityId: activity.id,
    type: input.type,
    body: input.body,
    occurredAt,
    withTime: true,
    contactIds: [contact.id],
    companyId: contact.companyId,
    primaryName: contact.name,
  });
  const who = { organizationId: input.organizationId, userId: input.userId };
  await markContacted(who, { contactIds: [contact.id] }, occurredAt);
  if (input.type === "MEETING") await markMeetingSet(who, [contact.id], occurredAt);
  return { activityId: activity.id, contact };
}
