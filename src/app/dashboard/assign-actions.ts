"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseListParams, effectiveSort } from "@/lib/list-params";
import { companyIdsMatching, companyWhere, contactWhere, orderFor } from "@/lib/list-query";
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
  // Said yes to "12 of these belong to Priya. Take them?" (BDR redesign,
  // decision 15). Without it, records a teammate owns are only counted.
  confirmed: z.boolean().optional(),
});

// `left`: records matching the filter that still don't have this rep after
// this run, which the next run picks up.
// `undo`: who each changed record belonged to before, for undoAssign.
// `confirm`: nothing was written; these many belong to teammates.
export type AssignUndo = { kind: "contacts" | "companies"; to: string | null; groups: { ownerId: string | null; ids: string[] }[] };
export type AssignResult =
  | { error: string }
  | { confirm: { count: number; total: number; owners: { name: string; count: number }[] } }
  | { assigned: number; matching: number; left: number; repName: string | null; undo: AssignUndo };

export async function assignRecords(input: z.input<typeof schema>): Promise<AssignResult> {
  const { organizationId, userId } = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Tick some rows first." };
  const { kind, ids, query, interested, confirmed } = parsed.data;

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
    const params = { ...parseListParams(raw, { interested: Boolean(interested) }), page: 1, me: userId };
    // The list's own order (late follow-ups aside), so "the first 1,000"
    // is the first 1,000 the person sees.
    const sort = effectiveSort(params);
    const order = orderFor(sort === "meeting" ? "added" : sort) as never;
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

  // Who has them now: records a teammate owns are taken only once the
  // person has said yes, naming the owner (decision 15). Your own records
  // and nobody's are never asked about.
  const before =
    targets.length === 0
      ? []
      : kind === "contacts"
        ? await prisma.contact.findMany({ where: { organizationId, id: { in: targets } }, select: { id: true, ownerId: true } })
        : await prisma.company.findMany({ where: { organizationId, id: { in: targets } }, select: { id: true, ownerId: true } });
  const changing = before.filter((row) => row.ownerId !== ownerId);
  const taken = changing.filter((row) => row.ownerId !== null && row.ownerId !== userId);
  if (taken.length > 0 && !confirmed) {
    const byOwner = new Map<string, number>();
    for (const row of taken) byOwner.set(row.ownerId!, (byOwner.get(row.ownerId!) ?? 0) + 1);
    const names = await prisma.user.findMany({ where: { organizationId, id: { in: [...byOwner.keys()] } }, select: { id: true, name: true } });
    const owners = [...byOwner.entries()]
      .map(([id, count]) => ({ name: names.find((user) => user.id === id)?.name ?? "A teammate", count }))
      .sort((a, b) => b.count - a.count);
    return { confirm: { count: taken.length, total: changing.length, owners } };
  }

  const changeIds = changing.map((row) => row.id);
  // How many now have this rep: the ones changed and the ones that already had it.
  const assigned = before.length;
  if (changeIds.length > 0)
    await (kind === "contacts"
      ? prisma.$executeRaw`UPDATE "Contact" SET "ownerId" = ${ownerId} WHERE "organizationId" = ${organizationId} AND id = ANY(${changeIds})`
      : prisma.$executeRaw`UPDATE "Company" SET "ownerId" = ${ownerId} WHERE "organizationId" = ${organizationId} AND id = ANY(${changeIds})`);
  const rep = ownerId ? await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }) : null;

  const groups = new Map<string, string[]>();
  for (const row of changing) {
    const key = row.ownerId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), row.id]);
  }
  revalidatePath(`/dashboard/${kind}`, "layout");
  return {
    assigned,
    matching,
    left,
    repName: rep?.name ?? null,
    undo: { kind, to: ownerId, groups: [...groups.entries()].map(([key, list]) => ({ ownerId: key || null, ids: list })) },
  };
}

const undoSchema = z.object({
  kind: z.enum(["contacts", "companies"]),
  to: z.string().max(60).nullable(),
  groups: z
    .array(z.object({ ownerId: z.string().max(60).nullable(), ids: z.array(z.string().min(1).max(60)).max(MAX_ASSIGN) }))
    .max(200),
});

// Undo a bulk Assign: each record goes back to whoever had it, but only
// while it still has the rep the Assign gave it, so a change made since by
// someone else is never rolled over.
export async function undoAssign(input: z.input<typeof undoSchema>): Promise<{ error: string } | { restored: number }> {
  const { organizationId } = await requireSession();
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) return { error: "That can't be undone any more." };
  const { kind, to, groups } = parsed.data;
  if (groups.reduce((sum, group) => sum + group.ids.length, 0) > MAX_ASSIGN) return { error: "That can't be undone any more." };
  const owners = groups.map((group) => group.ownerId).filter((id): id is string => Boolean(id));
  const known = owners.length
    ? new Set((await prisma.user.findMany({ where: { organizationId, id: { in: owners } }, select: { id: true } })).map((user) => user.id))
    : new Set<string>();
  let restored = 0;
  await prisma.$transaction(async (tx) => {
    for (const group of groups) {
      if (group.ownerId && !known.has(group.ownerId)) continue;
      restored +=
        kind === "contacts"
          ? await tx.$executeRaw`UPDATE "Contact" SET "ownerId" = ${group.ownerId} WHERE "organizationId" = ${organizationId} AND id = ANY(${group.ids}) AND "ownerId" IS NOT DISTINCT FROM ${to}`
          : await tx.$executeRaw`UPDATE "Company" SET "ownerId" = ${group.ownerId} WHERE "organizationId" = ${organizationId} AND id = ANY(${group.ids}) AND "ownerId" IS NOT DISTINCT FROM ${to}`;
    }
  });
  revalidatePath(`/dashboard/${kind}`, "layout");
  return { restored };
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
