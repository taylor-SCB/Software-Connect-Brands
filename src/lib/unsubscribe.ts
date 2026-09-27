import { prisma } from "@/lib/prisma";

// The email a footer link came from, with who it went to and from whom.
export async function findUnsubscribe(token: string) {
  if (!token || token.length > 100) return null;
  return prisma.emailSend.findUnique({
    where: { unsubscribeToken: token },
    select: {
      toEmail: true,
      contactId: true,
      organizationId: true,
      organization: { select: { name: true } },
      contact: { select: { emailOptOutAt: true } },
    },
  });
}

/**
 * Mark the person as not wanting email. Every contact in the workspace
 * with that address is marked, not just the one emailed: an import that
 * made a duplicate must not be a way back into their inbox. Idempotent —
 * the first time is the one recorded. False for a link that leads nowhere.
 */
export async function unsubscribe(token: string) {
  const found = await findUnsubscribe(token);
  if (!found) return false;
  await prisma.contact.updateMany({
    where: {
      organizationId: found.organizationId,
      emailOptOutAt: null,
      OR: [
        ...(found.contactId ? [{ id: found.contactId }] : []),
        { email: { equals: found.toEmail, mode: "insensitive" as const } },
      ],
    },
    data: { emailOptOutAt: new Date() },
  });
  return true;
}
