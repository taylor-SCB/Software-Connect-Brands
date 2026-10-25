import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CONTRACT_TEMPLATES } from "@/lib/default-templates";

// Which template the app uses for a type when nobody picks one by hand:
// the default first, then the oldest. Every "the Sales Order" lookup goes
// through this order so a second template of a type never quietly wins.
export const TEMPLATE_ORDER: Prisma.ContractTemplateOrderByWithRelationInput[] = [
  { isDefault: "desc" },
  { createdAt: "asc" },
];

// The built-in wording a template started as, for "Restore the original".
export function baselineBody(baseline: string | null | undefined): string | null {
  if (!baseline) return null;
  return DEFAULT_CONTRACT_TEMPLATES.find((template) => template.name === baseline)?.body ?? null;
}

type Tx = Prisma.TransactionClient;

// Makes one template the one used for its type, and no other.
export async function setTemplateDefault(tx: Tx, organizationId: string, templateId: string) {
  const template = await tx.contractTemplate.findFirst({
    where: { id: templateId, organizationId },
    select: { type: true },
  });
  if (!template) return;
  await tx.contractTemplate.updateMany({
    where: { organizationId, type: template.type, id: { not: templateId }, isDefault: true },
    data: { isDefault: false },
  });
  await tx.contractTemplate.update({ where: { id: templateId }, data: { isDefault: true } });
}

// After a template leaves a type (deleted, or its type changed), or a new
// one arrives, the type has exactly one default again: the existing one if
// there is one, else the oldest.
export async function repairTemplateDefault(tx: Tx, organizationId: string, type: string) {
  const rows = await tx.contractTemplate.findMany({
    where: { organizationId, type },
    orderBy: TEMPLATE_ORDER,
    select: { id: true, isDefault: true },
  });
  if (rows.length === 0) return;
  const keep = rows[0].id;
  const extras = rows.filter((row) => row.isDefault && row.id !== keep).map((row) => row.id);
  if (extras.length) {
    await tx.contractTemplate.updateMany({ where: { id: { in: extras } }, data: { isDefault: false } });
  }
  if (!rows[0].isDefault) {
    await tx.contractTemplate.update({ where: { id: keep }, data: { isDefault: true } });
  }
}

export async function loadTemplateDefaultFor(organizationId: string, type: string) {
  return prisma.contractTemplate.findFirst({
    where: { organizationId, type },
    orderBy: TEMPLATE_ORDER,
    select: { id: true, name: true, type: true, body: true },
  });
}

export type TemplateSibling = { id: string; name: string; isDefault: boolean };

// Every template by type, minus the one being edited: what the form needs
// to say "you already have a Sales Order" and to offer the default box.
export async function loadTemplatesByType(
  organizationId: string,
  excludeId?: string,
): Promise<Record<string, TemplateSibling[]>> {
  const rows = await prisma.contractTemplate.findMany({
    where: { organizationId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: TEMPLATE_ORDER,
    select: { id: true, name: true, type: true, isDefault: true },
  });
  const byType: Record<string, TemplateSibling[]> = {};
  for (const row of rows) {
    (byType[row.type] ??= []).push({ id: row.id, name: row.name, isDefault: row.isDefault });
  }
  return byType;
}
