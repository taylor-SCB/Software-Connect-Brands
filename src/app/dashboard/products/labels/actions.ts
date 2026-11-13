"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminSession, requireSession } from "@/lib/session";
import { createCustomUnit, ensureGroup, ensureOption, isBuiltInUnitName } from "@/lib/variations";
import { MAX_UNIT_CONTAINS, cleanLabel } from "@/lib/variation-shared";
import { UNIT_GROUPS } from "@/lib/constants";

// Labels & Units (Release 3b). Anyone signed in adds a label, a group or a
// unit; only an Owner or Admin renames, retires, brings back, reorders or
// changes what a unit contains (Taylor, Nov 5, 2026). A rename shows on
// products and on new quote lines; a quote line keeps the names it was
// written with.

type Result = { ok: true } | { error: string };

const id = z.string().trim().min(1).max(60);
const NOT_ALLOWED = "Only an Owner or Admin can change that.";

function refresh() {
  revalidatePath("/dashboard/products/labels");
  revalidatePath("/dashboard/products");
}

export async function addLabel(groupId: string, name: string): Promise<Result> {
  const { organizationId } = await requireSession();
  if (!id.safeParse(groupId).success) return { error: "Reload the page." };
  const made = await ensureOption(organizationId, groupId, String(name ?? ""));
  if ("error" in made) return made;
  refresh();
  return { ok: true };
}

export async function addGroup(name: string): Promise<Result> {
  const { organizationId } = await requireSession();
  const made = await ensureGroup(organizationId, String(name ?? ""));
  if ("error" in made) return made;
  refresh();
  return { ok: true };
}

export async function addUnit(input: { name: string; contains: string; baseUnit: string; tag: string }): Promise<Result> {
  const { organizationId } = await requireSession();
  const made = await createCustomUnit(organizationId, {
    name: String(input?.name ?? ""),
    contains: Number(input?.contains),
    baseUnit: String(input?.baseUnit ?? ""),
    tag: String(input?.tag ?? ""),
  });
  if ("error" in made) return made;
  refresh();
  return { ok: true };
}

async function manager() {
  const session = await requireAdminSession();
  return session.allowed ? session : null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function renameOption(optionId: string, raw: string): Promise<Result> {
  const session = await manager();
  if (!session) return { error: NOT_ALLOWED };
  if (!id.safeParse(optionId).success) return { error: "Reload the page." };
  const name = cleanLabel(String(raw ?? ""));
  if (!name) return { error: "Type the new name." };
  const option = await prisma.variationOption.findFirst({
    where: { id: optionId, organizationId: session.organizationId },
    select: { id: true, groupId: true, builtInUnit: true, group: { select: { kind: true } } },
  });
  if (!option) return { error: "That label is gone. Reload the page." };
  if (option.builtInUnit) return { error: "Built-in units keep their names." };
  if (option.group.kind === "UNIT" && isBuiltInUnitName(name)) {
    return { error: `${name} is one of the built-in units.` };
  }
  const clash = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "VariationOption"
    WHERE "groupId" = ${option.groupId} AND lower(name) = lower(${name}) AND id <> ${option.id} LIMIT 1`;
  if (clash.length) return { error: `There's already a ${name} in this group.` };
  try {
    await prisma.variationOption.update({ where: { id: option.id }, data: { name } });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: `There's already a ${name} in this group.` };
    throw error;
  }
  refresh();
  return { ok: true };
}

export async function renameGroup(groupId: string, raw: string): Promise<Result> {
  const session = await manager();
  if (!session) return { error: NOT_ALLOWED };
  if (!id.safeParse(groupId).success) return { error: "Reload the page." };
  const name = cleanLabel(String(raw ?? ""));
  if (!name) return { error: "Type the new name." };
  const group = await prisma.variationGroup.findFirst({
    where: { id: groupId, organizationId: session.organizationId },
    select: { id: true, kind: true },
  });
  if (!group) return { error: "That group is gone. Reload the page." };
  if (group.kind !== "CUSTOM") return { error: "Unit, Color and Size keep their names." };
  const clash = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "VariationGroup"
    WHERE "organizationId" = ${session.organizationId} AND lower(name) = lower(${name}) AND id <> ${group.id} LIMIT 1`;
  if (clash.length) return { error: `There's already a group called ${name}.` };
  try {
    await prisma.variationGroup.update({ where: { id: group.id }, data: { name } });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: `There's already a group called ${name}.` };
    throw error;
  }
  refresh();
  return { ok: true };
}

// Retired: off every picker, kept on every product and quote line that
// has it, and back with Restore.
export async function setOptionRetired(optionId: string, retired: boolean): Promise<Result> {
  const session = await manager();
  if (!session) return { error: NOT_ALLOWED };
  if (!id.safeParse(optionId).success) return { error: "Reload the page." };
  const option = await prisma.variationOption.findFirst({
    where: { id: optionId, organizationId: session.organizationId },
    select: { id: true, builtInUnit: true },
  });
  if (!option) return { error: "That label is gone. Reload the page." };
  if (option.builtInUnit && retired) return { error: "Built-in units can't be retired." };
  await prisma.variationOption.update({ where: { id: option.id }, data: { archivedAt: retired ? new Date() : null } });
  refresh();
  return { ok: true };
}

export async function setGroupRetired(groupId: string, retired: boolean): Promise<Result> {
  const session = await manager();
  if (!session) return { error: NOT_ALLOWED };
  if (!id.safeParse(groupId).success) return { error: "Reload the page." };
  const group = await prisma.variationGroup.findFirst({
    where: { id: groupId, organizationId: session.organizationId },
    select: { id: true, kind: true },
  });
  if (!group) return { error: "That group is gone. Reload the page." };
  if (group.kind !== "CUSTOM") return { error: "Unit, Color and Size are always there." };
  if (retired) {
    // The apparel pack: proofs pick their print location from this group.
    const org = await prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { apparelOn: true, printLocationGroupId: true },
    });
    if (org?.apparelOn && org.printLocationGroupId === group.id) {
      return { error: "Proofs use this list for their print location. Turn apparel off in Settings → General first." };
    }
  }
  await prisma.variationGroup.update({ where: { id: group.id }, data: { archivedAt: retired ? new Date() : null } });
  refresh();
  return { ok: true };
}

// Up or down one place among its live neighbours: two writes, the
// positions swapped (numbered afresh first if two share one).
export async function moveOption(optionId: string, direction: "up" | "down"): Promise<Result> {
  const session = await manager();
  if (!session) return { error: NOT_ALLOWED };
  if (!id.safeParse(optionId).success) return { error: "Reload the page." };
  const option = await prisma.variationOption.findFirst({
    where: { id: optionId, organizationId: session.organizationId },
    select: { id: true, groupId: true, builtInUnit: true },
  });
  if (!option) return { error: "That label is gone. Reload the page." };
  if (option.builtInUnit) return { error: "Built-in units keep their order." };
  const siblings = await prisma.variationOption.findMany({
    where: { groupId: option.groupId, archivedAt: null, builtInUnit: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, position: true },
  });
  await swap(siblings, option.id, direction, (rowId, position) =>
    prisma.variationOption.update({ where: { id: rowId }, data: { position } }),
  );
  refresh();
  return { ok: true };
}

export async function moveGroup(groupId: string, direction: "up" | "down"): Promise<Result> {
  const session = await manager();
  if (!session) return { error: NOT_ALLOWED };
  if (!id.safeParse(groupId).success) return { error: "Reload the page." };
  const siblings = await prisma.variationGroup.findMany({
    where: { organizationId: session.organizationId, kind: "CUSTOM", archivedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, position: true },
  });
  if (!siblings.some((row) => row.id === groupId)) return { error: "Unit, Color and Size stay first." };
  await swap(siblings, groupId, direction, (rowId, position) =>
    prisma.variationGroup.update({ where: { id: rowId }, data: { position } }),
  );
  refresh();
  return { ok: true };
}

async function swap(
  rows: { id: string; position: number }[],
  target: string,
  direction: "up" | "down",
  write: (id: string, position: number) => Promise<unknown>,
) {
  const index = rows.findIndex((row) => row.id === target);
  const other = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || other < 0 || other >= rows.length) return;
  const base = rows[0].position;
  const distinct = new Set(rows.map((row) => row.position)).size === rows.length;
  if (!distinct) {
    await Promise.all(rows.map((row, i) => write(row.id, base + i)));
    rows = rows.map((row, i) => ({ ...row, position: base + i }));
  }
  await write(rows[index].id, rows[other].position);
  await write(rows[other].id, rows[index].position);
}

// What one of the workspace's own units contains ("Box of 12" holds 12
// Each). Printed only until Release 6 does the arithmetic.
export async function setUnitContains(optionId: string, contains: string, baseUnit: string): Promise<Result> {
  const session = await manager();
  if (!session) return { error: NOT_ALLOWED };
  if (!id.safeParse(optionId).success) return { error: "Reload the page." };
  const unit = await prisma.variationOption.findFirst({
    where: { id: optionId, organizationId: session.organizationId, builtInUnit: null, group: { kind: "UNIT" } },
    select: { id: true, tag: true },
  });
  if (!unit || (unit.tag !== "LABOR" && unit.tag !== "MATERIALS")) return { error: "That unit is gone. Reload the page." };
  const amount = Number(contains);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_UNIT_CONTAINS) {
    return { error: "How many it contains has to be a number above 0." };
  }
  if (!(UNIT_GROUPS[unit.tag] as readonly string[]).includes(baseUnit)) {
    return { error: "Pick what one of these contains from the list." };
  }
  await prisma.variationOption.update({
    where: { id: unit.id },
    data: { contains: amount, baseUnit: baseUnit as (typeof UNIT_GROUPS)["MATERIALS"][number] },
  });
  refresh();
  return { ok: true };
}
