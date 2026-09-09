import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ACTIVITY_TYPES, NOTE_LABELS } from "@/lib/constants";

// Notes and activity can be logged on a contact or on a company, and a
// contact entry can be copied to several other contacts at once. This is
// the one place that works out who the entry is for.

export const targetSchema = z
  .object({
    contactId: z.string().trim().optional(),
    companyId: z.string().trim().optional(),
    extraContactIds: z.array(z.string().trim().min(1)).max(500).default([]),
  })
  .refine((value) => Boolean(value.contactId) !== Boolean(value.companyId), {
    message: "Missing record reference",
  });

export type LogTarget = z.infer<typeof targetSchema>;

export function readTarget(formData: FormData): unknown {
  return {
    contactId: formData.get("contactId") || undefined,
    companyId: formData.get("companyId") || undefined,
    extraContactIds: formData.getAll("extraContactIds").filter((v) => typeof v === "string"),
  };
}

// Every id must belong to this workspace; anything else is dropped rather
// than trusted. Returns the rows to write, each with a shared batchId
// when the entry fans out to more than one person.
export async function resolveTargets(target: LogTarget, organizationId: string) {
  if (target.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: target.companyId, organizationId },
      select: { id: true },
    });
    if (!company) return null;
    return { rows: [{ companyId: company.id, contactId: null }], batchId: null, primary: { companyId: company.id } };
  }

  const wanted = Array.from(new Set([target.contactId!, ...target.extraContactIds]));
  const owned = await prisma.contact.findMany({
    where: { id: { in: wanted }, organizationId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((contact) => contact.id));
  if (!ownedIds.has(target.contactId!)) return null;

  const ids = wanted.filter((id) => ownedIds.has(id));
  const batchId = ids.length > 1 ? randomUUID() : null;
  return {
    rows: ids.map((contactId) => ({ contactId, companyId: null })),
    batchId,
    primary: { contactId: target.contactId! },
  };
}

export const noteBodySchema = z.string().trim().min(1, "Note can't be empty").max(5000);
export const noteLabelSchema = z.union([z.literal(""), z.enum(NOTE_LABELS)]).optional();
export const activityTypeSchema = z.enum(ACTIVITY_TYPES);
export const activityBodySchema = z.string().trim().min(1, "Add a short summary").max(5000);

// "also logged for 3 others": how many rows share each batch, minus the
// one being displayed.
export async function batchOthers(
  model: "note" | "activity",
  batchIds: (string | null)[],
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(batchIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();
  const rows =
    model === "note"
      ? await prisma.note.groupBy({ by: ["batchId"], where: { batchId: { in: ids } }, _count: { _all: true } })
      : await prisma.activity.groupBy({ by: ["batchId"], where: { batchId: { in: ids } }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.batchId as string, row._count._all - 1]));
}
