import { prisma } from "@/lib/prisma";
import { mergeTags } from "@/lib/industries";

// Merge Contacts / Merge Companies (Sept 30, 2026). One record is kept;
// every other one hands over everything that points at it — deals,
// quotes, contracts, notes, activity, files, jobs, calendar days — and is
// then deleted. The kept record's own details win; a blank on it is
// filled from the others. Nothing is summed or recomputed: every total in
// the app is derived from the rows themselves, which have simply moved.
//
// All in one transaction, so a merge either happens completely or not at
// all. Each step is one set-based statement, never a loop over rows, so it
// stays well inside the transaction's time limit on the live database.

export const MAX_MERGE = 5;

type Result = { error: string } | { keptId: string; merged: number };

const CONTACT_FIELDS = ["title", "email", "phone", "email2", "phone2", "website", "city", "state", "birthday", "imageUrl"] as const;

export async function mergeContacts(organizationId: string, keepId: string, otherIds: string[]): Promise<Result> {
  const others = Array.from(new Set(otherIds.filter((id) => id !== keepId))).slice(0, MAX_MERGE - 1);
  if (others.length === 0) return { error: "Pick at least two contacts to merge" };

  const rows = await prisma.contact.findMany({
    where: { organizationId, id: { in: [keepId, ...others] } },
    include: { accounts: { select: { companyId: true } } },
  });
  const keep = rows.find((row) => row.id === keepId);
  const gone = rows.filter((row) => row.id !== keepId);
  if (!keep || gone.length !== others.length) return { error: "One of those contacts no longer exists" };
  const goneIds = gone.map((row) => row.id);

  // Blanks on the keeper, filled from the others in the order picked. A
  // second address or number that differs lands in the empty second slot
  // rather than being lost.
  const fill: Record<string, unknown> = {};
  for (const field of CONTACT_FIELDS) {
    if (keep[field] != null && keep[field] !== "") continue;
    const donor = gone.find((row) => row[field] != null && row[field] !== "");
    if (donor) fill[field] = donor[field];
  }
  const email = (fill.email as string | undefined) ?? keep.email;
  const phone = (fill.phone as string | undefined) ?? keep.phone;
  if (!keep.email2 && !fill.email2) {
    const spare = gone.map((row) => row.email).find((value) => value && value !== email);
    if (spare) fill.email2 = spare;
  }
  if (!keep.phone2 && !fill.phone2) {
    const spare = gone.map((row) => row.phone).find((value) => value && value !== phone);
    if (spare) fill.phone2 = spare;
  }
  // Once anyone unsubscribed, the merged person stays unsubscribed: the
  // law says so, and the earliest date is the one that counts.
  const optOuts = [keep, ...gone].map((row) => row.emailOptOutAt).filter((at): at is Date => Boolean(at));
  const emailOptOutAt = optOuts.length ? new Date(Math.min(...optOuts.map((at) => at.getTime()))) : null;

  // Companies: the keeper's main company stays; the others' main
  // companies and links become additional accounts.
  const primary = keep.companyId ?? gone.find((row) => row.companyId)?.companyId ?? null;
  const linked = new Set<string>();
  for (const row of [keep, ...gone]) {
    if (row.companyId && row.companyId !== primary) linked.add(row.companyId);
    for (const account of row.accounts) if (account.companyId !== primary) linked.add(account.companyId);
  }

  const moved = { contactId: keepId };
  const from = { organizationId, contactId: { in: goneIds } };
  await prisma.$transaction([
    prisma.deal.updateMany({ where: from, data: moved }),
    prisma.note.updateMany({ where: from, data: moved }),
    prisma.activity.updateMany({ where: from, data: moved }),
    prisma.quote.updateMany({ where: from, data: moved }),
    prisma.contract.updateMany({ where: from, data: moved }),
    prisma.upload.updateMany({ where: from, data: moved }),
    prisma.project.updateMany({ where: from, data: moved }),
    prisma.crew.updateMany({ where: from, data: moved }),
    prisma.calendarEvent.updateMany({ where: from, data: moved }),
    prisma.property.updateMany({ where: from, data: moved }),
    prisma.emailSend.updateMany({ where: { contactId: { in: goneIds } }, data: moved }),
    // Expected at an event: add the keeper where they are not already,
    // the others' rows go with them when they are deleted.
    prisma.$executeRaw`
      INSERT INTO "_EventAttendees" ("A", "B")
      SELECT DISTINCT ea."A", ${keepId} FROM "_EventAttendees" ea
       WHERE ea."B" = ANY(${goneIds})
      ON CONFLICT DO NOTHING`,
    prisma.contactAccount.createMany({
      data: Array.from(linked).map((companyId) => ({ organizationId, contactId: keepId, companyId })),
      skipDuplicates: true,
    }),
    prisma.contact.deleteMany({ where: { organizationId, id: { in: goneIds } } }),
    prisma.contact.update({
      where: { id: keepId },
      data: {
        ...fill,
        companyId: primary,
        favorite: keep.favorite || gone.some((row) => row.favorite),
        emailOptOutAt,
      },
    }),
    // A link to what is now their main company would list them twice.
    ...(primary ? [prisma.contactAccount.deleteMany({ where: { contactId: keepId, companyId: primary } })] : []),
  ]);
  return { keptId: keepId, merged: goneIds.length };
}

const COMPANY_FIELDS = ["phone", "email", "website", "city", "state", "logoUrl"] as const;

export async function mergeCompanies(organizationId: string, keepId: string, otherIds: string[]): Promise<Result> {
  const others = Array.from(new Set(otherIds.filter((id) => id !== keepId))).slice(0, MAX_MERGE - 1);
  if (others.length === 0) return { error: "Pick at least two companies to merge" };

  const rows = await prisma.company.findMany({
    where: { organizationId, id: { in: [keepId, ...others] } },
    include: { distributor: { select: { id: true } } },
  });
  const keep = rows.find((row) => row.id === keepId);
  const gone = rows.filter((row) => row.id !== keepId);
  if (!keep || gone.length !== others.length) return { error: "One of those companies no longer exists" };
  const goneIds = gone.map((row) => row.id);

  const fill: Record<string, unknown> = {};
  for (const field of COMPANY_FIELDS) {
    if (keep[field]) continue;
    const donor = gone.find((row) => row[field]);
    if (donor) fill[field] = donor[field];
  }
  const industries = gone.reduce((all, row) => mergeTags(all, row.industries), keep.industries);
  const companyTypes = gone.reduce((all, row) => mergeTags(all, row.companyTypes), keep.companyTypes);

  // A distributor is one per company. The keeper's stays; if it has none,
  // the first of the others' moves over. Any further one is left on no
  // company, never deleted: it carries price lists.
  const donorDistributor = keep.distributor ? null : gone.find((row) => row.distributor)?.distributor ?? null;

  const moved = { companyId: keepId };
  const from = { organizationId, companyId: { in: goneIds } };
  await prisma.$transaction([
    prisma.contact.updateMany({ where: from, data: moved }),
    prisma.note.updateMany({ where: from, data: moved }),
    prisma.activity.updateMany({ where: from, data: moved }),
    prisma.upload.updateMany({ where: from, data: moved }),
    prisma.contract.updateMany({ where: from, data: moved }),
    prisma.project.updateMany({ where: from, data: moved }),
    prisma.crew.updateMany({ where: from, data: moved }),
    prisma.calendarEvent.updateMany({ where: from, data: moved }),
    prisma.property.updateMany({ where: from, data: moved }),
    prisma.quoteLineItem.updateMany({ where: { supplierCompanyId: { in: goneIds } }, data: { supplierCompanyId: keepId } }),
    // Additional-account links: re-point them at the keeper, skipping any
    // person already linked there or whose main company it now is.
    prisma.$executeRaw`
      INSERT INTO "ContactAccount" ("id", "organizationId", "contactId", "companyId")
      SELECT 'ca_' || md5(ca."contactId" || ${keepId}), ca."organizationId", ca."contactId", ${keepId}
        FROM "ContactAccount" ca
        JOIN "Contact" c ON c.id = ca."contactId"
       WHERE ca."companyId" = ANY(${goneIds})
         AND c."companyId" IS DISTINCT FROM ${keepId}
      ON CONFLICT ("contactId", "companyId") DO NOTHING`,
    prisma.contactAccount.deleteMany({ where: { companyId: keepId, contact: { companyId: keepId } } }),
    ...(donorDistributor
      ? [prisma.distributor.update({ where: { id: donorDistributor.id }, data: { companyId: keepId } })]
      : []),
    prisma.company.deleteMany({ where: { organizationId, id: { in: goneIds } } }),
    prisma.company.update({
      where: { id: keepId },
      data: { ...fill, industries, companyTypes, favorite: keep.favorite || gone.some((row) => row.favorite) },
    }),
  ]);
  return { keptId: keepId, merged: goneIds.length };
}
