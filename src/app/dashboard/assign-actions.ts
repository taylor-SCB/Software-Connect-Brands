"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseListParams } from "@/lib/list-params";
import { companyIdsMatching, companyWhere, contactWhere } from "@/lib/list-query";
import { MAX_ASSIGN, checkedRep } from "@/lib/reps";

// Bulk Assign on the Contacts and Companies lists (Nov 10, 2026, Taylor):
// Assign to me / Assign to… / Unassign, for the ticked rows or for "all N
// matching these filters", at most 1,000 records a go. The filter is read
// again here from the same address-bar text the list was drawn from, so
// what is assigned is exactly what the list shows. The write is one
// statement and leaves updatedAt alone: assigning reps doesn't shuffle the
// list the person is working down.

const schema = z.object({
  kind: z.enum(["contacts", "companies"]),
  // "me", "" for Unassigned, or a teammate's id.
  to: z.string().max(60),
  ids: z.array(z.string().trim().min(1).max(60)).max(MAX_ASSIGN).optional(),
  // "All matching": the list's query string, and whether the page held the
  // Interested lock (the one lock the address bar doesn't carry).
  query: z.string().max(8000).optional(),
  interested: z.boolean().optional(),
});

// `left`: records matching the filter that still don't have this rep after
// this run, which the next run picks up.
export type AssignResult = { error: string } | { assigned: number; matching: number; left: number; repName: string | null };

export async function assignRecords(input: z.input<typeof schema>): Promise<AssignResult> {
  const { organizationId, userId } = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Tick some rows first." };
  const { kind, ids, query, interested } = parsed.data;

  const ownerId = parsed.data.to === "me" ? userId : await checkedRep(organizationId, parsed.data.to);
  if (ownerId === undefined) return { error: "That teammate is no longer on this account." };

  let targets: string[];
  let matching: number;
  let pending = 0;
  if (ids && ids.length > 0) {
    targets = ids;
    matching = ids.length;
  } else if (query !== undefined) {
    const raw: Record<string, string[]> = {};
    for (const [key, value] of new URLSearchParams(query)) (raw[key] ??= []).push(value);
    const params = { ...parseListParams(raw, { interested: Boolean(interested) }), page: 1 };
    const order = [{ updatedAt: "desc" as const }, { id: "asc" as const }];
    // Only records that don't have this rep yet (audit fix, Nov 10, 2026):
    // the write leaves updatedAt alone and a filter with no Rep in it
    // still matches an assigned record, so "run it again for the next
    // 1,000" kept picking the same 1,000.
    const notYet = ownerId === null ? { ownerId: { not: null } } : { OR: [{ ownerId: null }, { ownerId: { not: ownerId } }] };
    if (kind === "contacts") {
      const where = await contactWhere(organizationId, { ...params, auto: false }, await companyIdsMatching(organizationId, params.q));
      const todo = { AND: [where, notYet] };
      [matching, pending, targets] = await Promise.all([
        prisma.contact.count({ where }),
        prisma.contact.count({ where: todo }),
        prisma.contact.findMany({ where: todo, orderBy: order, take: MAX_ASSIGN, select: { id: true } }).then((rows) => rows.map((row) => row.id)),
      ]);
    } else {
      const where = await companyWhere(organizationId, params);
      const todo = { AND: [where, notYet] };
      [matching, pending, targets] = await Promise.all([
        prisma.company.count({ where }),
        prisma.company.count({ where: todo }),
        prisma.company.findMany({ where: todo, orderBy: order, take: MAX_ASSIGN, select: { id: true } }).then((rows) => rows.map((row) => row.id)),
      ]);
    }
  } else {
    return { error: "Tick some rows first." };
  }
  const left = Math.max(0, pending - targets.length);

  const assigned =
    targets.length === 0
      ? 0
      : kind === "contacts"
      ? await prisma.$executeRaw`UPDATE "Contact" SET "ownerId" = ${ownerId} WHERE "organizationId" = ${organizationId} AND id = ANY(${targets})`
      : await prisma.$executeRaw`UPDATE "Company" SET "ownerId" = ${ownerId} WHERE "organizationId" = ${organizationId} AND id = ANY(${targets})`;
  const rep = ownerId ? await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }) : null;

  revalidatePath(`/dashboard/${kind}`, "layout");
  return { assigned, matching, left, repName: rep?.name ?? null };
}

// The Rep picker on a contact's or company's page: saves as it is changed.
export async function setRecordRep(kind: "contact" | "company", id: string, to: string): Promise<{ error?: string }> {
  const { organizationId } = await requireSession();
  if (typeof id !== "string" || !id || id.length > 60) return { error: "Reload the page." };
  const ownerId = await checkedRep(organizationId, to);
  if (ownerId === undefined) return { error: "That teammate is no longer on this account." };
  const result =
    kind === "contact"
      ? await prisma.contact.updateMany({ where: { id, organizationId }, data: { ownerId } })
      : await prisma.company.updateMany({ where: { id, organizationId }, data: { ownerId } });
  if (result.count === 0) return { error: "That record is no longer here." };
  revalidatePath(`/dashboard/${kind === "contact" ? "contacts" : "companies"}`, "layout");
  return {};
}
