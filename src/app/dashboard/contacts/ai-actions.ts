"use server";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { gatherBriefing, writeBriefing } from "@/lib/briefing";

// "Write a briefing" on a contact's page.
export async function writeBriefingAction(contactId: string): Promise<{ error?: string; paragraph?: string }> {
  const { organizationId, userId } = await requireSession();
  const contact = await prisma.contact.findFirst({ where: { id: String(contactId), organizationId }, select: { id: true, name: true } });
  if (!contact) return { error: "Contact not found" };
  const timeZone = await getTimeZone();
  const facts = await gatherBriefing(organizationId, contact.id, timeZone);
  if (!facts) return { error: "Contact not found" };
  const result = await writeBriefing({ organizationId, userId, timeZone, contactId: contact.id, contactName: contact.name, facts });
  if (!result.ok) return { error: result.error };
  return { paragraph: result.data.paragraph };
}
